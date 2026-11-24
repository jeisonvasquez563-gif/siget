"""Cambio de contraseña desde la sesión: regla del PDP, matriz, simulador, ruta y límite de tasa.

Sin base de datos: el recorrido real (contraseña actual, bloqueo progresivo, cierre de las demás sesiones) lo hace `verificar_autenticacion`.
"""
from datetime import datetime, timedelta, timezone

import pytest
from django.conf import settings
from django.urls import resolve, reverse

from apps.autenticacion import vistas
from apps.autorizacion import matriz, simulador
from apps.autorizacion.pdp import Accion, Entorno, Recurso, Sujeto, decidir

AHORA = datetime(2026, 11, 24, 12, 0, tzinfo=timezone.utc)
ROLES_PLATAFORMA = [r[0] for r in matriz.ROLES[4:]]


def sujeto(id=10, minutos=2, **kw):
    return Sujeto(id=id, mfa_verificado_en=None if minutos is None else AHORA - timedelta(minutes=minutos), **kw)


def cuenta(de=10):
    return Recurso(tipo="cuenta", solicitante_id=de)


def decide(s, r):
    return decidir(s, Accion.CAMBIAR_CONTRASENA, r, Entorno(ahora=AHORA))


def test_la_persona_cambia_su_propia_contrasena_con_segundo_factor_reciente():
    d = decide(sujeto(), cuenta())
    assert d.permitido and d.politica == "titular_cambia_su_contrasena"


def test_no_la_de_otra_persona():
    assert not decide(sujeto(), cuenta(de=11)).permitido


@pytest.mark.parametrize("minutos", [None, 16, 600])
def test_sin_segundo_factor_reciente_se_niega(minutos):
    assert not decide(sujeto(minutos=minutos), cuenta()).permitido


@pytest.mark.parametrize("rol", ROLES_PLATAFORMA)
def test_las_cuentas_de_plataforma_tambien_cambian_la_suya_y_solo_la_suya(rol):
    s = sujeto(rol_plataforma=rol, nivel_aseguramiento=3)
    assert decide(s, cuenta()).permitido
    assert not decide(s, cuenta(de=11)).permitido


def test_el_personal_de_una_institucion_tambien_la_cambia():
    assert decide(sujeto(membresias=frozenset({(3, "funcionario")})), cuenta()).permitido


def test_una_cuenta_bloqueada_o_suspendida_no_la_cambia():
    for estado in ("bloqueada", "suspendida"):
        d = decide(sujeto(estado_cuenta=estado), cuenta())
        assert not d.permitido and d.politica == "cuenta_no_activa"


def test_otro_tipo_de_recurso_no_sirve():
    assert not decide(sujeto(), Recurso(tipo="perfil", solicitante_id=10)).permitido


def test_la_matriz_la_calcula_para_los_diez_roles():
    M = matriz.construir()
    assert len(M["acciones"]) == len(Accion) == 27
    for rol in M["matriz"].values():
        celda = rol["cambiar_contrasena"]
        assert celda["favorable"]["permitido"] and not celda["desfavorable"]["permitido"] and celda["exige_segundo_factor"] is True
    assert next(a for a in M["acciones"] if a["id"] == "cambiar_contrasena")["grupo"] == "Cuenta"
    assert M["ningun_rol_puede_todo"] is True


def test_el_simulador_la_conoce_y_explica_el_resultado():
    assert len(simulador.meta()["variables"]) == 27
    entrada, errores = simulador.normalizar({"rol": "auditor", "accion": "cambiar_contrasena", "segundo_factor": "vencido"})
    assert errores == []
    r = simulador.simular(entrada, AHORA)
    assert r["decision"]["permitido"] is False
    assert {"variable": "segundo_factor", "valor": "reciente"}.items() <= next(a for a in r["alternativas"] if a["variable"] == "segundo_factor").items()
    ok = simulador.simular(simulador.normalizar({"rol": "ciudadano", "accion": "cambiar_contrasena"})[0], AHORA)
    assert ok["decision"]["politica"] == "titular_cambia_su_contrasena"
    assert simulador.normalizar({"rol": "ciudadano", "accion": "cambiar_contrasena", "cuenta_de": "alguien"})[0] is None


def test_la_ruta_exige_sesion_completa_y_no_corre_en_una_transaccion():
    url = reverse("contrasena")
    assert url == "/auth/contrasena/"
    clase = resolve(url).func.cls
    assert clase is vistas.CambiarContrasena
    assert [c.__name__ for c in clase.permission_classes] == ["_ExigeScope"]
    assert clase.as_view()._non_atomic_requests  # los intentos fallidos deben guardarse aunque la respuesta sea 400


def test_tiene_su_propio_limite_de_cinco_por_hora():
    assert settings.REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"]["contrasena"] == "5/hour"
    assert vistas.CambiarContrasena.throttle_classes == [vistas.TasaDeCambioDeContrasena]
    assert vistas.TasaDeCambioDeContrasena.scope == "contrasena"
