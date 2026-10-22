"""Simulador de «qué pasaría si…»: decisiones, traza, alternativas y validación (todo sin base de datos)."""
import itertools

import pytest

from apps.autorizacion import pdp, simulador
from apps.autorizacion.pdp import Accion


def sim(**datos):
    entrada, errores = simulador.normalizar(datos)
    assert errores == [], errores
    return simulador.simular(entrada)


def decision(**datos):
    d = sim(**datos)["decision"]
    return d["permitido"], d["politica"]


# --------------------------------------------------------------------------- validación

@pytest.mark.parametrize("datos", [
    None, [], "x", 5, {}, {"rol": "funcionario"}, {"accion": "ver_tramite"},
    {"rol": "dios", "accion": "ver_tramite"}, {"rol": "funcionario", "accion": "todo"}, {"rol": ["funcionario"], "accion": "ver_tramite"},
    {"rol": "funcionario", "accion": ["ver_tramite"]},
])
def test_rol_o_accion_invalidos_se_rechazan(datos):
    entrada, errores = simulador.normalizar(datos)
    assert entrada is None and errores


@pytest.mark.parametrize("variable,valor", [
    ("segundo_factor", "reciente "), ("segundo_factor", "RECIENTE"), ("segundo_factor", 1), ("segundo_factor", True), ("cuenta", "root"),
    ("institucion", None.__class__), ("solicitante", ["yo"]), ("asignado", {"a": 1}),
])
def test_valores_fuera_de_la_lista_se_rechazan(variable, valor):
    entrada, errores = simulador.normalizar({"rol": "funcionario", "accion": "cambiar_estado", variable: valor})
    assert entrada is None and any(variable in e for e in errores)


@pytest.mark.parametrize("nivel", [0, 4, -1, "3", 3.0, True, False, None.__class__])
def test_el_nivel_solo_admite_1_2_o_3_enteros(nivel):
    entrada, errores = simulador.normalizar({"rol": "auditor", "accion": "consultar_auditoria", "nivel": nivel})
    assert entrada is None and errores


def test_las_variables_irrelevantes_se_ignoran_y_las_ausentes_toman_su_valor_por_defecto():
    entrada, _ = simulador.normalizar({"rol": "funcionario", "accion": "ver_tramite", "asignado": "yo", "estado": "Aprobado", "x": 1})
    assert set(entrada) == {"rol", "accion", "institucion", "solicitante", "segundo_factor", "cuenta"}
    assert entrada["segundo_factor"] == "reciente" and entrada["cuenta"] == "activa"


def test_para_la_ciudadania_el_trámite_es_por_defecto_el_suyo_y_el_auditor_parte_de_nivel_3():
    assert simulador.normalizar({"rol": "ciudadano", "accion": "ver_tramite"})[0]["solicitante"] == "yo"
    assert simulador.normalizar({"rol": "funcionario", "accion": "ver_tramite"})[0]["solicitante"] == "otra_persona"
    assert simulador.normalizar({"rol": "auditor", "accion": "consultar_auditoria"})[0]["nivel"] == 3


def test_toda_accion_tiene_sus_variables_y_toda_variable_tiene_valores_y_etiquetas():
    m = simulador.meta()
    assert set(m["variables"]) == {a.value for a in Accion}
    for acciones in m["variables"].values():
        for v in acciones:
            assert v in m["valores"] and v in m["etiquetas"] and v in m["defectos"]
            assert all(x["etiqueta"] for x in m["valores"][v])


# --------------------------------------------------------------------------- decisiones

def test_el_funcionario_cambia_el_estado_de_lo_que_esta_en_cola_de_su_institucion():
    assert decision(rol="funcionario", accion="cambiar_estado") == (True, "funcionario_cambia_estado")


def test_el_mismo_funcionario_no_puede_en_otra_institucion():
    assert decision(rol="funcionario", accion="cambiar_estado", institucion="ajena") == (False, "sin_regla_que_permita")


def test_nadie_gestiona_un_trámite_que_el_mismo_pidio_conflicto_de_interes():
    assert decision(rol="funcionario", accion="cambiar_estado", solicitante="yo") == (False, "conflicto_de_interes")
    assert decision(rol="supervisor", accion="cambiar_estado", solicitante="yo") == (False, "conflicto_de_interes")
    assert decision(rol="supervisor", accion="reasignar_tramite", solicitante="yo") == (False, "conflicto_de_interes")
    # ver el propio trámite sí se puede: lo hace como ciudadano
    assert decision(rol="supervisor", accion="ver_tramite", solicitante="yo") == (True, "ciudadano_sobre_lo_propio")


