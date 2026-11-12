"""Pruebas del escalamiento automático sin base de datos: el comando y la configuración restringida del temporizador.
La función siget.escalar_vencidos() se prueba contra PostgreSQL en database/pruebas-escalamiento.sql."""
import os
import subprocess
import sys
from io import StringIO
from pathlib import Path

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import OperationalError

from apps.nucleo.management.commands import escalar_vencidos

BACKEND = Path(__file__).resolve().parent.parent


class _Cursor:
    def __init__(self, resultado=None, error=None):
        self.resultado, self.error, self.sql = resultado, error, None

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql):
        if self.error:
            raise self.error
        self.sql = sql

    def fetchone(self):
        return (self.resultado,)


class _Conexion:
    def __init__(self, cursor):
        self._cursor = cursor

    def cursor(self):
        return self._cursor


def _con(monkeypatch, cursor):
    usadas = []

    class _Conexiones(dict):
        def __getitem__(self, alias):
            usadas.append(alias)
            return _Conexion(cursor)

    monkeypatch.setattr(escalar_vencidos, "connections", _Conexiones())
    return usadas


def test_el_comando_usa_la_conexion_del_escalador_y_solo_llama_a_la_funcion(monkeypatch):
    cursor = _Cursor(resultado=3)
    usadas = _con(monkeypatch, cursor)
    salida = StringIO()
    call_command("escalar_vencidos", stdout=salida)
    assert usadas == ["escalador"]
    assert cursor.sql == "SELECT siget.escalar_vencidos()"
    assert "3 trámite(s) escalado(s)" in salida.getvalue()


def test_un_error_de_la_base_falla_sin_filtrar_detalles(monkeypatch):
    _con(monkeypatch, _Cursor(error=OperationalError("password authentication failed for user escalador_role: secreto")))
    with pytest.raises(CommandError) as error:
        call_command("escalar_vencidos", stdout=StringIO())
    assert "secreto" not in str(error.value) and "OperationalError" in str(error.value)


def _importar_configuracion(**extra):
    entorno = {k: v for k, v in os.environ.items() if not k.startswith("SIGET_") and k != "DJANGO_SETTINGS_MODULE"}
    entorno.update(DJANGO_SETTINGS_MODULE="config.settings_escalador", **extra)
    return subprocess.run([sys.executable, "-c", "import django; django.setup(); from django.conf import settings; "
                           "print(settings.DATABASES['escalador']['USER'])"],
                          cwd=BACKEND, env=entorno, capture_output=True, text=True, timeout=60)


def test_el_temporizador_arranca_sin_las_claves_reales():
    r = _importar_configuracion()
    assert r.returncode == 0, r.stderr
    assert r.stdout.strip() == "escalador_role"


@pytest.mark.parametrize("clave", ["SIGET_JWT_KEY", "SIGET_MFA_KEY_FILE", "SIGET_SECRET_KEY"])
def test_el_temporizador_se_niega_a_recibir_claves_reales(clave):
    r = _importar_configuracion(**{clave: "x" * 40})
    assert r.returncode != 0 and "no debe llegar al temporizador" in r.stderr
