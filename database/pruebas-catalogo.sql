-- ============================================================================
-- SIGET: pruebas de la migracion 020 (gestion del catalogo de tramites por la coordinacion de cada institucion)
-- Se ejecuta como el superusuario del contenedor, DESPUES de aplicar la migracion, dentro de una transaccion que se
-- revierte (no deja nada guardado):  psql -v ON_ERROR_STOP=1 -f pruebas-catalogo.sql  ... y termina en ROLLBACK.
-- Cada prueba imprime PASA o FALLA con RAISE NOTICE y al final hay un resumen.
-- Crea sus propias instituciones (p020_inst_*), personas (p020_*) y tipos de tramite: no depende de datos reales. Las comprobaciones
-- se hacen COMO app_role con el contexto de cada persona (set_config('app.usuario_id', ...)), igual que la API.
-- No se usa psql -1 (el archivo ya trae su BEGIN y su ROLLBACK).
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
-- Cuantas filas afecta una sentencia (y la deshace siempre); -1 si falla
CREATE FUNCTION pg_temp.filas(p_sql text) RETURNS int LANGUAGE plpgsql AS $$
DECLARE
  v_n int;
  v_t text;
BEGIN
  EXECUTE p_sql;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE EXCEPTION 'deshacer' USING ERRCODE = 'P0098', DETAIL = v_n::text;
EXCEPTION
  WHEN SQLSTATE 'P0098' THEN
    GET STACKED DIAGNOSTICS v_t = PG_EXCEPTION_DETAIL;
    RETURN v_t::int;
  WHEN OTHERS THEN RETURN -1;
END $$;
-- El contexto de sesion que fija la API (quien es y a que instituciones pertenece)
CREATE FUNCTION pg_temp.ctx(p_usuario int, p_instituciones text DEFAULT '') RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('app.usuario_id', coalesce(p_usuario::text, ''), true);
  PERFORM set_config('app.instituciones', p_instituciones, true);
END $$;
-- Intenta crear un tipo (con el rol y el contexto vigentes) y devuelve el SQLSTATE; siempre lo deshace
CREATE FUNCTION pg_temp.alta(p_inst int, p_nombre text, p_form jsonb DEFAULT '[]'::jsonb, p_sla int DEFAULT 5) RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.intenta(format('INSERT INTO siget.tipo_tramite (institucion_id, nombre, sla_dias, formulario) VALUES (%s, %L, %s, %L::jsonb)',
                                p_inst, p_nombre, p_sla, p_form))
$$;
-- Un campo de formulario valido, para armar los casos
CREATE FUNCTION pg_temp.campo(p_id text) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object('id', p_id, 'etiqueta', 'Campo ' || p_id, 'tipo', 'texto', 'obligatorio', false, 'max', 50)
$$;

-- ---------------------------------------------------------------------------
-- Preparacion (como el duenio, sin contexto de usuario): dos instituciones, personas, tipos base y un tramite existente
-- ---------------------------------------------------------------------------
SET LOCAL ROLE siget_owner;
INSERT INTO siget.institucion (nombre, tipo) VALUES ('p020_inst_a', 'demostracion'), ('p020_inst_b', 'demostracion');
INSERT INTO siget.usuario (username, password_hash) VALUES
  ('p020_asig', '!'), ('p020_coord_a', '!'), ('p020_coord_b', '!'), ('p020_coord_rev', '!'), ('p020_coord_susp', '!'),
  ('p020_func_a', '!'), ('p020_sup_a', '!'), ('p020_ciud', '!');
INSERT INTO siget.usuario (username, password_hash, rol_plataforma) VALUES ('p020_opcat', '!', 'operador_catalogo');
UPDATE siget.usuario SET estado_cuenta = 'suspendida' WHERE username = 'p020_coord_susp';
INSERT INTO siget.membresia (usuario_id, institucion_id, rol, asignado_por)
  SELECT u.id, i.id, x.rol::siget.rol_membresia, a.id
    FROM (VALUES ('p020_coord_a', 'p020_inst_a', 'coordinador_institucional'), ('p020_coord_b', 'p020_inst_b', 'coordinador_institucional'),
                 ('p020_coord_rev', 'p020_inst_a', 'coordinador_institucional'), ('p020_coord_susp', 'p020_inst_a', 'coordinador_institucional'),
                 ('p020_func_a', 'p020_inst_a', 'funcionario'), ('p020_sup_a', 'p020_inst_a', 'supervisor')) AS x(usuario, institucion, rol)
    JOIN siget.usuario u ON u.username = x.usuario
    JOIN siget.institucion i ON i.nombre = x.institucion
    JOIN siget.usuario a ON a.username = 'p020_asig';
-- La coordinacion revocada: tuvo la membresia y se la quitaron
UPDATE siget.membresia
   SET revocada_en = now(), revocada_por = (SELECT id FROM siget.usuario WHERE username = 'p020_asig')
 WHERE usuario_id = (SELECT id FROM siget.usuario WHERE username = 'p020_coord_rev');
-- Un tipo base por institucion (el duenio no tiene contexto: el disparador lo deja pasar)
INSERT INTO siget.tipo_tramite (institucion_id, nombre, sla_dias, formulario)
  SELECT id, 'p020 base ' || right(nombre, 1), 10, '[{"id": "asunto", "etiqueta": "Asunto", "tipo": "texto", "obligatorio": true, "max": 100}]'::jsonb
    FROM siget.institucion WHERE nombre IN ('p020_inst_a', 'p020_inst_b');
