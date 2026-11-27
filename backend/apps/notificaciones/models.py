from django.db import models

from apps.identidad.models import Usuario
from apps.nucleo.modelos import ModeloDeEsquema
from apps.tramites.models import Tramite

TIPOS = [
    ("tramite_en_atencion", "Trámite en atención"),
    ("subsanacion_pedida", "Subsanación pedida"),
    ("tramite_aprobado", "Trámite aprobado"),
    ("tramite_rechazado", "Trámite rechazado"),
    ("subsanacion_respondida", "Subsanación respondida"),
    ("tramite_escalado", "Trámite escalado"),
    ("tramite_desistido", "Trámite desistido"),
]


class Notificacion(ModeloDeEsquema):
    """Aviso para una persona sobre un trámite (migración 018). Sin texto libre: el texto lo arma la interfaz según el tipo.

    La genera un disparador de la base al cambiar el trámite; la aplicación solo lee y marca como leída (la base filtra por filas:
    cada persona ve únicamente las suyas, y `leida_en` solo pasa de NULL a un valor). Aquí se cierra también la puerta en el ORM."""

    usuario = models.ForeignKey(Usuario, on_delete=models.DO_NOTHING, db_column="usuario_id", related_name="+")
    tipo = models.TextField(choices=TIPOS)
    tramite = models.ForeignKey(Tramite, on_delete=models.DO_NOTHING, db_column="tramite_id", related_name="+")
    creada_en = models.DateTimeField()
    leida_en = models.DateTimeField(null=True, blank=True)

    class Meta(ModeloDeEsquema.Meta):
        db_table = "notificacion"

    def save(self, *args, **kwargs):
        raise PermissionError("notificacion la crea la base de datos: la aplicación no inserta ni modifica filas por el ORM")

    def delete(self, *args, **kwargs):
        raise PermissionError("notificacion no se borra")
