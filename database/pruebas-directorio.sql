-- ============================================================================
-- SIGET: pruebas de la migracion 023 (directorio de instituciones: instituciones reales y sus tramites)
-- Se ejecuta como el superusuario del contenedor, DESPUES de aplicar las migraciones 020, 021 y 023, dentro de una transaccion que se
-- revierte (no deja nada guardado):  psql -v ON_ERROR_STOP=1 -f pruebas-directorio.sql  ... y termina en ROLLBACK.
-- Cada prueba imprime PASA o FALLA con RAISE NOTICE y al final hay un resumen.
-- No depende de datos de prueba para lo que comprueba del catalogo (lee el catalogo real tal como lo dejo la migracion); solo crea una
-- persona de prueba (p023_ciud) para comprobar que un tipo inactivo no admite tramites nuevos. No se usa psql -1 (el archivo ya trae su
-- BEGIN y su ROLLBACK).
-- Aun con ROLLBACK, correrlo consume valores de secuencias (ids de tipo_tramite, catalogo_cambio, usuario...): quedan huecos, no borrados.
-- ============================================================================
BEGIN;

CREATE TEMP TABLE _res (ok boolean NOT NULL, texto text NOT NULL) ON COMMIT DROP;

CREATE FUNCTION pg_temp.r(p_ok boolean, p_texto text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO _res VALUES (coalesce(p_ok, false), p_texto);
  RAISE NOTICE '% %', CASE WHEN coalesce(p_ok, false) THEN 'PASA ' ELSE 'FALLA' END, p_texto;
END $$;
-- Ejecuta una sentencia y devuelve el SQLSTATE con el que fallo, o 'sin_error' si no fallo (en ese caso la deshace)
CREATE FUNCTION pg_temp.intenta(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RAISE EXCEPTION 'sin_error' USING ERRCODE = 'P0099';
EXCEPTION
  WHEN SQLSTATE 'P0099' THEN RETURN 'sin_error';
  WHEN OTHERS THEN RETURN SQLSTATE;
END $$;
-- El contexto de sesion que fija la API (quien es y a que instituciones pertenece)
CREATE FUNCTION pg_temp.ctx(p_usuario int, p_instituciones text DEFAULT '') RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('app.usuario_id', coalesce(p_usuario::text, ''), true);
  PERFORM set_config('app.instituciones', p_instituciones, true);
END $$;

-- Las nueve instituciones que reciben tramites reales y los catorce tramites para la ciudadania (los de la migracion 023)
CREATE TEMP TABLE _esperado (institucion text NOT NULL, tramite text NOT NULL) ON COMMIT DROP;
INSERT INTO _esperado VALUES
  ('MINSA', 'Permiso sanitario de operación'),
  ('MOP', 'Permiso de uso de servidumbre vial'),
  ('MiAmbiente', 'Evaluación de estudio de impacto ambiental categoría I'),
  ('Registro Público de Panamá', 'Certificado de propiedad de un inmueble'),
  ('Registro Público de Panamá', 'Certificado de existencia de una sociedad'),
  ('Ministerio de Comercio e Industrias (Panamá Emprende)', 'Aviso de operación'),
  ('Ministerio de Comercio e Industrias (Panamá Emprende)', 'Modificación o cese de un aviso de operación'),
  ('ATTT', 'Renovación de licencia de conducir'),
  ('ATTT', 'Duplicado de licencia de conducir'),
  ('MEDUCA', 'Autenticación de diploma o créditos'),
  ('IDAAN', 'Solicitud de conexión de agua potable'),
  ('IDAAN', 'Reclamo por facturación del servicio de agua'),
  ('Municipio de San Miguelito', 'Paz y salvo municipal'),
  ('Municipio de San Miguelito', 'Permiso de ocupación');

-- ---------------------------------------------------------------------------
-- 1. Instituciones: existen, son reales y no queda ninguna de demostracion
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_nuevas text[] := ARRAY['Registro Público de Panamá', 'Ministerio de Comercio e Industrias (Panamá Emprende)', 'ATTT', 'MEDUCA', 'IDAAN', 'Municipio de San Miguelito'];
  v_antiguas text[] := ARRAY['Alcaldía (Municipio de Panamá)', 'Ministerio Público / 311', 'AMPYME', 'MINSA', 'MOP', 'MiAmbiente'];
BEGIN
  PERFORM pg_temp.r((SELECT count(*) FROM siget.institucion WHERE nombre = ANY (v_nuevas) AND tipo = 'real') = 6,
                    'las seis instituciones nuevas existen y son de tipo real');
  PERFORM pg_temp.r((SELECT count(*) FROM siget.institucion WHERE nombre = ANY (v_antiguas) AND tipo = 'real') = 6,
                    'las seis instituciones sembradas por la 005 (incluidas MINSA, MOP y MiAmbiente) son de tipo real');
  PERFORM pg_temp.r((SELECT count(*) FROM siget.institucion WHERE tipo = 'demostracion') = 0,
                    'ninguna institucion queda con tipo demostracion (desaparece la etiqueta «Demostracion»)');
  PERFORM pg_temp.r((SELECT count(*) FROM siget.institucion) >= 12, 'el catalogo publico tiene al menos 12 instituciones');
  PERFORM pg_temp.r(EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'siget.institucion'::regclass AND contype = 'c'
                              AND pg_get_constraintdef(oid) LIKE '%demostracion%'),
                    'el CHECK de institucion.tipo conserva el valor demostracion (lo usan las pruebas anteriores como dato de prueba)');
END $$;

-- ---------------------------------------------------------------------------
-- 2. Tramites: existen, estan activos y son para la ciudadania
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM pg_temp.r((SELECT count(*) FROM _esperado e JOIN siget.institucion i ON i.nombre = e.institucion
                       JOIN siget.tipo_tramite t ON t.institucion_id = i.id AND t.nombre = e.tramite
                      WHERE t.activo AND t.audiencia = 'ciudadania') = 14,
                    'los 14 tramites para la ciudadania existen, estan activos y son de audiencia ciudadania');
  PERFORM pg_temp.r((SELECT count(*) FROM siget.institucion i WHERE i.nombre IN ('MINSA', 'MOP', 'MiAmbiente')
                        AND (SELECT count(*) FROM siget.tipo_tramite t WHERE t.institucion_id = i.id AND t.activo AND t.audiencia = 'ciudadania') = 1) = 3,
                    'MINSA, MOP y MiAmbiente tienen exactamente un tramite activo para la ciudadania (el de demostracion ya no cuenta)');
  PERFORM pg_temp.r((SELECT count(*) FROM siget.institucion i
                      WHERE i.nombre IN ('Registro Público de Panamá', 'Ministerio de Comercio e Industrias (Panamá Emprende)', 'ATTT', 'MEDUCA', 'IDAAN', 'Municipio de San Miguelito')
                        AND (SELECT count(*) FROM siget.tipo_tramite t WHERE t.institucion_id = i.id AND t.activo AND t.audiencia = 'ciudadania') BETWEEN 1 AND 2) = 6,
                    'cada institucion nueva tiene 1 o 2 tramites activos para la ciudadania');
  PERFORM pg_temp.r((SELECT count(*) FROM siget.institucion i JOIN siget.tipo_tramite t ON t.institucion_id = i.id
                      WHERE i.nombre IN ('Alcaldía (Municipio de Panamá)', 'Ministerio Público / 311', 'AMPYME', 'MINSA', 'MOP', 'MiAmbiente',
                                         'Registro Público de Panamá', 'Ministerio de Comercio e Industrias (Panamá Emprende)', 'ATTT', 'MEDUCA', 'IDAAN', 'Municipio de San Miguelito')
                        AND t.nombre = 'Solicitud interinstitucional de información' AND t.audiencia = 'institucion' AND t.activo) = 12,
                    'las 12 instituciones (las nuevas tambien) tienen su «Solicitud interinstitucional de informacion», solo para personal de otras instituciones');
  PERFORM pg_temp.r((SELECT bool_and(t.sla_dias BETWEEN 1 AND 30) FROM _esperado e JOIN siget.institucion i ON i.nombre = e.institucion
                       JOIN siget.tipo_tramite t ON t.institucion_id = i.id AND t.nombre = e.tramite),
                    'los plazos de los tramites nuevos son razonables (de 1 a 30 dias habiles)');
END $$;

-- ---------------------------------------------------------------------------
-- 3. Formularios y requisitos: validos para la base (las mismas funciones que usan los disparadores de la 020 y la 021)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM pg_temp.r((SELECT bool_and(siget.formulario_invalido(t.formulario) IS NULL AND jsonb_array_length(t.formulario) BETWEEN 1 AND 30)
                       FROM _esperado e JOIN siget.institucion i ON i.nombre = e.institucion
                       JOIN siget.tipo_tramite t ON t.institucion_id = i.id AND t.nombre = e.tramite),
                    'los formularios de los 14 tramites son validos (formulario_invalido devuelve NULL; de 1 a 30 campos)');
  PERFORM pg_temp.r((SELECT bool_and(siget.requisitos_invalido(t.requisitos) IS NULL AND t.requisitos ?& ARRAY['descripcion', 'documentos', 'despues']
                                      AND jsonb_array_length(t.requisitos -> 'documentos') >= 1)
                       FROM _esperado e JOIN siget.institucion i ON i.nombre = e.institucion
                       JOIN siget.tipo_tramite t ON t.institucion_id = i.id AND t.nombre = e.tramite),
                    'los requisitos de los 14 tramites son validos y traen descripcion, documentos y que pasa despues');
  PERFORM pg_temp.r((SELECT bool_and(siget.formulario_invalido(t.formulario) IS NULL AND siget.requisitos_invalido(t.requisitos) IS NULL)
                       FROM siget.tipo_tramite t WHERE t.nombre = 'Solicitud interinstitucional de información'),
                    'la solicitud interinstitucional de cada institucion tiene formulario y requisitos validos');
  PERFORM pg_temp.r(NOT EXISTS (SELECT 1 FROM _esperado e JOIN siget.institucion i ON i.nombre = e.institucion
                                  JOIN siget.tipo_tramite t ON t.institucion_id = i.id AND t.nombre = e.tramite,
                                  jsonb_array_elements(t.formulario) c
                                 WHERE c ->> 'id' IN ('cedula', 'nombre', 'apellidos', 'apellido', 'correo', 'email', 'telefono', 'celular', 'fecha_nacimiento')),
                    'ningun formulario nuevo pide cedula, nombre, apellidos, correo ni telefono (ya estan en el perfil: minimizacion, Ley 81)');
  PERFORM pg_temp.r((SELECT bool_and(pg_column_size(t.formulario) <= 16384) FROM siget.tipo_tramite t),
                    'ningun formulario pasa el tope de 16 KB del CHECK');
END $$;

-- Los disparadores de la 020 y la 021 aceptan estos mismos formularios y requisitos al crear un tipo (como el duenio, sin contexto de usuario)
DO $$
DECLARE
  v_filas int;
  v_versiones int;
  -- Antes de cambiar de rol: las tablas temporales son del superusuario y el duenio no las lee
  v_ids int[] := ARRAY(SELECT t.id FROM _esperado e JOIN siget.institucion i ON i.nombre = e.institucion
                         JOIN siget.tipo_tramite t ON t.institucion_id = i.id AND t.nombre = e.tramite);
BEGIN
  EXECUTE 'SET LOCAL ROLE siget_owner';
  INSERT INTO siget.tipo_tramite (institucion_id, nombre, sla_dias, audiencia, formulario, requisitos)
  SELECT t.institucion_id, t.nombre || ' (copia p023)', t.sla_dias, t.audiencia, t.formulario, t.requisitos
    FROM siget.tipo_tramite t WHERE t.id = ANY (v_ids);
  GET DIAGNOSTICS v_filas = ROW_COUNT;
  SELECT count(*) INTO v_versiones FROM siget.tipo_tramite WHERE nombre LIKE '% (copia p023)' AND version = 1;
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.r(v_filas = 14 AND v_versiones = 14,
                    'el disparador tipo_tramite_valida acepta los 14 formularios y requisitos al crear un tipo (y la version arranca en 1)');
END $$;

-- ---------------------------------------------------------------------------
-- 4. Los «Tramite de demostracion»: inactivos, sin borrar, con su rastro, y sin admitir tramites nuevos
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_ciud int;
  v_inst int;
  v_demo int;
  v_real int;
  v_inter int;
  v_r jsonb := '{}'::jsonb;
BEGIN
  PERFORM pg_temp.r((SELECT count(*) FROM siget.tipo_tramite WHERE nombre LIKE 'Trámite de demostración (%)') = 3,
                    'los tres «Tramite de demostracion» siguen existiendo (no se renombran ni se borran)');
  PERFORM pg_temp.r((SELECT count(*) FROM siget.tipo_tramite WHERE nombre LIKE 'Trámite de demostración (%)' AND NOT activo) = 3,
                    'los tres «Tramite de demostracion» estan inactivos (activo = false)');
  PERFORM pg_temp.r((SELECT bool_and(version >= 3) FROM siget.tipo_tramite WHERE nombre LIKE 'Trámite de demostración (%)'),
                    'al desactivarlos la version de cada uno subio (1 al crearlo, 2 con la 021, 3 con la 023)');
  PERFORM pg_temp.r((SELECT count(DISTINCT c.tipo_tramite_id) FROM siget.catalogo_cambio c JOIN siget.tipo_tramite t ON t.id = c.tipo_tramite_id
                      WHERE t.nombre LIKE 'Trámite de demostración (%)' AND c.accion = 'desactivado' AND c.actor_id IS NULL) = 3,
                    'catalogo_cambio guarda la desactivacion de cada uno (accion desactivado, sin actor: la hizo el duenio al migrar)');

  EXECUTE 'SET LOCAL ROLE siget_owner';
  INSERT INTO siget.usuario (username, password_hash) VALUES ('p023_ciud', '!') RETURNING id INTO v_ciud;
  EXECUTE 'RESET ROLE';
  v_inst := (SELECT id FROM siget.institucion WHERE nombre = 'MOP');
  v_demo := (SELECT id FROM siget.tipo_tramite WHERE institucion_id = v_inst AND nombre = 'Trámite de demostración (MOP)');
  v_real := (SELECT id FROM siget.tipo_tramite WHERE institucion_id = v_inst AND nombre = 'Permiso de uso de servidumbre vial');
  v_inter := (SELECT id FROM siget.tipo_tramite WHERE institucion_id = v_inst AND nombre = 'Solicitud interinstitucional de información');

  EXECUTE 'SET LOCAL ROLE app_role';
  PERFORM pg_temp.ctx(v_ciud);
  v_r := v_r || jsonb_build_object(
    'demo', pg_temp.intenta(format('INSERT INTO siget.tramite (tipo_tramite_id, institucion_id, solicitante_id) VALUES (%s, %s, %s)', v_demo, v_inst, v_ciud)),
    'real', pg_temp.intenta(format('INSERT INTO siget.tramite (tipo_tramite_id, institucion_id, solicitante_id) VALUES (%s, %s, %s)', v_real, v_inst, v_ciud)));
  PERFORM pg_temp.ctx(NULL);
  EXECUTE 'RESET ROLE';

  PERFORM pg_temp.r(v_r ->> 'demo' = 'P0001', 'un «Tramite de demostracion» inactivo NO admite tramites nuevos (la base lo rechaza)');
  PERFORM pg_temp.r(v_r ->> 'real' = 'sin_error', 'el tramite real que lo reemplaza si admite tramites nuevos de la ciudadania');
  PERFORM pg_temp.r(v_inter IS NOT NULL, 'la solicitud interinstitucional del MOP sigue ahi (audiencia institucion)');
END $$;

DO $$
DECLARE
  v_total int;
  v_fallas int;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE NOT ok) INTO v_total, v_fallas FROM _res;
  RAISE NOTICE 'RESUMEN: % de % comprobaciones PASAN, % FALLAN', v_total - v_fallas, v_total, v_fallas;
END $$;

ROLLBACK;
