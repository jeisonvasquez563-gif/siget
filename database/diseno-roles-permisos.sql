-- ============================================================================
-- SIGET: diseno de roles, permisos y aislamiento a nivel de base de datos
-- ============================================================================
-- ESTADO: APLICADO el 15-oct-2026 en la base tramites_demo de VM2 (esquema siget,
-- roles siget_owner, app_role y auditor_role). Se verifica con
-- database/diseno-pruebas.sql, cuyos datos de prueba se revierten (ROLLBACK).
-- Para una base nueva este archivo es el script de arranque (lo corre una vez
-- el superusuario, que despues deja de usarse). Ver docs/superpowers/specs/2026-10-08-arquitectura-zero-trust-design.md
--
-- ZERO TRUST: ninguna pieza del sistema opera como superusuario.
--   * postgres (superusuario) solo ejecuta el arranque inicial (seccion 1) y
--     despues NO se usa: ni la aplicacion, ni las migraciones, ni los respaldos.
--   * siget_owner es duenio de los objetos y solo corre migraciones.
--   * app_role (Django) y auditor_role: sin superusuario ni BYPASSRLS.
--
-- Dos capas de roles:
--   1) Roles de PostgreSQL (este archivo): siget_owner, app_role y auditor_role.
--   2) Roles de aplicacion (ciudadano, funcionario, supervisor, coordinador
--      institucional, 5 roles de operacion de plataforma, auditor): viven como DATOS en
--      usuario / membresia y los evalua el PDP de Django (ABAC).
-- Row Level Security es la segunda barrera, independiente del PDP.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Arranque inicial (lo ejecuta una sola vez el superusuario, luego se deja de usar)
-- ---------------------------------------------------------------------------
-- Los tres roles se crean SIN privilegios especiales. En produccion app_role
-- tendra LOGIN y su contrasena saldra de podman secret.
CREATE ROLE siget_owner  NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB;  -- duenio; solo migraciones
CREATE ROLE app_role     NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB;  -- lo usa Django
CREATE ROLE auditor_role NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB;  -- solo lectura de auditoria

CREATE SCHEMA siget AUTHORIZATION siget_owner;

-- Desde aqui todo lo crea siget_owner: el superusuario no es duenio de nada.
SET LOCAL ROLE siget_owner;

-- ---------------------------------------------------------------------------
-- 2. Tipos
-- ---------------------------------------------------------------------------
CREATE TYPE siget.rol_membresia  AS ENUM ('ciudadano', 'funcionario', 'supervisor', 'coordinador_institucional');
CREATE TYPE siget.rol_plataforma AS ENUM ('ninguno', 'operador_infraestructura', 'operador_identidades', 'operador_catalogo', 'operador_seguridad', 'custodio_secretos', 'auditor');
CREATE TYPE siget.estado_tramite AS ENUM ('Pendiente', 'En Tramitacion', 'En Subsanacion', 'Aprobado', 'Rechazado');

-- ---------------------------------------------------------------------------
-- 3. Modulos (tablas)
-- ---------------------------------------------------------------------------
-- Modulo instituciones
CREATE TABLE siget.institucion (
  id      serial PRIMARY KEY,
  nombre  text NOT NULL UNIQUE,
  tipo    text NOT NULL CHECK (tipo IN ('real', 'demostracion'))
);

-- Modulo identidad: atributos del sujeto (ABAC)
CREATE TABLE siget.usuario (
  id                   serial PRIMARY KEY,
  username             text NOT NULL UNIQUE,
  password_hash        text NOT NULL,
  nivel_aseguramiento  smallint NOT NULL DEFAULT 1 CHECK (nivel_aseguramiento BETWEEN 1 AND 3),
  estado_cuenta        text NOT NULL DEFAULT 'activa' CHECK (estado_cuenta IN ('activa', 'bloqueada', 'suspendida')),
  rol_plataforma       siget.rol_plataforma NOT NULL DEFAULT 'ninguno',
  mfa_verificado_en    timestamptz,
  creado_en            timestamptz NOT NULL DEFAULT now()
);

-- Modulo permisos: (usuario, institucion, rol). Nadie se asigna a si mismo.
CREATE TABLE siget.membresia (
  usuario_id      int NOT NULL REFERENCES siget.usuario(id),
  institucion_id  int NOT NULL REFERENCES siget.institucion(id),
  rol             siget.rol_membresia NOT NULL,
  asignado_por    int NOT NULL REFERENCES siget.usuario(id),
  creado_en       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (usuario_id, institucion_id, rol),
  CONSTRAINT membresia_no_autoasignada CHECK (asignado_por <> usuario_id)
);

