-- ============================================================================
-- Migracion 016: derechos sobre los datos personales y aviso de privacidad (PT-15, Ley 81 de 2019)
-- ============================================================================
-- Se ejecuta como siget_owner (duenio de los objetos), no como superusuario.
--
-- * perfil: la persona puede corregir SOLO su correo, su provincia y su ciudad (GRANT UPDATE por columna). Nombre, apellidos,
--   cedula y fecha de nacimiento NO se corrigen solos: van por una solicitud de rectificacion que atiende el operador de
--   identidades. Siguen sin UPDATE de otras columnas ni DELETE para nadie (un trigger sella `actualizado_en` al corregir y otro
--   lo deja en NULL y fecha la constancia del aviso al insertar: ninguna fecha depende de lo que mande la aplicacion).
-- * perfil.aviso_version y perfil.aviso_leido_en: constancia de que la persona leyo el aviso de privacidad al registrarse
--   (Ley 81, art. 8: la Administracion no necesita autorizacion para los datos que usa en sus funciones, pero SI debe informar).
--   Los perfiles anteriores a esta migracion quedan en NULL: no se inventa una lectura que no ocurrio.
-- * solicitud_derecho: rectificacion, cancelacion u oposicion pedidas por la persona. La respuesta debe darse en no mas de 10
--   dias habiles y es gratuita (`vence_en` lo calcula el backend). NO se borra nada automaticamente: los tramites son expediente
--   publico con conservacion obligatoria; el operador explica en la respuesta que se puede borrar y que no.
--   Proteccion coherente con restablecimiento (010): solo app_role, con grants minimos (inserta, lee y actualiza solo las
--   columnas de la respuesta, sin DELETE) y triggers: al insertar nace SIEMPRE «recibida», sin respuesta y con un plazo dentro de
--   lo razonable; al responder solo responde un operador de identidades (nunca la propia persona) y la hora la fija la base.
--   Ni el auditor ni pgadmin_lectura leen el detalle (puede contener datos personales).
--   Riesgo aceptado: no hay seguridad por filas (RLS) en perfil ni solicitud_derecho; la defensa en profundidad queda pendiente
--   por si app_role tuviera un fallo (ver runbook, seccion 39).
-- ============================================================================
BEGIN;
SET LOCAL ROLE siget_owner;

-- ---------------------------------------------------------------------------
-- 1. perfil: correccion de contacto y constancia del aviso
-- ---------------------------------------------------------------------------
ALTER TABLE siget.perfil
  ADD COLUMN actualizado_en   timestamptz,
  ADD COLUMN aviso_version    text CHECK (aviso_version IS NULL OR char_length(aviso_version) BETWEEN 1 AND 20),
  ADD COLUMN aviso_leido_en   timestamptz,
  ADD CONSTRAINT perfil_aviso_coherente CHECK ((aviso_version IS NULL) = (aviso_leido_en IS NULL));

CREATE FUNCTION siget.perfil_sellar_actualizacion() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.actualizado_en := now();
  RETURN NEW;
END $$;
CREATE TRIGGER perfil_sella_actualizacion BEFORE UPDATE ON siget.perfil
  FOR EACH ROW EXECUTE FUNCTION siget.perfil_sellar_actualizacion();

-- Al insertar: sin fecha de actualizacion y la constancia del aviso se fecha con la hora de la base (no se puede fechar hacia atras)
CREATE FUNCTION siget.perfil_sellar_alta() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.actualizado_en := NULL;
  IF NEW.aviso_version IS NOT NULL THEN
    NEW.aviso_leido_en := now();
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER perfil_sella_alta BEFORE INSERT ON siget.perfil
  FOR EACH ROW EXECUTE FUNCTION siget.perfil_sellar_alta();

-- Solo estas tres columnas; todo lo demas del perfil sigue sin UPDATE
GRANT UPDATE (correo, provincia, ciudad) ON siget.perfil TO app_role;

