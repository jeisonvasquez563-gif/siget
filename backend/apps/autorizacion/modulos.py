"""Qué módulos de la plataforma le corresponden a cada persona.

Es solo la ayuda para armar el menú: la interfaz NUNCA decide qué se puede hacer. Cada petición vuelve a pasar por el
PDP y por la base (RLS), así que un módulo mostrado de más no abre ningún acceso. Python puro, sin base de datos.
"""
DISPONIBLE, PROXIMAMENTE = "disponible", "proximamente"

CATALOGO = {
    "mis_tramites": ("Mis trámites", "Consulta el estado y el historial de los trámites que iniciaste.", DISPONIBLE),
    "nuevo_tramite": ("Iniciar un trámite", "Elige una institución y un trámite del catálogo.", DISPONIBLE),
    "bandeja": ("Bandeja de la institución", "Trámites de tu institución: revisarlos y cambiar su estado.", DISPONIBLE),
    "supervision": ("Supervisión", "Reasigna trámites y atiende los escalados de tu institución.", DISPONIBLE),
    "equipo": ("Equipo de la institución", "Personal y roles de tu institución.", DISPONIBLE),
    "seguridad": ("Mi seguridad", "Tu rol, tus instituciones, tu segundo factor y lo que Zero Trust te permite.", DISPONIBLE),
    "prueba_acceso": ("Acceso a trámites", "Comprueba en vivo que tu rol de plataforma no puede ver trámites.", DISPONIBLE),
    "consola_infraestructura": ("Infraestructura", "Estado de los servidores y contenedores.", PROXIMAMENTE),
    "consola_identidades": ("Identidades", "Alta de coordinadores y restablecimiento del segundo factor (control dual).", PROXIMAMENTE),
    "consola_catalogo": ("Catálogo", "Alta de instituciones y de trámites (control dual).", PROXIMAMENTE),
    "consola_seguridad": ("Respuesta a incidentes", "Bloqueo de cuentas y revocación de sesiones.", PROXIMAMENTE),
    "consola_secretos": ("Custodia de secretos", "Rotación de claves y certificados.", PROXIMAMENTE),
    "auditoria": ("Auditoría", "Consulta del registro inalterable de eventos y de decisiones de acceso.", DISPONIBLE),
}

_POR_ROL_PLATAFORMA = {
    "operador_infraestructura": ["consola_infraestructura"],
    "operador_identidades": ["consola_identidades"],
    "operador_catalogo": ["consola_catalogo"],
    "operador_seguridad": ["consola_seguridad"],
    "custodio_secretos": ["consola_secretos"],
    "auditor": ["auditoria"],
}


def _entrada(identificador):
    nombre, descripcion, estado = CATALOGO[identificador]
    return {"id": identificador, "nombre": nombre, "descripcion": descripcion, "estado": estado}


def modulos_para(rol_plataforma, roles_en_instituciones):
    """`roles_en_instituciones`: los roles (texto) que la persona tiene en cualquier institución."""
    if rol_plataforma != "ninguno":
        # Un rol de plataforma excluye al resto (lo impone la base): sin trámites, solo su consola
        ids = _POR_ROL_PLATAFORMA.get(rol_plataforma, []) + ["prueba_acceso", "seguridad"]
        return [_entrada(i) for i in ids]
    roles = set(roles_en_instituciones)
    ids = ["mis_tramites", "nuevo_tramite"]
    if roles & {"funcionario", "supervisor"}:
        ids.append("bandeja")
    if "supervisor" in roles:
        ids.append("supervision")
    if roles & {"supervisor", "coordinador_institucional"}:
        ids.append("equipo")
    ids.append("seguridad")
    return [_entrada(i) for i in ids]
