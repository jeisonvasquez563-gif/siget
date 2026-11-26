-- ============================================================================
-- SIGET: pruebas de la migracion 021 (requisitos antes de iniciar y desistir de un tramite)
-- Se ejecuta como el superusuario del contenedor, DESPUES de aplicar la migracion, dentro de una transaccion que se
-- revierte (no deja nada guardado):  psql -v ON_ERROR_STOP=1 -f pruebas-ciudadania.sql  ... y termina en ROLLBACK.
-- Cada prueba imprime PASA o FALLA con RAISE NOTICE y al final hay un resumen.
-- Crea sus propias instituciones (p021_inst, p021_inst_b), personas (p021_*), tipos y tramites: no depende de datos reales (lo unico que
-- mira de los datos reales es que ningun tipo sembrado quede sin requisitos o con requisitos invalidos: vacuo si no hay ninguno).
-- Las comprobaciones se hacen COMO app_role con el contexto de cada persona (set_config('app.usuario_id', ...)), igual que la API.
-- No se usa psql -1 (el archivo ya trae su BEGIN y su ROLLBACK).
-- ADVERTENCIAS:
--  * La prueba del escalamiento corre siget.escalar_vencidos() sobre TODA la base: mientras dura el script escala (y bloquea) tambien los
--    tramites vencidos REALES. El ROLLBACK final lo deshace todo, pero esas filas quedan bloqueadas hasta entonces. Conviene correrlo fuera
--    de la hora en punto (el temporizador del escalador corre cada hora).
--  * Aun con ROLLBACK, correrlo consume valores de secuencias (ids de tramite, usuario, catalogo_cambio...): quedan huecos, no borrados.
--  * Las pruebas de 'sin contexto' entran como app_role con SET SESSION AUTHORIZATION (SET ROLE no cambia session_user, que mira la 020).
-- ============================================================================
BEGIN;

CREATE TEMP TABLE _res (ok boolean NOT NULL, texto text NOT NULL) ON COMMIT DROP;
CREATE TEMP TABLE _p021 (clave text PRIMARY KEY, id bigint NOT NULL) ON COMMIT DROP;
GRANT SELECT ON _p021 TO app_role;

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
CREATE FUNCTION pg_temp.ctx(p_usuario bigint, p_instituciones text DEFAULT '') RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('app.usuario_id', coalesce(p_usuario::text, ''), true);
  PERFORM set_config('app.instituciones', p_instituciones, true);
END $$;
CREATE FUNCTION pg_temp.id(p text) RETURNS bigint LANGUAGE sql AS $$ SELECT id FROM _p021 WHERE clave = p $$;
-- Intenta cambiar el estado de un tramite COMO `p_quien` (con el rol vigente), con ese motivo, y lo deshace siempre. Devuelve 'ok' si cambio
-- una fila, 'filas0' si la seguridad por filas no le dejo ver ninguna, o el SQLSTATE con el que fallo
CREATE FUNCTION pg_temp.estado_de(p_quien text, p_clave text, p_estado text, p_motivo text, p_instituciones text DEFAULT '') RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v_n int;
  v_d text;
BEGIN
  PERFORM set_config('app.usuario_id', coalesce(pg_temp.id(p_quien)::text, ''), true);
  PERFORM set_config('app.instituciones', p_instituciones, true);
  PERFORM set_config('siget.motivo', coalesce(p_motivo, ''), true);
  UPDATE siget.tramite SET estado = p_estado::siget.estado_tramite WHERE id = pg_temp.id(p_clave);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE EXCEPTION 'fin' USING ERRCODE = 'P0097', DETAIL = v_n::text;
EXCEPTION
  WHEN SQLSTATE 'P0097' THEN
    GET STACKED DIAGNOSTICS v_d = PG_EXCEPTION_DETAIL;
    RETURN CASE WHEN v_d::int = 1 THEN 'ok' ELSE 'filas0' END;
  WHEN OTHERS THEN RETURN SQLSTATE;
END $$;
-- Cambia el estado de verdad (sin deshacer) como el personal (la persona `u_func`), para preparar los casos
CREATE FUNCTION pg_temp.mover(p_clave text, p_estado text, p_motivo text DEFAULT NULL) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('app.usuario_id', pg_temp.id('u_func')::text, true);
  PERFORM set_config('siget.motivo', coalesce(p_motivo, ''), true);
  UPDATE siget.tramite SET estado = p_estado::siget.estado_tramite WHERE id = pg_temp.id(p_clave);
  PERFORM set_config('app.usuario_id', '', true);
END $$;
CREATE FUNCTION pg_temp.n(p_usuario text, p_tipo text, p_tramite text) RETURNS int LANGUAGE sql AS
  $$ SELECT count(*)::int FROM siget.notificacion WHERE usuario_id = pg_temp.id(p_usuario) AND tipo = p_tipo AND tramite_id = pg_temp.id(p_tramite) $$;
CREATE FUNCTION pg_temp.total(p_usuario text) RETURNS int LANGUAGE sql AS
  $$ SELECT count(*)::int FROM siget.notificacion WHERE usuario_id = pg_temp.id(p_usuario) $$;

-- ---------------------------------------------------------------------------
-- Preparacion (como el duenio, sin contexto de usuario): dos instituciones, personas y tipos
-- ---------------------------------------------------------------------------
SET LOCAL ROLE siget_owner;
INSERT INTO siget.institucion (nombre, tipo) VALUES ('p021_inst', 'demostracion'), ('p021_inst_b', 'demostracion');
INSERT INTO siget.usuario (username, password_hash) VALUES
  ('p021_asig', '!'), ('p021_ciud', '!'), ('p021_otra', '!'), ('p021_func', '!'), ('p021_funcrev', '!'), ('p021_funcsusp', '!'),
  ('p021_sup', '!'), ('p021_coord', '!'), ('p021_coordb', '!'), ('p021_opcat', '!');
