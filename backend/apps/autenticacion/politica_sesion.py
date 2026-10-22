"""Cuánto puede durar una sesión (lógica pura, reloj inyectado).

Dos límites que el servidor impone sin confiar en el navegador (Zero Trust: la sesión se evalúa en cada renovación):

- Inactividad: el token de refresco solo se usa cuando el de acceso (10 min) caduca y la persona sigue actuando. Si pasó más
  tiempo del permitido desde que se emitió, nadie estaba usando la sesión y se rechaza.
- Duración absoluta: cada renovación hereda el vencimiento de la sesión original, así que una sesión no se puede prolongar
  indefinidamente renovándola (antes cada rotación sumaba otras 8 horas).
"""
from datetime import datetime, timedelta


def inactiva(creado_en: datetime, ahora: datetime, max_edad_segundos: int) -> bool:
    return ahora - creado_en > timedelta(seconds=max_edad_segundos)


def vencimiento_heredado(vencimiento_anterior: datetime, ahora: datetime, ttl_segundos: int) -> datetime:
    """La renovación nunca vence después que la sesión de la que viene."""
    return min(vencimiento_anterior, ahora + timedelta(seconds=ttl_segundos))
