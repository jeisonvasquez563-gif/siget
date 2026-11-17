"""Bloqueo progresivo por intentos fallidos (lógica pura, reloj inyectado).

3 fallos seguidos (de contraseña o de código) bloquean la cuenta. Cada bloqueo seguido dura más: 5 minutos, luego 15 y luego 60.
La escalera se reinicia con un inicio de sesión exitoso (o tras 24 horas sin bloqueos), así una persona legítima que se equivocó
alguna vez no queda castigada, y quien insiste adivinando se encuentra con esperas cada vez más largas.
Cuántos bloqueos lleva una cuenta lo calcula el servicio a partir de los eventos de seguridad (inalterables), sin columnas nuevas.
"""
from datetime import datetime, timedelta
from typing import Optional

MAX_INTENTOS = 3
ESCALONES = (timedelta(minutes=5), timedelta(minutes=15), timedelta(minutes=60))
DURACION = ESCALONES[0]  # el primer bloqueo
MEMORIA = timedelta(hours=24)  # los bloqueos más viejos que esto ya no cuentan


def esta_bloqueado(bloqueado_hasta: Optional[datetime], ahora: datetime) -> bool:
    return bloqueado_hasta is not None and bloqueado_hasta > ahora


def duracion(bloqueos_previos: int) -> timedelta:
    """Cuánto dura el próximo bloqueo según cuántos lleva la cuenta (el último escalón se repite)."""
    return ESCALONES[min(max(bloqueos_previos, 0), len(ESCALONES) - 1)]


def tras_fallo(intentos: int, ahora: datetime, bloqueos_previos: int = 0):
    """Devuelve (nuevos_intentos, bloqueado_hasta). Al bloquear, el contador de intentos vuelve a cero."""
    nuevos = intentos + 1
    if nuevos >= MAX_INTENTOS:
        return 0, ahora + duracion(bloqueos_previos)
    return nuevos, None
