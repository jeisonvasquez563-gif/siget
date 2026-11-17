"""Base común de los modelos de SIGET.

El esquema `siget` lo crea y lo protege la base de datos (roles, RLS, triggers y permisos, ver
`database/diseno-roles-permisos.sql` y `database/migraciones/`). Django **no crea ni migra** estas
tablas: los modelos solo las mapean (`managed = False`). La base es la autoridad.
"""
from django.db import models


class ModeloDeEsquema(models.Model):
    class Meta:
        abstract = True
        managed = False


class SoloInsercion(ModeloDeEsquema):
    """Tablas inalterables (auditoría y decisiones): la aplicación solo inserta.

    La base lo impone con permisos y triggers; esto es una segunda barrera en el ORM.
    """

    class Meta:
        abstract = True
        managed = False

    def save(self, *args, **kwargs):
        if self.pk is not None and not self._state.adding:
            raise PermissionError(f"{self._meta.db_table} es de solo inserción: no se modifica")
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise PermissionError(f"{self._meta.db_table} es de solo inserción: no se borra")
