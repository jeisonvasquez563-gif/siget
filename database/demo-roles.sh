#!/usr/bin/env bash
# Demo para mostrar roles, permisos y modulos de SIGET a nivel de base de datos.
# 1) Muestra el estado REAL de la base. 2) Ejecuta las pruebas dentro de una
# transaccion que se revierte (los datos de prueba no se guardan). Si el esquema
# siget aun no esta aplicado, lo crea dentro de esa misma transaccion.
# Uso (en VM2): bash ~/siget-diseno/demo.sh
D="$(cd "$(dirname "$0")" && pwd)"
DB=tramites_demo
# Por defecto usa el contenedor siget-postgres (la base viva desde el 20-oct). Para la base nativa antigua:
#   SIGET_PSQL="sudo -u postgres psql" bash demo.sh
PSQL="${SIGET_PSQL:-$D/psql-contenedor.sh}"
psqlp() { $PSQL -d "$DB" -P pager=off "$@"; }
cd /tmp

echo; echo "################ 1. ESTADO REAL DE LA BASE ################"
echo; echo "--- Roles (sin hashes):"
psqlp -c "select rolname, rolsuper as superusuario, rolcreaterole as crea_roles, rolcanlogin as login from pg_roles where rolname !~ '^pg_' order by 1"
echo "--- Tablas, duenio y RLS:"
psqlp -c "select tablename as tabla, tableowner as duenio, rowsecurity as rls from pg_tables where schemaname='public'"
echo "--- Politicas RLS y triggers hoy:"
psqlp -At -c "select 'politicas RLS: '||count(*) from pg_policies" -c "select 'triggers de usuario: '||count(*) from pg_trigger where not tgisinternal"

echo; echo "################ 2. 24 PRUEBAS DE ROLES Y PERMISOS (los datos de prueba se revierten) ################"
echo
EXISTE=$(psqlp -At -c "select count(*) from pg_namespace where nspname='siget'")
{ echo "BEGIN;"; [ "$EXISTE" = "0" ] && cat "$D/diseno-roles-permisos.sql"; cat "$D/diseno-pruebas.sql"; echo "ROLLBACK;"; } \
  | $PSQL -d "$DB" -v ON_ERROR_STOP=1 -P pager=off -f - 2>&1 \
  | grep -E "PRUEBA|ERROR|ERRO" | sed -E 's/^psql:[^ ]+ NOTICE:  //'

echo; echo "################ 3. COMPROBACION: LOS DATOS DE PRUEBA NO QUEDARON ################"
psqlp -At -c "select 'usuarios del checkpoint intactos: '||count(*) from app_usuarios"
psqlp -At -c "select 'tramites de prueba que quedaron: '||count(*) from siget.tramite" 2>/dev/null || true

echo; echo "--- Roles hoy (el unico superusuario es postgres: sin contrasena y rechazado por red):"
psqlp -c "select r.rolname, r.rolsuper as superusuario, r.rolcanlogin as login, (a.rolpassword is not null) as tiene_clave from pg_roles r join pg_authid a on a.oid = r.oid where r.rolname !~ '^pg_' order by 1"