-- Un tramite que ya existe del tipo base de A
INSERT INTO siget.tramite (tipo_tramite_id, institucion_id, solicitante_id)
  SELECT t.id, t.institucion_id, u.id FROM siget.tipo_tramite t, siget.usuario u WHERE t.nombre = 'p020 base a' AND u.username = 'p020_ciud';
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 1. Quien puede crear y editar
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_a int := (SELECT id FROM siget.institucion WHERE nombre = 'p020_inst_a');
  v_b int := (SELECT id FROM siget.institucion WHERE nombre = 'p020_inst_b');
  v_tipo_a int := (SELECT id FROM siget.tipo_tramite WHERE nombre = 'p020 base a');
  v_tipo_b int := (SELECT id FROM siget.tipo_tramite WHERE nombre = 'p020 base b');
  v_coord_a int := (SELECT id FROM siget.usuario WHERE username = 'p020_coord_a');
  v_coord_b int := (SELECT id FROM siget.usuario WHERE username = 'p020_coord_b');
  v_nuevo int;
  v_filas int;
  v_r jsonb := '{}'::jsonb;
  v_quien text;
  v_uid int;
BEGIN
  EXECUTE 'SET LOCAL ROLE app_role';

  -- La coordinacion de A crea un tipo en A y lo edita
  PERFORM pg_temp.ctx(v_coord_a);
  INSERT INTO siget.tipo_tramite (institucion_id, nombre, sla_dias, audiencia, formulario)
  VALUES (v_a, 'p020 creado por la coordinacion', 7, 'ambas',
          '[{"id": "motivo", "etiqueta": "Motivo", "tipo": "texto_largo", "obligatorio": true, "max": 500}]'::jsonb)
  RETURNING id INTO v_nuevo;
  v_r := v_r || jsonb_build_object('crea', v_nuevo IS NOT NULL);
  UPDATE siget.tipo_tramite SET nombre = 'p020 renombrado', sla_dias = 9, audiencia = 'institucion',
         formulario = '[{"id": "motivo", "etiqueta": "Motivo", "tipo": "seleccion", "obligatorio": true, "opciones": ["Uno", "Dos"]}]'::jsonb,
         activo = true
   WHERE id = v_nuevo;
  GET DIAGNOSTICS v_filas = ROW_COUNT;
  v_r := v_r || jsonb_build_object('edita', v_filas);
  -- Una edicion sin cambios no deja registro (se comprueba mas abajo)
  UPDATE siget.tipo_tramite SET nombre = 'p020 renombrado' WHERE id = v_nuevo;

  -- Los demas, en la institucion A: crear y editar
  FOR v_quien IN SELECT unnest(ARRAY['p020_coord_b', 'p020_func_a', 'p020_sup_a', 'p020_coord_rev', 'p020_coord_susp', 'p020_ciud', 'p020_opcat']) LOOP
    EXECUTE 'RESET ROLE';
    v_uid := (SELECT id FROM siget.usuario WHERE username = v_quien);
    EXECUTE 'SET LOCAL ROLE app_role';
    PERFORM pg_temp.ctx(v_uid, v_a::text);
    v_r := v_r || jsonb_build_object(v_quien || '_alta', pg_temp.alta(v_a, 'p020 intruso ' || v_quien),
                                     v_quien || '_edita', pg_temp.intenta(format('UPDATE siget.tipo_tramite SET nombre = %L WHERE id = %s', 'p020 secuestrado', v_tipo_a)),
                                     v_quien || '_desactiva', pg_temp.intenta(format('UPDATE siget.tipo_tramite SET activo = false WHERE id = %s', v_tipo_a)));
  END LOOP;

  -- La coordinacion de B no toca el catalogo de A (y la de A no toca el de B)
  PERFORM pg_temp.ctx(v_coord_a);
  v_r := v_r || jsonb_build_object('a_en_b_alta', pg_temp.alta(v_b, 'p020 intruso en B'),
                                   'a_en_b_edita', pg_temp.intenta(format('UPDATE siget.tipo_tramite SET nombre = %L WHERE id = %s', 'p020 secuestrado', v_tipo_b)));
  -- Sin contexto de usuario (documentado en la migracion): el disparador deja pasar
  PERFORM pg_temp.ctx(NULL);
  v_r := v_r || jsonb_build_object('sin_contexto', pg_temp.alta(v_a, 'p020 sin contexto'));

  -- Lo que ni la coordinacion puede: cambiar la institucion o el id (permiso por columna) ni borrar ni vaciar
  PERFORM pg_temp.ctx(v_coord_a);
  v_r := v_r || jsonb_build_object(
    'cambia_institucion', pg_temp.intenta(format('UPDATE siget.tipo_tramite SET institucion_id = %s WHERE id = %s', v_b, v_nuevo)),
    'cambia_id', pg_temp.intenta(format('UPDATE siget.tipo_tramite SET id = id + 1000000 WHERE id = %s', v_nuevo)),
    'borra', pg_temp.intenta(format('DELETE FROM siget.tipo_tramite WHERE id = %s', v_nuevo)),
    'vacia', pg_temp.intenta('TRUNCATE siget.tipo_tramite'));
  -- Nombre repetido en la misma institucion; el mismo nombre en otra institucion si se admite
  v_r := v_r || jsonb_build_object('nombre_repetido', pg_temp.alta(v_a, 'p020 base a'));
  PERFORM pg_temp.ctx(v_coord_b);
  v_r := v_r || jsonb_build_object('mismo_nombre_otra_institucion', pg_temp.alta(v_b, 'p020 renombrado'));
  PERFORM pg_temp.ctx(NULL);
  RESET ROLE;

  PERFORM pg_temp.r((v_r ->> 'crea')::boolean AND (v_r ->> 'edita')::int = 1, 'la coordinacion de A crea y edita tipos de su institucion');
  PERFORM pg_temp.r((SELECT nombre = 'p020 renombrado' AND sla_dias = 9 AND audiencia = 'institucion' AND activo AND institucion_id = v_a
                       FROM siget.tipo_tramite WHERE id = v_nuevo), 'la edicion cambio nombre, plazo, audiencia y formulario y la institucion sigue siendo A');
  FOREACH v_quien IN ARRAY ARRAY['p020_coord_b', 'p020_func_a', 'p020_sup_a', 'p020_coord_rev', 'p020_coord_susp', 'p020_ciud', 'p020_opcat'] LOOP
    PERFORM pg_temp.r(v_r ->> (v_quien || '_alta') = '42501' AND v_r ->> (v_quien || '_edita') = '42501' AND v_r ->> (v_quien || '_desactiva') = '42501',
                      format('%s no crea, edita ni desactiva tipos en la institucion A (42501)', v_quien));
  END LOOP;
  PERFORM pg_temp.r(v_r ->> 'a_en_b_alta' = '42501' AND v_r ->> 'a_en_b_edita' = '42501', 'la coordinacion de A tampoco toca el catalogo de B');
  PERFORM pg_temp.r(v_r ->> 'mismo_nombre_otra_institucion' = 'sin_error', 'el mismo nombre en OTRA institucion se admite');
  PERFORM pg_temp.r(v_r ->> 'nombre_repetido' = '23505', 'un nombre repetido en la misma institucion se rechaza (unicidad)');
  PERFORM pg_temp.r(v_r ->> 'sin_contexto' = 'sin_error', 'sin contexto de usuario el disparador deja pasar (migraciones, mantenimiento): comportamiento documentado');
  PERFORM pg_temp.r(v_r ->> 'cambia_institucion' = '42501' AND v_r ->> 'cambia_id' = '42501', 'app_role no puede cambiar institucion_id ni id (permiso por columna)');
  PERFORM pg_temp.r(v_r ->> 'borra' = '42501' AND v_r ->> 'vacia' = '42501', 'app_role no puede borrar ni vaciar el catalogo');
