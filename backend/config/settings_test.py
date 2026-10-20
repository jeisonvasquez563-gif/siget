"""Configuración solo para las pruebas: define una clave de prueba y reutiliza el resto."""
import os

os.environ.setdefault("SIGET_SECRET_KEY", "clave-solo-para-pruebas-no-usar-en-ningun-entorno")
os.environ.setdefault("SIGET_DEBUG", "true")

from config.settings import *  # noqa: E402,F401,F403
