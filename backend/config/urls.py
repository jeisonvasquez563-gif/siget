from django.urls import include, path

from apps.nucleo.views import salud

urlpatterns = [
    path("salud/", salud, name="salud"),
    path("auth/", include("apps.autenticacion.urls")),
    path("tramites/", include("apps.tramites.urls")),
    path("catalogo/", include("apps.catalogo.urls")),
    path("equipo/", include("apps.identidad.urls")),
    path("auditoria/", include("apps.auditoria.urls")),
]
