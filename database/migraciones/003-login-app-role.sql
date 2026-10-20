-- ============================================================================
-- Migracion 003: el rol de la aplicacion puede conectarse (LOGIN)
-- ============================================================================
-- app_role nacio NOLOGIN. Ahora lo usa el backend de Django. La contrasena NO esta aqui:
-- se fija aparte (ALTER ROLE app_role PASSWORD ...) y vive solo como `podman secret`.
-- Sigue sin ser superusuario, sin BYPASSRLS y sin poder crear roles ni bases.
-- Se ejecuta como el superusuario del contenedor (por el socket local), una sola vez.
-- ============================================================================

REVOKE ALL ON DATABASE tramites_demo FROM PUBLIC;
-- Quitar PUBLIC obliga a conceder CONNECT a TODOS los roles que se conectan. Los permisos a nivel de base no
-- viajan con pg_restore, asi que se declaran todos aqui (si no, el rol que falte recibe "permission denied").
GRANT CONNECT ON DATABASE tramites_demo TO app_role, auditor_role, checkpoint_app, pgadmin_lectura, siget_owner;
ALTER ROLE app_role LOGIN CONNECTION LIMIT 20;
