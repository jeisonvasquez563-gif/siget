"""Archivos cifrados de los documentos en disco (volumen propio). La ubicación la genera el servidor y se valida siempre:
nada de lo que manda el cliente llega a una ruta."""
import os
import re
from pathlib import Path

from django.conf import settings

_UBICACION = re.compile(r"^[0-9a-f]{32}$")


def _ruta(ubicacion: str) -> Path:
    if not isinstance(ubicacion, str) or not _UBICACION.fullmatch(ubicacion):
        raise ValueError("ubicación de documento inválida")
    return Path(settings.SIGET_DOCS_DIR) / ubicacion[:2] / ubicacion


def guardar(ubicacion: str, cifrado: bytes) -> None:
    """Escribe el archivo de una sola vez (O_EXCL: nunca pisa otro) con permisos 600."""
    ruta = _ruta(ubicacion)
    ruta.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    descriptor = os.open(ruta, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_BINARY", 0), 0o600)
    with os.fdopen(descriptor, "wb") as archivo:
        archivo.write(cifrado)
        archivo.flush()
        os.fsync(archivo.fileno())


def leer(ubicacion: str) -> bytes:
    return _ruta(ubicacion).read_bytes()


def descartar(ubicacion: str) -> None:
    """Solo para deshacer una carga cuya fila no llegó a la base (el archivo quedaría huérfano)."""
    try:
        _ruta(ubicacion).unlink()
    except FileNotFoundError:
        pass
