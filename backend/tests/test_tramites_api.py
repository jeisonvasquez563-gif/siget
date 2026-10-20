"""Pruebas de la API de trámites que no usan la base: entrada, salida y la auditoría de rutas."""
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from django.urls import get_resolver, reverse
from rest_framework.permissions import AllowAny

from apps.tramites import serializacion as ser

AHORA = datetime(2026, 10, 20, 12, 0, tzinfo=timezone.utc)


# --------------------------------------------------------------------------- entrada

@pytest.mark.parametrize("valor,esperado", [(1, 1), (42, 42), (2**63 - 1, 2**63 - 1)])
def test_enteros_validos(valor, esperado):
    assert ser.entero_positivo(valor) == esperado


@pytest.mark.parametrize("malo", [0, -1, 2**63, 10**30, True, False, "1", 1.0, 1.5, None, [], {}, "１"])
def test_enteros_invalidos_se_rechazan(malo):
    assert ser.entero_positivo(malo) is None


def test_el_texto_solo_acepta_texto():
    assert ser.texto("a") == "a"
    assert ser.texto(1) is None and ser.texto(None) is None and ser.texto(["a"]) is None


@pytest.mark.parametrize("params,esperado", [
    ({}, (20, 0)), ({"limite": "5"}, (5, 0)), ({"limite": "100", "desplazamiento": "40"}, (100, 40)),
])
def test_paginacion_valida(params, esperado):
    assert ser.paginacion(params) == esperado


@pytest.mark.parametrize("params", [
    {"limite": "0"}, {"limite": "101"}, {"limite": "-1"}, {"limite": "abc"}, {"limite": "1.5"}, {"limite": "１"},
    {"desplazamiento": "-5"}, {"desplazamiento": "99999999"}, {"limite": ""},
])
def test_paginacion_invalida_se_rechaza(params):
    assert ser.paginacion(params) is None


# --------------------------------------------------------------------------- plazos

def test_la_fecha_limite_suma_los_dias_del_plazo():
    assert ser.calcular_fecha_limite(AHORA, 15) == AHORA + timedelta(days=15)


@pytest.mark.parametrize("segundos,estado,vencido", [
    (-1, "Pendiente", True), (0, "Pendiente", False), (1, "Pendiente", False),
    (-1, "En Tramitacion", True), (-1, "En Subsanacion", True),
    (-1, "Aprobado", False), (-1, "Rechazado", False),
])
def test_un_tramite_vence_solo_si_sigue_abierto(segundos, estado, vencido):
    assert ser.esta_vencido(AHORA + timedelta(seconds=segundos), estado, AHORA) is vencido


def test_sin_fecha_limite_no_esta_vencido():
    assert ser.esta_vencido(None, "Pendiente", AHORA) is False


# --------------------------------------------------------------------------- salida

def un_tramite(**kw):
    base = dict(pk=9, tipo_tramite_id=1, tipo_tramite=SimpleNamespace(nombre="Permiso"), institucion_id=3,
                institucion=SimpleNamespace(nombre="MOP"), estado="En Tramitacion", fecha_limite=AHORA + timedelta(days=3),
                creado_en=AHORA, solicitante_id=77, funcionario_asignado_id=88, sensibilidad=2)
    base.update(kw)
    return SimpleNamespace(**base)


def test_el_solicitante_no_ve_datos_de_otras_personas():
    d = ser.tramite_a_dict(un_tramite(), personal=False, ahora=AHORA)
    assert "solicitante_id" not in d and "funcionario_asignado_id" not in d and "sensibilidad" not in d
    assert d["asignado"] is True and d["institucion"]["nombre"] == "MOP" and d["estado"] == "En Tramitacion"


def test_el_personal_ve_el_detalle():
    d = ser.tramite_a_dict(un_tramite(), personal=True, ahora=AHORA)
    assert d["solicitante_id"] == 77 and d["funcionario_asignado_id"] == 88 and d["sensibilidad"] == 2
    assert "asignado" not in d


def test_un_tramite_sin_asignar_se_marca_asi():
    assert ser.tramite_a_dict(un_tramite(funcionario_asignado_id=None), personal=False, ahora=AHORA)["asignado"] is False


def test_el_estado_vencido_se_calcula_al_mostrar():
    d = ser.tramite_a_dict(un_tramite(fecha_limite=AHORA - timedelta(days=1)), personal=False, ahora=AHORA)
    assert d["vencido"] is True


def un_evento():
    return SimpleNamespace(pk=1, accion="cambio_estado", estado_anterior="Pendiente", estado_nuevo="En Tramitacion",
                           institucion_id=3, creado_en=AHORA, actor_id=88, atributos={"secreto_interno": 1})


