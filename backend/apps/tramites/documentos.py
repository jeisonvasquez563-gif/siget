"""Documentos adjuntos (PT-8): validación, nombres y cifrado por archivo. Funciones puras, sin base de datos ni disco.

Reglas:
- Solo PDF, PNG y JPEG, detectados por el CONTENIDO (bytes mágicos), y la extensión debe coincidir con lo detectado: un
  ejecutable o un HTML renombrado a .pdf se rechaza. No se aceptan SVG ni HTML (pueden llevar scripts).
- Tamaño máximo de 5 MB.
- El nombre que manda el cliente es solo para mostrar: se sanea y nunca se usa como ruta. La ubicación en disco la genera el
  servidor (32 caracteres aleatorios).
- Cada archivo se cifra con AES-256-GCM (clave aparte, `podman secret`) y un nonce aleatorio. Los datos autenticados atan
  el archivo a su trámite y a su ubicación: copiado a otro trámite o renombrado en disco, no se descifra.
"""
import hashlib
import os
import re
import secrets
import unicodedata
from urllib.parse import quote

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

TAMANO_MAXIMO = 5 * 1024 * 1024
NOMBRE_MAXIMO = 120
MAGIA = b"SGD1"  # cabecera del formato cifrado de SIGET (versión 1)
TIPOS = {
    "application/pdf": ({".pdf"}, (b"%PDF-",)),
    "image/png": ({".png"}, (b"\x89PNG\r\n\x1a\n",)),
    "image/jpeg": ({".jpg", ".jpeg"}, (b"\xff\xd8\xff",)),
}
EXTENSIONES = {ext: tipo for tipo, (exts, _) in TIPOS.items() for ext in exts}


class DocumentoAlterado(Exception):
    """El archivo cifrado no corresponde a su trámite, a su ubicación o fue modificado."""


def _extension(nombre: str) -> str:
    base = nombre.rsplit(".", 1)
    return "." + base[1].lower() if len(base) == 2 else ""


def validar(nombre, contenido: bytes):
    """Devuelve (tipo_mime, None) si el archivo es aceptable, o (None, motivo)."""
    if not contenido:
        return None, "vacio"
    if len(contenido) > TAMANO_MAXIMO:
        return None, "demasiado_grande"
    extension = _extension(sanear_nombre(nombre))
    if extension not in EXTENSIONES:
        return None, "extension_no_permitida"
    detectado = next((tipo for tipo, (_, firmas) in TIPOS.items() if contenido.startswith(firmas)), None)
    if detectado is None:
        return None, "contenido_no_permitido"
    if EXTENSIONES[extension] != detectado:
        return None, "extension_no_coincide"
    return detectado, None


def sanear_nombre(nombre) -> str:
    """Nombre seguro para mostrar: sin ruta, sin caracteres de control ni de dirección, NFC y con largo acotado."""
    if not isinstance(nombre, str):
        return "documento"
    nombre = re.split(r"[\\/]", nombre)[-1]                       # nunca una ruta, venga de Windows o de Linux
    nombre = unicodedata.normalize("NFC", nombre)
    nombre = "".join(c for c in nombre if unicodedata.category(c)[0] != "C")  # control, formato (RTL override) y demás
    nombre = re.sub(r"\s+", " ", nombre).strip(" .")
    if not nombre or set(nombre) <= {"."}:
        return "documento"
    if len(nombre) > NOMBRE_MAXIMO:
        extension = _extension(nombre)
        nombre = nombre[: NOMBRE_MAXIMO - len(extension)] + extension
    return nombre


def nueva_ubicacion() -> str:
    return secrets.token_hex(16)


def huella(contenido: bytes) -> str:
    return hashlib.sha256(contenido).hexdigest()


def _aad(tramite_id: int, ubicacion: str) -> bytes:
    return f"siget-documento:{tramite_id}:{ubicacion}".encode()


def _clave(clave) -> AESGCM:
    if not isinstance(clave, bytes) or len(clave) != 32:
        raise ValueError("la clave de documentos debe tener 32 bytes")
    return AESGCM(clave)


def cifrar(clave: bytes, contenido: bytes, tramite_id: int, ubicacion: str) -> bytes:
    nonce = os.urandom(12)
    return MAGIA + nonce + _clave(clave).encrypt(nonce, contenido, _aad(tramite_id, ubicacion))


def descifrar(clave: bytes, cifrado: bytes, tramite_id: int, ubicacion: str) -> bytes:
    if not cifrado.startswith(MAGIA) or len(cifrado) < len(MAGIA) + 12 + 16:
        raise DocumentoAlterado("no es un documento cifrado por SIGET")
    nonce, cuerpo = cifrado[len(MAGIA):len(MAGIA) + 12], cifrado[len(MAGIA) + 12:]
    try:
        return _clave(clave).decrypt(nonce, cuerpo, _aad(tramite_id, ubicacion))
    except InvalidTag as error:
        raise DocumentoAlterado("el documento fue alterado o no corresponde a este trámite") from error


def content_disposition(nombre: str) -> str:
    """Siempre como descarga (nunca se abre en la página) y con el nombre codificado según RFC 6266 / 5987."""
    seguro = sanear_nombre(nombre)
    ascii_ = seguro.encode("ascii", "ignore").decode().replace('"', "").replace(";", "") or "documento"
    return f"attachment; filename=\"{ascii_}\"; filename*=UTF-8''{quote(seguro, safe='')}"
