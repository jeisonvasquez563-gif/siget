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
    # Datos que pide el trámite (migración 017): lista de campos; la validación está en apps/tramites/formulario.py
    formulario = models.JSONField(default=list)
    # Migración 020: un tipo desactivado no se ofrece para trámites nuevos (los que ya existen siguen su curso); nunca se borra
    activo = models.BooleanField(default=True)
    # Migración 020: lo lleva solo la base (1 al crear, +1 en cada cambio real); la API lo usa para no pisar la edición de otra persona
    version = models.IntegerField(default=1)

    class Meta(ModeloDeEsquema.Meta):
        db_table = "tipo_tramite"

    def __str__(self):
        return f"{self.nombre} ({self.institucion_id})"


class CatalogoCambio(ModeloDeEsquema):
    """Registro inalterable de cada alta y cambio de un tipo de trámite (migración 020).

    Lo escribe SOLO un disparador de la base (la aplicación no inserta ni modifica); la aplicación únicamente lo lee, y la seguridad por filas
    deja ver a la coordinación solo las filas de las instituciones que coordina. `antes` y `despues` llevan solo las columnas que cambiaron
    (en el alta, `despues` es la foto completa y `antes` es nulo)."""

    ACCIONES = [("alta", "Alta"), ("cambio", "Cambio"), ("activado", "Activado"), ("desactivado", "Desactivado")]

    tipo_tramite = models.ForeignKey(TipoTramite, on_delete=models.DO_NOTHING, db_column="tipo_tramite_id", related_name="+")
    institucion = models.ForeignKey(Institucion, on_delete=models.DO_NOTHING, db_column="institucion_id", related_name="+")
    actor = models.ForeignKey("identidad.Usuario", null=True, blank=True, on_delete=models.DO_NOTHING, db_column="actor_id", related_name="+")
    accion = models.TextField(choices=ACCIONES)
    antes = models.JSONField(null=True, blank=True)
    despues = models.JSONField(null=True, blank=True)
    creado_en = models.DateTimeField()

    class Meta(ModeloDeEsquema.Meta):
        db_table = "catalogo_cambio"

    def save(self, *args, **kwargs):
        raise PermissionError("catalogo_cambio lo escribe la base de datos (disparador de tipo_tramite): la aplicación no inserta por el ORM")

    def delete(self, *args, **kwargs):
        raise PermissionError("catalogo_cambio es de solo inserción: no se borra")


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
