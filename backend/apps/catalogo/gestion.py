"""Gestión del catálogo de trámites por la coordinación de cada institución: validación y salida. Funciones puras, sin base de datos.

Lo que llega es JSON hostil por definición. Aquí se limpia y se valida TODO antes de tocar la base, con errores por campo
(`{"nombre": mensaje, "formulario.2.etiqueta": mensaje, ...}`); la base vuelve a validar (disparador de la migración 020) como segunda barrera.
La definición del formulario se limpia (se quitan los atributos que no aplican al tipo de campo) y se vuelve a revisar con
`formulario.definicion_valida`, que es la misma regla con la que después se valida lo que responde la ciudadanía.
"""
import json
import re

from apps.tramites import formulario as fm

AUDIENCIAS = ("ciudadania", "institucion", "ambas")
CAMPOS_EDITABLES = ("nombre", "sla_dias", "audiencia", "formulario", "activo", "requisitos")
NOMBRE_MIN, NOMBRE_MAX = 3, 150
SLA_MIN, SLA_MAX = 1, 365
MAX_CAMPOS = 30
ETIQUETA_MAX = 120
OPCIONES_MAX = 30
OPCION_MAX = 120
AYUDA_MAX = 300
# Requisitos antes de iniciar (migración 021): qué es el trámite, qué documentos hacen falta y qué pasa después. La base los vuelve a validar
DESCRIPCION_MAX = 1000
DESPUES_MAX = 1000
DOCUMENTOS_MAX = 15
DOCUMENTO_MAX = 200
CLAVES_REQUISITOS = ("descripcion", "documentos", "despues")
MAXIMO_POR_TIPO = {"texto": 500, "texto_largo": 5000, "numero": fm.MAX_NUMERO_DEFECTO}
# Tamaño de la definición: la base impone 16 384 bytes de jsonb (CHECK `tipo_tramite_formulario_tamano`). jsonb pesa distinto que el JSON de texto
# (cabeceras por elemento y por clave), así que aquí se corta antes, sobre el JSON compacto, para no llegar al CHECK con un error opaco.
FORMULARIO_TAMANO_MAXIMO = 12000
# Presupuesto de lo que el formulario puede prometer: un trámite guarda a lo sumo `fm.TAMANO_MAXIMO_DATOS` bytes de JSON en `datos`. Peor caso de
# las respuestas de un formulario = por cada campo, su clave y la puntuación del JSON (`"id": ` y `, `: largo del id + 8 bytes) más el valor:
#   texto y texto_largo: `max` caracteres; seleccion: la opción más larga; numero: hasta 24 caracteres; fecha: `"AAAA-MM-DD"` (12 bytes).
# Los caracteres se cuentan a BYTES_POR_CARACTER bytes (en UTF-8 el español pesa 1 byte, y 2 con tilde o eñe; el emoji y el CJK pesan más y,
# si alguien los llena, los frena el tope en bytes de la API con «El contenido es demasiado grande», no la base). Con 2 bytes por caracter un
# formulario puede prometer unos 7 000 caracteres de texto en total; antes de este tope, 30 campos de 5 000 prometían 150 000.
BYTES_POR_CARACTER = 2
SOBRECARGA_POR_CAMPO = 8
BYTES_NUMERO, BYTES_FECHA = 24, 12
ATRIBUTOS_CAMPO = {"id", "etiqueta", "tipo", "obligatorio", "max", "opciones", "ayuda", "entero"}
_ID = re.compile(r"[a-z][a-z0-9_]{0,39}")
_PROBLEMA = re.compile(r"^campo (\d+): (.*)$")
_ATRIBUTO = re.compile(r"`(\w+)`")


def _es_entero(valor):
    return isinstance(valor, int) and not isinstance(valor, bool)


