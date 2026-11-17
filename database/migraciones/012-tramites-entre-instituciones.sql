-- ============================================================================
-- Migracion 012: quien puede iniciar que tramite (ciudadania vs. institucion a institucion)
-- ============================================================================
-- Se ejecuta como siget_owner (duenio de los objetos), no como superusuario.
--
-- * tipo_tramite.audiencia: 'ciudadania' (lo inicia una persona de la ciudadania), 'institucion' (lo inicia el personal de OTRA
--   institucion, p. ej. una solicitud interinstitucional de informacion) o 'ambas'.
-- * Cada institucion tiene un tramite interinstitucional de informacion, solo para personal de otras instituciones.
-- * Segunda barrera (el PDP es la primera): un trigger rechaza que quien tiene membresia vigente en la institucion destino inicie
--   alli un tramite (conflicto de interes), y que la audiencia del tipo no corresponda a quien lo inicia.
-- ============================================================================
BEGIN;
SET LOCAL ROLE siget_owner;

ALTER TABLE siget.tipo_tramite
  ADD COLUMN audiencia text NOT NULL DEFAULT 'ciudadania'
  CHECK (audiencia IN ('ciudadania', 'institucion', 'ambas'));

INSERT INTO siget.tipo_tramite (institucion_id, nombre, sla_dias, audiencia)
SELECT id, 'Solicitud interinstitucional de información', 5, 'institucion' FROM siget.institucion
ON CONFLICT (institucion_id, nombre) DO NOTHING;

CREATE FUNCTION siget.validar_inicio_de_tramite() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = siget, pg_temp AS $$
DECLARE
  v_audiencia text;
  v_personal  boolean;
BEGIN
  SELECT audiencia INTO v_audiencia FROM siget.tipo_tramite WHERE id = NEW.tipo_tramite_id;
  IF EXISTS (SELECT 1 FROM siget.membresia
              WHERE usuario_id = NEW.solicitante_id AND institucion_id = NEW.institucion_id AND revocada_en IS NULL) THEN
    RAISE EXCEPTION 'El personal de una institucion no inicia tramites en su propia institucion';
  END IF;
  SELECT EXISTS (SELECT 1 FROM siget.membresia WHERE usuario_id = NEW.solicitante_id AND revocada_en IS NULL) INTO v_personal;
  IF (v_personal AND v_audiencia = 'ciudadania') OR (NOT v_personal AND v_audiencia = 'institucion') THEN
    RAISE EXCEPTION 'Este tramite no esta disponible para quien lo solicita (audiencia: %)', v_audiencia;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION siget.validar_inicio_de_tramite() FROM PUBLIC;

CREATE TRIGGER tramite_valida_inicio BEFORE INSERT ON siget.tramite
  FOR EACH ROW EXECUTE FUNCTION siget.validar_inicio_de_tramite();

COMMIT;
