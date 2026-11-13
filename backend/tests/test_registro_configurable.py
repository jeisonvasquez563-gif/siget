"""Registro configurable (PT-2): modos abierto / invitación / cerrado, configuración pública y validación de la configuración.
Lo que necesita la base (gastar una invitación, que no se reutilice) se prueba en verificar_autenticacion contra PostgreSQL."""
import os
import secrets
import subprocess
import sys
from pathlib import Path

import pytest
from django.test import override_settings
from rest_framework.test import APIClient

from apps.autenticacion import servicio

BACKEND = Path(__file__).resolve().parent.parent
# Contraseña válida generada al ejecutar: no queda ninguna escrita en el código (Gitleaks)
CLAVE = "Prueba-" + secrets.token_urlsafe(18)
DATOS = {"nombre": "Ana", "apellidos": "Pérez", "cedula": "8-123-456", "fecha_nacimiento": "1990-01-01",
         "provincia": "Panamá", "ciudad": "Panamá", "correo": "ana@example.com"}


@pytest.fixture
def eventos(monkeypatch):
    registrados = []
    monkeypatch.setattr(servicio, "registrar_evento", lambda actor, evento, ip, detalle=None: registrados.append((evento, detalle)))
    return registrados


def test_con_el_registro_cerrado_no_se_crea_nada_y_queda_el_evento(eventos, monkeypatch):
    monkeypatch.setattr(servicio.Usuario.objects, "create", lambda **kw: pytest.fail("no debe crear la cuenta"))
    r = servicio.registrar_usuario("ana.nueva", CLAVE, "10.0.0.1", DATOS, modo="cerrado")
    assert (r.ok, r.codigo) == (False, "registro_cerrado")
    assert eventos == [("registro_rechazado", {"motivo": "registro_cerrado"})]


def test_con_invitacion_los_datos_se_validan_antes_que_el_codigo(eventos, monkeypatch):
    # si los datos son inválidos ni siquiera se consulta la invitación: un error de formulario no la gasta
    monkeypatch.setattr(servicio.Invitacion.objects, "select_for_update", lambda: pytest.fail("no debe tocar la invitación"))
    r = servicio.registrar_usuario("ana.nueva", "corta", "10.0.0.1", DATOS, modo="invitacion", invitacion="AAAA-BBBB-CCCC")
    assert (r.ok, r.codigo) == (False, "datos_invalidos")


@pytest.mark.parametrize("codigo", [None, "", "no-es-un-codigo", "AAAA-BBBB", 12345, ["AAAA-BBBB-CCCC"]])
def test_una_invitacion_mal_formada_se_rechaza_sin_consultar_la_base(eventos, monkeypatch, codigo):
    monkeypatch.setattr(servicio.Invitacion.objects, "select_for_update", lambda: pytest.fail("no debe consultar"))
    monkeypatch.setattr(servicio.transaction, "atomic", lambda: _SinTransaccion())
    r = servicio.registrar_usuario("ana.nueva", CLAVE, "10.0.0.1", DATOS, modo="invitacion", invitacion=codigo)
    assert (r.ok, r.codigo) == (False, "invitacion_invalida")
    assert eventos[-1][0] == "registro_rechazado" and eventos[-1][1]["motivo"] == "invitacion_invalida"


class _SinTransaccion:
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def test_una_nota_de_invitacion_demasiado_larga_se_rechaza(eventos):
    r = servicio.emitir_invitacion(object(), "x" * 121, "10.0.0.1")
    assert (r.ok, r.codigo) == (False, "datos_invalidos")


@pytest.mark.parametrize("modo,aviso", [("abierto", False), ("invitacion", True), ("cerrado", False)])
def test_la_configuracion_publica_dice_el_modo_y_el_aviso(modo, aviso):
    with override_settings(SIGET_REGISTRO=modo, SIGET_AVISO_DEMOSTRACION=aviso, ALLOWED_HOSTS=["localhost"]):
        r = APIClient().get("/auth/configuracion/", secure=True, HTTP_HOST="localhost")
    assert r.status_code == 200
    assert r.json() == {"registro": modo, "aviso_demostracion": aviso}


def test_con_el_registro_cerrado_la_api_responde_403_sin_crear_nada(eventos):
    with override_settings(SIGET_REGISTRO="cerrado", ALLOWED_HOSTS=["localhost"]):
        r = APIClient().post("/auth/registro/", {"username": "ana.nueva", "password": CLAVE, **DATOS},
                             format="json", secure=True, HTTP_HOST="localhost")
    assert r.status_code == 403 and r.json()["codigo"] == "registro_cerrado"


def _arrancar(**entorno):
    base = {k: v for k, v in os.environ.items() if k not in ("SIGET_REGISTRO", "SIGET_INVITACION_DIAS")}
    base.update(DJANGO_SETTINGS_MODULE="config.settings_test", **entorno)
    return subprocess.run([sys.executable, "-c", "import django; django.setup()"], cwd=BACKEND, env=base,
                          capture_output=True, text=True, timeout=60)


@pytest.mark.parametrize("valor", ["invitación", "si", "", "cerrado;abierto"])
def test_un_modo_de_registro_invalido_no_deja_arrancar(valor):
    r = _arrancar(SIGET_REGISTRO=valor)
    assert r.returncode != 0 and "SIGET_REGISTRO" in r.stderr


@pytest.mark.parametrize("dias", ["0", "31", "-1"])
def test_una_vigencia_de_invitacion_fuera_de_rango_no_deja_arrancar(dias):
    r = _arrancar(SIGET_INVITACION_DIAS=dias)
    assert r.returncode != 0 and "SIGET_INVITACION_DIAS" in r.stderr
