-- ============================================================================
-- Migracion 014: invitaciones para crear cuenta (registro configurable, PT-2)
-- ============================================================================
-- Se ejecuta como siget_owner (duenio de los objetos), no como superusuario.
--
-- Con SIGET_REGISTRO=invitacion, crear una cuenta exige un codigo de un solo uso que emite el operador de identidades y entrega
-- por un canal externo. Igual que los codigos de restablecimiento (migracion 010): el codigo en claro NUNCA se guarda (solo su
-- SHA-256), vence (7 dias por defecto) y se gasta en la misma transaccion en que se crea la cuenta.
-- La aplicacion (app_role) puede emitirlas (INSERT), verlas y marcarlas como usadas (UPDATE de usada_en y usada_por); no puede
-- borrarlas, cambiarles el vencimiento ni reutilizarlas. Una invitacion usada no vuelve a quedar libre.
-- ============================================================================
BEGIN;
SET LOCAL ROLE siget_owner;

CREATE TABLE siget.invitacion (
  id           bigserial PRIMARY KEY,
  codigo_hash  text NOT NULL UNIQUE CHECK (char_length(codigo_hash) = 64),
  emitida_por  int NOT NULL REFERENCES siget.usuario(id),
  nota         text NOT NULL DEFAULT '' CHECK (char_length(nota) <= 120),
  creado_en    timestamptz NOT NULL DEFAULT now(),
  vence_en     timestamptz NOT NULL,
  usada_en     timestamptz,
  usada_por    int REFERENCES siget.usuario(id),
  CONSTRAINT invitacion_vence_despues CHECK (vence_en > creado_en),
  CONSTRAINT invitacion_uso_completo CHECK ((usada_en IS NULL) = (usada_por IS NULL))
);

-- Una invitacion usada no se "des-usa" ni cambia de duenio
CREATE FUNCTION siget.invitacion_un_solo_uso() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.usada_en IS NOT NULL THEN
    RAISE EXCEPTION 'La invitacion % ya se uso: no se modifica', OLD.id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER invitacion_valida_uso BEFORE UPDATE ON siget.invitacion
  FOR EACH ROW EXECUTE FUNCTION siget.invitacion_un_solo_uso();

GRANT SELECT, INSERT ON siget.invitacion TO app_role;
GRANT UPDATE (usada_en, usada_por) ON siget.invitacion TO app_role;
GRANT USAGE ON SEQUENCE siget.invitacion_id_seq TO app_role;
GRANT SELECT (id, emitida_por, nota, creado_en, vence_en, usada_en, usada_por) ON siget.invitacion TO auditor_role;

COMMIT;
