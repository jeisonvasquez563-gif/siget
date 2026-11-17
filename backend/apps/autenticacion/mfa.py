"""Segundo factor TOTP (RFC 6238). El secreto se guarda cifrado con Fernet; un código no sirve dos veces."""
import hmac
from datetime import datetime
from typing import Optional

import pyotp
from cryptography.fernet import Fernet, InvalidToken

PERIODO = 30
EMISOR = "SIGET"


class ErrorDeCifrado(Exception):
    pass


def nuevo_secreto() -> str:
    return pyotp.random_base32()


def uri_de_aprovisionamiento(secreto: str, usuario: str) -> str:
    return pyotp.TOTP(secreto, interval=PERIODO).provisioning_uri(name=usuario, issuer_name=EMISOR)


def cifrar(clave: str, secreto: str) -> str:
    return Fernet(clave.encode()).encrypt(secreto.encode()).decode()


def descifrar(clave: str, cifrado: str) -> str:
    try:
        return Fernet(clave.encode()).decrypt(cifrado.encode()).decode()
    except (InvalidToken, ValueError) as error:
        raise ErrorDeCifrado("no se pudo descifrar el secreto TOTP") from error


def paso_valido(secreto: str, codigo, ahora: datetime, ultimo_paso: Optional[int], ventana: int = 1) -> Optional[int]:
    """Devuelve el paso de tiempo del código si es válido y NO se usó antes; si no, None.

    Acepta ±`ventana` pasos por desfase de reloj, y rechaza cualquier paso menor o igual al último usado
    (así el mismo código no sirve dos veces, aunque alguien lo haya visto).
    """
    # isascii(): `isdigit()` acepta dígitos Unicode (p. ej. de ancho completo) y `compare_digest` falla con ellos
    if not isinstance(codigo, str) or len(codigo) != 6 or not (codigo.isascii() and codigo.isdigit()):
        return None
    totp = pyotp.TOTP(secreto, interval=PERIODO)
    base = int(ahora.timestamp()) // PERIODO
    encontrado = None
    for desfase in range(-ventana, ventana + 1):  # se revisan todos para no filtrar por tiempo cuál acertó
        paso = base + desfase
        if hmac.compare_digest(totp.at(paso * PERIODO), codigo) and (ultimo_paso is None or paso > ultimo_paso):
            encontrado = paso if encontrado is None else max(encontrado, paso)
    return encontrado
