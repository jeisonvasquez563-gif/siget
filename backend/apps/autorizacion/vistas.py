"""Transparencia: qué puede hacer cada rol, calculado por el propio sistema.

- `/politicas/matriz/`: la matriz de roles y permisos, generada evaluando el PDP (no está escrita a mano).
- `/politicas/base-de-datos/`: los privilegios REALES de cada rol de PostgreSQL por tabla (`has_table_privilege`), con las
  protecciones de la base (RLS, triggers). Es información de metadatos: no lee datos de nadie.

Cualquier persona autenticada puede consultarlas: que las reglas sean públicas para quien las vive es parte de Zero Trust.
"""
from django.db import connection
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from apps.autenticacion.autenticacion import exige_scope
from apps.autenticacion.tokens import SCOPE_COMPLETO

from . import matriz

ROLES_BD = [
    ("app_role", "El backend (Django): solo lo que la aplicación necesita para trabajar"),
    ("auditor_role", "La consola de auditoría: solo lectura del registro"),
    ("siget_owner", "Dueño de las tablas: nadie se conecta con él (no tiene inicio de sesión)"),
    ("checkpoint_app", "Checkpoint PHP intermedio (se retira en la semana 6)"),
    ("pgadmin_lectura", "Consulta de solo lectura para administrar la base"),
]
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
_SQL_ATRIBUTOS = """
    SELECT rolname, rolsuper, rolbypassrls, rolcanlogin, rolconnlimit, rolcreaterole, rolcreatedb
      FROM pg_roles WHERE rolname = ANY(%s)
"""
_SQL_TABLAS = """
    SELECT c.relname, c.relrowsecurity,
           (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'siget' AND p.tablename = c.relname),
           (SELECT count(*) FROM pg_trigger t WHERE t.tgrelid = c.oid AND NOT t.tgisinternal)
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'siget'
     WHERE c.relkind = 'r' ORDER BY c.relname
"""


class _Transparencia(APIView):
    permission_classes = [exige_scope(SCOPE_COMPLETO)]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "api"


class MatrizPermisos(_Transparencia):
    def get(self, request):
        return Response(matriz.construir())


class PermisosBaseDeDatos(_Transparencia):
    def get(self, request):
        nombres = [r for r, _ in ROLES_BD]
        with connection.cursor() as c:
            c.execute(_SQL_ATRIBUTOS, [[*nombres, "postgres"]])
            atributos = {f[0]: f for f in c.fetchall()}
            c.execute(_SQL_PRIVILEGIOS, [nombres])
            filas = c.fetchall()
            c.execute(_SQL_TABLAS)
            tablas = [{"nombre": f[0], "rls": f[1], "politicas": f[2], "triggers": f[3]} for f in c.fetchall()]

        privilegios = {r: {t["nombre"]: {p: "no" for p in PRIVILEGIOS} for t in tablas} for r in nombres}
        for rol, tabla, priv, total, columnas in filas:
            privilegios[rol][tabla][priv] = "total" if total else ("columnas" if columnas else "no")

        roles = []
        for nombre, descripcion in ROLES_BD:
            a = atributos.get(nombre)
            roles.append({"nombre": nombre, "descripcion": descripcion, "existe": a is not None,
                          "superusuario": bool(a and a[1]), "omite_rls": bool(a and a[2]), "puede_conectar": bool(a and a[3]),
                          "limite_conexiones": a[4] if a else None, "crea_roles": bool(a and a[5]), "crea_bases": bool(a and a[6])})
        postgres = atributos.get("postgres")
        return Response({
            "roles": roles, "tablas": tablas, "privilegios": privilegios,
            "administrador_del_motor": {
                "nombre": "postgres", "superusuario": bool(postgres and postgres[1]),
                "nota": "Existe, pero no tiene contraseña y se rechaza por red: solo entra por el socket local del contenedor.",
            },
            # Ningún rol de la aplicación puede saltarse la seguridad de la base
            "ningun_rol_de_aplicacion_es_superusuario": not any(r["superusuario"] or r["omite_rls"] for r in roles),
        })
