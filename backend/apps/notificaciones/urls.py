from django.urls import path

from . import vistas

urlpatterns = [
    path("", vistas.NotificacionesColeccion.as_view(), name="notificaciones"),
    path("leer-todas/", vistas.NotificacionesLeerTodas.as_view(), name="notificaciones-leer-todas"),
    path("<int:pk>/leida/", vistas.NotificacionLeida.as_view(), name="notificacion-leida"),
]
