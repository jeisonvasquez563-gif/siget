"""Las tres puertas de entrada: quién puede entrar por cuál (lógica pura)."""
import pytest

from apps.autenticacion import canales as c

MOP, MINSA = 3, 2
CIUDADANA = ("ninguno", [])
FUNCIONARIO_MOP = ("ninguno", [("funcionario", MOP)])
SUPERVISOR_MOP = ("ninguno", [("supervisor", MOP)])
COORDINADORA_DOS = ("ninguno", [("coordinador_institucional", MOP), ("coordinador_institucional", MINSA)])
OPERADOR = ("operador_seguridad", [])
AUDITOR = ("auditor", [])


def entra(canal, persona, institucion=None):
    return c.permitido(canal, institucion, *persona)


def test_cada_persona_tiene_su_puerta():
    assert c.canal_de(*CIUDADANA) == c.CIUDADANIA
    assert c.canal_de(*FUNCIONARIO_MOP) == c.canal_de(*SUPERVISOR_MOP) == c.canal_de(*COORDINADORA_DOS) == c.INSTITUCION
    assert c.canal_de(*OPERADOR) == c.canal_de(*AUDITOR) == c.PLATAFORMA


def test_la_ciudadania_entra_solo_por_la_puerta_publica():
    assert entra("ciudadania", CIUDADANA)
    assert not entra("institucion", CIUDADANA, MOP)
    assert not entra("plataforma", CIUDADANA)


def test_el_personal_entra_por_SU_institucion_y_por_ninguna_otra():
    assert entra("institucion", FUNCIONARIO_MOP, MOP)
    assert not entra("institucion", FUNCIONARIO_MOP, MINSA), "otra institución"
    assert not entra("institucion", FUNCIONARIO_MOP, None), "sin elegir institución"
    assert not entra("ciudadania", FUNCIONARIO_MOP), "el personal no usa la puerta pública"
    assert not entra("plataforma", FUNCIONARIO_MOP)


def test_quien_trabaja_en_dos_instituciones_entra_por_cualquiera_de_las_dos():
    assert entra("institucion", COORDINADORA_DOS, MOP) and entra("institucion", COORDINADORA_DOS, MINSA)
    assert not entra("institucion", COORDINADORA_DOS, 99)


def test_los_roles_de_plataforma_solo_entran_por_la_suya():
    for persona in (OPERADOR, AUDITOR):
        assert entra("plataforma", persona)
        assert not entra("ciudadania", persona) and not entra("institucion", persona, MOP)


@pytest.mark.parametrize("malo", ["", "admin", "INSTITUCION", "plataforma ", None.__class__, 5])
def test_una_puerta_inexistente_no_deja_entrar(malo):
    assert not c.permitido(malo, MOP, "ninguno", [])


@pytest.mark.parametrize("institucion", ["3", 3.0, True, [3], {"id": 3}, -1, 0])
def test_el_id_de_la_institucion_debe_ser_un_entero_exacto(institucion):
    assert not entra("institucion", FUNCIONARIO_MOP, institucion)


def test_un_cliente_que_no_manda_puerta_entra_como_siempre():
    for persona in (CIUDADANA, FUNCIONARIO_MOP, OPERADOR):
        assert c.permitido(None, None, *persona)


def test_una_membresia_de_ciudadano_no_cuenta_como_personal():
    assert c.canal_de("ninguno", [("ciudadano", MOP)]) == c.CIUDADANIA
