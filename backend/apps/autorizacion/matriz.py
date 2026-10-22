"""Matriz de roles, permisos y módulos, CALCULADA por el propio motor de decisión (PDP).

No es documentación escrita a mano: cada celda sale de evaluar `decidir()` con una persona de ejemplo de cada rol y un
recurso de ejemplo. Si alguien cambia una política, esta matriz cambia con ella; no puede quedar desactualizada ni mentir.
Python puro, sin base de datos.
"""
from datetime import datetime, timedelta

from apps.autorizacion.modulos import CATALOGO, modulos_para
from apps.autorizacion.modulos import _entrada as modulo_entrada
from apps.autorizacion.pdp import Accion, Entorno, Recurso, Sujeto, decidir

PROPIA, AJENA = 10, 99  # instituciones de ejemplo: la de la persona y otra distinta
OTRA_PERSONA = 900

ROLES = [
    # id, nombre, ámbito, descripción
    ("ciudadano", "Ciudadanía", "propio", "Inicia trámites y sigue los suyos. No ve nada de otras personas."),
    ("funcionario", "Funcionario", "institucion", "Atiende los trámites de su institución, con segundo factor reciente."),
    ("supervisor", "Supervisor", "institucion", "Todo lo del funcionario y además reasigna y atiende escalados."),
    ("coordinador_institucional", "Coordinación", "institucion", "Gestiona al equipo de su institución. No ve trámites."),
    ("operador_infraestructura", "Operador de infraestructura", "plataforma", "Opera servidores y contenedores. No ve trámites."),
    ("operador_identidades", "Operador de identidades", "plataforma", "Altas de coordinadores y restablece el segundo factor (control dual)."),
    ("operador_catalogo", "Operador de catálogo", "plataforma", "Altas de instituciones y de trámites (control dual)."),
    ("operador_seguridad", "Operador de seguridad", "plataforma", "Bloquea cuentas y revoca sesiones ante un incidente."),
    ("custodio_secretos", "Custodio de secretos", "plataforma", "Rota claves y certificados. No ve datos."),
    ("auditor", "Auditor", "plataforma", "Lee el registro inalterable. No puede escribir ni ver trámites."),
]

ACCIONES = [
    # accion, etiqueta, grupo, (etiqueta del caso favorable, etiqueta del caso desfavorable)
    (Accion.VER_TRAMITE, "Ver un trámite", "Trámites", ("De su institución o propio", "De otra institución o de otra persona")),
    (Accion.CREAR_TRAMITE, "Iniciar un trámite", "Trámites", ("A su nombre", "A nombre de otra persona")),
    (Accion.CAMBIAR_ESTADO, "Cambiar el estado de un trámite", "Trámites", ("De su institución", "De otra institución")),
    (Accion.REASIGNAR_TRAMITE, "Reasignar un trámite", "Trámites", ("De su institución", "De otra institución")),
    (Accion.ESCALAR_TRAMITE, "Atender un trámite escalado", "Trámites", ("De su institución", "De otra institución")),
    (Accion.ADJUNTAR_DOCUMENTO, "Adjuntar un documento", "Trámites", ("A un trámite propio o de su institución", "A un trámite ajeno")),
    (Accion.VER_DOCUMENTO, "Ver un documento", "Trámites", ("De un trámite propio o de su institución", "De un trámite ajeno")),
    (Accion.GESTIONAR_USUARIOS_INSTITUCION, "Gestionar al equipo de la institución", "Instituciones", ("De su institución", "De otra institución")),
    (Accion.GESTIONAR_CATALOGO_INSTITUCION, "Gestionar los trámites de la institución", "Instituciones", ("De su institución", "De otra institución")),
    (Accion.PROPONER_ALTA, "Proponer un alta", "Control dual", ("Del tipo que le corresponde", "De un tipo que no le corresponde")),
    (Accion.APROBAR_ALTA, "Aprobar un alta", "Control dual", ("Propuesta por otra persona", "Propuesta por la misma persona")),
    (Accion.ADMINISTRAR_INFRAESTRUCTURA, "Administrar la infraestructura", "Plataforma", None),
    (Accion.RESTABLECER_MFA, "Restablecer el segundo factor de alguien", "Plataforma", None),
    (Accion.BLOQUEAR_CUENTA, "Bloquear una cuenta", "Plataforma", None),
    (Accion.REVOCAR_SESION, "Revocar una sesión", "Plataforma", None),
    (Accion.ROTAR_SECRETOS, "Rotar secretos y certificados", "Plataforma", None),
    (Accion.CONSULTAR_AUDITORIA, "Consultar la auditoría", "Auditoría", None),
    (Accion.CONSULTAR_DECISIONES, "Consultar las decisiones de acceso", "Auditoría", None),
]

REGLAS_DE_DENEGACION = [
    ("cuenta_no_activa", "Una cuenta bloqueada o suspendida no puede hacer nada."),
    ("plataforma_sin_acceso_a_tramites", "Ningún rol de plataforma ve trámites ni documentos de la ciudadanía."),
    ("conflicto_de_interes", "Nadie gestiona un trámite que él mismo pidió."),
    ("control_dual", "Quien propone un alta no puede aprobarla."),
    ("sin_regla_que_permita", "Si ninguna política lo permite explícitamente, se niega (denegar por defecto)."),
]

_TRAMITE = {Accion.VER_TRAMITE, Accion.CREAR_TRAMITE, Accion.CAMBIAR_ESTADO, Accion.REASIGNAR_TRAMITE, Accion.ESCALAR_TRAMITE}
_DOCUMENTO = {Accion.ADJUNTAR_DOCUMENTO, Accion.VER_DOCUMENTO}
_TIPO_DE_ALTA = {"operador_identidades": "alta_coordinador", "operador_catalogo": "alta_institucion"}


