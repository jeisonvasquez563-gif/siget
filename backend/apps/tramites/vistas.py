"""API de trámites.

Cómo se protege cada petición (Zero Trust, "nunca confiar, siempre verificar"):
1. Autenticación: token válido, sesión vigente, cuenta activa, scope completo.
2. Contexto RLS: se fija quién es y a qué instituciones pertenece, solo para esta transacción; la base filtra
   las filas aunque el resto fallara.
3. PDP: se consulta con los atributos del sujeto, del recurso y del entorno, y la decisión (también las
   negadas) queda registrada.
4. La base valida otra vez: transiciones de estado y auditoría en la misma transacción.

Lo que la persona no puede ver, para ella no existe (404): no se distingue "no existe" de "no es tuyo".
"""
from django.db import DatabaseError, transaction
from django.utils import timezone
from rest_framework import status
from rest_framework.exceptions import NotFound
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from apps.auditoria.models import EventoAuditoria
from apps.autenticacion.autenticacion import exige_scope
from apps.autenticacion.tokens import SCOPE_COMPLETO
from apps.autorizacion.pdp import Accion, Recurso
from apps.autorizacion.permisos import _membresias, autorizar
from apps.catalogo.models import TipoTramite
from apps.identidad.models import Membresia
from apps.nucleo.contexto import fijar_contexto
from apps.tramites.models import Tramite

from .serializacion import (ESTADOS_VALIDOS, calcular_fecha_limite, entero_positivo, evento_a_dict, paginacion,
                            texto, tramite_a_dict)


def _datos(request):
    return request.data if isinstance(request.data, dict) else {}


def _recurso(tramite, destino=None):
    return Recurso(tipo="tramite", institucion_id=tramite.institucion_id, solicitante_id=tramite.solicitante_id,
                   funcionario_asignado_id=tramite.funcionario_asignado_id, estado=tramite.estado, estado_destino=destino)


def _error(codigo, detalle, http):
    return Response({"codigo": codigo, "detalle": detalle}, status=http)


class _Base(APIView):
    permission_classes = [exige_scope(SCOPE_COMPLETO)]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "api"

    def check_permissions(self, request):
        super().check_permissions(request)
        usuario = request.user.usuario
        self.instituciones = sorted({m.institucion_id for m in _membresias(usuario)})
        fijar_contexto(usuario.pk, self.instituciones)

    def _es_personal(self, tramite):
        return tramite.institucion_id in self.instituciones

    def _tramite_visible(self, pk):
        if entero_positivo(pk) is None:
            raise NotFound()
        tramite = Tramite.objects.select_related("tipo_tramite", "institucion").filter(pk=pk).first()
        if tramite is None:  # RLS ya filtró lo ajeno: para quien pregunta, no existe
            raise NotFound()
        return tramite

    def _respuesta(self, pk, http=status.HTTP_200_OK):
        tramite = self._tramite_visible(pk)
        return Response(tramite_a_dict(tramite, self._es_personal(tramite), timezone.now()), status=http)


class TramitesColeccion(_Base):
    def get(self, request):
        usuario = request.user.usuario
        # Listar no apunta a un trámite concreto: el PDP decide si esta persona puede ver trámites (los roles de
        # plataforma no) y la base devuelve solo las filas que le corresponden (RLS).
        autorizar(request, Accion.VER_TRAMITE, Recurso(tipo="tramite", solicitante_id=usuario.pk))
        pagina = paginacion(request.query_params)
        if pagina is None:
            return _error("paginacion_invalida", "limite (1 a 100) y desplazamiento deben ser enteros válidos.", status.HTTP_400_BAD_REQUEST)
        limite, desplazamiento = pagina
        ahora = timezone.now()
        consulta = Tramite.objects.select_related("tipo_tramite", "institucion").order_by("-creado_en", "-id")
        filas = list(consulta[desplazamiento:desplazamiento + limite])
        return Response({"resultados": [tramite_a_dict(t, self._es_personal(t), ahora) for t in filas],
                         "limite": limite, "desplazamiento": desplazamiento})

    def post(self, request):
        usuario = request.user.usuario
        tipo_id = entero_positivo(_datos(request).get("tipo_tramite"))
        if tipo_id is None:
            return _error("datos_invalidos", "Indica `tipo_tramite` con el id de un trámite del catálogo.", status.HTTP_400_BAD_REQUEST)
        tipo = TipoTramite.objects.select_related("institucion").filter(pk=tipo_id).first()
        if tipo is None:
            return _error("tipo_tramite_inexistente", "Ese trámite no existe en el catálogo.", status.HTTP_404_NOT_FOUND)
        # El solicitante siempre es quien actúa: cualquier otro campo del cuerpo se ignora
        autorizar(request, Accion.CREAR_TRAMITE, Recurso(tipo="tramite", institucion_id=tipo.institucion_id, solicitante_id=usuario.pk))
        ahora = timezone.now()
        tramite = Tramite.objects.create(tipo_tramite=tipo, institucion=tipo.institucion, solicitante=usuario,
                                         fecha_limite=calcular_fecha_limite(ahora, tipo.sla_dias))
        EventoAuditoria.objects.create(tramite=tramite, institucion_id=tipo.institucion_id, actor_id=usuario.pk, accion="creacion",
                                       estado_nuevo=tramite.estado, atributos={"tipo_tramite": tipo.pk, "sla_dias": tipo.sla_dias})
        return self._respuesta(tramite.pk, status.HTTP_201_CREATED)


