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
    audiencia = models.TextField(default="ciudadania")  # ciudadania | institucion | ambas

    class Meta(ModeloDeEsquema.Meta):
        db_table = "tipo_tramite"

    def __str__(self):
        return f"{self.nombre} ({self.institucion_id})"


class Feriado(ModeloDeEsquema):
    """Días feriados nacionales de Panamá: no cuentan para los plazos en días hábiles (migración 013)."""

    fecha = models.DateField(primary_key=True)
    descripcion = models.TextField()

    class Meta(ModeloDeEsquema.Meta):
        db_table = "feriado"

    def __str__(self):
        return f"{self.fecha} {self.descripcion}"


def feriados_entre(desde, hasta):
    """Conjunto de fechas feriadas en el rango (inclusivo)."""
    return set(Feriado.objects.filter(fecha__gte=desde, fecha__lte=hasta).values_list("fecha", flat=True))
