-- ============================================================================
-- SIGET: pruebas de la migracion 022 (indicadores de la institucion para la supervision y la coordinacion)
-- Se ejecuta como el superusuario del contenedor, DESPUES de aplicar la migracion, dentro de una transaccion que se
-- revierte (no deja nada guardado):  psql -v ON_ERROR_STOP=1 -f pruebas-indicadores.sql  ... y termina en ROLLBACK.
-- Cada prueba imprime PASA o FALLA con RAISE NOTICE y al final hay un resumen.
-- Crea sus propias instituciones (p022_inst_*), personas (p022_*) y tramites: no depende de datos reales. Las comprobaciones se hacen
-- COMO app_role con el contexto de cada persona (set_config('app.usuario_id', ...)), igual que la API.
-- No se usa psql -1 (el archivo ya trae su BEGIN y su ROLLBACK).
-- Aun con ROLLBACK, correrlo consume valores de secuencias (ids de usuario, tramite, evento_auditoria...): quedan huecos, no borrados.
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
-- Pide los indicadores de una institucion y devuelve el SQLSTATE con el que fallo, o 'sin_error'
CREATE FUNCTION pg_temp.pide(p_inst int) RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.intenta(format('SELECT siget.indicadores_institucion(%L)', p_inst))
$$;

-- ---------------------------------------------------------------------------
-- Preparacion (como el duenio, sin contexto de usuario). Los tramites se insertan YA en su estado: los disparadores de transicion y de
-- notificaciones son de UPDATE y no intervienen.
--   Institucion A: 8 tramites. Abiertos 5: t1 Pendiente sin asignar; t2 En Tramitacion vencido (func1); t3 En Tramitacion vencido y escalado
--   (func2); t4 En Subsanacion (func1); t9 En Tramitacion asignado por error a una persona de la ciudadania. Resueltos: t5 Aprobado en 10 dias,
--   t6 Rechazado en 20 dias (promedio 15,0) y t7 Aprobado hace 100 dias (fuera de los 90 dias).
--   Institucion B: un tramite abierto de otra persona, asignado a su funcionario.
-- ---------------------------------------------------------------------------
SET LOCAL ROLE siget_owner;
INSERT INTO siget.institucion (nombre, tipo) VALUES ('p022_inst_a', 'demostracion'), ('p022_inst_b', 'demostracion');
INSERT INTO siget.usuario (username, password_hash) VALUES
  ('p022_asig', '!'), ('p022_ciud', '!'), ('p022_ciud2', '!'), ('p022_func1', '!'), ('p022_func2', '!'), ('p022_sup_a', '!'), ('p022_sup_susp', '!'),
  ('p022_coord_a', '!'), ('p022_coord_rev', '!'), ('p022_func_b', '!'), ('p022_sup_b', '!'), ('p022_coord_b', '!');
INSERT INTO siget.usuario (username, password_hash, rol_plataforma) VALUES ('p022_opcat', '!', 'operador_catalogo');
UPDATE siget.usuario SET estado_cuenta = 'suspendida' WHERE username = 'p022_sup_susp';
INSERT INTO siget.membresia (usuario_id, institucion_id, rol, asignado_por)
  SELECT u.id, i.id, x.rol::siget.rol_membresia, a.id
    FROM (VALUES ('p022_func1', 'p022_inst_a', 'funcionario'), ('p022_func2', 'p022_inst_a', 'funcionario'), ('p022_sup_a', 'p022_inst_a', 'supervisor'),
                 ('p022_sup_susp', 'p022_inst_a', 'supervisor'), ('p022_coord_a', 'p022_inst_a', 'coordinador_institucional'),
                 ('p022_coord_rev', 'p022_inst_a', 'coordinador_institucional'),
                 ('p022_func_b', 'p022_inst_b', 'funcionario'), ('p022_sup_b', 'p022_inst_b', 'supervisor'),
                 ('p022_coord_b', 'p022_inst_b', 'coordinador_institucional')) AS x(usuario, institucion, rol)
    JOIN siget.usuario u ON u.username = x.usuario
    JOIN siget.institucion i ON i.nombre = x.institucion
    JOIN siget.usuario a ON a.username = 'p022_asig';
