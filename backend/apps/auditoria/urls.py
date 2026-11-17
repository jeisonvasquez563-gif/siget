from django.urls import path

from . import vistas

urlpatterns = [
    path("resumen/", vistas.Resumen.as_view(), name="auditoria-resumen"),
    path("decisiones/", vistas.Decisiones.as_view(), name="auditoria-decisiones"),
    path("seguridad/", vistas.EventosSeguridad.as_view(), name="auditoria-seguridad"),
    path("tramites/", vistas.EventosTramites.as_view(), name="auditoria-tramites"),
]
