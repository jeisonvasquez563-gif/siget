"""Simulador de «qué pasaría si…»: evalúa el PDP real con una situación hipotética.

- La decisión sale de `decidir()`, el mismo motor que usa la plataforma; nada se copia ni se reimplementa.
- Además devuelve la TRAZA (qué reglas se evaluaron, en qué orden y cuál decidió) y los cambios de UNA sola variable que
  invertirían el resultado: así se entiende por qué se permite o se niega algo.
- Python puro: no toca la base de datos ni registra decisiones (es hipotético y no debe ensuciar la auditoría).
- Entrada estrictamente validada: solo valores de listas cerradas.
"""
from datetime import datetime, timedelta

from apps.autorizacion import matriz, pdp
from apps.autorizacion.pdp import Accion, Entorno, Recurso, Sujeto, decidir

ESTADOS = ("Pendiente", "En Tramitacion", "En Subsanacion", "Aprobado", "Rechazado")

VALORES = {
    "segundo_factor": ("reciente", "vencido", "ninguno"),
    "cuenta": ("activa", "bloqueada", "suspendida"),
    "institucion": ("propia", "ajena"),
    "solicitante": ("otra_persona", "yo"),
    "estado": ESTADOS,
    "estado_destino": ESTADOS,
    "asignado": ("nadie", "yo", "otra_persona"),
    "tipo_alta": ("alta_coordinador", "alta_institucion"),
    "alta_propuesta_por": ("otra_persona", "yo"),
    "nivel": (1, 2, 3),
}

ETIQUETAS_VARIABLE = {
    "segundo_factor": "Segundo factor", "cuenta": "Estado de la cuenta", "institucion": "Institución del recurso",
    "solicitante": "Quién pidió el trámite", "estado": "Estado actual del trámite", "estado_destino": "Estado al que se quiere pasar",
    "asignado": "Quién lo atiende", "tipo_alta": "Tipo de alta", "alta_propuesta_por": "Quién propuso el alta", "nivel": "Nivel de aseguramiento",
}

ETIQUETAS_VALOR = {
    "segundo_factor": {"reciente": "Verificado hace 1 minuto", "vencido": "Verificado hace 60 minutos (vencido)", "ninguno": "Nunca verificado"},  # `vencido` se ajusta en meta()
    "cuenta": {"activa": "Activa", "bloqueada": "Bloqueada", "suspendida": "Suspendida"},
    "institucion": {"propia": "Su propia institución", "ajena": "Otra institución"},
    "solicitante": {"otra_persona": "Otra persona", "yo": "La misma persona que actúa"},
    "asignado": {"nadie": "Nadie (en cola)", "yo": "La misma persona que actúa", "otra_persona": "Otra persona"},
    "tipo_alta": {"alta_coordinador": "Alta de un coordinador", "alta_institucion": "Alta de una institución"},
    "alta_propuesta_por": {"otra_persona": "Otra persona", "yo": "La misma persona que actúa"},
    "nivel": {1: "Nivel 1", 2: "Nivel 2", 3: "Nivel 3"},
    "estado": {"Pendiente": "Pendiente", "En Tramitacion": "En tramitación", "En Subsanacion": "En subsanación", "Aprobado": "Aprobado", "Rechazado": "Rechazado"},
    "estado_destino": {"Pendiente": "Pendiente", "En Tramitacion": "En tramitación", "En Subsanacion": "En subsanación", "Aprobado": "Aprobado", "Rechazado": "Rechazado"},
}

DEFECTOS = {
    "segundo_factor": "reciente", "cuenta": "activa", "institucion": "propia", "solicitante": "otra_persona",
    "estado": "En Tramitacion", "estado_destino": "Aprobado", "asignado": "nadie", "tipo_alta": "alta_institucion",
    "alta_propuesta_por": "otra_persona", "nivel": 2,
}

_COMUN = ("segundo_factor", "cuenta")
_TRAMITE = ("institucion", "solicitante")
VARIABLES_POR_ACCION = {
    Accion.VER_TRAMITE: (*_TRAMITE, *_COMUN),
    Accion.CREAR_TRAMITE: (*_TRAMITE, *_COMUN),
    Accion.CAMBIAR_ESTADO: (*_TRAMITE, "estado", "estado_destino", "asignado", *_COMUN),
    Accion.REASIGNAR_TRAMITE: (*_TRAMITE, "asignado", *_COMUN),
    Accion.ESCALAR_TRAMITE: (*_TRAMITE, *_COMUN),
    Accion.ADJUNTAR_DOCUMENTO: (*_TRAMITE, *_COMUN),
    Accion.VER_DOCUMENTO: (*_TRAMITE, *_COMUN),
    Accion.GESTIONAR_USUARIOS_INSTITUCION: ("institucion", *_COMUN),
    Accion.GESTIONAR_CATALOGO_INSTITUCION: ("institucion", *_COMUN),
    Accion.PROPONER_ALTA: ("tipo_alta", *_COMUN),
    Accion.APROBAR_ALTA: ("tipo_alta", "alta_propuesta_por", *_COMUN),
    Accion.ADMINISTRAR_INFRAESTRUCTURA: _COMUN,
    Accion.RESTABLECER_MFA: _COMUN,
    Accion.BLOQUEAR_CUENTA: _COMUN,
    Accion.REVOCAR_SESION: _COMUN,
    Accion.ROTAR_SECRETOS: _COMUN,
    Accion.CONSULTAR_AUDITORIA: (*_COMUN, "nivel"),
    Accion.CONSULTAR_DECISIONES: (*_COMUN, "nivel"),
}

