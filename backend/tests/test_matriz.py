"""La matriz de roles y permisos sale del propio PDP: estas pruebas fijan qué debe mostrar y que no pueda mentir."""
import pytest

from apps.autorizacion import matriz, pdp
from apps.autorizacion.pdp import Accion

M = matriz.construir()


def celda(rol, accion, caso="favorable"):
    return M["matriz"][rol][accion.value][caso]


def test_cubre_a_los_diez_roles_y_a_todas_las_acciones_del_pdp():
    assert [r["id"] for r in M["roles"]] == [r[0] for r in matriz.ROLES] and len(M["roles"]) == 10
    # Si alguien agrega una Accion al PDP y no la documenta en la matriz, esta prueba falla
    assert {a["id"] for a in M["acciones"]} == {a.value for a in Accion}
    for rol in M["matriz"].values():
        assert set(rol) == {a.value for a in Accion}


def test_no_existe_un_superusuario_ningun_rol_puede_todo():
    assert M["ningun_rol_puede_todo"] is True
    for r in M["roles"]:
        assert r["acciones_permitidas"] < r["acciones_totales"], r["id"]


def test_toda_accion_la_puede_hacer_al_menos_un_rol():
    for a in Accion:
        assert any(M["matriz"][r][a.value]["favorable"]["permitido"] for r in M["matriz"]), f"nadie puede {a.value}"


def test_la_prueba_detecta_un_superusuario_si_alguien_lo_introdujera(monkeypatch):
    monkeypatch.setattr(pdp, "PERMISOS", [*pdp.PERMISOS, lambda s, a, r, e: pdp.Decision(True, "dios")])
    # el superusuario no se salta las denegaciones, pero cualquier regla que permita todo se nota en la matriz
    peligrosa = matriz.construir()
    assert max(r["acciones_permitidas"] for r in peligrosa["roles"]) > max(r["acciones_permitidas"] for r in M["roles"])


@pytest.mark.parametrize("rol", [r[0] for r in matriz.ROLES[4:]])
def test_un_rol_de_plataforma_nunca_toca_tramites_ni_documentos(rol):
    for a in (Accion.VER_TRAMITE, Accion.CREAR_TRAMITE, Accion.CAMBIAR_ESTADO, Accion.REASIGNAR_TRAMITE, Accion.ESCALAR_TRAMITE, Accion.ADJUNTAR_DOCUMENTO, Accion.VER_DOCUMENTO):
        for caso in ("favorable", "desfavorable"):
            c = celda(rol, a, caso)
            assert c["permitido"] is False and c["politica"] == "plataforma_sin_acceso_a_tramites", (rol, a, caso, c)


def test_la_ciudadania_ve_lo_suyo_y_nada_mas():
    assert celda("ciudadano", Accion.VER_TRAMITE)["permitido"] is True
    assert celda("ciudadano", Accion.VER_TRAMITE, "desfavorable")["permitido"] is False
    assert celda("ciudadano", Accion.CREAR_TRAMITE)["permitido"] is True
    assert celda("ciudadano", Accion.CREAR_TRAMITE, "desfavorable")["permitido"] is False
    assert celda("ciudadano", Accion.CAMBIAR_ESTADO)["permitido"] is False


def test_el_funcionario_atiende_solo_su_institucion_y_el_cambio_exige_segundo_factor():
    assert celda("funcionario", Accion.VER_TRAMITE)["permitido"] is True
    assert celda("funcionario", Accion.VER_TRAMITE, "desfavorable")["permitido"] is False
    cambio = M["matriz"]["funcionario"]["cambiar_estado"]
    assert cambio["favorable"]["permitido"] and not cambio["desfavorable"]["permitido"] and cambio["exige_segundo_factor"] is True
    assert M["matriz"]["funcionario"]["ver_tramite"]["exige_segundo_factor"] is False  # ver no lo exige
    assert celda("funcionario", Accion.REASIGNAR_TRAMITE)["permitido"] is False


def test_el_supervisor_reasigna_en_su_institucion_y_no_en_otra():
    assert celda("supervisor", Accion.REASIGNAR_TRAMITE)["permitido"] is True
    assert celda("supervisor", Accion.REASIGNAR_TRAMITE, "desfavorable")["permitido"] is False


def test_la_coordinacion_gestiona_personas_pero_no_ve_trámites():
    assert celda("coordinador_institucional", Accion.GESTIONAR_USUARIOS_INSTITUCION)["permitido"] is True
    assert celda("coordinador_institucional", Accion.GESTIONAR_USUARIOS_INSTITUCION, "desfavorable")["permitido"] is False
    assert M["matriz"]["coordinador_institucional"]["gestionar_usuarios_institucion"]["exige_segundo_factor"] is True
    for caso in ("favorable", "desfavorable"):
        assert celda("coordinador_institucional", Accion.VER_TRAMITE, caso)["permitido"] is False


