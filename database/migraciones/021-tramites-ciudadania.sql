-- ============================================================================
-- Migracion 021: tramites de la ciudadania (requisitos antes de iniciar y desistimiento)
-- ============================================================================
-- Se ejecuta como siget_owner (duenio de los objetos), no como superusuario. Son DOS transacciones, en este orden:
--   A. ALTER TYPE ... ADD VALUE 'Desistido'. PostgreSQL no deja USAR un valor de enum agregado en la misma transaccion, y todo lo demas
--      (transiciones, politica, disparadores) lo usa: por eso va aparte. Agregar un valor a un enum NO se puede deshacer.
--   B. Todo lo demas, en una sola transaccion.
--
-- REQUISITOS ANTES DE INICIAR (tipo_tramite.requisitos)
-- * jsonb NOT NULL DEFAULT '{}' (un objeto: lo que no se dijo, no esta). Claves admitidas, todas opcionales:
--     descripcion (texto de hasta 1000 caracteres: para que sirve el tramite), documentos (lista de hasta 15 textos de 1 a 200
--     caracteres: que hace falta adjuntar) y despues (texto de hasta 1000: que pasa despues de presentarlo).
--   Se eligio jsonb y no tres columnas para que la validacion estructural (siget.requisitos_invalido, como siget.formulario_invalido de la
--   020) viaje en UN solo valor y entre tal cual en el UPDATE por columna, el registro del catalogo y el control de version.
--   Sin control de tamano en bytes: los topes de caracteres ya lo acotan (5 000 caracteres como maximo).
-- * app_role recibe UPDATE (requisitos). El disparador tipo_tramite_valida (se reemplaza aqui, con todo lo de la 020) valida la estructura
--   cuando el tipo se crea o los requisitos cambian y sube la `version` cuando cambian; tipo_tramite_registra (tambien reemplazado) los
--   anota en catalogo_cambio. Quien los escribe sigue siendo solo la coordinacion vigente de la institucion.
-- * Los tipos sembrados reciben requisitos razonables por UPDATE del duenio SIN contexto de usuario (el disparador de la 020 lo deja pasar).
--   Efecto visible: esos tipos suben a la version 2 y catalogo_cambio guarda el cambio con actor nulo (queda como evidencia).
--
-- DESISTIR DE UN TRAMITE (estado «Desistido», final)
-- * Transiciones: Pendiente, En Tramitacion y En Subsanacion -> Desistido (tabla transicion).
-- * SOLO la persona solicitante, y nadie mas (ni el personal, ni el duenio sin contexto): siget.validar_transicion (reemplazada; es la de la
--   017 mas esto) rechaza cualquier paso a Desistido si siget.ctx_usuario() no es el solicitante, y lo mismo que la subsanacion exige un
--   motivo de 10 a 2000 caracteres (siget.motivo, mecanismo de la 017), que queda en evento_auditoria.atributos.
-- * siget.validar_respuesta_solicitante (reemplazada) amplia lo que la persona solicitante puede hacer: ademas de responder una subsanacion,
--   pasar a Desistido desde un estado no final, sin tocar al funcionario asignado. validar_cambio_de_datos (017) sigue impidiendo que
--   desistir cambie `datos`.
-- * Politica RLS tramite_desistir (UPDATE, app_role): la fila debe ser del solicitante, en un estado no final, y quedar «Desistido». Se suma
--   (permisivas: basta una) a tramite_cambiar (personal) y tramite_responder_subsanacion (017).
-- * Todo lo que enumeraba estados finales: escalar_vencidos (013: un desistido no se escala; se rehace el indice parcial), documento_valida (015:
--   un desistido no admite documentos), tramites_abiertos_de (011: un desistido no cuenta como abierto) y las notificaciones (018: tipo
--   nuevo `tramite_desistido`, para el funcionario asignado si sigue teniendo acceso; la persona que desiste no se avisa a si misma).
-- * Compatibilidad: el backend anterior no conoce ni `requisitos` ni «Desistido». Las columnas tienen valor por defecto y nadie desiste
--   sin la API nueva, asi que se puede migrar la base antes de desplegar el codigo nuevo. El backend NUEVO sin la migracion daria error 500 al
--   listar el catalogo (columna inexistente).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- A. El valor nuevo del enum (transaccion propia)
-- ---------------------------------------------------------------------------
BEGIN;
SET LOCAL ROLE siget_owner;
ALTER TYPE siget.estado_tramite ADD VALUE IF NOT EXISTS 'Desistido';
COMMIT;

