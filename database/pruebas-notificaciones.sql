-- ============================================================================
-- SIGET: pruebas de la migracion 018 (notificaciones dentro de la plataforma)
-- Se ejecuta como el superusuario del contenedor, DESPUES de aplicar la migracion, dentro de una transaccion que se
-- revierte (no deja nada guardado):  psql -v ON_ERROR_STOP=1 -f pruebas-notificaciones.sql  ... y termina en ROLLBACK.
-- Cada prueba imprime PASA o FALLA con RAISE NOTICE.
-- Cubre lo que verificar_tramites (por la API, como app_role) no puede: el aviso a la supervision cuando corre
-- siget.escalar_vencidos() como escalador_role, sin contexto de usuario.
-- ADVERTENCIAS:
--  * escalar_vencidos() corre aqui sobre TODA la base: mientras dura el script escala (y bloquea) tambien los tramites vencidos
--    REALES. El ROLLBACK final lo deshace todo, pero esas filas quedan bloqueadas hasta entonces.
--  * Conviene correrlo fuera de la hora en punto: el temporizador del escalador corre cada hora y, si coincide con el script, uno de los
--    dos espera al otro o escala primero (los resultados de la prueba del escalamiento dejarian de ser deterministas).
-- ============================================================================
BEGIN;

-- Ids de la prueba (se crea ANTES de cambiar de rol: el duenio no necesita permiso de tablas temporales)
CREATE TEMP TABLE _p018 (clave text PRIMARY KEY, id bigint NOT NULL) ON COMMIT DROP;
GRANT SELECT ON _p018 TO app_role;

SET LOCAL ROLE siget_owner;
INSERT INTO siget.institucion (nombre, tipo) VALUES ('Prueba-018', 'demostracion');
INSERT INTO siget.usuario (username, password_hash) VALUES
  ('p018_ciudadana', '!'), ('p018_otra', '!'), ('p018_func', '!'), ('p018_sup1', '!'), ('p018_sup2', '!'), ('p018_suprev', '!'), ('p018_coord', '!');
INSERT INTO siget.membresia (usuario_id, institucion_id, rol, asignado_por)
  SELECT u.id, i.id, x.rol::siget.rol_membresia, c.id
    FROM (VALUES ('p018_func', 'funcionario'), ('p018_sup1', 'supervisor'), ('p018_sup2', 'supervisor'), ('p018_suprev', 'supervisor')) AS x(username, rol)
    JOIN siget.usuario u ON u.username = x.username
    CROSS JOIN siget.institucion i
    CROSS JOIN siget.usuario c
   WHERE i.nombre = 'Prueba-018' AND c.username = 'p018_coord';
-- Una supervisora con la membresia revocada: no debe recibir avisos
UPDATE siget.membresia
   SET revocada_en = now(), revocada_por = (SELECT id FROM siget.usuario WHERE username = 'p018_coord')
 WHERE usuario_id = (SELECT id FROM siget.usuario WHERE username = 'p018_suprev');
INSERT INTO siget.tipo_tramite (institucion_id, nombre, sla_dias)
  SELECT id, 'Tramite prueba 018', 5 FROM siget.institucion WHERE nombre = 'Prueba-018';
-- Primero el vencido (su plazo ya paso); despues tres con plazo futuro
INSERT INTO siget.tramite (tipo_tramite_id, institucion_id, solicitante_id, fecha_limite)
  SELECT tt.id, tt.institucion_id, u.id, now() - interval '2 days'
    FROM siget.tipo_tramite tt, siget.usuario u WHERE tt.nombre = 'Tramite prueba 018' AND u.username = 'p018_ciudadana';
INSERT INTO siget.tramite (tipo_tramite_id, institucion_id, solicitante_id, fecha_limite)
  SELECT tt.id, tt.institucion_id, u.id, now() + interval '3 days'
    FROM siget.tipo_tramite tt, siget.usuario u, generate_series(1, 3)
   WHERE tt.nombre = 'Tramite prueba 018' AND u.username = 'p018_ciudadana';
RESET ROLE;

