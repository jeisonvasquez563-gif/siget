"""Configuración solo para las pruebas: define una clave de prueba y reutiliza el resto."""
import os

os.environ.setdefault("SIGET_SECRET_KEY", "clave-solo-para-pruebas-no-usar-en-ningun-entorno")
os.environ.setdefault("SIGET_DEBUG", "true")
os.environ.setdefault("SIGET_JWT_KEY", "clave-jwt-solo-para-pruebas-0123456789-abcdef")
from cryptography.fernet import Fernet  # noqa: E402

os.environ.setdefault("SIGET_MFA_KEY", Fernet.generate_key().decode())

from config.settings import *  # noqa: E402,F401,F403
