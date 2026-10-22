"""Punto de decisión de acceso (PDP) de SIGET: ABAC con denegar por defecto.

Modelo NIST SP 800-162 / 800-207. La decisión se toma con atributos del sujeto, del recurso y del
entorno. Python puro: sin base de datos, para que sea fácil de probar y de razonar.

Orden de evaluación:
1. Reglas de denegación (anulan todo lo demás).
2. Reglas de permiso (alguna debe permitir).
3. Si ninguna permite, se deniega. Si algo falla, también se deniega (*fail closed*).
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timedelta
from enum import Enum
from typing import Callable, Optional

registro = logging.getLogger("siget.pdp")


class Accion(str, Enum):
    VER_TRAMITE = "ver_tramite"
    CREAR_TRAMITE = "crear_tramite"
    CAMBIAR_ESTADO = "cambiar_estado"
    REASIGNAR_TRAMITE = "reasignar_tramite"
    ESCALAR_TRAMITE = "escalar_tramite"
    ADJUNTAR_DOCUMENTO = "adjuntar_documento"
    VER_DOCUMENTO = "ver_documento"
    GESTIONAR_USUARIOS_INSTITUCION = "gestionar_usuarios_institucion"
    GESTIONAR_CATALOGO_INSTITUCION = "gestionar_catalogo_institucion"
    PROPONER_ALTA = "proponer_alta"
    APROBAR_ALTA = "aprobar_alta"
    ADMINISTRAR_INFRAESTRUCTURA = "administrar_infraestructura"
    RESTABLECER_MFA = "restablecer_mfa"
    BLOQUEAR_CUENTA = "bloquear_cuenta"
    REVOCAR_SESION = "revocar_sesion"
    ROTAR_SECRETOS = "rotar_secretos"
    CONSULTAR_AUDITORIA = "consultar_auditoria"
    CONSULTAR_DECISIONES = "consultar_decisiones"


# Transiciones válidas de un trámite (espejo de siget.transicion en la base, que es la autoridad).
TRANSICIONES = {
    "Pendiente": {"En Tramitacion"},
    "En Tramitacion": {"En Subsanacion", "Aprobado", "Rechazado"},
    "En Subsanacion": {"En Tramitacion"},
    "Aprobado": set(),
    "Rechazado": set(),
}

ROLES_PLATAFORMA = {
    "operador_infraestructura", "operador_identidades", "operador_catalogo",
    "operador_seguridad", "custodio_secretos", "auditor",
}


@dataclass(frozen=True)
class Sujeto:
    id: int
    estado_cuenta: str = "activa"
    nivel_aseguramiento: int = 1
    mfa_verificado_en: Optional[datetime] = None
    rol_plataforma: str = "ninguno"
    # (institucion_id, rol), con rol en {funcionario, supervisor, coordinador_institucional}
    membresias: frozenset = frozenset()


@dataclass(frozen=True)
class Recurso:
    tipo: str  # tramite, documento, usuario, tipo_tramite, alta_institucion, alta_coordinador, ...
    institucion_id: Optional[int] = None
    solicitante_id: Optional[int] = None
    funcionario_asignado_id: Optional[int] = None
    estado: Optional[str] = None
    estado_destino: Optional[str] = None
    propuesto_por: Optional[int] = None


@dataclass(frozen=True)
class Entorno:
    ahora: datetime
    mfa_reciente_minutos: int = 15
    mfa_ciudadano_obligatorio: bool = True


@dataclass(frozen=True)
class Decision:
    permitido: bool
    politica: str
    motivo: str = ""


# ----------------------------------------------------------------------------- utilidades

def _mfa_reciente(s: Sujeto, e: Entorno) -> bool:
    if s.mfa_verificado_en is None:
        return False
    return e.ahora - s.mfa_verificado_en <= timedelta(minutes=e.mfa_reciente_minutos)


def _roles_en(s: Sujeto, institucion_id: Optional[int]) -> set:
    if institucion_id is None:
        return set()
    return {rol for (inst, rol) in s.membresias if inst == institucion_id}


def _es_ciudadano(s: Sujeto, e: Entorno) -> bool:
    """Persona sin rol de plataforma. Si el diseño exige MFA al ciudadano, debe haberlo activado."""
    if s.rol_plataforma != "ninguno":
        return False
    return (not e.mfa_ciudadano_obligatorio) or s.mfa_verificado_en is not None


def _sobre_su_tramite(s: Sujeto, r: Recurso) -> bool:
    return r.tipo in {"tramite", "documento"} and r.solicitante_id == s.id


# ----------------------------------------------------------------------------- denegaciones

def _cuenta_activa(s, a, r, e):
    if s.estado_cuenta != "activa":
        return Decision(False, "cuenta_no_activa", f"estado de la cuenta: {s.estado_cuenta}")


def _plataforma_sin_tramites(s, a, r, e):
    if s.rol_plataforma != "ninguno" and r.tipo in {"tramite", "documento"}:
        return Decision(False, "plataforma_sin_acceso_a_tramites",
                        "los roles de plataforma no acceden a trámites ni a documentos")


def _conflicto_de_interes(s, a, r, e):
    if a in {Accion.CAMBIAR_ESTADO, Accion.REASIGNAR_TRAMITE, Accion.ESCALAR_TRAMITE} \
            and r.tipo == "tramite" and r.solicitante_id == s.id:
        return Decision(False, "conflicto_de_interes", "no se gestiona un trámite propio como funcionario")


def _control_dual(s, a, r, e):
    if a == Accion.APROBAR_ALTA and r.propuesto_por == s.id:
        return Decision(False, "control_dual", "quien propone un alta no puede aprobarla")


DENEGACIONES: list[Callable] = [_cuenta_activa, _plataforma_sin_tramites, _conflicto_de_interes, _control_dual]


# ----------------------------------------------------------------------------- permisos

def _ciudadano(s, a, r, e):
    if not _es_ciudadano(s, e):
        return None
    if a == Accion.CREAR_TRAMITE and r.tipo == "tramite" and r.solicitante_id == s.id:
        return Decision(True, "ciudadano_crea_su_tramite")
    if a in {Accion.VER_TRAMITE, Accion.ADJUNTAR_DOCUMENTO, Accion.VER_DOCUMENTO} and _sobre_su_tramite(s, r):
        return Decision(True, "ciudadano_sobre_lo_propio")


def _personal_de_tramites(s, a, r, e):
    roles = _roles_en(s, r.institucion_id)
    if r.tipo not in {"tramite", "documento"} or not roles & {"funcionario", "supervisor"}:
        return None
    if a in {Accion.VER_TRAMITE, Accion.VER_DOCUMENTO}:
        return Decision(True, "personal_ve_su_institucion")
    if not _mfa_reciente(s, e):
        return None  # las acciones que cambian el trámite exigen segundo factor reciente
    if a == Accion.CAMBIAR_ESTADO:
        destino_valido = r.estado in TRANSICIONES and r.estado_destino in TRANSICIONES[r.estado]
        if not destino_valido:
            return None
        if "supervisor" in roles:
            return Decision(True, "supervisor_cambia_estado")
        if r.funcionario_asignado_id in (None, s.id):
            return Decision(True, "funcionario_cambia_estado")
    if a in {Accion.REASIGNAR_TRAMITE, Accion.ESCALAR_TRAMITE} and "supervisor" in roles:
        return Decision(True, "supervisor_reasigna_o_atiende_escalados")


def _coordinador(s, a, r, e):
    if a not in {Accion.GESTIONAR_USUARIOS_INSTITUCION, Accion.GESTIONAR_CATALOGO_INSTITUCION}:
        return None
    if "coordinador_institucional" in _roles_en(s, r.institucion_id) and _mfa_reciente(s, e):
        return Decision(True, "coordinador_gestiona_su_institucion")


_ACCIONES_POR_ROL_PLATAFORMA = {
    "operador_infraestructura": {Accion.ADMINISTRAR_INFRAESTRUCTURA},
    "operador_identidades": {Accion.PROPONER_ALTA, Accion.APROBAR_ALTA, Accion.RESTABLECER_MFA},
    "operador_catalogo": {Accion.PROPONER_ALTA, Accion.APROBAR_ALTA},
    "operador_seguridad": {Accion.BLOQUEAR_CUENTA, Accion.REVOCAR_SESION},
    "custodio_secretos": {Accion.ROTAR_SECRETOS},
}
_ALTAS_POR_ROL = {"operador_identidades": "alta_coordinador", "operador_catalogo": "alta_institucion"}


def _operadores(s, a, r, e):
    acciones = _ACCIONES_POR_ROL_PLATAFORMA.get(s.rol_plataforma)
    if acciones is None or a not in acciones or not _mfa_reciente(s, e):
        return None
    if a in {Accion.PROPONER_ALTA, Accion.APROBAR_ALTA} and r.tipo != _ALTAS_POR_ROL.get(s.rol_plataforma):
        return None  # cada operador solo gestiona el tipo de alta que le corresponde
    return Decision(True, f"{s.rol_plataforma}_{a.value}")


def _auditor(s, a, r, e):
    if s.rol_plataforma == "auditor" and a in {Accion.CONSULTAR_AUDITORIA, Accion.CONSULTAR_DECISIONES} \
            and s.nivel_aseguramiento >= 3 and _mfa_reciente(s, e):
        return Decision(True, "auditor_consulta")


PERMISOS: list[Callable] = [_ciudadano, _personal_de_tramites, _coordinador, _operadores, _auditor]


# ----------------------------------------------------------------------------- decisión

def decidir(sujeto: Sujeto, accion: Accion, recurso: Recurso, entorno: Entorno) -> Decision:
    """Devuelve siempre una decisión. Ante cualquier error, deniega (fail closed)."""
    try:
        for regla in DENEGACIONES:
            resultado = regla(sujeto, accion, recurso, entorno)
            if resultado is not None:
                return resultado
        for regla in PERMISOS:
            resultado = regla(sujeto, accion, recurso, entorno)
            if resultado is not None and resultado.permitido:
                return resultado
        return Decision(False, "sin_regla_que_permita", "ninguna política permite la acción")
    except Exception as error:  # noqa: BLE001 - cualquier fallo del PDP se traduce en denegación
        registro.exception("Fallo del PDP: se deniega")
        return Decision(False, "fallo_del_pdp", type(error).__name__)
