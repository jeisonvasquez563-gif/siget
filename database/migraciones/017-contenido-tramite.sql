-- ============================================================================
-- Migracion 017: contenido del tramite (datos del formulario, motivo de las decisiones y respuesta a la subsanacion)
-- ============================================================================
-- Se ejecuta como siget_owner (duenio de los objetos), no como superusuario.
--
-- * tipo_tramite.formulario: la definicion (jsonb) de los datos que pide cada tramite. Es una lista de campos
--   {id, etiqueta, tipo: texto|texto_largo|numero|fecha|seleccion, obligatorio, max, opciones (solo seleccion), ayuda (opcional),
--   entero (opcional, solo numero)}. Se carga aqui para los cinco tramites del catalogo. Ningun formulario pide cedula, nombre ni
--   correo: la identidad ya esta en la cuenta (minimizacion de datos, Ley 81). La validacion fina la hace el backend; la base
--   impone la forma (una lista) y el tamano de lo guardado.
-- * tramite.datos: lo que la persona respondio. Los tramites existentes quedan con '{}': no se inventa nada. Es un objeto de a lo
--   sumo 16 KB. app_role recibe UPDATE solo de esta columna (ademas de las que ya tenia).
-- * Motivo de las decisiones: la aplicacion lo fija con set_config('siget.motivo', ..., true) (local a la transaccion) antes del
--   UPDATE de estado. La base rechaza pasar a «Rechazado» o a «En Subsanacion», y tambien cerrar una subsanacion, sin un motivo de
--   10 a 2000 caracteres; y lo guarda en evento_auditoria.atributos como {"motivo": ...}. Un disparador por sentencia limpia el
--   valor al terminar el UPDATE, para que no se arrastre a otro cambio de la misma transaccion.
-- * `datos` solo cambia cuando la PERSONA SOLICITANTE responde una subsanacion (En Subsanacion -> En Tramitacion en el mismo UPDATE).
-- * La ciudadania responde la subsanacion: nueva politica RLS de UPDATE sobre tramite para el solicitante, solo sobre filas «En
--   Subsanacion» y que queden «En Tramitacion». Un disparador la acota aun mas: quien actualiza como solicitante (tenga o no
--   membresia en la institucion del tramite) solo puede hacer exactamente ese paso y sin tocar a quien atiende el tramite.
-- * No se concede nada a escalador_role, auditor_role, pgadmin_lectura ni checkpoint_app. Nota: pgadmin_lectura (009) tiene SELECT
--   de tabla sobre tramite, pero la seguridad por filas no le abre ninguna fila (las politicas son solo de app_role), asi que no lee
--   `datos`; auditor_role lee evento_auditoria completo (incluido
--   atributos.motivo, texto libre que puede llevar datos personales: riesgo aceptado, runbook 40), pero la API de auditoria no
--   expone `atributos`.
-- ============================================================================
BEGIN;
SET LOCAL ROLE siget_owner;

-- ---------------------------------------------------------------------------
-- 1. tipo_tramite.formulario
-- ---------------------------------------------------------------------------
ALTER TABLE siget.tipo_tramite
  ADD COLUMN formulario jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD CONSTRAINT tipo_tramite_formulario_es_lista CHECK (jsonb_typeof(formulario) = 'array');

UPDATE siget.tipo_tramite SET formulario = '[
  {"id": "direccion_terreno", "etiqueta": "Dirección del terreno", "tipo": "texto", "obligatorio": true, "max": 200},
  {"id": "numero_finca", "etiqueta": "Número de finca", "tipo": "texto", "obligatorio": true, "max": 40, "ayuda": "Figura en la certificación del Registro Público."},
  {"id": "tipo_obra", "etiqueta": "Tipo de obra", "tipo": "seleccion", "obligatorio": true, "opciones": ["Obra nueva", "Ampliación", "Remodelación", "Demolición"]},
  {"id": "area_m2", "etiqueta": "Área de la obra (m²)", "tipo": "numero", "obligatorio": true, "max": 100000},
  {"id": "descripcion", "etiqueta": "Descripción de la obra", "tipo": "texto_largo", "obligatorio": false, "max": 2000}
]'::jsonb WHERE nombre = 'Permiso de Construcción Municipal';

UPDATE siget.tipo_tramite SET formulario = '[
  {"id": "asunto", "etiqueta": "Asunto", "tipo": "texto", "obligatorio": true, "max": 150},
  {"id": "descripcion", "etiqueta": "Descripción de los hechos", "tipo": "texto_largo", "obligatorio": true, "max": 3000},
  {"id": "lugar_hechos", "etiqueta": "Lugar de los hechos", "tipo": "texto", "obligatorio": false, "max": 200},
  {"id": "fecha_hechos", "etiqueta": "Fecha de los hechos", "tipo": "fecha", "obligatorio": false, "ayuda": "No puede ser una fecha futura."}
]'::jsonb WHERE nombre = 'Solicitud o denuncia ciudadana';

