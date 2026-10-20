"""Comparación entre los modelos y el esquema real de la base (la base es la autoridad)."""
from django.apps import apps as registro_apps

APPS_DE_DOMINIO = {"catalogo", "identidad", "tramites", "auditoria", "autenticacion"}


def columnas_del_modelo(modelo):
    return {campo.column for campo in modelo._meta.concrete_fields if campo.column}


def diferencias(columnas_modelo, columnas_bd):
    """Devuelve (faltan_en_la_base, sobran_en_la_base). Solo lo primero es un error."""
    return sorted(columnas_modelo - columnas_bd), sorted(columnas_bd - columnas_modelo)


def modelos_de_dominio():
    return [m for m in registro_apps.get_models() if m._meta.app_label in APPS_DE_DOMINIO]