-- Modulo catalogo de tramites (mismo motor generico para todas las instituciones)
CREATE TABLE siget.tipo_tramite (
  id              serial PRIMARY KEY,
  institucion_id  int NOT NULL REFERENCES siget.institucion(id),
  nombre          text NOT NULL,
  sla_dias        int NOT NULL CHECK (sla_dias > 0),
  UNIQUE (institucion_id, nombre),
  UNIQUE (id, institucion_id)
);

-- Modulo tramites: la institucion del tramite debe coincidir con la de su tipo
CREATE TABLE siget.tramite (
  id                       bigserial PRIMARY KEY,
  tipo_tramite_id          int NOT NULL,
  institucion_id           int NOT NULL,
  solicitante_id           int NOT NULL REFERENCES siget.usuario(id),
  funcionario_asignado_id  int REFERENCES siget.usuario(id),
  estado                   siget.estado_tramite NOT NULL DEFAULT 'Pendiente',
  sensibilidad             smallint NOT NULL DEFAULT 1 CHECK (sensibilidad BETWEEN 1 AND 3),
  fecha_limite             timestamptz,
  creado_en                timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tipo_tramite_id, institucion_id) REFERENCES siget.tipo_tramite (id, institucion_id)
);

-- Maquina de estados: solo estas transiciones son validas
CREATE TABLE siget.transicion (
  desde  siget.estado_tramite NOT NULL,
  hasta  siget.estado_tramite NOT NULL,
  PRIMARY KEY (desde, hasta)
);
INSERT INTO siget.transicion VALUES
  ('Pendiente', 'En Tramitacion'),
  ('En Tramitacion', 'En Subsanacion'),
  ('En Tramitacion', 'Aprobado'),
  ('En Tramitacion', 'Rechazado'),
  ('En Subsanacion', 'En Tramitacion');

-- Modulo auditoria: de solo insercion
CREATE TABLE siget.evento_auditoria (
  id               bigserial PRIMARY KEY,
  tramite_id       bigint NOT NULL REFERENCES siget.tramite(id),
  institucion_id   int NOT NULL,
  actor_id         int,
  accion           text NOT NULL,
  estado_anterior  siget.estado_tramite,
  estado_nuevo     siget.estado_tramite,
  atributos        jsonb NOT NULL DEFAULT '{}'::jsonb,
  creado_en        timestamptz NOT NULL DEFAULT now()
);

-- Modulo decisiones del PDP: permitidas y negadas
CREATE TABLE siget.decision_pdp (
  id         bigserial PRIMARY KEY,
  actor_id   int,
  accion     text NOT NULL,
  recurso    text,
  permitido  boolean NOT NULL,
  politica   text,
  atributos  jsonb NOT NULL DEFAULT '{}'::jsonb,
  creado_en  timestamptz NOT NULL DEFAULT now()
);

-- Modulo control dual: una aprobacion no la puede proponer y aprobar la misma persona
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

-- ---------------------------------------------------------------------------
-- 4. Funciones del contexto de sesion (las fija Django en cada transaccion)
--    app.usuario_id = id del sujeto; app.instituciones = '1,3' (sus membresias)
-- ---------------------------------------------------------------------------
CREATE FUNCTION siget.ctx_usuario() RETURNS int LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('app.usuario_id', true), '')::int $$;

CREATE FUNCTION siget.ctx_instituciones() RETURNS int[] LANGUAGE sql STABLE AS
  $$ SELECT coalesce(string_to_array(nullif(current_setting('app.instituciones', true), ''), ',')::int[], '{}'::int[]) $$;

-- ---------------------------------------------------------------------------
-- 5. Triggers de integridad (segunda defensa; los permisos son la primera)
-- ---------------------------------------------------------------------------
CREATE FUNCTION siget.bloquear_modificacion() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'La tabla % es de solo insercion: % no permitido', TG_TABLE_NAME, TG_OP;
END $$;

CREATE TRIGGER auditoria_inmutable BEFORE UPDATE OR DELETE ON siget.evento_auditoria
  FOR EACH ROW EXECUTE FUNCTION siget.bloquear_modificacion();
CREATE TRIGGER auditoria_sin_truncate BEFORE TRUNCATE ON siget.evento_auditoria
  FOR EACH STATEMENT EXECUTE FUNCTION siget.bloquear_modificacion();
CREATE TRIGGER decision_inmutable BEFORE UPDATE OR DELETE ON siget.decision_pdp
  FOR EACH ROW EXECUTE FUNCTION siget.bloquear_modificacion();