-- ---------------------------------------------------------------------------
-- B. Todo lo demas
-- ---------------------------------------------------------------------------
BEGIN;
SET LOCAL ROLE siget_owner;

-- ---------------------------------------------------------------------------
-- 1. Requisitos: columna, validacion y permiso
-- ---------------------------------------------------------------------------
ALTER TABLE siget.tipo_tramite
  ADD COLUMN requisitos jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD CONSTRAINT tipo_tramite_requisitos_es_objeto CHECK (jsonb_typeof(requisitos) = 'object');

GRANT UPDATE (requisitos) ON siget.tipo_tramite TO app_role;

-- Devuelve el primer problema estructural de los requisitos, o NULL si estan bien
CREATE FUNCTION siget.requisitos_invalido(p jsonb) RETURNS text LANGUAGE plpgsql IMMUTABLE
  SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_clave text;
  v_item  jsonb;
  v_texto text;
  v_docs  jsonb;
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN
    RETURN 'los requisitos deben ser un objeto';
  END IF;
  FOR v_clave IN SELECT jsonb_object_keys(p) LOOP
    IF v_clave NOT IN ('descripcion', 'documentos', 'despues') THEN
      RETURN format('clave desconocida (%s)', left(v_clave, 40));
    END IF;
  END LOOP;
  -- Los dos textos libres: hasta 1000 caracteres, sin caracteres de control salvo el salto de linea y la tabulacion
  FOREACH v_clave IN ARRAY ARRAY['descripcion', 'despues'] LOOP
    IF p ? v_clave THEN
      IF jsonb_typeof(p -> v_clave) <> 'string' THEN
        RETURN format('%s debe ser un texto', v_clave);
      END IF;
      v_texto := p ->> v_clave;
      IF char_length(v_texto) > 1000 THEN
        RETURN format('%s admite hasta 1000 caracteres', v_clave);
      END IF;
      IF v_texto ~ '[\x01-\x08\x0b-\x1f\x7f-\x9f]' THEN
        RETURN format('%s no admite caracteres de control', v_clave);
      END IF;
    END IF;
  END LOOP;
  IF p ? 'documentos' THEN
    v_docs := p -> 'documentos';
    IF jsonb_typeof(v_docs) <> 'array' OR jsonb_array_length(v_docs) > 15 THEN
      RETURN 'documentos debe ser una lista de hasta 15 textos';
    END IF;
    FOR v_item IN SELECT value FROM jsonb_array_elements(v_docs) LOOP
      IF jsonb_typeof(v_item) <> 'string' THEN
        RETURN 'cada documento debe ser un texto';
      END IF;
      v_texto := v_item #>> '{}';
      IF char_length(btrim(v_texto)) < 1 OR char_length(v_texto) > 200 THEN
        RETURN 'cada documento debe tener de 1 a 200 caracteres';
      END IF;
      IF v_texto ~ '[\x01-\x1f\x7f-\x9f]' THEN
        RETURN 'cada documento es un texto de una sola linea, sin caracteres de control';
      END IF;
    END LOOP;
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION siget.requisitos_invalido(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION siget.requisitos_invalido(jsonb) TO app_role;

-- ---------------------------------------------------------------------------
-- 2. Disparador de validacion de tipo_tramite (el de la 020, mas los requisitos)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION siget.tipo_tramite_valida() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = siget, pg_temp AS $$
DECLARE
  v_actor    int := siget.ctx_usuario();
  v_problema text;
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.id IS DISTINCT FROM OLD.id OR NEW.institucion_id IS DISTINCT FROM OLD.institucion_id) THEN
    RAISE EXCEPTION 'Catalogo: el id y la institucion de un tramite no se cambian';
  END IF;
  -- Con contexto de usuario (una peticion de la API): solo la coordinacion vigente de ESA institucion
  IF v_actor IS NOT NULL AND NOT siget.es_coordinador_vigente(v_actor, NEW.institucion_id) THEN
    RAISE EXCEPTION 'Catalogo: solo la coordinacion vigente de la institucion gestiona su catalogo' USING ERRCODE = '42501';
  END IF;
  -- Sin contexto: pasa el duenio y quien no sea app_role (migraciones, mantenimiento); app_role no. session_user, no current_user:
  -- aqui dentro current_user es el duenio (SECURITY DEFINER). Ver la 020
  IF v_actor IS NULL AND session_user = 'app_role' THEN
    RAISE EXCEPTION 'Catalogo: sin una persona identificada no se gestiona el catalogo' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' OR NEW.formulario IS DISTINCT FROM OLD.formulario THEN
    v_problema := siget.formulario_invalido(NEW.formulario);
    IF v_problema IS NOT NULL THEN
      RAISE EXCEPTION 'Catalogo: formulario invalido: %', v_problema;
    END IF;
  END IF;
  -- Lo mismo con los requisitos (021): solo se validan al crear el tipo o cuando cambian
  IF TG_OP = 'INSERT' OR NEW.requisitos IS DISTINCT FROM OLD.requisitos THEN
    v_problema := siget.requisitos_invalido(NEW.requisitos);
    IF v_problema IS NOT NULL THEN
      RAISE EXCEPTION 'Catalogo: requisitos invalidos: %', v_problema;
    END IF;
  END IF;
  -- La version la lleva solo la base: 1 al crear y, en cada cambio real de lo editable, la anterior mas uno (lo que mande quien escribe no cuenta)
  IF TG_OP = 'INSERT' THEN
    NEW.version := 1;
  ELSIF (NEW.nombre, NEW.sla_dias, NEW.audiencia, NEW.formulario, NEW.activo, NEW.requisitos)
        IS DISTINCT FROM (OLD.nombre, OLD.sla_dias, OLD.audiencia, OLD.formulario, OLD.activo, OLD.requisitos) THEN
    NEW.version := OLD.version + 1;
  ELSE
    NEW.version := OLD.version;
  END IF;
  RETURN NEW;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Registro de cambios del catalogo (el de la 020, mas los requisitos)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION siget.tipo_tramite_registra() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = siget, pg_temp AS $$