REGLAS = {
    "_cuenta_activa": "La cuenta debe estar activa",
    "_plataforma_sin_tramites": "Los roles de plataforma no ven trámites ni documentos",
    "_conflicto_de_interes": "Nadie gestiona un trámite que él mismo pidió",
    "_control_dual": "Quien propone un alta no puede aprobarla",
    "_ciudadano": "Reglas de la ciudadanía",
    "_personal_de_tramites": "Reglas del personal de trámites (funcionario y supervisor)",
    "_coordinador": "Reglas de la coordinación de la institución",
    "_operadores": "Reglas de los operadores de plataforma",
    "_auditor": "Reglas del auditor",
}

PERSONA, OTRA, SEGUNDA_OTRA = 1, 900, 901
_ROLES_VALIDOS = {r[0] for r in matriz.ROLES}


def meta(ventana=15):
    """Lo que la interfaz necesita para armar el formulario: variables por acción y valores admitidos con su etiqueta."""
    etiquetas = {**ETIQUETAS_VALOR, "segundo_factor": {**ETIQUETAS_VALOR["segundo_factor"], "vencido": f"Verificado hace {matriz.vencido_hace(ventana)} minutos (vencido)"}}
    return {
        "ventana_minutos": ventana,
        "variables": {a.value: list(v) for a, v in VARIABLES_POR_ACCION.items()},
        "etiquetas": ETIQUETAS_VARIABLE,
        "valores": {v: [{"valor": x, "etiqueta": etiquetas.get(v, {}).get(x, x)} for x in opciones] for v, opciones in VALORES.items()},
        "defectos": DEFECTOS,
    }


def normalizar(datos):
    """Valida la entrada. Devuelve (entrada, errores). Solo las variables relevantes para la acción cuentan; el resto toma su valor por defecto."""
    errores = []
    if not isinstance(datos, dict):
        return None, ["El cuerpo debe ser un objeto JSON."]
    rol, accion = datos.get("rol"), datos.get("accion")
    # `isinstance`: un rol que llega como lista o diccionario no es hashable y no debe romper la validación
    if not isinstance(rol, str) or rol not in _ROLES_VALIDOS:
        errores.append("`rol` no es un rol conocido.")
    try:
        accion_enum = Accion(accion) if isinstance(accion, str) else None
    except ValueError:
        accion_enum = None
    if accion_enum is None:
        errores.append("`accion` no es una acción conocida.")
    if errores:
        return None, errores

    entrada = {"rol": rol, "accion": accion_enum.value}
    for variable in VARIABLES_POR_ACCION[accion_enum]:
        valor = datos.get(variable, None)
        defecto = DEFECTOS[variable]
        if variable == "solicitante" and rol == "ciudadano":
            defecto = "yo"
        if variable == "nivel" and rol == "auditor":
            defecto = 3
        if valor is None:
            valor = defecto
        # `True == 1` en Python: un booleano no es un nivel válido
        if isinstance(valor, bool) or valor not in VALORES[variable] or type(valor) is not type(VALORES[variable][0]):
            errores.append(f"`{variable}` debe ser uno de: {', '.join(str(x) for x in VALORES[variable])}.")
        else:
            entrada[variable] = valor
    return (None, errores) if errores else (entrada, [])


def _sujeto(entrada, ahora, ventana=15):
    rol = entrada["rol"]
    minutos = {"reciente": 1, "vencido": matriz.vencido_hace(ventana)}.get(entrada.get("segundo_factor", "reciente"))
    plataforma = rol if rol in {r[0] for r in matriz.ROLES[4:]} else "ninguno"
    membresias = frozenset({(matriz.PROPIA, rol)}) if rol in {"funcionario", "supervisor", "coordinador_institucional"} else frozenset()
    return Sujeto(
        id=PERSONA, estado_cuenta=entrada.get("cuenta", "activa"), nivel_aseguramiento=entrada.get("nivel", 3 if rol == "auditor" else 2),
        mfa_verificado_en=None if minutos is None else ahora - timedelta(minutes=minutos), rol_plataforma=plataforma, membresias=membresias,
    )


