-- ============================================================================
-- Migracion 009: pgadmin_lectura con minimo privilegio
-- ============================================================================
-- pgadmin_lectura (consulta de solo lectura para el equipo) era miembro del rol predefinido pg_read_all_data, que lee TODO el
-- esquema: hashes de contrasenas, hashes de tokens de refresco, secretos TOTP cifrados y, desde la migracion 008, los datos
-- personales. Un rol de "solo lectura" no debe poder llevarse las credenciales. Se le quita esa membresia y se le conceden,
-- una por una, solo las lecturas que sirven para ver el sistema.
--   * SIN acceso: sesion, evento_seguridad, perfil y las columnas de credenciales de usuario (hash, secreto TOTP, contadores).
--   * CON acceso: catalogo, membresias, tramites (la seguridad por filas sigue aplicando), historial, aprobaciones, la
--     auditoria de tramites y las decisiones del motor, y de usuario solo identificador, nombre de usuario y atributos de acceso.
-- Se conserva pg_monitor (estadisticas del motor, no lee datos de tablas).
-- Se ejecuta como el superusuario del contenedor (por el socket local): quitar una membresia lo exige.
-- ============================================================================
BEGIN;

REVOKE pg_read_all_data FROM pgadmin_lectura;

GRANT USAGE ON SCHEMA siget TO pgadmin_lectura;
GRANT SELECT ON siget.institucion, siget.tipo_tramite, siget.membresia, siget.tramite, siget.transicion,
                siget.aprobacion, siget.evento_auditoria, siget.decision_pdp TO pgadmin_lectura;
GRANT SELECT (id, username, nivel_aseguramiento, estado_cuenta, rol_plataforma, mfa_activo, creado_en) ON siget.usuario TO pgadmin_lectura;

COMMIT;
