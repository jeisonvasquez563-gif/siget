"""Gestión del equipo de una institución: la coordinación asigna y quita personal (funcionarios y supervisores).

Reglas (las impone el PDP en la vista y, debajo, la base de datos):
- Solo la coordinación de ESA institución, con segundo factor reciente. Nadie se asigna ni se quita a sí mismo.
- La coordinación no gestiona coordinaciones: esas las da de alta la plataforma con control dual.
- Quitar a alguien es REVOCAR su membresía (no se borra): queda quién dio el acceso y quién lo quitó. Surte efecto de inmediato
  porque cada petición vuelve a leer las membresías vigentes.
- No se puede quitar a quien aún tiene trámites abiertos asignados: la coordinación no ve trámites (seguridad por filas), así que
  solo recibe un conteo de una función de la base y debe pedirle a supervisión que los reasigne primero.
"""
from django.db import connection, transaction
from django.utils import timezone

from apps.autenticacion.servicio import Resultado, registrar_evento
from apps.catalogo.models import Institucion

from .models import Membresia, Usuario

ROLES_GESTIONABLES = ("funcionario", "supervisor")


def rol_valido(rol) -> bool:
    return isinstance(rol, str) and rol in ROLES_GESTIONABLES


def otro_rol(rol):
    return "supervisor" if rol == "funcionario" else "funcionario"


def dar_rol(persona, institucion, rol, por):
    """Crea la membresía o reactiva una revocada (la clave primaria es persona + institución + rol)."""
    fila = Membresia.todas.filter(usuario=persona, institucion=institucion, rol=rol).first()
    if fila is None:
        Membresia.todas.create(usuario=persona, institucion=institucion, rol=rol, asignado_por=por)
    elif fila.revocada_en is not None:
        Membresia.todas.filter(usuario=persona, institucion=institucion, rol=rol).update(revocada_en=None, revocada_por=None, asignado_por=por)


def _revocar(persona, institucion, roles, por):
    Membresia.objects.filter(usuario=persona, institucion=institucion, rol__in=roles).update(revocada_en=timezone.now(), revocada_por=por)


def tramites_abiertos(persona_id, institucion_id) -> int:
    """Solo un número: la función de la base no devuelve nada más (la coordinación no ve trámites)."""
    with connection.cursor() as c:
        c.execute("select siget.tramites_abiertos_de(%s, %s)", [persona_id, institucion_id])
        return c.fetchone()[0]


def _contexto(institucion_id):
    return Institucion.objects.filter(pk=institucion_id).first()


def agregar(coordinador, institucion_id, username, rol, ip):
    institucion = _contexto(institucion_id)
    if institucion is None:
        return Resultado(False, "no_existe")
    if not rol_valido(rol):
        return Resultado(False, "datos_invalidos", detalle={"errores": ["el rol debe ser «funcionario» o «supervisor»"]})
    username = username.strip().lower() if isinstance(username, str) else ""
    persona = Usuario.objects.filter(username=username).first() if username else None
    errores = []
    if persona is None:
        errores.append("no existe esa persona")
    elif persona.pk == coordinador.pk:
        return Resultado(False, "no_a_si_mismo")
    elif persona.rol_plataforma != "ninguno":
        errores.append("una cuenta de plataforma no puede ser personal de una institución")
    elif persona.estado_cuenta != "activa":
        errores.append("la cuenta no está activa")
    elif Membresia.objects.filter(usuario=persona, institucion=institucion, rol=rol).exists():
        errores.append(f"ya es {rol} de esta institución")
    if errores:
        return Resultado(False, "datos_invalidos", detalle={"errores": errores})
    with transaction.atomic():
        dar_rol(persona, institucion, rol, coordinador)
        registrar_evento(coordinador.pk, "equipo_miembro_agregado", ip, {"objetivo": persona.pk, "institucion": institucion.pk, "rol": rol})
    return Resultado(True, "miembro_agregado")


def cambiar_rol(coordinador, institucion_id, persona_id, rol_nuevo, ip):
    institucion = _contexto(institucion_id)
    persona = Usuario.objects.filter(pk=persona_id).first()
    if institucion is None or persona is None:
        return Resultado(False, "no_existe")
    if not rol_valido(rol_nuevo):
        return Resultado(False, "datos_invalidos", detalle={"errores": ["el rol debe ser «funcionario» o «supervisor»"]})
    if persona.pk == coordinador.pk:
        return Resultado(False, "no_a_si_mismo")
    if not Membresia.objects.filter(usuario=persona, institucion=institucion, rol=otro_rol(rol_nuevo)).exists():
        return Resultado(False, "no_corresponde")  # no es personal con el otro rol
    with transaction.atomic():
        dar_rol(persona, institucion, rol_nuevo, coordinador)
        _revocar(persona, institucion, [otro_rol(rol_nuevo)], coordinador)
        registrar_evento(coordinador.pk, "equipo_rol_cambiado", ip, {"objetivo": persona.pk, "institucion": institucion.pk, "de": otro_rol(rol_nuevo), "a": rol_nuevo})
    return Resultado(True, "rol_cambiado")


def quitar(coordinador, institucion_id, persona_id, ip):
    institucion = _contexto(institucion_id)
    persona = Usuario.objects.filter(pk=persona_id).first()
    if institucion is None or persona is None:
        return Resultado(False, "no_existe")
    if persona.pk == coordinador.pk:
        return Resultado(False, "no_a_si_mismo")
    roles = list(Membresia.objects.filter(usuario=persona, institucion=institucion, rol__in=ROLES_GESTIONABLES).values_list("rol", flat=True))
    if not roles:
        return Resultado(False, "no_corresponde")
    abiertos = tramites_abiertos(persona.pk, institucion.pk)
    if abiertos:
        return Resultado(False, "tiene_tramites_abiertos", detalle={"tramites_abiertos": abiertos})
    with transaction.atomic():
        _revocar(persona, institucion, roles, coordinador)
        registrar_evento(coordinador.pk, "equipo_miembro_quitado", ip, {"objetivo": persona.pk, "institucion": institucion.pk, "roles": sorted(roles)})
    return Resultado(True, "miembro_quitado")
