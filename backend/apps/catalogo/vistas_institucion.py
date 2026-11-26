"""Catálogo de trámites de UNA institución, para su coordinación: ver todos los tipos (también los desactivados), crear, cambiar y ver el historial.

Cómo se protege cada petición (igual que en trámites): autenticación con acceso completo; contexto de seguridad por filas fijado ANTES de
tocar nada (el disparador de la migración 020 y la política del historial leen `siget.ctx_usuario()`); el PDP decide con
`GESTIONAR_CATALOGO_INSTITUCION` (coordinación vigente de ESA institución con segundo factor reciente) antes de buscar o escribir; y la base
valida otra vez. Un tipo que no es de esa institución, para quien pregunta, no existe (404). Nada se borra: un tipo se desactiva.
"""
from django.db import DatabaseError, transaction
from rest_framework import status
from rest_framework.exceptions import NotFound
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from apps.autenticacion.autenticacion import exige_scope
from apps.autenticacion.tokens import SCOPE_COMPLETO
from apps.autorizacion.pdp import Accion, Recurso
from apps.autorizacion.permisos import autorizar
from apps.nucleo.contexto import fijar_contexto
from apps.tramites.serializacion import entero_positivo, pagina_de, paginacion

from . import gestion
from .models import CatalogoCambio, Institucion, TipoTramite

PREFIJO_DE_LA_BASE = "Catalogo: "  # los mensajes de los disparadores de la migración 020 son propios y no llevan datos de nadie
CODIGOS_DE_LA_BASE = {"P0001", "23514", "23505", "42501"}  # regla del disparador, CHECK, nombre repetido y falta de permiso
NOMBRE_REPETIDO = "Ya existe un trámite con ese nombre en esta institución."


def _error(codigo, detalle, http, errores=None):
    cuerpo = {"codigo": codigo, "detalle": detalle}
    if errores:
        cuerpo["errores"] = errores
    return Response(cuerpo, status=http)


def _rechazo_de_la_base(error):
    """La base rechazó el cambio (aunque la API ya lo había validado: otra persona cambió algo entre tanto, o falló una regla que aquí no se
    replica). Devuelve la respuesta 400, o `None` si NO es un rechazo esperado: ese caso es un fallo real y debe seguir como 500."""
    causa = getattr(error, "__cause__", None)
    codigo = getattr(causa, "sqlstate", None)
    if codigo not in CODIGOS_DE_LA_BASE:
        return None
    if codigo == "23505":
        return _error("datos_invalidos", NOMBRE_REPETIDO, status.HTTP_400_BAD_REQUEST, {"nombre": NOMBRE_REPETIDO})
    mensaje = getattr(getattr(causa, "diag", None), "message_primary", "") or ""
    if codigo == "P0001" and mensaje.startswith(PREFIJO_DE_LA_BASE):
        detalle = mensaje[len(PREFIJO_DE_LA_BASE):].strip()
        return _error("catalogo_rechazado", f"La base de datos rechazó el cambio: {detalle}.", status.HTTP_400_BAD_REQUEST)
    return _error("catalogo_rechazado", "La base de datos rechazó el cambio: no cumple las reglas del catálogo.", status.HTTP_400_BAD_REQUEST)


class _Coordinacion(APIView):
    permission_classes = [exige_scope(SCOPE_COMPLETO)]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "api"

    def check_permissions(self, request):
        super().check_permissions(request)
        # Sin instituciones: coordinar el catálogo no da acceso a los trámites. Solo hace falta quién es (disparador y política del historial)
        fijar_contexto(request.user.usuario.pk, [])

    @staticmethod
    def autorizar_coordinacion(request, institucion):
        autorizar(request, Accion.GESTIONAR_CATALOGO_INSTITUCION, Recurso(tipo="tipo_tramite", institucion_id=institucion))

    @staticmethod
    def datos(request):
        return request.data if isinstance(request.data, dict) else {}


