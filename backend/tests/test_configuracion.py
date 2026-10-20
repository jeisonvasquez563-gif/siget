"""Pruebas de la configuración segura y de la API base."""
import os
import subprocess
import sys
from pathlib import Path

from django.conf import settings
from rest_framework.test import APIClient

from apps.autorizacion.permisos import DenegarPorDefecto

BACKEND = Path(__file__).resolve().parent.parent


def test_argon2_es_el_unico_hasher():
    assert settings.PASSWORD_HASHERS == ["django.contrib.auth.hashers.Argon2PasswordHasher"]


def test_la_conexion_a_la_base_verifica_el_certificado():
    opciones = settings.DATABASES["default"]["OPTIONS"]
    assert opciones["sslmode"] == "verify-full"
    assert settings.DATABASES["default"]["USER"] == "app_role"  # nunca un superusuario


def test_el_esquema_siget_es_el_de_busqueda():
    assert "search_path=siget" in settings.DATABASES["default"]["OPTIONS"]["options"]


def test_la_api_niega_por_defecto():
    assert settings.REST_FRAMEWORK["DEFAULT_PERMISSION_CLASSES"] == ["apps.autorizacion.permisos.DenegarPorDefecto"]
    assert DenegarPorDefecto().has_permission(request=None, view=None) is False


def test_sin_clave_secreta_el_arranque_falla():
    entorno = {k: v for k, v in os.environ.items() if not k.startswith("SIGET_")}
    entorno["DJANGO_SETTINGS_MODULE"] = "config.settings"
    resultado = subprocess.run(
        [sys.executable, "-c", "import django; django.setup()"],
        cwd=BACKEND, env=entorno, capture_output=True, text=True,
    )
    assert resultado.returncode != 0
    assert "SIGET_SECRET_KEY" in resultado.stderr


def test_la_clave_secreta_puede_venir_de_un_archivo_secreto(tmp_path):
    archivo = tmp_path / "secreto"
    archivo.write_text("clave-leida-desde-podman-secret\n", encoding="utf-8")
    entorno = {k: v for k, v in os.environ.items() if not k.startswith("SIGET_")}
    entorno.update({"DJANGO_SETTINGS_MODULE": "config.settings", "SIGET_SECRET_KEY_FILE": str(archivo)})
    resultado = subprocess.run(
        [sys.executable, "-c", "import django; django.setup(); from django.conf import settings; print(settings.SECRET_KEY)"],
        cwd=BACKEND, env=entorno, capture_output=True, text=True,
    )
    assert resultado.returncode == 0, resultado.stderr
    assert resultado.stdout.strip() == "clave-leida-desde-podman-secret"


def test_la_salud_es_publica_y_no_toca_la_base():
    respuesta = APIClient().get("/salud/")
    assert respuesta.status_code == 200
    assert respuesta.json() == {"estado": "ok"}


def test_una_ruta_inexistente_no_revela_nada():
    assert APIClient().get("/api/tramites/").status_code == 404