UPDATE siget.usuario SET estado_cuenta = 'suspendida' WHERE username = 'p021_funcsusp';
INSERT INTO siget.membresia (usuario_id, institucion_id, rol, asignado_por)
  SELECT u.id, i.id, x.rol::siget.rol_membresia, a.id
    FROM (VALUES ('p021_func', 'p021_inst', 'funcionario'), ('p021_funcrev', 'p021_inst', 'funcionario'), ('p021_funcsusp', 'p021_inst', 'funcionario'),
                 ('p021_sup', 'p021_inst', 'supervisor'), ('p021_coord', 'p021_inst', 'coordinador_institucional'),
                 ('p021_coordb', 'p021_inst_b', 'coordinador_institucional')) AS x(usuario, institucion, rol)
    JOIN siget.usuario u ON u.username = x.usuario
    JOIN siget.institucion i ON i.nombre = x.institucion
    JOIN siget.usuario a ON a.username = 'p021_asig';
UPDATE siget.membresia
   SET revocada_en = now(), revocada_por = (SELECT id FROM siget.usuario WHERE username = 'p021_asig')
 WHERE usuario_id = (SELECT id FROM siget.usuario WHERE username = 'p021_funcrev');
UPDATE siget.usuario SET rol_plataforma = 'operador_catalogo' WHERE username = 'p021_opcat';
INSERT INTO siget.tipo_tramite (institucion_id, nombre, sla_dias)
  SELECT id, 'p021 base ' || right(nombre, 1), 10 FROM siget.institucion WHERE nombre IN ('p021_inst', 'p021_inst_b');
RESET ROLE;

INSERT INTO _p021 SELECT substr(username, 6) , id FROM siget.usuario WHERE username LIKE 'p021\_%';
UPDATE _p021 SET clave = 'u_' || clave;
INSERT INTO _p021 SELECT 'inst', id FROM siget.institucion WHERE nombre = 'p021_inst';
INSERT INTO _p021 SELECT 'inst_b', id FROM siget.institucion WHERE nombre = 'p021_inst_b';
INSERT INTO _p021 SELECT 'tipo', id FROM siget.tipo_tramite WHERE nombre = 'p021 base t';
INSERT INTO _p021 SELECT 'tipo_b', id FROM siget.tipo_tramite WHERE nombre = 'p021 base b';

-- Los tramites: cada uno con su clave. Los dos 'v*' ya vencieron. 'otro' es de otra persona
DO $$
DECLARE
  v_k  text;
  v_id bigint;
BEGIN
  FOREACH v_k IN ARRAY ARRAY['pend', 'tram', 'sub', 'apr', 'rec', 'n1', 'n2', 'n3', 'n4', 'ven', 'venctl', 'otro'] LOOP
    INSERT INTO siget.tramite (tipo_tramite_id, institucion_id, solicitante_id, fecha_limite)
    VALUES (pg_temp.id('tipo'), pg_temp.id('inst'), CASE WHEN v_k = 'otro' THEN pg_temp.id('u_otra') ELSE pg_temp.id('u_ciud') END,
            CASE WHEN v_k IN ('ven', 'venctl') THEN now() - interval '3 days' ELSE now() + interval '5 days' END)
    RETURNING id INTO v_id;
    INSERT INTO _p021 VALUES (v_k, v_id);
  END LOOP;
  IF (SELECT count(*) FROM _p021) <> 26 THEN
    RAISE EXCEPTION 'La preparacion de la prueba fallo: % ids en vez de 26', (SELECT count(*) FROM _p021);
  END IF;
  -- A cada estado
  PERFORM pg_temp.mover('tram', 'En Tramitacion');
  PERFORM pg_temp.mover('sub', 'En Tramitacion');
  PERFORM pg_temp.mover('sub', 'En Subsanacion', 'Falta el plano firmado del terreno.');
  PERFORM pg_temp.mover('apr', 'En Tramitacion');
  PERFORM pg_temp.mover('apr', 'Aprobado');
  PERFORM pg_temp.mover('rec', 'En Tramitacion');
  PERFORM pg_temp.mover('rec', 'Rechazado', 'No cumple con los requisitos del tramite.');
  FOREACH v_k IN ARRAY ARRAY['n1', 'n2', 'n3', 'n4', 'ven', 'venctl', 'otro'] LOOP
    PERFORM pg_temp.mover(v_k, 'En Tramitacion');
  END LOOP;
  -- A quien atiende: n1 y tram, la persona vigente; n2 la que ya no tiene acceso; n4 la de la cuenta suspendida; n3 nadie
  UPDATE siget.tramite SET funcionario_asignado_id = pg_temp.id('u_func') WHERE id IN (pg_temp.id('tram'), pg_temp.id('sub'), pg_temp.id('n1'));
  UPDATE siget.tramite SET funcionario_asignado_id = pg_temp.id('u_funcrev') WHERE id = pg_temp.id('n2');
  UPDATE siget.tramite SET funcionario_asignado_id = pg_temp.id('u_funcsusp') WHERE id = pg_temp.id('n4');
END $$;

-- ---------------------------------------------------------------------------
-- 1. Requisitos: estructura
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_caso record;
  v_fallas text[] := '{}';
  v_ok_docs jsonb := (SELECT jsonb_agg('Documento ' || g) FROM generate_series(1, 15) g);
  v_mal_docs jsonb := (SELECT jsonb_agg('Documento ' || g) FROM generate_series(1, 16) g);
