-- ============================================================================
-- Migracion 007: el rol de auditoria puede conectarse (LOGIN), solo para leer
-- ============================================================================
-- La consola de auditoria del backend NO lee con app_role: usa su propia conexion como auditor_role, que solo
-- tiene SELECT (evento_auditoria, decision_pdp, evento_seguridad, aprobacion). Asi, aunque el backend se
-- comprometiera por otra via, la consola de auditoria no podria escribir ni alterar nada.
-- La contrasena NO esta aqui: se fija aparte (ALTER ROLE auditor_role PASSWORD ...) y vive como `podman secret`.
-- Se ejecuta como el superusuario del contenedor (por el socket local), una sola vez.
-- ============================================================================

ALTER ROLE auditor_role LOGIN CONNECTION LIMIT 5;
-- Para mostrar quien actuo: solo el identificador y el nombre de usuario (nunca el hash de la contrasena ni el secreto TOTP)
GRANT SELECT (id, username, rol_plataforma) ON siget.usuario TO auditor_role;
