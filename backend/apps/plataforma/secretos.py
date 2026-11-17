"""Qué secretos tiene SIGET, cada cuánto conviene rotarlos y en qué estado están (lógica pura, reloj inyectado).

Aquí NUNCA hay valores: solo nombres y fechas. El custodio de secretos registra cuándo rotó cada uno; este módulo dice si toca.
"""
from datetime import date, datetime, timedelta
from typing import Optional

# id -> (nombre para mostrar, frecuencia recomendada en días, dónde vive)
SECRETOS = {
    "jwt": ("Clave de firma de los tokens (JWT)", 90, "podman secret siget-jwt-key"),
    "mfa": ("Clave de cifrado del segundo factor y de las cédulas", 180, "podman secret siget-mfa-key"),
    "db_app": ("Contraseña de la base para la aplicación (app_role)", 180, "podman secret siget-db-app-password"),
    "db_auditor": ("Contraseña de la base para auditoría (auditor_role)", 180, "podman secret siget-db-auditor-password"),
    "django": ("Clave secreta de Django", 365, "podman secret siget-django-key"),
    "cert_nginx": ("Certificado TLS de nginx", 365, "podman secrets siget-nginx-crt y siget-nginx-key"),
    "cert_postgres": ("Certificado TLS de PostgreSQL", 365, "podman secrets siget-pg-tls-crt y siget-pg-tls-key"),
    "ca": ("Autoridad certificadora interna", 1825, "/root/siget-ca (VM2) y secreto siget-ca"),
}
AVISO_DIAS = 30  # se marca «por vencer» cuando faltan menos de estos días


def estado(ultima: Optional[datetime], frecuencia_dias: int, ahora: datetime) -> dict:
    """«sin_registro» si nunca se anotó una rotación; «vencida» si pasó la frecuencia; «por_vencer» si faltan <30 días; si no, «al_dia»."""
    if ultima is None:
        return {"estado": "sin_registro", "dias_restantes": None}
    restantes = (ultima + timedelta(days=frecuencia_dias) - ahora).days
    if restantes < 0:
        return {"estado": "vencida", "dias_restantes": restantes}
    return {"estado": "por_vencer" if restantes < AVISO_DIAS else "al_dia", "dias_restantes": restantes}


def dias_hasta(fecha: date, hoy: date) -> int:
    return (fecha - hoy).days