UPDATE siget.membresia
   SET revocada_en = now(), revocada_por = (SELECT id FROM siget.usuario WHERE username = 'p022_asig')
 WHERE usuario_id = (SELECT id FROM siget.usuario WHERE username = 'p022_coord_rev');
INSERT INTO siget.tipo_tramite (institucion_id, nombre, sla_dias)
  SELECT id, 'p022 tipo ' || right(nombre, 1), 5 FROM siget.institucion WHERE nombre IN ('p022_inst_a', 'p022_inst_b');

INSERT INTO siget.tramite (tipo_tramite_id, institucion_id, solicitante_id, funcionario_asignado_id, estado, fecha_limite, escalado_en, creado_en)
  SELECT tt.id, tt.institucion_id, c.id, f.id, x.estado, now() + x.limite, CASE WHEN x.escalado THEN now() END, now() - x.antiguedad
    FROM (VALUES ('t1', 'Pendiente',      NULL,          interval '3 days',  false, interval '1 day'),
                 ('t2', 'En Tramitacion', 'p022_func1',  interval '-2 days', false, interval '5 days'),
                 ('t3', 'En Tramitacion', 'p022_func2',  interval '-1 day',  true,  interval '5 days'),
                 ('t4', 'En Subsanacion', 'p022_func1',  interval '5 days',  false, interval '5 days'),
                 ('t9', 'En Tramitacion', 'p022_ciud2',  interval '5 days',  false, interval '5 days'),
                 ('t5', 'Aprobado',       'p022_func1',  interval '1 day',   false, interval '10 days'),
                 ('t6', 'Rechazado',      'p022_func2',  interval '1 day',   false, interval '20 days'),
                 ('t7', 'Aprobado',       'p022_func1',  interval '1 day',   false, interval '200 days')) AS x(clave, estado, funcionario, limite, escalado, antiguedad)
    JOIN siget.tipo_tramite tt ON tt.nombre = 'p022 tipo a'
    JOIN siget.usuario c ON c.username = 'p022_ciud'
    LEFT JOIN siget.usuario f ON f.username = x.funcionario
   ORDER BY x.clave;
INSERT INTO siget.tramite (tipo_tramite_id, institucion_id, solicitante_id, funcionario_asignado_id, estado, fecha_limite)
  SELECT tt.id, tt.institucion_id, c.id, f.id, 'En Tramitacion', now() + interval '3 days'
    FROM siget.tipo_tramite tt, siget.usuario c, siget.usuario f
   WHERE tt.nombre = 'p022 tipo b' AND c.username = 'p022_ciud2' AND f.username = 'p022_func_b';

-- El cambio de estado de los resueltos (el INSERT directo no dispara el registro de auditoria, que es de UPDATE): t5 y t6 hoy, t7 hace 100 dias
INSERT INTO siget.evento_auditoria (tramite_id, institucion_id, actor_id, accion, estado_anterior, estado_nuevo, creado_en)
  SELECT t.id, t.institucion_id, f.id, 'cambio_estado', 'En Tramitacion', t.estado,
         CASE WHEN t.creado_en < now() - interval '150 days' THEN now() - interval '100 days' ELSE now() END
    FROM siget.tramite t JOIN siget.usuario f ON f.id = t.funcionario_asignado_id
   WHERE t.estado IN ('Aprobado', 'Rechazado') AND t.institucion_id = (SELECT id FROM siget.institucion WHERE nombre = 'p022_inst_a');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 1. Quien puede pedir los indicadores y quien no
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_a int := (SELECT id FROM siget.institucion WHERE nombre = 'p022_inst_a');
  v_b int := (SELECT id FROM siget.institucion WHERE nombre = 'p022_inst_b');
  v_quien text;
  v_uid int;
  v_r jsonb := '{}'::jsonb;
