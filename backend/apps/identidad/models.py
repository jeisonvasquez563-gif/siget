from django.db import models

from apps.catalogo.models import Institucion
from apps.nucleo.modelos import ModeloDeEsquema


class Usuario(ModeloDeEsquema):
    """Persona con sus atributos de sujeto (ABAC). Todavía no es el modelo de autenticación de Django."""

    ESTADOS_CUENTA = [("activa", "Activa"), ("bloqueada", "Bloqueada"), ("suspendida", "Suspendida")]
    ROLES_PLATAFORMA = [
        ("ninguno", "Ninguno"),
        ("operador_infraestructura", "Operador de infraestructura"),
        ("operador_identidades", "Operador de identidades"),
        ("operador_catalogo", "Operador de catálogo"),
        ("operador_seguridad", "Operador de seguridad"),
        ("custodio_secretos", "Custodio de secretos"),
        ("auditor", "Auditor"),
    ]

    username = models.TextField(unique=True)
    password_hash = models.TextField()
    nivel_aseguramiento = models.SmallIntegerField(default=1)
    estado_cuenta = models.TextField(choices=ESTADOS_CUENTA, default="activa")
    rol_plataforma = models.TextField(choices=ROLES_PLATAFORMA, default="ninguno")
    mfa_verificado_en = models.DateTimeField(null=True, blank=True)
    # Segundo factor y bloqueo por intentos (migración 004). El secreto TOTP se guarda CIFRADO.
    mfa_secreto = models.TextField(null=True, blank=True)
    mfa_activo = models.BooleanField(default=False)
    mfa_ultimo_paso = models.BigIntegerField(null=True, blank=True)
    intentos_fallidos = models.IntegerField(default=0)
    bloqueado_hasta = models.DateTimeField(null=True, blank=True)
    creado_en = models.DateTimeField(auto_now_add=True)

    class Meta(ModeloDeEsquema.Meta):
        db_table = "usuario"

    def __str__(self):
        return self.username


class Membresia(ModeloDeEsquema):
    """Rol de una persona dentro de una institución. Nadie se asigna a sí mismo (lo impone la base)."""

    ROLES = [
        ("ciudadano", "Ciudadano"),
        ("funcionario", "Funcionario"),
        ("supervisor", "Supervisor"),
        ("coordinador_institucional", "Coordinador institucional"),
    ]

    pk = models.CompositePrimaryKey("usuario", "institucion", "rol")
    usuario = models.ForeignKey(Usuario, on_delete=models.DO_NOTHING, db_column="usuario_id", related_name="membresias")
    institucion = models.ForeignKey(Institucion, on_delete=models.DO_NOTHING, db_column="institucion_id")
    rol = models.TextField(choices=ROLES)
    asignado_por = models.ForeignKey(Usuario, on_delete=models.DO_NOTHING, db_column="asignado_por", related_name="+")
    creado_en = models.DateTimeField(auto_now_add=True)

    class Meta(ModeloDeEsquema.Meta):
        db_table = "membresia"


class Aprobacion(ModeloDeEsquema):
    """Control dual: quien propone un alta no puede aprobarla (lo impone la base)."""

    ACCIONES = [("alta_institucion", "Alta de institución"), ("alta_coordinador", "Alta de coordinador")]
    ESTADOS = [("pendiente", "Pendiente"), ("aprobada", "Aprobada"), ("rechazada", "Rechazada")]

    accion = models.TextField(choices=ACCIONES)
    objetivo = models.TextField()
    propuesto_por = models.ForeignKey(Usuario, on_delete=models.DO_NOTHING, db_column="propuesto_por", related_name="+")
    aprobado_por = models.ForeignKey(Usuario, null=True, on_delete=models.DO_NOTHING, db_column="aprobado_por", related_name="+")
    estado = models.TextField(choices=ESTADOS, default="pendiente")
    creado_en = models.DateTimeField(auto_now_add=True)
    resuelto_en = models.DateTimeField(null=True, blank=True)

    class Meta(ModeloDeEsquema.Meta):
        db_table = "aprobacion"