BEGIN
  PERFORM pg_temp.r(siget.requisitos_invalido('{}'::jsonb) IS NULL, 'los requisitos vacios ({}) son validos: lo que no se dijo, no esta');
  PERFORM pg_temp.r(siget.requisitos_invalido(jsonb_build_object('descripcion', repeat('d', 1000), 'despues', repeat('p', 1000),
                                                                   'documentos', v_ok_docs)) IS NULL
                    AND siget.requisitos_invalido(jsonb_build_object('documentos', jsonb_build_array(repeat('x', 200)))) IS NULL
                    AND siget.requisitos_invalido('{"descripcion": "Para qué sirve.\nEn dos líneas.", "documentos": [], "despues": ""}'::jsonb) IS NULL
                    AND siget.requisitos_invalido('{"despues": "Solo esto"}'::jsonb) IS NULL,
                    'los limites exactos se admiten (textos de 1000, 15 documentos, documento de 200, salto de linea, lista vacia, una sola clave)');
  FOR v_caso IN SELECT * FROM (VALUES
    ('es una lista', '[]'::jsonb),
    ('es un texto', '"hola"'::jsonb),
    ('es null de JSON', 'null'::jsonb),
    ('clave desconocida', '{"otra": "x"}'::jsonb),
    ('clave desconocida junto a las buenas', '{"descripcion": "x", "plazo": 5}'::jsonb),
    ('descripcion de 1001', jsonb_build_object('descripcion', repeat('d', 1001))),
    ('descripcion que no es texto', '{"descripcion": 5}'::jsonb),
    ('descripcion nula', '{"descripcion": null}'::jsonb),
    ('descripcion con caracter de control', jsonb_build_object('descripcion', 'a' || chr(1) || 'b')),
    ('despues de 1001', jsonb_build_object('despues', repeat('p', 1001))),
    ('despues que no es texto', '{"despues": ["a"]}'::jsonb),
    ('documentos que no es lista', '{"documentos": "cedula"}'::jsonb),
    ('documentos que es un objeto', '{"documentos": {"a": "b"}}'::jsonb),
    ('16 documentos', jsonb_build_object('documentos', v_mal_docs)),
    ('documento que no es texto', '{"documentos": ["a", 5]}'::jsonb),
    ('documento vacio', '{"documentos": [""]}'::jsonb),
    ('documento de solo espacios', '{"documentos": ["   "]}'::jsonb),
    ('documento de 201', jsonb_build_object('documentos', jsonb_build_array(repeat('x', 201)))),
    ('documento con salto de linea', jsonb_build_object('documentos', jsonb_build_array('uno' || chr(10) || 'dos'))),
    ('documento con caracter de control', jsonb_build_object('documentos', jsonb_build_array('uno' || chr(7))))
  ) AS t(nombre, valor) LOOP
    IF siget.requisitos_invalido(v_caso.valor) IS NULL THEN
      v_fallas := v_fallas || v_caso.nombre;
    END IF;
  END LOOP;
  PERFORM pg_temp.r(v_fallas = '{}', format('cada regla de los requisitos se rechaza; aceptados por error: %s', v_fallas));
  PERFORM pg_temp.r(NOT EXISTS (SELECT 1 FROM siget.tipo_tramite WHERE siget.requisitos_invalido(requisitos) IS NOT NULL),
                    'ningun tipo guardado tiene requisitos invalidos (los sembrados incluidos)');
  PERFORM pg_temp.r(NOT EXISTS (SELECT 1 FROM siget.tipo_tramite
                                 WHERE (nombre IN ('Permiso de Construcción Municipal', 'Solicitud o denuncia ciudadana', 'Registro empresarial simplificado',
                                                   'Solicitud interinstitucional de información') OR nombre LIKE 'Trámite de demostración (%)')
                                   AND (requisitos = '{}'::jsonb OR NOT (requisitos ? 'descripcion') OR NOT (requisitos ? 'despues')
                                        OR coalesce(jsonb_array_length(requisitos -> 'documentos'), 0) < 1)),
                    'los tipos sembrados quedaron con descripcion, documentos y que pasa despues');
END $$;

-- ---------------------------------------------------------------------------
-- 2. Requisitos: quien los escribe, version y registro
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_inst   int := pg_temp.id('inst');
  v_tipo   int := pg_temp.id('tipo');
  v_tipo_b int := pg_temp.id('tipo_b');
  v_buenos text := '{"descripcion": "Sirve para pedir algo.", "documentos": ["Cedula", "Plano"], "despues": "Se revisa."}';
  v_r jsonb := '{}'::jsonb;
  v_quien text;
  v_filas int;
  v_version_antes int;
  v_version_despues int;
  v_cambios_antes int;