END $$;

-- El duenio tampoco cambia la institucion ni el id (el disparador lo impide aunque el permiso de columna no cuente)
DO $$
DECLARE
  v_b int := (SELECT id FROM siget.institucion WHERE nombre = 'p020_inst_b');
  v_nuevo int := (SELECT id FROM siget.tipo_tramite WHERE nombre = 'p020 renombrado' AND institucion_id = (SELECT id FROM siget.institucion WHERE nombre = 'p020_inst_a'));
  v_codigo text;
  v_codigo2 text;
BEGIN
  EXECUTE 'SET LOCAL ROLE siget_owner';
  v_codigo := pg_temp.intenta(format('UPDATE siget.tipo_tramite SET institucion_id = %s WHERE id = %s', v_b, v_nuevo));
  v_codigo2 := pg_temp.intenta(format('UPDATE siget.tipo_tramite SET id = id + 1000000 WHERE id = %s', v_nuevo));
  RESET ROLE;
  PERFORM pg_temp.r(v_codigo = 'P0001' AND v_codigo2 = 'P0001', 'ni el duenio cambia la institucion o el id de un tipo (disparador)');
END $$;

-- ---------------------------------------------------------------------------
-- 2. Reglas del contenido: formulario, plazo y nombre
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_a int := (SELECT id FROM siget.institucion WHERE nombre = 'p020_inst_a');
  v_coord_a int := (SELECT id FROM siget.usuario WHERE username = 'p020_coord_a');
  v_r jsonb := '{}'::jsonb;
  v_caso record;
  v_ok_30 jsonb := (SELECT jsonb_agg(pg_temp.campo('c' || g)) FROM generate_series(1, 30) g);
  v_mal_31 jsonb := (SELECT jsonb_agg(pg_temp.campo('c' || g)) FROM generate_series(1, 31) g);
  v_opciones_30 jsonb := (SELECT jsonb_agg('op' || g) FROM generate_series(1, 30) g);
  v_opciones_31 jsonb := (SELECT jsonb_agg('op' || g) FROM generate_series(1, 31) g);
  v_fallas text[] := '{}';
  v_codigo text;
