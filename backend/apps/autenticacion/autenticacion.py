"""Clase de autenticación de DRF: valida el JWT y comprueba la sesión y la cuenta en CADA petición.

No basta con que el token sea válido: la sesión no puede estar revocada ni vencida, y la cuenta debe
seguir activa. Así un cierre de sesión o un bloqueo del operador de seguridad surte efecto de inmediato
y no cuando venza el token.
"""
from dataclasses import dataclass

from django.conf import settings
from django.core.exceptions import ValidationError
from django.utils import timezone
from rest_framework.authentication import BaseAuthentication
from rest_framework.exceptions import AuthenticationFailed
from rest_framework.permissions import BasePermission

from apps.identidad.models import Usuario

from .models import Sesion
from .tokens import Claims, TokenInvalido, decodificar_access


@dataclass
class Principal:
    usuario: Usuario
    claims: Claims

    is_authenticated = True

    @property
    def pk(self):
        return self.usuario.pk


class AutenticacionJWT(BaseAuthentication):
    def authenticate(self, request):
        cabecera = request.META.get("HTTP_AUTHORIZATION", "")
        if not cabecera:
            return None
        partes = cabecera.split()
        if len(partes) != 2 or partes[0].lower() != "bearer":
            raise AuthenticationFailed("Cabecera de autorización inválida.")
        ahora = timezone.now()
        try:
            claims = decodificar_access(settings.SIGET_JWT_KEY, partes[1], ahora, settings.SIGET_EMISOR)
            sesion_ok = Sesion.objects.filter(pk=claims.sesion_id, usuario_id=claims.usuario_id, revocada=False, expira_en__gt=ahora).exists()
        except (TokenInvalido, ValidationError, ValueError):
            raise AuthenticationFailed("Token inválido o vencido.") from None
        if not sesion_ok:
            raise AuthenticationFailed("Sesión cerrada o vencida.")
        usuario = Usuario.objects.filter(pk=claims.usuario_id).first()
        if usuario is None or usuario.estado_cuenta != "activa":
            raise AuthenticationFailed("Cuenta no activa.")
        return Principal(usuario=usuario, claims=claims), claims

    def authenticate_header(self, request):
        return 'Bearer realm="siget"'


def exige_scope(*scopes):
    """Permiso de DRF: la petición debe traer un token con alguno de estos scopes."""

    class _ExigeScope(BasePermission):
        message = "Este token no sirve para esta operación."

        def has_permission(self, request, view):
            principal = request.user
            return principal is not None and getattr(principal, "claims", None) is not None and principal.claims.scope in scopes

    return _ExigeScope
