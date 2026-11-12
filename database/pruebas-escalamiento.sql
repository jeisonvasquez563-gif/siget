-- ============================================================================
-- SIGET: pruebas de la migracion 013 (dias habiles y escalamiento automatico)
-- Se ejecuta como el superusuario del contenedor, DESPUES de aplicar la migracion, dentro de una transaccion que se
-- revierte (no deja nada guardado):  psql -v ON_ERROR_STOP=1 -1 -f pruebas-escalamiento.sql  ... y termina en ROLLBACK.
-- Cada prueba imprime PASA o FALLA con RAISE NOTICE.
-- ============================================================================
BEGIN;

SET LOCAL ROLE siget_owner;
INSERT INTO siget.institucion (nombre, tipo) VALUES ('Prueba-013', 'demostracion');
INSERT INTO siget.usuario (username, password_hash) VALUES ('p013_ciudadana', '!');
INSERT INTO siget.tipo_tramite (institucion_id, nombre, sla_dias)
  SELECT id, 'Tramite prueba 013', 5 FROM siget.institucion WHERE nombre = 'Prueba-013';
-- Tres tramites: uno vencido y abierto, uno vencido pero aprobado, uno con plazo futuro
INSERT INTO siget.tramite (tipo_tramite_id, institucion_id, solicitante_id, fecha_limite)
  SELECT tt.id, tt.institucion_id, u.id, x.limite
    FROM siget.tipo_tramite tt, siget.usuario u,
         (VALUES (now() - interval '2 days'), (now() - interval '2 days'), (now() + interval '3 days')) AS x(limite)
   WHERE tt.nombre = 'Tramite prueba 013' AND u.username = 'p013_ciudadana';
RESET ROLE;

DO $$
DECLARE
  v_inst int; v_vencido bigint; v_aprobado bigint; v_futuro bigint; n int; v_ok boolean;
BEGIN
  SELECT id INTO v_inst FROM siget.institucion WHERE nombre = 'Prueba-013';
  SELECT id INTO v_vencido  FROM siget.tramite WHERE institucion_id = v_inst ORDER BY id LIMIT 1;
  SELECT id INTO v_aprobado FROM siget.tramite WHERE institucion_id = v_inst ORDER BY id OFFSET 1 LIMIT 1;
  SELECT id INTO v_futuro   FROM siget.tramite WHERE institucion_id = v_inst ORDER BY id OFFSET 2 LIMIT 1;
  -- El aprobado se cierra por la maquina de estados (como lo haria la aplicacion)
  UPDATE siget.tramite SET estado = 'En Tramitacion' WHERE id = v_aprobado;
  UPDATE siget.tramite SET estado = 'Aprobado' WHERE id = v_aprobado;

  -- 1. La tabla de feriados existe y tiene datos
  SELECT count(*) INTO n FROM siget.feriado;
  RAISE NOTICE '% la tabla feriado tiene % fechas', CASE WHEN n > 0 THEN 'PASA ' ELSE 'FALLA' END, n;

  -- 2. app_role lee feriados pero no los modifica
  v_ok := has_table_privilege('app_role', 'siget.feriado', 'SELECT') AND NOT has_table_privilege('app_role', 'siget.feriado', 'INSERT')
          AND NOT has_table_privilege('app_role', 'siget.feriado', 'DELETE');
  RAISE NOTICE '% app_role lee la tabla feriado y no puede modificarla', CASE WHEN v_ok THEN 'PASA ' ELSE 'FALLA' END;

  -- 3. app_role NO puede escribir escalado_en
  v_ok := NOT has_column_privilege('app_role', 'siget.tramite', 'escalado_en', 'UPDATE');
  RAISE NOTICE '% app_role no puede marcar ni desmarcar escalado_en', CASE WHEN v_ok THEN 'PASA ' ELSE 'FALLA' END;

  -- 4. app_role NO puede ejecutar el escalamiento; escalador_role si
  v_ok := NOT has_function_privilege('app_role', 'siget.escalar_vencidos()', 'EXECUTE')
          AND has_function_privilege('escalador_role', 'siget.escalar_vencidos()', 'EXECUTE');
  RAISE NOTICE '% solo escalador_role ejecuta siget.escalar_vencidos()', CASE WHEN v_ok THEN 'PASA ' ELSE 'FALLA' END;

  -- 5. escalador_role no lee ni escribe ninguna tabla, no es superusuario ni salta RLS
  SELECT NOT has_table_privilege('escalador_role', 'siget.tramite', 'SELECT')
     AND NOT has_table_privilege('escalador_role', 'siget.tramite', 'UPDATE')
     AND NOT has_table_privilege('escalador_role', 'siget.evento_auditoria', 'INSERT')
     AND NOT has_table_privilege('escalador_role', 'siget.usuario', 'SELECT')
     AND NOT r.rolsuper AND NOT r.rolbypassrls AND r.rolcanlogin
    INTO v_ok FROM pg_roles r WHERE r.rolname = 'escalador_role';
  RAISE NOTICE '% escalador_role: solo EXECUTE, sin tablas, sin superusuario ni BYPASSRLS', CASE WHEN v_ok THEN 'PASA ' ELSE 'FALLA' END;