INSERT INTO _p018 SELECT substr(username, 6), id FROM siget.usuario WHERE username LIKE 'p018\_%';
INSERT INTO _p018
  SELECT CASE WHEN id = (SELECT min(id) FROM siget.tramite WHERE institucion_id = (SELECT id FROM siget.institucion WHERE nombre = 'Prueba-018'))
              THEN 'tv' ELSE 't' || (row_number() OVER (ORDER BY id) - 1) END, id
    FROM siget.tramite WHERE institucion_id = (SELECT id FROM siget.institucion WHERE nombre = 'Prueba-018');

CREATE FUNCTION pg_temp.id(p text) RETURNS bigint LANGUAGE sql AS $$ SELECT id FROM _p018 WHERE clave = p $$;
-- Quien actualiza: fija el contexto de la sesion (como hace la aplicacion en cada transaccion); '' = sin contexto (el sistema)
CREATE FUNCTION pg_temp.ctx(p text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('app.usuario_id', coalesce(pg_temp.id(p)::text, ''), true);
END $$;
CREATE FUNCTION pg_temp.motivo(p text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('siget.motivo', p, true);
END $$;
CREATE FUNCTION pg_temp.n(p_usuario text, p_tipo text, p_tramite text) RETURNS int LANGUAGE sql AS
  $$ SELECT count(*)::int FROM siget.notificacion WHERE usuario_id = pg_temp.id(p_usuario) AND tipo = p_tipo AND tramite_id = pg_temp.id(p_tramite) $$;
CREATE FUNCTION pg_temp.total(p_usuario text) RETURNS int LANGUAGE sql AS
  $$ SELECT count(*)::int FROM siget.notificacion WHERE usuario_id = pg_temp.id(p_usuario) $$;

-- 1 a 9. Cada transicion avisa a quien corresponde (el UPDATE lo hace quien indica `ctx`)
DO $$
DECLARE
  v_ok boolean;
BEGIN
  IF (SELECT count(*) FROM _p018) <> 11 THEN
    RAISE EXCEPTION 'La preparacion de la prueba fallo: % ids en vez de 11', (SELECT count(*) FROM _p018);
  END IF;

  -- 1. El personal toma el tramite: avisa al solicitante, no al propio actor
  PERFORM pg_temp.ctx('func');
  UPDATE siget.tramite SET estado = 'En Tramitacion' WHERE id = pg_temp.id('t1');
  UPDATE siget.tramite SET funcionario_asignado_id = pg_temp.id('func') WHERE id = pg_temp.id('t1');
  v_ok := pg_temp.n('ciudadana', 'tramite_en_atencion', 't1') = 1 AND pg_temp.total('func') = 0;
  RAISE NOTICE '% Pendiente -> En Tramitacion avisa al solicitante (tramite_en_atencion) y no al actor; reasignar no avisa', CASE WHEN v_ok THEN 'PASA ' ELSE 'FALLA' END;

  -- 2. Pide una subsanacion
  PERFORM pg_temp.motivo('Falta el plano firmado del terreno.');
  UPDATE siget.tramite SET estado = 'En Subsanacion' WHERE id = pg_temp.id('t1');
  v_ok := pg_temp.n('ciudadana', 'subsanacion_pedida', 't1') = 1 AND pg_temp.total('func') = 0;
  RAISE NOTICE '% En Tramitacion -> En Subsanacion avisa al solicitante (subsanacion_pedida)', CASE WHEN v_ok THEN 'PASA ' ELSE 'FALLA' END;

  -- 3. El solicitante responde: avisa al funcionario asignado, no al solicitante (es quien actua)
  PERFORM pg_temp.ctx('ciudadana');
  PERFORM pg_temp.motivo('Adjunto el plano firmado del terreno.');
  UPDATE siget.tramite SET estado = 'En Tramitacion' WHERE id = pg_temp.id('t1');
  v_ok := pg_temp.n('func', 'subsanacion_respondida', 't1') = 1 AND pg_temp.total('ciudadana') = 2;
  RAISE NOTICE '% el solicitante responde la subsanacion: avisa al funcionario asignado y no a si mismo', CASE WHEN v_ok THEN 'PASA ' ELSE 'FALLA' END;

  -- 4. Si cierra la subsanacion el personal, no se avisa al asignado
  PERFORM pg_temp.ctx('func');
  PERFORM pg_temp.motivo('Falta el plano firmado del terreno.');
  UPDATE siget.tramite SET estado = 'En Subsanacion' WHERE id = pg_temp.id('t1');
  PERFORM pg_temp.motivo('La persona no respondio; se retoma el tramite.');
  UPDATE siget.tramite SET estado = 'En Tramitacion' WHERE id = pg_temp.id('t1');
  v_ok := pg_temp.n('func', 'subsanacion_respondida', 't1') = 1 AND pg_temp.total('func') = 1 AND pg_temp.total('ciudadana') = 3;
  RAISE NOTICE '% si cierra la subsanacion el personal, no se avisa al asignado (y el solicitante solo recibe la segunda peticion)', CASE WHEN v_ok THEN 'PASA ' ELSE 'FALLA' END;

  -- 5. Aprobado
  UPDATE siget.tramite SET estado = 'Aprobado' WHERE id = pg_temp.id('t1');
  v_ok := pg_temp.n('ciudadana', 'tramite_aprobado', 't1') = 1 AND pg_temp.total('ciudadana') = 4;
  RAISE NOTICE '% En Tramitacion -> Aprobado avisa al solicitante (tramite_aprobado)', CASE WHEN v_ok THEN 'PASA ' ELSE 'FALLA' END;

  -- 6. Rechazado
  UPDATE siget.tramite SET estado = 'En Tramitacion' WHERE id = pg_temp.id('t2');
  PERFORM pg_temp.motivo('No cumple con los requisitos del tramite.');
  UPDATE siget.tramite SET estado = 'Rechazado' WHERE id = pg_temp.id('t2');
  v_ok := pg_temp.n('ciudadana', 'tramite_rechazado', 't2') = 1 AND pg_temp.n('ciudadana', 'tramite_en_atencion', 't2') = 1;
  RAISE NOTICE '% En Tramitacion -> Rechazado avisa al solicitante (tramite_rechazado)', CASE WHEN v_ok THEN 'PASA ' ELSE 'FALLA' END;

  -- 7. Una transicion que la base rechaza no deja notificacion
  BEGIN
    UPDATE siget.tramite SET estado = 'En Tramitacion' WHERE id = pg_temp.id('t1');  -- Aprobado -> En Tramitacion
    RAISE NOTICE 'FALLA una transicion invalida fue aceptada';
  EXCEPTION WHEN raise_exception THEN
    v_ok := pg_temp.total('ciudadana') = 6;
    RAISE NOTICE '% una transicion rechazada por la base no deja ninguna notificacion', CASE WHEN v_ok THEN 'PASA ' ELSE 'FALLA' END;
  END;

  -- 8. Responder una subsanacion sin funcionario asignado no avisa a nadie del personal
  UPDATE siget.tramite SET estado = 'En Tramitacion' WHERE id = pg_temp.id('t3');
  PERFORM pg_temp.motivo('Falta el plano firmado del terreno.');
  UPDATE siget.tramite SET estado = 'En Subsanacion' WHERE id = pg_temp.id('t3');
  PERFORM pg_temp.ctx('ciudadana');
  PERFORM pg_temp.motivo('Adjunto el plano firmado del terreno.');
  UPDATE siget.tramite SET estado = 'En Tramitacion' WHERE id = pg_temp.id('t3');
  SELECT count(*) = 0 INTO v_ok FROM siget.notificacion WHERE tramite_id = pg_temp.id('t3') AND tipo = 'subsanacion_respondida';
  RAISE NOTICE '% sin funcionario asignado, la respuesta a la subsanacion no avisa a nadie', CASE WHEN v_ok THEN 'PASA ' ELSE 'FALLA' END;

  -- 9. Nadie mas recibe nada: ni la otra ciudadana, ni la coordinacion, ni la supervision
  v_ok := pg_temp.total('otra') = 0 AND pg_temp.total('coord') = 0 AND pg_temp.total('sup1') = 0 AND pg_temp.total('sup2') = 0 AND pg_temp.total('suprev') = 0;
  RAISE NOTICE '% ninguna transicion de estado avisa a terceros (otra persona, coordinacion ni supervision)', CASE WHEN v_ok THEN 'PASA ' ELSE 'FALLA' END;
END $$;

-- 10. Escalamiento por un cambio directo de escalado_en, hecho por una supervisora: ella (el actor) no recibe aviso; la otra si
DO $$
DECLARE
  v_ok boolean;
BEGIN
  PERFORM pg_temp.ctx('sup1');
  UPDATE siget.tramite SET escalado_en = now() WHERE id = pg_temp.id('t3');
  v_ok := pg_temp.n('sup2', 'tramite_escalado', 't3') = 1 AND pg_temp.n('sup1', 'tramite_escalado', 't3') = 0;
  RAISE NOTICE '% al escalarse un tramite se avisa a la supervision, salvo a quien lo hizo', CASE WHEN v_ok THEN 'PASA ' ELSE 'FALLA' END;
  v_ok := pg_temp.total('suprev') = 0 AND pg_temp.total('func') = 1 AND pg_temp.n('ciudadana', 'tramite_escalado', 't3') = 0 AND pg_temp.total('coord') = 0;
  RAISE NOTICE '% no se avisa a la supervisora con la membresia revocada, ni al funcionario, ni al solicitante, ni a la coordinacion', CASE WHEN v_ok THEN 'PASA ' ELSE 'FALLA' END;
  UPDATE siget.tramite SET escalado_en = now() WHERE id = pg_temp.id('t3');
  v_ok := pg_temp.n('sup2', 'tramite_escalado', 't3') = 1;
  RAISE NOTICE '% volver a escribir escalado_en (ya no es NULL) no avisa otra vez', CASE WHEN v_ok THEN 'PASA ' ELSE 'FALLA' END;
END $$;

-- 11 a 14. El escalamiento real: siget.escalar_vencidos() COMO escalador_role y SIN contexto de usuario
SELECT set_config('app.usuario_id', '', true);
CREATE TEMP TABLE _r018 (corrida int, escalados int) ON COMMIT DROP;  -- solo para anotar los resultados
GRANT INSERT ON _r018 TO escalador_role;
SET LOCAL ROLE escalador_role;
INSERT INTO _r018 VALUES (1, siget.escalar_vencidos());
RESET ROLE;

DO $$
DECLARE
  v_ok boolean;
BEGIN
  SELECT escalados >= 1 INTO v_ok FROM _r018 WHERE corrida = 1;
  RAISE NOTICE '% escalar_vencidos() corrio como escalador_role y escalo al menos el tramite vencido de la prueba', CASE WHEN v_ok THEN 'PASA ' ELSE 'FALLA' END;
  SELECT escalado_en IS NOT NULL INTO v_ok FROM siget.tramite WHERE id = pg_temp.id('tv');
  RAISE NOTICE '% el tramite vencido quedo escalado', CASE WHEN v_ok THEN 'PASA ' ELSE 'FALLA' END;
  v_ok := pg_temp.n('sup1', 'tramite_escalado', 'tv') = 1 AND pg_temp.n('sup2', 'tramite_escalado', 'tv') = 1;
  RAISE NOTICE '% sin contexto de usuario (actor NULL), las dos supervisoras vigentes reciben tramite_escalado', CASE WHEN v_ok THEN 'PASA ' ELSE 'FALLA' END;
  v_ok := pg_temp.n('suprev', 'tramite_escalado', 'tv') = 0 AND pg_temp.n('func', 'tramite_escalado', 'tv') = 0
          AND pg_temp.n('ciudadana', 'tramite_escalado', 'tv') = 0 AND pg_temp.n('coord', 'tramite_escalado', 'tv') = 0 AND pg_temp.n('otra', 'tramite_escalado', 'tv') = 0;
  RAISE NOTICE '% y nadie mas (ni la revocada, ni el funcionario, ni el solicitante, ni la coordinacion)', CASE WHEN v_ok THEN 'PASA ' ELSE 'FALLA' END;
END $$;

SET LOCAL ROLE escalador_role;
INSERT INTO _r018 VALUES (2, siget.escalar_vencidos());
RESET ROLE;

DO $$
DECLARE
  v_ok boolean;
BEGIN
  SELECT escalados = 0 INTO v_ok FROM _r018 WHERE corrida = 2;
  v_ok := v_ok AND pg_temp.n('sup1', 'tramite_escalado', 'tv') = 1 AND pg_temp.n('sup2', 'tramite_escalado', 'tv') = 1;
  RAISE NOTICE '% es idempotente: la segunda corrida no escala ni avisa otra vez', CASE WHEN v_ok THEN 'PASA ' ELSE 'FALLA' END;
END $$;

-- 15 a 22. app_role: ve y marca solo las suyas; no inserta, no borra, no desmarca, no cambia otra columna
SELECT set_config('app.usuario_id', (SELECT id::text FROM _p018 WHERE clave = 'ciudadana'), true);
SET LOCAL ROLE app_role;

DO $$
DECLARE
  v_yo     int := (SELECT id FROM _p018 WHERE clave = 'ciudadana');
  v_otra   int := (SELECT id FROM _p018 WHERE clave = 'otra');
  v_t1     bigint := (SELECT id FROM _p018 WHERE clave = 't1');
  v_pen    bigint;
  v_leida  bigint;
  v_n      int;
  v_filas  int;
  v_ok     boolean;
BEGIN
  -- 15. Solo ve las suyas
  SELECT count(*) INTO v_n FROM siget.notificacion;
  SELECT v_n > 0 AND NOT EXISTS (SELECT 1 FROM siget.notificacion WHERE usuario_id <> v_yo) INTO v_ok;
  RAISE NOTICE '% la seguridad por filas deja ver solo las notificaciones propias (% filas)', CASE WHEN v_ok THEN 'PASA ' ELSE 'FALLA' END, v_n;

  -- 16. Marca una pendiente con una hora inventada: la base pone la suya
  SELECT id INTO v_pen FROM siget.notificacion WHERE leida_en IS NULL ORDER BY id LIMIT 1;
  UPDATE siget.notificacion SET leida_en = '2000-01-01' WHERE id = v_pen;
  SELECT leida_en = now() INTO v_ok FROM siget.notificacion WHERE id = v_pen;
  RAISE NOTICE '% marcar como leida fija la hora con now() (la base), no la que manda la aplicacion', CASE WHEN v_ok THEN 'PASA ' ELSE 'FALLA' END;
  v_leida := v_pen;

  -- 17. No se desmarca ni se vuelve a marcar
  BEGIN
    UPDATE siget.notificacion SET leida_en = NULL WHERE id = v_leida;
    RAISE NOTICE 'FALLA se pudo desmarcar una notificacion leida';
  EXCEPTION WHEN raise_exception THEN
    RAISE NOTICE 'PASA  una notificacion leida no se desmarca';
  END;
  BEGIN
    UPDATE siget.notificacion SET leida_en = now() + interval '1 day' WHERE id = v_leida;
    RAISE NOTICE 'FALLA se pudo cambiar la hora de lectura';
  EXCEPTION WHEN raise_exception THEN
    RAISE NOTICE 'PASA  la hora de lectura no se vuelve a cambiar';
  END;

  -- 18. No inserta ni borra ni cambia otra columna
  BEGIN
    INSERT INTO siget.notificacion (usuario_id, tipo, tramite_id) VALUES (v_yo, 'tramite_aprobado', v_t1);
    RAISE NOTICE 'FALLA app_role pudo insertar una notificacion';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASA  app_role no puede insertar notificaciones';
  END;
  BEGIN
    DELETE FROM siget.notificacion WHERE id = v_leida;
    RAISE NOTICE 'FALLA app_role pudo borrar una notificacion';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASA  app_role no puede borrar notificaciones';
  END;
  BEGIN
    UPDATE siget.notificacion SET tipo = 'tramite_aprobado' WHERE id = v_leida;
    RAISE NOTICE 'FALLA app_role pudo cambiar el tipo';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASA  app_role solo puede actualizar leida_en (no el tipo)';
  END;
  BEGIN
    UPDATE siget.notificacion SET usuario_id = v_otra WHERE id = v_leida;
    RAISE NOTICE 'FALLA app_role pudo pasar una notificacion a otra persona';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASA  app_role no puede pasarle una notificacion a otra persona';
  END;

  -- 19. Lo ajeno no se ve ni se marca: el UPDATE afecta 0 filas
  PERFORM set_config('app.usuario_id', v_otra::text, true);
  SELECT count(*) INTO v_n FROM siget.notificacion;
  UPDATE siget.notificacion SET leida_en = now() WHERE id = v_pen OR usuario_id = v_yo;
  GET DIAGNOSTICS v_filas = ROW_COUNT;
  RAISE NOTICE '% otra persona no ve ninguna notificacion ajena ni puede marcarlas (% filas visibles, % marcadas)', CASE WHEN v_n = 0 AND v_filas = 0 THEN 'PASA ' ELSE 'FALLA' END, v_n, v_filas;

  -- 20. Sin contexto de usuario no se ve nada
  PERFORM set_config('app.usuario_id', '', true);
  SELECT count(*) INTO v_n FROM siget.notificacion;
  RAISE NOTICE '% sin contexto de usuario no se ve ninguna notificacion', CASE WHEN v_n = 0 THEN 'PASA ' ELSE 'FALLA' END;
END $$;
RESET ROLE;

-- 23 a 25. Privilegios de cada rol y la segunda barrera del disparador (incluso para el duenio)
DO $$
DECLARE
  v_ok boolean;
  v_id bigint;
BEGIN
  v_ok := has_table_privilege('app_role', 'siget.notificacion', 'SELECT')
          AND NOT has_table_privilege('app_role', 'siget.notificacion', 'INSERT')
          AND NOT has_table_privilege('app_role', 'siget.notificacion', 'UPDATE')
          AND NOT has_table_privilege('app_role', 'siget.notificacion', 'DELETE')
          AND has_column_privilege('app_role', 'siget.notificacion', 'leida_en', 'UPDATE')
          AND NOT has_column_privilege('app_role', 'siget.notificacion', 'tipo', 'UPDATE')
          AND NOT has_column_privilege('app_role', 'siget.notificacion', 'usuario_id', 'UPDATE')
          AND NOT has_sequence_privilege('app_role', 'siget.notificacion_id_seq', 'USAGE');
  RAISE NOTICE '% app_role: SELECT, UPDATE (leida_en) y nada mas (sin INSERT, DELETE ni secuencia)', CASE WHEN v_ok THEN 'PASA ' ELSE 'FALLA' END;

  SELECT NOT (
    has_table_privilege('auditor_role', 'siget.notificacion', 'SELECT') OR has_any_column_privilege('auditor_role', 'siget.notificacion', 'SELECT')
    OR has_table_privilege('pgadmin_lectura', 'siget.notificacion', 'SELECT') OR has_any_column_privilege('pgadmin_lectura', 'siget.notificacion', 'SELECT')
    OR has_table_privilege('checkpoint_app', 'siget.notificacion', 'SELECT') OR has_any_column_privilege('checkpoint_app', 'siget.notificacion', 'SELECT')
    OR has_table_privilege('escalador_role', 'siget.notificacion', 'SELECT') OR has_any_column_privilege('escalador_role', 'siget.notificacion', 'SELECT')
    OR has_table_privilege('escalador_role', 'siget.notificacion', 'INSERT') OR has_table_privilege('escalador_role', 'siget.notificacion', 'UPDATE')
  ) INTO v_ok;
  RAISE NOTICE '% ni auditor_role, ni pgadmin_lectura, ni checkpoint_app ni escalador_role tienen nada sobre notificacion', CASE WHEN v_ok THEN 'PASA ' ELSE 'FALLA' END;

  -- Ni siquiera el duenio cambia otra columna que no sea la fecha de lectura
  SELECT id INTO v_id FROM siget.notificacion WHERE usuario_id = (SELECT id FROM _p018 WHERE clave = 'ciudadana') ORDER BY id LIMIT 1;
  BEGIN
    UPDATE siget.notificacion SET tipo = 'tramite_aprobado' WHERE id = v_id;
    RAISE NOTICE 'FALLA se pudo cambiar el tipo de una notificacion';
  EXCEPTION WHEN raise_exception THEN
    RAISE NOTICE 'PASA  el disparador impide cambiar cualquier columna que no sea leida_en, incluso al duenio';
  END;
END $$;

-- 26 a 30. Cuentas y accesos: no se avisa a quien ya no tiene acceso ni a una cuenta de personal no activa (D1 y D2); al solicitante si
GRANT SELECT, INSERT ON _p018 TO siget_owner;  -- la tabla temporal es de quien corre el script, no del duenio
SET LOCAL ROLE siget_owner;
INSERT INTO siget.usuario (username, password_hash, estado_cuenta) VALUES
  ('p018_funcrev', '!', 'activa'), ('p018_funcsus', '!', 'suspendida'), ('p018_supsus', '!', 'suspendida'), ('p018_supok', '!', 'activa'),
  ('p018_blq', '!', 'bloqueada');
INSERT INTO siget.membresia (usuario_id, institucion_id, rol, asignado_por)
  SELECT u.id, i.id, x.rol::siget.rol_membresia, c.id
    FROM (VALUES ('p018_funcrev', 'funcionario'), ('p018_funcsus', 'funcionario'), ('p018_supsus', 'supervisor'), ('p018_supok', 'supervisor')) AS x(username, rol)
    JOIN siget.usuario u ON u.username = x.username
    CROSS JOIN siget.institucion i
    CROSS JOIN siget.usuario c
   WHERE i.nombre = 'Prueba-018' AND c.username = 'p018_coord';
INSERT INTO _p018 SELECT substr(username, 6), id FROM siget.usuario WHERE username IN ('p018_funcrev', 'p018_funcsus', 'p018_supsus', 'p018_supok', 'p018_blq');
-- Cuatro tramites nuevos con plazo futuro: ta (asignado con acceso revocado), tb (asignado con cuenta suspendida), tc (supervision con una
-- cuenta suspendida) y td (solicitante con la cuenta bloqueada)
DO $$
DECLARE
  v_id bigint;
  v_clave text;
BEGIN
  FOREACH v_clave IN ARRAY ARRAY['ta', 'tb', 'tc', 'td'] LOOP
    INSERT INTO siget.tramite (tipo_tramite_id, institucion_id, solicitante_id, fecha_limite)
      SELECT tt.id, tt.institucion_id, (SELECT id FROM _p018 WHERE clave = CASE WHEN v_clave = 'td' THEN 'blq' ELSE 'ciudadana' END), now() + interval '3 days'
        FROM siget.tipo_tramite tt WHERE tt.nombre = 'Tramite prueba 018'
      RETURNING id INTO v_id;
    INSERT INTO _p018 VALUES (v_clave, v_id);
  END LOOP;
END $$;
RESET ROLE;

DO $$
DECLARE
  v_ok boolean;
BEGIN
  -- 26. Un asignado al que ya se le quito el acceso no recibe subsanacion_respondida (y uno con acceso vigente si: es la prueba 3)
  PERFORM pg_temp.ctx('func');
  UPDATE siget.tramite SET estado = 'En Tramitacion', funcionario_asignado_id = pg_temp.id('funcrev') WHERE id = pg_temp.id('ta');
  PERFORM pg_temp.motivo('Falta el plano firmado del terreno.');
  UPDATE siget.tramite SET estado = 'En Subsanacion' WHERE id = pg_temp.id('ta');
  UPDATE siget.membresia
     SET revocada_en = now(), revocada_por = pg_temp.id('coord')
   WHERE usuario_id = pg_temp.id('funcrev');
  PERFORM pg_temp.ctx('ciudadana');
  PERFORM pg_temp.motivo('Adjunto el plano firmado del terreno.');
  UPDATE siget.tramite SET estado = 'En Tramitacion' WHERE id = pg_temp.id('ta');
  v_ok := pg_temp.total('funcrev') = 0 AND pg_temp.n('ciudadana', 'subsanacion_pedida', 'ta') = 1;
  RAISE NOTICE '% un asignado con la membresia revocada no recibe subsanacion_respondida', CASE WHEN v_ok THEN 'PASA ' ELSE 'FALLA' END;

  -- 27. Tampoco un asignado con la cuenta no activa
  PERFORM pg_temp.ctx('func');
  UPDATE siget.tramite SET estado = 'En Tramitacion', funcionario_asignado_id = pg_temp.id('funcsus') WHERE id = pg_temp.id('tb');
  PERFORM pg_temp.motivo('Falta el plano firmado del terreno.');
  UPDATE siget.tramite SET estado = 'En Subsanacion' WHERE id = pg_temp.id('tb');
  PERFORM pg_temp.ctx('ciudadana');
  PERFORM pg_temp.motivo('Adjunto el plano firmado del terreno.');
  UPDATE siget.tramite SET estado = 'En Tramitacion' WHERE id = pg_temp.id('tb');
  v_ok := pg_temp.total('funcsus') = 0 AND pg_temp.n('ciudadana', 'subsanacion_pedida', 'tb') = 1;
  RAISE NOTICE '% un asignado con la cuenta suspendida no recibe subsanacion_respondida', CASE WHEN v_ok THEN 'PASA ' ELSE 'FALLA' END;

  -- 28. Al escalarse, la supervision con la cuenta suspendida no recibe tramite_escalado; la activa si (lo hace la coordinacion: no es destinataria)
  PERFORM pg_temp.ctx('coord');
  UPDATE siget.tramite SET escalado_en = now() WHERE id = pg_temp.id('tc');
  v_ok := pg_temp.n('supsus', 'tramite_escalado', 'tc') = 0 AND pg_temp.total('supsus') = 0;
  RAISE NOTICE '% una supervisora con la cuenta suspendida no recibe tramite_escalado', CASE WHEN v_ok THEN 'PASA ' ELSE 'FALLA' END;
  v_ok := pg_temp.n('supok', 'tramite_escalado', 'tc') = 1 AND pg_temp.n('sup1', 'tramite_escalado', 'tc') = 1 AND pg_temp.n('sup2', 'tramite_escalado', 'tc') = 1
          AND pg_temp.n('suprev', 'tramite_escalado', 'tc') = 0;
  RAISE NOTICE '% y la supervision activa y vigente si (la revocada, no)', CASE WHEN v_ok THEN 'PASA ' ELSE 'FALLA' END;

  -- 29. Los avisos que ya existian no cambian: el funcionario con acceso vigente conserva el suyo; la otra ciudadana y la coordinacion, ninguno
  v_ok := pg_temp.total('func') = 1 AND pg_temp.total('otra') = 0 AND pg_temp.total('coord') = 0;
  RAISE NOTICE '% el funcionario con acceso vigente conserva su unico aviso; la otra persona y la coordinacion siguen sin ninguno', CASE WHEN v_ok THEN 'PASA ' ELSE 'FALLA' END;

  -- 30. Al SOLICITANTE con la cuenta bloqueada si se le avisa: lo vera al volver
  PERFORM pg_temp.ctx('func');
  UPDATE siget.tramite SET estado = 'En Tramitacion' WHERE id = pg_temp.id('td');
  v_ok := pg_temp.n('blq', 'tramite_en_atencion', 'td') = 1;
  RAISE NOTICE '% un solicitante con la cuenta bloqueada si recibe el aviso de su tramite (lo ve al volver)', CASE WHEN v_ok THEN 'PASA ' ELSE 'FALLA' END;
END $$;

ROLLBACK;