BEGIN
  EXECUTE 'SET LOCAL ROLE app_role';
  PERFORM pg_temp.ctx(v_coord_a);

  -- Formularios mal formados: cada regla, con la coordinacion correcta (el error es del contenido, no de los permisos): P0001
  FOR v_caso IN SELECT * FROM (VALUES
    ('no es una lista', '{"id": "x"}'::jsonb),
    ('31 campos', v_mal_31),
    ('un campo que no es objeto', '["x"]'::jsonb),
    ('id con mayuscula', '[{"id": "Asunto", "etiqueta": "A", "tipo": "texto"}]'::jsonb),
    ('id que empieza con numero', '[{"id": "1asunto", "etiqueta": "A", "tipo": "texto"}]'::jsonb),
    ('id de 41 caracteres', jsonb_build_array(jsonb_build_object('id', 'a' || repeat('b', 40), 'etiqueta', 'A', 'tipo', 'texto'))),
    ('id que no es texto', '[{"id": 5, "etiqueta": "A", "tipo": "texto"}]'::jsonb),
    ('sin id', '[{"etiqueta": "A", "tipo": "texto"}]'::jsonb),
    ('id repetido', '[{"id": "a", "etiqueta": "A", "tipo": "texto"}, {"id": "a", "etiqueta": "B", "tipo": "fecha"}]'::jsonb),
    ('etiqueta vacia', '[{"id": "a", "etiqueta": "", "tipo": "texto"}]'::jsonb),
    ('etiqueta de solo espacios', '[{"id": "a", "etiqueta": "   ", "tipo": "texto"}]'::jsonb),
    ('etiqueta de 121 caracteres', jsonb_build_array(jsonb_build_object('id', 'a', 'etiqueta', repeat('e', 121), 'tipo', 'texto'))),
    ('tipo desconocido', '[{"id": "a", "etiqueta": "A", "tipo": "archivo"}]'::jsonb),
    ('obligatorio que no es booleano', '[{"id": "a", "etiqueta": "A", "tipo": "texto", "obligatorio": "si"}]'::jsonb),
    ('seleccion sin opciones', '[{"id": "a", "etiqueta": "A", "tipo": "seleccion"}]'::jsonb),
    ('seleccion con opciones vacias', '[{"id": "a", "etiqueta": "A", "tipo": "seleccion", "opciones": []}]'::jsonb),
    ('seleccion con 31 opciones', jsonb_build_array(jsonb_build_object('id', 'a', 'etiqueta', 'A', 'tipo', 'seleccion', 'opciones', v_opciones_31))),
    ('seleccion con opciones que no son texto', '[{"id": "a", "etiqueta": "A", "tipo": "seleccion", "opciones": [1, 2]}]'::jsonb)
  ) AS t(nombre, formulario) LOOP
    v_codigo := pg_temp.alta(v_a, 'p020 formulario malo', v_caso.formulario);
    IF v_codigo IS DISTINCT FROM 'P0001' THEN
      v_fallas := v_fallas || (v_caso.nombre || ' -> ' || v_codigo);
    END IF;
  END LOOP;
  v_r := v_r || jsonb_build_object('malos_aceptados', to_jsonb(v_fallas));

  -- Los limites exactos si se admiten
  v_r := v_r || jsonb_build_object(
    'ok_30', pg_temp.alta(v_a, 'p020 treinta campos', v_ok_30),
    'ok_id_40', pg_temp.alta(v_a, 'p020 id largo', jsonb_build_array(jsonb_build_object('id', 'a' || repeat('b', 39), 'etiqueta', repeat('e', 120), 'tipo', 'texto'))),
    'ok_30_opciones', pg_temp.alta(v_a, 'p020 treinta opciones', jsonb_build_array(jsonb_build_object('id', 'a', 'etiqueta', 'A', 'tipo', 'seleccion', 'opciones', v_opciones_30))),
    'ok_todos_los_tipos', pg_temp.alta(v_a, 'p020 todos los tipos', '[{"id": "a", "etiqueta": "A", "tipo": "texto", "obligatorio": true, "max": 10},
        {"id": "b", "etiqueta": "B", "tipo": "texto_largo", "obligatorio": false, "max": 100}, {"id": "c", "etiqueta": "C", "tipo": "numero", "entero": true, "max": 9},
        {"id": "d", "etiqueta": "D", "tipo": "fecha"}, {"id": "e", "etiqueta": "E", "tipo": "seleccion", "opciones": ["Si", "No"], "ayuda": "Elegir"}]'::jsonb),
    'ok_vacio', pg_temp.alta(v_a, 'p020 sin campos', '[]'::jsonb));

  -- Plazo y nombre: CHECK de la tabla (23514)
  v_r := v_r || jsonb_build_object(
    'sla_0', pg_temp.alta(v_a, 'p020 plazo cero', '[]'::jsonb, 0),
    'sla_366', pg_temp.alta(v_a, 'p020 plazo largo', '[]'::jsonb, 366),
    'sla_365', pg_temp.alta(v_a, 'p020 plazo maximo', '[]'::jsonb, 365),
    'sla_1', pg_temp.alta(v_a, 'p020 plazo minimo', '[]'::jsonb, 1),
    'nombre_2', pg_temp.alta(v_a, 'ab'),
    'nombre_con_espacios', pg_temp.alta(v_a, '   ab   '),
    'nombre_151', pg_temp.alta(v_a, repeat('n', 151)),
    'nombre_150', pg_temp.alta(v_a, repeat('m', 150)),
    'nombre_3', pg_temp.alta(v_a, 'abc'));
  -- Audiencia fuera de la lista (CHECK de la 012)
  v_r := v_r || jsonb_build_object('audiencia', pg_temp.intenta(format('INSERT INTO siget.tipo_tramite (institucion_id, nombre, sla_dias, audiencia) VALUES (%s, %L, 5, %L)', v_a, 'p020 audiencia mala', 'todos')));
  PERFORM pg_temp.ctx(NULL);
  RESET ROLE;

  PERFORM pg_temp.r(v_r -> 'malos_aceptados' = '[]'::jsonb, format('cada regla del formulario se rechaza (P0001); aceptados por error: %s', v_r -> 'malos_aceptados'));
  PERFORM pg_temp.r(v_r ->> 'ok_30' = 'sin_error' AND v_r ->> 'ok_id_40' = 'sin_error' AND v_r ->> 'ok_30_opciones' = 'sin_error'
                    AND v_r ->> 'ok_todos_los_tipos' = 'sin_error' AND v_r ->> 'ok_vacio' = 'sin_error',
                    'los limites exactos (30 campos, id de 40, etiqueta de 120, 30 opciones, los cinco tipos, sin campos) se admiten');
  PERFORM pg_temp.r(v_r ->> 'sla_0' = '23514' AND v_r ->> 'sla_366' = '23514', 'el plazo fuera de 1 a 365 dias se rechaza');
  PERFORM pg_temp.r(v_r ->> 'sla_1' = 'sin_error' AND v_r ->> 'sla_365' = 'sin_error', 'los plazos 1 y 365 se admiten');
  PERFORM pg_temp.r(v_r ->> 'nombre_2' = '23514' AND v_r ->> 'nombre_con_espacios' = '23514' AND v_r ->> 'nombre_151' = '23514',
                    'un nombre de menos de 3 (sin contar espacios) o de mas de 150 caracteres se rechaza');
  PERFORM pg_temp.r(v_r ->> 'nombre_3' = 'sin_error' AND v_r ->> 'nombre_150' = 'sin_error', 'los nombres de 3 y de 150 caracteres se admiten');
  PERFORM pg_temp.r(v_r ->> 'audiencia' = '23514', 'una audiencia fuera de la lista se rechaza');