BEGIN
  IF (SELECT count(*) FROM siget.tramite WHERE institucion_id = v_a) <> 8 OR (SELECT count(*) FROM siget.tramite WHERE institucion_id = v_b) <> 1 THEN
    RAISE EXCEPTION 'La preparacion de la prueba fallo: tramites de A = %, de B = %',
      (SELECT count(*) FROM siget.tramite WHERE institucion_id = v_a), (SELECT count(*) FROM siget.tramite WHERE institucion_id = v_b);
  END IF;

  FOR v_quien IN SELECT unnest(ARRAY['p022_sup_a', 'p022_coord_a', 'p022_func1', 'p022_ciud', 'p022_sup_b', 'p022_coord_b', 'p022_coord_rev',
                                     'p022_sup_susp', 'p022_opcat']) LOOP
    EXECUTE 'RESET ROLE';
    v_uid := (SELECT id FROM siget.usuario WHERE username = v_quien);
    EXECUTE 'SET LOCAL ROLE app_role';
    -- El contexto de instituciones no cuenta: la funcion mira las membresias vigentes, no lo que diga la aplicacion
    PERFORM pg_temp.ctx(v_uid, v_a::text);
    v_r := v_r || jsonb_build_object(v_quien || '_a', pg_temp.pide(v_a), v_quien || '_b', pg_temp.pide(v_b));
  END LOOP;

  -- Sin contexto, con un id nulo y con una institucion que no existe
  PERFORM pg_temp.ctx(NULL);
  v_r := v_r || jsonb_build_object('sin_contexto', pg_temp.pide(v_a));
  EXECUTE 'RESET ROLE';
  v_uid := (SELECT id FROM siget.usuario WHERE username = 'p022_sup_a');
  EXECUTE 'SET LOCAL ROLE app_role';
  PERFORM pg_temp.ctx(v_uid, v_a::text);
  v_r := v_r || jsonb_build_object('nulo', pg_temp.intenta('SELECT siget.indicadores_institucion(NULL)'),
                                   'inexistente', pg_temp.pide(-1));
  EXECUTE 'RESET ROLE';

  PERFORM pg_temp.r(v_r ->> 'p022_sup_a_a' = 'sin_error' AND v_r ->> 'p022_sup_a_b' = '42501',
                    'la supervision pide los indicadores de SU institucion y no los de otra (42501)');
  PERFORM pg_temp.r(v_r ->> 'p022_coord_a_a' = 'sin_error' AND v_r ->> 'p022_coord_a_b' = '42501',
                    'la coordinacion pide los indicadores de SU institucion y no los de otra (42501), aunque no vea tramites');
  PERFORM pg_temp.r(v_r ->> 'p022_func1_a' = '42501' AND v_r ->> 'p022_func1_b' = '42501',
                    'un funcionario no pide indicadores (42501)');
  PERFORM pg_temp.r(v_r ->> 'p022_ciud_a' = '42501' AND v_r ->> 'p022_ciud_b' = '42501',
                    'la ciudadania no pide indicadores (42501)');
  PERFORM pg_temp.r(v_r ->> 'p022_sup_b_a' = '42501' AND v_r ->> 'p022_coord_b_a' = '42501'
                    AND v_r ->> 'p022_sup_b_b' = 'sin_error' AND v_r ->> 'p022_coord_b_b' = 'sin_error',
                    'la supervision y la coordinacion de B no ven A, y si ven B');
  PERFORM pg_temp.r(v_r ->> 'p022_coord_rev_a' = '42501', 'una coordinacion con la membresia revocada ya no pide indicadores (42501)');
  PERFORM pg_temp.r(v_r ->> 'p022_sup_susp_a' = '42501', 'una supervision con la cuenta suspendida no pide indicadores (42501)');
  PERFORM pg_temp.r(v_r ->> 'p022_opcat_a' = '42501', 'un rol de plataforma no pide indicadores (42501)');
  PERFORM pg_temp.r(v_r ->> 'sin_contexto' = '42501', 'sin contexto de usuario no hay indicadores (42501)');
  PERFORM pg_temp.r(v_r ->> 'nulo' = '42501' AND v_r ->> 'inexistente' = '42501', 'una institucion nula o inexistente da 42501 y no revela si existe');
