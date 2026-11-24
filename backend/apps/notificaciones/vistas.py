"""API de notificaciones (PT-9): las de la propia persona y nada más.

- El contexto de seguridad por filas se fija igual que en los trámites; la base solo deja ver y marcar las filas con `usuario_id` igual
  al de la persona (migración 018). Lo ajeno responde 404, como un trámite ajeno: no se distingue «no existe» de «no es tuyo».
- El PDP decide con `ver_mis_notificaciones` (cualquier cuenta activa, sobre las propias, sin segundo factor reciente).
- La aplicación no crea ni borra notificaciones: las genera la base al cambiar el trámite. Solo las marca como leídas, una vez.
- Las respuestas no se guardan en caché: son datos de la persona.
"""
from django.utils import timezone
from rest_framework import status
from rest_framework.exceptions import NotFound
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from apps.autenticacion.autenticacion import exige_scope
from apps.autenticacion.tokens import SCOPE_COMPLETO
from apps.autorizacion.pdp import Accion, Recurso
from apps.autorizacion.permisos import _membresias, autorizar
from apps.nucleo.contexto import fijar_contexto
from apps.notificaciones.models import Notificacion
from apps.notificaciones.serializacion import notificacion_a_dict
from apps.tramites.models import Tramite
from apps.tramites.serializacion import entero_positivo, pagina_de, paginacion
from apps.tramites.vistas import ROLES_QUE_ATIENDEN, _error


class _Propias(APIView):
    permission_classes = [exige_scope(SCOPE_COMPLETO)]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "api"

    def check_permissions(self, request):
        super().check_permissions(request)
        usuario = request.user.usuario
        # Mismas instituciones que en los trámites: sirven para ver el nombre del trámite (si la base se lo deja ver); la lista de
        # notificaciones solo depende del usuario
        instituciones = sorted({m.institucion_id for m in _membresias(usuario) if m.rol in ROLES_QUE_ATIENDEN})
        fijar_contexto(usuario.pk, instituciones)

    def _autorizar(self, request):
        """El PDP decide sobre las PROPIAS notificaciones (el recurso nunca sale de la petición) y deja la decisión registrada."""
        autorizar(request, Accion.VER_MIS_NOTIFICACIONES, Recurso(tipo="notificacion", solicitante_id=request.user.usuario.pk))

    @staticmethod
    def _sin_cache(respuesta):
        respuesta["Cache-Control"] = "no-store"
        return respuesta

    @staticmethod
    def _no_leidas():
        return Notificacion.objects.filter(leida_en__isnull=True).count()  # la base ya filtra por filas: solo las de esta persona


class NotificacionesColeccion(_Propias):
    def get(self, request):
        self._autorizar(request)
        pagina = paginacion(request.query_params)
        if pagina is None:
            return _error("paginacion_invalida", "limite (1 a 100) y desplazamiento deben ser enteros válidos.", status.HTTP_400_BAD_REQUEST)
        limite, desplazamiento = pagina
        solo_no_leidas = request.query_params.get("solo_no_leidas")
        if solo_no_leidas not in (None, "1"):
            return _error("filtro_invalido", "`solo_no_leidas` solo admite el valor 1.", status.HTTP_400_BAD_REQUEST)
        consulta = Notificacion.objects.order_by("-creada_en", "-id")
        if solo_no_leidas:
            consulta = consulta.filter(leida_en__isnull=True)
        filas = list(consulta[desplazamiento:desplazamiento + limite])
        # El trámite se pide aparte (y no con select_related): un INNER JOIN haría desaparecer la notificación de un trámite que la
        # persona ya no puede ver, y ella debe poder leerla y marcarla igual
        visibles = {t.pk: t for t in Tramite.objects.select_related("tipo_tramite", "institucion").filter(pk__in={n.tramite_id for n in filas})}
        cuerpo = pagina_de([notificacion_a_dict(n, visibles.get(n.tramite_id)) for n in filas], consulta.count(), limite, desplazamiento)
        cuerpo["no_leidas"] = self._no_leidas()
        return self._sin_cache(Response(cuerpo))


class NotificacionLeida(_Propias):
    def post(self, request, pk):
        self._autorizar(request)
        if entero_positivo(pk) is None:
            raise NotFound()
        notificacion = Notificacion.objects.filter(pk=pk).first()
        if notificacion is None:  # la base ya filtró lo ajeno: para quien pregunta, no existe
            raise NotFound()
        if notificacion.leida_en is None:
            # `leida_en is null` en el filtro: si otra petición ya la marcó, no se vuelve a escribir (la base no lo permite). La hora la fija la base.
            Notificacion.objects.filter(pk=pk, leida_en__isnull=True).update(leida_en=timezone.now())
        return self._sin_cache(Response({"id": pk, "leida": True, "no_leidas": self._no_leidas()}))


class NotificacionesLeerTodas(_Propias):
    def post(self, request):
        self._autorizar(request)
        marcadas = Notificacion.objects.filter(leida_en__isnull=True).update(leida_en=timezone.now())
        return self._sin_cache(Response({"marcadas": marcadas, "no_leidas": self._no_leidas()}))
