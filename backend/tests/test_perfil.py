"""Datos personales del registro: validación estricta y protección de la cédula (lógica pura)."""
from datetime import date

import pytest
from cryptography.fernet import Fernet

from apps.autenticacion import perfil as p

HOY = date(2026, 10, 22)
MAESTRA = Fernet.generate_key().decode()


def datos(**cambios):
    base = {"nombre": "María José", "apellidos": "Pérez de Gracia", "cedula": "8-123-456", "fecha_nacimiento": "1995-04-12",
            "provincia": "Panamá", "ciudad": "San Miguelito", "correo": "Maria.Perez@Correo.com"}
    base.update(cambios)
    return base


def errores(**cambios):
    return p.validar(datos(**cambios), HOY)[1]


def test_unos_datos_correctos_se_aceptan_y_se_normalizan():
    perfil, fallos = p.validar(datos(cedula=" 8 123 456 ", correo="  Maria.Perez@Correo.com "), HOY)
    assert fallos == []
    assert perfil["cedula"] == "8-123-456" and perfil["correo"] == "maria.perez@correo.com"
    assert perfil["fecha_nacimiento"] == date(1995, 4, 12)


@pytest.mark.parametrize("campo", ["nombre", "apellidos", "cedula", "fecha_nacimiento", "provincia", "ciudad", "correo"])
def test_todos_los_campos_son_obligatorios(campo):
    assert any("falta" in e for e in errores(**{campo: ""}))
    assert any("falta" in e for e in p.validar({k: v for k, v in datos().items() if k != campo}, HOY)[1])


@pytest.mark.parametrize("valor", ["Maria3", "Ma<script>", "María;DROP", "  ", "A" * 61, "María  "[0:0] or "1"])
def test_el_nombre_solo_admite_letras(valor):
    assert errores(nombre=valor)


@pytest.mark.parametrize("cedula", ["8-123-456", "4-1234-56789", "10-12-3456", "PE-12-345", "E-8-12345", "N-12-345", "13-1-1", "8AV-12-345"])
def test_cedulas_panamenas_validas(cedula):
    assert errores(cedula=cedula) == []


@pytest.mark.parametrize("cedula", ["", "abc", "8-123", "0-123-456", "14-123-456", "8-12345-456", "8-123-4567890", "8_123_456", "8-123-456; DROP", "X-12-345"])
def test_cedulas_invalidas(cedula):
    assert errores(cedula=cedula)


def test_la_edad_minima_es_dieciocho_y_se_cuenta_bien_el_dia_del_cumpleanos():
    assert errores(fecha_nacimiento="2008-10-22") == []          # cumple 18 hoy
    assert any("18 años" in e for e in errores(fecha_nacimiento="2008-10-23"))  # los cumple mañana
    assert any("futura" in e for e in errores(fecha_nacimiento="2030-01-01"))
    assert any("creíble" in e for e in errores(fecha_nacimiento="1890-01-01"))
    assert any("no es válida" in e for e in errores(fecha_nacimiento="31/12/1990"))
    assert any("no es válida" in e for e in errores(fecha_nacimiento="1995-02-30"))


def test_la_provincia_debe_ser_una_de_panama():
    assert errores(provincia="Veraguas") == [] and errores(provincia="Comarca Ngäbe-Buglé") == []
    assert errores(provincia="Texas") and errores(provincia="")
    assert len(p.PROVINCIAS) == 13


@pytest.mark.parametrize("correo", ["sin-arroba", "a@b", "a@@b.com", "@b.com", "a b@c.com", "a@b.c", "x" * 250 + "@a.com"])
def test_correos_invalidos(correo):
    assert errores(correo=correo)


def test_tipos_inesperados_no_rompen_nada():
    perfil, fallos = p.validar({"nombre": ["a"], "apellidos": 5, "cedula": None, "fecha_nacimiento": {}, "provincia": 1, "ciudad": [], "correo": 3.5}, HOY)
    assert perfil is None and len(fallos) >= 7
    assert p.validar({}, HOY)[0] is None


def test_la_cedula_se_cifra_y_se_recupera_pero_nunca_queda_en_claro():
    cifrada = p.cifrar_cedula(MAESTRA, "8-123-456")
    assert "8-123-456" not in cifrada
    assert p.descifrar_cedula(MAESTRA, cifrada) == "8-123-456"
    assert p.cifrar_cedula(MAESTRA, "8-123-456") != cifrada  # Fernet usa un valor aleatorio: no se puede comparar cifrados
    assert p.descifrar_cedula(Fernet.generate_key().decode(), cifrada) is None  # otra clave no la abre


def test_la_huella_es_estable_distinta_por_cedula_y_depende_de_la_clave():
    h = p.huella_cedula(MAESTRA, "8-123-456")
    assert h == p.huella_cedula(MAESTRA, "8-123-456") and len(h) == 64
    assert h != p.huella_cedula(MAESTRA, "8-123-457")
    assert h != p.huella_cedula(Fernet.generate_key().decode(), "8-123-456")
    assert "8-123-456" not in h


def test_las_claves_derivadas_son_distintas_para_cada_proposito():
    assert p._clave_derivada(MAESTRA, b"a") != p._clave_derivada(MAESTRA, b"b")
    assert p._clave_derivada(MAESTRA, b"siget/perfil/cedula/cifrado") != MAESTRA.encode()