END $$;

-- Un tipo anterior a las reglas se puede renombrar aunque su formulario no las cumpla; cambiar el formulario si lo revalida
DO $$
DECLARE
  v_a int := (SELECT id FROM siget.institucion WHERE nombre = 'p020_inst_a');
  v_coord_a int := (SELECT id FROM siget.usuario WHERE username = 'p020_coord_a');
  v_viejo int;
  v_r jsonb := '{}'::jsonb;
BEGIN
  -- Como superusuario, con los disparadores apagados solo para esta sentencia (session_replication_role es local a la transaccion)
  SET LOCAL session_replication_role = replica;
  INSERT INTO siget.tipo_tramite (institucion_id, nombre, sla_dias, formulario)
  VALUES (v_a, 'p020 tipo anterior', 5, '[{"id": "Campo Viejo", "etiqueta": "Viejo", "tipo": "texto"}]'::jsonb) RETURNING id INTO v_viejo;
  SET LOCAL session_replication_role = origin;

  EXECUTE 'SET LOCAL ROLE app_role';
  PERFORM pg_temp.ctx(v_coord_a);
  v_r := v_r || jsonb_build_object(
    'renombra', pg_temp.filas(format('UPDATE siget.tipo_tramite SET nombre = %L WHERE id = %s', 'p020 tipo anterior renombrado', v_viejo)),
    'toca_el_formulario', pg_temp.intenta(format('UPDATE siget.tipo_tramite SET formulario = %L::jsonb WHERE id = %s',
                                                 '[{"id": "Campo Viejo", "etiqueta": "Viejo", "tipo": "texto", "obligatorio": true}]', v_viejo)),
    'lo_corrige', pg_temp.intenta(format('UPDATE siget.tipo_tramite SET formulario = %L::jsonb WHERE id = %s',
                                         '[{"id": "campo_nuevo", "etiqueta": "Nuevo", "tipo": "texto", "obligatorio": true}]', v_viejo)));
  PERFORM pg_temp.ctx(NULL);
  RESET ROLE;
  PERFORM pg_temp.r((v_r ->> 'renombra')::int = 1, 'un tipo anterior a las reglas se puede renombrar sin revalidar su formulario');
  PERFORM pg_temp.r(v_r ->> 'toca_el_formulario' = 'P0001' AND v_r ->> 'lo_corrige' = 'sin_error', 'pero si se cambia el formulario se revalida: lo malo se rechaza y lo corregido pasa');
END $$;

-- ---------------------------------------------------------------------------
-- 3. Un tipo inactivo no admite tramites nuevos; los existentes siguen su curso
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_a int := (SELECT id FROM siget.institucion WHERE nombre = 'p020_inst_a');
  v_tipo_a int := (SELECT id FROM siget.tipo_tramite WHERE nombre = 'p020 base a');
  v_tramite bigint := (SELECT id FROM siget.tramite WHERE tipo_tramite_id = (SELECT id FROM siget.tipo_tramite WHERE nombre = 'p020 base a'));
  v_coord_a int := (SELECT id FROM siget.usuario WHERE username = 'p020_coord_a');
  v_func_a int := (SELECT id FROM siget.usuario WHERE username = 'p020_func_a');
  v_ciud int := (SELECT id FROM siget.usuario WHERE username = 'p020_ciud');
  v_nuevo_tramite text := format('INSERT INTO siget.tramite (tipo_tramite_id, institucion_id, solicitante_id) VALUES (%s, %s, %s)', v_tipo_a, v_a, v_ciud);
  v_r jsonb := '{}'::jsonb;
  v_filas int;
BEGIN
  EXECUTE 'SET LOCAL ROLE app_role';
  PERFORM pg_temp.ctx(v_ciud);
  v_r := v_r || jsonb_build_object('activo_admite', pg_temp.intenta(v_nuevo_tramite));

  PERFORM pg_temp.ctx(v_coord_a);
  UPDATE siget.tipo_tramite SET activo = false WHERE id = v_tipo_a;
  GET DIAGNOSTICS v_filas = ROW_COUNT;
  v_r := v_r || jsonb_build_object('desactiva', v_filas);

  PERFORM pg_temp.ctx(v_ciud);
  v_r := v_r || jsonb_build_object('inactivo_rechaza', pg_temp.intenta(v_nuevo_tramite));
  -- El tramite que ya existia sigue su curso: el funcionario de A lo pasa a En Tramitacion
  PERFORM pg_temp.ctx(v_func_a, v_a::text);
  v_r := v_r || jsonb_build_object('existente_sigue', pg_temp.filas(format('UPDATE siget.tramite SET estado = %L WHERE id = %s', 'En Tramitacion', v_tramite)));

  PERFORM pg_temp.ctx(v_coord_a);
  UPDATE siget.tipo_tramite SET activo = true WHERE id = v_tipo_a;
  PERFORM pg_temp.ctx(v_ciud);
  v_r := v_r || jsonb_build_object('reactivado_admite', pg_temp.intenta(v_nuevo_tramite));
  PERFORM pg_temp.ctx(NULL);
  RESET ROLE;

  PERFORM pg_temp.r(v_r ->> 'activo_admite' = 'sin_error', 'un tipo activo admite tramites nuevos');
  PERFORM pg_temp.r((v_r ->> 'desactiva')::int = 1, 'la coordinacion desactiva un tipo (no lo borra: la fila sigue)');
  PERFORM pg_temp.r(v_r ->> 'inactivo_rechaza' = 'P0001', 'un tipo inactivo NO admite tramites nuevos (la base lo rechaza)');
  PERFORM pg_temp.r((v_r ->> 'existente_sigue')::int = 1, 'el tramite que ya existia de ese tipo sigue su curso (cambio de estado permitido)');
  PERFORM pg_temp.r(v_r ->> 'reactivado_admite' = 'sin_error', 'al reactivarlo vuelve a admitir tramites nuevos');