END $$;

-- 6 a 9. El escalamiento, ejecutado COMO escalador_role (con el resto de la base intacta, cuenta solo los de prueba)
CREATE TEMP TABLE _r013 (corrida int, escalados int) ON COMMIT DROP;  -- solo para anotar los resultados
GRANT INSERT ON _r013 TO escalador_role;
SET LOCAL ROLE escalador_role;
INSERT INTO _r013 VALUES (1, siget.escalar_vencidos());
INSERT INTO _r013 VALUES (2, siget.escalar_vencidos());
RESET ROLE;

DO $$
DECLARE
  v_inst int; v_vencido bigint; v_aprobado bigint; v_futuro bigint; n int; v_ok boolean; v_segunda int;
BEGIN
  SELECT id INTO v_inst FROM siget.institucion WHERE nombre = 'Prueba-013';
  SELECT id INTO v_vencido  FROM siget.tramite WHERE institucion_id = v_inst ORDER BY id LIMIT 1;
  SELECT id INTO v_aprobado FROM siget.tramite WHERE institucion_id = v_inst ORDER BY id OFFSET 1 LIMIT 1;
  SELECT id INTO v_futuro   FROM siget.tramite WHERE institucion_id = v_inst ORDER BY id OFFSET 2 LIMIT 1;

  SELECT escalado_en IS NOT NULL INTO v_ok FROM siget.tramite WHERE id = v_vencido;
  RAISE NOTICE '% un tramite abierto con el plazo vencido queda escalado', CASE WHEN v_ok THEN 'PASA ' ELSE 'FALLA' END;

  SELECT (SELECT escalado_en IS NULL FROM siget.tramite WHERE id = v_aprobado)
     AND (SELECT escalado_en IS NULL FROM siget.tramite WHERE id = v_futuro) INTO v_ok;
  RAISE NOTICE '% ni uno ya resuelto ni uno dentro de plazo se escalan', CASE WHEN v_ok THEN 'PASA ' ELSE 'FALLA' END;

  SELECT count(*) INTO n FROM siget.evento_auditoria
   WHERE tramite_id = v_vencido AND accion = 'escalamiento' AND actor_id IS NULL AND atributos->>'regla' = 'plazo_vencido';
  RAISE NOTICE '% el escalamiento queda en la auditoria (una vez, actor: el sistema)', CASE WHEN n = 1 THEN 'PASA ' ELSE 'FALLA' END;

  SELECT escalados INTO v_segunda FROM _r013 WHERE corrida = 2;
  RAISE NOTICE '% es idempotente: la segunda corrida no vuelve a escalar (% en la segunda)', CASE WHEN v_segunda = 0 THEN 'PASA ' ELSE 'FALLA' END, v_segunda;
END $$;

-- 10. app_role recibe "permiso denegado" si intenta escalar
SET LOCAL ROLE app_role;
DO $$
BEGIN
  PERFORM siget.escalar_vencidos();
  RAISE NOTICE 'FALLA app_role pudo ejecutar el escalamiento';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'PASA  app_role recibe permiso denegado al intentar escalar';
END $$;
RESET ROLE;

ROLLBACK;
