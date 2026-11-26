"""Los módulos del menú por rol. Son solo ayuda visual: la autorización real está en el PDP y en la base."""
import pytest

from apps.autorizacion.modulos import CATALOGO, modulos_para
from apps.autorizacion.pdp import ROLES_PLATAFORMA


def ids(rol_plataforma="ninguno", roles=()):
    return [m["id"] for m in modulos_para(rol_plataforma, roles)]


def test_el_ciudadano_ve_sus_tramites_y_nada_de_personal():
    assert ids() == ["mis_tramites", "nuevo_tramite", "mis_datos", "mis_documentos", "seguridad", "mfa", "roles_permisos", "ayuda"]
    assert ids(roles=["ciudadano"]) == ids()


def test_el_funcionario_suma_la_bandeja():
    assert ids(roles=["funcionario"]) == ["mis_tramites", "nuevo_tramite", "mis_datos", "mis_documentos", "bandeja", "seguridad", "mfa", "roles_permisos", "ayuda"]


def test_el_supervisor_suma_supervision_y_equipo():
    r = ids(roles=["supervisor"])
    assert "bandeja" in r and "supervision" in r and "equipo" in r


def test_el_coordinador_ve_el_equipo_pero_no_los_tramites_de_la_institucion():
    r = ids(roles=["coordinador_institucional"])
    assert "equipo" in r and "bandeja" not in r and "supervision" not in r


def test_el_catalogo_de_la_institucion_es_solo_de_la_coordinacion():
    assert ids(roles=["coordinador_institucional"]) == ["mis_tramites", "nuevo_tramite", "mis_datos", "mis_documentos", "equipo", "catalogo_institucion",
                                                        "indicadores", "seguridad", "mfa", "roles_permisos", "ayuda"]
    for roles in ([], ["ciudadano"], ["funcionario"], ["supervisor"], ["funcionario", "supervisor"]):
        assert "catalogo_institucion" not in ids(roles=roles), roles
    assert CATALOGO["catalogo_institucion"][0] == "Catálogo de la institución"


@pytest.mark.parametrize("rol", sorted(ROLES_PLATAFORMA))
def test_un_rol_de_plataforma_no_ve_ningun_modulo_de_tramites(rol):
    r = ids(rol, ["funcionario"])  # aunque llegara con una membresía (la base lo impide), no cuenta
    assert not {"mis_tramites", "nuevo_tramite", "mis_datos", "mis_documentos", "bandeja", "supervision", "equipo", "catalogo_institucion", "indicadores"} & set(r)
    assert {"prueba_acceso", "seguridad", "mfa", "roles_permisos", "ayuda"} <= set(r) and len(r) == 6


def test_cada_rol_de_plataforma_tiene_su_consola():
    assert ids("auditor")[0] == "auditoria"
    assert ids("custodio_secretos")[0] == "consola_secretos"
    assert ids("operador_infraestructura")[0] == "consola_infraestructura"


def test_todo_modulo_devuelto_existe_en_el_catalogo_y_tiene_estado_valido():
    for rol in ["ninguno", *ROLES_PLATAFORMA]:
        for m in modulos_para(rol, ["funcionario", "supervisor", "coordinador_institucional"]):
            assert m["id"] in CATALOGO and m["estado"] in {"disponible", "proximamente"}


def test_un_rol_desconocido_no_da_modulos_de_mas():
    assert ids("inventado") == ["prueba_acceso", "seguridad", "mfa", "roles_permisos", "ayuda"]


def test_todas_las_personas_ven_la_transparencia_de_su_seguridad_y_sus_permisos():
    for rol in ["ninguno", *ROLES_PLATAFORMA]:
        r = ids(rol, ["funcionario"])
        assert {"seguridad", "mfa", "roles_permisos"} <= set(r), rol


def test_los_indicadores_son_de_la_supervision_y_de_la_coordinacion():
    for roles in (["supervisor"], ["coordinador_institucional"], ["funcionario", "supervisor"]):
        assert "indicadores" in ids(roles=roles), roles
    for roles in ([], ["ciudadano"], ["funcionario"]):
        assert "indicadores" not in ids(roles=roles), roles
    for rol in sorted(ROLES_PLATAFORMA):
        assert "indicadores" not in ids(rol, ["supervisor"]), rol
    assert CATALOGO["indicadores"][0] == "Indicadores"


def test_mis_documentos_es_de_toda_cuenta_sin_rol_de_plataforma_y_la_ayuda_es_de_todas():
    for roles in ([], ["funcionario"], ["supervisor"], ["coordinador_institucional"]):
        assert "mis_documentos" in ids(roles=roles), roles
    for rol in ["ninguno", *sorted(ROLES_PLATAFORMA)]:
        assert "ayuda" in ids(rol, ["funcionario"]), rol
        assert ("mis_documentos" in ids(rol, ["funcionario"])) == (rol == "ninguno"), rol
    assert ids()[-1] == "ayuda" and CATALOGO["mis_documentos"][0] == "Mis documentos" and CATALOGO["ayuda"][0] == "Ayuda"
