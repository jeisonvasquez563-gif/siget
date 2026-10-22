from django.urls import path

from . import vistas

urlpatterns = [
    path("", vistas.Equipo.as_view(), name="equipo"),
]
