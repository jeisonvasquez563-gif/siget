-- ============================================================================
-- Migracion 020: gestion del catalogo de tramites por la coordinacion de cada institucion
-- ============================================================================
-- Se ejecuta como siget_owner (duenio de los objetos), no como superusuario.
--
-- * tipo_tramite.activo: un tipo desactivado no se ofrece para tramites NUEVOS (la API no lo lista y, como segunda barrera, un
--   disparador BEFORE INSERT sobre tramite lo rechaza). Los tramites que ya existen siguen su curso. No se borra nunca un tipo.
-- * app_role puede actualizar SOLO nombre, sla_dias, audiencia, formulario y activo (UPDATE por columna): nunca id ni institucion_id.
--   Sin DELETE.
-- * Disparador BEFORE INSERT OR UPDATE sobre tipo_tramite (siget.tipo_tramite_valida, SECURITY DEFINER, ruta de busqueda fija):
--     - id e institucion_id no cambian jamas (tampoco para el duenio).
--     - CON contexto de usuario (siget.ctx_usuario() no nulo, es decir, una peticion de la API): exige que esa persona sea
--       coordinador_institucional con membresia VIGENTE (revocada_en IS NULL) en NEW.institucion_id y cuenta activa. Es la segunda
--       defensa; la primera es el PDP (GESTIONAR_CATALOGO_INSTITUCION, con segundo factor reciente).
--     - SIN contexto (esta migracion, el duenio, el mantenimiento): deja pasar. Es el mismo criterio que tienen los demas disparadores
--       del esquema (el contexto lo fija Django solo despues de autenticar; sin el no hay persona a quien pedirle un rol) y lo que
--       necesitan los datos de arranque (005, 012) y las pruebas de integracion, que preparan catalogo antes de fijar contexto.
--       El ALTA DE UNA INSTITUCION (consola del operador de catalogo, control dual) solo inserta en siget.institucion: NO inserta tipos
--       de tramite, asi que no pasa por este disparador y no se rompe. Si algun dia el alta sembrara tipos, debe hacerlo con una funcion
--       SECURITY DEFINER del duenio (ahi current_user es el duenio y no hay contexto de la coordinacion).
--       Riesgo residual conocido: app_role sin contexto tampoco es detenido por este disparador (la API siempre fija el contexto antes
--       de tocar el catalogo, y los permisos de columna ya acotan lo que puede escribir).
--     - Valida la estructura del formulario SOLO cuando se crea el tipo o cambia el formulario (lo anterior no se revalida: un tipo
--       viejo se puede renombrar aunque su formulario no cumpla las reglas nuevas): lista de hasta 30 objetos; cada uno con id
--       ^[a-z][a-z0-9_]{0,39}$ unico, etiqueta de 1 a 120 caracteres, tipo de la lista (texto, texto_largo, numero, fecha, seleccion),
--       obligatorio booleano si viene; y los de tipo seleccion con opciones: lista de 1 a 30 textos. (La validacion completa, con
--       mensajes por campo, esta en el backend: apps/tramites/formulario.py y apps/catalogo/gestion.py; esto es la red de seguridad.)
-- * CHECK: sla_dias entre 1 y 365 y nombre de 3 a 150 caracteres (sin contar los espacios de los bordes).
-- * siget.catalogo_cambio: registro INALTERABLE de cada alta y cambio de un tipo (quien, cuando, que cambio: solo las columnas que
--   cambiaron en antes y despues; en el alta, la foto completa en despues). Lo escribe SOLO un disparador AFTER INSERT OR UPDATE
--   (SECURITY DEFINER): app_role no inserta. Un disparador impide UPDATE, DELETE y TRUNCATE aun para el duenio (como la 019).
--   Seguridad por filas: app_role ve solo las filas de instituciones donde la persona del contexto es coordinadora vigente;
--   auditor_role lee todo (como el resto de la auditoria). Nada para pgadmin_lectura, escalador_role, detector_role ni checkpoint_app.
-- * Compatibilidad: el backend anterior no conoce `activo` ni la tabla nueva; la columna tiene valor por defecto y el disparador de
--   tramite solo actua sobre tipos desactivados (ninguno hasta que alguien use la interfaz nueva). Se puede migrar la base antes de
--   desplegar el codigo nuevo.
-- ============================================================================
BEGIN;
SET LOCAL ROLE siget_owner;

