from django.urls import path

from . import vistas

urlpatterns = [
    path("registro/", vistas.Registro.as_view(), name="registro"),
    path("login/", vistas.Login.as_view(), name="login"),
    path("refresh/", vistas.Refresh.as_view(), name="refresh"),
    path("logout/", vistas.Logout.as_view(), name="logout"),
    path("yo/", vistas.Yo.as_view(), name="yo"),
    path("mfa/enrolar/", vistas.MfaEnrolar.as_view(), name="mfa-enrolar"),
    path("mfa/confirmar/", vistas.MfaConfirmar.as_view(), name="mfa-confirmar"),
    path("mfa/verificar/", vistas.MfaVerificar.as_view(), name="mfa-verificar"),
]
