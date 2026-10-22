from django.urls import path

from . import vistas

urlpatterns = [
    path("", vistas.Equipo.as_view(), name="equipo"),
    path("<int:institucion>/miembros/", vistas.EquipoAgregar.as_view(), name="equipo-agregar"),
    path("<int:institucion>/miembros/<int:persona>/cambiar-rol/", vistas.EquipoCambiarRol.as_view(), name="equipo-cambiar-rol"),
    path("<int:institucion>/miembros/<int:persona>/quitar/", vistas.EquipoQuitar.as_view(), name="equipo-quitar"),
]