DECLARE
  v_antes   jsonb := '{}'::jsonb;
  v_despues jsonb := '{}'::jsonb;
  v_accion  text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO siget.catalogo_cambio (tipo_tramite_id, institucion_id, actor_id, accion, antes, despues)
    VALUES (NEW.id, NEW.institucion_id, siget.ctx_usuario(), 'alta', NULL,
            jsonb_build_object('nombre', NEW.nombre, 'sla_dias', NEW.sla_dias, 'audiencia', NEW.audiencia, 'formulario', NEW.formulario,
                               'activo', NEW.activo, 'requisitos', NEW.requisitos));
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
  IF NEW.requisitos IS DISTINCT FROM OLD.requisitos THEN
    v_antes := v_antes || jsonb_build_object('requisitos', OLD.requisitos);
    v_despues := v_despues || jsonb_build_object('requisitos', NEW.requisitos);
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

-- ---------------------------------------------------------------------------
-- 4. Requisitos de los tipos sembrados (duenio, sin contexto de usuario: el disparador lo deja pasar y lo valida)
-- ---------------------------------------------------------------------------
UPDATE siget.tipo_tramite SET requisitos = '{
  "descripcion": "Autorización de la Alcaldía para construir, ampliar, remodelar o demoler una obra dentro del municipio. La obra no debe empezar antes de que el permiso esté aprobado.",
  "documentos": [
    "Certificación del Registro Público de la finca, vigente",
    "Planos de la obra firmados por un profesional idóneo (arquitecto o ingeniero)",
    "Paz y salvo municipal del inmueble",
    "Copia de la cédula de quien es dueño o dueña de la finca",
    "Poder notarial, si el trámite lo presenta otra persona en su nombre"
  ],
  "despues": "Un funcionario de la Alcaldía revisa la solicitud y los planos. Si falta algo o hay algo por corregir, te pedirá una subsanación y verás el motivo aquí. Cuando se resuelva recibirás un aviso en la plataforma."
}'::jsonb WHERE nombre = 'Permiso de Construcción Municipal';

UPDATE siget.tipo_tramite SET requisitos = '{
  "descripcion": "Presenta una solicitud, queja o denuncia para que la institución la reciba, la registre y le dé seguimiento.",
  "documentos": [
    "Fotografías, videos o capturas que respalden lo ocurrido (opcional)",
    "Copia de cualquier documento relacionado con los hechos (opcional)"
  ],
  "despues": "Tu solicitud queda registrada con un número de seguimiento y un funcionario la revisa. Puede pedirte más información. Verás cada paso en la plataforma y recibirás un aviso cuando haya una resolución."
}'::jsonb WHERE nombre = 'Solicitud o denuncia ciudadana';