UPDATE siget.tipo_tramite SET formulario = '[
  {"id": "nombre_comercial", "etiqueta": "Nombre comercial", "tipo": "texto", "obligatorio": true, "max": 150},
  {"id": "actividad_economica", "etiqueta": "Actividad económica", "tipo": "texto", "obligatorio": true, "max": 200},
  {"id": "direccion_negocio", "etiqueta": "Dirección del negocio", "tipo": "texto", "obligatorio": true, "max": 200},
  {"id": "numero_empleados", "etiqueta": "Número de empleados", "tipo": "numero", "obligatorio": true, "max": 10000, "entero": true}
]'::jsonb WHERE nombre = 'Registro empresarial simplificado';

UPDATE siget.tipo_tramite SET formulario = '[
  {"id": "informacion_solicitada", "etiqueta": "Información solicitada", "tipo": "texto_largo", "obligatorio": true, "max": 3000},
  {"id": "fundamento_legal", "etiqueta": "Fundamento legal", "tipo": "texto", "obligatorio": false, "max": 300}
]'::jsonb WHERE nombre = 'Solicitud interinstitucional de información';

UPDATE siget.tipo_tramite SET formulario = '[
  {"id": "asunto", "etiqueta": "Asunto", "tipo": "texto", "obligatorio": true, "max": 150},
  {"id": "descripcion", "etiqueta": "Descripción", "tipo": "texto_largo", "obligatorio": false, "max": 2000}
]'::jsonb WHERE nombre LIKE 'Trámite de demostración (%)';

-- ---------------------------------------------------------------------------
-- 2. tramite.datos
-- ---------------------------------------------------------------------------
ALTER TABLE siget.tramite
  ADD COLUMN datos jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD CONSTRAINT tramite_datos_es_objeto CHECK (jsonb_typeof(datos) = 'object'),
  ADD CONSTRAINT tramite_datos_tamano CHECK (pg_column_size(datos) <= 16384);

GRANT UPDATE (datos) ON siget.tramite TO app_role;

-- ---------------------------------------------------------------------------
-- 3. Motivo de las transiciones (lo fija la aplicacion con set_config('siget.motivo', ..., true))
-- ---------------------------------------------------------------------------
-- Pasar a Rechazado o a En Subsanacion, o cerrar una subsanacion, exige motivo (10 a 2000 caracteres, con al menos un caracter
-- alfanumerico: diez espacios duros, U+3000 o U+200B no valen). Cualquier motivo, si viene, no supera los 2000 y no lleva caracteres
-- de control (C0 y C1) salvo el salto de linea y la tabulacion, que se admiten porque el texto es libre y de varias lineas.
-- Sigue siendo invoker: lee siget.transicion con los permisos de quien actualiza.
CREATE OR REPLACE FUNCTION siget.validar_transicion() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_motivo text := nullif(btrim(current_setting('siget.motivo', true), E' \t\r\n'), '');
BEGIN
  IF NEW.estado <> OLD.estado THEN
    IF NOT EXISTS (SELECT 1 FROM siget.transicion t WHERE t.desde = OLD.estado AND t.hasta = NEW.estado) THEN
      RAISE EXCEPTION 'Transicion no permitida: % -> %', OLD.estado, NEW.estado;
    END IF;
    IF v_motivo IS NOT NULL AND char_length(v_motivo) > 2000 THEN
      RAISE EXCEPTION 'El motivo de la transicion no puede superar los 2000 caracteres';
    END IF;
    IF v_motivo IS NOT NULL AND v_motivo ~ '[\x01-\x08\x0b-\x1f\x7f-\x9f]' THEN
      RAISE EXCEPTION 'El motivo de la transicion no puede llevar caracteres de control';
    END IF;
    IF (NEW.estado IN ('Rechazado', 'En Subsanacion') OR OLD.estado = 'En Subsanacion')
       AND (v_motivo IS NULL OR char_length(v_motivo) < 10 OR v_motivo !~ '[[:alnum:]]') THEN
      RAISE EXCEPTION 'La transicion % -> % exige un motivo de al menos 10 caracteres con letras o numeros', OLD.estado, NEW.estado;
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- El evento de auditoria guarda el motivo (si hay) y si la respuesta cambio el contenido, sin copiarlo (eso queda en tramite.datos)
CREATE OR REPLACE FUNCTION siget.registrar_cambio_estado() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = siget, pg_temp AS $$
DECLARE
  v_motivo    text  := nullif(btrim(current_setting('siget.motivo', true), E' \t\r\n'), '');
  v_atributos jsonb := '{}'::jsonb;