END $$;

-- ---------------------------------------------------------------------------
-- 4. El registro de cambios: se escribe y es inalterable
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_a int := (SELECT id FROM siget.institucion WHERE nombre = 'p020_inst_a');
  v_tipo_a int := (SELECT id FROM siget.tipo_tramite WHERE nombre = 'p020 base a');
  v_nuevo int := (SELECT id FROM siget.tipo_tramite WHERE nombre = 'p020 renombrado' AND institucion_id = v_a);
  v_coord_a int := (SELECT id FROM siget.usuario WHERE username = 'p020_coord_a');
  v_acciones_nuevo text[] := (SELECT array_agg(accion ORDER BY id) FROM siget.catalogo_cambio WHERE tipo_tramite_id = v_nuevo);
  v_acciones_base text[] := (SELECT array_agg(accion ORDER BY id) FROM siget.catalogo_cambio WHERE tipo_tramite_id = v_tipo_a);
  v_alta record;
  v_cambio record;
  v_desact record;
  v_intrusos int := (SELECT count(*) FROM siget.catalogo_cambio c JOIN siget.usuario u ON u.id = c.actor_id
                      WHERE u.username IN ('p020_coord_b', 'p020_func_a', 'p020_sup_a', 'p020_coord_rev', 'p020_coord_susp', 'p020_ciud', 'p020_opcat'));
  v_primera bigint := (SELECT min(id) FROM siget.catalogo_cambio);
  v_r jsonb := '{}'::jsonb;
BEGIN
  SELECT * INTO v_alta FROM siget.catalogo_cambio WHERE tipo_tramite_id = v_nuevo AND accion = 'alta';
  SELECT * INTO v_cambio FROM siget.catalogo_cambio WHERE tipo_tramite_id = v_nuevo AND accion = 'cambio';
  SELECT * INTO v_desact FROM siget.catalogo_cambio WHERE tipo_tramite_id = v_tipo_a AND accion = 'desactivado';

  PERFORM pg_temp.r(v_acciones_nuevo = ARRAY['alta', 'cambio'], format('el tipo creado y editado tiene exactamente un alta y un cambio (la edicion sin cambios no deja registro): %s', v_acciones_nuevo));
  PERFORM pg_temp.r(v_alta.actor_id = v_coord_a AND v_alta.institucion_id = v_a AND v_alta.antes IS NULL AND v_alta.despues ->> 'nombre' = 'p020 creado por la coordinacion'
                    AND (v_alta.despues ->> 'sla_dias')::int = 7 AND jsonb_typeof(v_alta.despues -> 'formulario') = 'array',
                    'el alta registra quien (la coordinacion), la institucion y la foto completa de lo creado');
  PERFORM pg_temp.r(v_cambio.actor_id = v_coord_a AND v_cambio.antes ->> 'nombre' = 'p020 creado por la coordinacion' AND v_cambio.despues ->> 'nombre' = 'p020 renombrado'
                    AND (v_cambio.antes ->> 'sla_dias')::int = 7 AND (v_cambio.despues ->> 'sla_dias')::int = 9 AND NOT (v_cambio.despues ? 'activo'),
                    'el cambio registra solo lo que cambio (antes y despues) y a nombre de quien lo hizo');
  PERFORM pg_temp.r(v_acciones_base = ARRAY['alta', 'desactivado', 'activado'], format('desactivar y reactivar quedan como acciones propias: %s', v_acciones_base));
  PERFORM pg_temp.r(v_desact.actor_id = v_coord_a AND v_desact.antes = '{"activo": true}'::jsonb AND v_desact.despues = '{"activo": false}'::jsonb,
                    'la desactivacion registra quien la hizo y el valor anterior y el nuevo');
  PERFORM pg_temp.r((SELECT actor_id IS NULL FROM siget.catalogo_cambio WHERE tipo_tramite_id = v_tipo_a AND accion = 'alta'), 'un alta sin sesion (el duenio) queda con actor NULL');
  PERFORM pg_temp.r(v_intrusos = 0, 'lo que la base rechazo no dejo ningun registro a nombre de quien lo intento');

  -- app_role: ni UPDATE, ni DELETE, ni TRUNCATE, ni INSERT
  EXECUTE 'SET LOCAL ROLE app_role';
  PERFORM pg_temp.ctx(v_coord_a);
  v_r := v_r || jsonb_build_object(
    'app_update', pg_temp.intenta(format('UPDATE siget.catalogo_cambio SET accion = %L WHERE id = %s', 'cambio', v_primera)),
    'app_delete', pg_temp.intenta(format('DELETE FROM siget.catalogo_cambio WHERE id = %s', v_primera)),
    'app_truncate', pg_temp.intenta('TRUNCATE siget.catalogo_cambio'),
    'app_insert', pg_temp.intenta(format('INSERT INTO siget.catalogo_cambio (tipo_tramite_id, institucion_id, accion) VALUES (%s, %s, %L)', v_tipo_a, v_a, 'cambio')));
  PERFORM pg_temp.ctx(NULL);
  RESET ROLE;
  -- Ni siquiera el duenio ni el superusuario: el disparador lo impide
  EXECUTE 'SET LOCAL ROLE siget_owner';
  v_r := v_r || jsonb_build_object(
    'dueno_update', pg_temp.intenta(format('UPDATE siget.catalogo_cambio SET accion = %L WHERE id = %s', 'cambio', v_primera)),
    'dueno_delete', pg_temp.intenta(format('DELETE FROM siget.catalogo_cambio WHERE id = %s', v_primera)),
    'dueno_truncate', pg_temp.intenta('TRUNCATE siget.catalogo_cambio'));
  RESET ROLE;
  v_r := v_r || jsonb_build_object(
    'super_update', pg_temp.intenta(format('UPDATE siget.catalogo_cambio SET accion = %L WHERE id = %s', 'cambio', v_primera)),
    'super_delete', pg_temp.intenta(format('DELETE FROM siget.catalogo_cambio WHERE id = %s', v_primera)));

  PERFORM pg_temp.r(v_r ->> 'app_update' = '42501' AND v_r ->> 'app_delete' = '42501' AND v_r ->> 'app_truncate' = '42501', 'app_role no actualiza, borra ni vacia el registro de cambios');
  PERFORM pg_temp.r(v_r ->> 'app_insert' = '42501', 'app_role no inserta en el registro (solo lo escribe el disparador)');
  PERFORM pg_temp.r(v_r ->> 'dueno_update' = 'P0001' AND v_r ->> 'dueno_delete' = 'P0001' AND v_r ->> 'dueno_truncate' = 'P0001', 'ni el duenio actualiza, borra ni vacia el registro (disparador)');
  PERFORM pg_temp.r(v_r ->> 'super_update' = 'P0001' AND v_r ->> 'super_delete' = 'P0001', 'ni el superusuario (disparador)');
