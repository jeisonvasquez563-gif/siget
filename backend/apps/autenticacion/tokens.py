"""Tokens de acceso (JWT firmado y de vida corta) y de refresco (opaco, solo se guarda su hash).

El reloj se inyecta (`ahora`) para poder probar los vencimientos. El algoritmo está FIJADO al validar:
nunca se acepta el que declare el token (ataque de confusión de algoritmo, p. ej. `none`).
"""
import hashlib
import secrets
import uuid
from dataclasses import dataclass
from datetime import datetime

import jwt

ALGORITMO = "HS256"
SCOPE_COMPLETO = "completo"
SCOPE_ENROLAR_MFA = "enrolar_mfa"
SCOPES = {SCOPE_COMPLETO, SCOPE_ENROLAR_MFA}
TOLERANCIA_RELOJ = 120  # segundos: absorbe un ajuste del reloj (NTP, VMware) sin aceptar tokens del futuro lejano


class TokenInvalido(Exception):
    pass


@dataclass(frozen=True)
class Claims:
    usuario_id: int
    sesion_id: str
    scope: str
    expira: int


def emitir_access(clave, usuario_id, sesion_id, scope, ahora: datetime, ttl_segundos: int, emisor: str) -> str:
    if scope not in SCOPES:
        raise ValueError(f"scope desconocido: {scope}")
    ts = int(ahora.timestamp())
    return jwt.encode(
        {"iss": emisor, "sub": str(usuario_id), "sid": str(sesion_id), "scope": scope,
         "iat": ts, "exp": ts + ttl_segundos, "jti": uuid.uuid4().hex},
        clave, algorithm=ALGORITMO,
    )


def decodificar_access(clave, token: str, ahora: datetime, emisor: str) -> Claims:
    try:
        datos = jwt.decode(
            token, clave, algorithms=[ALGORITMO], issuer=emisor,
            # Los tiempos se validan abajo con el reloj inyectado (no el de la librería)
            options={"require": ["exp", "iat", "sub", "sid", "scope", "iss"], "verify_exp": False, "verify_iat": False},
        )
        if int(datos["exp"]) <= int(ahora.timestamp()):
            raise TokenInvalido("token vencido")
        if int(datos["iat"]) > int(ahora.timestamp()) + TOLERANCIA_RELOJ:
            raise TokenInvalido("token emitido en el futuro")
        if datos["scope"] not in SCOPES:
            raise TokenInvalido("scope desconocido")
        return Claims(usuario_id=int(datos["sub"]), sesion_id=str(datos["sid"]), scope=datos["scope"], expira=int(datos["exp"]))
    except TokenInvalido:
        raise
    except (jwt.PyJWTError, ValueError, KeyError, TypeError) as error:
        raise TokenInvalido(type(error).__name__) from error


def nuevo_refresh() -> str:
    return secrets.token_urlsafe(48)


def hash_refresh(token: str) -> str:
    """El token tiene 384 bits de entropía: un hash simple basta (no hay nada que adivinar por fuerza bruta)."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()