BEGIN
  SELECT version INTO v_version_antes FROM siget.tipo_tramite WHERE id = v_tipo;
  SELECT count(*) INTO v_cambios_antes FROM siget.catalogo_cambio WHERE tipo_tramite_id = v_tipo;
  EXECUTE 'SET LOCAL ROLE app_role';
  PERFORM pg_temp.ctx(pg_temp.id('u_coord'));
  UPDATE siget.tipo_tramite SET requisitos = v_buenos::jsonb WHERE id = v_tipo;
  GET DIAGNOSTICS v_filas = ROW_COUNT;
  v_r := v_r || jsonb_build_object('coord_edita', v_filas);
  -- Un alta real (se conserva para revisar el registro)
  INSERT INTO siget.tipo_tramite (institucion_id, nombre, sla_dias, requisitos) VALUES (v_inst, 'p021 alta real', 5, v_buenos::jsonb);
  -- Lo mismo otra vez: sin cambio real, ni version ni registro
  UPDATE siget.tipo_tramite SET requisitos = v_buenos::jsonb WHERE id = v_tipo;
  -- La coordinacion con requisitos malos: lo rechaza el disparador (P0001)
  v_r := v_r || jsonb_build_object(
    'coord_malos', pg_temp.intenta(format('UPDATE siget.tipo_tramite SET requisitos = %L::jsonb WHERE id = %s', '{"documentos": "x"}', v_tipo)),
    'coord_lista', pg_temp.intenta(format('UPDATE siget.tipo_tramite SET requisitos = %L::jsonb WHERE id = %s', '[]', v_tipo)),
    'coord_alta_con_requisitos', pg_temp.intenta(format('INSERT INTO siget.tipo_tramite (institucion_id, nombre, sla_dias, requisitos) VALUES (%s, %L, 5, %L::jsonb)',
                                                         v_inst, 'p021 alta con requisitos', v_buenos)),
    'coord_alta_mala', pg_temp.intenta(format('INSERT INTO siget.tipo_tramite (institucion_id, nombre, sla_dias, requisitos) VALUES (%s, %L, 5, %L::jsonb)',
                                               v_inst, 'p021 alta mala', '{"nada": 1}')));
  -- Quienes NO pueden escribir requisitos: la coordinacion de otra institucion, el personal, la ciudadania, la plataforma y la revocada
  FOREACH v_quien IN ARRAY ARRAY['u_coordb', 'u_func', 'u_sup', 'u_ciud', 'u_opcat', 'u_funcrev'] LOOP
    PERFORM pg_temp.ctx(pg_temp.id(v_quien), v_inst::text);
    v_r := v_r || jsonb_build_object(v_quien, pg_temp.intenta(format('UPDATE siget.tipo_tramite SET requisitos = %L::jsonb WHERE id = %s', v_buenos, v_tipo)));
  END LOOP;
  PERFORM pg_temp.ctx(pg_temp.id('u_coord'));
  v_r := v_r || jsonb_build_object('coord_en_b', pg_temp.intenta(format('UPDATE siget.tipo_tramite SET requisitos = %L::jsonb WHERE id = %s', v_buenos, v_tipo_b)),
                                   'coord_borra', pg_temp.intenta(format('DELETE FROM siget.tipo_tramite WHERE id = %s', v_tipo)));
  PERFORM pg_temp.ctx(NULL);
  RESET ROLE;
  SELECT version INTO v_version_despues FROM siget.tipo_tramite WHERE id = v_tipo;

  PERFORM pg_temp.r((v_r ->> 'coord_edita')::int = 1 AND (SELECT requisitos = v_buenos::jsonb FROM siget.tipo_tramite WHERE id = v_tipo),
                    'la coordinacion de la institucion escribe los requisitos de su tipo');
  PERFORM pg_temp.r(v_r ->> 'coord_malos' = 'P0001' AND v_r ->> 'coord_lista' = 'P0001' AND v_r ->> 'coord_alta_mala' = 'P0001',
                    'requisitos mal formados (en un cambio o en un alta) se rechazan en la base (P0001)');
  PERFORM pg_temp.r(v_r ->> 'coord_alta_con_requisitos' = 'sin_error', 'un alta con requisitos validos se admite');
  PERFORM pg_temp.r(v_r ->> 'u_coordb' = '42501' AND v_r ->> 'u_func' = '42501' AND v_r ->> 'u_sup' = '42501' AND v_r ->> 'u_ciud' = '42501'
                    AND v_r ->> 'u_opcat' = '42501' AND v_r ->> 'u_funcrev' = '42501' AND v_r ->> 'coord_en_b' = '42501',
                    'ni otra coordinacion, ni el personal, ni la ciudadania, ni la plataforma, ni la coordinacion revocada escriben requisitos (42501)');
  PERFORM pg_temp.r(v_r ->> 'coord_borra' = '42501', 'nadie borra un tipo (sin DELETE)');
  PERFORM pg_temp.r(v_version_despues = v_version_antes + 1, format('cambiar los requisitos sube la version en uno (de %s a %s) y repetirlos no la sube', v_version_antes, v_version_despues));
  PERFORM pg_temp.r((SELECT count(*) FROM siget.catalogo_cambio WHERE tipo_tramite_id = v_tipo) = v_cambios_antes + 1
                    AND EXISTS (SELECT 1 FROM siget.catalogo_cambio c WHERE c.tipo_tramite_id = v_tipo AND c.accion = 'cambio'
                                   AND c.despues = jsonb_build_object('requisitos', v_buenos::jsonb) AND c.antes ? 'requisitos'
                                   AND c.actor_id = pg_temp.id('u_coord')),
                    'el cambio queda en catalogo_cambio, solo con los requisitos, a nombre de la coordinacion; repetirlo no deja registro');
  PERFORM pg_temp.r((SELECT despues ? 'requisitos' AND (despues -> 'requisitos') = v_buenos::jsonb FROM siget.catalogo_cambio
                      WHERE accion = 'alta' AND despues ->> 'nombre' = 'p021 alta real'),
                    'el alta guarda la foto completa, requisitos incluidos');
END $$;

-- Sin contexto de usuario: app_role no escribe requisitos; el duenio si (asi se cargan los de los tipos sembrados)
DO $$
DECLARE
  v_tipo int := pg_temp.id('tipo');
  v_coord int := pg_temp.id('u_coord');
  v_r jsonb := '{}'::jsonb;
  v_sesion text;
