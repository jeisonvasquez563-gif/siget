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
    # Lo marca solo la función siget.escalar_vencidos() de la base (la aplicación no puede escribir esta columna)
    escalado_en = models.DateTimeField(null=True, blank=True)
    # Lo que la persona respondió al formulario del tipo (migración 017). Solo cambia al responder una subsanación: la base lo impone
    datos = models.JSONField(default=dict)
    # Copia del formulario del tipo, tomada por la base al crear el trámite (migración 020) e inmutable: el expediente se muestra y se valida con
    # ella aunque la coordinación cambie después el formulario del tipo. Lo que mande la aplicación al insertar, la base lo ignora
    formulario = models.JSONField(default=list)
    creado_en = models.DateTimeField(auto_now_add=True)

    class Meta(ModeloDeEsquema.Meta):
        db_table = "tramite"


class Documento(ModeloDeEsquema):
    """Archivo adjunto a un trámite (migración 015). El archivo vive cifrado en el volumen de documentos; aquí solo sus
    metadatos. Sin borrado ni edición: la aplicación solo inserta y lee (y la base filtra por filas como en `tramite`)."""

    tramite = models.ForeignKey(Tramite, on_delete=models.DO_NOTHING, db_column="tramite_id", related_name="+")
    institucion = models.ForeignKey(Institucion, on_delete=models.DO_NOTHING, db_column="institucion_id", related_name="+")
    subido_por = models.ForeignKey(Usuario, on_delete=models.DO_NOTHING, db_column="subido_por", related_name="+")
    nombre = models.TextField()
    tipo_mime = models.TextField()
    tamano = models.IntegerField()
    sha256 = models.TextField()
    ubicacion = models.TextField(unique=True)
    creado_en = models.DateTimeField(auto_now_add=True)

    class Meta(ModeloDeEsquema.Meta):
        db_table = "documento"


class Transicion(ModeloDeEsquema):
    """Pasos válidos entre estados: la autoridad es esta tabla y su trigger en la base."""

    pk = models.CompositePrimaryKey("desde", "hasta")
    desde = models.TextField(choices=ESTADOS)
    hasta = models.TextField(choices=ESTADOS)

    class Meta(ModeloDeEsquema.Meta):
        db_table = "transicion"
