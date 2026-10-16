-- ============================================================================
-- SIGET: pruebas del diseno de roles y permisos (database/diseno-roles-permisos.sql)
-- Se ejecuta dentro de una transaccion que se revierte: no deja nada guardado.
-- Cada prueba imprime PASA o FALLA con RAISE NOTICE.
-- ============================================================================

-- Datos de prueba: los siembra siget_owner (el duenio, SIN superusuario)
SET LOCAL ROLE siget_owner;
INSERT INTO siget.institucion (nombre, tipo) VALUES
  ('Alcaldia', 'real'), ('MINSA', 'demostracion'), ('MOP', 'demostracion');
INSERT INTO siget.usuario (username, password_hash) VALUES
  ('ciudadana1', 'x'), ('ciudadano2', 'x'), ('func_minsa', 'x'), ('func_mop', 'x'), ('jefe', 'x');
INSERT INTO siget.tipo_tramite (institucion_id, nombre, sla_dias)
  SELECT id, 'Tramite demo ' || nombre, 10 FROM siget.institucion;
INSERT INTO siget.tramite (tipo_tramite_id, institucion_id, solicitante_id)
  SELECT tt.id, tt.institucion_id, u.id
  FROM siget.tipo_tramite tt
  JOIN siget.usuario u ON (tt.nombre = 'Tramite demo MINSA' AND u.username = 'ciudadana1')
                       OR (tt.nombre = 'Tramite demo MOP'   AND u.username = 'ciudadano2');

RESET ROLE;

DO $$
DECLARE
  n int; v_minsa int; v_mop int; v_t_minsa bigint; v_ciud1 int; v_ciud2 int; v_jefe int; v_func int;
