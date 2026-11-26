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
    "catalogo_institucion": ("Catálogo de la institución", "Los trámites que ofrece tu institución: crea, edita, activa o desactiva, y consulta quién cambió qué.", DISPONIBLE),
    "mis_datos": ("Mis datos", "Consulta, corrige y descarga tus datos personales (Ley 81) y envía solicitudes sobre ellos.", DISPONIBLE),
    "seguridad": ("Mi seguridad", "Tu rol, tus instituciones, tu segundo factor y lo que Zero Trust te permite.", DISPONIBLE),
    "mfa": ("Segundo factor (MFA)", "Cómo se protege tu cuenta con un código que cambia cada 30 segundos, y tu actividad reciente.", DISPONIBLE),
    "prueba_acceso": ("Acceso a trámites", "Comprueba en vivo que tu rol de plataforma no puede ver trámites.", DISPONIBLE),
    "consola_infraestructura": ("Infraestructura", "Estado de la base de datos y del servicio, y vencimiento del certificado (solo lectura).", DISPONIBLE),
    "consola_identidades": ("Identidades", "Restablece contraseñas y segundo factor, y da de alta a las coordinadoras con control dual.", DISPONIBLE),
    "consola_catalogo": ("Catálogo", "Alta de instituciones con control dual.", DISPONIBLE),
    "consola_seguridad": ("Respuesta a incidentes", "Bloquea cuentas, revoca sesiones, mira los eventos de seguridad y revisa las alertas.", DISPONIBLE),
    "consola_secretos": ("Custodia de secretos", "Registra la rotación de secretos y avisa cuándo toca.", DISPONIBLE),
    "auditoria": ("Auditoría", "Consulta del registro inalterable de eventos y de decisiones de acceso, y de las alertas de seguridad.", DISPONIBLE),
}

_POR_ROL_PLATAFORMA = {
    "operador_infraestructura": ["consola_infraestructura"],
    "operador_identidades": ["consola_identidades"],
    "operador_catalogo": ["consola_catalogo"],
    "operador_seguridad": ["consola_seguridad"],
    "custodio_secretos": ["consola_secretos"],
    "auditor": ["auditoria"],
}


# Todas las personas pueden ver su propia seguridad y cómo funciona el segundo factor (transparencia)
_TRANSPARENCIA = ["seguridad", "mfa"]


def _entrada(identificador):
    nombre, descripcion, estado = CATALOGO[identificador]
    return {"id": identificador, "nombre": nombre, "descripcion": descripcion, "estado": estado}


def modulos_para(rol_plataforma, roles_en_instituciones):
    """`roles_en_instituciones`: los roles (texto) que la persona tiene en cualquier institución."""
    if rol_plataforma != "ninguno":
        # Un rol de plataforma excluye al resto (lo impone la base): sin trámites, solo su consola
        ids = _POR_ROL_PLATAFORMA.get(rol_plataforma, []) + ["prueba_acceso", *_TRANSPARENCIA]
        return [_entrada(i) for i in ids]
    roles = set(roles_en_instituciones)
    ids = ["mis_tramites", "nuevo_tramite", "mis_datos"]  # las cuentas de plataforma no tienen perfil de persona: no lo ven
    if roles & {"funcionario", "supervisor"}:
        ids.append("bandeja")
    if "supervisor" in roles:
        ids.append("supervision")
    if roles & {"supervisor", "coordinador_institucional"}:
        ids.append("equipo")
    if "coordinador_institucional" in roles:
        ids.append("catalogo_institucion")  # solo la coordinación gestiona el catálogo; el PDP lo vuelve a decidir en cada petición
    ids.extend(_TRANSPARENCIA)
    return [_entrada(i) for i in ids]