def _campo(i, crudo, errores, vistos):
    """Un campo del formulario limpio, o `None` si no es ni un objeto. Los errores se anotan en `errores` bajo `formulario.<i>[.atributo]`."""
    clave = f"formulario.{i}"
    if not isinstance(crudo, dict):
        errores[clave] = "Cada campo debe ser un objeto."
        return None
    if any(not isinstance(k, str) for k in crudo) or set(crudo) - ATRIBUTOS_CAMPO:
        errores[clave] = "El campo tiene atributos que no se admiten."
    limpio = {}
    identificador = crudo.get("id")
    if not isinstance(identificador, str) or not _ID.fullmatch(identificador):
        errores[f"{clave}.id"] = "Usa minúsculas, números y guion bajo, empezando con una letra (hasta 40 caracteres)."
    elif identificador in vistos:
        errores[f"{clave}.id"] = "Otro campo ya usa este id."
    else:
        vistos.add(identificador)
    limpio["id"] = identificador
    etiqueta = crudo.get("etiqueta")
    if isinstance(etiqueta, str) and not etiqueta.strip():
        errores[f"{clave}.etiqueta"] = "Escribe la etiqueta del campo."
        limpio["etiqueta"] = ""
    else:
        texto, error = fm.validar_texto_corto(etiqueta, 1, ETIQUETA_MAX)
        if error:
            errores[f"{clave}.etiqueta"] = error if etiqueta is not None else "Escribe la etiqueta del campo."
        limpio["etiqueta"] = texto
    tipo = crudo.get("tipo")
    if tipo not in fm.TIPOS:
        errores[f"{clave}.tipo"] = "Elige un tipo de campo."
        return limpio
    limpio["tipo"] = tipo
    obligatorio = crudo.get("obligatorio", False)
    if not isinstance(obligatorio, bool):
        errores[f"{clave}.obligatorio"] = "Debe ser verdadero o falso."
    limpio["obligatorio"] = obligatorio is True
    if tipo in MAXIMO_POR_TIPO:
        maximo = crudo.get("max")
        tope = MAXIMO_POR_TIPO[tipo]
        if isinstance(maximo, bool) or not isinstance(maximo, (int, float)) or maximo <= 0 or (tipo != "numero" and not _es_entero(maximo)):
            errores[f"{clave}.max"] = "Indica un número mayor que cero." if tipo == "numero" else "Indica un número entero mayor que cero."
        elif maximo > tope:
            errores[f"{clave}.max"] = f"No puede ser mayor que {tope}."
        else:
            limpio["max"] = maximo
    if tipo == "seleccion":
        opciones = crudo.get("opciones")
        if not isinstance(opciones, list) or not opciones:
            errores[f"{clave}.opciones"] = "Agrega al menos una opción."
        elif len(opciones) > OPCIONES_MAX:
            errores[f"{clave}.opciones"] = f"Hasta {OPCIONES_MAX} opciones."
        else:
            limpias, problema = [], None
            for opcion in opciones:
                texto, error = fm.validar_texto_corto(opcion, 1, OPCION_MAX)
                if error:
                    problema = "Cada opción debe ser un texto de 1 a %d caracteres." % OPCION_MAX
                    break
                limpias.append(texto)
            if problema is None and len(set(limpias)) != len(limpias):
                problema = "Hay opciones repetidas."
            if problema:
                errores[f"{clave}.opciones"] = problema
            else:
                limpio["opciones"] = limpias
    ayuda = crudo.get("ayuda")
    if ayuda is not None:
        if not isinstance(ayuda, str):
            errores[f"{clave}.ayuda"] = "Debe ser un texto."
        elif ayuda.strip():
            texto, error = fm.validar_texto_corto(ayuda, 1, AYUDA_MAX)
            if error:
                errores[f"{clave}.ayuda"] = error
            else:
                limpio["ayuda"] = texto
    entero = crudo.get("entero")
    if entero is not None and not isinstance(entero, bool):
        errores[f"{clave}.entero"] = "Debe ser verdadero o falso."
    elif tipo == "numero" and entero is True:
        limpio["entero"] = True
    return limpio


def _peso_de_las_respuestas(limpio):
    """`(promesa, otros)`: caracteres que el formulario promete en campos de texto y selecciones, y bytes de claves, números y fechas (peor caso)."""
    promesa, otros = 0, 2  # las llaves del objeto
    for campo in limpio:
        otros += len(campo["id"]) + SOBRECARGA_POR_CAMPO
        if campo["tipo"] in ("texto", "texto_largo"):
            promesa += campo["max"]
        elif campo["tipo"] == "seleccion":
            promesa += max(len(o) for o in campo["opciones"])
        elif campo["tipo"] == "numero":
            otros += BYTES_NUMERO
        else:
            otros += BYTES_FECHA
    return promesa, otros


