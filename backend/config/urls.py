from django.urls import include, path

from apps.nucleo.views import salud

urlpatterns = [
    path("salud/", salud, name="salud"),
    path("auth/", include("apps.autenticacion.urls")),
]