@pytest.mark.parametrize("factor", ["vencido", "ninguno"])
def test_cambiar_un_trámite_exige_segundo_factor_reciente(factor):
    assert decision(rol="funcionario", accion="cambiar_estado", segundo_factor=factor)[0] is False


def test_ver_un_trámite_del_personal_no_exige_segundo_factor_reciente():
    assert decision(rol="funcionario", accion="ver_tramite", segundo_factor="vencido") == (True, "personal_ve_su_institucion")


def test_el_funcionario_no_mueve_lo_asignado_a_otro_pero_el_supervisor_si():
    assert decision(rol="funcionario", accion="cambiar_estado", asignado="otra_persona")[0] is False
    assert decision(rol="funcionario", accion="cambiar_estado", asignado="yo") == (True, "funcionario_cambia_estado")
    assert decision(rol="supervisor", accion="cambiar_estado", asignado="otra_persona") == (True, "supervisor_cambia_estado")


def test_una_transicion_que_se_salta_un_paso_se_niega():
    assert decision(rol="supervisor", accion="cambiar_estado", estado="Pendiente", estado_destino="Aprobado")[0] is False
    assert decision(rol="supervisor", accion="cambiar_estado", estado="Pendiente", estado_destino="En Tramitacion")[0] is True
    assert decision(rol="supervisor", accion="cambiar_estado", estado="Aprobado", estado_destino="Rechazado")[0] is False  # estado final


def test_un_rol_de_plataforma_no_ve_trámites():
    for rol in ("operador_infraestructura", "operador_seguridad", "auditor"):
        assert decision(rol=rol, accion="ver_tramite") == (False, "plataforma_sin_acceso_a_tramites")


@pytest.mark.parametrize("cuenta", ["bloqueada", "suspendida"])
def test_una_cuenta_que_no_esta_activa_no_puede_nada(cuenta):
    for rol, accion in (("ciudadano", "crear_tramite"), ("supervisor", "reasignar_tramite"), ("operador_seguridad", "bloquear_cuenta")):
        assert decision(rol=rol, accion=accion, cuenta=cuenta) == (False, "cuenta_no_activa")


def test_el_control_dual_impide_aprobar_el_alta_propia():
    assert decision(rol="operador_identidades", accion="aprobar_alta", tipo_alta="alta_coordinador", alta_propuesta_por="yo") == (False, "control_dual")
    assert decision(rol="operador_identidades", accion="aprobar_alta", tipo_alta="alta_coordinador", alta_propuesta_por="otra_persona")[0] is True
    # y cada operador solo gestiona su tipo de alta
    assert decision(rol="operador_identidades", accion="aprobar_alta", tipo_alta="alta_institucion")[0] is False


def test_el_auditor_necesita_nivel_3():
    assert decision(rol="auditor", accion="consultar_auditoria", nivel=2)[0] is False
    assert decision(rol="auditor", accion="consultar_auditoria", nivel=3)[0] is True


def test_la_ciudadania_sin_segundo_factor_no_puede_ni_lo_suyo_porque_es_obligatorio():
    assert decision(rol="ciudadano", accion="ver_tramite")[0] is True
    assert decision(rol="ciudadano", accion="ver_tramite", segundo_factor="ninguno")[0] is False
    assert decision(rol="ciudadano", accion="ver_tramite", solicitante="otra_persona")[0] is False


# --------------------------------------------------------------------------- alternativas

def alternativas(**datos):
    return {(a["variable"], a["valor"]): a for a in sim(**datos)["alternativas"]}


def test_si_se_niega_por_el_factor_vencido_la_alternativa_dice_que_con_uno_reciente_se_permitiria():
    alt = alternativas(rol="funcionario", accion="cambiar_estado", segundo_factor="vencido")
    assert alt[("segundo_factor", "reciente")]["permitido"] is True
    assert ("institucion", "ajena") not in alt  # eso no lo arregla (ya estaba negado)


