from django.urls import path

from apps.nucleo.views import salud

urlpatterns = [
    path("salud/", salud, name="salud"),
]
