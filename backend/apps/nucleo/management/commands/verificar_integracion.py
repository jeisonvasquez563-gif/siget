"""Recorrido de extremo a extremo por el ORM contra la base real, dentro de una transacción que se revierte.

Verifica que lo que el backend asume de la base es cierto: RLS por institución, triggers de estado y
auditoría, permisos de `app_role` y protecciones del ORM. No deja ningún dato.
"""
from django.core.management.base import BaseCommand, CommandError
from django.db import DatabaseError, connection, transaction

from apps.auditoria.models import EventoAuditoria
from apps.catalogo.models import Institucion, TipoTramite
from apps.identidad.models import Usuario
from apps.nucleo.contexto import fijar_contexto
from apps.tramites.models import Tramite


class _Revertir(Exception):
    pass


class Command(BaseCommand):
    help = "Prueba de integración contra la base real (se revierte al final)."

    def _paso(self, nombre, ok, detalle=""):
        self.resultados.append(ok)
        marca = self.style.SUCCESS("PASA ") if ok else self.style.ERROR("FALLA")
        self.stdout.write(f"{marca} {nombre}{(' - ' + detalle) if detalle else ''}")

    def _rechaza_la_base(self, nombre, operacion):
        """Ejecuta `operacion` en un savepoint y espera que la base la rechace."""
        try:
            with transaction.atomic():
                operacion()
            self._paso(nombre, False, "la base lo permitió")
        except DatabaseError as error:
            self._paso(nombre, True, f"rechazado por la base ({type(error.__cause__ or error).__name__})")

    def handle(self, *args, **opciones):
        self.resultados = []
        try:
            with transaction.atomic():
                self._recorrer()
                raise _Revertir()
        except _Revertir:
            pass
        # El contexto de la transacción revertida no debe sobrevivir: una transacción nueva arranca sin privilegios.
        with transaction.atomic(), connection.cursor() as c:
            c.execute("select nullif(current_setting('app.usuario_id', true), ''), nullif(current_setting('app.instituciones', true), '')")
            residuo = c.fetchone()
        self._paso("el contexto no sobrevive a la transacción (la siguiente arranca sin privilegios)", residuo == (None, None), f"residuo={residuo}")
        total, fallas = len(self.resultados), self.resultados.count(False)
        self.stdout.write(f"\n{total - fallas} de {total} pasos correctos; no quedó ningún dato (transacción revertida).")
        if fallas:
            raise CommandError(f"{fallas} paso(s) fallaron")

    def _recorrer(self):
        with connection.cursor() as c:
            c.execute("select current_user, (select rolsuper from pg_roles where rolname = current_user)")
            usuario_bd, es_super = c.fetchone()
            c.execute("select ssl, version from pg_stat_ssl where pid = pg_backend_pid()")
            ssl, version = c.fetchone()
        self._paso("conecta como app_role, sin superusuario, por TLS", usuario_bd == "app_role" and not es_super and ssl, f"{usuario_bd} / {version}")

        mop = Institucion.objects.create(nombre="MOP (integración)", tipo="demostracion")
        minsa = Institucion.objects.create(nombre="MINSA (integración)", tipo="demostracion")
        ana = Usuario.objects.create(username="int_ana", password_hash="x")
        beto = Usuario.objects.create(username="int_beto", password_hash="x")
        func_mop = Usuario.objects.create(username="int_func_mop", password_hash="x")
        func_minsa = Usuario.objects.create(username="int_func_minsa", password_hash="x")
        tipo_mop = TipoTramite.objects.create(institucion=mop, nombre="Trámite MOP", sla_dias=10)
        tipo_minsa = TipoTramite.objects.create(institucion=minsa, nombre="Trámite MINSA", sla_dias=10)

        fijar_contexto(ana.pk)
        t_minsa = Tramite.objects.create(tipo_tramite=tipo_minsa, institucion=minsa, solicitante=ana)
        fijar_contexto(beto.pk)
        t_mop = Tramite.objects.create(tipo_tramite=tipo_mop, institucion=mop, solicitante=beto)
        self._paso("crea trámites a nombre de quien actúa", True)

        fijar_contexto(beto.pk)
        self._rechaza_la_base(
            "no crea un trámite a nombre de otra persona (RLS)",
            lambda: Tramite.objects.create(tipo_tramite=tipo_mop, institucion=mop, solicitante=ana),
        )

        fijar_contexto(func_mop.pk, [mop.pk])
        visibles = list(Tramite.objects.values_list("pk", flat=True))
        self._paso("el funcionario del MOP ve solo trámites del MOP", visibles == [t_mop.pk], f"ve {len(visibles)}")

        fijar_contexto(ana.pk)
        propios = list(Tramite.objects.values_list("pk", flat=True))
        self._paso("la ciudadana ve solo lo propio", propios == [t_minsa.pk], f"ve {len(propios)}")

        fijar_contexto(func_mop.pk, [mop.pk])
        filas = Tramite.objects.filter(pk=t_minsa.pk).update(estado="En Tramitacion")
        self._paso("el funcionario del MOP no modifica trámites del MINSA", filas == 0, f"{filas} filas")

        filas = Tramite.objects.filter(pk=t_mop.pk).update(estado="En Tramitacion")
        self._paso("cambia el estado de un trámite de su institución", filas == 1)
        eventos = list(EventoAuditoria.objects.filter(tramite_id=t_mop.pk))
        self._paso(
            "la base escribió la auditoría en la misma transacción",
            len(eventos) == 1 and eventos[0].actor_id == func_mop.pk and eventos[0].estado_nuevo == "En Tramitacion",
            f"{len(eventos)} evento, actor={eventos[0].actor_id if eventos else None}",
        )

        self._rechaza_la_base(
            "rechaza una transición inválida (En Tramitación a Pendiente)",
            lambda: Tramite.objects.filter(pk=t_mop.pk).update(estado="Pendiente"),
        )

        fijar_contexto(func_minsa.pk, [minsa.pk])
        vistos = EventoAuditoria.objects.filter(tramite_id=t_mop.pk).count()
        self._paso("otra institución no ve la auditoría del MOP (RLS)", vistos == 0, f"ve {vistos}")

        fijar_contexto(func_mop.pk, [mop.pk])
        evento = EventoAuditoria.objects.filter(tramite_id=t_mop.pk).first()
        try:
            evento.accion = "borrado"
            evento.save()
            self._paso("el ORM no modifica la auditoría", False)
        except PermissionError:
            self._paso("el ORM no modifica la auditoría", True)
        self._rechaza_la_base(
            "la base no deja modificar la auditoría aunque se salte el ORM",
            lambda: EventoAuditoria.objects.filter(pk=evento.pk).update(accion="borrado"),
        )
        self._rechaza_la_base("la base no deja borrar trámites", lambda: Tramite.objects.filter(pk=t_mop.pk).delete())
        self._rechaza_la_base(
            "app_role no se sube a un rol de plataforma",
            lambda: Usuario.objects.filter(pk=func_mop.pk).update(rol_plataforma="auditor"),
        )

