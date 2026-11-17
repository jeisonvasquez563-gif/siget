"""«Mis datos»: derechos de la persona sobre sus datos personales (PT-15, Ley 81 de 2019) y aviso de privacidad.

- Todo es sobre la propia cuenta: ninguna ruta recibe el identificador de otra persona.
- Ver y exportar no piden segundo factor reciente (es información propia y la persona ya inició sesión con él); corregir sí:
  la decide el PDP con la acción `corregir_mis_datos`.
- Los trámites que se cuentan o exportan son los que la persona ya puede ver por `/tramites/` (seguridad por filas, sin instituciones).
"""
from datetime import date

from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from apps.autenticacion.autenticacion import exige_scope
from apps.autenticacion.tokens import SCOPE_COMPLETO
from apps.autorizacion.pdp import Accion, Recurso
from apps.autorizacion.permisos import autorizar, evaluar
from apps.identidad.models import Perfil
from apps.nucleo.contexto import fijar_contexto

from . import derechos, perfil as lib_perfil, servicio_derechos as servicio
from .servicio import registrar_evento

MENSAJE_EN_USO = "No se pudo guardar el cambio con esos datos."  # el mismo código y estado que el registro: no revela quién está registrado


def _ip(request):
    return request.META.get("HTTP_X_REAL_IP") or request.META.get("REMOTE_ADDR")


def _datos(request):
    return request.data if isinstance(request.data, dict) else {}


class AvisoPrivacidad(APIView):
    """El aviso que se lee antes de registrarse. Es público: no lleva datos de nadie."""

    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "anon"

    def get(self, request):
        return Response(derechos.aviso_vigente())


class _Propia(APIView):
    permission_classes = [exige_scope(SCOPE_COMPLETO)]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "api"

    def _puede_ver_tramites(self, request):
        """El PDP decide (los roles de plataforma no ven trámites) y la base filtra por filas: aquí solo los propios, sin instituciones."""
        usuario = request.user.usuario
        fijar_contexto(usuario.pk, [])
        return evaluar(usuario, Accion.VER_TRAMITE, Recurso(tipo="tramite", solicitante_id=usuario.pk)).permitido


class MisDatos(_Propia):
    def get(self, request):
        usuario = request.user.usuario
        ahora = timezone.now()
        fila = Perfil.objects.filter(pk=usuario.pk).first()
        total = servicio.contar_tramites(usuario) if self._puede_ver_tramites(request) else 0
        respuesta = Response({
            "cuenta": servicio.cuenta_a_dict(usuario),
            "perfil": servicio.perfil_a_dict(fila) if fila is not None else None,
            "campos_editables": servicio.CAMPOS_EDITABLES,
            "tramites": {"total": total},
            "aviso_aceptado": servicio.constancia_del_aviso(fila),
            "aviso_vigente": derechos.aviso_vigente(),
            "solicitudes": servicio.solicitudes_de(usuario, ahora),
            "solicitudes_abiertas_maximo": derechos.MAX_SOLICITUDES_ABIERTAS,
            "plazo_respuesta_dias_habiles": derechos.PLAZO_DIAS_HABILES,
        })
        respuesta["Cache-Control"] = "no-store"  # lleva la cédula descifrada: que ningún intermediario la guarde
        return respuesta

    def patch(self, request):
        usuario = request.user.usuario
        # El PDP exige segundo factor reciente y que el perfil sea el propio; el recurso nunca sale del cuerpo
        autorizar(request, Accion.CORREGIR_MIS_DATOS, Recurso(tipo="perfil", solicitante_id=usuario.pk))
        campos, errores = lib_perfil.validar_correccion(request.data)
        if errores:
            return Response({"codigo": "datos_invalidos", "errores": errores}, status=status.HTTP_400_BAD_REQUEST)
        r = servicio.corregir_datos(usuario, campos, _ip(request))
        if r.codigo == "sin_perfil":
            return Response({"codigo": "sin_perfil", "detalle": "Esta cuenta no tiene datos personales que corregir."}, status=status.HTTP_404_NOT_FOUND)
        if not r.ok:
            return Response({"codigo": r.codigo, "detalle": MENSAJE_EN_USO}, status=status.HTTP_409_CONFLICT)
        fila = Perfil.objects.get(pk=usuario.pk)
        respuesta = Response({"codigo": r.codigo, "campos_cambiados": r.detalle["campos"], "perfil": servicio.perfil_a_dict(fila)})
        respuesta["Cache-Control"] = "no-store"
        return respuesta


class MisDatosExportar(_Propia):
    """Portabilidad: un archivo JSON con todo lo propio."""

    throttle_scope = "exportar"

    def get(self, request):
        usuario = request.user.usuario
        ahora = timezone.now()
        documento = servicio.exportar(usuario, self._puede_ver_tramites(request), ahora)
        registrar_evento(usuario.pk, "datos_personales_exportados", _ip(request), {"tramites": len(documento["tramites"])})
        respuesta = Response(documento)
        respuesta["Content-Disposition"] = f'attachment; filename="siget-mis-datos-{usuario.username}-{date.today().isoformat()}.json"'
        respuesta["Cache-Control"] = "no-store"
        return respuesta


MENSAJES_SOLICITUD = {
    "demasiadas_abiertas": "Ya tienes {abiertas} solicitudes abiertas (el máximo es {maximo}). Espera su respuesta antes de enviar otra.",
}


class MisSolicitudes(_Propia):
    def get(self, request):
        respuesta = Response({"solicitudes": servicio.solicitudes_de(request.user.usuario), "plazo_respuesta_dias_habiles": derechos.PLAZO_DIAS_HABILES,
                              "abiertas_maximo": derechos.MAX_SOLICITUDES_ABIERTAS})
        respuesta["Cache-Control"] = "no-store"
        return respuesta

    def post(self, request):
        datos, errores = derechos.validar_solicitud(_datos(request))
        if errores:
            return Response({"codigo": "datos_invalidos", "errores": errores}, status=status.HTTP_400_BAD_REQUEST)
        r = servicio.crear_solicitud(request.user.usuario, datos[0], datos[1], _ip(request))
        if not r.ok:
            return Response({"codigo": r.codigo, "detalle": MENSAJES_SOLICITUD[r.codigo].format(**r.detalle)}, status=status.HTTP_409_CONFLICT)
        return Response(r.detalle["solicitud"], status=status.HTTP_201_CREATED)
