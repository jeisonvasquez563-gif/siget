"""Bloqueo por intentos fallidos: 3 fallos bloquean la cuenta 5 minutos (lógica pura, reloj inyectado)."""
from datetime import datetime, timedelta
from typing import Optional

MAX_INTENTOS = 3
DURACION = timedelta(minutes=5)


def esta_bloqueado(bloqueado_hasta: Optional[datetime], ahora: datetime) -> bool:
    return bloqueado_hasta is not None and bloqueado_hasta > ahora


def tras_fallo(intentos: int, ahora: datetime):
    """Devuelve (nuevos_intentos, bloqueado_hasta). Al bloquear, el contador vuelve a cero."""
    nuevos = intentos + 1
    if nuevos >= MAX_INTENTOS:
        return 0, ahora + DURACION
    return nuevos, None