END $$;

-- ---------------------------------------------------------------------------
-- 2. Las cifras: con los datos de esta prueba
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_a int := (SELECT id FROM siget.institucion WHERE nombre = 'p022_inst_a');
  v_b int := (SELECT id FROM siget.institucion WHERE nombre = 'p022_inst_b');
  v_sup_a int := (SELECT id FROM siget.usuario WHERE username = 'p022_sup_a');
  v_coord_a int := (SELECT id FROM siget.usuario WHERE username = 'p022_coord_a');
  v_sup_b int := (SELECT id FROM siget.usuario WHERE username = 'p022_sup_b');
  v_ja jsonb;
  v_jc jsonb;
  v_jb jsonb;
BEGIN
  EXECUTE 'SET LOCAL ROLE app_role';
  PERFORM pg_temp.ctx(v_sup_a, v_a::text);
  v_ja := siget.indicadores_institucion(v_a);
  PERFORM pg_temp.ctx(v_coord_a, '');  -- la coordinacion no tiene instituciones en el contexto (no atiende tramites): igual obtiene las cifras
  v_jc := siget.indicadores_institucion(v_a);
  PERFORM pg_temp.ctx(v_sup_b, v_b::text);
  v_jb := siget.indicadores_institucion(v_b);
  EXECUTE 'RESET ROLE';

  PERFORM pg_temp.r(v_ja -> 'por_estado' = '{"Pendiente": 1, "En Tramitacion": 3, "En Subsanacion": 1, "Aprobado": 2, "Rechazado": 1}'::jsonb,
                    'conteo por estado de la institucion A: 1, 3, 1, 2 y 1 (los estados sin tramites salen en 0)');
  PERFORM pg_temp.r((v_ja ->> 'abiertos')::int = 5 AND (v_ja ->> 'vencidos')::int = 2 AND (v_ja ->> 'escalados_abiertos')::int = 1
                    AND (v_ja ->> 'sin_asignar')::int = 1,
                    'abiertos 5, vencidos 2 (los resueltos no cuentan), escalados abiertos 1 y sin asignar 1');
  PERFORM pg_temp.r((v_ja ->> 'resueltos_90_dias')::int = 2 AND (v_ja ->> 'dias_promedio_resolucion')::numeric = 15.0,
                    'tiempo promedio de resolucion 15,0 dias con 2 resueltos en 90 dias (el de hace 100 dias no cuenta)');
  PERFORM pg_temp.r(v_ja -> 'por_funcionario' = jsonb_build_array(
                         jsonb_build_object('usuario_id', (SELECT id FROM siget.usuario WHERE username = 'p022_func1'), 'usuario', 'p022_func1', 'abiertos', 2),
                         jsonb_build_object('usuario_id', (SELECT id FROM siget.usuario WHERE username = 'p022_func2'), 'usuario', 'p022_func2', 'abiertos', 1)),
                    'carga por funcionario: func1 con 2 y func2 con 1, de mayor a menor');
  PERFORM pg_temp.r(v_jc = v_ja, 'la coordinacion de A recibe exactamente las mismas cifras que la supervision de A');
  PERFORM pg_temp.r((v_jb ->> 'abiertos')::int = 1 AND (v_jb ->> 'vencidos')::int = 0 AND (v_jb ->> 'escalados_abiertos')::int = 0
                    AND (v_jb -> 'por_estado' ->> 'En Tramitacion')::int = 1 AND (v_jb ->> 'resueltos_90_dias')::int = 0 AND v_jb -> 'dias_promedio_resolucion' = 'null'::jsonb,
                    'B solo cuenta lo suyo: 1 abierto, sin vencidos ni resueltos (promedio nulo, no cero)');
  PERFORM pg_temp.r(jsonb_array_length(v_jb -> 'por_funcionario') = 1 AND v_jb -> 'por_funcionario' -> 0 ->> 'usuario' = 'p022_func_b',
                    'la carga de B solo nombra a su propio personal');