-- ---------------------------------------------------------------------------
-- 1. Columna y reglas de la tabla
-- ---------------------------------------------------------------------------
ALTER TABLE siget.tipo_tramite ADD COLUMN activo boolean NOT NULL DEFAULT true;
ALTER TABLE siget.tipo_tramite
  ADD CONSTRAINT tipo_tramite_sla_rango CHECK (sla_dias BETWEEN 1 AND 365),
  ADD CONSTRAINT tipo_tramite_nombre_largo CHECK (char_length(btrim(nombre)) BETWEEN 3 AND 150);

GRANT UPDATE (nombre, sla_dias, audiencia, formulario, activo) ON siget.tipo_tramite TO app_role;

-- ---------------------------------------------------------------------------
-- 2. Auxiliares
-- ---------------------------------------------------------------------------
-- ¿Es coordinacion vigente de esa institucion, con la cuenta activa? SECURITY DEFINER: la usan el disparador y la seguridad por filas
CREATE FUNCTION siget.es_coordinador_vigente(p_usuario int, p_institucion int) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = siget, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM siget.membresia m JOIN siget.usuario u ON u.id = m.usuario_id
                  WHERE m.usuario_id = p_usuario AND m.institucion_id = p_institucion AND m.rol = 'coordinador_institucional'
                    AND m.revocada_en IS NULL AND u.estado_cuenta = 'activa')
$$;
REVOKE ALL ON FUNCTION siget.es_coordinador_vigente(int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION siget.es_coordinador_vigente(int, int) TO app_role;

-- Devuelve el primer problema estructural del formulario, o NULL si esta bien
CREATE FUNCTION siget.formulario_invalido(p jsonb) RETURNS text LANGUAGE plpgsql IMMUTABLE
  SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_campo jsonb;
  v_i     int := 0;
  v_ids   text[] := '{}';
  v_id    text;
  v_ops   jsonb;
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'array' THEN
    RETURN 'el formulario debe ser una lista';
  END IF;
  IF jsonb_array_length(p) > 30 THEN
    RETURN 'el formulario admite hasta 30 campos';
  END IF;
  FOR v_campo IN SELECT value FROM jsonb_array_elements(p) LOOP
    v_i := v_i + 1;
    IF jsonb_typeof(v_campo) <> 'object' THEN
      RETURN format('campo %s: debe ser un objeto', v_i);
    END IF;
    v_id := v_campo ->> 'id';
    IF jsonb_typeof(v_campo -> 'id') IS DISTINCT FROM 'string' OR v_id !~ '^[a-z][a-z0-9_]{0,39}$' THEN
      RETURN format('campo %s: id invalido', v_i);
    END IF;
    IF v_id = ANY (v_ids) THEN
      RETURN format('campo %s: id repetido (%s)', v_i, v_id);
    END IF;
    v_ids := v_ids || v_id;
    IF jsonb_typeof(v_campo -> 'etiqueta') IS DISTINCT FROM 'string'
       OR char_length(btrim(v_campo ->> 'etiqueta')) < 1 OR char_length(v_campo ->> 'etiqueta') > 120 THEN
      RETURN format('campo %s: la etiqueta debe tener de 1 a 120 caracteres', v_i);
    END IF;
    IF jsonb_typeof(v_campo -> 'tipo') IS DISTINCT FROM 'string'
       OR (v_campo ->> 'tipo') NOT IN ('texto', 'texto_largo', 'numero', 'fecha', 'seleccion') THEN
      RETURN format('campo %s: tipo desconocido', v_i);
    END IF;
    IF v_campo ? 'obligatorio' AND jsonb_typeof(v_campo -> 'obligatorio') <> 'boolean' THEN
      RETURN format('campo %s: obligatorio debe ser verdadero o falso', v_i);
    END IF;
    IF v_campo ->> 'tipo' = 'seleccion' THEN
      v_ops := v_campo -> 'opciones';
      IF jsonb_typeof(v_ops) IS DISTINCT FROM 'array' OR jsonb_array_length(v_ops) NOT BETWEEN 1 AND 30 THEN
        RETURN format('campo %s: las opciones deben ser una lista de 1 a 30 textos', v_i);
      END IF;
      IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_ops) o WHERE jsonb_typeof(o) <> 'string') THEN
        RETURN format('campo %s: las opciones deben ser textos', v_i);
      END IF;
    END IF;
  END LOOP;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION siget.formulario_invalido(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION siget.formulario_invalido(jsonb) TO app_role;

-- ---------------------------------------------------------------------------
-- 3. Disparador de validacion sobre tipo_tramite
-- ---------------------------------------------------------------------------
CREATE FUNCTION siget.tipo_tramite_valida() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = siget, pg_temp AS $$
DECLARE
  v_actor    int := siget.ctx_usuario();
  v_problema text;
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.id IS DISTINCT FROM OLD.id OR NEW.institucion_id IS DISTINCT FROM OLD.institucion_id) THEN
    RAISE EXCEPTION 'Catalogo: el id y la institucion de un tramite no se cambian';
  END IF;
  -- Con contexto de usuario (una peticion de la API): solo la coordinacion vigente de ESA institucion. Sin contexto: ver el encabezado
  IF v_actor IS NOT NULL AND NOT siget.es_coordinador_vigente(v_actor, NEW.institucion_id) THEN
    RAISE EXCEPTION 'Catalogo: solo la coordinacion vigente de la institucion gestiona su catalogo' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' OR NEW.formulario IS DISTINCT FROM OLD.formulario THEN
    v_problema := siget.formulario_invalido(NEW.formulario);
    IF v_problema IS NOT NULL THEN
      RAISE EXCEPTION 'Catalogo: formulario invalido: %', v_problema;
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION siget.tipo_tramite_valida() FROM PUBLIC;
CREATE TRIGGER tipo_tramite_valida BEFORE INSERT OR UPDATE ON siget.tipo_tramite
  FOR EACH ROW EXECUTE FUNCTION siget.tipo_tramite_valida();

