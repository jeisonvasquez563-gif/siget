from django.db import models

from apps.identidad.models import Usuario
from apps.nucleo.modelos import SoloInsercion
from apps.tramites.models import ESTADOS, Tramite


class EventoAuditoria(SoloInsercion):
    """Libro de actuaciones. De solo inserción: la base lo impone con permisos y un trigger."""

    tramite = models.ForeignKey(Tramite, on_delete=models.DO_NOTHING, db_column="tramite_id")
    institucion_id = models.IntegerField()
    actor = models.ForeignKey(Usuario, null=True, on_delete=models.DO_NOTHING, db_column="actor_id", related_name="+")
    accion = models.TextField()
    estado_anterior = models.TextField(choices=ESTADOS, null=True, blank=True)
    estado_nuevo = models.TextField(choices=ESTADOS, null=True, blank=True)
    atributos = models.JSONField(default=dict)
    creado_en = models.DateTimeField(auto_now_add=True)

    class Meta(SoloInsercion.Meta):
        db_table = "evento_auditoria"


class DecisionPdp(SoloInsercion):
    """Cada decisión de acceso, permitida o negada, con la política que la motivó."""

    actor = models.ForeignKey(Usuario, null=True, on_delete=models.DO_NOTHING, db_column="actor_id", related_name="+")
    accion = models.TextField()
    recurso = models.TextField(null=True, blank=True)
    permitido = models.BooleanField()
    politica = models.TextField(null=True, blank=True)
    atributos = models.JSONField(default=dict)
    creado_en = models.DateTimeField(auto_now_add=True)

    class Meta(SoloInsercion.Meta):
        db_table = "decision_pdp"
