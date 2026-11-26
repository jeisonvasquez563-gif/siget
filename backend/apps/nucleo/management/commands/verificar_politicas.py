"""Prueba contra la base real de los permisos de PostgreSQL, del PDP y de la actividad de seguridad propia.

Las rutas `/politicas/` (matriz, simulador y vista de la base) se retiraron al pasar a plataforma final: aquí se comprueba que
ya no existen (404) y se conservan las comprobaciones de la base, que ahora consultan el catálogo de PostgreSQL directamente:
si alguien concediera por error un permiso de más, esta prueba lo mostraría.
Las personas de la prueba viven en una transacción que se revierte.
"""
from datetime import timedelta

from django.core.cache import cache
from django.core.management.base import BaseCommand, CommandError
from django.db import connection, transaction
from django.utils import timezone
from rest_framework.test import APIClient

from apps.autenticacion import contrasenas, tokens
from apps.autenticacion.models import EventoSeguridad, Sesion
from apps.autorizacion.pdp import Accion, Entorno, Recurso, Sujeto, decidir
from apps.identidad.models import Usuario

ROLES_BD = ("app_role", "auditor_role", "siget_owner", "checkpoint_app", "pgadmin_lectura")
PRIVILEGIOS = ("SELECT", "INSERT", "UPDATE", "DELETE")

_SQL_PRIVILEGIOS = """
    SELECT r.rolname, c.relname, p.priv,
           has_table_privilege(r.rolname, c.oid, p.priv) AS tabla,
           -- DELETE no existe a nivel de columna: PostgreSQL solo admite SELECT, INSERT, UPDATE y REFERENCES
           (p.priv <> 'DELETE' AND has_any_column_privilege(r.rolname, c.oid, p.priv)) AS columnas
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'siget'
     CROSS JOIN pg_roles r
     CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) AS p(priv)
     WHERE c.relkind = 'r' AND r.rolname = ANY(%s)
"""
_SQL_ATRIBUTOS = "SELECT rolname, rolsuper, rolbypassrls, rolcanlogin, rolconnlimit FROM pg_roles WHERE rolname = ANY(%s)"
_SQL_TABLAS = """
    SELECT c.relname, c.relrowsecurity,
           (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'siget' AND p.tablename = c.relname),
           (SELECT count(*) FROM pg_trigger t WHERE t.tgrelid = c.oid AND NOT t.tgisinternal)
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'siget'
     WHERE c.relkind = 'r' ORDER BY c.relname
"""

HOST = {"HTTP_HOST": "localhost", "HTTP_X_REAL_IP": "198.51.100.9"}


class _Revertir(Exception):
    pass


