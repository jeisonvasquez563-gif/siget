import uuid

from django.db import models

from apps.identidad.models import Usuario
from apps.nucleo.modelos import ModeloDeEsquema, SoloInsercion


class Sesion(ModeloDeEsquema):
    """Una sesión. El token de refresco solo existe como hash; rota en cada uso y puede revocarse."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    usuario = models.ForeignKey(Usuario, on_delete=models.DO_NOTHING, db_column="usuario_id", related_name="sesiones")
    refresh_hash = models.TextField(unique=True)
    creado_en = models.DateTimeField(auto_now_add=True)
    expira_en = models.DateTimeField()
    revocada = models.BooleanField(default=False)
    reemplazada_por = models.ForeignKey("self", null=True, blank=True, on_delete=models.DO_NOTHING, db_column="reemplazada_por", related_name="+")
    ip = models.TextField(null=True, blank=True)

    class Meta(ModeloDeEsquema.Meta):
        db_table = "sesion"


class EventoSeguridad(SoloInsercion):
    """Autenticación y seguridad: inicios de sesión, fallos, bloqueos, reuso de tokens. Solo inserción."""

    actor = models.ForeignKey(Usuario, null=True, blank=True, on_delete=models.DO_NOTHING, db_column="actor_id", related_name="+")
    evento = models.TextField()
    ip = models.TextField(null=True, blank=True)
    detalle = models.JSONField(default=dict)
    creado_en = models.DateTimeField(auto_now_add=True)

    class Meta(SoloInsercion.Meta):
        db_table = "evento_seguridad"
