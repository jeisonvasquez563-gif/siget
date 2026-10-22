"""Entrada y salida de la API de trámites: funciones puras, sin base de datos.

Qué se muestra depende de quién mira. La persona que pidió el trámite ve la institución, el estado y las
fechas (la "unidad responsable" y la fase que reconoce la Ley 83 de 2012, Art. 4 num. 8); el personal de la
institución ve además los identificadores de las personas y el detalle interno. Nunca se muestra de más.
"""
from datetime import timedelta

ESTADOS_VALIDOS = {"Pendiente", "En Tramitacion", "En Subsanacion", "Aprobado", "Rechazado"}
ESTADOS_FINALES = {"Aprobado", "Rechazado"}
LIMITE_DEFECTO, LIMITE_MAXIMO = 20, 100
BIGINT_MAXIMO = 2**63 - 1


def entero_positivo(valor):
    """Un entero positivo de verdad: rechaza booleanos, textos, decimales y lo que no cabe en la base."""
    if isinstance(valor, bool) or not isinstance(valor, int) or not 0 < valor <= BIGINT_MAXIMO:
        return None
    return valor


def texto(valor):
    return valor if isinstance(valor, str) else None


def paginacion(parametros):
    """`limite` y `desplazamiento` de la consulta. Devuelve (limite, desplazamiento) o None si son inválidos."""
    def leer(nombre, defecto, minimo, maximo):
        crudo = parametros.get(nombre)
        if crudo is None:
            return defecto
        if not isinstance(crudo, str) or not crudo.isascii() or not crudo.isdigit():
            return None
        numero = int(crudo)
        return numero if minimo <= numero <= maximo else None

    limite = leer("limite", LIMITE_DEFECTO, 1, LIMITE_MAXIMO)
    desplazamiento = leer("desplazamiento", 0, 0, 1_000_000)
    if limite is None or desplazamiento is None:
        return None
    return limite, desplazamiento


def calcular_fecha_limite(ahora, sla_dias):
    """Plazo del trámite en días calendario (parámetro de diseño; los días hábiles quedan por modelar)."""
    return ahora + timedelta(days=sla_dias)


def esta_vencido(fecha_limite, estado, ahora):
    return fecha_limite is not None and estado not in ESTADOS_FINALES and fecha_limite < ahora


def _iso(valor):
    return valor.isoformat() if valor is not None else None


def tramite_a_dict(tramite, personal, ahora):
    datos = {
        "id": tramite.pk,
        "tipo_tramite": {"id": tramite.tipo_tramite_id, "nombre": tramite.tipo_tramite.nombre},
        "institucion": {"id": tramite.institucion_id, "nombre": tramite.institucion.nombre},
        "estado": tramite.estado,
        "fecha_limite": _iso(tramite.fecha_limite),
        "vencido": esta_vencido(tramite.fecha_limite, tramite.estado, ahora),
        "creado_en": _iso(tramite.creado_en),
    }
    if personal:
        datos.update(solicitante_id=tramite.solicitante_id, funcionario_asignado_id=tramite.funcionario_asignado_id,
                     sensibilidad=tramite.sensibilidad)
    else:
        datos["asignado"] = tramite.funcionario_asignado_id is not None  # quién, no: es dato del personal
    return datos


def evento_a_dict(evento, personal):
    datos = {
        "id": evento.pk, "accion": evento.accion, "estado_anterior": evento.estado_anterior,
        "estado_nuevo": evento.estado_nuevo, "institucion_id": evento.institucion_id, "creado_en": _iso(evento.creado_en),
    }
    if personal:
        datos.update(actor_id=evento.actor_id, atributos=evento.atributos)
    return datos
