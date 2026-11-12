"""Documentos adjuntos (PT-8): validación de archivos hostiles, nombres y cifrado por archivo. Sin base de datos."""
import os

import pytest

from apps.tramites import documentos as doc

PDF = b"%PDF-1.7\n%\xe2\xe3\xcf\xd3\n1 0 obj<<>>endobj\n%%EOF\n"
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 64
CLAVE = os.urandom(32)


# --------------------------------------------------------------------------- tipo por contenido, no por extensión

@pytest.mark.parametrize("nombre,contenido,tipo", [
    ("requisito.pdf", PDF, "application/pdf"), ("foto.PNG", PNG, "image/png"), ("cedula.jpg", JPEG, "image/jpeg"),
    ("cedula.jpeg", JPEG, "image/jpeg"),
])
def test_acepta_los_tres_tipos_cuando_el_contenido_coincide(nombre, contenido, tipo):
    assert doc.validar(nombre, contenido) == (tipo, None)


@pytest.mark.parametrize("nombre,contenido,motivo", [
    ("factura.pdf", b"MZ\x90\x00 esto es un ejecutable", "contenido_no_permitido"),        # .exe disfrazado
    ("foto.png", PDF, "extension_no_coincide"),                                           # PDF con extensión de imagen
    ("nota.pdf.exe", PDF, "extension_no_permitida"),                                      # doble extensión
    ("pagina.html", b"<html><script>alert(1)</script></html>", "extension_no_permitida"),
    ("imagen.svg", b"<svg onload=alert(1)>", "extension_no_permitida"),                   # SVG puede llevar scripts
    ("sin_extension", PDF, "extension_no_permitida"),
    ("vacio.pdf", b"", "vacio"),
    ("parcial.pdf", b"%PD", "contenido_no_permitido"),
])
def test_rechaza_archivos_hostiles(nombre, contenido, motivo):
    assert doc.validar(nombre, contenido) == (None, motivo)


def test_rechaza_lo_que_supera_el_tamano_maximo():
    grande = PDF + b"0" * (doc.TAMANO_MAXIMO + 1 - len(PDF))
    assert doc.validar("grande.pdf", grande) == (None, "demasiado_grande")
    justo = PDF + b"0" * (doc.TAMANO_MAXIMO - len(PDF))
    assert doc.validar("justo.pdf", justo) == ("application/pdf", None)


# --------------------------------------------------------------------------- nombres

@pytest.mark.parametrize("crudo,esperado", [
    ("../../etc/passwd.pdf", "passwd.pdf"),
    (r"..\..\windows\win.ini.pdf", "win.ini.pdf"),
    (r"C:\Users\ana\Escritorio\cédula.pdf", "cédula.pdf"),
    ("re\x00quisito\n\r.pdf", "requisito.pdf"),
    ("   espacios   .pdf  ", "espacios .pdf"),
    ("\u202egnp.pdf", "gnp.pdf"),                       # carácter de control de dirección (RTL override)
])
def test_el_nombre_se_sanea_y_nunca_trae_una_ruta(crudo, esperado):
    assert doc.sanear_nombre(crudo) == esperado


def test_un_nombre_largo_se_recorta_conservando_la_extension():
    nombre = doc.sanear_nombre("a" * 300 + ".pdf")
    assert len(nombre) <= doc.NOMBRE_MAXIMO and nombre.endswith(".pdf")


@pytest.mark.parametrize("vacio", ["", "   ", "..", ".", "/", None, 42])
def test_un_nombre_vacio_o_invalido_recibe_uno_generico(vacio):
    assert doc.sanear_nombre(vacio) == "documento"


def test_la_ubicacion_la_genera_el_servidor_y_no_se_repite():
    ubicaciones = {doc.nueva_ubicacion() for _ in range(200)}
    assert len(ubicaciones) == 200 and all(len(u) == 32 and u.isalnum() for u in ubicaciones)


# --------------------------------------------------------------------------- cifrado por archivo

def test_cifrar_y_descifrar_devuelve_lo_mismo_y_en_disco_no_queda_en_claro():
    cifrado = doc.cifrar(CLAVE, PDF, tramite_id=7, ubicacion="a" * 32)
    assert PDF not in cifrado and cifrado.startswith(doc.MAGIA)
    assert doc.descifrar(CLAVE, cifrado, tramite_id=7, ubicacion="a" * 32) == PDF


def test_cada_cifrado_es_distinto_aunque_el_archivo_sea_el_mismo():
    assert doc.cifrar(CLAVE, PDF, 7, "a" * 32) != doc.cifrar(CLAVE, PDF, 7, "a" * 32)


@pytest.mark.parametrize("cambio", ["byte", "tramite", "ubicacion", "clave"])
def test_cualquier_alteracion_se_detecta(cambio):
    cifrado = bytearray(doc.cifrar(CLAVE, PDF, 7, "a" * 32))
    tramite, ubicacion, clave = 7, "a" * 32, CLAVE
    if cambio == "byte":
        cifrado[-5] ^= 0x01
    elif cambio == "tramite":
        tramite = 8               # el mismo archivo copiado a otro trámite no se descifra
    elif cambio == "ubicacion":
        ubicacion = "b" * 32
    else:
        clave = os.urandom(32)
    with pytest.raises(doc.DocumentoAlterado):
        doc.descifrar(clave, bytes(cifrado), tramite, ubicacion)


def test_un_archivo_que_no_es_de_siget_se_rechaza():
    with pytest.raises(doc.DocumentoAlterado):
        doc.descifrar(CLAVE, b"otra cosa", 7, "a" * 32)


@pytest.mark.parametrize("mala", [b"", b"corta", os.urandom(16), "texto" * 10])
def test_la_clave_debe_ser_de_32_bytes(mala):
    with pytest.raises(ValueError):
        doc.cifrar(mala, PDF, 7, "a" * 32)


def test_la_huella_es_sha256_del_contenido_en_claro():
    import hashlib
    assert doc.huella(PDF) == hashlib.sha256(PDF).hexdigest()


def test_el_nombre_de_descarga_se_codifica_sin_romper_la_cabecera():
    valor = doc.content_disposition('informe "final"; 2026.pdf')
    assert valor.startswith("attachment;") and "\n" not in valor and "filename*=UTF-8''" in valor
    assert '"' not in valor.split("filename=")[1].split(";")[0].strip('"')


# --------------------------------------------------------------------------- almacén en disco

@pytest.mark.parametrize("mala", ["../../etc/passwd", "a" * 31, "A" * 32, "g" * 32, "/" + "a" * 31, "a" * 32 + "/", None, 7])
def test_el_almacen_solo_acepta_ubicaciones_generadas_por_el_servidor(mala):
    from apps.tramites import almacen
    with pytest.raises(ValueError):
        almacen.leer(mala)


def test_el_almacen_guarda_con_permisos_600_y_nunca_pisa_un_archivo(tmp_path, settings):
    from apps.tramites import almacen
    settings.SIGET_DOCS_DIR = str(tmp_path)
    ubicacion = doc.nueva_ubicacion()
    almacen.guardar(ubicacion, b"cifrado")
    assert almacen.leer(ubicacion) == b"cifrado"
    with pytest.raises(FileExistsError):
        almacen.guardar(ubicacion, b"otro")
    if os.name == "posix":
        assert (tmp_path / ubicacion[:2] / ubicacion).stat().st_mode & 0o777 == 0o600
    almacen.descartar(ubicacion)
    almacen.descartar(ubicacion)  # descartar dos veces no falla