class TramiteDetalle(_Base):
    def get(self, request, pk):
        tramite = self._tramite_visible(pk)
        autorizar(request, Accion.VER_TRAMITE, _recurso(tramite))
        return Response(tramite_a_dict(tramite, self._es_personal(tramite), timezone.now()))


class TramiteEstado(_Base):
    def post(self, request, pk):
        tramite = self._tramite_visible(pk)
        destino = texto(_datos(request).get("estado"))
        if destino not in ESTADOS_VALIDOS:
            return _error("datos_invalidos", "`estado` debe ser uno de: " + ", ".join(sorted(ESTADOS_VALIDOS)) + ".", status.HTTP_400_BAD_REQUEST)
        autorizar(request, Accion.CAMBIAR_ESTADO, _recurso(tramite, destino))
        try:
            with transaction.atomic():
                # `estado=` en el filtro: si alguien lo cambió entre tanto, no se pisa su cambio (concurrencia optimista).
                # La base valida la transición y escribe la auditoría en esta misma transacción.
                filas = Tramite.objects.filter(pk=tramite.pk, estado=tramite.estado).update(estado=destino)
        except DatabaseError:
            return _error("transicion_rechazada", "La base de datos rechazó la transición.", status.HTTP_409_CONFLICT)
        if filas != 1:
            return _error("conflicto", "El trámite cambió mientras se procesaba. Consúltalo de nuevo.", status.HTTP_409_CONFLICT)
        return self._respuesta(tramite.pk)


class TramiteReasignar(_Base):
    def post(self, request, pk):
        usuario = request.user.usuario
        tramite = self._tramite_visible(pk)
        datos = _datos(request)
        if "funcionario_id" not in datos or (datos["funcionario_id"] is not None and entero_positivo(datos["funcionario_id"]) is None):
            return _error("datos_invalidos", "Indica `funcionario_id` (un id, o null para dejarlo en cola).", status.HTTP_400_BAD_REQUEST)
        nuevo = datos["funcionario_id"]
        autorizar(request, Accion.REASIGNAR_TRAMITE, _recurso(tramite))
        if nuevo is not None:
            es_personal = Membresia.objects.filter(usuario_id=nuevo, institucion_id=tramite.institucion_id,
                                                   rol__in=["funcionario", "supervisor"]).exists()
            if not es_personal or nuevo == tramite.solicitante_id:
                return _error("destinatario_invalido", "Solo se puede asignar a personal de la misma institución que no sea el solicitante.", status.HTTP_400_BAD_REQUEST)
        anterior = tramite.funcionario_asignado_id
        Tramite.objects.filter(pk=tramite.pk).update(funcionario_asignado_id=nuevo)
        EventoAuditoria.objects.create(tramite=tramite, institucion_id=tramite.institucion_id, actor_id=usuario.pk, accion="reasignacion",
                                       estado_anterior=tramite.estado, estado_nuevo=tramite.estado, atributos={"de": anterior, "a": nuevo})
        return self._respuesta(tramite.pk)


class TramiteHistorial(_Base):
    def get(self, request, pk):
        tramite = self._tramite_visible(pk)
        autorizar(request, Accion.VER_TRAMITE, _recurso(tramite))
        personal = self._es_personal(tramite)
        eventos = EventoAuditoria.objects.filter(tramite_id=tramite.pk).order_by("id")[:500]  # orden de inserción: `creado_en` no sirve, el trigger usa la hora de su transacción
        return Response({"tramite": tramite.pk, "eventos": [evento_a_dict(e, personal) for e in eventos]})
