from django.db import models

from apps.identidad.models import Usuario
from apps.nucleo.modelos import ModeloDeEsquema, SoloInsercion


class RotacionSecreto(SoloInsercion):
    """Cuándo y quién rotó un secreto (migración 010). Nunca el valor. Solo inserción."""

    secreto = models.TextField()
    registrado_por = models.ForeignKey(Usuario, on_delete=models.DO_NOTHING, db_column="registrado_por", related_name="+")
    nota = models.TextField(default="", blank=True)
    creado_en = models.DateTimeField(auto_now_add=True)

    class Meta(SoloInsercion.Meta):
        db_table = "rotacion_secreto"


REGLAS_ALERTA = [
    ("rafaga_login_fallido_ip", "Ráfaga de inicios de sesión fallidos desde una IP"),
    ("denegaciones_persona", "Muchas denegaciones de acceso a una misma persona"),
    ("reuso_token_refresco", "Reúso de un token de refresco"),
    ("bloqueos_repetidos", "Bloqueos repetidos de una misma cuenta"),
]
SEVERIDADES_ALERTA = [("media", "Media"), ("alta", "Alta")]
ESTADOS_ALERTA = [("abierta", "Abierta"), ("revisada", "Revisada"), ("descartada", "Descartada")]


class AlertaSeguridad(ModeloDeEsquema):
    """Un patrón sospechoso detectado en los eventos de seguridad o en las decisiones del PDP (migración 019).

    La crea o actualiza SOLO la función `siget.detectar_anomalias()` (la base no deja insertar ni borrar a la aplicación); la aplicación únicamente la
    lee y la revisa: `estado`, `revisada_por`, `revisada_en` y `nota` cambian una sola vez, con nota y por un operador de seguridad (un disparador lo
    impone). El detalle lleva solo contadores y nombres de evento o de política."""

    regla = models.TextField(choices=REGLAS_ALERTA)
    severidad = models.TextField(choices=SEVERIDADES_ALERTA)
    usuario = models.ForeignKey(Usuario, null=True, blank=True, on_delete=models.DO_NOTHING, db_column="usuario_id", related_name="+")
    ip = models.GenericIPAddressField(null=True, blank=True)
    conteo = models.IntegerField()
    primera_vez = models.DateTimeField()
    ultima_vez = models.DateTimeField()
    detalle = models.JSONField(default=dict)
    estado = models.TextField(choices=ESTADOS_ALERTA, default="abierta")
    revisada_por = models.ForeignKey(Usuario, null=True, blank=True, on_delete=models.DO_NOTHING, db_column="revisada_por", related_name="+")
    revisada_en = models.DateTimeField(null=True, blank=True)
    nota = models.TextField(null=True, blank=True)

    class Meta(ModeloDeEsquema.Meta):
        db_table = "alerta_seguridad"

    def save(self, *args, **kwargs):
        raise PermissionError("alerta_seguridad la crea la base de datos (siget.detectar_anomalias): la aplicación no inserta por el ORM")

    def delete(self, *args, **kwargs):
        raise PermissionError("alerta_seguridad no se borra")
