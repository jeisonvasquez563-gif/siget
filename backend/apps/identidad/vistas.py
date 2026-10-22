"""Equipo de una institución: quién tiene qué rol. Lo ven la coordinación y la supervisión; solo la coordinación lo gestiona."""
from rest_framework import status
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from apps.autenticacion.autenticacion import exige_scope
from apps.autenticacion.tokens import SCOPE_COMPLETO
from apps.autorizacion.pdp import Accion, Recurso
from apps.autorizacion.permisos import _membresias, autorizar

from . import equipo
from .models import Membresia


class Equipo(APIView):
    permission_classes = [exige_scope(SCOPE_COMPLETO)]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "api"

    def get(self, request):
        usuario = request.user.usuario
        propias = _membresias(usuario)
        # Solo las instituciones donde la persona coordina o supervisa; si no tiene ninguna, el PDP niega y queda registrado
        instituciones = sorted({m.institucion_id for m in propias if m.rol in {"coordinador_institucional", "supervisor"}})
        if not instituciones:
            autorizar(request, Accion.GESTIONAR_USUARIOS_INSTITUCION, Recurso(tipo="usuario"))
        salida = []
        for inst in instituciones:
            es_coordinador = any(m.institucion_id == inst and m.rol == "coordinador_institucional" for m in propias)
            if es_coordinador:
                autorizar(request, Accion.GESTIONAR_USUARIOS_INSTITUCION, Recurso(tipo="usuario", institucion_id=inst))
            else:
                autorizar(request, Accion.REASIGNAR_TRAMITE, Recurso(tipo="tramite", institucion_id=inst))
            miembros = (Membresia.objects.filter(institucion_id=inst, rol__in=["funcionario", "supervisor", "coordinador_institucional"])
                        .select_related("usuario", "institucion").order_by("rol", "usuario__username"))
            salida.append({
                "institucion": {"id": inst, "nombre": miembros[0].institucion.nombre if miembros else None},
                # La coordinación (y solo ella) puede gestionar al personal; las coordinaciones las da de alta la plataforma
                "puede_gestionar": es_coordinador,
                "personal": [{"usuario_id": m.usuario_id, "usuario": m.usuario.username, "rol": m.rol,
                              "gestionable": es_coordinador and m.rol in equipo.ROLES_GESTIONABLES and m.usuario_id != usuario.pk} for m in miembros],
            })
        return Response({"equipos": salida})


MENSAJES = {
    "no_a_si_mismo": "No puedes cambiar tu propio acceso.",
    "no_corresponde": "Esa persona no es personal de esta institución con ese rol.",
    "no_existe": "No existe la institución o la persona.",
    "tiene_tramites_abiertos": "Esa persona aún tiene trámites abiertos asignados. Pídele a supervisión que los reasigne y vuelve a intentarlo.",
}


def _ip(request):
    return request.META.get("HTTP_X_REAL_IP") or request.META.get("REMOTE_ADDR")


def _respuesta(r, creado=False):
    if r.ok:
        return Response({"codigo": r.codigo}, status=status.HTTP_201_CREATED if creado else status.HTTP_200_OK)
    if r.codigo == "datos_invalidos":
        return Response({"codigo": r.codigo, "errores": r.detalle["errores"]}, status=status.HTTP_400_BAD_REQUEST)
    if r.codigo == "no_existe":
        return Response({"codigo": r.codigo, "detalle": MENSAJES[r.codigo]}, status=status.HTTP_404_NOT_FOUND)
    return Response({"codigo": r.codigo, "detalle": MENSAJES.get(r.codigo, "No se pudo completar la operación."), **(r.detalle or {})}, status=status.HTTP_409_CONFLICT)


class _Gestion(APIView):
    permission_classes = [exige_scope(SCOPE_COMPLETO)]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "api"

    def autorizar_coordinacion(self, request, institucion):
        # El PDP decide: coordinación de ESA institución y segundo factor reciente. Cualquier otra persona recibe 403 (registrado)
        autorizar(request, Accion.GESTIONAR_USUARIOS_INSTITUCION, Recurso(tipo="usuario", institucion_id=institucion))

    @staticmethod
    def datos(request):
        return request.data if isinstance(request.data, dict) else {}


class EquipoAgregar(_Gestion):
    def post(self, request, institucion):
        self.autorizar_coordinacion(request, institucion)
        d = self.datos(request)
        return _respuesta(equipo.agregar(request.user.usuario, institucion, d.get("usuario"), d.get("rol"), _ip(request)), creado=True)


class EquipoCambiarRol(_Gestion):
    def post(self, request, institucion, persona):
        self.autorizar_coordinacion(request, institucion)
        return _respuesta(equipo.cambiar_rol(request.user.usuario, institucion, persona, self.datos(request).get("rol"), _ip(request)))


class EquipoQuitar(_Gestion):
    def post(self, request, institucion, persona):
        self.autorizar_coordinacion(request, institucion)
        return _respuesta(equipo.quitar(request.user.usuario, institucion, persona, _ip(request)))
