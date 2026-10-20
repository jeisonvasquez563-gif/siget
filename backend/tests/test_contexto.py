"""Pruebas del contexto RLS. No usan la base de datos."""
from unittest.mock import MagicMock, patch

import pytest
from django.conf import settings

from apps.nucleo.contexto import fijar_contexto, formatear_instituciones


def test_formatea_ordenado_y_sin_duplicados():
    assert formatear_instituciones([3, 1, 3, 2]) == "1,2,3"
    assert formatear_instituciones([]) == ""


@pytest.mark.parametrize("malo", [0, -1, "1", None, 1.5, True, "1,2"])
def test_rechaza_ids_de_institucion_invalidos(malo):
    with pytest.raises(ValueError):
        formatear_instituciones([malo])


@pytest.mark.parametrize("malo", [0, -5, "7", None, True])
def test_rechaza_ids_de_usuario_invalidos(malo):
    with pytest.raises(ValueError):
        fijar_contexto(malo, [1])


def test_fija_el_contexto_solo_para_la_transaccion_actual():
    cursor = MagicMock()
    with patch("apps.nucleo.contexto.connection") as conexion:
        conexion.cursor.return_value.__enter__.return_value = cursor
        fijar_contexto(7, [3, 1])
    sql, parametros = cursor.execute.call_args[0]
    assert "set_config('app.usuario_id', %s, true)" in sql
    assert "set_config('app.instituciones', %s, true)" in sql
    assert parametros == ["7", "1,3"]  # los valores van como parámetros, nunca pegados al SQL


def test_cada_peticion_es_una_transaccion():
    assert settings.DATABASES["default"]["ATOMIC_REQUESTS"] is True