UPDATE siget.tipo_tramite SET requisitos = '{
  "descripcion": "Registro simplificado de un pequeño negocio ante AMPYME, para que quede identificado como micro o pequeña empresa.",
  "documentos": [
    "Copia de la cédula de la persona que registra el negocio",
    "Aviso de operación o constancia de la actividad comercial, si ya la tiene",
    "Comprobante de la dirección del negocio (recibo de un servicio público o contrato de alquiler)"
  ],
  "despues": "Un funcionario de AMPYME revisa los datos y los documentos. Si falta algo te pedirá una subsanación. Cuando el registro se apruebe recibirás un aviso en la plataforma."
}'::jsonb WHERE nombre = 'Registro empresarial simplificado';

UPDATE siget.tipo_tramite SET requisitos = '{
  "descripcion": "Solicitud formal de información que una institución dirige a otra, en el marco de sus funciones.",
  "documentos": [
    "Nota o resolución que respalde la solicitud, si la hay",
    "Cualquier documento que ayude a ubicar la información que se pide"
  ],
  "despues": "La institución destinataria revisa la solicitud y responde dentro del plazo. Si necesita una aclaración te la pedirá por este mismo trámite."
}'::jsonb WHERE nombre = 'Solicitud interinstitucional de información';

UPDATE siget.tipo_tramite SET requisitos = '{
  "descripcion": "Trámite de prueba para conocer cómo funciona la plataforma. No tiene ningún efecto legal.",
  "documentos": [
    "Un archivo de prueba (PDF, PNG o JPEG) de hasta 5 MB, si quieres probar la carga de documentos"
  ],
  "despues": "Un funcionario de demostración lo revisa y lo resuelve. Lo que ocurra aquí no tiene consecuencias fuera de la plataforma."
}'::jsonb WHERE nombre LIKE 'Trámite de demostración (%)';

-- ---------------------------------------------------------------------------
-- 5. Desistir: transiciones, motivo y solo la persona solicitante
-- ---------------------------------------------------------------------------
INSERT INTO siget.transicion (desde, hasta) VALUES
  ('Pendiente', 'Desistido'),
  ('En Tramitacion', 'Desistido'),
  ('En Subsanacion', 'Desistido')
ON CONFLICT DO NOTHING;

-- La de la 017, mas: pasar a Desistido exige que quien actualiza sea la persona solicitante (nadie mas, ni el duenio sin contexto) y un motivo.
-- Sigue siendo invoker: lee siget.transicion con los permisos de quien actualiza.
CREATE OR REPLACE FUNCTION siget.validar_transicion() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_motivo text := nullif(btrim(current_setting('siget.motivo', true), E' \t\r\n'), '');
BEGIN
  IF NEW.estado <> OLD.estado THEN
    IF NOT EXISTS (SELECT 1 FROM siget.transicion t WHERE t.desde = OLD.estado AND t.hasta = NEW.estado) THEN
      RAISE EXCEPTION 'Transicion no permitida: % -> %', OLD.estado, NEW.estado;
    END IF;
    IF NEW.estado = 'Desistido' AND OLD.solicitante_id IS DISTINCT FROM siget.ctx_usuario() THEN
      RAISE EXCEPTION 'Solo la persona que solicito el tramite puede desistir de el';
    END IF;
    IF v_motivo IS NOT NULL AND char_length(v_motivo) > 2000 THEN
      RAISE EXCEPTION 'El motivo de la transicion no puede superar los 2000 caracteres';
    END IF;
    IF v_motivo IS NOT NULL AND v_motivo ~ '[\x01-\x08\x0b-\x1f\x7f-\x9f]' THEN
      RAISE EXCEPTION 'El motivo de la transicion no puede llevar caracteres de control';
    END IF;
    IF (NEW.estado IN ('Rechazado', 'En Subsanacion', 'Desistido') OR OLD.estado = 'En Subsanacion')
       AND (v_motivo IS NULL OR char_length(v_motivo) < 10 OR v_motivo !~ '[[:alnum:]]') THEN
      RAISE EXCEPTION 'La transicion % -> % exige un motivo de al menos 10 caracteres con letras o numeros', OLD.estado, NEW.estado;
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- La de la 017, mas: quien actualiza como solicitante tambien puede desistir (desde un estado no final) y nada mas.
CREATE OR REPLACE FUNCTION siget.validar_respuesta_solicitante() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.solicitante_id = siget.ctx_usuario() THEN
    IF NOT ((OLD.estado = 'En Subsanacion' AND NEW.estado = 'En Tramitacion')
            OR (OLD.estado IN ('Pendiente', 'En Tramitacion', 'En Subsanacion') AND NEW.estado = 'Desistido'))
       OR NEW.funcionario_asignado_id IS DISTINCT FROM OLD.funcionario_asignado_id THEN
      RAISE EXCEPTION 'Quien solicito el tramite solo puede responder una subsanacion (En Subsanacion -> En Tramitacion) o desistir de el';
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- La persona solicitante desiste de una fila suya no final y la deja «Desistido»; el personal sigue amparado por tramite_cambiar
CREATE POLICY tramite_desistir ON siget.tramite FOR UPDATE TO app_role
  USING (solicitante_id = siget.ctx_usuario() AND estado IN ('Pendiente', 'En Tramitacion', 'En Subsanacion'))
  WITH CHECK (solicitante_id = siget.ctx_usuario() AND estado = 'Desistido');

