"""Duración de la sesión: inactividad y tope absoluto (lógica pura)."""
from datetime import datetime, timedelta, timezone

import pytest
from django.conf import settings

from apps.autenticacion import politica_sesion as p

T0 = datetime(2026, 10, 22, 9, 0, tzinfo=timezone.utc)
MAX = 900


def test_un_refresco_reciente_no_esta_inactivo_y_uno_viejo_si():
    assert not p.inactiva(T0, T0 + timedelta(minutes=10), MAX)
    assert not p.inactiva(T0, T0 + timedelta(seconds=MAX), MAX)  # justo en el límite todavía vale
    assert p.inactiva(T0, T0 + timedelta(seconds=MAX + 1), MAX)
    assert p.inactiva(T0, T0 + timedelta(hours=3), MAX)


def test_quien_trabaja_sin_parar_renueva_cada_diez_minutos_sin_quedar_inactivo():
    emitido = T0
    for _ in range(20):  # más de tres horas de trabajo continuo
        ahora = emitido + timedelta(minutes=10)  # el acceso caduca cada 10 minutos
        assert not p.inactiva(emitido, ahora, MAX)
        emitido = ahora


def test_la_renovacion_hereda_el_vencimiento_y_no_se_puede_prolongar_la_sesion():
    ttl = 8 * 3600
    vence = T0 + timedelta(seconds=ttl)
    ahora = T0
    for _ in range(100):  # 100 renovaciones seguidas
        ahora += timedelta(minutes=10)
        nuevo = p.vencimiento_heredado(vence, ahora, ttl)
        assert nuevo <= vence
        vence = nuevo
    assert vence == T0 + timedelta(seconds=ttl)


def test_la_primera_renovacion_no_acorta_una_sesion_recien_creada():
    ttl = 8 * 3600
    assert p.vencimiento_heredado(T0 + timedelta(seconds=ttl), T0 + timedelta(minutes=10), ttl) == T0 + timedelta(seconds=ttl)


def test_la_configuracion_deja_renovar_a_quien_esta_activo():
    assert settings.SIGET_REFRESH_MAX_EDAD_SEGUNDOS > settings.SIGET_ACCESS_TTL_SEGUNDOS
    assert settings.SIGET_INACTIVIDAD_MINUTOS * 60 <= settings.SIGET_REFRESH_MAX_EDAD_SEGUNDOS


def test_los_limites_de_tasa_se_cuentan_en_una_cache_compartida_entre_procesos():
    cache = settings.CACHES["default"]["BACKEND"]
    assert "locmem" not in cache.lower()