-- ---------------------------------------------------------------------------
-- 2. solicitud_derecho
-- ---------------------------------------------------------------------------
CREATE TABLE siget.solicitud_derecho (
  id             bigserial PRIMARY KEY,
  usuario_id     int NOT NULL REFERENCES siget.usuario(id),
  tipo           text NOT NULL CHECK (tipo IN ('rectificacion', 'cancelacion', 'oposicion')),
  detalle        text NOT NULL CHECK (char_length(detalle) BETWEEN 10 AND 1000),
  estado         text NOT NULL DEFAULT 'recibida' CHECK (estado IN ('recibida', 'atendida', 'rechazada')),
  creada_en      timestamptz NOT NULL DEFAULT now(),
  vence_en       timestamptz NOT NULL,
  respondida_en  timestamptz,
  respondida_por int REFERENCES siget.usuario(id),
  respuesta      text CHECK (respuesta IS NULL OR char_length(respuesta) BETWEEN 10 AND 2000),
  CONSTRAINT solicitud_derecho_vence_despues CHECK (vence_en > creada_en),
  -- Recibida: sin respuesta. Atendida o rechazada: con quien respondio, cuando y que respondio
  CONSTRAINT solicitud_derecho_respuesta_coherente CHECK (
    (estado = 'recibida' AND respondida_en IS NULL AND respondida_por IS NULL AND respuesta IS NULL)
    OR (estado <> 'recibida' AND respondida_en IS NOT NULL AND respondida_por IS NOT NULL AND respuesta IS NOT NULL)),
  -- Nadie responde su propia solicitud
  CONSTRAINT solicitud_derecho_no_a_si_mismo CHECK (respondida_por IS NULL OR respondida_por <> usuario_id)
);
CREATE INDEX solicitud_derecho_usuario_idx ON siget.solicitud_derecho (usuario_id);
CREATE INDEX solicitud_derecho_abiertas_idx ON siget.solicitud_derecho (vence_en) WHERE estado = 'recibida';

-- Al nacer: siempre «recibida» y sin respuesta, con la hora de la base y un plazo razonable. 10 dias habiles con los feriados de
-- Panama nunca bajan de 14 dias corridos ni pasan de unos 20: se acepta entre 10 y 30 (margen).
CREATE FUNCTION siget.solicitud_derecho_validar_alta() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.estado := 'recibida';
  NEW.respondida_en := NULL;
  NEW.respondida_por := NULL;
  NEW.respuesta := NULL;
  NEW.creada_en := now();
  IF NEW.vence_en IS NULL OR NEW.vence_en < now() + interval '10 days' OR NEW.vence_en > now() + interval '30 days' THEN
    RAISE EXCEPTION 'El plazo de respuesta debe vencer entre 10 y 30 dias desde ahora';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER solicitud_derecho_valida_alta BEFORE INSERT ON siget.solicitud_derecho
  FOR EACH ROW EXECUTE FUNCTION siget.solicitud_derecho_validar_alta();

-- Una solicitud respondida no se toca; para responder hacen falta quien responde (un operador de identidades) y la respuesta.
-- SECURITY DEFINER: consulta el rol de quien responde sin depender de los grants de app_role sobre usuario
CREATE FUNCTION siget.solicitud_derecho_validar_respuesta() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = siget, pg_temp AS $$
BEGIN
  IF OLD.estado <> 'recibida' THEN
    RAISE EXCEPTION 'La solicitud % ya fue respondida: no se modifica', OLD.id;
  END IF;
  IF NEW.estado <> 'recibida' THEN
    IF NEW.respondida_por IS NULL OR NEW.respuesta IS NULL OR btrim(NEW.respuesta) = '' THEN
      RAISE EXCEPTION 'Una respuesta necesita quien responde y el texto de la respuesta';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM siget.usuario WHERE id = NEW.respondida_por AND rol_plataforma = 'operador_identidades') THEN
      RAISE EXCEPTION 'Solo un operador de identidades responde una solicitud';
    END IF;
    NEW.respondida_en := now();  -- la hora de la respuesta la fija la base
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER solicitud_derecho_valida_respuesta BEFORE UPDATE ON siget.solicitud_derecho
  FOR EACH ROW EXECUTE FUNCTION siget.solicitud_derecho_validar_respuesta();

REVOKE ALL ON siget.solicitud_derecho FROM PUBLIC;
GRANT SELECT, INSERT ON siget.solicitud_derecho TO app_role;
-- respondida_en no se concede: la fija el trigger
GRANT UPDATE (estado, respondida_por, respuesta) ON siget.solicitud_derecho TO app_role;
GRANT USAGE ON SEQUENCE siget.solicitud_derecho_id_seq TO app_role;
-- pgadmin_lectura (009), el auditor, el checkpoint y el escalador solo leen lo que se les concede tabla por tabla, asi que nada se les concedio sobre esta;
-- el REVOKE es explicito para dejar constancia: el detalle es un dato personal que ninguno debe leer
REVOKE ALL ON siget.solicitud_derecho FROM pgadmin_lectura, auditor_role, checkpoint_app, escalador_role;

COMMIT;
