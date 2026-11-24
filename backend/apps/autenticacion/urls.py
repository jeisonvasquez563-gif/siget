from django.urls import path

from . import vistas, vistas_derechos

urlpatterns = [
    path("registro/", vistas.Registro.as_view(), name="registro"),
    path("configuracion/", vistas.Configuracion.as_view(), name="configuracion"),
    path("aviso-privacidad/", vistas_derechos.AvisoPrivacidad.as_view(), name="aviso-privacidad"),
    path("instituciones/", vistas.InstitucionesPublicas.as_view(), name="instituciones-publicas"),
    path("restablecer/", vistas.RestablecerContrasena.as_view(), name="restablecer"),
    path("login/", vistas.Login.as_view(), name="login"),
    path("refresh/", vistas.Refresh.as_view(), name="refresh"),
    path("logout/", vistas.Logout.as_view(), name="logout"),
    path("yo/", vistas.Yo.as_view(), name="yo"),
    path("actividad/", vistas.Actividad.as_view(), name="actividad"),
    path("mis-datos/", vistas_derechos.MisDatos.as_view(), name="mis-datos"),
    path("mis-datos/exportar/", vistas_derechos.MisDatosExportar.as_view(), name="mis-datos-exportar"),
    path("mis-datos/solicitudes/", vistas_derechos.MisSolicitudes.as_view(), name="mis-datos-solicitudes"),
    path("mfa/enrolar/", vistas.MfaEnrolar.as_view(), name="mfa-enrolar"),
    path("mfa/confirmar/", vistas.MfaConfirmar.as_view(), name="mfa-confirmar"),
    path("mfa/verificar/", vistas.MfaVerificar.as_view(), name="mfa-verificar"),
]
