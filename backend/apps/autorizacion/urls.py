from django.urls import path

from . import vistas

urlpatterns = [
    path("matriz/", vistas.MatrizPermisos.as_view(), name="politicas-matriz"),
    path("base-de-datos/", vistas.PermisosBaseDeDatos.as_view(), name="politicas-bd"),
]
