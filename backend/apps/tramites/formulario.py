"""Validación del contenido de un trámite contra el formulario de su tipo: funciones puras, sin base de datos.

El formulario (`tipo_tramite.formulario`) es una lista de campos `{id, etiqueta, tipo, obligatorio, max, opciones, ayuda, entero}`.
Lo que llega es JSON hostil por definición: aquí se rechaza todo lo que no sea exactamente lo que el formulario pide y se devuelve
el contenido normalizado (textos sin espacios en los bordes ni caracteres de control, números y fechas en su forma canónica).
Los errores van por campo: `{id_del_campo: mensaje}`; los que no son de un campo concreto, bajo la clave `datos`.
"""
import json
import math
import re
import unicodedata
from datetime import date, datetime
from zoneinfo import ZoneInfo

TIPOS = {"texto", "texto_largo", "numero", "fecha", "seleccion"}
TAMANO_BASE_DATOS = 16384  # CHECK de la base (pg_column_size de la columna jsonb)
TAMANO_MAXIMO_DATOS = 15000  # bytes de JSON que acepta Python: deja margen, porque jsonb pesa distinto que el JSON de texto
MAX_DEFECTO = {"texto": 200, "texto_largo": 2000}
MAX_NUMERO_DEFECTO = 10**9
MAX_CAMPOS = 50
ANIO_MINIMO = 1900
CLAVE_GENERAL = "datos"
ZONA_PANAMA = ZoneInfo("America/Panama")
_FECHA = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}")
# Formato (Cf) permitido: los unidos de emoji y de escrituras que los necesitan. El resto (bidireccionales, BOM, etc.) se rechaza.
_FORMATO_PERMITIDO = {"‌", "‍"}


class FormularioMalDefinido(ValueError):
    """La definición del formulario del tipo de trámite no es coherente: es un problema del catálogo, no de quien envía los datos."""


def definicion_valida(formulario):
    """Revisa que la DEFINICIÓN de un formulario sea coherente. Devuelve la lista de problemas (vacía si está bien)."""
    problemas = []
    if not isinstance(formulario, list) or len(formulario) > MAX_CAMPOS:
        return ["el formulario debe ser una lista de hasta %d campos" % MAX_CAMPOS]
    vistos = set()
    for i, campo in enumerate(formulario):
        if not isinstance(campo, dict):
            problemas.append(f"campo {i}: debe ser un objeto")
            continue
        identificador, tipo = campo.get("id"), campo.get("tipo")
        if not isinstance(identificador, str) or not re.fullmatch(r"[a-z][a-z0-9_]{0,39}", identificador):
            problemas.append(f"campo {i}: `id` inválido")
        elif identificador in vistos:
            problemas.append(f"campo {i}: `id` repetido ({identificador})")
        else:
            vistos.add(identificador)
        if not isinstance(campo.get("etiqueta"), str) or not campo["etiqueta"].strip():
            problemas.append(f"campo {i}: falta la `etiqueta`")
        if tipo not in TIPOS:
            problemas.append(f"campo {i}: `tipo` desconocido")
            continue
        if not isinstance(campo.get("obligatorio"), bool):
            problemas.append(f"campo {i}: `obligatorio` debe ser verdadero o falso")
        maximo = campo.get("max")
        if tipo in {"texto", "texto_largo", "numero"} and (isinstance(maximo, bool) or not isinstance(maximo, (int, float)) or maximo <= 0):
            problemas.append(f"campo {i}: `max` debe ser un número positivo")
        if tipo == "seleccion":
            opciones = campo.get("opciones")
            if not isinstance(opciones, list) or not opciones or not all(isinstance(o, str) and o.strip() == o and o for o in opciones) \
                    or len(set(opciones)) != len(opciones):
                problemas.append(f"campo {i}: `opciones` debe ser una lista de textos distintos")
        elif "opciones" in campo:
            problemas.append(f"campo {i}: solo `seleccion` lleva `opciones`")
        if "ayuda" in campo and not isinstance(campo["ayuda"], str):
            problemas.append(f"campo {i}: `ayuda` debe ser texto")
        if "entero" in campo and (tipo != "numero" or not isinstance(campo["entero"], bool)):
            problemas.append(f"campo {i}: `entero` solo aplica a números y es verdadero o falso")
    return problemas


def hoy_en_panama(ahora=None):
    return (ahora or datetime.now(ZONA_PANAMA)).astimezone(ZONA_PANAMA).date()


def _caracteres_no_permitidos(texto, permitir_saltos):
    for c in texto:
        if c in "\n\t" and permitir_saltos:
            continue
        categoria = unicodedata.category(c)
        if categoria in {"Cc", "Cs", "Co", "Cn"} or (categoria == "Cf" and c not in _FORMATO_PERMITIDO) or c in {"\u2028", "\u2029"}:
            return True
    return False


def _tiene_contenido(texto):
    """Al menos una letra o un número (categorías Unicode L y N): un texto de solo invisibles, espacios o signos no dice nada."""
    return any(unicodedata.category(c)[0] in {"L", "N"} for c in texto)


def _largo_real(texto):
    """Caracteres que cuentan para el mínimo: sin los invisibles de formato (Cf), con los que no se puede rellenar un texto."""
    return sum(1 for c in texto if unicodedata.category(c) != "Cf")


