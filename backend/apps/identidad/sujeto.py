"""Adaptador entre el modelo `Usuario` y el `Sujeto` que entiende el PDP."""
from apps.autorizacion.pdp import Sujeto


def construir_sujeto(usuario, membresias=()):
    """`membresias`: iterable de objetos `Membresia` (o pares (institucion_id, rol)) del usuario."""
    pares = set()
    for m in membresias:
        if isinstance(m, tuple):
            pares.add(m)
        else:
            pares.add((m.institucion_id, m.rol))
    return Sujeto(
        id=usuario.pk,
        estado_cuenta=usuario.estado_cuenta,
        nivel_aseguramiento=usuario.nivel_aseguramiento,
        mfa_verificado_en=usuario.mfa_verificado_en,
        rol_plataforma=usuario.rol_plataforma,
        membresias=frozenset(pares),
    )
