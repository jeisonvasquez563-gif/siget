from django.core.management.base import BaseCommand, CommandError
from django.db import connection

from apps.nucleo.esquema import columnas_del_modelo, diferencias, modelos_de_dominio


class Command(BaseCommand):
    help = "Compara los modelos con las tablas reales del esquema siget. Falla si falta alguna columna."

    def handle(self, *args, **opciones):
        errores = 0
        with connection.cursor() as cursor:
            for modelo in modelos_de_dominio():
                tabla = modelo._meta.db_table
                descripcion = connection.introspection.get_table_description(cursor, tabla)
                columnas_bd = {c.name for c in descripcion}
                if not columnas_bd:
                    self.stdout.write(self.style.ERROR(f"{tabla}: la tabla no existe o no es visible"))
                    errores += 1
                    continue
                faltan, sobran = diferencias(columnas_del_modelo(modelo), columnas_bd)
                if faltan:
                    errores += 1
                    self.stdout.write(self.style.ERROR(f"{tabla}: faltan en la base {faltan}"))
                else:
                    extra = f" (columnas de la base sin mapear: {sobran})" if sobran else ""
                    self.stdout.write(self.style.SUCCESS(f"{tabla}: OK{extra}"))
        if errores:
            raise CommandError(f"{errores} tabla(s) no coinciden con los modelos")