def _texto(valor, campo):
    if not isinstance(valor, str):
        return None, "Debe ser un texto."
    maximo = int(campo.get("max") or MAX_DEFECTO[campo["tipo"]])
    largo = campo["tipo"] == "texto_largo"
    if largo:
        valor = valor.replace("\r\n", "\n").replace("\r", "\n")
    valor = valor.strip()
    if len(valor) > maximo * 4:  # antes de normalizar: no se trabaja sobre cadenas enormes
        return None, f"No puede superar los {maximo} caracteres."
    valor = unicodedata.normalize("NFC", valor).strip()
    if not valor:
        return "", None
    if len(valor) > maximo:
        return None, f"No puede superar los {maximo} caracteres."
    if _caracteres_no_permitidos(valor, permitir_saltos=largo):
        return None, "Contiene caracteres no permitidos" + ("." if largo else " (ni saltos de línea).")
    if campo.get("obligatorio") and not _tiene_contenido(valor):
        return None, "Debe tener al menos una letra o un número."
    return valor, None


def validar_texto_libre(valor, minimo, maximo):
    """Un texto suelto (motivo de una decisión, respuesta a una subsanación): de `minimo` a `maximo` caracteres, con saltos de línea
    pero sin caracteres de control, y con al menos una letra o un número. El mínimo se cuenta sin los invisibles de formato.
    Devuelve `(texto, None)` o `(None, mensaje)`."""
    if not isinstance(valor, str):
        return None, "Debe ser un texto."
    limpio, error = _texto(valor, {"tipo": "texto_largo", "max": maximo, "obligatorio": True})
    if error:
        return None, error
    if _largo_real(limpio) < minimo:
        return None, f"Debe tener al menos {minimo} caracteres."
    return limpio, None


def _numero(valor, campo):
    if isinstance(valor, bool) or not isinstance(valor, (int, float)):
        return None, "Debe ser un número."
    if isinstance(valor, float) and not math.isfinite(valor):
        return None, "Debe ser un número."
    maximo = campo.get("max") or MAX_NUMERO_DEFECTO
    if valor < 0 or valor > maximo:
        return None, f"Debe estar entre 0 y {maximo}."
    if isinstance(valor, float) and valor.is_integer():
        valor = int(valor)
    if campo.get("entero") and not isinstance(valor, int):
        return None, "Debe ser un número entero."
    return valor, None


def _fecha(valor, hoy):
    if not isinstance(valor, str) or not _FECHA.fullmatch(valor.strip()):
        return None, "Debe ser una fecha con el formato AAAA-MM-DD."
    try:
        anio, mes, dia = (int(p) for p in valor.strip().split("-"))
        fecha = date(anio, mes, dia)
    except ValueError:
        return None, "No es una fecha válida."
    if fecha.year < ANIO_MINIMO:
        return None, "No es una fecha válida."
    if fecha > hoy:
        return None, "No puede ser una fecha futura."
    return fecha.isoformat(), None


def _seleccion(valor, campo):
    if not isinstance(valor, str):
        return None, "Debe ser una de las opciones."
    valor = valor.strip()
    if valor not in campo["opciones"]:
        return None, "Elige una de las opciones de la lista."
    return valor, None


def validar_datos(formulario, datos, hoy=None):
    """Valida `datos` contra `formulario`. Devuelve `(limpios, errores)`: si hay errores, `limpios` es None.

    Un campo opcional vacío (ausente, nulo o texto en blanco) no se guarda. `hoy` (una fecha) es la referencia para «no futura».
    """
    problemas = definicion_valida(formulario)
    if problemas:
        raise FormularioMalDefinido("el formulario del tipo de trámite está mal definido: " + "; ".join(problemas))
    if not isinstance(datos, dict):
        return None, {CLAVE_GENERAL: "Los datos deben ser un objeto."}
    hoy = hoy or hoy_en_panama()
    campos = {c["id"]: c for c in formulario}
    errores, limpios = {}, {}
    if any(not isinstance(k, str) for k in datos) or set(datos) - set(campos):
        errores[CLAVE_GENERAL] = "Hay campos que este trámite no tiene."  # sin repetir lo recibido
    for identificador, campo in campos.items():
        valor = datos.get(identificador)
        if valor is None or (isinstance(valor, str) and not valor.strip()):
            if campo["obligatorio"]:
                errores[identificador] = "Este campo es obligatorio."
            continue
        tipo = campo["tipo"]
        if tipo in {"texto", "texto_largo"}:
            limpio, error = _texto(valor, campo)
        elif tipo == "numero":
            limpio, error = _numero(valor, campo)
        elif tipo == "fecha":
            limpio, error = _fecha(valor, hoy)
        else:
            limpio, error = _seleccion(valor, campo)
        if error:
            errores[identificador] = error
        elif limpio == "":  # solo espacios tras normalizar
            if campo["obligatorio"]:
                errores[identificador] = "Este campo es obligatorio."
        else:
            limpios[identificador] = limpio
    if not errores and len(json.dumps(limpios, ensure_ascii=False).encode()) > TAMANO_MAXIMO_DATOS:
        errores[CLAVE_GENERAL] = "El contenido es demasiado grande."
    return (None, errores) if errores else (limpios, {})


def datos_de_ejemplo(formulario):
    """Un contenido válido para el formulario (los campos obligatorios, con valores de prueba). Para siembras y verificaciones."""
    ejemplo = {}
    for campo in formulario:
        if not campo["obligatorio"]:
            continue
        tipo = campo["tipo"]
        if tipo in {"texto", "texto_largo"}:
            ejemplo[campo["id"]] = ("Dato de prueba de " + campo["etiqueta"])[: int(campo.get("max") or MAX_DEFECTO[tipo])]
        elif tipo == "numero":
            ejemplo[campo["id"]] = min(10, campo.get("max") or 10)
        elif tipo == "fecha":
            ejemplo[campo["id"]] = "2026-01-15"
        else:
            ejemplo[campo["id"]] = campo["opciones"][0]
    return ejemplo
