"""Detecta patrones sospechosos y deja una alerta por cada uno (lo ejecuta un temporizador de systemd en VM1, cada 5 minutos).

Usa la conexión `detector` (rol detector_role): solo puede ejecutar siget.detectar_anomalias(), que lee los eventos de seguridad y las
decisiones del PDP y crea o actualiza las alertas (migración 019). Es idempotente: sin eventos nuevos no cambia nada. El operador de
seguridad las ve y las revisa en su consola (acciones ver_alertas y revisar_alerta del PDP).
"""
from django.core.management.base import BaseCommand, CommandError
from django.db import DatabaseError, connections


class Command(BaseCommand):
    help = "Crea o actualiza las alertas de seguridad según los eventos recientes."

    def handle(self, *args, **opciones):
        try:
            with connections["detector"].cursor() as cursor:
                cursor.execute("SELECT siget.detectar_anomalias()")
                (alertas,) = cursor.fetchone()
        except DatabaseError as error:
            raise CommandError(f"no se pudo detectar: {error.__class__.__name__}") from error
        self.stdout.write(f"detectar_anomalias: {alertas} alerta(s) creada(s) o actualizada(s)")