CREATE FUNCTION siget.validar_transicion() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.estado <> OLD.estado
     AND NOT EXISTS (SELECT 1 FROM siget.transicion t WHERE t.desde = OLD.estado AND t.hasta = NEW.estado) THEN
    RAISE EXCEPTION 'Transicion no permitida: % -> %', OLD.estado, NEW.estado;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER tramite_valida_transicion BEFORE UPDATE OF estado ON siget.tramite
  FOR EACH ROW EXECUTE FUNCTION siget.validar_transicion();

-- El evento se escribe en la MISMA transaccion que el cambio de estado.
-- SECURITY DEFINER: el evento se registra aunque quien actua no tenga INSERT directo.
CREATE FUNCTION siget.registrar_cambio_estado() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = siget, pg_temp AS $$
BEGIN
  IF NEW.estado <> OLD.estado THEN
    INSERT INTO siget.evento_auditoria (tramite_id, institucion_id, actor_id, accion, estado_anterior, estado_nuevo)
    VALUES (NEW.id, NEW.institucion_id, siget.ctx_usuario(), 'cambio_estado', OLD.estado, NEW.estado);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER tramite_audita_estado AFTER UPDATE OF estado ON siget.tramite
  FOR EACH ROW EXECUTE FUNCTION siget.registrar_cambio_estado();

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

-- ---------------------------------------------------------------------------
-- 6. Permisos (minimo privilegio, denegar por defecto)
-- ---------------------------------------------------------------------------
REVOKE ALL ON SCHEMA siget FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA siget FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA siget FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA siget FROM PUBLIC;

GRANT USAGE ON SCHEMA siget TO app_role, auditor_role;
GRANT EXECUTE ON FUNCTION siget.ctx_usuario(), siget.ctx_instituciones() TO app_role, auditor_role;

-- app_role: lo que Django necesita y nada mas
GRANT SELECT, INSERT ON siget.institucion, siget.tipo_tramite, siget.membresia TO app_role;
GRANT SELECT, INSERT ON siget.usuario TO app_role;
GRANT UPDATE (password_hash, nivel_aseguramiento, estado_cuenta, mfa_verificado_en) ON siget.usuario TO app_role;
GRANT SELECT, INSERT ON siget.tramite TO app_role;
GRANT UPDATE (estado, funcionario_asignado_id) ON siget.tramite TO app_role;
GRANT SELECT ON siget.transicion TO app_role;
GRANT SELECT, INSERT ON siget.evento_auditoria, siget.decision_pdp TO app_role;   -- sin UPDATE ni DELETE
GRANT USAGE ON ALL SEQUENCES IN SCHEMA siget TO app_role;

-- auditor_role: solo lectura de auditoria y decisiones
GRANT SELECT ON siget.evento_auditoria, siget.decision_pdp, siget.aprobacion TO auditor_role;
GRANT SELECT, INSERT ON siget.aprobacion TO app_role;
GRANT UPDATE (aprobado_por, estado, resuelto_en) ON siget.aprobacion TO app_role;

-- ---------------------------------------------------------------------------
-- 7. Row Level Security: aislamiento entre instituciones
-- ---------------------------------------------------------------------------
ALTER TABLE siget.tramite ENABLE ROW LEVEL SECURITY;

-- Ve un tramite: su solicitante, o quien tiene membresia en su institucion.
CREATE POLICY tramite_ver ON siget.tramite FOR SELECT TO app_role
  USING (solicitante_id = siget.ctx_usuario() OR institucion_id = ANY (siget.ctx_instituciones()));
-- Crea un tramite solo a su nombre.
CREATE POLICY tramite_crear ON siget.tramite FOR INSERT TO app_role
  WITH CHECK (solicitante_id = siget.ctx_usuario());
-- Modifica un tramite solo dentro de sus instituciones.
CREATE POLICY tramite_cambiar ON siget.tramite FOR UPDATE TO app_role
  USING (institucion_id = ANY (siget.ctx_instituciones()))
  WITH CHECK (institucion_id = ANY (siget.ctx_instituciones()));

ALTER TABLE siget.evento_auditoria ENABLE ROW LEVEL SECURITY;
CREATE POLICY evento_ver_institucion ON siget.evento_auditoria FOR SELECT TO app_role
  USING (institucion_id = ANY (siget.ctx_instituciones()));
CREATE POLICY evento_insertar ON siget.evento_auditoria FOR INSERT TO app_role
  WITH CHECK (true);
CREATE POLICY evento_ver_auditor ON siget.evento_auditoria FOR SELECT TO auditor_role
  USING (true);

RESET ROLE;
