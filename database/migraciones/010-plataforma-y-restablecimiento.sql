-- ============================================================================
-- Migracion 010: recuperacion de contrasena asistida y registro de rotaciones de secretos
-- ============================================================================
-- Se ejecuta como siget_owner (duenio de los objetos), no como superusuario.
--
-- * restablecimiento: codigos de un solo uso para fijar una contrasena nueva. El codigo en claro NUNCA se guarda (solo su
--   SHA-256), vence en 15 minutos y lo emite el operador de identidades, que lo entrega por un canal externo.
--   La aplicacion solo lo puede marcar como usado (UPDATE de una columna); no se borra ni se edita nada mas.
-- * rotacion_secreto: metadatos de cada rotacion de un secreto (cual, cuando, quien, nota). NUNCA el valor del secreto.
--   Es de solo insercion, igual que la auditoria.
-- ============================================================================
BEGIN;
SET LOCAL ROLE siget_owner;

CREATE TABLE siget.restablecimiento (
  id           bigserial PRIMARY KEY,
  usuario_id   int NOT NULL REFERENCES siget.usuario(id),
  codigo_hash  text NOT NULL UNIQUE CHECK (char_length(codigo_hash) = 64),
  emitido_por  int NOT NULL REFERENCES siget.usuario(id),
  creado_en    timestamptz NOT NULL DEFAULT now(),
  vence_en     timestamptz NOT NULL,
  usado_en     timestamptz,
  CONSTRAINT restablecimiento_vence_despues CHECK (vence_en > creado_en),
  CONSTRAINT restablecimiento_no_a_si_mismo CHECK (emitido_por <> usuario_id)
);
CREATE INDEX restablecimiento_usuario_idx ON siget.restablecimiento (usuario_id) WHERE usado_en IS NULL;

CREATE TABLE siget.rotacion_secreto (
  id             bigserial PRIMARY KEY,
  secreto        text NOT NULL CHECK (secreto IN ('jwt', 'mfa', 'db_app', 'db_auditor', 'django', 'cert_nginx', 'cert_postgres', 'ca')),
  registrado_por int NOT NULL REFERENCES siget.usuario(id),
  nota           text NOT NULL DEFAULT '' CHECK (char_length(nota) <= 300),
  creado_en      timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER rotacion_secreto_inmutable BEFORE UPDATE OR DELETE ON siget.rotacion_secreto
  FOR EACH ROW EXECUTE FUNCTION siget.bloquear_modificacion();
CREATE TRIGGER rotacion_secreto_sin_truncate BEFORE TRUNCATE ON siget.rotacion_secreto
  FOR EACH STATEMENT EXECUTE FUNCTION siget.bloquear_modificacion();

REVOKE ALL ON siget.restablecimiento, siget.rotacion_secreto FROM PUBLIC;
GRANT SELECT, INSERT ON siget.restablecimiento TO app_role;
GRANT UPDATE (usado_en) ON siget.restablecimiento TO app_role;
GRANT SELECT, INSERT ON siget.rotacion_secreto TO app_role;
GRANT USAGE ON SEQUENCE siget.restablecimiento_id_seq, siget.rotacion_secreto_id_seq TO app_role;
-- Ni el auditor ni pgadmin_lectura leen codigos; la auditoria ve las rotaciones (son metadatos, no secretos)
REVOKE ALL ON siget.restablecimiento, siget.rotacion_secreto FROM pgadmin_lectura, auditor_role, checkpoint_app;
GRANT SELECT ON siget.rotacion_secreto TO auditor_role;

COMMIT;
