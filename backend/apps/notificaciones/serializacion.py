"""Salida de la API de notificaciones: funciones puras, sin base de datos.

Una notificación no lleva texto: solo el tipo, el trámite y las fechas (el texto lo arma la interfaz). Del trámite se muestra lo que
la persona ya ve en su listado (nombre del tipo e institución) y solo si la seguridad por filas se lo deja ver; si ya no puede verlo
(por ejemplo, perdió su membresía), `tramite` es null y no se revela nada más.
"""


def notificacion_a_dict(notificacion, tramite):
    """`tramite` es el trámite visible para la persona (con su tipo e institución) o None si la base no se lo muestra."""
    return {
        "id": notificacion.pk,
        "tipo": notificacion.tipo,
        "tramite_id": notificacion.tramite_id,
        "tramite": None if tramite is None else {"tipo_tramite": tramite.tipo_tramite.nombre, "institucion": tramite.institucion.nombre},
        "creada_en": notificacion.creada_en.isoformat(),
        "leida": notificacion.leida_en is not None,
    }