class TiposDeInstitucion(_Coordinacion):
    def get(self, request, institucion):
        self.autorizar_coordinacion(request, institucion)
        inst = Institucion.objects.filter(pk=institucion).first()
        if inst is None:
            raise NotFound()
        tipos = TipoTramite.objects.filter(institucion_id=institucion).order_by("nombre", "id")
        return Response({"institucion": {"id": inst.pk, "nombre": inst.nombre}, "tipos": [gestion.tipo_a_dict(t) for t in tipos]})

    def post(self, request, institucion):
        self.autorizar_coordinacion(request, institucion)
        limpio, errores = gestion.validar(self.datos(request))
        if errores:
            return _error("datos_invalidos", "Los datos del trámite no cumplen las reglas del catálogo.", status.HTTP_400_BAD_REQUEST, errores)
        if TipoTramite.objects.filter(institucion_id=institucion, nombre__iexact=limpio["nombre"]).exists():
            return _error("datos_invalidos", NOMBRE_REPETIDO, status.HTTP_400_BAD_REQUEST, {"nombre": NOMBRE_REPETIDO})
        try:
            with transaction.atomic():  # punto de guardado: si la base rechaza, la petición sigue viva para responder 400
                tipo = TipoTramite.objects.create(institucion_id=institucion, **limpio)
        except DatabaseError as error:
            respuesta = _rechazo_de_la_base(error)
            if respuesta is None:
                raise
            return respuesta
        return Response(gestion.tipo_a_dict(tipo), status=status.HTTP_201_CREATED)


class TipoDeInstitucion(_Coordinacion):
    def patch(self, request, institucion, pk):
        self.autorizar_coordinacion(request, institucion)
        if entero_positivo(pk) is None:
            raise NotFound()
        tipo = TipoTramite.objects.filter(pk=pk, institucion_id=institucion).first()
        if tipo is None:  # de otra institución o inexistente: para quien pregunta, no existe
            raise NotFound()
        limpio, errores = gestion.validar(self.datos(request), parcial=True)
        if errores:
            return _error("datos_invalidos", "Los datos del trámite no cumplen las reglas del catálogo.", status.HTTP_400_BAD_REQUEST, errores)
        if "nombre" in limpio and TipoTramite.objects.filter(institucion_id=institucion, nombre__iexact=limpio["nombre"]).exclude(pk=tipo.pk).exists():
            return _error("datos_invalidos", NOMBRE_REPETIDO, status.HTTP_400_BAD_REQUEST, {"nombre": NOMBRE_REPETIDO})
        cambios = {campo: valor for campo, valor in limpio.items() if getattr(tipo, campo) != valor}
        if cambios:  # lo que no cambió no se escribe (y la base tampoco deja registro)
            try:
                with transaction.atomic():
                    TipoTramite.objects.filter(pk=tipo.pk, institucion_id=institucion).update(**cambios)
            except DatabaseError as error:
                respuesta = _rechazo_de_la_base(error)
                if respuesta is None:
                    raise
                return respuesta
            tipo = TipoTramite.objects.get(pk=tipo.pk)
        return Response(gestion.tipo_a_dict(tipo))


class CambiosDeInstitucion(_Coordinacion):
    def get(self, request, institucion):
        self.autorizar_coordinacion(request, institucion)
        pagina = paginacion(request.query_params)
        if pagina is None:
            return _error("paginacion_invalida", "limite (1 a 100) y desplazamiento deben ser enteros válidos.", status.HTTP_400_BAD_REQUEST)
        limite, desplazamiento = pagina
        # La política de la base ya deja ver solo lo de las instituciones donde esta persona es coordinadora; el filtro es por claridad
        consulta = CatalogoCambio.objects.filter(institucion_id=institucion).select_related("tipo_tramite", "actor").order_by("-id")
        filas = list(consulta[desplazamiento:desplazamiento + limite])
        return Response(pagina_de([gestion.cambio_a_dict(c) for c in filas], consulta.count(), limite, desplazamiento))
