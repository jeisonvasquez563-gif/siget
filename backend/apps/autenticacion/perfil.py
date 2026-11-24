"""Datos personales de quien se registra: validación y protección de la cédula (lógica pura, reloj inyectado).

La validación del servidor es la que manda; la interfaz solo ayuda. Los mensajes dicen QUÉ campo falla, nunca si un dato ya
existe en otra cuenta (eso se respondería igual que un usuario repetido, para no revelar quién está registrado).
"""
import base64
import hashlib
import hmac
import re
from datetime import date
from typing import Optional

from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

# Provincias y comarcas indígenas de Panamá (la comarca equivale a una provincia en la división política)
PROVINCIAS = [
    "Bocas del Toro", "Chiriquí", "Coclé", "Colón", "Darién", "Herrera", "Los Santos", "Panamá", "Panamá Oeste", "Veraguas",
    "Comarca Guna Yala", "Comarca Emberá-Wounaan", "Comarca Ngäbe-Buglé",
]
EDAD_MINIMA = 18
EDAD_MAXIMA = 120

# Letras (con tildes y ñ), espacios, apóstrofo y guion; sin dígitos ni símbolos
_NOMBRE_RE = re.compile(r"^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+(?:[ '\-][A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+)*$")
# Cédula panameña: provincia (1-13) o letra (E, N, PE, PI…) - tomo - asiento. Ej.: 8-123-456, 4-1234-56789, PE-12-345, E-8-12345
_CEDULA_RE = re.compile(r"^(?:(?:1[0-3]|[1-9])|(?:[0-9]{1,2}(?:AV|PI))|E|N|PE)-[0-9]{1,4}-[0-9]{1,6}$")
_CORREO_RE = re.compile(r"^[A-Za-z0-9._%+\-]+@[A-Za-z0-9\-]+(?:\.[A-Za-z0-9\-]+)*\.[A-Za-z]{2,}$")


def _texto(valor) -> str:
    return valor.strip() if isinstance(valor, str) else ""


def normalizar_cedula(valor) -> str:
    """Mayúsculas y sin espacios; acepta guiones o espacios como separadores. Ej.: «8 123 456» → «8-123-456»."""
    texto = _texto(valor).upper()
    return re.sub(r"[\s]+", "-", texto)


def _edad(nacimiento: date, hoy: date) -> int:
    return hoy.year - nacimiento.year - ((hoy.month, hoy.day) < (nacimiento.month, nacimiento.day))


# --------------------------------------------------------------------------- campos de contacto (registro y corrección)
# Los mismos validadores sirven al registro y a la corrección de «Mis datos» (PT-15): no pueden diferir.

def validar_provincia(valor):
    """Devuelve (provincia_normalizada, error|None)."""
    provincia = _texto(valor)
    if not provincia:
        return provincia, "falta la provincia"
    if provincia not in PROVINCIAS:
        return provincia, "la provincia no es una de las de Panamá"
    return provincia, None


def validar_ciudad(valor):
    """Devuelve (ciudad_normalizada, error|None)."""
    ciudad = _texto(valor)
    if not ciudad:
        return ciudad, "falta la ciudad"
    if len(ciudad) > 60 or not re.match(r"^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9 .'\-]+$", ciudad):
        return ciudad, "la ciudad solo admite letras, números, espacios y signos simples (hasta 60 caracteres)"
    return ciudad, None


def validar_correo(valor):
    """Devuelve (correo_en_minúsculas, error|None)."""
    correo = _texto(valor).lower()
    if not correo:
        return correo, "falta el correo"
    if len(correo) > 254 or not _CORREO_RE.match(correo):
        return correo, "el correo no tiene un formato válido"
    return correo, None


CAMPOS_CORREGIBLES = ("correo", "provincia", "ciudad")
_VALIDADORES_CONTACTO = {"correo": validar_correo, "provincia": validar_provincia, "ciudad": validar_ciudad}


def validar_correccion(datos):
    """Corrección de «Mis datos»: solo correo, provincia y ciudad (los demás datos van por una solicitud de rectificación).

    Devuelve (campos_normalizados, errores). Exige al menos un campo; un campo ajeno a esos tres es un error, no se ignora."""
    if not isinstance(datos, dict) or not datos:
        return None, ["indica al menos un dato a corregir: correo, provincia o ciudad"]
    errores = []
    ajenos = sorted(str(k) for k in datos if k not in CAMPOS_CORREGIBLES)
    if ajenos:
        errores.append("estos datos no se corrigen aquí (pide una rectificación): " + ", ".join(ajenos))
    campos = {}
    for nombre in CAMPOS_CORREGIBLES:
        if nombre in datos:
            valor, error = _VALIDADORES_CONTACTO[nombre](datos[nombre])
            if error:
                errores.append(error)
            else:
                campos[nombre] = valor
    return (None, errores) if errores else (campos, [])