BEGIN
  IF NEW.estado <> OLD.estado THEN
    IF v_motivo IS NOT NULL THEN
      v_atributos := jsonb_build_object('motivo', v_motivo);
    END IF;
    IF NEW.datos IS DISTINCT FROM OLD.datos THEN
      v_atributos := v_atributos || jsonb_build_object('datos_actualizados', true);
    END IF;
    INSERT INTO siget.evento_auditoria (tramite_id, institucion_id, actor_id, accion, estado_anterior, estado_nuevo, atributos)
    VALUES (NEW.id, NEW.institucion_id, siget.ctx_usuario(), 'cambio_estado', OLD.estado, NEW.estado, v_atributos);
  END IF;
  RETURN NEW;
END $$;

-- El motivo vale para UN solo UPDATE: al terminar la sentencia se limpia (los disparadores por fila ya lo leyeron).
-- Por sentencia y no por fila, para no borrarlo antes de que lo lean las demas filas del mismo UPDATE. Sin lista de columnas: corre
-- con CUALQUIER UPDATE de tramite (una reasignacion, por ejemplo, no puede dejar el motivo puesto para el siguiente cambio de estado).
CREATE FUNCTION siget.limpiar_motivo() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('siget.motivo', '', true);
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION siget.limpiar_motivo() FROM PUBLIC;
CREATE TRIGGER tramite_limpia_motivo AFTER UPDATE ON siget.tramite
  FOR EACH STATEMENT EXECUTE FUNCTION siget.limpiar_motivo();

-- ---------------------------------------------------------------------------
-- 4. `datos` solo cambia cuando la persona solicitante responde una subsanacion
-- ---------------------------------------------------------------------------
CREATE FUNCTION siget.validar_cambio_de_datos() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.datos IS DISTINCT FROM OLD.datos
     AND NOT (OLD.estado = 'En Subsanacion' AND NEW.estado = 'En Tramitacion'
              AND OLD.solicitante_id = siget.ctx_usuario()) THEN
    RAISE EXCEPTION 'El contenido del tramite solo cambia cuando quien lo solicito responde una subsanacion';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION siget.validar_cambio_de_datos() FROM PUBLIC;
CREATE TRIGGER tramite_valida_datos BEFORE UPDATE OF datos ON siget.tramite
  FOR EACH ROW EXECUTE FUNCTION siget.validar_cambio_de_datos();

-- ---------------------------------------------------------------------------
-- 5. La ciudadania responde la subsanacion
-- ---------------------------------------------------------------------------
-- La unica escritura de la persona solicitante: una fila «En Subsanacion» suya que queda «En Tramitacion». El personal sigue
-- amparado por tramite_cambiar (politicas permisivas: basta con que una permita).
CREATE POLICY tramite_responder_subsanacion ON siget.tramite FOR UPDATE TO app_role
  USING (solicitante_id = siget.ctx_usuario() AND estado = 'En Subsanacion')
  WITH CHECK (solicitante_id = siget.ctx_usuario() AND estado = 'En Tramitacion');

-- Segunda barrera: quien actualiza como solicitante solo puede hacer EXACTAMENTE En Subsanacion -> En Tramitacion y sin cambiar a
-- quien atiende el tramite (sus unicas columnas actualizables son estado, funcionario_asignado_id y datos). Vale TENGA O NO
-- membresia en la institucion del tramite: la 012 solo impide esa combinacion al crear el tramite, no si la membresia se da despues,
-- y sin esta regla esa persona decidiria su propio tramite. El personal que NO es el solicitante no se ve afectado (reasignar,
-- escalar: escalar_vencidos de la 013 solo actualiza escalado_en, columna que este trigger no vigila).
CREATE FUNCTION siget.validar_respuesta_solicitante() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.solicitante_id = siget.ctx_usuario() THEN
    IF NOT (OLD.estado = 'En Subsanacion' AND NEW.estado = 'En Tramitacion')
       OR NEW.funcionario_asignado_id IS DISTINCT FROM OLD.funcionario_asignado_id THEN
      RAISE EXCEPTION 'Quien solicito el tramite solo puede responder una subsanacion (En Subsanacion -> En Tramitacion)';
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION siget.validar_respuesta_solicitante() FROM PUBLIC;
CREATE TRIGGER tramite_valida_solicitante BEFORE UPDATE OF estado, funcionario_asignado_id, datos ON siget.tramite
  FOR EACH ROW EXECUTE FUNCTION siget.validar_respuesta_solicitante();

COMMIT;