END $$;

-- ---------------------------------------------------------------------------
-- 5. Quien ve el registro (seguridad por filas)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_a int := (SELECT id FROM siget.institucion WHERE nombre = 'p020_inst_a');
  v_b int := (SELECT id FROM siget.institucion WHERE nombre = 'p020_inst_b');
  v_total bigint := (SELECT count(*) FROM siget.catalogo_cambio);
  v_coord_a int := (SELECT id FROM siget.usuario WHERE username = 'p020_coord_a');
  v_coord_b int := (SELECT id FROM siget.usuario WHERE username = 'p020_coord_b');
  v_quien text;
  v_uid int;
  v_r jsonb := '{}'::jsonb;
BEGIN
  EXECUTE 'SET LOCAL ROLE app_role';
  PERFORM pg_temp.ctx(v_coord_a);
  v_r := v_r || jsonb_build_object('a_ve_a', (SELECT count(*) FROM siget.catalogo_cambio WHERE institucion_id = v_a),
                                   'a_ve_b', (SELECT count(*) FROM siget.catalogo_cambio WHERE institucion_id = v_b),
                                   'a_ve_todo', (SELECT count(*) FROM siget.catalogo_cambio));
  PERFORM pg_temp.ctx(v_coord_b);
  v_r := v_r || jsonb_build_object('b_ve_a', (SELECT count(*) FROM siget.catalogo_cambio WHERE institucion_id = v_a),
                                   'b_ve_b', (SELECT count(*) FROM siget.catalogo_cambio WHERE institucion_id = v_b));
  PERFORM pg_temp.ctx(NULL);
  v_r := v_r || jsonb_build_object('sin_contexto', (SELECT count(*) FROM siget.catalogo_cambio));
  FOR v_quien IN SELECT unnest(ARRAY['p020_func_a', 'p020_sup_a', 'p020_coord_rev', 'p020_coord_susp', 'p020_ciud', 'p020_opcat']) LOOP
    EXECUTE 'RESET ROLE';
    v_uid := (SELECT id FROM siget.usuario WHERE username = v_quien);
    EXECUTE 'SET LOCAL ROLE app_role';
    PERFORM pg_temp.ctx(v_uid, v_a::text);
    v_r := v_r || jsonb_build_object(v_quien, (SELECT count(*) FROM siget.catalogo_cambio));
  END LOOP;
  PERFORM pg_temp.ctx(NULL);
  RESET ROLE;
  EXECUTE 'SET LOCAL ROLE auditor_role';
  v_r := v_r || jsonb_build_object('auditor', (SELECT count(*) FROM siget.catalogo_cambio));
  RESET ROLE;

  PERFORM pg_temp.r((v_r ->> 'a_ve_a')::int >= 4 AND (v_r ->> 'a_ve_b')::int = 0 AND (v_r ->> 'a_ve_todo')::int = (v_r ->> 'a_ve_a')::int,
                    'la coordinacion de A ve el registro de A y nada de otras instituciones');
  PERFORM pg_temp.r((v_r ->> 'b_ve_b')::int >= 1 AND (v_r ->> 'b_ve_a')::int = 0, 'la coordinacion de B ve el de B y nada del de A');
  PERFORM pg_temp.r((v_r ->> 'sin_contexto')::int = 0, 'sin contexto de sesion no se ve ninguna fila');
  PERFORM pg_temp.r((v_r ->> 'p020_func_a')::int = 0 AND (v_r ->> 'p020_sup_a')::int = 0 AND (v_r ->> 'p020_ciud')::int = 0 AND (v_r ->> 'p020_opcat')::int = 0,
                    'funcionario, supervisor, ciudadania y operador de catalogo no ven el registro');
  PERFORM pg_temp.r((v_r ->> 'p020_coord_rev')::int = 0 AND (v_r ->> 'p020_coord_susp')::int = 0, 'la coordinacion revocada y la de cuenta suspendida no ven el registro');
  PERFORM pg_temp.r((v_r ->> 'auditor')::bigint = v_total, 'auditor_role lee todo el registro (como el resto de la auditoria)');
END $$;

-- ---------------------------------------------------------------------------
-- 6. El alta de una institucion no inserta tipos de tramite ni pasa por el disparador
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_opcat int := (SELECT id FROM siget.usuario WHERE username = 'p020_opcat');
  v_inst int;
  v_tipos int;
  v_codigo text;
  v_cambios int;