def _recurso(entrada, accion, sujeto):
    institucion = matriz.PROPIA if entrada.get("institucion", "propia") == "propia" else matriz.AJENA
    if accion in matriz._TRAMITE or accion in matriz._DOCUMENTO:
        asignado = {"nadie": None, "yo": PERSONA, "otra_persona": SEGUNDA_OTRA}[entrada.get("asignado", "nadie")]
        solicitante = PERSONA if entrada.get("solicitante") == "yo" else OTRA
        cambia = accion == Accion.CAMBIAR_ESTADO
        return Recurso(tipo="tramite" if accion in matriz._TRAMITE else "documento", institucion_id=institucion, solicitante_id=solicitante,
                       funcionario_asignado_id=asignado, estado=None if accion == Accion.CREAR_TRAMITE else entrada.get("estado", "En Tramitacion"),
                       estado_destino=entrada.get("estado_destino") if cambia else None)
    if accion == Accion.GESTIONAR_USUARIOS_INSTITUCION:
        return Recurso(tipo="usuario", institucion_id=institucion)
    if accion == Accion.GESTIONAR_CATALOGO_INSTITUCION:
        return Recurso(tipo="tipo_tramite", institucion_id=institucion)
    if accion in (Accion.PROPONER_ALTA, Accion.APROBAR_ALTA):
        propuesto = PERSONA if entrada.get("alta_propuesta_por") == "yo" else OTRA
        return Recurso(tipo=entrada.get("tipo_alta", "alta_institucion"), propuesto_por=propuesto if accion == Accion.APROBAR_ALTA else PERSONA)
    return Recurso(tipo="plataforma")


def _evaluar(entrada, ahora, ventana=15):
    accion = Accion(entrada["accion"])
    sujeto = _sujeto(entrada, ahora, ventana)
    entorno = Entorno(ahora=ahora, mfa_reciente_minutos=ventana, mfa_ciudadano_obligatorio=True)
    recurso = _recurso(entrada, accion, sujeto)
    return sujeto, accion, recurso, entorno, decidir(sujeto, accion, recurso, entorno)


def _traza(sujeto, accion, recurso, entorno):
    """Repite la evaluación del PDP regla por regla para mostrarla. La decisión oficial siempre es `decidir()`."""
    pasos = []

    def paso(fase, regla, resultado, politica=None, motivo=None):
        pasos.append({"fase": fase, "regla": REGLAS.get(regla.__name__, regla.__name__), "resultado": resultado, "politica": politica, "motivo": motivo})

    try:
        for regla in pdp.DENEGACIONES:
            r = regla(sujeto, accion, recurso, entorno)
            if r is None:
                paso("denegacion", regla, "no_aplica")
            else:
                paso("denegacion", regla, "niega", r.politica, r.motivo)
                return pasos
        for regla in pdp.PERMISOS:
            r = regla(sujeto, accion, recurso, entorno)
            if r is None:
                paso("permiso", regla, "no_aplica")
            elif not r.permitido:
                paso("permiso", regla, "no_permite", r.politica, r.motivo)
            else:
                paso("permiso", regla, "permite", r.politica, r.motivo)
                return pasos
        pasos.append({"fase": "final", "regla": "Ninguna política permite la acción", "resultado": "niega", "politica": "sin_regla_que_permita", "motivo": "denegar por defecto"})
    except Exception as error:  # noqa: BLE001 - el PDP real deniega ante cualquier fallo; la traza lo refleja
        pasos.append({"fase": "final", "regla": "Fallo al evaluar", "resultado": "niega", "politica": "fallo_del_pdp", "motivo": type(error).__name__})
    return pasos


def _alternativas(entrada, base, ahora, ventana=15):
    """Los cambios de UNA sola variable que invertirían el resultado."""
    salida = []
    for variable in VARIABLES_POR_ACCION[Accion(entrada["accion"])]:
        for valor in VALORES[variable]:
            if valor == entrada[variable]:
                continue
            d = _evaluar({**entrada, variable: valor}, ahora, ventana)[4]
            if d.permitido != base.permitido:
                salida.append({"variable": variable, "valor": valor, "etiqueta_variable": ETIQUETAS_VARIABLE[variable],
                               "etiqueta_valor": ETIQUETAS_VALOR.get(variable, {}).get(valor, valor), "permitido": d.permitido, "politica": d.politica})
    return salida


def simular(entrada, ahora=None, ventana=15):
    """`entrada` ya normalizada. `ventana`: minutos de un segundo factor reciente (la configuración real). Devuelve la decisión, la traza y las alternativas."""
    ahora = ahora or datetime.now().astimezone()
    sujeto, accion, recurso, entorno, decision = _evaluar(entrada, ahora, ventana)
    return {
        "entrada": entrada,
        "decision": {"permitido": decision.permitido, "politica": decision.politica, "motivo": decision.motivo},
        "traza": _traza(sujeto, accion, recurso, entorno),
        "alternativas": _alternativas(entrada, decision, ahora, ventana),
        "ventana_minutos": ventana,
        "hipotetico": True,
    }
