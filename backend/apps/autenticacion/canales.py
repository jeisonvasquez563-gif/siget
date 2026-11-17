"""Las tres puertas de entrada de SIGET (lógica pura).

- «ciudadania»: la puerta pública. Cualquiera puede crear una cuenta; solo entra quien NO es personal de una institución.
- «institucion»: el personal (funcionario, supervisor, coordinación) entra eligiendo SU institución; el servidor comprueba que
  de verdad pertenezca a ella. Nadie se registra aquí: el acceso lo da la coordinación.
- «plataforma»: los operadores de plataforma y el auditor.

La puerta no da ningún permiso (los permisos los decide el PDP en cada petición): solo evita entrar por la puerta equivocada y deja
constancia de por cuál se entró. Se comprueba DESPUÉS de validar contraseña y segundo factor, así que no revela nada a quien no tiene
las credenciales. Un cliente de la API que no manda `canal` entra como siempre.
"""
from typing import Iterable, Optional

CIUDADANIA, INSTITUCION, PLATAFORMA = "ciudadania", "institucion", "plataforma"
CANALES = (CIUDADANIA, INSTITUCION, PLATAFORMA)
ROLES_DE_PERSONAL = {"funcionario", "supervisor", "coordinador_institucional"}


def instituciones_del_personal(membresias: Iterable) -> set:
    """`membresias`: pares (rol, institucion_id)."""
    return {institucion for rol, institucion in membresias if rol in ROLES_DE_PERSONAL}


def canal_de(rol_plataforma: str, membresias: Iterable) -> str:
    """La puerta que le corresponde a una persona."""
    if rol_plataforma != "ninguno":
        return PLATAFORMA
    return INSTITUCION if instituciones_del_personal(membresias) else CIUDADANIA


def permitido(canal: Optional[str], institucion_id, rol_plataforma: str, membresias: Iterable) -> bool:
    """¿Puede esta persona entrar por esta puerta? `canal=None` (clientes de la API) siempre entra como antes."""
    if canal is None:
        return True
    if canal not in CANALES:
        return False
    membresias = list(membresias)
    if canal_de(rol_plataforma, membresias) != canal:
        return False
    if canal == INSTITUCION:
        return isinstance(institucion_id, int) and not isinstance(institucion_id, bool) and institucion_id in instituciones_del_personal(membresias)
    return True