BEGIN
  EXECUTE 'SET LOCAL SESSION AUTHORIZATION app_role';
  v_sesion := session_user;
  PERFORM pg_temp.ctx(NULL);
  v_r := v_r || jsonb_build_object('app_sin_contexto', pg_temp.intenta(format('UPDATE siget.tipo_tramite SET requisitos = %L::jsonb WHERE id = %s', '{"despues": "x"}', v_tipo)));
  PERFORM pg_temp.ctx(v_coord);
  v_r := v_r || jsonb_build_object('app_con_contexto', pg_temp.intenta(format('UPDATE siget.tipo_tramite SET requisitos = %L::jsonb WHERE id = %s', '{"despues": "x"}', v_tipo)));
  PERFORM pg_temp.ctx(NULL);
  EXECUTE 'RESET SESSION AUTHORIZATION';
  EXECUTE 'SET LOCAL ROLE siget_owner';
  v_r := v_r || jsonb_build_object('duenio', pg_temp.intenta(format('UPDATE siget.tipo_tramite SET requisitos = %L::jsonb WHERE id = %s', '{"despues": "x"}', v_tipo)),
                                   'duenio_malo', pg_temp.intenta(format('UPDATE siget.tipo_tramite SET requisitos = %L::jsonb WHERE id = %s', '{"x": 1}', v_tipo)));
  RESET ROLE;
  PERFORM pg_temp.r(v_sesion = 'app_role' AND v_r ->> 'app_sin_contexto' = '42501' AND v_r ->> 'app_con_contexto' = 'sin_error',
                    'app_role SIN contexto no escribe requisitos (42501); con el contexto de la coordinacion, si');
  PERFORM pg_temp.r(v_r ->> 'duenio' = 'sin_error' AND v_r ->> 'duenio_malo' = 'P0001',
                    'el duenio sin contexto los escribe (migraciones), pero sus requisitos tambien se validan');
END $$;

-- Permisos: UPDATE solo de la columna que corresponde y funcion sin PUBLIC
DO $$
DECLARE
  v_rol text;
BEGIN
  PERFORM pg_temp.r(has_column_privilege('app_role', 'siget.tipo_tramite', 'requisitos', 'UPDATE')
                    AND has_column_privilege('app_role', 'siget.tipo_tramite', 'formulario', 'UPDATE')
                    AND NOT has_column_privilege('app_role', 'siget.tipo_tramite', 'version', 'UPDATE')
                    AND NOT has_column_privilege('app_role', 'siget.tipo_tramite', 'institucion_id', 'UPDATE')
                    AND NOT has_table_privilege('app_role', 'siget.tipo_tramite', 'DELETE'),
                    'app_role actualiza requisitos (y lo de la 020), pero no version, institucion_id ni borra');
  FOREACH v_rol IN ARRAY ARRAY['pgadmin_lectura', 'checkpoint_app', 'escalador_role', 'detector_role', 'auditor_role'] LOOP
    PERFORM pg_temp.r(NOT has_column_privilege(v_rol, 'siget.tipo_tramite', 'requisitos', 'UPDATE'), format('%s no escribe los requisitos', v_rol));
  END LOOP;
  PERFORM pg_temp.r(has_function_privilege('app_role', 'siget.requisitos_invalido(jsonb)', 'EXECUTE')
                    AND NOT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a WHERE p.oid = 'siget.requisitos_invalido(jsonb)'::regprocedure AND a.grantee = 0)
                    AND (SELECT bool_and(prosecdef AND pg_get_userbyid(proowner) = 'siget_owner' AND proconfig = ARRAY['search_path=siget, pg_temp'])
                           FROM pg_proc WHERE oid IN ('siget.tipo_tramite_valida()'::regprocedure, 'siget.tipo_tramite_registra()'::regprocedure,
                                                      'siget.generar_notificaciones()'::regprocedure, 'siget.documento_valida()'::regprocedure,
                                                      'siget.escalar_vencidos()'::regprocedure, 'siget.tramites_abiertos_de(int,int)'::regprocedure)),
                    'requisitos_invalido: ninguna para PUBLIC; las funciones reemplazadas siguen siendo SECURITY DEFINER, del duenio y con la ruta fija');
END $$;

-- ---------------------------------------------------------------------------
-- 3. Desistir: la maquina de estados
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM pg_temp.r((SELECT count(*) FROM siget.transicion WHERE hasta = 'Desistido') = 3
                    AND (SELECT count(*) FROM siget.transicion WHERE desde = 'Desistido') = 0
                    AND NOT EXISTS (SELECT 1 FROM siget.transicion WHERE hasta = 'Desistido' AND desde IN ('Aprobado', 'Rechazado')),
                    'Desistido: tres transiciones de entrada (Pendiente, En Tramitacion, En Subsanacion), ninguna desde Aprobado ni Rechazado y ninguna de salida (es final)');
  PERFORM pg_temp.r(EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'siget' AND tablename = 'tramite' AND policyname = 'tramite_desistir' AND cmd = 'UPDATE'),
                    'existe la politica de seguridad por filas tramite_desistir');
END $$;

-- La persona solicitante (como app_role, con su contexto y sin instituciones) y los demas, sobre cada estado
DO $$
DECLARE
  v_r jsonb := '{}'::jsonb;
  v_e text;
  v_motivo constant text := 'Ya no necesito este tramite.';
