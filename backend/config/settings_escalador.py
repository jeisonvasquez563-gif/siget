"""Configuración del temporizador de escalamiento (manage.py escalar_vencidos).

Mínimo privilegio: ese contenedor NO recibe la clave de Django, la de los JWT ni la que cifra los secretos del segundo
factor, porque no firma, no emite tokens ni descifra nada; solo ejecuta siget.escalar_vencidos() con escalador_role.
Django exige esas claves para arrancar, así que aquí se generan al azar en cada ejecución y se descartan.
"""
import os
import secrets

from cryptography.fernet import Fernet

for nombre in ("SIGET_SECRET_KEY", "SIGET_JWT_KEY", "SIGET_MFA_KEY"):
    if os.environ.get(nombre) or os.environ.get(f"{nombre}_FILE"):
        raise RuntimeError(f"{nombre} no debe llegar al temporizador de escalamiento")
os.environ["SIGET_SECRET_KEY"] = secrets.token_urlsafe(48)
os.environ["SIGET_JWT_KEY"] = secrets.token_urlsafe(48)
os.environ["SIGET_MFA_KEY"] = Fernet.generate_key().decode()

from config.settings import *  # noqa: E402,F401,F403
