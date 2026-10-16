#!/usr/bin/env bash
# Demo para mostrar roles, permisos y modulos de SIGET a nivel de base de datos.
# 1) Muestra el estado REAL de la base. 2) Ejecuta las pruebas del diseno dentro
# de una transaccion que se revierte: no deja ningun cambio.
# Uso (en VM2): bash ~/siget-diseno/demo.sh
D="$(cd "$(dirname "$0")" && pwd)"
DB=tramites_demo
psqlp() { sudo -u postgres psql -d "$DB" -P pager=off "$@"; }
cd /tmp

echo; echo "################ 1. ESTADO REAL DE LA BASE (checkpoint) ################"
echo; echo "--- Roles (sin hashes):"
psqlp -c "select rolname, rolsuper as superusuario, rolcreaterole as crea_roles, rolcanlogin as login from pg_roles where rolname !~ '^pg_' order by 1"
echo "--- Tablas, duenio y RLS:"
psqlp -c "select tablename as tabla, tableowner as duenio, rowsecurity as rls from pg_tables where schemaname='public'"
echo "--- Politicas RLS y triggers hoy:"
psqlp -At -c "select 'politicas RLS: '||count(*) from pg_policies" -c "select 'triggers de usuario: '||count(*) from pg_trigger where not tgisinternal"

echo; echo "################ 2. DISENO ZERO TRUST: 19 PRUEBAS (se revierte al final) ################"
echo
{ echo "BEGIN;"; cat "$D/diseno-roles-permisos.sql"; cat "$D/diseno-pruebas.sql"; echo "ROLLBACK;"; } \
  | sudo -u postgres psql -d "$DB" -v ON_ERROR_STOP=1 -P pager=off -f - 2>&1 \
  | grep -E "PRUEBA|ERROR|ERRO" | sed -E 's/^psql:[^ ]+ NOTICE:  //'

echo; echo "################ 3. COMPROBACION: NO QUEDO NINGUN CAMBIO ################"
psqlp -At -c "select 'esquema siget existe: '||count(*) from pg_namespace where nspname='siget'" \
         -c "select 'roles del diseno que existen: '||count(*) from pg_roles where rolname in ('app_role','auditor_role','siget_owner')" \
         -c "select 'usuarios del checkpoint intactos: '||count(*) from app_usuarios"