def _sujeto(rol, ahora, mfa_hace_min):
    plataforma = rol if rol in {r[0] for r in ROLES[4:]} else "ninguno"
    membresias = frozenset({(PROPIA, rol)}) if rol in {"funcionario", "supervisor", "coordinador_institucional"} else frozenset()
    return Sujeto(id=1, nivel_aseguramiento=3 if rol == "auditor" else 2, mfa_verificado_en=ahora - timedelta(minutes=mfa_hace_min),
                  rol_plataforma=plataforma, membresias=membresias)


def _recursos(accion, rol, sujeto):
    """El caso favorable y el desfavorable de esta acción para este rol."""
    es_personal = bool(sujeto.membresias)
    solicitante = OTRA_PERSONA if es_personal else sujeto.id
    if accion in _TRAMITE or accion in _DOCUMENTO:
        tipo = "tramite" if accion in _TRAMITE else "documento"
        comunes = dict(tipo=tipo, estado="En Tramitacion", estado_destino="Aprobado" if accion == Accion.CAMBIAR_ESTADO else None)
        if accion == Accion.CREAR_TRAMITE:
            return (Recurso(**{**comunes, "estado": None}, institucion_id=PROPIA, solicitante_id=sujeto.id),
                    Recurso(**{**comunes, "estado": None}, institucion_id=PROPIA, solicitante_id=OTRA_PERSONA))
        return (Recurso(**comunes, institucion_id=PROPIA, solicitante_id=solicitante),
                Recurso(**comunes, institucion_id=AJENA, solicitante_id=OTRA_PERSONA))
    if accion == Accion.GESTIONAR_USUARIOS_INSTITUCION:
        return Recurso(tipo="usuario", institucion_id=PROPIA), Recurso(tipo="usuario", institucion_id=AJENA)
    if accion == Accion.GESTIONAR_CATALOGO_INSTITUCION:
        return Recurso(tipo="tipo_tramite", institucion_id=PROPIA), Recurso(tipo="tipo_tramite", institucion_id=AJENA)
    if accion in {Accion.PROPONER_ALTA, Accion.APROBAR_ALTA}:
        tipo = _TIPO_DE_ALTA.get(rol, "alta_institucion")
        otro = "alta_institucion" if tipo == "alta_coordinador" else "alta_coordinador"
        if accion == Accion.PROPONER_ALTA:
            return Recurso(tipo=tipo, propuesto_por=sujeto.id), Recurso(tipo=otro, propuesto_por=sujeto.id)
        return Recurso(tipo=tipo, propuesto_por=OTRA_PERSONA), Recurso(tipo=tipo, propuesto_por=sujeto.id)
    recurso = Recurso(tipo="plataforma")
    return recurso, recurso


def _celda(d):
    return {"permitido": d.permitido, "politica": d.politica}


def vencido_hace(ventana):
    """Minutos que se usan para representar «segundo factor vencido»: siempre más que la ventana vigente."""
    return max(60, ventana + 45)


def construir(ahora=None, ventana=15):
    """Evalúa el PDP para cada rol y cada acción. `ventana`: minutos que dura un segundo factor «reciente» (la configuración real)."""
    ahora = ahora or datetime.now().astimezone()
    entorno = Entorno(ahora=ahora, mfa_reciente_minutos=ventana, mfa_ciudadano_obligatorio=True)
    matriz = {}
    for rol, *_ in ROLES:
        fila = {}
        for accion, _etiqueta, _grupo, _casos in ACCIONES:
            fresco, vencido = _sujeto(rol, ahora, 1), _sujeto(rol, ahora, vencido_hace(ventana))
            favorable, desfavorable = _recursos(accion, rol, fresco)
            d_fav, d_des = decidir(fresco, accion, favorable, entorno), decidir(fresco, accion, desfavorable, entorno)
            sin_factor = decidir(vencido, accion, favorable, entorno)
            fila[accion.value] = {
                "favorable": _celda(d_fav), "desfavorable": _celda(d_des),
                # Se permite con el segundo factor reciente pero se niega con el factor vencido: la acción lo exige
                "exige_segundo_factor": bool(d_fav.permitido and not sin_factor.permitido),
            }
        matriz[rol] = fila
    roles = []
    for rol, nombre, ambito, descripcion in ROLES:
        s = _sujeto(rol, ahora, 1)
        modulos = modulos_para(s.rol_plataforma, [r for (_i, r) in s.membresias])
        permitidas = sum(1 for a in matriz[rol].values() if a["favorable"]["permitido"])
        roles.append({"id": rol, "nombre": nombre, "ambito": ambito, "descripcion": descripcion, "modulos": modulos,
                      "acciones_permitidas": permitidas, "acciones_totales": len(ACCIONES)})
    acciones = [{"id": a.value, "nombre": etiqueta, "grupo": grupo, "casos": list(casos) if casos else None} for a, etiqueta, grupo, casos in ACCIONES]
    # Vista inversa (módulo → roles): sale de los mismos módulos de cada rol, así que no puede contradecirlos
    modulos = []
    for identificador in CATALOGO:
        quienes = [r["id"] for r in roles if any(m["id"] == identificador for m in r["modulos"])]
        modulos.append({**modulo_entrada(identificador), "roles": quienes})
    return {
        "roles": roles, "acciones": acciones, "matriz": matriz, "modulos": modulos,
        "denegaciones": [{"politica": p, "descripcion": d} for p, d in REGLAS_DE_DENEGACION],
        "ventana_minutos": ventana,
        "ningun_rol_puede_todo": all(r["acciones_permitidas"] < r["acciones_totales"] for r in roles),
    }
