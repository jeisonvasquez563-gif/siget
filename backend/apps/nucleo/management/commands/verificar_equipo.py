"""Gestión del equipo de una institución contra la base real, en una transacción que se revierte.

Los trámites se crean y se reasignan POR LA API (PDP, RLS y auditoría reales). Las decisiones del PDP se capturan en memoria (la tabla es
inalterable y esto no debe dejar nada). No deja ningún dato.
"""
import json
from datetime import timedelta
from unittest import mock

from django.conf import settings
from django.core.cache import cache
from django.core.management.base import BaseCommand, CommandError
from django.db import DatabaseError, connection, transaction
from django.utils import timezone
from rest_framework.test import APIClient

from apps.autenticacion import contrasenas, mfa, tokens
from apps.autenticacion.models import EventoSeguridad, Sesion
from apps.autorizacion import permisos
from apps.catalogo.models import Institucion, TipoTramite
from apps.identidad.models import Membresia, Usuario

HOST = {"HTTP_HOST": "localhost", "HTTP_X_REAL_IP": "198.51.100.31"}
CLAVE = "una-frase-larga-y-poco-comun-8113"


class _Revertir(Exception):
    pass


class Command(BaseCommand):
    help = "Prueba de integración de la gestión del equipo contra la base real (se revierte al final)."

    def _paso(self, nombre, ok, detalle=""):
        self.resultados.append(bool(ok))
        marca = self.style.SUCCESS("PASA ") if ok else self.style.ERROR("FALLA")
        self.stdout.write(f"{marca} {nombre}{(' - ' + str(detalle)) if detalle else ''}")

    def handle(self, *args, **opciones):
        self.resultados, self.decisiones = [], []
        try:
            with transaction.atomic(), mock.patch.object(permisos, "_registrar_decision", lambda actor, accion, recurso, decision: self.decisiones.append((actor, accion.value, decision.permitido))):
                self._recorrer()
                raise _Revertir()
        except _Revertir:
            pass
        total, fallas = len(self.resultados), self.resultados.count(False)
        self.stdout.write(f"\n{total - fallas} de {total} pasos correctos; no quedó ningún dato (transacción revertida).")
        if fallas:
            raise CommandError(f"{fallas} paso(s) fallaron")

    # ------------------------------------------------------------------ ayudas
    def _persona(self, username, rol_plataforma="ninguno"):
        return Usuario.objects.create(username=username, password_hash=contrasenas.hashear(CLAVE), rol_plataforma=rol_plataforma, nivel_aseguramiento=2,
                                      mfa_activo=True, mfa_secreto=mfa.cifrar(settings.SIGET_MFA_KEY, mfa.nuevo_secreto()), mfa_verificado_en=timezone.now())

    def _llamar(self, usuario, metodo, ruta, datos=None, factor_reciente=True):
        ahora = timezone.now()
        sesion = Sesion.objects.create(usuario=usuario, refresh_hash=tokens.hash_refresh(tokens.nuevo_refresh()), expira_en=ahora + timedelta(minutes=10))
        token = tokens.emitir_access(settings.SIGET_JWT_KEY, usuario.pk, sesion.pk, tokens.SCOPE_COMPLETO, ahora, 300, settings.SIGET_EMISOR)
        Usuario.objects.filter(pk=usuario.pk).update(mfa_verificado_en=ahora if factor_reciente else ahora - timedelta(hours=3))
        cab = dict(HOST, HTTP_AUTHORIZATION=f"Bearer {token}")
        cliente = APIClient()
        r = cliente.get(ruta, secure=True, **cab) if metodo == "get" else cliente.post(ruta, datos or {}, format="json", secure=True, **cab)
        cache.clear()
        transaction.set_rollback(False)  # DRF marca la transacción al rechazar; en producción cada petición tiene la suya
        return r

    @staticmethod
    def _roles(r, institucion, persona_id):
        return sorted(p["rol"] for e in r.json()["equipos"] if e["institucion"]["id"] == institucion for p in e["personal"] if p["usuario_id"] == persona_id)

    # ------------------------------------------------------------------ recorrido
    def _recorrer(self):
        inst = Institucion.objects.get(nombre="MOP")
        otra = Institucion.objects.exclude(pk=inst.pk).order_by("id").first()
        tipo = TipoTramite.objects.filter(institucion=inst).order_by("id").first()
        asignador = Usuario.objects.create(username="eq_asig", password_hash=contrasenas.hashear(CLAVE), estado_cuenta="suspendida")
        coord, coord_b, sup, f1, x, ciud, op = (self._persona(n, r) for n, r in (
            ("eq_coord", "ninguno"), ("eq_coord_b", "ninguno"), ("eq_sup", "ninguno"), ("eq_f1", "ninguno"), ("eq_x", "ninguno"), ("eq_ciud", "ninguno"), ("eq_op", "operador_identidades")))
        for persona, institucion, rol in ((coord, inst, "coordinador_institucional"), (coord_b, otra, "coordinador_institucional"), (sup, inst, "supervisor"), (f1, inst, "funcionario")):
            Membresia.todas.create(usuario=persona, institucion=institucion, rol=rol, asignado_por=asignador)
        base = f"/equipo/{inst.pk}/miembros/"

        # ------------------------------------------------------------ qué ve cada quien
        r = self._llamar(coord, "get", "/equipo/")
        mop = next(e for e in r.json()["equipos"] if e["institucion"]["id"] == inst.pk)
        gestionables = {p["usuario"]: p["gestionable"] for p in mop["personal"]}
        self._paso("la coordinación ve su equipo y sabe que puede gestionarlo", r.status_code == 200 and mop["puede_gestionar"] is True)
        self._paso("puede gestionar al personal (funcionarios y supervisores), no a las coordinaciones ni a sí misma",
                   gestionables.get("eq_sup") is True and gestionables.get("eq_f1") is True and gestionables.get("eq_coord") is False)
        r = self._llamar(sup, "get", "/equipo/")
        mop_sup = next(e for e in r.json()["equipos"] if e["institucion"]["id"] == inst.pk)
        self._paso("la supervisión ve el equipo pero NO lo puede gestionar", mop_sup["puede_gestionar"] is False and not any(p["gestionable"] for p in mop_sup["personal"]))

        # ------------------------------------------------------------ quién puede gestionar
        cuerpo = {"usuario": "eq_x", "rol": "funcionario"}
        self._paso("la supervisión no asigna personal (403)", self._llamar(sup, "post", base, cuerpo).status_code == 403)
        self._paso("la coordinación de OTRA institución tampoco (403)", self._llamar(coord_b, "post", base, cuerpo).status_code == 403)
        self._paso("la ciudadanía tampoco (403)", self._llamar(ciud, "post", base, cuerpo).status_code == 403)
        self._paso("ni un operador de plataforma (403)", self._llamar(op, "post", base, cuerpo).status_code == 403)
        r = self._llamar(coord, "post", base, cuerpo, factor_reciente=False)
        self._paso("sin segundo factor reciente se niega y se sugiere reautenticar", r.status_code == 403 and r.json().get("reautenticacion_sugerida") is True, r.status_code)
        self._paso("nada de lo anterior dejó a nadie asignado", not Membresia.objects.filter(usuario=x).exists())

        # ------------------------------------------------------------ asignar
        r = self._llamar(coord, "post", base, cuerpo)
        self._paso("la coordinación asigna a alguien como funcionario", r.status_code == 201, r.status_code)
        fila = Membresia.objects.get(usuario=x, institucion=inst, rol="funcionario")
        self._paso("queda quién dio el acceso", fila.asignado_por_id == coord.pk and fila.revocada_en is None)
        r = self._llamar(x, "get", "/auth/yo/")
        self._paso("surte efecto de inmediato: su menú ya trae la bandeja de la institución", "bandeja" in [m["id"] for m in r.json()["modulos"]])
        self._paso("asignarlo otra vez se rechaza (400)", self._llamar(coord, "post", base, cuerpo).status_code == 400)
        self._paso("no se puede asignar una coordinación desde aquí (400): eso es de la plataforma con control dual",
                   self._llamar(coord, "post", base, {"usuario": "eq_ciud", "rol": "coordinador_institucional"}).status_code == 400)
        self._paso("un rol inventado se rechaza (400)", self._llamar(coord, "post", base, {"usuario": "eq_ciud", "rol": "dios"}).status_code == 400)
        self._paso("una persona que no existe se rechaza (400)", self._llamar(coord, "post", base, {"usuario": "nadie_existe", "rol": "funcionario"}).status_code == 400)
        self._paso("una cuenta de plataforma no puede ser personal de una institución (400)", self._llamar(coord, "post", base, {"usuario": "eq_op", "rol": "funcionario"}).status_code == 400)
        self._paso("nadie se asigna a sí mismo (409)", self._llamar(coord, "post", base, {"usuario": "eq_coord", "rol": "supervisor"}).status_code == 409)
        Usuario.objects.filter(pk=ciud.pk).update(estado_cuenta="bloqueada")
        self._paso("una cuenta bloqueada no se asigna (400)", self._llamar(coord, "post", base, {"usuario": "eq_ciud", "rol": "funcionario"}).status_code == 400)
        Usuario.objects.filter(pk=ciud.pk).update(estado_cuenta="activa")
        self._paso("tipos de datos inesperados no rompen nada (400)", self._llamar(coord, "post", base, {"usuario": ["x"], "rol": 5}).status_code == 400)

        # ------------------------------------------------------------ cambiar de rol
        r = self._llamar(coord, "post", f"{base}{x.pk}/cambiar-rol/", {"rol": "supervisor"})
        self._paso("la coordinación cambia a alguien de funcionario a supervisor", r.status_code == 200, r.status_code)
        self._paso("ahora es supervisor y ya no funcionario", Membresia.objects.filter(usuario=x, institucion=inst).values_list("rol", flat=True)[0] == "supervisor"
                   and not Membresia.objects.filter(usuario=x, institucion=inst, rol="funcionario").exists())
        antes = Membresia.todas.get(usuario=x, institucion=inst, rol="funcionario")
        self._paso("el rol anterior no se borra: queda revocado, con quién lo revocó y cuándo", antes.revocada_en is not None and antes.revocada_por_id == coord.pk)
        self._paso("su menú ya trae Supervisión", "supervision" in [m["id"] for m in self._llamar(x, "get", "/auth/yo/").json()["modulos"]])
        self._paso("cambiar al rol que ya tiene se rechaza (409)", self._llamar(coord, "post", f"{base}{x.pk}/cambiar-rol/", {"rol": "supervisor"}).status_code == 409)
        self._paso("cambiar el rol de alguien que no es del equipo se rechaza (409)", self._llamar(coord, "post", f"{base}{ciud.pk}/cambiar-rol/", {"rol": "funcionario"}).status_code == 409)
        self._paso("no se cambia a una coordinación (400)", self._llamar(coord, "post", f"{base}{x.pk}/cambiar-rol/", {"rol": "coordinador_institucional"}).status_code == 400)
        self._paso("nadie cambia su propio rol (409)", self._llamar(coord, "post", f"{base}{coord.pk}/cambiar-rol/", {"rol": "supervisor"}).status_code == 409)
        self._llamar(coord, "post", f"{base}{x.pk}/cambiar-rol/", {"rol": "funcionario"})

        # ------------------------------------------------------------ quitar, con trámites abiertos de por medio
        r = self._llamar(ciud, "post", "/tramites/", {"tipo_tramite": tipo.pk})
        tramite = r.json()["id"]
        r = self._llamar(sup, "post", f"/tramites/{tramite}/reasignar/", {"funcionario_id": x.pk})
        self._paso("supervisión le asigna un trámite real a esa persona", r.status_code == 200, r.status_code)
        r = self._llamar(coord, "post", f"{base}{x.pk}/quitar/")
        self._paso("NO se puede quitar a quien tiene trámites abiertos asignados (409) y se dice cuántos",
                   r.status_code == 409 and r.json()["codigo"] == "tiene_tramites_abiertos" and r.json()["tramites_abiertos"] == 1, r.json())
        self._paso("y su acceso sigue intacto", Membresia.objects.filter(usuario=x, institucion=inst, rol="funcionario").exists())
        ids = {t["id"] for t in self._llamar(coord, "get", "/tramites/").json().get("resultados", [])}
        self._paso("la coordinación no ve ese trámite (seguridad por filas): para decidir solo recibió un número", tramite not in ids)
        self._llamar(sup, "post", f"/tramites/{tramite}/reasignar/", {"funcionario_id": f1.pk})
        r = self._llamar(coord, "post", f"{base}{x.pk}/quitar/")
        self._paso("con el trámite reasignado, la coordinación quita el acceso", r.status_code == 200, r.status_code)
        revocada = Membresia.todas.get(usuario=x, institucion=inst, rol="funcionario")
        self._paso("la membresía queda REVOCADA, no borrada: con quién la dio, quién la quitó y cuándo", revocada.revocada_en is not None and revocada.revocada_por_id == coord.pk and revocada.asignado_por_id == coord.pk)
        self._paso("pierde la bandeja de inmediato", "bandeja" not in [m["id"] for m in self._llamar(x, "get", "/auth/yo/").json()["modulos"]])
        self._paso("ya no aparece en el equipo", self._roles(self._llamar(coord, "get", "/equipo/"), inst.pk, x.pk) == [])
        self._paso("quitar a quien ya no es del equipo se rechaza (409)", self._llamar(coord, "post", f"{base}{x.pk}/quitar/").status_code == 409)
        self._paso("nadie se quita a sí mismo (409)", self._llamar(coord, "post", f"{base}{coord.pk}/quitar/").status_code == 409)
        self._paso("la coordinación de otra institución no quita a nadie de esta (403)", self._llamar(coord_b, "post", f"{base}{f1.pk}/quitar/").status_code == 403)
        self._paso("la supervisión no quita a nadie (403)", self._llamar(sup, "post", f"{base}{f1.pk}/quitar/").status_code == 403)
        self._paso("una coordinación no se puede quitar desde aquí (409)", self._llamar(coord, "post", f"{base}{coord_b.pk}/quitar/").status_code == 409)

        # ------------------------------------------------------------ volver a asignar
        total_filas = Membresia.todas.filter(usuario=x, institucion=inst).count()
        r = self._llamar(coord, "post", base, cuerpo)
        reactivada = Membresia.todas.get(usuario=x, institucion=inst, rol="funcionario")
        self._paso("volver a asignarlo reactiva su fila (no duplica) y limpia la revocación", r.status_code == 201 and reactivada.revocada_en is None and reactivada.revocada_por_id is None
                   and Membresia.todas.filter(usuario=x, institucion=inst).count() == total_filas)

        # ------------------------------------------------------------ lo que impone la base
        for nombre, sql in (("cambiar el rol de una membresía", "update siget.membresia set rol = 'supervisor' where usuario_id = %s"), ("borrar una membresía", "delete from siget.membresia where usuario_id = %s"),
                            ("cambiar a quién pertenece", "update siget.membresia set usuario_id = usuario_id + 1000000 where usuario_id = %s")):
            try:
                with transaction.atomic(), connection.cursor() as c:
                    c.execute(sql, [x.pk])
                self._paso(f"la base no deja {nombre} (solo revocarla)", False)
            except DatabaseError:
                self._paso(f"la base no deja {nombre} (solo revocarla)", True)
        try:
            with transaction.atomic(), connection.cursor() as c:
                c.execute("update siget.membresia set revocada_en = now(), revocada_por = usuario_id where usuario_id = %s", [x.pk])
            self._paso("la base impide que alguien revoque su propio acceso", False)
        except DatabaseError:
            self._paso("la base impide que alguien revoque su propio acceso", True)
        try:
            with transaction.atomic(), connection.cursor() as c:
                c.execute("update siget.membresia set revocada_en = now() where usuario_id = %s", [x.pk])
            self._paso("y que quede una revocación a medias (fecha sin quién)", False)
        except DatabaseError:
            self._paso("y que quede una revocación a medias (fecha sin quién)", True)
        with connection.cursor() as c:
            c.execute("select r.rolname, has_function_privilege(r.rolname, 'siget.tramites_abiertos_de(int,int)', 'EXECUTE') from pg_roles r where r.rolname in ('app_role','auditor_role','pgadmin_lectura','checkpoint_app')")
            ejecuta = dict(c.fetchall())
            c.execute("select pg_typeof(siget.tramites_abiertos_de(%s, %s))::text", [f1.pk, inst.pk])
            tipo_devuelto = c.fetchone()[0]
        self._paso("la función que cuenta trámites devuelve solo un entero y solo la ejecuta la aplicación", tipo_devuelto == "integer" and ejecuta == {"app_role": True, "auditor_role": False, "pgadmin_lectura": False, "checkpoint_app": False}, ejecuta)

        # ------------------------------------------------------------ registro
        hechos = set(EventoSeguridad.objects.filter(actor=coord).values_list("evento", flat=True))
        self._paso("todo quedó en los eventos de seguridad", {"equipo_miembro_agregado", "equipo_rol_cambiado", "equipo_miembro_quitado"} <= hechos, hechos)
        negadas = [d for d in self.decisiones if d[2] is False and d[1] == "gestionar_usuarios_institucion"]
        self._paso("las negaciones pasaron por el motor de decisiones y quedaron registradas", len(negadas) >= 6, len(negadas))
        with connection.cursor() as c:
            c.execute("select current_user, (select rolsuper from pg_roles where rolname = current_user)")
            usuario_bd, es_super = c.fetchone()
        self._paso("todo se ejecutó como app_role, sin superusuario", usuario_bd == "app_role" and es_super is False, usuario_bd)
