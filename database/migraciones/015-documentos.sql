-- ============================================================================
-- Migracion 015: documentos adjuntos a los tramites (PT-8)
-- ============================================================================
-- Se ejecuta como siget_owner (duenio de los objetos), no como superusuario.
--
-- * documento: metadatos de cada archivo. El archivo vive CIFRADO (AES-256-GCM) en el volumen de documentos de VM1; aqui
--   solo su nombre para mostrar, tipo, tamanio, SHA-256 del contenido y la ubicacion generada por el servidor.
-- * Sin borrado ni edicion: app_role solo SELECT e INSERT (igual que la auditoria, un documento entregado no se cambia).
-- * Seguridad por filas, la misma idea que tramite: lo ve el solicitante del tramite o el personal de su institucion; solo el
--   solicitante adjunta (a su nombre) y solo mientras el tramite no tiene resolucion final.
-- * Un trigger impide que la institucion del documento sea distinta de la de su tramite (no se cuela en otra institucion).
-- ============================================================================
BEGIN;
SET LOCAL ROLE siget_owner;

CREATE TABLE siget.documento (
  id              bigserial PRIMARY KEY,
  tramite_id      bigint NOT NULL REFERENCES siget.tramite(id),
  institucion_id  int NOT NULL,
  subido_por      int NOT NULL REFERENCES siget.usuario(id),
  nombre          text NOT NULL CHECK (char_length(nombre) BETWEEN 1 AND 120),
  tipo_mime       text NOT NULL CHECK (tipo_mime IN ('application/pdf', 'image/png', 'image/jpeg')),
  tamano          int NOT NULL CHECK (tamano BETWEEN 1 AND 5242880),
  sha256          text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  ubicacion       text NOT NULL UNIQUE CHECK (ubicacion ~ '^[0-9a-f]{32}$'),
  creado_en       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX documento_tramite_idx ON siget.documento (tramite_id);

CREATE FUNCTION siget.documento_valida() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = siget, pg_temp AS $$
DECLARE
  v_institucion int;
  v_estado      siget.estado_tramite;
BEGIN
  SELECT institucion_id, estado INTO v_institucion, v_estado FROM siget.tramite WHERE id = NEW.tramite_id;
  IF v_institucion IS DISTINCT FROM NEW.institucion_id THEN
    RAISE EXCEPTION 'El documento debe pertenecer a la institucion de su tramite';
  END IF;
  IF v_estado IN ('Aprobado', 'Rechazado') THEN
    RAISE EXCEPTION 'Un tramite con resolucion final no admite documentos';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION siget.documento_valida() FROM PUBLIC;
CREATE TRIGGER documento_valida_insercion BEFORE INSERT ON siget.documento
  FOR EACH ROW EXECUTE FUNCTION siget.documento_valida();

-- Un documento entregado no se modifica ni se borra (ni siquiera por error de la aplicacion)
CREATE FUNCTION siget.documento_inmutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Los documentos no se modifican ni se borran';
END $$;
CREATE TRIGGER documento_sin_cambios BEFORE UPDATE OR DELETE ON siget.documento
  FOR EACH ROW EXECUTE FUNCTION siget.documento_inmutable();

GRANT SELECT, INSERT ON siget.documento TO app_role;
GRANT USAGE ON SEQUENCE siget.documento_id_seq TO app_role;

ALTER TABLE siget.documento ENABLE ROW LEVEL SECURITY;
CREATE POLICY documento_ver ON siget.documento FOR SELECT TO app_role
  USING (institucion_id = ANY (siget.ctx_instituciones())
         OR EXISTS (SELECT 1 FROM siget.tramite t WHERE t.id = documento.tramite_id AND t.solicitante_id = siget.ctx_usuario()));
CREATE POLICY documento_adjuntar ON siget.documento FOR INSERT TO app_role
  WITH CHECK (subido_por = siget.ctx_usuario()
              AND EXISTS (SELECT 1 FROM siget.tramite t WHERE t.id = documento.tramite_id AND t.solicitante_id = siget.ctx_usuario()));

COMMIT;