def validar(datos: dict, hoy: date):
    """Devuelve (perfil_normalizado, errores). `errores` es una lista de frases; si no está vacía, no se crea la cuenta."""
    errores = []
    nombre, apellidos = _texto(datos.get("nombre")), _texto(datos.get("apellidos"))
    for etiqueta, valor, maximo in (("el nombre", nombre, 60), ("los apellidos", apellidos, 80)):
        if not valor:
            errores.append(f"falta {etiqueta}")
        elif len(valor) > maximo or not _NOMBRE_RE.match(valor):
            errores.append(f"{etiqueta} solo admite letras, espacios, guion y apóstrofo (hasta {maximo} caracteres)")

    cedula = normalizar_cedula(datos.get("cedula"))
    if not cedula:
        errores.append("falta la cédula")
    elif not _CEDULA_RE.match(cedula):
        errores.append("la cédula no tiene un formato válido (por ejemplo 8-123-456, PE-12-345 o E-8-12345)")

    nacimiento = None
    bruto = _texto(datos.get("fecha_nacimiento"))
    if not bruto:
        errores.append("falta la fecha de nacimiento")
    else:
        try:
            nacimiento = date.fromisoformat(bruto)
        except ValueError:
            errores.append("la fecha de nacimiento no es válida (use AAAA-MM-DD)")
    if nacimiento is not None:
        if nacimiento > hoy:
            errores.append("la fecha de nacimiento no puede ser futura")
        elif _edad(nacimiento, hoy) < EDAD_MINIMA:
            errores.append(f"hay que tener al menos {EDAD_MINIMA} años para crear una cuenta")
        elif _edad(nacimiento, hoy) > EDAD_MAXIMA:
            errores.append("la fecha de nacimiento no es creíble")

    provincia, error_provincia = validar_provincia(datos.get("provincia"))
    ciudad, error_ciudad = validar_ciudad(datos.get("ciudad"))
    correo, error_correo = validar_correo(datos.get("correo"))
    errores += [e for e in (error_provincia, error_ciudad, error_correo) if e]

    if errores:
        return None, errores
    return {"nombre": nombre, "apellidos": apellidos, "cedula": cedula, "fecha_nacimiento": nacimiento,
            "provincia": provincia, "ciudad": ciudad, "correo": correo}, []


# --------------------------------------------------------------------------- protección de la cédula

def _clave_derivada(clave_maestra: str, contexto: bytes) -> bytes:
    """Una clave distinta por propósito, derivada (HKDF) de la clave maestra: así no se reutiliza la del segundo factor tal cual."""
    return HKDF(algorithm=hashes.SHA256(), length=32, salt=None, info=contexto).derive(clave_maestra.encode())


def cifrar_cedula(clave_maestra: str, cedula: str) -> str:
    clave = base64.urlsafe_b64encode(_clave_derivada(clave_maestra, b"siget/perfil/cedula/cifrado"))
    return Fernet(clave).encrypt(cedula.encode()).decode()


def descifrar_cedula(clave_maestra: str, cifrada: str) -> Optional[str]:
    clave = base64.urlsafe_b64encode(_clave_derivada(clave_maestra, b"siget/perfil/cedula/cifrado"))
    try:
        return Fernet(clave).decrypt(cifrada.encode()).decode()
    except InvalidToken:
        return None


def enmascarar_cedula(cedula: Optional[str], visibles: int = 3) -> Optional[str]:
    """Deja visibles solo los últimos `visibles` caracteres alfanuméricos y respeta los guiones: «8-123-456» → «*-***-456».
    La cédula completa solo sale en la exportación (que exige segundo factor reciente)."""
    if cedula is None:
        return None
    restantes = sum(c.isalnum() for c in cedula)
    salida = []
    for c in cedula:
        if c.isalnum():
            restantes -= 1
            salida.append(c if restantes < visibles else "*")
        else:
            salida.append(c)
    return "".join(salida)


def huella_cedula(clave_maestra: str, cedula: str) -> str:
    """HMAC-SHA256 (hex, 64 caracteres): sirve para detectar una cédula repetida sin guardarla en claro."""
    return hmac.new(_clave_derivada(clave_maestra, b"siget/perfil/cedula/huella"), cedula.encode(), hashlib.sha256).hexdigest()
