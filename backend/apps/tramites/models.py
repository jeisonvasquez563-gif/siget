from django.db import models

from apps.catalogo.models import Institucion, TipoTramite
from apps.identidad.models import Usuario
from apps.nucleo.modelos import ModeloDeEsquema

ESTADOS = [
    ("Pendiente", "Pendiente"),
    ("En Tramitacion", "En Tramitación"),
    ("En Subsanacion", "En Subsanación"),
    ("Aprobado", "Aprobado"),
    ("Rechazado", "Rechazado"),
]


class Tramite(ModeloDeEsquema):
    """Solicitud concreta. La base valida las transiciones, escribe la auditoría y filtra por institución (RLS)."""

    tipo_tramite = models.ForeignKey(TipoTramite, on_delete=models.DO_NOTHING, db_column="tipo_tramite_id")
    institucion = models.ForeignKey(Institucion, on_delete=models.DO_NOTHING, db_column="institucion_id")
    solicitante = models.ForeignKey(Usuario, on_delete=models.DO_NOTHING, db_column="solicitante_id", related_name="tramites_propios")
    funcionario_asignado = models.ForeignKey(
        Usuario, null=True, blank=True, on_delete=models.DO_NOTHING, db_column="funcionario_asignado_id", related_name="tramites_asignados"
    )
    estado = models.TextField(choices=ESTADOS, default="Pendiente")
    sensibilidad = models.SmallIntegerField(default=1)
    fecha_limite = models.DateTimeField(null=True, blank=True)
    creado_en = models.DateTimeField(auto_now_add=True)

    class Meta(ModeloDeEsquema.Meta):
        db_table = "tramite"


class Transicion(ModeloDeEsquema):
    """Pasos válidos entre estados: la autoridad es esta tabla y su trigger en la base."""

    pk = models.CompositePrimaryKey("desde", "hasta")
    desde = models.TextField(choices=ESTADOS)
    hasta = models.TextField(choices=ESTADOS)

    class Meta(ModeloDeEsquema.Meta):
        db_table = "transicion"
