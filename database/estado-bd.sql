-- Estado de la base de datos de SIGET: SOLO LECTURA (ninguna sentencia modifica nada).
-- Uso en VM2, con la cuenta que tiene sudo:
--   database/psql-contenedor.sh -d tramites_demo -f estado-bd.sql
-- Cada bloque imprime un título y su resultado; los resultados se pegan en docs/estado-base-de-datos.md.

\echo '== 1. Motor, base y tamaño'
SELECT version() AS motor, current_database() AS base, pg_size_pretty(pg_database_size(current_database())) AS tamano,
       now() AS ahora, (SELECT pg_postmaster_start_time()) AS arranque;

\echo '== 2. Roles (ninguno debe ser superusuario salvo postgres; ninguno omite RLS)'
SELECT rolname, rolsuper AS superusuario, rolbypassrls AS omite_rls, rolcanlogin AS login, rolconnlimit AS limite,
       rolcreaterole AS crea_roles, rolcreatedb AS crea_bases, (rolpassword IS NOT NULL) AS tiene_clave
FROM pg_authid WHERE rolname !~ '^pg_' ORDER BY rolname;

\echo '== 3. Tablas del esquema siget: filas, tamano, RLS, politicas, disparadores'
SELECT c.relname AS tabla, c.reltuples::bigint AS filas_aprox, pg_size_pretty(pg_total_relation_size(c.oid)) AS tamano,
       c.relrowsecurity AS rls, c.relforcerowsecurity AS rls_forzada,
       (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS politicas,
       (SELECT count(*) FROM pg_trigger t WHERE t.tgrelid = c.oid AND NOT t.tgisinternal) AS disparadores,
       pg_get_userbyid(c.relowner) AS duenio
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'siget' AND c.relkind = 'r' ORDER BY c.relname;

\echo '== 4. Conteo exacto de filas'
SELECT 'usuario' AS tabla, count(*) FROM siget.usuario UNION ALL SELECT 'institucion', count(*) FROM siget.institucion
UNION ALL SELECT 'membresia', count(*) FROM siget.membresia UNION ALL SELECT 'tipo_tramite', count(*) FROM siget.tipo_tramite
UNION ALL SELECT 'tramite', count(*) FROM siget.tramite UNION ALL SELECT 'transicion', count(*) FROM siget.transicion
UNION ALL SELECT 'evento_auditoria', count(*) FROM siget.evento_auditoria UNION ALL SELECT 'decision_pdp', count(*) FROM siget.decision_pdp
UNION ALL SELECT 'evento_seguridad', count(*) FROM siget.evento_seguridad UNION ALL SELECT 'aprobacion', count(*) FROM siget.aprobacion
UNION ALL SELECT 'sesion', count(*) FROM siget.sesion ORDER BY 1;

\echo '== 5. Cuentas por rol de plataforma y segundo factor'
SELECT rol_plataforma, count(*) AS cuentas, count(*) FILTER (WHERE mfa_activo) AS con_mfa, count(*) FILTER (WHERE bloqueado_hasta > now()) AS bloqueadas
FROM siget.usuario GROUP BY rol_plataforma ORDER BY 1;

\echo '== 6. Sesiones: vigentes y revocadas'
SELECT count(*) FILTER (WHERE NOT revocada AND expira_en > now()) AS vigentes, count(*) FILTER (WHERE revocada) AS revocadas, count(*) AS total
FROM siget.sesion;

\echo '== 7. Eventos de seguridad por tipo (ultimos 7 dias)'
SELECT evento, count(*) FROM siget.evento_seguridad WHERE creado_en > now() - interval '7 days' GROUP BY 1 ORDER BY 2 DESC;

\echo '== 8. Decisiones del PDP por resultado (ultimos 7 dias)'
SELECT permitido, count(*) FROM siget.decision_pdp WHERE creado_en > now() - interval '7 days' GROUP BY 1;

\echo '== 9. Funciones SECURITY DEFINER y su search_path fijo'
SELECT p.proname, p.prosecdef AS definer, p.proconfig AS config FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'siget' ORDER BY 1;

\echo '== 10. Conexiones ahora (deben ser solo de las IP permitidas y con TLS)'
SELECT a.usename, a.client_addr, s.ssl, s.version AS tls, count(*) FROM pg_stat_activity a LEFT JOIN pg_stat_ssl s ON s.pid = a.pid
WHERE a.datname IS NOT NULL GROUP BY 1,2,3,4 ORDER BY 1;

\echo '== 11. Parametros de seguridad del motor'
SELECT name, setting FROM pg_settings WHERE name IN ('ssl','ssl_min_protocol_version','password_encryption','log_connections','log_disconnections','listen_addresses','max_connections');

\echo '== 12. Privilegios peligrosos: algun rol distinto del dueno con UPDATE o DELETE sobre el registro inalterable?'
SELECT grantee, table_name, privilege_type FROM information_schema.role_table_grants
WHERE table_schema = 'siget' AND table_name IN ('evento_auditoria','decision_pdp','evento_seguridad','transicion')
  AND privilege_type IN ('UPDATE','DELETE','TRUNCATE') AND grantee NOT IN ('siget_owner','postgres') ORDER BY 1,2;
