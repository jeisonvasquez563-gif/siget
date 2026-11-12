"""Escala los trámites que superaron su plazo (lo ejecuta un temporizador de systemd en VM1, cada hora).

Usa la conexión `escalador` (rol escalador_role): solo puede ejecutar siget.escalar_vencidos(), que en UNA transacción
marca los trámites abiertos con la fecha límite vencida y escribe un evento `escalamiento` en la auditoría por cada uno.
Es idempotente: un trámite ya escalado no se vuelve a escalar. La supervisión de la institución los ve con el filtro
«Escalados» y es quien los reasigna (acción escalar_tramite del PDP).
"""
from django.core.management.base import BaseCommand, CommandError
from django.db import DatabaseError, connections


class Command(BaseCommand):
    help = "Marca como escalados los trámites abiertos que superaron su fecha límite."

    def handle(self, *args, **opciones):
        try:
            with connections["escalador"].cursor() as cursor:
                cursor.execute("SELECT siget.escalar_vencidos()")
                (escalados,) = cursor.fetchone()
        except DatabaseError as error:
            raise CommandError(f"no se pudo escalar: {error.__class__.__name__}") from error
        self.stdout.write(f"escalar_vencidos: {escalados} trámite(s) escalado(s)")
