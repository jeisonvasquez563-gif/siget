-- ============================================================================
-- Migracion 004: autenticacion (MFA TOTP, bloqueo por intentos, sesiones y eventos de seguridad)
-- ============================================================================
-- Se ejecuta como siget_owner (duenio de los objetos), no como superusuario.
--
-- * usuario: columnas del segundo factor y del bloqueo por intentos fallidos.
--   mfa_secreto guarda el secreto TOTP CIFRADO por la aplicacion (Fernet); la base nunca lo ve en claro.
-- * sesion: un registro por sesion. El token de refresco se guarda como HASH (nunca el token); rota en
--   cada uso y puede revocarse (operador de seguridad, cierre de sesion, reuso detectado).
-- * evento_seguridad: registro de solo insercion de autenticacion y seguridad (principio 7 de Zero Trust).
-- ============================================================================

SET LOCAL ROLE siget_owner;

ALTER TABLE siget.usuario
  ADD COLUMN mfa_secreto        text,
  ADD COLUMN mfa_activo         boolean NOT NULL DEFAULT false,
  ADD COLUMN mfa_ultimo_paso    bigint,
  ADD COLUMN intentos_fallidos  integer NOT NULL DEFAULT 0 CHECK (intentos_fallidos >= 0),
  ADD COLUMN bloqueado_hasta    timestamptz;

CREATE TABLE siget.sesion (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id       int NOT NULL REFERENCES siget.usuario(id),
  refresh_hash     text NOT NULL UNIQUE,
  creado_en        timestamptz NOT NULL DEFAULT now(),
  expira_en        timestamptz NOT NULL,
  revocada         boolean NOT NULL DEFAULT false,
  reemplazada_por  uuid REFERENCES siget.sesion(id),
  ip               text
);
CREATE INDEX sesion_usuario_idx ON siget.sesion (usuario_id) WHERE NOT revocada;

CREATE TABLE siget.evento_seguridad (
  id          bigserial PRIMARY KEY,
  actor_id    int REFERENCES siget.usuario(id),
  evento      text NOT NULL,
  ip          text,
  detalle     jsonb NOT NULL DEFAULT '{}'::jsonb,
  creado_en   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX evento_seguridad_actor_idx ON siget.evento_seguridad (actor_id, creado_en);

-- Solo insercion: la misma defensa que la auditoria de tramites
CREATE TRIGGER evento_seguridad_inmutable BEFORE UPDATE OR DELETE ON siget.evento_seguridad
  FOR EACH ROW EXECUTE FUNCTION siget.bloquear_modificacion();
CREATE TRIGGER evento_seguridad_sin_truncate BEFORE TRUNCATE ON siget.evento_seguridad
  FOR EACH STATEMENT EXECUTE FUNCTION siget.bloquear_modificacion();

-- Permisos de app_role: lo justo para autenticar
GRANT UPDATE (mfa_secreto, mfa_activo, mfa_ultimo_paso, intentos_fallidos, bloqueado_hasta) ON siget.usuario TO app_role;
GRANT SELECT, INSERT ON siget.sesion TO app_role;
GRANT UPDATE (revocada, reemplazada_por) ON siget.sesion TO app_role;
GRANT SELECT, INSERT ON siget.evento_seguridad TO app_role;
GRANT USAGE ON SEQUENCE siget.evento_seguridad_id_seq TO app_role;
GRANT SELECT ON siget.evento_seguridad TO auditor_role;

RESET ROLE;
