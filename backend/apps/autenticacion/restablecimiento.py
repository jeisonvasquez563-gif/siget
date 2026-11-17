"""Códigos de restablecimiento de contraseña (lógica pura, reloj inyectado).

Un operador de identidades emite un código de UN solo uso y lo entrega a la persona por un canal externo (no hay correo en el
laboratorio). El código en claro solo existe en la respuesta que lo emite y en manos de la persona: en la base queda su SHA-256.
Tiene 60 bits de entropía (12 caracteres de un alfabeto sin ambigüedades) y vence a los 15 minutos, así que adivinarlo no es viable.
"""
import hashlib
import re
import secrets
from datetime import datetime, timedelta
from typing import Optional

VIGENCIA = timedelta(minutes=15)
# Sin 0/O/1/I/L: se lee y se dicta por teléfono sin confundirse
ALFABETO = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
LARGO = 12


def nuevo_codigo() -> str:
    """Devuelve un código aleatorio con formato XXXX-XXXX-XXXX."""
    crudo = "".join(secrets.choice(ALFABETO) for _ in range(LARGO))
    return "-".join(crudo[i:i + 4] for i in range(0, LARGO, 4))


def normalizar(codigo) -> Optional[str]:
    """Quita guiones y espacios y pasa a mayúsculas; devuelve None si no tiene la forma de un código."""
    if not isinstance(codigo, str):
        return None
    limpio = re.sub(r"[\s\-]", "", codigo).upper()
    return limpio if len(limpio) == LARGO and all(c in ALFABETO for c in limpio) else None


def huella(codigo_normalizado: str) -> str:
    return hashlib.sha256(codigo_normalizado.encode()).hexdigest()


def vigente(vence_en: datetime, usado_en: Optional[datetime], ahora: datetime) -> bool:
    return usado_en is None and ahora < vence_en