def test_si_se_permite_las_alternativas_muestran_que_lo_romperia():
    alt = alternativas(rol="funcionario", accion="cambiar_estado")
    assert alt[("segundo_factor", "vencido")]["permitido"] is False
    assert alt[("institucion", "ajena")]["permitido"] is False
    assert alt[("solicitante", "yo")]["politica"] == "conflicto_de_interes"
    assert alt[("cuenta", "bloqueada")]["politica"] == "cuenta_no_activa"
    assert alt[("asignado", "otra_persona")]["permitido"] is False
    assert all(a["permitido"] is False for a in alt.values())


def test_las_alternativas_solo_incluyen_cambios_que_invierten_el_resultado():
    for rol, accion in itertools.product(("funcionario", "supervisor", "ciudadano"), ("ver_tramite", "cambiar_estado")):
        r = sim(rol=rol, accion=accion)
        for a in r["alternativas"]:
            assert a["permitido"] != r["decision"]["permitido"]


# --------------------------------------------------------------------------- traza

def test_la_traza_muestra_las_reglas_evaluadas_en_orden():
    traza = sim(rol="funcionario", accion="cambiar_estado")["traza"]
    assert [p["fase"] for p in traza][:4] == ["denegacion"] * 4
    assert traza[-1]["resultado"] == "permite" and traza[-1]["politica"] == "funcionario_cambia_estado"
    assert all(p["resultado"] == "no_aplica" for p in traza[:4])


def test_si_una_denegacion_se_cumple_la_traza_se_detiene_ahi():
    traza = sim(rol="funcionario", accion="cambiar_estado", solicitante="yo")["traza"]
    assert traza[-1] == {"fase": "denegacion", "regla": "Nadie gestiona un trámite que él mismo pidió", "resultado": "niega",
                         "politica": "conflicto_de_interes", "motivo": traza[-1]["motivo"]}
    assert all(p["fase"] == "denegacion" for p in traza)


def test_si_ninguna_regla_permite_la_traza_termina_en_denegar_por_defecto():
    traza = sim(rol="funcionario", accion="cambiar_estado", institucion="ajena")["traza"]
    assert traza[-1]["fase"] == "final" and traza[-1]["politica"] == "sin_regla_que_permita"
    assert [p["resultado"] for p in traza if p["fase"] == "permiso"] == ["no_aplica"] * len(pdp.PERMISOS)


def test_la_traza_siempre_coincide_con_la_decision_del_pdp_en_un_barrido_completo():
    """Propiedad: para cientos de combinaciones, el veredicto de la traza es el de `decidir()`. Si alguien tocara el motor y la
    traza se desfasara, esta prueba lo detecta."""
    combinaciones = 0
    for rol, _n, *_ in __import__("apps.autorizacion.matriz", fromlist=["ROLES"]).ROLES:
        for accion in Accion:
            variables = simulador.VARIABLES_POR_ACCION[accion]
            base = simulador.normalizar({"rol": rol, "accion": accion.value})[0]
            elegidas = [v for v in variables if v in ("segundo_factor", "cuenta", "institucion", "solicitante", "asignado", "alta_propuesta_por", "tipo_alta", "nivel")]
            for valores in itertools.product(*[simulador.VALORES[v] for v in elegidas]):
                entrada = {**base, **dict(zip(elegidas, valores))}
                r = simulador.simular(entrada)
                ultimo = r["traza"][-1]
                assert (ultimo["resultado"] == "permite") == r["decision"]["permitido"], entrada
                assert ultimo["politica"] == r["decision"]["politica"], entrada
                combinaciones += 1
    assert combinaciones > 3000


def test_el_simulador_no_toca_la_base_de_datos():
    # Sin el marcador `django_db`, pytest-django bloquea cualquier acceso a la base: si el simulador la usara, fallaría.
    assert sim(rol="supervisor", accion="reasignar_tramite")["hipotetico"] is True


def test_un_fallo_del_pdp_se_refleja_como_denegacion(monkeypatch):
    def roto(*_a):
        raise RuntimeError("boom")
    monkeypatch.setattr(pdp, "DENEGACIONES", [roto])
    r = sim(rol="funcionario", accion="ver_tramite")
    assert r["decision"] == {"permitido": False, "politica": "fallo_del_pdp", "motivo": "RuntimeError"}
    assert r["traza"][-1]["politica"] == "fallo_del_pdp"
