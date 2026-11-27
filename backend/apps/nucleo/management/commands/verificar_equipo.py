"""Gestión del equipo de una institución contra la base real, en una transacción que se revierte.

Los trámites se crean y se reasignan POR LA API (PDP, RLS y auditoría reales). También cubre la gestión del catálogo de la institución
(migración 020), por la API y con sondeos directos a la base como app_role. Las decisiones del PDP se capturan en memoria (la tabla es
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
from apps.tramites.formulario import datos_de_ejemplo
from apps.catalogo.models import CatalogoCambio
from apps.nucleo.contexto import fijar_contexto
from apps.tramites.models import Tramite

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

    def _http(self, usuario, metodo, ruta, datos=None, factor_reciente=True):
        """Como `_llamar`, pero admite también PATCH (la gestión del catálogo)."""
        ahora = timezone.now()
        sesion = Sesion.objects.create(usuario=usuario, refresh_hash=tokens.hash_refresh(tokens.nuevo_refresh()), expira_en=ahora + timedelta(minutes=10))
        token = tokens.emitir_access(settings.SIGET_JWT_KEY, usuario.pk, sesion.pk, tokens.SCOPE_COMPLETO, ahora, 300, settings.SIGET_EMISOR)
        Usuario.objects.filter(pk=usuario.pk).update(mfa_verificado_en=ahora if factor_reciente else ahora - timedelta(hours=3))
        cab = dict(HOST, HTTP_AUTHORIZATION=f"Bearer {token}")
        cliente = APIClient()
        if metodo == "get":
            r = cliente.get(ruta, secure=True, **cab)
        else:
            r = getattr(cliente, metodo)(ruta, datos or {}, format="json", secure=True, **cab)
        cache.delete(f"throttle_api_{usuario.pk}")  # solo el contador de la tasa de ESTA persona (alcance «api»), no toda la caché
        transaction.set_rollback(False)  # DRF marca la transacción al rechazar; en producción cada petición tiene la suya
        return r

    @staticmethod
    def _sondeo(usuario, accion):
        """Ejecuta `accion` como app_role con el contexto de `usuario` (None: sin contexto), en su PROPIO atomic(): un error de la base no estropea
        la transacción de la prueba. Devuelve el SQLSTATE con el que falló la base, o None si no falló."""
        vaciar = "select set_config('app.usuario_id', '', true), set_config('app.instituciones', '', true)"
        try:
            with transaction.atomic():
                if usuario is None:
                    with connection.cursor() as c:
                        c.execute(vaciar)
                else:
                    fijar_contexto(usuario.pk)
                accion()
            return None
        except DatabaseError as error:
            return getattr(error.__cause__, "sqlstate", None) or "desconocido"
        finally:
            # El contexto es local a la transacción de la prueba, que sigue abierta: sin esto, la persona de un sondeo quedaría puesta en el siguiente
            with connection.cursor() as c:
                c.execute(vaciar)

    @staticmethod
    def _sql(texto, parametros=()):
        def ejecutar():
            with connection.cursor() as c:
                c.execute(texto, list(parametros))
        return ejecutar

    @staticmethod
    def _roles(r, institucion, persona_id):
        return sorted(p["rol"] for e in r.json()["equipos"] if e["institucion"]["id"] == institucion for p in e["personal"] if p["usuario_id"] == persona_id)

    # ------------------------------------------------------------------ recorrido
    def _recorrer(self):
        inst = Institucion.objects.get(nombre="MOP")
        otra = Institucion.objects.exclude(pk=inst.pk).order_by("id").first()
        tipo = TipoTramite.objects.filter(institucion=inst, activo=True, audiencia="ciudadania").order_by("id").first()  # el de demostración está inactivo desde la 023
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
        r = self._llamar(ciud, "post", "/tramites/", {"tipo_tramite": tipo.pk, "datos": datos_de_ejemplo(tipo.formulario)})
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

        self._catalogo(inst, otra, coord, coord_b, sup, f1, ciud, op, asignador)

    # ------------------------------------------------------------------ catálogo de la institución (migración 020)
    def _catalogo(self, inst, otra, coord, coord_b, sup, f1, ciud, op, asignador):
        base, cambios = f"/catalogo/institucion/{inst.pk}/tipos/", f"/catalogo/institucion/{inst.pk}/cambios/"
        formulario = [{"id": "asunto", "etiqueta": "Asunto", "tipo": "texto", "obligatorio": True, "max": 100},
                      {"id": "motivo", "etiqueta": "Motivo", "tipo": "seleccion", "obligatorio": False, "opciones": ["Uno", "Dos"]}]
        cuerpo = {"nombre": "Prueba del catalogo", "sla_dias": 7, "audiencia": "ambas", "formulario": formulario}
        rev = self._persona("cat_coord_rev")
        susp = self._persona("cat_coord_susp")
        for persona in (rev, susp):
            Membresia.todas.create(usuario=persona, institucion=inst, rol="coordinador_institucional", asignado_por=asignador)
        Membresia.todas.filter(usuario=rev, institucion=inst).update(revocada_en=timezone.now(), revocada_por=asignador)
        Usuario.objects.filter(pk=susp.pk).update(estado_cuenta="suspendida")
        tipo_otra = TipoTramite.objects.filter(institucion=otra).order_by("id").first()

        # ------------------------------------------------------------ listar
        r = self._http(coord, "get", base)
        existentes = {t["id"] for t in r.json().get("tipos", [])}
        self._paso("la coordinación lista el catálogo de SU institución (200)", r.status_code == 200 and r.json()["institucion"]["id"] == inst.pk, r.status_code)
        self._paso("el listado trae los tipos de su institución y de ninguna otra",
                   existentes == set(TipoTramite.objects.filter(institucion=inst).values_list("pk", flat=True))
                   and (tipo_otra is None or tipo_otra.pk not in existentes))
        if tipo_otra is None:
            self._paso("los pasos que usan un tipo de OTRA institución", True, "omitido: la otra institución no tiene ningún tipo")
        r = self._http(coord, "get", f"/catalogo/institucion/{otra.pk}/tipos/")
        self._paso("la coordinación NO lista el catálogo de otra institución (403)", r.status_code == 403, r.status_code)
        for nombre, persona in (("la supervisión", sup), ("el funcionario", f1), ("la ciudadanía", ciud), ("un operador de plataforma", op),
                                ("la coordinación de OTRA institución", coord_b), ("una coordinación revocada", rev)):
            self._paso(f"{nombre} no lista ni crea en el catálogo (403)",
                       self._http(persona, "get", base).status_code == 403 and self._http(persona, "post", base, cuerpo).status_code == 403)
        self._paso("una cuenta suspendida no entra (401)", self._http(susp, "get", base).status_code == 401)
        r = self._http(coord, "post", base, cuerpo, factor_reciente=False)
        self._paso("sin segundo factor reciente se niega y se sugiere reautenticar", r.status_code == 403 and r.json().get("reautenticacion_sugerida") is True, r.status_code)
        self._paso("nada de lo anterior creó un tipo", not TipoTramite.objects.filter(nombre=cuerpo["nombre"]).exists())

        # ------------------------------------------------------------ crear
        r = self._http(coord, "post", base, cuerpo)
        creado = r.json()
        self._paso("la coordinación crea un tipo (201), activo y de su institución",
                   r.status_code == 201 and creado.get("activo") is True and creado.get("institucion_id") == inst.pk, r.status_code)
        tipo = TipoTramite.objects.get(pk=creado["id"])
        self._paso("queda guardado como se envió (formulario limpio, plazo y audiencia)",
                   tipo.formulario == formulario and tipo.sla_dias == 7 and tipo.audiencia == "ambas" and tipo.institucion_id == inst.pk)
        total = TipoTramite.objects.count()
        malos = {
            "un nombre muy corto": {**cuerpo, "nombre": "ab"}, "un nombre repetido (sin importar mayúsculas)": {**cuerpo, "nombre": "PRUEBA DEL CATALOGO"},
            "un plazo de 0 días": {**cuerpo, "nombre": "Otro 1", "sla_dias": 0}, "un plazo de 366 días": {**cuerpo, "nombre": "Otro 2", "sla_dias": 366},
            "una audiencia inventada": {**cuerpo, "nombre": "Otro 3", "audiencia": "todos"},
            "un id de campo con mayúsculas": {**cuerpo, "nombre": "Otro 4", "formulario": [{**formulario[0], "id": "Asunto"}]},
            "dos campos con el mismo id": {**cuerpo, "nombre": "Otro 5", "formulario": [formulario[0], formulario[0]]},
            "una selección sin opciones": {**cuerpo, "nombre": "Otro 6", "formulario": [{"id": "s", "etiqueta": "S", "tipo": "seleccion"}]},
            "una etiqueta de 121 caracteres": {**cuerpo, "nombre": "Otro 7", "formulario": [{**formulario[0], "etiqueta": "e" * 121}]},
            "31 campos": {**cuerpo, "nombre": "Otro 8", "formulario": [{**formulario[0], "id": f"c{i}"} for i in range(31)]},
            "un tipo de campo inventado": {**cuerpo, "nombre": "Otro 9", "formulario": [{**formulario[0], "tipo": "archivo"}]},
            "otra institución en el cuerpo": {**cuerpo, "nombre": "Otro 10", "institucion_id": otra.pk},
            "un cuerpo que no es un objeto": [1, 2], "tipos de datos inesperados": {"nombre": ["x"], "sla_dias": "7", "formulario": "no"},
        }
        fallos = []
        for nombre, malo in malos.items():
            r = self._http(coord, "post", base, malo)
            if r.status_code != 400 or r.json().get("codigo") != "datos_invalidos" or not r.json().get("errores"):
                fallos.append(nombre)
        self._paso("datos inválidos se rechazan con 400 y el error por campo, sin llegar a la base", not fallos, fallos)
        r = self._http(coord, "post", base, {**cuerpo, "nombre": "Otro 11", "formulario": [{**formulario[0], "id": "Asunto"}]})
        self._paso("el error del formulario dice en qué campo y atributo está", "formulario.0.id" in r.json().get("errores", {}), r.json())
        self._paso("ninguno de los rechazados dejó un tipo", TipoTramite.objects.count() == total)

        # ------------------------------------------------------------ editar
        ruta = f"{base}{tipo.pk}/"
        # Cada edición manda la versión que la persona veía (la vigente en la base): el control de concurrencia la exige
        con_version = lambda c: {**c, "version": TipoTramite.objects.get(pk=tipo.pk).version}  # noqa: E731
        version_inicial = tipo.version
        r = self._http(coord, "patch", ruta, con_version({"nombre": "Prueba del catalogo (editada)", "sla_dias": 9}))
        tipo.refresh_from_db()
        self._paso("la coordinación edita nombre y plazo (200)", r.status_code == 200 and tipo.nombre == "Prueba del catalogo (editada)" and tipo.sla_dias == 9, r.status_code)
        for nombre, persona in (("la supervisión", sup), ("el funcionario", f1), ("la ciudadanía", ciud), ("la coordinación de OTRA institución", coord_b),
                                ("una coordinación revocada", rev)):
            self._paso(f"{nombre} no edita tipos de esta institución (403)", self._http(persona, "patch", ruta, {"sla_dias": 1}).status_code == 403)
        if tipo_otra is not None:
            self._paso("un tipo de otra institución, por la ruta de la propia, no existe (404)",
                       self._http(coord, "patch", f"{base}{tipo_otra.pk}/", {"sla_dias": 1, "version": tipo_otra.version}).status_code == 404)
        self._paso("la coordinación de otra institución tampoco lo alcanza por la ruta de la suya (404)",
                   self._http(coord_b, "patch", f"/catalogo/institucion/{otra.pk}/tipos/{tipo.pk}/", {"sla_dias": 1}).status_code == 404)
        self._paso("un tipo que no existe da 404", self._http(coord, "patch", f"{base}999999999/", {"sla_dias": 1}).status_code == 404)
        otro_nombre = TipoTramite.objects.filter(institucion=inst).exclude(pk=tipo.pk).order_by("id").first().nombre
        for nombre, c in (("cambiar su institución", {"institucion_id": otra.pk}), ("cambiar su id", {"id": 1}), ("un cuerpo vacío", {}),
                          ("un plazo fuera de rango", {"sla_dias": 400}), ("un nombre que ya tiene otro tipo", {"nombre": otro_nombre})):
            self._paso(f"{nombre} se rechaza (400)", self._http(coord, "patch", ruta, con_version(c)).status_code == 400)
        tipo.refresh_from_db()
        self._paso("y el tipo sigue igual", tipo.institucion_id == inst.pk and tipo.sla_dias == 9 and tipo.nombre == "Prueba del catalogo (editada)")
        r = self._http(coord, "patch", ruta, {"sla_dias": 5})
        self._paso("editar sin indicar la versión se rechaza (400, errores.version)", r.status_code == 400 and "version" in r.json().get("errores", {}), r.status_code)
        r = self._http(coord, "patch", ruta, {"sla_dias": 5, "version": version_inicial})
        tipo.refresh_from_db()
        self._paso("editar con una versión vieja da 409 y no escribe nada", r.status_code == 409 and r.json().get("codigo") == "version_desactualizada" and tipo.sla_dias == 9,
                   (r.status_code, tipo.version, version_inicial))
        self._paso("cada cambio real subió la versión en uno (el alta la dejó en 1)", version_inicial == 1 and tipo.version == 2, (version_inicial, tipo.version))

        # ------------------------------------------------------------ desactivar: no admite trámites nuevos, los existentes siguen
        r = self._http(ciud, "post", "/tramites/", {"tipo_tramite": tipo.pk, "datos": {"asunto": "Antes de desactivar"}})
        existente = r.json().get("id")
        self._paso("mientras está activo, la ciudadanía inicia un trámite de ese tipo (201)", r.status_code == 201, r.status_code)
        r = self._http(coord, "patch", ruta, con_version({"activo": False}))
        self._paso("la coordinación lo desactiva (200)", r.status_code == 200 and r.json()["activo"] is False, r.status_code)
        r = self._http(ciud, "get", f"/catalogo/tipos-tramite/?institucion={inst.pk}")
        self._paso("el catálogo público ya no lo muestra", r.status_code == 200 and tipo.pk not in {t["id"] for t in r.json()})
        r = self._http(coord, "get", base)
        self._paso("la coordinación sí lo ve en su listado, marcado como inactivo", any(t["id"] == tipo.pk and t["activo"] is False for t in r.json().get("tipos", [])))
        r = self._http(ciud, "post", "/tramites/", {"tipo_tramite": tipo.pk, "datos": {"asunto": "Después de desactivar"}})
        self._paso("iniciar un trámite de un tipo inactivo da 400 claro", r.status_code == 400 and r.json().get("codigo") == "tipo_tramite_inactivo", r.json())
        error = self._sondeo(ciud, lambda: Tramite.objects.create(tipo_tramite=tipo, institucion=inst, solicitante=ciud))
        self._paso("aunque se salte la API, la base rechaza un trámite nuevo de un tipo inactivo", error == "P0001", error)
        r = self._http(sup, "post", f"/tramites/{existente}/estado/", {"estado": "En Tramitacion"})
        self._paso("el trámite que ya existía sigue su curso (200)", r.status_code == 200 and r.json()["estado"] == "En Tramitacion", r.status_code)
        r = self._http(coord, "patch", ruta, con_version({"activo": True}))
        self._paso("la coordinación lo reactiva (200)", r.status_code == 200 and r.json()["activo"] is True, r.status_code)
        r = self._http(ciud, "post", "/tramites/", {"tipo_tramite": tipo.pk, "datos": {"asunto": "Después de reactivar"}})
        self._paso("reactivado, vuelve a admitir trámites nuevos (201)", r.status_code == 201, r.status_code)

        # ------------------------------------------------------------ historial
        r = self._http(coord, "get", cambios)
        filas = [c for c in r.json().get("resultados", []) if c["tipo_tramite"]["id"] == tipo.pk]
        self._paso("el historial de la institución lo ve su coordinación (200)", r.status_code == 200 and r.json()["total"] >= 4, r.status_code)
        cronologico = list(reversed(filas))
        acciones = [c["accion"] for c in cronologico]
        self._paso("lo hecho queda en orden: alta, cambio, desactivado, activado", acciones == ["alta", "cambio", "desactivado", "activado"], acciones)
        self._paso("cada fila dice quién lo hizo (la coordinación) y cuándo",
                   bool(cronologico) and all(c["actor"] == {"id": coord.pk, "usuario": "eq_coord"} and c["creado_en"] for c in cronologico))
        self._paso("el cambio guarda solo lo que cambió, antes y después",
                   len(cronologico) == 4 and cronologico[1]["antes"] == {"nombre": "Prueba del catalogo", "sla_dias": 7}
                   and cronologico[1]["despues"] == {"nombre": "Prueba del catalogo (editada)", "sla_dias": 9})
        self._paso("el alta guarda la foto de lo creado",
                   len(cronologico) == 4 and cronologico[0]["antes"] is None and cronologico[0]["despues"]["formulario"] == formulario and cronologico[0]["despues"]["activo"] is True)
        self._paso("lo rechazado (los 400 y los 403) no dejó registro", len(filas) == 4, len(filas))
        r = self._http(coord, "get", cambios + "?limite=2")
        self._paso("el historial se pagina", r.status_code == 200 and len(r.json()["resultados"]) == 2 and r.json()["limite"] == 2 and r.json()["total"] >= 4)
        self._paso("una paginación inválida da 400", self._http(coord, "get", cambios + "?limite=0").status_code == 400)
        for nombre, persona in (("la supervisión", sup), ("la ciudadanía", ciud), ("la coordinación de OTRA institución", coord_b), ("una coordinación revocada", rev)):
            self._paso(f"{nombre} no ve el historial de esta institución (403)", self._http(persona, "get", cambios).status_code == 403)
        r = self._http(coord_b, "get", f"/catalogo/institucion/{otra.pk}/cambios/")
        self._paso("la coordinación de otra institución ve solo el historial de la suya",
                   r.status_code == 200 and all(c["tipo_tramite"]["id"] != tipo.pk for c in r.json()["resultados"]))

        # ------------------------------------------------------------ lo que impone la base (como app_role, saltándose la API)
        def historial_visto(persona):
            visto = []
            error = self._sondeo(persona, lambda: visto.append(CatalogoCambio.objects.filter(institucion=inst).count()))
            return error, (visto[0] if visto else None)

        error, n = historial_visto(coord)
        self._paso("seguridad por filas del historial: la coordinación de la institución ve el suyo", error is None and n >= 4, (error, n))
        for nombre, persona in (("la coordinación de otra institución", coord_b), ("el funcionario", f1), ("una coordinación revocada", rev),
                                ("una coordinación con la cuenta suspendida", susp), ("quien no tiene contexto de sesión", None)):
            error, n = historial_visto(persona)
            self._paso(f"seguridad por filas del historial: {nombre} no ve nada de esa institución", error is None and n == 0, (error, n))
        edicion = lambda: TipoTramite.objects.filter(pk=tipo.pk).update(nombre="Secuestrado")  # noqa: E731
        creacion = lambda: TipoTramite.objects.create(institucion=inst, nombre="Intruso", sla_dias=5)  # noqa: E731
        for nombre, persona in (("la coordinación de otra institución", coord_b), ("el funcionario", f1), ("la supervisión", sup), ("la ciudadanía", ciud),
                                ("una coordinación revocada", rev), ("una coordinación con la cuenta suspendida", susp)):
            self._paso(f"la base no deja que {nombre} edite ni cree tipos (42501)", self._sondeo(persona, edicion) == "42501" and self._sondeo(persona, creacion) == "42501")
        self._paso("la base no deja cambiar la institución de un tipo (permiso por columna, 42501)",
                   self._sondeo(coord, lambda: TipoTramite.objects.filter(pk=tipo.pk).update(institucion=otra)) == "42501")
        self._paso("ni su id (42501)", self._sondeo(coord, self._sql("update siget.tipo_tramite set id = id + 1000000 where id = %s", [tipo.pk])) == "42501")
        self._paso("ni borrarlo (42501)", self._sondeo(coord, self._sql("delete from siget.tipo_tramite where id = %s", [tipo.pk])) == "42501")
        self._paso("ni vaciar el catálogo (42501)", self._sondeo(coord, self._sql("truncate siget.tipo_tramite")) == "42501")
        self._paso("un formulario mal formado se rechaza en la base (regla del disparador)",
                   self._sondeo(coord, lambda: TipoTramite.objects.filter(pk=tipo.pk).update(formulario=[{"id": "MAL", "etiqueta": "x", "tipo": "texto"}])) == "P0001")
        self._paso("un plazo de 366 días y un nombre de 2 letras se rechazan en la base (CHECK)",
                   self._sondeo(coord, lambda: TipoTramite.objects.filter(pk=tipo.pk).update(sla_dias=366)) == "23514"
                   and self._sondeo(coord, lambda: TipoTramite.objects.filter(pk=tipo.pk).update(nombre="ab")) == "23514")
        tipo.refresh_from_db()
        self._paso("y nada de lo anterior cambió el tipo",
                   tipo.nombre == "Prueba del catalogo (editada)" and tipo.sla_dias == 9 and tipo.institucion_id == inst.pk and tipo.formulario == formulario)
        for nombre, sql in (("actualizar", "update siget.catalogo_cambio set accion = 'cambio'"), ("borrar", "delete from siget.catalogo_cambio"),
                            ("vaciar", "truncate siget.catalogo_cambio"),
                            ("insertar en", "insert into siget.catalogo_cambio (tipo_tramite_id, institucion_id, accion) select id, institucion_id, 'cambio' from siget.tipo_tramite limit 1")):
            self._paso(f"app_role no puede {nombre} el historial del catálogo (42501)", self._sondeo(coord, self._sql(sql)) == "42501")
        with connection.cursor() as c:
            c.execute("select r.rolname, has_table_privilege(r.rolname, 'siget.catalogo_cambio', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') from pg_roles r "
                      "where r.rolname in ('pgadmin_lectura', 'escalador_role', 'detector_role', 'checkpoint_app')")
            sin_acceso = dict(c.fetchall())
            c.execute("select has_table_privilege('app_role', 'siget.catalogo_cambio', 'SELECT') and not has_table_privilege('app_role', 'siget.catalogo_cambio', 'INSERT,UPDATE,DELETE,TRUNCATE'), "
                      "has_column_privilege('app_role', 'siget.tipo_tramite', 'activo', 'UPDATE') and not has_column_privilege('app_role', 'siget.tipo_tramite', 'institucion_id', 'UPDATE')")
            permisos_app = c.fetchone()
        self._paso("pgadmin_lectura, escalador_role, detector_role y checkpoint_app no tienen ningún permiso sobre el historial",
                   len(sin_acceso) == 4 and not any(sin_acceso.values()), sin_acceso)
        self._paso("app_role solo lee el historial y puede cambiar `activo` pero no `institucion_id`", permisos_app == (True, True), permisos_app)
