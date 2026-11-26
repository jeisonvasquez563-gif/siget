"""Evaluación del PDP para los diez roles y todas las acciones, SOLO para pruebas.

Antes vivía en `apps/autorizacion/matriz.py` y alimentaba la pantalla «Roles y permisos» (retirada al pasar a plataforma
final). Se conserva aquí porque las pruebas que garantizan «ningún rol puede todo», que cada acción la hace alguien y
que cada rol tiene solo su área se apoyan en esta evaluación directa de `decidir()`. No es parte de la plataforma.
"""
from datetime import datetime, timedelta

from apps.autorizacion.pdp import Accion, Entorno, Recurso, Sujeto, decidir

PROPIA, AJENA = 10, 99  # instituciones de ejemplo: la de la persona y otra distinta
OTRA_PERSONA = 900

ROLES = [
    "ciudadano", "funcionario", "supervisor", "coordinador_institucional",
    "operador_infraestructura", "operador_identidades", "operador_catalogo", "operador_seguridad", "custodio_secretos", "auditor",
]
ROLES_DE_PLATAFORMA = ROLES[4:]

_TRAMITE = {Accion.VER_TRAMITE, Accion.CREAR_TRAMITE, Accion.CAMBIAR_ESTADO, Accion.REASIGNAR_TRAMITE, Accion.ESCALAR_TRAMITE, Accion.RESPONDER_SUBSANACION}
_DOCUMENTO = {Accion.ADJUNTAR_DOCUMENTO, Accion.VER_DOCUMENTO}
_PERFIL = {Accion.VER_MIS_DATOS, Accion.EXPORTAR_MIS_DATOS, Accion.CREAR_SOLICITUD_DATOS, Accion.CORREGIR_MIS_DATOS}
_CUENTA = {Accion.CAMBIAR_CONTRASENA}
_NOTIFICACION = {Accion.VER_MIS_NOTIFICACIONES}
_TIPO_DE_ALTA = {"operador_identidades": "alta_coordinador", "operador_catalogo": "alta_institucion"}


def _sujeto(rol, ahora, mfa_hace_min):
    plataforma = rol if rol in set(ROLES_DE_PLATAFORMA) else "ninguno"
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
            # El personal inicia en OTRA institución un trámite interinstitucional; la ciudadanía, uno suyo para la ciudadanía
            comunes = {**comunes, "estado": None}
            if es_personal:
                return (Recurso(**comunes, institucion_id=AJENA, solicitante_id=sujeto.id, audiencia="institucion"),
                        Recurso(**comunes, institucion_id=PROPIA, solicitante_id=sujeto.id, audiencia="institucion"))
            return (Recurso(**comunes, institucion_id=PROPIA, solicitante_id=sujeto.id),
                    Recurso(**comunes, institucion_id=PROPIA, solicitante_id=OTRA_PERSONA))
        if accion == Accion.RESPONDER_SUBSANACION and es_personal:
            # El personal responde por la vía de la ciudadanía: un trámite PROPIO en OTRA institución (en la suya no atiende lo que pidió)
            return (Recurso(**comunes, institucion_id=AJENA, solicitante_id=sujeto.id),
                    Recurso(**comunes, institucion_id=AJENA, solicitante_id=OTRA_PERSONA))
        return (Recurso(**comunes, institucion_id=PROPIA, solicitante_id=solicitante),
                Recurso(**comunes, institucion_id=AJENA, solicitante_id=OTRA_PERSONA))
    if accion == Accion.GESTIONAR_USUARIOS_INSTITUCION:
        return Recurso(tipo="usuario", institucion_id=PROPIA), Recurso(tipo="usuario", institucion_id=AJENA)
    if accion == Accion.VER_INDICADORES_INSTITUCION:
        return Recurso(tipo="indicadores", institucion_id=PROPIA), Recurso(tipo="indicadores", institucion_id=AJENA)
    if accion == Accion.GESTIONAR_CATALOGO_INSTITUCION:
        return Recurso(tipo="tipo_tramite", institucion_id=PROPIA), Recurso(tipo="tipo_tramite", institucion_id=AJENA)
    if accion in {Accion.PROPONER_ALTA, Accion.APROBAR_ALTA}:
        tipo = _TIPO_DE_ALTA.get(rol, "alta_institucion")
        otro = "alta_institucion" if tipo == "alta_coordinador" else "alta_coordinador"
        if accion == Accion.PROPONER_ALTA:
            return Recurso(tipo=tipo, propuesto_por=sujeto.id), Recurso(tipo=otro, propuesto_por=sujeto.id)
        return Recurso(tipo=tipo, propuesto_por=OTRA_PERSONA), Recurso(tipo=tipo, propuesto_por=sujeto.id)
    if accion in _PERFIL:
        return Recurso(tipo="perfil", solicitante_id=sujeto.id), Recurso(tipo="perfil", solicitante_id=OTRA_PERSONA)
    if accion in _CUENTA:
        return Recurso(tipo="cuenta", solicitante_id=sujeto.id), Recurso(tipo="cuenta", solicitante_id=OTRA_PERSONA)
    if accion in _NOTIFICACION:
        return Recurso(tipo="notificacion", solicitante_id=sujeto.id), Recurso(tipo="notificacion", solicitante_id=OTRA_PERSONA)
    recurso = Recurso(tipo="plataforma")
    return recurso, recurso


def _celda(d):
    return {"permitido": d.permitido, "politica": d.politica}


def vencido_hace(ventana):
    """Minutos que se usan para representar «segundo factor vencido»: siempre más que la ventana vigente."""
    return max(60, ventana + 45)


def construir(ahora=None, ventana=15):
    """Evalúa el PDP para cada rol y cada acción. `ventana`: minutos que dura un segundo factor «reciente»."""
    ahora = ahora or datetime.now().astimezone()
    entorno = Entorno(ahora=ahora, mfa_reciente_minutos=ventana, mfa_ciudadano_obligatorio=True)
    matriz = {}
    for rol in ROLES:
        fila = {}
        for accion in Accion:
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
    roles = [{"id": rol, "acciones_permitidas": sum(1 for a in matriz[rol].values() if a["favorable"]["permitido"]), "acciones_totales": len(Accion)}
             for rol in ROLES]
    return {
        "roles": roles, "acciones": [{"id": a.value} for a in Accion], "matriz": matriz, "ventana_minutos": ventana,
        "ningun_rol_puede_todo": all(r["acciones_permitidas"] < r["acciones_totales"] for r in roles),
    }
