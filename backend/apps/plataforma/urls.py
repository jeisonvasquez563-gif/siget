from django.urls import path

from . import vistas

urlpatterns = [
    path("personas/", vistas.Personas.as_view(), name="plataforma-personas"),
    path("personas/<int:pk>/restablecer-contrasena/", vistas.PersonaRestablecerContrasena.as_view(), name="plataforma-restablecer-contrasena"),
    path("personas/<int:pk>/restablecer-mfa/", vistas.PersonaRestablecerMfa.as_view(), name="plataforma-restablecer-mfa"),
    path("personas/<int:pk>/bloquear/", vistas.PersonaBloquear.as_view(), name="plataforma-bloquear"),
    path("personas/<int:pk>/desbloquear/", vistas.PersonaDesbloquear.as_view(), name="plataforma-desbloquear"),
    path("personas/<int:pk>/revocar-sesiones/", vistas.PersonaRevocarSesiones.as_view(), name="plataforma-revocar-sesiones"),
    path("eventos/", vistas.EventosSeguridad.as_view(), name="plataforma-eventos"),
    path("aprobaciones/", vistas.Aprobaciones.as_view(), name="plataforma-aprobaciones"),
    path("aprobaciones/<int:pk>/resolver/", vistas.AprobacionResolver.as_view(), name="plataforma-aprobacion-resolver"),
    path("secretos/", vistas.Secretos.as_view(), name="plataforma-secretos"),
    path("infraestructura/", vistas.Infraestructura.as_view(), name="plataforma-infraestructura"),
]