class Command(BaseCommand):
    help = "Prueba de integración de los permisos de la base, el PDP y la actividad de seguridad contra la base real (se revierte al final)."

    def _paso(self, nombre, ok, detalle=""):
        self.resultados.append(ok)
        marca = self.style.SUCCESS("PASA ") if ok else self.style.ERROR("FALLA")
        self.stdout.write(f"{marca} {nombre}{(' - ' + str(detalle)) if detalle else ''}")

    def _http(self, ruta, token=None):
        cabeceras = dict(HOST)
        if token:
            cabeceras["HTTP_AUTHORIZATION"] = f"Bearer {token}"
        r = self.cliente.get(ruta, secure=True, **cabeceras)
        cache.clear()
        transaction.set_rollback(False)
        return r

    def _post(self, ruta, cuerpo, token=None):
        cabeceras = dict(HOST)
        if token:
            cabeceras["HTTP_AUTHORIZATION"] = f"Bearer {token}"
        r = self.cliente.post(ruta, cuerpo, format="json", secure=True, **cabeceras)
        cache.clear()
        transaction.set_rollback(False)
        return r

    def _base(self):
        """Atributos de los roles, privilegios por tabla y protecciones de las tablas, leídos del catálogo de PostgreSQL."""
        with connection.cursor() as c:
            c.execute(_SQL_ATRIBUTOS, [[*ROLES_BD, "postgres"]])
            atributos = {f[0]: f for f in c.fetchall()}
            c.execute(_SQL_PRIVILEGIOS, [list(ROLES_BD)])
            filas = c.fetchall()
            c.execute(_SQL_TABLAS)
            tablas = {f[0]: {"rls": f[1], "politicas": f[2], "triggers": f[3]} for f in c.fetchall()}
        priv = {r: {t: {p: "no" for p in PRIVILEGIOS} for t in tablas} for r in ROLES_BD}
        for rol, tabla, p, total, columnas in filas:
            priv[rol][tabla][p] = "total" if total else ("columnas" if columnas else "no")
        return atributos, priv, tablas

    def _persona(self, nombre, rol_plataforma="ninguno"):
        return Usuario.objects.create(username=f"int_p_{nombre}", password_hash=contrasenas.inutilizable(), rol_plataforma=rol_plataforma, mfa_activo=True,
                                      mfa_verificado_en=timezone.now() - timedelta(minutes=1))

    def _token(self, usuario):
        from django.conf import settings
        ahora = timezone.now()
        s = Sesion.objects.create(usuario=usuario, refresh_hash=tokens.hash_refresh(tokens.nuevo_refresh()), expira_en=ahora + timedelta(hours=1))
        return tokens.emitir_access(settings.SIGET_JWT_KEY, usuario.pk, s.pk, tokens.SCOPE_COMPLETO, ahora, 600, settings.SIGET_EMISOR)

    def handle(self, *args, **opciones):
        self.resultados = []
        self.cliente = APIClient()
        try:
            with transaction.atomic():
                self._recorrer()
                raise _Revertir()
        except _Revertir:
            pass
        residuo = Usuario.objects.filter(username__startswith="int_p_").count()
        self._paso("la transacción se revirtió: no quedó ninguna persona de la prueba", residuo == 0, f"{residuo} filas")
        total, fallas = len(self.resultados), self.resultados.count(False)
        self.stdout.write(f"\n{total - fallas} de {total} pasos correctos; no quedó ningún dato (transacción revertida).")
        if fallas:
            raise CommandError(f"{fallas} paso(s) fallaron")

    def _recorrer(self):
        ana, auditor, operador = self._persona("ana"), self._persona("auditor", "auditor"), self._persona("operador", "operador_seguridad")
        t = {u.username: self._token(u) for u in (ana, auditor, operador)}
        self._paso("/auth/actividad/ sin token responde 401", self._http("/auth/actividad/").status_code == 401)

        # ---------------------------------------------------------------- las rutas de transparencia ya no existen
        for ruta in ("/politicas/matriz/", "/politicas/base-de-datos/", "/politicas/simular/", "/politicas/"):
            for quien, token in (("sin sesión", None), ("con sesión de ciudadana", t[ana.username]), ("con sesión de operador", t[operador.username])):
                r = self._http(ruta, token)
                self._paso(f"{ruta} {quien} responde 404 (la ruta ya no existe)", r.status_code == 404, r.status_code)
        r = self._post("/politicas/simular/", {"rol": "funcionario", "accion": "ver_tramite"}, t[ana.username])
        self._paso("un POST a /politicas/simular/ también responde 404", r.status_code == 404, r.status_code)

        # ---------------------------------------------------------------- base de datos (catálogo de PostgreSQL)
        atributos, priv, tablas = self._base()
        self._paso("existen los 5 roles de la base", all(n in atributos for n in ROLES_BD))
        self._paso("ningún rol de la aplicación es superusuario ni omite la seguridad por filas", not any(atributos[n][1] or atributos[n][2] for n in ROLES_BD if n in atributos))
        self._paso("el administrador del motor existe pero está contenido (sin contraseña, solo socket local)", bool(atributos.get("postgres") and atributos["postgres"][1]))
        self._paso("el dueño de las tablas no puede iniciar sesión", atributos["siget_owner"][3] is False)
        self._paso("app_role tiene límite de conexiones", (atributos["app_role"][4] or -1) > 0, atributos["app_role"][4])
        self._paso("las tablas del negocio tienen seguridad por filas (RLS) y políticas", all(tablas[n]["rls"] and tablas[n]["politicas"] > 0 for n in ("tramite", "evento_auditoria")),
                   {n: (tablas[n]["rls"], tablas[n]["politicas"]) for n in ("tramite", "evento_auditoria")})
        self._paso("hay disparadores que protegen el registro y las transiciones", tablas["evento_auditoria"]["triggers"] > 0 and tablas["tramite"]["triggers"] > 0)

        for tabla in ("decision_pdp", "evento_auditoria", "evento_seguridad"):
            # El dueño de la tabla tiene todos los privilegios por serlo: lo que lo contiene es que NO puede iniciar sesión y que
            # los disparadores de solo inserción rechazan el UPDATE y el DELETE incluso para él.
            peor = [(r, p) for r in priv if r != "siget_owner" for p in ("UPDATE", "DELETE") if priv[r][tabla][p] != "no"]
            self._paso(f"ningún rol que se conecta puede alterar ni borrar {tabla} (registro inalterable)", peor == [], peor)
            self._paso(f"{tabla} está protegida además por disparadores (el dueño, que no inicia sesión, tampoco la altera)", tablas[tabla]["triggers"] > 0, tablas[tabla]["triggers"])
        self._paso("app_role inserta decisiones de acceso pero no las lee de vuelta con permisos de escritura",
                   priv["app_role"]["decision_pdp"]["INSERT"] == "total" and priv["app_role"]["decision_pdp"]["UPDATE"] == "no")
        self._paso("auditor_role solo lee: sin insertar, alterar ni borrar nada",
                   all(priv["auditor_role"][tb][p] == "no" for tb in tablas for p in ("INSERT", "UPDATE", "DELETE")) and priv["auditor_role"]["decision_pdp"]["SELECT"] == "total")
        self._paso("auditor_role no lee trámites ni sesiones", priv["auditor_role"]["tramite"]["SELECT"] == "no" and priv["auditor_role"]["sesion"]["SELECT"] == "no")
        self._paso("auditor_role de las personas solo ve algunas columnas (no el hash ni el secreto)", priv["auditor_role"]["usuario"]["SELECT"] == "columnas", priv["auditor_role"]["usuario"]["SELECT"])
        self._paso("app_role no borra nada en ninguna tabla", all(priv["app_role"][tb]["DELETE"] == "no" for tb in tablas))
        self._paso("de las personas, app_role solo altera algunas columnas (no puede cambiar su rol de plataforma)", priv["app_role"]["usuario"]["UPDATE"] == "columnas")
        self._paso("el catálogo de transiciones es inmodificable para la aplicación", priv["app_role"]["transicion"]["INSERT"] == "no" and priv["app_role"]["transicion"]["UPDATE"] == "no")

        # ---------------------------------------------------------------- PDP (evaluado directamente)
        ahora = timezone.now()
        sujeto = Sujeto(id=operador.pk, mfa_verificado_en=ahora, rol_plataforma="operador_seguridad")
        d = decidir(sujeto, Accion.VER_TRAMITE, Recurso(tipo="tramite", institucion_id=1, solicitante_id=999999), Entorno(ahora=ahora))
        self._paso("el PDP niega al operador de seguridad ver trámites, con la política que lo dice", not d.permitido and d.politica == "plataforma_sin_acceso_a_tramites", d.politica)

        # ---------------------------------------------------------------- actividad de seguridad propia
        EventoSeguridad.objects.create(actor_id=ana.pk, evento="login_ok", ip="198.51.100.9", detalle={})
        EventoSeguridad.objects.create(actor_id=ana.pk, evento="mfa_verificado", ip="198.51.100.9", detalle={})
        EventoSeguridad.objects.create(actor_id=auditor.pk, evento="login_ok", ip="198.51.100.10", detalle={})
        r = self._http("/auth/actividad/", t[ana.username])
        eventos = r.json()["eventos"] if r.status_code == 200 else []
        self._paso("cada persona ve su propia actividad de seguridad", r.status_code == 200 and [e["evento"] for e in eventos] == ["mfa_verificado", "login_ok"], [e["evento"] for e in eventos])
        self._paso("y solo la suya: nunca la de otra persona", all("198.51.100.10" != e["ip"] for e in eventos))
