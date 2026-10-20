"""Vistas de autenticación.

Son `non_atomic_requests` a propósito: los contadores de intentos y los eventos de seguridad deben
guardarse aunque la respuesta sea un 401. Cada operación que necesita atomicidad abre la suya.
Los mensajes de error son genéricos: nunca revelan si un usuario existe.
"""
from django.conf import settings
from django.db import transaction
from django.utils.decorators import method_decorator
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from apps.identidad.models import Membresia

from . import servicio, tokens
from .autenticacion import exige_scope

ENCABEZADO_CSRF = "HTTP_X_SIGET_CSRF"
COOKIE_PATH = "/auth/"
MENSAJE_GENERICO = "Credenciales inválidas o cuenta bloqueada temporalmente."


def _ip(request):
    # nginx fija X-Real-IP con la dirección real e ignora la que mande el cliente
    return request.META.get("HTTP_X_REAL_IP") or request.META.get("REMOTE_ADDR")


def _campo(request, nombre):
    datos = request.data if isinstance(request.data, dict) else {}
    valor = datos.get(nombre)
    return valor if isinstance(valor, str) else None


def _poner_cookie(respuesta, refresh):
    respuesta.set_cookie(settings.SIGET_COOKIE_REFRESH, refresh, max_age=settings.SIGET_REFRESH_TTL_SEGUNDOS,
                         httponly=True, secure=True, samesite="Strict", path=COOKIE_PATH)


def _quitar_cookie(respuesta):
    respuesta.delete_cookie(settings.SIGET_COOKIE_REFRESH, path=COOKIE_PATH, samesite="Strict")


def _tokens_en_respuesta(resultado, codigo_http=status.HTTP_200_OK):
    cuerpo = {"access_token": resultado.access, "tipo": "Bearer", "expira_en": resultado.expira_en, "scope": resultado.scope}
    if resultado.scope == tokens.SCOPE_ENROLAR_MFA:
        cuerpo["mfa_enrolamiento_requerido"] = True
    respuesta = Response(cuerpo, status=codigo_http)
    if resultado.refresh:
        _poner_cookie(respuesta, resultado.refresh)
    return respuesta


def _denegado(codigo, detalle=MENSAJE_GENERICO, http=status.HTTP_401_UNAUTHORIZED):
    return Response({"codigo": codigo, "detalle": detalle}, status=http)


class _Publica(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]


@method_decorator(transaction.non_atomic_requests, name="dispatch")
class Registro(_Publica):
    throttle_scope = "registro"

    def post(self, request):
        r = servicio.registrar_usuario(_campo(request, "username"), _campo(request, "password"), _ip(request))
        if r.ok:
            return Response({"detalle": "Cuenta creada. Inicia sesión y activa el segundo factor."}, status=status.HTTP_201_CREATED)
        if r.codigo == "datos_invalidos":
            return Response({"codigo": r.codigo, "errores": r.detalle["errores"]}, status=status.HTTP_400_BAD_REQUEST)
        return Response({"codigo": r.codigo, "detalle": "No se pudo crear la cuenta con esos datos."}, status=status.HTTP_409_CONFLICT)


@method_decorator(transaction.non_atomic_requests, name="dispatch")
class Login(_Publica):
    throttle_scope = "login"

    def post(self, request):
        r = servicio.iniciar_sesion(_campo(request, "username"), _campo(request, "password"), _campo(request, "codigo"), _ip(request))
        if r.ok:
            return _tokens_en_respuesta(r)
        if r.codigo == "mfa_requerido":
            return _denegado("mfa_requerido", "Falta el código del segundo factor.")
        return _denegado("credenciales_invalidas")