BEGIN
  EXECUTE 'SET LOCAL ROLE app_role';
  -- El solicitante desiste desde cada estado no final, con motivo
  v_r := v_r || jsonb_build_object(
    'sol_pendiente', pg_temp.estado_de('u_ciud', 'pend', 'Desistido', v_motivo),
    'sol_tramitacion', pg_temp.estado_de('u_ciud', 'tram', 'Desistido', v_motivo),
    'sol_subsanacion', pg_temp.estado_de('u_ciud', 'sub', 'Desistido', v_motivo),
    -- Con el limite exacto del motivo: 10 y 2000 caracteres
    'sol_motivo_10', pg_temp.estado_de('u_ciud', 'pend', 'Desistido', repeat('a', 10)),
    'sol_motivo_2000', pg_temp.estado_de('u_ciud', 'pend', 'Desistido', repeat('a', 2000)));
  -- Sin motivo, o con uno que no vale
  FOREACH v_e IN ARRAY ARRAY['sin_motivo', 'corto', 'espacios', 'sin_letras', 'de_2001', 'con_control'] LOOP
    v_r := v_r || jsonb_build_object('sol_' || v_e, pg_temp.estado_de('u_ciud', 'tram', 'Desistido',
      CASE v_e WHEN 'sin_motivo' THEN '' WHEN 'corto' THEN 'ya no' WHEN 'espacios' THEN repeat(' ', 12) WHEN 'sin_letras' THEN '!!!!!!!!!!!!'
               WHEN 'de_2001' THEN repeat('a', 2001) ELSE 'Ya no lo necesito' || chr(7) || 'mas' END));
  END LOOP;
  -- Desde un estado final: ni la politica (no es una fila desistible) ni, mas abajo, la base
  v_r := v_r || jsonb_build_object(
    'sol_aprobado', pg_temp.estado_de('u_ciud', 'apr', 'Desistido', v_motivo),
    'sol_rechazado', pg_temp.estado_de('u_ciud', 'rec', 'Desistido', v_motivo));
  -- El personal de la institucion (con su contexto de instituciones), la supervision, la coordinacion y las personas ajenas
  v_r := v_r || jsonb_build_object(
    'func', pg_temp.estado_de('u_func', 'tram', 'Desistido', v_motivo, pg_temp.id('inst')::text),
    'sup', pg_temp.estado_de('u_sup', 'pend', 'Desistido', v_motivo, pg_temp.id('inst')::text),
    'coord', pg_temp.estado_de('u_coord', 'pend', 'Desistido', v_motivo),
    'otra', pg_temp.estado_de('u_otra', 'pend', 'Desistido', v_motivo),
    'ajeno', pg_temp.estado_de('u_ciud', 'otro', 'Desistido', v_motivo),
    'opcat', pg_temp.estado_de('u_opcat', 'pend', 'Desistido', v_motivo));
  -- La persona solicitante NO puede aprovechar la politica para otra cosa
  v_r := v_r || jsonb_build_object(
    'sol_a_tramitacion', pg_temp.estado_de('u_ciud', 'pend', 'En Tramitacion', v_motivo),
    'sol_a_aprobado', pg_temp.estado_de('u_ciud', 'tram', 'Aprobado', v_motivo),
    'sol_a_rechazado', pg_temp.estado_de('u_ciud', 'tram', 'Rechazado', v_motivo),
    'sol_pide_subsanacion', pg_temp.estado_de('u_ciud', 'tram', 'En Subsanacion', v_motivo));
  -- ... ni cambiar a quien atiende, ni los datos, junto con desistir (estado_de ya deshizo su contexto: se fija de nuevo)
  PERFORM pg_temp.ctx(pg_temp.id('u_ciud'));
  PERFORM set_config('siget.motivo', v_motivo, true);
  v_r := v_r || jsonb_build_object(
    'sol_y_reasigna', pg_temp.intenta(format('UPDATE siget.tramite SET estado = %L, funcionario_asignado_id = NULL WHERE id = %s', 'Desistido', pg_temp.id('tram'))),
    'sol_y_datos', pg_temp.intenta(format('UPDATE siget.tramite SET estado = %L, datos = %L::jsonb WHERE id = %s', 'Desistido', '{"asunto": "otro"}', pg_temp.id('tram'))));
  RESET ROLE;

  PERFORM pg_temp.r(v_r ->> 'sol_pendiente' = 'ok', 'la persona solicitante desiste desde Pendiente, con motivo');
  PERFORM pg_temp.r(v_r ->> 'sol_tramitacion' = 'ok', 'la persona solicitante desiste desde En Tramitacion, con motivo');
  PERFORM pg_temp.r(v_r ->> 'sol_subsanacion' = 'ok', 'la persona solicitante desiste desde En Subsanacion, con motivo');
  PERFORM pg_temp.r(v_r ->> 'sol_motivo_10' = 'ok' AND v_r ->> 'sol_motivo_2000' = 'ok', 'los motivos de 10 y de 2000 caracteres se admiten');
  PERFORM pg_temp.r(v_r ->> 'sol_sin_motivo' = 'P0001' AND v_r ->> 'sol_corto' = 'P0001' AND v_r ->> 'sol_espacios' = 'P0001'
                    AND v_r ->> 'sol_sin_letras' = 'P0001' AND v_r ->> 'sol_de_2001' = 'P0001' AND v_r ->> 'sol_con_control' = 'P0001',
                    'sin motivo, con uno corto, de solo espacios, sin letras, de 2001 caracteres o con caracteres de control: la base lo rechaza (P0001)');
  PERFORM pg_temp.r(v_r ->> 'sol_aprobado' = 'filas0' AND v_r ->> 'sol_rechazado' = 'filas0',
                    'desde Aprobado o Rechazado la persona no desiste (la seguridad por filas no le deja ninguna fila)');
  PERFORM pg_temp.r(v_r ->> 'func' = 'P0001' AND v_r ->> 'sup' = 'P0001',
                    'el personal y la supervision de la institucion NO ponen Desistido (la base lo rechaza: solo la persona solicitante)');
  PERFORM pg_temp.r(v_r ->> 'coord' = 'filas0' AND v_r ->> 'otra' = 'filas0' AND v_r ->> 'opcat' = 'filas0',
                    'ni la coordinacion, ni otra persona, ni la plataforma ven una fila que puedan desistir');
  PERFORM pg_temp.r(v_r ->> 'ajeno' = 'filas0', 'una persona no desiste del tramite de otra');
  PERFORM pg_temp.r(v_r ->> 'sol_a_tramitacion' = 'P0001' AND v_r ->> 'sol_a_aprobado' <> 'ok' AND v_r ->> 'sol_a_rechazado' <> 'ok'
                    AND v_r ->> 'sol_pide_subsanacion' <> 'ok',
                    'la politica de desistir no deja a la persona solicitante decidir su propio tramite (ni tomarlo, ni aprobarlo, ni rechazarlo)');
  PERFORM pg_temp.r(v_r ->> 'sol_y_reasigna' = 'P0001' AND v_r ->> 'sol_y_datos' = 'P0001',
                    'desistir no se combina con cambiar a quien atiende ni con cambiar los datos (P0001)');
