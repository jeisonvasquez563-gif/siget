from django.db import models

from apps.identidad.models import Usuario
from apps.nucleo.modelos import SoloInsercion


class RotacionSecreto(SoloInsercion):
    """Cuándo y quién rotó un secreto (migración 010). Nunca el valor. Solo inserción."""

    secreto = models.TextField()
    registrado_por = models.ForeignKey(Usuario, on_delete=models.DO_NOTHING, db_column="registrado_por", related_name="+")
    nota = models.TextField(default="", blank=True)
    creado_en = models.DateTimeField(auto_now_add=True)

    class Meta(SoloInsercion.Meta):
        db_table = "rotacion_secreto"