def test_el_historial_oculta_actor_y_detalle_al_solicitante():
    d = ser.evento_a_dict(un_evento(), personal=False)
    assert "actor_id" not in d and "atributos" not in d
    assert d["estado_anterior"] == "Pendiente" and d["estado_nuevo"] == "En Tramitacion" and d["accion"] == "cambio_estado"


def test_el_historial_muestra_el_actor_al_personal():
    d = ser.evento_a_dict(un_evento(), personal=True)
    assert d["actor_id"] == 88 and d["atributos"] == {"secreto_interno": 1}


# --------------------------------------------------------------------------- auditoría de rutas

# Únicas vistas que pueden ser públicas: se declaran aquí a propósito. Cualquier otra ruta pública es un error.
PUBLICAS = {"salud", "registro", "login", "refresh"}


def todas_las_rutas():
    def recorrer(patrones, prefijo=""):
        for p in patrones:
            if hasattr(p, "url_patterns"):
                yield from recorrer(p.url_patterns, prefijo + str(p.pattern))
            else:
                yield prefijo + str(p.pattern), p
    yield from recorrer(get_resolver().url_patterns)


def clases_de_permiso(vista):
    clase = getattr(vista, "cls", None) or getattr(vista, "view_class", None)
    if clase is not None:
        return list(clase.permission_classes)
    return None


def test_ninguna_ruta_es_publica_salvo_la_lista_explicita():
    rutas = list(todas_las_rutas())
    assert len(rutas) >= 14, "la auditoría debe ver todas las rutas"
    publicas_encontradas = set()
    for ruta, patron in rutas:
        permisos = clases_de_permiso(patron.callback)
        assert permisos is not None, f"{ruta}: no se pudo inspeccionar la vista"
        if any(issubclass(c, AllowAny) for c in permisos):
            publicas_encontradas.add(patron.name)
    assert publicas_encontradas == PUBLICAS, f"rutas públicas inesperadas: {publicas_encontradas ^ PUBLICAS}"


def test_toda_ruta_privada_exige_un_scope_explicito():
    for ruta, patron in todas_las_rutas():
        if patron.name in PUBLICAS:
            continue
        permisos = clases_de_permiso(patron.callback)
        assert any(c.__name__ == "_ExigeScope" for c in permisos), f"{ruta}: no exige un scope"


def test_las_vistas_de_autenticacion_no_son_atomicas_y_las_de_tramites_si():
    from apps.autenticacion import vistas as auth
    from apps.tramites import vistas as tram
    for clase in (auth.Registro, auth.Login, auth.Refresh, auth.Logout, auth.MfaEnrolar, auth.MfaConfirmar, auth.MfaVerificar):
        assert getattr(clase.dispatch, "_non_atomic_requests", None) or clase.as_view()._non_atomic_requests, clase.__name__
    for clase in (tram.TramitesColeccion, tram.TramiteDetalle, tram.TramiteEstado, tram.TramiteReasignar, tram.TramiteHistorial):
        assert not getattr(clase.as_view(), "_non_atomic_requests", None), f"{clase.__name__} debe correr en una transacción (RLS)"


def test_el_cuerpo_de_un_acceso_denegado_conserva_los_booleanos():
    from apps.nucleo.errores import AccesoDenegado, manejador
    cuerpo = {"codigo": "acceso_denegado", "detalle": "No tienes autorización.", "reautenticacion_sugerida": False}
    respuesta = manejador(AccesoDenegado(cuerpo), {})
    assert respuesta.status_code == 403
    assert respuesta.data == cuerpo and respuesta.data["reautenticacion_sugerida"] is False  # no el texto "False"


def test_el_manejador_no_altera_otras_excepciones():
    from rest_framework.exceptions import NotFound
    from apps.nucleo.errores import manejador
    respuesta = manejador(NotFound(), {})
    assert respuesta.status_code == 404 and "codigo" not in respuesta.data


def test_autorizar_niega_con_tipos_reales(monkeypatch):
    from apps.autorizacion import permisos
    from apps.autorizacion.pdp import Accion, Decision, Recurso
    from apps.nucleo.errores import AccesoDenegado
    usuario = SimpleNamespace(pk=1, mfa_activo=True, mfa_verificado_en=None)
    monkeypatch.setattr(permisos, "evaluar", lambda u, a, r: Decision(False, "x"))
    with pytest.raises(AccesoDenegado) as error:
        permisos.autorizar(SimpleNamespace(user=SimpleNamespace(usuario=usuario)), Accion.VER_TRAMITE, Recurso(tipo="tramite"))
    assert error.value.cuerpo["reautenticacion_sugerida"] is True


def test_las_rutas_de_trámites_se_resuelven():
    assert reverse("tramites") == "/tramites/"
    assert reverse("tramite-estado", kwargs={"pk": 5}) == "/tramites/5/estado/"
    assert reverse("tramite-historial", kwargs={"pk": 5}) == "/tramites/5/historial/"
    assert reverse("instituciones") == "/catalogo/instituciones/"
