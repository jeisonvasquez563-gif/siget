"""Entrada y salida de la consola de auditoría: funciones puras, sin base de datos."""
import re

from apps.tramites.serializacion import entero_positivo, paginacion  # noqa: F401 (paginacion se reexporta)

NOMBRE_RE = re.compile(r"^[a-z0-9_]{1,64}$")
RESULTADOS = {"permitidas": True, "negadas": False}


def _nombre(valor):
    return valor if isinstance(valor, str) and NOMBRE_RE.match(valor) else None


def filtros(parametros, permitidos):
    """Valida los filtros de la consulta. Devuelve un dict para el ORM, o None si alguno es inválido.

    `permitidos`: los filtros que esta consulta admite, entre `resultado`, `politica`, `accion`, `evento` y `actor`.
    Cualquier otro parámetro se ignora (la paginación se lee aparte).
    """
    salida = {}
    for nombre in permitidos:
        crudo = parametros.get(nombre)
        if crudo is None or crudo == "":
            continue
        if nombre == "resultado":
            if crudo not in RESULTADOS:
                return None
            salida["permitido"] = RESULTADOS[crudo]
        elif nombre == "actor":
            if not isinstance(crudo, str) or not crudo.isascii() or not crudo.isdigit() or entero_positivo(int(crudo)) is None:
                return None
            salida["actor_id"] = int(crudo)
        else:
            valor = _nombre(crudo)
            if valor is None:
                return None
            salida[nombre] = valor
    return salida


def _iso(valor):
    return valor.isoformat() if valor is not None else None


def _actor(fila):
    return {"id": fila["actor_id"], "usuario": fila["actor__username"]} if fila["actor_id"] else None


def decision_a_dict(fila):
    atributos = fila["atributos"] or {}
    return {
        "id": fila["id"], "creado_en": _iso(fila["creado_en"]), "actor": _actor(fila),
        "accion": fila["accion"], "recurso": fila["recurso"], "permitido": fila["permitido"],
        "politica": fila["politica"], "motivo": atributos.get("motivo"), "institucion_id": atributos.get("institucion_id"),
    }


def evento_seguridad_a_dict(fila):
    return {
        "id": fila["id"], "creado_en": _iso(fila["creado_en"]), "evento": fila["evento"], "ip": fila["ip"],
        "actor": _actor(fila), "detalle": fila["detalle"] or {},
    }


def evento_tramite_a_dict(fila):
    return {
        "id": fila["id"], "creado_en": _iso(fila["creado_en"]), "tramite_id": fila["tramite_id"],
        "institucion_id": fila["institucion_id"], "accion": fila["accion"],
        "estado_anterior": fila["estado_anterior"], "estado_nuevo": fila["estado_nuevo"], "actor": _actor(fila),
    }
