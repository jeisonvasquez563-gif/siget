from django.urls import path

from . import vistas, vistas_institucion

urlpatterns = [
    path("instituciones/", vistas.InstitucionesLista.as_view(), name="instituciones"),
    path("tipos-tramite/", vistas.TiposTramiteLista.as_view(), name="tipos-tramite"),
    # Gestión del catálogo por la coordinación de cada institución (migración 020)
    path("institucion/<int:institucion>/tipos/", vistas_institucion.TiposDeInstitucion.as_view(), name="catalogo-tipos"),
    path("institucion/<int:institucion>/tipos/<int:pk>/", vistas_institucion.TipoDeInstitucion.as_view(), name="catalogo-tipo"),
    path("institucion/<int:institucion>/cambios/", vistas_institucion.CambiosDeInstitucion.as_view(), name="catalogo-cambios"),
]