-- ---------------------------------------------------------------------------
-- 6. Lo que enumeraba estados finales
-- ---------------------------------------------------------------------------
-- 6a. Escalamiento (013): un tramite desistido no se escala. El indice parcial se rehace con el mismo predicado
DROP INDEX siget.tramite_vencidos_sin_escalar;
CREATE INDEX tramite_vencidos_sin_escalar ON siget.tramite (fecha_limite)
  WHERE escalado_en IS NULL AND estado NOT IN ('Aprobado', 'Rechazado', 'Desistido');

CREATE OR REPLACE FUNCTION siget.escalar_vencidos() RETURNS int LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = siget, pg_temp AS $$
DECLARE
  v_total int;
BEGIN
  WITH escalados AS (
    UPDATE siget.tramite t
       SET escalado_en = now()
     WHERE t.escalado_en IS NULL
       AND t.fecha_limite IS NOT NULL
       AND t.fecha_limite < now()
       AND t.estado NOT IN ('Aprobado', 'Rechazado', 'Desistido')
    RETURNING t.id, t.institucion_id, t.estado, t.fecha_limite
  ), eventos AS (
    INSERT INTO siget.evento_auditoria (tramite_id, institucion_id, actor_id, accion, estado_anterior, estado_nuevo, atributos)
    SELECT id, institucion_id, NULL, 'escalamiento', estado, estado,
           jsonb_build_object('regla', 'plazo_vencido', 'fecha_limite', fecha_limite)
      FROM escalados
    RETURNING 1
  )
  SELECT count(*) INTO v_total FROM eventos;
  RETURN v_total;
END $$;

-- 6b. Documentos (015): un tramite desistido no admite documentos
CREATE OR REPLACE FUNCTION siget.documento_valida() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = siget, pg_temp AS $$
DECLARE
  v_institucion int;
  v_estado      siget.estado_tramite;
BEGIN
  SELECT institucion_id, estado INTO v_institucion, v_estado FROM siget.tramite WHERE id = NEW.tramite_id;
  IF v_institucion IS DISTINCT FROM NEW.institucion_id THEN
    RAISE EXCEPTION 'El documento debe pertenecer a la institucion de su tramite';
  END IF;
  IF v_estado IN ('Aprobado', 'Rechazado', 'Desistido') THEN
    RAISE EXCEPTION 'Un tramite con resolucion final no admite documentos';
  END IF;
  RETURN NEW;
END $$;

-- 6c. Equipo (011): un tramite desistido ya no es un tramite abierto del funcionario
CREATE OR REPLACE FUNCTION siget.tramites_abiertos_de(p_usuario int, p_institucion int) RETURNS int
  LANGUAGE sql SECURITY DEFINER STABLE SET search_path = siget, pg_temp AS $$
  SELECT count(*)::int FROM siget.tramite
   WHERE funcionario_asignado_id = p_usuario AND institucion_id = p_institucion AND estado NOT IN ('Aprobado', 'Rechazado', 'Desistido');
$$;

