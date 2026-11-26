-- ============================================================================
-- Migracion 002: dividir el rol de plataforma en cinco roles por funcion
-- ============================================================================
-- Motivo: un unico "operador de plataforma" seria un rol todopoderoso, contrario
-- a Zero Trust (separacion de funciones). Se divide por funcion:
--   operador_infraestructura  servidores, contenedores, despliegues y parches
--   operador_identidades      altas de coordinadores y restablecer segundo factor
--   operador_catalogo         alta de instituciones y tipos de tramite base
--   operador_seguridad        responder a incidentes: bloquear cuentas, revocar sesiones
--   custodio_secretos         rotar contrasenas, claves y certificados
-- Ninguno puede leer tramites ni modificar la auditoria. El auditor sigue aparte.
--
-- Reglas que se imponen en la base:
--   1) Una persona, un solo rol de plataforma (columna unica usuario.rol_plataforma)
--      y quien tiene un rol de plataforma no puede tener membresias, ni al reves.
--   2) Control dual: una aprobacion no puede ser propuesta y aprobada por la misma persona.
--
-- Se ejecuta como siget_owner (duenio de los objetos), no como superusuario.
-- Los valores nuevos de una enumeracion no se pueden usar en la misma transaccion
-- que los crea: esta migracion no los usa.
-- ============================================================================

SET LOCAL ROLE siget_owner;

ALTER TYPE siget.rol_plataforma RENAME VALUE 'operador_plataforma' TO 'operador_infraestructura';
ALTER TYPE siget.rol_plataforma ADD VALUE IF NOT EXISTS 'operador_identidades';
ALTER TYPE siget.rol_plataforma ADD VALUE IF NOT EXISTS 'operador_catalogo';
ALTER TYPE siget.rol_plataforma ADD VALUE IF NOT EXISTS 'operador_seguridad';
ALTER TYPE siget.rol_plataforma ADD VALUE IF NOT EXISTS 'custodio_secretos';

-- Control dual
CREATE TABLE siget.aprobacion (
  id             bigserial PRIMARY KEY,
  accion         text NOT NULL CHECK (accion IN ('alta_institucion', 'alta_coordinador')),
  objetivo       text NOT NULL,
  propuesto_por  int NOT NULL REFERENCES siget.usuario(id),
  aprobado_por   int REFERENCES siget.usuario(id),
  estado         text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'aprobada', 'rechazada')),
  creado_en      timestamptz NOT NULL DEFAULT now(),
  resuelto_en    timestamptz,
  CONSTRAINT aprobacion_control_dual CHECK (aprobado_por IS NULL OR aprobado_por <> propuesto_por),
  CONSTRAINT aprobacion_estado_coherente CHECK (
    (estado = 'pendiente' AND aprobado_por IS NULL) OR (estado <> 'pendiente' AND aprobado_por IS NOT NULL))
);

GRANT SELECT, INSERT ON siget.aprobacion TO app_role;
GRANT UPDATE (aprobado_por, estado, resuelto_en) ON siget.aprobacion TO app_role;
GRANT USAGE ON SEQUENCE siget.aprobacion_id_seq TO app_role;
GRANT SELECT ON siget.aprobacion TO auditor_role;

-- Quien tiene rol de plataforma no tiene membresias de institucion, ni al reves
CREATE FUNCTION siget.membresia_sin_rol_plataforma() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = siget, pg_temp AS $$
BEGIN
  IF (SELECT rol_plataforma FROM siget.usuario WHERE id = NEW.usuario_id) <> 'ninguno' THEN
    RAISE EXCEPTION 'El usuario % tiene un rol de plataforma: no puede tener membresias de institucion', NEW.usuario_id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER membresia_valida_rol_plataforma BEFORE INSERT ON siget.membresia
  FOR EACH ROW EXECUTE FUNCTION siget.membresia_sin_rol_plataforma();

CREATE FUNCTION siget.rol_plataforma_sin_membresia() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = siget, pg_temp AS $$
BEGIN
  IF NEW.rol_plataforma <> 'ninguno' AND EXISTS (SELECT 1 FROM siget.membresia WHERE usuario_id = NEW.id) THEN
    RAISE EXCEPTION 'El usuario % tiene membresias de institucion: no puede tener un rol de plataforma', NEW.id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER usuario_valida_membresias BEFORE UPDATE OF rol_plataforma ON siget.usuario
  FOR EACH ROW EXECUTE FUNCTION siget.rol_plataforma_sin_membresia();

RESET ROLE;