END $$;

-- Con el dueño o el superusuario (sin la seguridad por filas): la regla de la persona solicitante y los estados finales los impone el disparador
DO $$
DECLARE
  v_r jsonb := '{}'::jsonb;
  v_motivo constant text := 'Ya no necesito este tramite.';
BEGIN
  v_r := v_r || jsonb_build_object(
    'sin_contexto', pg_temp.estado_de(NULL, 'pend', 'Desistido', v_motivo),
    'personal', pg_temp.estado_de('u_func', 'pend', 'Desistido', v_motivo),
    'otra', pg_temp.estado_de('u_otra', 'pend', 'Desistido', v_motivo),
    'solicitante', pg_temp.estado_de('u_ciud', 'pend', 'Desistido', v_motivo),
    'desde_aprobado', pg_temp.estado_de('u_ciud', 'apr', 'Desistido', v_motivo),
    'desde_rechazado', pg_temp.estado_de('u_ciud', 'rec', 'Desistido', v_motivo));
  PERFORM pg_temp.r(v_r ->> 'sin_contexto' = 'P0001' AND v_r ->> 'personal' = 'P0001' AND v_r ->> 'otra' = 'P0001',
                    'a nivel de la tabla, nadie que no sea la persona solicitante pone Desistido (ni el personal, ni otra persona, ni el sistema sin contexto)');
  PERFORM pg_temp.r(v_r ->> 'solicitante' = 'ok', 'a nivel de la tabla, la persona solicitante si (con motivo)');
  PERFORM pg_temp.r(v_r ->> 'desde_aprobado' = 'P0001' AND v_r ->> 'desde_rechazado' = 'P0001',
                    'desde Aprobado o Rechazado no hay transicion a Desistido (P0001), tampoco para la persona solicitante');
END $$;

-- ---------------------------------------------------------------------------
-- 4. Desistir de verdad: auditoria, notificaciones, equipo, escalamiento y documentos
-- ---------------------------------------------------------------------------
-- Antes: lo que cuenta como abierto para quien atiende
CREATE TEMP TABLE _antes (abiertos int) ON COMMIT DROP;
INSERT INTO _antes SELECT siget.tramites_abiertos_de(pg_temp.id('u_func')::int, pg_temp.id('inst')::int);

DO $$
DECLARE
  v_clave text;
BEGIN
  -- Como lo haria la API: app_role, el contexto de la persona solicitante (sin instituciones) y el motivo local a la transaccion
  EXECUTE 'SET LOCAL ROLE app_role';
  FOREACH v_clave IN ARRAY ARRAY['n1', 'n2', 'n3', 'n4', 'ven'] LOOP
    PERFORM pg_temp.ctx(pg_temp.id('u_ciud'));
    PERFORM set_config('siget.motivo', 'Ya no necesito este tramite (' || v_clave || ').', true);
    UPDATE siget.tramite SET estado = 'Desistido' WHERE id = pg_temp.id(v_clave);
    IF NOT FOUND THEN
      RAISE EXCEPTION 'El tramite % no se pudo desistir como app_role', v_clave;
    END IF;
  END LOOP;
  PERFORM pg_temp.ctx(NULL);
  RESET ROLE;
END $$;

DO $$
DECLARE
  v_ok boolean;
  v_eventos int;
  v_antes int := (SELECT abiertos FROM _antes);
  v_despues int;
BEGIN
  -- La auditoria guarda el cambio, quien lo hizo y el motivo
  SELECT count(*) INTO v_eventos FROM siget.evento_auditoria
   WHERE tramite_id = pg_temp.id('n1') AND accion = 'cambio_estado' AND estado_anterior = 'En Tramitacion' AND estado_nuevo = 'Desistido'
     AND actor_id = pg_temp.id('u_ciud') AND atributos ->> 'motivo' = 'Ya no necesito este tramite (n1).';
  PERFORM pg_temp.r(v_eventos = 1, 'desistir deja un evento de auditoria con quien fue y el motivo');
  PERFORM pg_temp.r((SELECT estado = 'Desistido' FROM siget.tramite WHERE id = pg_temp.id('n1')), 'el tramite quedo Desistido');

  -- Notificaciones: al funcionario asignado si conserva acceso y cuenta activa; a nadie mas
  PERFORM pg_temp.r(pg_temp.n('u_func', 'tramite_desistido', 'n1') = 1, 'se avisa al funcionario asignado (tramite_desistido)');
  PERFORM pg_temp.r(pg_temp.n('u_funcrev', 'tramite_desistido', 'n2') = 0 AND pg_temp.total('u_funcrev') = 0,
                    'a quien ya no tiene acceso a la institucion no se le avisa');
  PERFORM pg_temp.r(pg_temp.n('u_funcsusp', 'tramite_desistido', 'n4') = 0 AND pg_temp.total('u_funcsusp') = 0,
                    'a quien tiene la cuenta suspendida no se le avisa');
  PERFORM pg_temp.r(NOT EXISTS (SELECT 1 FROM siget.notificacion WHERE tramite_id = pg_temp.id('n3'))
                    AND NOT EXISTS (SELECT 1 FROM siget.notificacion WHERE tipo = 'tramite_desistido'
                                       AND usuario_id IN (pg_temp.id('u_sup'), pg_temp.id('u_coord'), pg_temp.id('u_otra'))),
                    'sin funcionario asignado no se avisa a nadie, y la supervision, la coordinacion y otras personas no reciben nada');
  PERFORM pg_temp.r(NOT EXISTS (SELECT 1 FROM siget.notificacion WHERE usuario_id = pg_temp.id('u_ciud') AND tipo = 'tramite_desistido'),
                    'la persona que desiste no se avisa a si misma');

  -- Equipo (011): un tramite desistido ya no es abierto (n1 era de u_func)
  v_despues := siget.tramites_abiertos_de(pg_temp.id('u_func')::int, pg_temp.id('inst')::int);
  PERFORM pg_temp.r(v_despues = v_antes - 1, format('tramites_abiertos_de no cuenta el desistido (de %s a %s)', v_antes, v_despues));

  -- Un desistido es final: nadie lo reabre
  PERFORM pg_temp.r(pg_temp.estado_de('u_func', 'n3', 'En Tramitacion', 'Lo retomo el personal.') = 'P0001'
                    AND pg_temp.estado_de('u_ciud', 'n3', 'En Tramitacion', 'Lo retomo la persona.') = 'P0001'
                    AND pg_temp.estado_de('u_func', 'n3', 'Aprobado', NULL) = 'P0001'
                    AND pg_temp.estado_de('u_ciud', 'n3', 'Aprobado', 'No deberia poder hacerlo.') = 'P0001',
                    'un tramite desistido no vuelve a ningun estado (Desistido es final)');
