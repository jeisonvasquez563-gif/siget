from django.urls import path

from . import vistas

urlpatterns = [
    path("instituciones/", vistas.InstitucionesLista.as_view(), name="instituciones"),
    path("tipos-tramite/", vistas.TiposTramiteLista.as_view(), name="tipos-tramite"),
]