def test_el_control_dual_impide_aprobar_lo_propio():
    assert celda("operador_identidades", Accion.PROPONER_ALTA)["permitido"] is True
    assert celda("operador_identidades", Accion.APROBAR_ALTA)["permitido"] is True
    propia = celda("operador_identidades", Accion.APROBAR_ALTA, "desfavorable")
    assert propia["permitido"] is False and propia["politica"] == "control_dual"
    # cada operador solo gestiona su tipo de alta: el de catálogo no propone altas de coordinadores
    assert celda("operador_catalogo", Accion.PROPONER_ALTA, "desfavorable")["permitido"] is False


def test_cada_operador_de_plataforma_tiene_solo_su_area():
    esperado = {
        "operador_infraestructura": {Accion.ADMINISTRAR_INFRAESTRUCTURA},
        "operador_seguridad": {Accion.BLOQUEAR_CUENTA, Accion.REVOCAR_SESION},
        "custodio_secretos": {Accion.ROTAR_SECRETOS},
        "auditor": {Accion.CONSULTAR_AUDITORIA, Accion.CONSULTAR_DECISIONES},
    }
    for rol, acciones in esperado.items():
        permitidas = {a for a in Accion if celda(rol, a)["permitido"]}
        assert permitidas == acciones, (rol, permitidas)


def test_el_auditor_solo_lee_y_no_puede_hacer_nada_mas():
    for a in Accion:
        if a not in (Accion.CONSULTAR_AUDITORIA, Accion.CONSULTAR_DECISIONES):
            assert celda("auditor", a)["permitido"] is False, a


def test_las_acciones_de_plataforma_exigen_segundo_factor():
    for rol, accion in (("operador_infraestructura", Accion.ADMINISTRAR_INFRAESTRUCTURA), ("operador_seguridad", Accion.BLOQUEAR_CUENTA),
                        ("custodio_secretos", Accion.ROTAR_SECRETOS), ("auditor", Accion.CONSULTAR_DECISIONES)):
        assert M["matriz"][rol][accion.value]["exige_segundo_factor"] is True


def test_cada_rol_trae_sus_modulos_y_las_politicas_que_explican_cada_decision():
    por_rol = {r["id"]: [m["id"] for m in r["modulos"]] for r in M["roles"]}
    assert "bandeja" in por_rol["funcionario"] and "bandeja" not in por_rol["ciudadano"]
    assert "auditoria" in por_rol["auditor"] and "mis_tramites" not in por_rol["auditor"]
    for rol in M["matriz"].values():
        for a in rol.values():
            assert a["favorable"]["politica"] and a["desfavorable"]["politica"]


def test_la_vista_por_modulo_es_la_inversa_exacta_de_la_vista_por_rol():
    from apps.autorizacion.modulos import CATALOGO
    assert [m["id"] for m in M["modulos"]] == list(CATALOGO)
    for modulo in M["modulos"]:
        esperado = [r["id"] for r in M["roles"] if modulo["id"] in [x["id"] for x in r["modulos"]]]
        assert modulo["roles"] == esperado
    por_modulo = {m["id"]: m["roles"] for m in M["modulos"]}
    # Un rol llega a varios módulos y un módulo lo comparten varios roles
    assert len([m for m in M["modulos"] if "supervisor" in m["roles"]]) > 1
    assert len(por_modulo["seguridad"]) == 10 and "ciudadano" in por_modulo["seguridad"]
    # Los módulos operativos de trámites no los toca ningún rol de plataforma
    assert por_modulo["bandeja"] == ["funcionario", "supervisor"]
    assert por_modulo["supervision"] == ["supervisor"]
    assert por_modulo["equipo"] == ["supervisor", "coordinador_institucional"]
    assert por_modulo["auditoria"] == ["auditor"]
    # Todo módulo del catálogo lo ve al menos un rol (no hay módulos huérfanos)
    assert all(m["roles"] for m in M["modulos"])


def test_las_reglas_de_denegacion_documentadas_existen_en_el_pdp():
    nombres = {d["politica"] for d in M["denegaciones"]}
    assert {"cuenta_no_activa", "plataforma_sin_acceso_a_tramites", "conflicto_de_interes", "control_dual", "sin_regla_que_permita"} <= nombres
    en_el_pdp = {r.__name__ for r in pdp.DENEGACIONES}
    assert {"_cuenta_activa", "_plataforma_sin_tramites", "_conflicto_de_interes", "_control_dual"} <= en_el_pdp


# --------------------------------------------------------------------------- la ventana del segundo factor es la configuración real

def test_la_matriz_informa_la_ventana_configurada_y_el_vencido_siempre_la_supera():
    assert matriz.vencido_hace(15) == 60 and matriz.vencido_hace(30) == 75 and matriz.vencido_hace(90) == 135
    for ventana in (2, 15, 30, 90):
        m = matriz.construir(ventana=ventana)
        assert m["ventana_minutos"] == ventana
        # lo que exige segundo factor reciente no depende de cuánto dure la ventana, sino de que exista
        assert m["matriz"]["funcionario"]["cambiar_estado"]["exige_segundo_factor"] is True
        assert m["matriz"]["funcionario"]["ver_tramite"]["exige_segundo_factor"] is False
        assert m["ningun_rol_puede_todo"] is True
