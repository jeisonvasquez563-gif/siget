"""Los módulos del menú por rol. Son solo ayuda visual: la autorización real está en el PDP y en la base."""
import pytest

from apps.autorizacion.modulos import CATALOGO, modulos_para
from apps.autorizacion.pdp import ROLES_PLATAFORMA


def ids(rol_plataforma="ninguno", roles=()):
    return [m["id"] for m in modulos_para(rol_plataforma, roles)]


def test_el_ciudadano_ve_sus_tramites_y_nada_de_personal():
    assert ids() == ["mis_tramites", "nuevo_tramite", "seguridad"]
    assert ids(roles=["ciudadano"]) == ["mis_tramites", "nuevo_tramite", "seguridad"]


def test_el_funcionario_suma_la_bandeja():
    assert ids(roles=["funcionario"]) == ["mis_tramites", "nuevo_tramite", "bandeja", "seguridad"]


def test_el_supervisor_suma_supervision_y_equipo():
    r = ids(roles=["supervisor"])
    assert "bandeja" in r and "supervision" in r and "equipo" in r


def test_el_coordinador_ve_el_equipo_pero_no_los_tramites_de_la_institucion():
    r = ids(roles=["coordinador_institucional"])
    assert "equipo" in r and "bandeja" not in r and "supervision" not in r


@pytest.mark.parametrize("rol", sorted(ROLES_PLATAFORMA))
def test_un_rol_de_plataforma_no_ve_ningun_modulo_de_tramites(rol):
    r = ids(rol, ["funcionario"])  # aunque llegara con una membresía (la base lo impide), no cuenta
    assert not {"mis_tramites", "nuevo_tramite", "bandeja", "supervision", "equipo"} & set(r)
    assert "prueba_acceso" in r and "seguridad" in r and len(r) == 3


def test_cada_rol_de_plataforma_tiene_su_consola():
    assert ids("auditor")[0] == "auditoria"
    assert ids("custodio_secretos")[0] == "consola_secretos"
    assert ids("operador_infraestructura")[0] == "consola_infraestructura"


def test_todo_modulo_devuelto_existe_en_el_catalogo_y_tiene_estado_valido():
    for rol in ["ninguno", *ROLES_PLATAFORMA]:
        for m in modulos_para(rol, ["funcionario", "supervisor", "coordinador_institucional"]):
            assert m["id"] in CATALOGO and m["estado"] in {"disponible", "proximamente"}


def test_un_rol_desconocido_no_da_modulos_de_mas():
    assert ids("inventado") == ["prueba_acceso", "seguridad"]
