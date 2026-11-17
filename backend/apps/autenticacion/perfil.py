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

    provincia = _texto(datos.get("provincia"))
    if not provincia:
        errores.append("falta la provincia")
    elif provincia not in PROVINCIAS:
        errores.append("la provincia no es una de las de Panamá")

    ciudad = _texto(datos.get("ciudad"))
    if not ciudad:
        errores.append("falta la ciudad")
    elif len(ciudad) > 60 or not re.match(r"^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9 .'\-]+$", ciudad):
        errores.append("la ciudad solo admite letras, números, espacios y signos simples (hasta 60 caracteres)")

    correo = _texto(datos.get("correo")).lower()
    if not correo:
        errores.append("falta el correo")
    elif len(correo) > 254 or not _CORREO_RE.match(correo):
        errores.append("el correo no tiene un formato válido")

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


def huella_cedula(clave_maestra: str, cedula: str) -> str:
    """HMAC-SHA256 (hex, 64 caracteres): sirve para detectar una cédula repetida sin guardarla en claro."""
    return hmac.new(_clave_derivada(clave_maestra, b"siget/perfil/cedula/huella"), cedula.encode(), hashlib.sha256).hexdigest()
