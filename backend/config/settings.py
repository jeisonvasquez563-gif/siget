"""Configuración de SIGET.

Zero Trust desde el arranque: nada de secretos en el código (se leen de variables de entorno o de
archivos montados por `podman secret`), todo se deniega por defecto y la conexión a la base de datos
va por TLS verificando el certificado del servidor.
"""
import os
from pathlib import Path

from django.core.exceptions import ImproperlyConfigured

BASE_DIR = Path(__file__).resolve().parent.parent


def _leer(nombre, defecto=None, obligatorio=False):
    """Lee `NOMBRE`, o el contenido del archivo indicado en `NOMBRE_FILE` (podman secret)."""
    ruta = os.environ.get(f"{nombre}_FILE")
    if ruta:
        return Path(ruta).read_text(encoding="utf-8").strip()
    valor = os.environ.get(nombre, defecto)
    if obligatorio and not valor:
        raise ImproperlyConfigured(f"Falta la configuración obligatoria {nombre} (o {nombre}_FILE).")
    return valor


def _bool(nombre, defecto=False):
    return os.environ.get(nombre, str(defecto)).strip().lower() in {"1", "true", "si", "sí", "yes"}


DEBUG = _bool("SIGET_DEBUG", False)
SECRET_KEY = _leer("SIGET_SECRET_KEY", obligatorio=True)
ALLOWED_HOSTS = [h.strip() for h in os.environ.get("SIGET_ALLOWED_HOSTS", "").split(",") if h.strip()]

INSTALLED_APPS = [
    "rest_framework",
    "apps.nucleo",
    "apps.catalogo",
    "apps.identidad",
    "apps.tramites",
    "apps.auditoria",
    "apps.autorizacion",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.middleware.common.CommonMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# --- Base de datos: PostgreSQL con TLS verificado y esquema `siget` ---
DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": os.environ.get("SIGET_DB_NAME", "tramites_demo"),
        "USER": os.environ.get("SIGET_DB_USER", "app_role"),
        "PASSWORD": _leer("SIGET_DB_PASSWORD", ""),
        "HOST": os.environ.get("SIGET_DB_HOST", "192.168.100.20"),
        "PORT": os.environ.get("SIGET_DB_PORT", "5433"),
        "CONN_MAX_AGE": 0,
        # Cada petición es una transacción: el contexto RLS (set_config local) muere con ella.
        "ATOMIC_REQUESTS": True,
        "OPTIONS": {
            "sslmode": "verify-full",
            "sslrootcert": os.environ.get("SIGET_DB_SSLROOTCERT", "/etc/pki/siget/ca.crt"),
            "options": "-c search_path=siget,public",
        },
    }
}

# --- Contraseñas: Argon2 primero ---
PASSWORD_HASHERS = ["django.contrib.auth.hashers.Argon2PasswordHasher"]

# --- API: se deniega todo salvo lo que una política permita explícitamente ---
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [],
    "DEFAULT_PERMISSION_CLASSES": ["apps.autorizacion.permisos.DenegarPorDefecto"],
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    "DEFAULT_THROTTLE_CLASSES": ["rest_framework.throttling.AnonRateThrottle"],
    "DEFAULT_THROTTLE_RATES": {"anon": "60/min"},
    "UNAUTHENTICATED_USER": None,
}

# --- Parámetros de la política de acceso (ver docs/superpowers/specs/2026-10-20-motor-abac-design.md) ---
SIGET_MFA_RECIENTE_MINUTOS = int(os.environ.get("SIGET_MFA_RECIENTE_MINUTOS", "15"))
SIGET_MFA_CIUDADANO_OBLIGATORIO = _bool("SIGET_MFA_CIUDADANO_OBLIGATORIO", True)

# --- Cabeceras y cookies seguras (en producción detrás de nginx con TLS) ---
if not DEBUG:
    SECURE_SSL_REDIRECT = _bool("SIGET_SSL_REDIRECT", True)
    SECURE_HSTS_SECONDS = 31536000
    SECURE_HSTS_INCLUDE_SUBDOMAINS = True
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SECURE_CONTENT_TYPE_NOSNIFF = True
X_FRAME_OPTIONS = "DENY"
SECURE_REFERRER_POLICY = "same-origin"

LANGUAGE_CODE = "es"
TIME_ZONE = "America/Panama"
USE_TZ = True

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {"simple": {"format": "%(asctime)s %(levelname)s %(name)s %(message)s"}},
    "handlers": {"consola": {"class": "logging.StreamHandler", "formatter": "simple"}},
    "root": {"handlers": ["consola"], "level": os.environ.get("SIGET_LOG_LEVEL", "INFO")},
}
