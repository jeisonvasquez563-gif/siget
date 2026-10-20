"""Política de contraseñas y hash Argon2. Prima la longitud sobre las reglas de composición (NIST SP 800-63B)."""
from django.contrib.auth.hashers import check_password, make_password
from django.contrib.auth.password_validation import CommonPasswordValidator
from django.core.exceptions import ValidationError

MINIMO = 12
MAXIMO = 128
_comunes = CommonPasswordValidator()
_hash_falso = None
_FILAS = ("qwertyuiop", "asdfghjkl", "zxcvbnm", "1234567890", "abcdefghijklmnopqrstuvwxyz")


def _es_comun(contrasena: str) -> bool:
    """La lista de Django solo compara contraseñas exactas: también se detectan repeticiones de una palabra
    común ("passwordpassword") y secuencias de teclado o de alfabeto de 8 o más caracteres."""
    texto = contrasena.lower()
    candidatas = {contrasena, texto}
    for largo in range(1, len(texto) // 2 + 1):
        if len(texto) % largo == 0 and texto[:largo] * (len(texto) // largo) == texto:
            candidatas.add(texto[:largo])
    for candidata in candidatas:
        try:
            _comunes.validate(candidata)
        except ValidationError:
            return True
    for fila in _FILAS:
        for orden in (fila, fila[::-1]):
            for i in range(len(orden) - 7):
                if orden[i:i + 8] in texto:
                    return True
    return False


def errores_de_contrasena(contrasena, usuario: str):
    errores = []
    if not isinstance(contrasena, str) or len(contrasena) < MINIMO:
        errores.append(f"debe tener al menos {MINIMO} caracteres")
        return errores
    if len(contrasena) > MAXIMO:
        errores.append(f"debe tener como máximo {MAXIMO} caracteres")
    if usuario and usuario.lower() in contrasena.lower():
        errores.append("no puede contener el nombre de usuario")
    if len(set(contrasena)) < 5:
        errores.append("es demasiado repetitiva")
    if _es_comun(contrasena):
        errores.append("es una contraseña demasiado común o una secuencia previsible")
    return errores


def hashear(contrasena: str) -> str:
    return make_password(contrasena)  # Argon2 (único hasher configurado)


def verificar(contrasena: str, hash_guardado: str) -> bool:
    return check_password(contrasena, hash_guardado)


def verificacion_falsa(contrasena: str) -> bool:
    """Gasta el mismo tiempo que una verificación real cuando el usuario no existe (evita medir por tiempo)."""
    global _hash_falso
    if _hash_falso is None:
        _hash_falso = make_password("contraseña-que-nadie-conoce-0123456789")
    check_password(contrasena, _hash_falso)
    return False