END $$;

-- Escalamiento (013): un desistido vencido no se escala; uno igual de vencido y abierto, si. (Corre sobre toda la base: ver las advertencias)
DO $$
DECLARE
  v_escalados int;
BEGIN
  v_escalados := siget.escalar_vencidos();
  PERFORM pg_temp.r((SELECT escalado_en IS NULL FROM siget.tramite WHERE id = pg_temp.id('ven')), 'un tramite desistido y vencido no se escala');
  PERFORM pg_temp.r((SELECT escalado_en IS NOT NULL FROM siget.tramite WHERE id = pg_temp.id('venctl')),
                    format('el de control, igual de vencido pero abierto, si se escala (escalar_vencidos escalo %s en total)', v_escalados));
  PERFORM pg_temp.r(NOT EXISTS (SELECT 1 FROM siget.evento_auditoria WHERE tramite_id = pg_temp.id('ven') AND accion = 'escalamiento')
                    AND NOT EXISTS (SELECT 1 FROM siget.notificacion WHERE tramite_id = pg_temp.id('ven') AND tipo = 'tramite_escalado'),
                    'ni evento de escalamiento ni aviso a la supervision para el desistido');
  PERFORM pg_temp.r(EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'siget' AND indexname = 'tramite_vencidos_sin_escalar' AND indexdef LIKE '%Desistido%'),
                    'el indice parcial de vencidos sin escalar excluye tambien a los desistidos');
END $$;

-- Documentos (015): un tramite desistido no admite documentos; uno abierto, si
DO $$
DECLARE
  v_r jsonb := '{}'::jsonb;
  v_inst int := pg_temp.id('inst');
  v_ciud int := pg_temp.id('u_ciud');
BEGIN
  v_r := v_r || jsonb_build_object(
    'desistido', pg_temp.intenta(format('INSERT INTO siget.documento (tramite_id, institucion_id, subido_por, nombre, tipo_mime, tamano, sha256, ubicacion) VALUES (%s, %s, %s, %L, %L, 10, %L, %L)',
                                         pg_temp.id('n3'), v_inst, v_ciud, 'plano.pdf', 'application/pdf', repeat('a', 64), repeat('b', 32))),
    'abierto', pg_temp.intenta(format('INSERT INTO siget.documento (tramite_id, institucion_id, subido_por, nombre, tipo_mime, tamano, sha256, ubicacion) VALUES (%s, %s, %s, %L, %L, 10, %L, %L)',
                                       pg_temp.id('pend'), v_inst, v_ciud, 'plano.pdf', 'application/pdf', repeat('a', 64), repeat('c', 32))));
  PERFORM pg_temp.r(v_r ->> 'desistido' = 'P0001', 'un tramite desistido no admite documentos');
  PERFORM pg_temp.r(v_r ->> 'abierto' = 'sin_error', 'uno abierto si (control)');
END $$;

-- Notificaciones: el tipo nuevo esta en el CHECK y los de antes siguen valiendo
DO $$
DECLARE
  v_r jsonb := '{}'::jsonb;
BEGIN
  v_r := v_r || jsonb_build_object(
    'nuevo', pg_temp.intenta(format('INSERT INTO siget.notificacion (usuario_id, tipo, tramite_id) VALUES (%s, %L, %s)', pg_temp.id('u_func'), 'tramite_desistido', pg_temp.id('pend'))),
    'viejo', pg_temp.intenta(format('INSERT INTO siget.notificacion (usuario_id, tipo, tramite_id) VALUES (%s, %L, %s)', pg_temp.id('u_func'), 'subsanacion_respondida', pg_temp.id('pend'))),
    'ajeno', pg_temp.intenta(format('INSERT INTO siget.notificacion (usuario_id, tipo, tramite_id) VALUES (%s, %L, %s)', pg_temp.id('u_func'), 'tramite_inventado', pg_temp.id('pend'))));
  PERFORM pg_temp.r(v_r ->> 'nuevo' = 'sin_error' AND v_r ->> 'viejo' = 'sin_error' AND v_r ->> 'ajeno' = '23514',
                    'el CHECK de notificacion admite tramite_desistido y los tipos anteriores, y rechaza lo desconocido');
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