-- 6d. Notificaciones (018): tipo nuevo `tramite_desistido`, para quien atiende el tramite. El CHECK de la 018 no tiene nombre propio:
-- se busca por su contenido (el unico CHECK de la tabla que menciona `tramite_en_atencion`)
DO $$
DECLARE
  v_nombre text;
BEGIN
  SELECT c.conname INTO v_nombre FROM pg_constraint c
   WHERE c.conrelid = 'siget.notificacion'::regclass AND c.contype = 'c' AND pg_get_constraintdef(c.oid) LIKE '%tramite_en_atencion%';
  IF v_nombre IS NULL THEN
    RAISE EXCEPTION 'No se encontro el CHECK de tipos de siget.notificacion';
  END IF;
  EXECUTE format('ALTER TABLE siget.notificacion DROP CONSTRAINT %I', v_nombre);
END $$;
ALTER TABLE siget.notificacion ADD CONSTRAINT notificacion_tipo_check CHECK (tipo IN (
  'tramite_en_atencion', 'subsanacion_pedida', 'tramite_aprobado', 'tramite_rechazado', 'subsanacion_respondida', 'tramite_escalado',
  'tramite_desistido'));

-- La de la 018, mas: al desistir la persona solicitante se avisa al funcionario asignado (si sigue teniendo acceso y cuenta activa).
-- A la propia persona que desiste no se le avisa (es quien actua).
CREATE OR REPLACE FUNCTION siget.generar_notificaciones() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = siget, pg_temp AS $$
DECLARE
  v_actor int := siget.ctx_usuario();  -- NULL cuando lo hace el sistema (escalador_role)
  v_tipo  text;
BEGIN
  IF NEW.estado IS DISTINCT FROM OLD.estado THEN
    v_tipo := CASE
      WHEN OLD.estado = 'Pendiente' AND NEW.estado = 'En Tramitacion' THEN 'tramite_en_atencion'
      WHEN NEW.estado = 'En Subsanacion' THEN 'subsanacion_pedida'
      WHEN NEW.estado = 'Aprobado' THEN 'tramite_aprobado'
      WHEN NEW.estado = 'Rechazado' THEN 'tramite_rechazado'
    END;
    -- A quien solicito el tramite, salvo que sea quien lo cambia
    IF v_tipo IS NOT NULL AND NEW.solicitante_id IS DISTINCT FROM v_actor THEN
      INSERT INTO siget.notificacion (usuario_id, tipo, tramite_id) VALUES (NEW.solicitante_id, v_tipo, NEW.id);
    END IF;
    -- A quien lo atiende, cuando la persona solicitante responde la subsanacion o desiste (si lo cambia el personal, no)
    IF NEW.funcionario_asignado_id IS NOT NULL
       AND v_actor IS NOT NULL AND v_actor = NEW.solicitante_id
       AND NEW.funcionario_asignado_id <> v_actor
       AND ((OLD.estado = 'En Subsanacion' AND NEW.estado = 'En Tramitacion') OR NEW.estado = 'Desistido') THEN
      INSERT INTO siget.notificacion (usuario_id, tipo, tramite_id)
      SELECT u.id, CASE WHEN NEW.estado = 'Desistido' THEN 'tramite_desistido' ELSE 'subsanacion_respondida' END, NEW.id
        FROM siget.usuario u
       WHERE u.id = NEW.funcionario_asignado_id
         AND u.estado_cuenta = 'activa'
         AND EXISTS (SELECT 1 FROM siget.membresia m
                      WHERE m.usuario_id = NEW.funcionario_asignado_id AND m.institucion_id = NEW.institucion_id
                        AND m.rol IN ('funcionario', 'supervisor') AND m.revocada_en IS NULL);
    END IF;
  END IF;

  -- A la supervision vigente de la institucion cuando el tramite se escala
  IF OLD.escalado_en IS NULL AND NEW.escalado_en IS NOT NULL THEN
    INSERT INTO siget.notificacion (usuario_id, tipo, tramite_id)
    SELECT m.usuario_id, 'tramite_escalado', NEW.id
      FROM siget.membresia m
      JOIN siget.usuario u ON u.id = m.usuario_id AND u.estado_cuenta = 'activa'
     WHERE m.institucion_id = NEW.institucion_id
       AND m.rol = 'supervisor'
       AND m.revocada_en IS NULL
       AND m.usuario_id IS DISTINCT FROM v_actor;
  END IF;
  RETURN NULL;
END $$;

COMMIT;