def _errores_de_tamano(limpio):
    """Errores de lo que el formulario pesa (la definición) o promete (las respuestas), o `{}`. Va después de las demás reglas."""
    if len(json.dumps(limpio, ensure_ascii=False, separators=(",", ":")).encode()) > FORMULARIO_TAMANO_MAXIMO:
        return {"formulario": "El formulario es demasiado largo: reduce los campos, las opciones o los textos de ayuda."}
    promesa, otros = _peso_de_las_respuestas(limpio)
    if promesa * BYTES_POR_CARACTER + otros > fm.TAMANO_MAXIMO_DATOS:
        admite = max(0, (fm.TAMANO_MAXIMO_DATOS - otros) // BYTES_POR_CARACTER)
        return {"formulario": f"Los campos de texto prometen hasta {promesa} caracteres en total y un trámite guarda como máximo unos {admite} con este "
                              f"formulario (el contenido no puede pasar de {fm.TAMANO_MAXIMO_DATOS} bytes). Baja el máximo de algún campo."}
    return {}


def validar_formulario(crudo):
    """`(formulario_limpio, errores)`. Si hay errores, el primero es `None`."""
    if not isinstance(crudo, list):
        return None, {"formulario": "Debe ser una lista de campos."}
    if len(crudo) > MAX_CAMPOS:
        return None, {"formulario": f"Un trámite admite hasta {MAX_CAMPOS} campos."}
    errores, vistos, limpio = {}, set(), []
    for i, campo in enumerate(crudo):
        resultado = _campo(i, campo, errores, vistos)
        if resultado is not None:
            limpio.append(resultado)
    if errores:
        return None, errores
    # La misma regla con la que después se valida lo que responde la ciudadanía: si algo se le escapó a lo de arriba, se dice igual
    for problema in fm.definicion_valida(limpio):
        encontrado = _PROBLEMA.match(problema)
        if encontrado:
            atributos = _ATRIBUTO.findall(encontrado.group(2))
            llave = f"formulario.{encontrado.group(1)}" + (f".{atributos[-1]}" if atributos else "")
            errores[llave] = encontrado.group(2).replace("`", "").capitalize() + "."
        else:
            errores["formulario"] = problema.capitalize() + "."
    if not errores:
        errores = _errores_de_tamano(limpio)
    return (None, errores) if errores else (limpio, {})


def _texto_de_requisitos(clave, crudo, maximo, errores):
    """Un texto libre de los requisitos, limpio; `None` si no se dijo (ausente, nulo o en blanco). Los errores van bajo `requisitos.<clave>`."""
    if crudo is None or (isinstance(crudo, str) and not crudo.strip()):
        return None
    texto, error = fm.validar_texto_libre(crudo, 1, maximo)
    if error:
        errores[f"requisitos.{clave}"] = error
    return texto


def validar_requisitos(crudo):
    """`(requisitos_limpios, errores)`. Lo que no se dijo no se guarda: sin nada, el resultado es `{}`. Si hay errores, el primero es `None`.

    Errores por campo: `requisitos` (la forma general), `requisitos.descripcion`, `requisitos.despues`, `requisitos.documentos` (la lista) y
    `requisitos.documentos.<i>` (un documento)."""
    if not isinstance(crudo, dict):
        return None, {"requisitos": "Deben ser un objeto con la descripción, los documentos y lo que pasa después."}
    errores, limpio = {}, {}
    if any(not isinstance(k, str) for k in crudo) or set(crudo) - set(CLAVES_REQUISITOS):
        errores["requisitos"] = "Hay datos que no se admiten: solo la descripción, los documentos y lo que pasa después."
    descripcion = _texto_de_requisitos("descripcion", crudo.get("descripcion"), DESCRIPCION_MAX, errores)
    if descripcion:
        limpio["descripcion"] = descripcion
    documentos = crudo.get("documentos")
    if documentos is not None:
        if not isinstance(documentos, list):
            errores["requisitos.documentos"] = "Debe ser una lista de documentos."
        elif len(documentos) > DOCUMENTOS_MAX:
            errores["requisitos.documentos"] = f"Hasta {DOCUMENTOS_MAX} documentos."
        else:
            limpios = []
            for i, documento in enumerate(documentos):
                texto, error = fm.validar_texto_corto(documento, 1, DOCUMENTO_MAX)
                if error:
                    errores[f"requisitos.documentos.{i}"] = error
                else:
                    limpios.append(texto)
            if not any(k.startswith("requisitos.documentos") for k in errores):
                if len(set(limpios)) != len(limpios):
                    errores["requisitos.documentos"] = "Hay documentos repetidos."
                elif limpios:
                    limpio["documentos"] = limpios
    despues = _texto_de_requisitos("despues", crudo.get("despues"), DESPUES_MAX, errores)
    if despues:
        limpio["despues"] = despues
    return (None, errores) if errores else (limpio, {})


def validar(datos, parcial=False):
    """Valida lo que se envía al crear (`parcial=False`: nombre y plazo obligatorios) o al cambiar (`parcial=True`: al menos un campo).

    Devuelve `(limpio, errores)`; si hay errores, `limpio` es `None`. `limpio` solo lleva claves de `CAMPOS_EDITABLES`."""
    if not isinstance(datos, dict):
        return None, {"datos": "El cuerpo debe ser un objeto."}
    errores = {}
    if any(not isinstance(k, str) for k in datos) or set(datos) - set(CAMPOS_EDITABLES):
        errores["datos"] = "Hay campos que no se pueden indicar ni cambiar: solo el nombre, el plazo, para quién es, el formulario, los requisitos y si está activo."
    if parcial and not set(datos) & set(CAMPOS_EDITABLES):
        errores["datos"] = "Indica al menos un dato para cambiar."
    limpio = {}
    if "nombre" in datos or not parcial:
        if datos.get("nombre") is None:
            errores["nombre"] = "Este campo es obligatorio."
        else:
            texto, error = fm.validar_texto_corto(datos["nombre"], NOMBRE_MIN, NOMBRE_MAX)
            if error:
                errores["nombre"] = error
            else:
                limpio["nombre"] = texto
    if "sla_dias" in datos or not parcial:
        sla = datos.get("sla_dias")
        if sla is None:
            errores["sla_dias"] = "Este campo es obligatorio."
        elif not _es_entero(sla) or not SLA_MIN <= sla <= SLA_MAX:
            errores["sla_dias"] = f"Debe ser un número entero de {SLA_MIN} a {SLA_MAX} días hábiles."
        else:
            limpio["sla_dias"] = sla
    if "audiencia" in datos or not parcial:
        audiencia = datos.get("audiencia", "ciudadania")
        if audiencia not in AUDIENCIAS:
            errores["audiencia"] = "Debe ser «ciudadania», «institucion» o «ambas»."
        else:
            limpio["audiencia"] = audiencia
    if "formulario" in datos or not parcial:
        definicion, fallos = validar_formulario(datos.get("formulario", []))
        if fallos:
            errores.update(fallos)
        else:
            limpio["formulario"] = definicion
    if "requisitos" in datos or not parcial:
        requisitos, fallos = validar_requisitos(datos.get("requisitos", {}))
        if fallos:
            errores.update(fallos)
        else:
            limpio["requisitos"] = requisitos
    if "activo" in datos or not parcial:
        activo = datos.get("activo", True)
        if not isinstance(activo, bool):
            errores["activo"] = "Debe ser verdadero o falso."
        else:
            limpio["activo"] = activo
    return (None, errores) if errores else (limpio, {})


def tipo_a_dict(tipo):
    return {"id": tipo.pk, "institucion_id": tipo.institucion_id, "nombre": tipo.nombre, "sla_dias": tipo.sla_dias, "audiencia": tipo.audiencia,
            "formulario": tipo.formulario, "activo": tipo.activo, "version": tipo.version, "requisitos": tipo.requisitos}


def cambio_a_dict(cambio):
    """Una fila del historial del catálogo: quién, cuándo y qué (solo lo que cambió; en el alta, la foto de lo creado)."""
    actor = cambio.actor
    return {"id": cambio.pk, "accion": cambio.accion, "creado_en": cambio.creado_en,
            "tipo_tramite": {"id": cambio.tipo_tramite_id, "nombre": cambio.tipo_tramite.nombre},
            "actor": {"id": actor.pk, "usuario": actor.username} if actor is not None else None,
            "antes": cambio.antes, "despues": cambio.despues}
