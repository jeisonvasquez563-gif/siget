from django.urls import path

from . import vistas

urlpatterns = [
    path("", vistas.TramitesColeccion.as_view(), name="tramites"),
    path("<int:pk>/", vistas.TramiteDetalle.as_view(), name="tramite"),
    path("<int:pk>/estado/", vistas.TramiteEstado.as_view(), name="tramite-estado"),
    path("<int:pk>/reasignar/", vistas.TramiteReasignar.as_view(), name="tramite-reasignar"),
    path("<int:pk>/historial/", vistas.TramiteHistorial.as_view(), name="tramite-historial"),
]