@method_decorator(transaction.non_atomic_requests, name="dispatch")
class Refresh(_Publica):
    throttle_scope = "refresh"

    def post(self, request):
        # La cookie de refresco viaja sola: se exige una cabecera propia (no simple) además de SameSite=Strict
        if request.META.get(ENCABEZADO_CSRF) != "1":
            return Response({"codigo": "csrf", "detalle": "Falta la cabecera de verificación."}, status=status.HTTP_403_FORBIDDEN)
        r = servicio.refrescar(request.COOKIES.get(settings.SIGET_COOKIE_REFRESH), _ip(request))
        if not r.ok:
            respuesta = _denegado("sesion_invalida", "La sesión no es válida. Inicia sesión de nuevo.")
            _quitar_cookie(respuesta)
            return respuesta
        return _tokens_en_respuesta(r)


class _Autenticada(APIView):
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "mfa"


@method_decorator(transaction.non_atomic_requests, name="dispatch")
class Logout(_Autenticada):
    permission_classes = [exige_scope(tokens.SCOPE_COMPLETO, tokens.SCOPE_ENROLAR_MFA)]
    throttle_scope = "refresh"

    def post(self, request):
        p = request.user
        servicio.cerrar_sesion(p.pk, p.claims.sesion_id, _ip(request))
        respuesta = Response({"detalle": "Sesión cerrada."})
        _quitar_cookie(respuesta)
        return respuesta


class Yo(_Autenticada):
    permission_classes = [exige_scope(tokens.SCOPE_COMPLETO, tokens.SCOPE_ENROLAR_MFA)]
    throttle_scope = "refresh"

    def get(self, request):
        u = request.user.usuario
        roles = list(Membresia.objects.filter(usuario=u).values("institucion_id", "rol"))
        return Response({
            "id": u.pk, "usuario": u.username, "scope": request.user.claims.scope,
            "rol_plataforma": u.rol_plataforma, "membresias": roles,
            "mfa_activo": u.mfa_activo, "mfa_obligatorio": servicio.mfa_obligatorio(u, [r["rol"] for r in roles]),
            "mfa_verificado_en": u.mfa_verificado_en, "nivel_aseguramiento": u.nivel_aseguramiento,
        })


@method_decorator(transaction.non_atomic_requests, name="dispatch")
class MfaEnrolar(_Autenticada):
    permission_classes = [exige_scope(tokens.SCOPE_COMPLETO, tokens.SCOPE_ENROLAR_MFA)]

    def post(self, request):
        r = servicio.enrolar_mfa(request.user.usuario, _ip(request))
        if not r.ok:
            return Response({"codigo": r.codigo, "detalle": "El segundo factor ya está activo."}, status=status.HTTP_409_CONFLICT)
        # El secreto se muestra UNA sola vez; después solo existe cifrado en la base
        return Response({"secreto": r.detalle["secreto"], "uri": r.detalle["uri"]}, status=status.HTTP_201_CREATED)


@method_decorator(transaction.non_atomic_requests, name="dispatch")
class MfaConfirmar(_Autenticada):
    permission_classes = [exige_scope(tokens.SCOPE_COMPLETO, tokens.SCOPE_ENROLAR_MFA)]

    def post(self, request):
        p = request.user
        r = servicio.confirmar_mfa(p.usuario, _campo(request, "codigo"), p.claims.sesion_id, _ip(request))
        if not r.ok:
            return _denegado(r.codigo, "Código inválido o ya usado.", status.HTTP_400_BAD_REQUEST if r.codigo != "mfa_ya_activo" else status.HTTP_409_CONFLICT)
        return _tokens_en_respuesta(r)


@method_decorator(transaction.non_atomic_requests, name="dispatch")
class MfaVerificar(_Autenticada):
    """Reautenticación escalonada: renueva la vigencia del segundo factor para las acciones sensibles."""

    permission_classes = [exige_scope(tokens.SCOPE_COMPLETO)]

    def post(self, request):
        r = servicio.verificar_mfa(request.user.usuario, _campo(request, "codigo"), _ip(request))
        if not r.ok:
            return _denegado(r.codigo, "Código inválido o ya usado.", status.HTTP_400_BAD_REQUEST)
        return Response({"detalle": "Segundo factor verificado."})
