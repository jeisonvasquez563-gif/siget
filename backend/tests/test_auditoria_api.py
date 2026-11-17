"""Consola de auditoría: filtros, salida y protección de las rutas (sin base de datos)."""
from datetime import datetime, timezone

import pytest
from django.urls import reverse

from apps.auditoria import serializacion as ser
from apps.auditoria.vistas import Decisiones, EventosSeguridad, EventosTramites, Resumen
from apps.autorizacion.pdp import Accion

ADMITIDOS = ("resultado", "politica", "accion", "actor")
AHORA = datetime(2026, 10, 21, 12, 0, tzinfo=timezone.utc)


def test_sin_filtros_no_se_filtra_nada():
    assert ser.filtros({}, ADMITIDOS) == {}
    assert ser.filtros({"resultado": "", "politica": ""}, ADMITIDOS) == {}


def test_filtros_validos():
    f = ser.filtros({"resultado": "negadas", "politica": "conflicto_de_interes", "accion": "ver_tramite", "actor": "7"}, ADMITIDOS)
    assert f == {"permitido": False, "politica": "conflicto_de_interes", "accion": "ver_tramite", "actor_id": 7}
    assert ser.filtros({"resultado": "permitidas"}, ADMITIDOS) == {"permitido": True}


@pytest.mark.parametrize("params", [
    {"resultado": "todas"}, {"resultado": "True"}, {"politica": "con espacio"}, {"politica": "a;drop"}, {"politica": "A" * 65},
    {"politica": "MAYUS"}, {"accion": "x' or '1'='1"}, {"actor": "-1"}, {"actor": "1.5"}, {"actor": "abc"}, {"actor": "１"},
    {"actor": "9" * 30}, {"actor": "0"},
])
def test_filtros_invalidos_se_rechazan(params):
    assert ser.filtros(params, ADMITIDOS) is None


def test_un_filtro_que_la_consulta_no_admite_se_ignora():
    # El parámetro `politica` no existe en los eventos de seguridad: se ignora, no se pasa al ORM
    assert ser.filtros({"politica": "x", "evento": "login_fallido"}, ("evento", "actor")) == {"evento": "login_fallido"}


def test_decision_a_dict_con_y_sin_actor():
    fila = {"id": 1, "creado_en": AHORA, "actor_id": 5, "actor__username": "ana", "accion": "ver_tramite", "recurso": "tramite",
            "permitido": False, "politica": "sin_regla_que_permita", "atributos": {"motivo": "m", "institucion_id": 3}}
    d = ser.decision_a_dict(fila)
    assert d["actor"] == {"id": 5, "usuario": "ana"} and d["motivo"] == "m" and d["institucion_id"] == 3 and d["permitido"] is False
    assert ser.decision_a_dict({**fila, "actor_id": None, "actor__username": None, "atributos": None})["actor"] is None


def test_eventos_a_dict():
    s = ser.evento_seguridad_a_dict({"id": 1, "creado_en": AHORA, "actor_id": None, "actor__username": None, "evento": "login_fallido", "ip": "1.2.3.4", "detalle": None})
    assert s["actor"] is None and s["detalle"] == {} and s["ip"] == "1.2.3.4"
    t = ser.evento_tramite_a_dict({"id": 1, "creado_en": AHORA, "tramite_id": 9, "institucion_id": 3, "actor_id": 2, "actor__username": "fabio",
                                   "accion": "cambio_estado", "estado_anterior": "Pendiente", "estado_nuevo": "En Tramitacion"})
    assert t["actor"]["usuario"] == "fabio" and t["tramite_id"] == 9


def test_las_columnas_pedidas_nunca_incluyen_secretos():
    # La consola pide columnas concretas: ni el hash de contraseña ni el secreto TOTP se leen jamás
    for vista in (Decisiones, EventosSeguridad, EventosTramites):
        for columna in vista.columnas:
            assert "password" not in columna and "secreto" not in columna and "mfa" not in columna
        assert all(c.startswith("actor__") is False or c == "actor__username" for c in vista.columnas)


def test_cada_consulta_exige_la_accion_de_auditoria_que_le_corresponde():
    assert Decisiones.accion == Accion.CONSULTAR_DECISIONES and Resumen.accion == Accion.CONSULTAR_DECISIONES
    assert EventosSeguridad.accion == Accion.CONSULTAR_AUDITORIA and EventosTramites.accion == Accion.CONSULTAR_AUDITORIA


def test_las_rutas_de_auditoria_se_resuelven():
    assert reverse("auditoria-resumen") == "/auditoria/resumen/"
    assert reverse("auditoria-decisiones") == "/auditoria/decisiones/"
    assert reverse("auditoria-seguridad") == "/auditoria/seguridad/"
    assert reverse("auditoria-tramites") == "/auditoria/tramites/"


def test_la_consola_de_auditoria_lee_con_su_propio_rol_de_base_de_datos():
    from django.conf import settings
    aud, principal = settings.DATABASES["auditoria"], settings.DATABASES["default"]
    assert aud["USER"] == "auditor_role" and principal["USER"] == "app_role"
    assert aud["ATOMIC_REQUESTS"] is False and aud["OPTIONS"]["sslmode"] == "verify-full"