-- ---------------------------------------------------------------------------
-- 4. Un tipo desactivado no admite tramites nuevos
-- ---------------------------------------------------------------------------
CREATE FUNCTION siget.tramite_valida_tipo_activo() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = siget, pg_temp AS $$
DECLARE
  v_activo boolean;
BEGIN
  SELECT activo INTO v_activo FROM siget.tipo_tramite WHERE id = NEW.tipo_tramite_id;
  IF FOUND AND NOT v_activo THEN
    RAISE EXCEPTION 'Este tramite ya no se ofrece: su tipo esta desactivado';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION siget.tramite_valida_tipo_activo() FROM PUBLIC;
CREATE TRIGGER tramite_valida_tipo_activo BEFORE INSERT ON siget.tramite
  FOR EACH ROW EXECUTE FUNCTION siget.tramite_valida_tipo_activo();

-- ---------------------------------------------------------------------------
-- 5. El registro de cambios del catalogo
-- ---------------------------------------------------------------------------
CREATE TABLE siget.catalogo_cambio (
  id               bigserial PRIMARY KEY,
  tipo_tramite_id  int NOT NULL REFERENCES siget.tipo_tramite(id),
  institucion_id   int NOT NULL REFERENCES siget.institucion(id),
  actor_id         int REFERENCES siget.usuario(id),   -- NULL: cambio sin sesion (mantenimiento o migracion)
  accion           text NOT NULL CHECK (accion IN ('alta', 'cambio', 'activado', 'desactivado')),
  antes            jsonb,
  despues          jsonb,
  creado_en        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX catalogo_cambio_institucion_idx ON siget.catalogo_cambio (institucion_id, id DESC);
CREATE INDEX catalogo_cambio_tipo_idx ON siget.catalogo_cambio (tipo_tramite_id);  -- la clave foranea
CREATE INDEX catalogo_cambio_actor_idx ON siget.catalogo_cambio (actor_id);        -- la clave foranea

CREATE TRIGGER catalogo_cambio_inalterable BEFORE UPDATE OR DELETE ON siget.catalogo_cambio
  FOR EACH ROW EXECUTE FUNCTION siget.bloquear_modificacion();
CREATE TRIGGER catalogo_cambio_sin_truncate BEFORE TRUNCATE ON siget.catalogo_cambio
  FOR EACH STATEMENT EXECUTE FUNCTION siget.bloquear_modificacion();

-- Lo escribe la base en la misma transaccion del cambio (si se revierte, el registro tambien). Corre como el duenio de la tabla
CREATE FUNCTION siget.tipo_tramite_registra() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = siget, pg_temp AS $$
DECLARE
  v_antes   jsonb := '{}'::jsonb;
  v_despues jsonb := '{}'::jsonb;
  v_accion  text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO siget.catalogo_cambio (tipo_tramite_id, institucion_id, actor_id, accion, antes, despues)
    VALUES (NEW.id, NEW.institucion_id, siget.ctx_usuario(), 'alta', NULL,
            jsonb_build_object('nombre', NEW.nombre, 'sla_dias', NEW.sla_dias, 'audiencia', NEW.audiencia, 'formulario', NEW.formulario, 'activo', NEW.activo));
    RETURN NULL;
  END IF;
  IF NEW.nombre IS DISTINCT FROM OLD.nombre THEN
    v_antes := v_antes || jsonb_build_object('nombre', OLD.nombre);
    v_despues := v_despues || jsonb_build_object('nombre', NEW.nombre);
  END IF;
  IF NEW.sla_dias IS DISTINCT FROM OLD.sla_dias THEN
    v_antes := v_antes || jsonb_build_object('sla_dias', OLD.sla_dias);
    v_despues := v_despues || jsonb_build_object('sla_dias', NEW.sla_dias);
  END IF;
  IF NEW.audiencia IS DISTINCT FROM OLD.audiencia THEN
    v_antes := v_antes || jsonb_build_object('audiencia', OLD.audiencia);
    v_despues := v_despues || jsonb_build_object('audiencia', NEW.audiencia);
  END IF;
  IF NEW.formulario IS DISTINCT FROM OLD.formulario THEN
    v_antes := v_antes || jsonb_build_object('formulario', OLD.formulario);
    v_despues := v_despues || jsonb_build_object('formulario', NEW.formulario);
  END IF;
  IF NEW.activo IS DISTINCT FROM OLD.activo THEN
    v_antes := v_antes || jsonb_build_object('activo', OLD.activo);
    v_despues := v_despues || jsonb_build_object('activo', NEW.activo);
  END IF;
  IF v_despues = '{}'::jsonb THEN
    RETURN NULL;  -- una actualizacion sin cambios no deja registro
  END IF;
  -- Solo cambio el estado: activado o desactivado; cualquier otra combinacion es un cambio
  v_accion := CASE WHEN v_despues = jsonb_build_object('activo', true) THEN 'activado'
                   WHEN v_despues = jsonb_build_object('activo', false) THEN 'desactivado'
                   ELSE 'cambio' END;
  INSERT INTO siget.catalogo_cambio (tipo_tramite_id, institucion_id, actor_id, accion, antes, despues)
  VALUES (NEW.id, NEW.institucion_id, siget.ctx_usuario(), v_accion, v_antes, v_despues);
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION siget.tipo_tramite_registra() FROM PUBLIC;
CREATE TRIGGER tipo_tramite_registra AFTER INSERT OR UPDATE ON siget.tipo_tramite
  FOR EACH ROW EXECUTE FUNCTION siget.tipo_tramite_registra();

-- ---------------------------------------------------------------------------
-- 6. Permisos y seguridad por filas del registro
-- ---------------------------------------------------------------------------
REVOKE ALL ON siget.catalogo_cambio FROM PUBLIC;
REVOKE ALL ON siget.catalogo_cambio FROM pgadmin_lectura, checkpoint_app, escalador_role, detector_role;
GRANT SELECT ON siget.catalogo_cambio TO app_role;      -- sin INSERT (lo hace el disparador), UPDATE ni DELETE
GRANT SELECT ON siget.catalogo_cambio TO auditor_role;  -- como lee el resto de la auditoria

ALTER TABLE siget.catalogo_cambio ENABLE ROW LEVEL SECURITY;
CREATE POLICY catalogo_cambio_ver_coordinacion ON siget.catalogo_cambio FOR SELECT TO app_role
  USING (siget.es_coordinador_vigente(siget.ctx_usuario(), institucion_id));
CREATE POLICY catalogo_cambio_ver_auditor ON siget.catalogo_cambio FOR SELECT TO auditor_role
  USING (true);

COMMIT;
