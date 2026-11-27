from django.urls import path

from . import vistas

urlpatterns = [
    path("", vistas.TramitesColeccion.as_view(), name="tramites"),
    path("<int:pk>/", vistas.TramiteDetalle.as_view(), name="tramite"),
    path("<int:pk>/estado/", vistas.TramiteEstado.as_view(), name="tramite-estado"),
    path("<int:pk>/subsanacion/", vistas.TramiteSubsanacion.as_view(), name="tramite-subsanacion"),
    path("<int:pk>/desistir/", vistas.TramiteDesistir.as_view(), name="tramite-desistir"),
    path("<int:pk>/constancia/", vistas.TramiteConstancia.as_view(), name="tramite-constancia"),
    path("<int:pk>/reasignar/", vistas.TramiteReasignar.as_view(), name="tramite-reasignar"),
    path("<int:pk>/historial/", vistas.TramiteHistorial.as_view(), name="tramite-historial"),
    path("<int:pk>/documentos/", vistas.TramiteDocumentos.as_view(), name="tramite-documentos"),
    path("<int:pk>/documentos/<int:documento_id>/", vistas.DocumentoDescarga.as_view(), name="tramite-documento"),
]
