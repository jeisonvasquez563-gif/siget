from django.db import models

from apps.nucleo.modelos import ModeloDeEsquema


class Institucion(ModeloDeEsquema):
    TIPOS = [("real", "Real"), ("demostracion", "Demostración")]

    nombre = models.TextField(unique=True)
    tipo = models.TextField(choices=TIPOS)

    class Meta(ModeloDeEsquema.Meta):
        db_table = "institucion"

    def __str__(self):
        return self.nombre


class TipoTramite(ModeloDeEsquema):
    institucion = models.ForeignKey(Institucion, on_delete=models.DO_NOTHING, db_column="institucion_id")
    nombre = models.TextField()
    sla_dias = models.IntegerField()

    class Meta(ModeloDeEsquema.Meta):
        db_table = "tipo_tramite"

    def __str__(self):
        return f"{self.nombre} ({self.institucion_id})"