END $$;

-- ---------------------------------------------------------------------------
-- 3. Solo agregados: nada de la ciudadania ni identificadores de tramites
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_a int := (SELECT id FROM siget.institucion WHERE nombre = 'p022_inst_a');
  v_sup_a int := (SELECT id FROM siget.usuario WHERE username = 'p022_sup_a');
  v_j jsonb;
  v_texto text;
  v_claves text[];
BEGIN
  EXECUTE 'SET LOCAL ROLE app_role';
  PERFORM pg_temp.ctx(v_sup_a, v_a::text);
  v_j := siget.indicadores_institucion(v_a);
  EXECUTE 'RESET ROLE';
  v_texto := v_j::text;
  v_claves := ARRAY(SELECT jsonb_object_keys(v_j) ORDER BY 1);

  PERFORM pg_temp.r(v_claves = ARRAY['abiertos', 'dias_promedio_resolucion', 'escalados_abiertos', 'por_estado', 'por_funcionario',
                                     'resueltos_90_dias', 'sin_asignar', 'vencidos'],
                    'la respuesta tiene solo las claves de los agregados (sin listas de tramites)');
  PERFORM pg_temp.r(v_texto NOT LIKE '%p022_ciud%' AND v_texto NOT LIKE '%tramite%',
                    'no aparece ninguna persona solicitante ni la palabra tramite en la respuesta');
  PERFORM pg_temp.r(NOT EXISTS (SELECT 1 FROM siget.tramite t WHERE t.institucion_id = v_a AND v_texto LIKE '%"id": ' || t.id || '%'),
                    'ningun id de tramite de la institucion aparece como tal en la respuesta');
  PERFORM pg_temp.r(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_j -> 'por_funcionario') f
                                 WHERE f ->> 'usuario' IN ('p022_ciud', 'p022_ciud2')),
                    'un tramite asignado por error a una persona de la ciudadania no la muestra en la carga por funcionario');
  PERFORM pg_temp.r(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_j -> 'por_funcionario') f
                                 WHERE NOT EXISTS (SELECT 1 FROM siget.membresia m
                                                    WHERE m.usuario_id = (f ->> 'usuario_id')::int AND m.institucion_id = v_a AND m.rol IN ('funcionario', 'supervisor'))),
                    'todo lo que sale en la carga por funcionario es personal de la institucion');
END $$;

-- ---------------------------------------------------------------------------
-- 4. Permisos y definicion de la funcion (por el catalogo del sistema)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_rol text;
BEGIN
  PERFORM pg_temp.r(has_function_privilege('app_role', 'siget.indicadores_institucion(int)', 'EXECUTE'), 'app_role ejecuta la funcion');
  FOREACH v_rol IN ARRAY ARRAY['auditor_role', 'pgadmin_lectura', 'escalador_role', 'detector_role', 'checkpoint_app'] LOOP
    PERFORM pg_temp.r(NOT has_function_privilege(v_rol, 'siget.indicadores_institucion(int)', 'EXECUTE'), format('%s no ejecuta la funcion', v_rol));
  END LOOP;
  PERFORM pg_temp.r(NOT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
                                 WHERE p.oid = 'siget.indicadores_institucion(int)'::regprocedure AND a.grantee = 0),
                    'PUBLIC no tiene permiso sobre la funcion');
  PERFORM pg_temp.r((SELECT prosecdef AND pg_get_userbyid(proowner) = 'siget_owner' AND proconfig = ARRAY['search_path=siget, pg_temp']
                       FROM pg_proc WHERE oid = 'siget.indicadores_institucion(int)'::regprocedure),
                    'la funcion es SECURITY DEFINER, del duenio y con la ruta de busqueda fija');
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