BEGIN
  EXECUTE 'SET LOCAL ROLE app_role';
  PERFORM pg_temp.ctx(v_opcat);
  INSERT INTO siget.institucion (nombre, tipo) VALUES ('p020_inst_nueva', 'demostracion') RETURNING id INTO v_inst;
  v_tipos := (SELECT count(*) FROM siget.tipo_tramite WHERE institucion_id = v_inst);
  PERFORM pg_temp.ctx(NULL);
  RESET ROLE;
  v_cambios := (SELECT count(*) FROM siget.catalogo_cambio WHERE institucion_id = v_inst);
  PERFORM pg_temp.r(v_inst IS NOT NULL AND v_tipos = 0 AND v_cambios = 0,
                    'dar de alta una institucion (como app_role, con el contexto del operador de catalogo) no crea tipos ni registro de catalogo: el disparador no la rompe');
END $$;

-- ---------------------------------------------------------------------------
-- 7. Permisos de cada rol (por el catalogo del sistema)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_rol text;
  v_ok boolean;
BEGIN
  PERFORM pg_temp.r(has_table_privilege('app_role', 'siget.catalogo_cambio', 'SELECT')
                    AND NOT has_table_privilege('app_role', 'siget.catalogo_cambio', 'INSERT,UPDATE,DELETE,TRUNCATE'),
                    'app_role: solo SELECT sobre el registro de cambios');
  PERFORM pg_temp.r(has_table_privilege('auditor_role', 'siget.catalogo_cambio', 'SELECT')
                    AND NOT has_table_privilege('auditor_role', 'siget.catalogo_cambio', 'INSERT,UPDATE,DELETE,TRUNCATE'),
                    'auditor_role: solo SELECT sobre el registro de cambios');
  FOREACH v_rol IN ARRAY ARRAY['pgadmin_lectura', 'escalador_role', 'detector_role', 'checkpoint_app'] LOOP
    PERFORM pg_temp.r(NOT has_table_privilege(v_rol, 'siget.catalogo_cambio', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'),
                      format('%s no tiene ningun permiso sobre el registro de cambios', v_rol));
  END LOOP;
  PERFORM pg_temp.r(NOT EXISTS (SELECT 1 FROM pg_class c, aclexplode(c.relacl) a WHERE c.oid = 'siget.catalogo_cambio'::regclass AND a.grantee = 0),
                    'PUBLIC no tiene permisos sobre el registro de cambios');
  PERFORM pg_temp.r((SELECT relrowsecurity FROM pg_class WHERE oid = 'siget.catalogo_cambio'::regclass), 'el registro de cambios tiene la seguridad por filas activada');

  v_ok := has_column_privilege('app_role', 'siget.tipo_tramite', 'nombre', 'UPDATE') AND has_column_privilege('app_role', 'siget.tipo_tramite', 'sla_dias', 'UPDATE')
          AND has_column_privilege('app_role', 'siget.tipo_tramite', 'audiencia', 'UPDATE') AND has_column_privilege('app_role', 'siget.tipo_tramite', 'formulario', 'UPDATE')
          AND has_column_privilege('app_role', 'siget.tipo_tramite', 'activo', 'UPDATE');
  PERFORM pg_temp.r(v_ok, 'app_role actualiza nombre, sla_dias, audiencia, formulario y activo');
  PERFORM pg_temp.r(NOT has_column_privilege('app_role', 'siget.tipo_tramite', 'id', 'UPDATE') AND NOT has_column_privilege('app_role', 'siget.tipo_tramite', 'institucion_id', 'UPDATE')
                    AND NOT has_table_privilege('app_role', 'siget.tipo_tramite', 'DELETE,TRUNCATE'),
                    'app_role no actualiza id ni institucion_id y no borra ni vacia tipos');
  FOREACH v_rol IN ARRAY ARRAY['auditor_role', 'pgadmin_lectura', 'escalador_role', 'detector_role', 'checkpoint_app'] LOOP
    PERFORM pg_temp.r(NOT has_table_privilege(v_rol, 'siget.tipo_tramite', 'INSERT,UPDATE,DELETE,TRUNCATE') AND NOT has_any_column_privilege(v_rol, 'siget.tipo_tramite', 'INSERT,UPDATE'),
                      format('%s no escribe en el catalogo de tipos', v_rol));
  END LOOP;

  v_ok := has_function_privilege('app_role', 'siget.es_coordinador_vigente(int,int)', 'EXECUTE') AND has_function_privilege('app_role', 'siget.formulario_invalido(jsonb)', 'EXECUTE')
          AND NOT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
                           WHERE p.oid IN ('siget.es_coordinador_vigente(int,int)'::regprocedure, 'siget.formulario_invalido(jsonb)'::regprocedure,
                                           'siget.tipo_tramite_valida()'::regprocedure, 'siget.tipo_tramite_registra()'::regprocedure,
                                           'siget.tramite_valida_tipo_activo()'::regprocedure) AND a.grantee = 0)
          AND NOT has_function_privilege('auditor_role', 'siget.es_coordinador_vigente(int,int)', 'EXECUTE')
          AND NOT has_function_privilege('detector_role', 'siget.es_coordinador_vigente(int,int)', 'EXECUTE');
  PERFORM pg_temp.r(v_ok, 'las funciones nuevas: ninguna para PUBLIC; la aplicacion ejecuta solo las dos auxiliares');
  v_ok := (SELECT bool_and(prosecdef AND pg_get_userbyid(proowner) = 'siget_owner' AND proconfig = ARRAY['search_path=siget, pg_temp'])
             FROM pg_proc WHERE oid IN ('siget.es_coordinador_vigente(int,int)'::regprocedure, 'siget.tipo_tramite_valida()'::regprocedure,
                                        'siget.tipo_tramite_registra()'::regprocedure, 'siget.tramite_valida_tipo_activo()'::regprocedure));
  PERFORM pg_temp.r(v_ok, 'las funciones SECURITY DEFINER son del duenio y tienen la ruta de busqueda fija');
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