BEGIN
  SELECT id INTO v_minsa FROM siget.institucion WHERE nombre = 'MINSA';
  SELECT id INTO v_mop   FROM siget.institucion WHERE nombre = 'MOP';
  SELECT id INTO v_ciud1 FROM siget.usuario WHERE username = 'ciudadana1';
  SELECT id INTO v_ciud2 FROM siget.usuario WHERE username = 'ciudadano2';
  SELECT id INTO v_jefe  FROM siget.usuario WHERE username = 'jefe';
  SELECT id INTO v_func  FROM siget.usuario WHERE username = 'func_mop';
  SELECT id INTO v_t_minsa FROM siget.tramite WHERE institucion_id = v_minsa;

  -- 1. Aislamiento: un funcionario del MOP solo ve tramites del MOP
  SET LOCAL ROLE app_role;
  PERFORM set_config('app.usuario_id', v_func::text, true);
  PERFORM set_config('app.instituciones', v_mop::text, true);
  SELECT count(*) INTO n FROM siget.tramite;
  RAISE NOTICE 'PRUEBA 1  funcionario del MOP ve % tramite(s) (esperado 1): %', n, CASE WHEN n = 1 THEN 'PASA' ELSE 'FALLA' END;
  SELECT count(*) INTO n FROM siget.tramite WHERE institucion_id = v_minsa;
  RAISE NOTICE 'PRUEBA 2  ve % tramite(s) del MINSA (esperado 0): %', n, CASE WHEN n = 0 THEN 'PASA' ELSE 'FALLA' END;

  -- 3. El ciudadano solo ve lo propio
  PERFORM set_config('app.usuario_id', v_ciud1::text, true);
  PERFORM set_config('app.instituciones', '', true);
  SELECT count(*) INTO n FROM siget.tramite;
  RAISE NOTICE 'PRUEBA 3  ciudadana1 ve % tramite(s) (esperado 1, el suyo): %', n, CASE WHEN n = 1 THEN 'PASA' ELSE 'FALLA' END;

  -- 4. El ciudadano no puede cambiar estados (fuera de sus instituciones)
  UPDATE siget.tramite SET estado = 'En Tramitacion' WHERE id = v_t_minsa;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'PRUEBA 4  ciudadana1 modifica % fila(s) (esperado 0): %', n, CASE WHEN n = 0 THEN 'PASA' ELSE 'FALLA' END;

  -- 5. No puede crear un tramite a nombre de otra persona
  BEGIN
    INSERT INTO siget.tramite (tipo_tramite_id, institucion_id, solicitante_id)
      SELECT id, institucion_id, v_ciud2 FROM siget.tipo_tramite WHERE institucion_id = v_mop;
    RAISE NOTICE 'PRUEBA 5  crear tramite a nombre de otro: FALLA (lo permitio)';
  EXCEPTION WHEN others THEN
    RAISE NOTICE 'PRUEBA 5  crear tramite a nombre de otro: PASA (rechazado: %)', sqlerrm;
  END;

  -- 6. Cambio de estado valido por un funcionario con membresia: se audita solo
  PERFORM set_config('app.usuario_id', v_func::text, true);
  PERFORM set_config('app.instituciones', v_minsa::text, true);
  UPDATE siget.tramite SET estado = 'En Tramitacion' WHERE id = v_t_minsa;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'PRUEBA 6  cambio valido modifica % fila(s) (esperado 1): %', n, CASE WHEN n = 1 THEN 'PASA' ELSE 'FALLA' END;
  SELECT count(*) INTO n FROM siget.evento_auditoria WHERE tramite_id = v_t_minsa AND actor_id = v_func;
  RAISE NOTICE 'PRUEBA 7  evento de auditoria creado en la misma transaccion (% evento): %', n, CASE WHEN n = 1 THEN 'PASA' ELSE 'FALLA' END;

  -- 8. Transicion invalida (En Tramitacion -> Pendiente) rechazada
  BEGIN
    UPDATE siget.tramite SET estado = 'Pendiente' WHERE id = v_t_minsa;
    RAISE NOTICE 'PRUEBA 8  transicion invalida: FALLA (la permitio)';
  EXCEPTION WHEN others THEN
    RAISE NOTICE 'PRUEBA 8  transicion invalida: PASA (rechazado: %)', sqlerrm;
  END;

  -- 9 y 10. app_role no puede modificar ni borrar la auditoria (permisos)
  BEGIN
    UPDATE siget.evento_auditoria SET accion = 'borrado';
    RAISE NOTICE 'PRUEBA 9  UPDATE de auditoria como app_role: FALLA';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PRUEBA 9  UPDATE de auditoria como app_role: PASA (permission denied)';
  END;
  BEGIN
    DELETE FROM siget.evento_auditoria;
    RAISE NOTICE 'PRUEBA 10 DELETE de auditoria como app_role: FALLA';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PRUEBA 10 DELETE de auditoria como app_role: PASA (permission denied)';
  END;

  -- 11. app_role no puede borrar tramites
  BEGIN
    DELETE FROM siget.tramite;
    RAISE NOTICE 'PRUEBA 11 DELETE de tramites como app_role: FALLA';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PRUEBA 11 DELETE de tramites como app_role: PASA (permission denied)';
  END;

  -- 12. Un usuario no puede asignarse a si mismo una membresia
  BEGIN
    INSERT INTO siget.membresia (usuario_id, institucion_id, rol, asignado_por) VALUES (v_func, v_mop, 'supervisor', v_func);
    RAISE NOTICE 'PRUEBA 12 auto-asignarse un rol: FALLA';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PRUEBA 12 auto-asignarse un rol: PASA (check_violation)';
  END;

  -- 13. app_role no puede tocar columnas que no le corresponden (rol_plataforma)
  BEGIN
    UPDATE siget.usuario SET rol_plataforma = 'operador_plataforma' WHERE id = v_func;
    RAISE NOTICE 'PRUEBA 13 app_role se sube a operador_plataforma: FALLA';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PRUEBA 13 app_role se sube a operador_plataforma: PASA (permission denied)';
  END;

  -- 14. El trigger protege la auditoria incluso del duenio (que si tiene UPDATE)
  SET LOCAL ROLE siget_owner;
  BEGIN
    UPDATE siget.evento_auditoria SET accion = 'borrado';
    RAISE NOTICE 'PRUEBA 14 UPDATE de auditoria como duenio: FALLA';
  EXCEPTION WHEN raise_exception THEN
    RAISE NOTICE 'PRUEBA 14 UPDATE de auditoria como duenio: PASA (trigger: %)', sqlerrm;
  END;

  -- 15 y 16. El auditor lee la auditoria (todas las instituciones) pero no los tramites
  SET LOCAL ROLE auditor_role;
  SELECT count(*) INTO n FROM siget.evento_auditoria;
  RAISE NOTICE 'PRUEBA 15 auditor lee % evento(s) (esperado 1): %', n, CASE WHEN n = 1 THEN 'PASA' ELSE 'FALLA' END;
  BEGIN
    PERFORM count(*) FROM siget.tramite;
    RAISE NOTICE 'PRUEBA 16 auditor lee tramites: FALLA';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PRUEBA 16 auditor lee tramites: PASA (permission denied)';
  END;
  BEGIN
    INSERT INTO siget.decision_pdp (accion, permitido) VALUES ('x', true);
    RAISE NOTICE 'PRUEBA 17 auditor escribe decisiones: FALLA';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PRUEBA 17 auditor escribe decisiones: PASA (permission denied)';
  END;
  RESET ROLE;

  -- 18. ZERO TRUST: ningun rol del proyecto es superusuario ni evita RLS
  SELECT count(*) INTO n FROM pg_roles
   WHERE rolname IN ('siget_owner', 'app_role', 'auditor_role')
     AND (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb);
  RAISE NOTICE 'PRUEBA 18 roles del proyecto con privilegios de superusuario: % (esperado 0): %', n, CASE WHEN n = 0 THEN 'PASA' ELSE 'FALLA' END;
  SELECT count(*) INTO n FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
   JOIN pg_roles r ON r.oid = c.relowner
   WHERE ns.nspname = 'siget' AND c.relkind = 'r' AND r.rolsuper;
  RAISE NOTICE 'PRUEBA 19 tablas del esquema cuyo duenio es superusuario: % (esperado 0): %', n, CASE WHEN n = 0 THEN 'PASA' ELSE 'FALLA' END;
END $$;
