"""Contexto de sesión para Row Level Security.

Las políticas RLS de la base filtran con `siget.ctx_usuario()` y `siget.ctx_instituciones()`, que leen
las variables `app.usuario_id` y `app.instituciones`. El backend las fija **solo para la transacción
actual** (`set_config(..., true)`), después de que el PDP permitió la petición. Por eso la API debe
correr con `ATOMIC_REQUESTS = True`: al terminar la transacción el contexto desaparece y la
siguiente petición arranca sin ningún privilegio heredado.
"""
from django.db import connection


def formatear_instituciones(instituciones):
    """Lista de ids -> '1,3' (ordenada, sin duplicados). Rechaza lo que no sea un entero positivo."""
    ids = set()
    for valor in instituciones:
        if isinstance(valor, bool) or not isinstance(valor, int) or valor <= 0:
            raise ValueError(f"id de institución inválido: {valor!r}")
        ids.add(valor)
    return ",".join(str(i) for i in sorted(ids))


def fijar_contexto(usuario_id, instituciones=()):
    """Fija el contexto RLS para la transacción en curso. Debe llamarse dentro de `transaction.atomic()`."""
    if isinstance(usuario_id, bool) or not isinstance(usuario_id, int) or usuario_id <= 0:
        raise ValueError(f"id de usuario inválido: {usuario_id!r}")
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT set_config('app.usuario_id', %s, true), set_config('app.instituciones', %s, true)",
            [str(usuario_id), formatear_instituciones(instituciones)],
        )
