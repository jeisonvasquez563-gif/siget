-- ============================================================================
-- Migracion 022: indicadores de la institucion para la supervision y la coordinacion
-- ============================================================================
-- Se ejecuta como siget_owner (duenio de los objetos), no como superusuario.
--
-- * siget.indicadores_institucion(p_institucion int) devuelve SOLO agregados de una institucion: conteo por estado, abiertos, vencidos,
--   escalados abiertos, tiempo promedio de resolucion (dias) de los resueltos en los ultimos 90 dias y los tramites abiertos por
--   funcionario (id y username del PERSONAL, nunca de la ciudadania). Sin ids de tramites ni datos de personas solicitantes.
--   La coordinacion no ve tramites por la seguridad por filas (solo los roles que atienden estan en siget.ctx_instituciones()):
--   igual que siget.tramites_abiertos_de() (011), la funcion es SECURITY DEFINER con ruta de busqueda fija y responde solo agregados.
-- * La funcion verifica ADENTRO quien pregunta: siget.ctx_usuario() debe ser supervisor o coordinador_institucional VIGENTE de
--   p_institucion (membresia no revocada y cuenta activa). Sin contexto de usuario o sin ese rol: error 42501 y ningun dato. Es la segunda
--   defensa; la primera es el PDP (VER_INDICADORES_INSTITUCION).
-- * EXECUTE solo para app_role (ni PUBLIC ni los demas roles).
-- * "Abierto" = estado distinto de Aprobado, Rechazado y Desistido (este ultimo lo agrega la migracion 021; comparar por texto no exige
--   que ya exista). "Resuelto" = Aprobado o Rechazado: el tiempo se mide desde la creacion del tramite hasta el evento de cambio de
--   estado en evento_auditoria (la tabla tramite no guarda cuando se resolvio).
-- * Compatibilidad: no cambia ninguna tabla. El backend anterior no la conoce y no le estorba: se puede migrar la base antes del codigo.
-- ============================================================================
BEGIN;
SET LOCAL ROLE siget_owner;

CREATE FUNCTION siget.indicadores_institucion(p_institucion int) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = siget, pg_temp AS $$
DECLARE
  v_usuario  int := siget.ctx_usuario();
  v_estados  jsonb;
  v_carga    jsonb;
  v_resumen  record;
  v_dias     numeric;
  v_resueltos int;
BEGIN
  IF v_usuario IS NULL OR p_institucion IS NULL OR NOT EXISTS (
       SELECT 1 FROM siget.membresia m JOIN siget.usuario u ON u.id = m.usuario_id
        WHERE m.usuario_id = v_usuario AND m.institucion_id = p_institucion
          AND m.rol IN ('supervisor', 'coordinador_institucional')
          AND m.revocada_en IS NULL AND u.estado_cuenta = 'activa') THEN
    RAISE EXCEPTION 'Indicadores: solo la supervision o la coordinacion vigente de la institucion' USING ERRCODE = '42501';
  END IF;

  -- Conteo por estado: los cinco estados de siempre (aunque sean 0) y cualquier otro que exista (por ejemplo Desistido)
  SELECT coalesce(jsonb_object_agg(e.estado, coalesce(c.total, 0) ORDER BY e.estado), '{}'::jsonb) INTO v_estados
    FROM (SELECT estado FROM (VALUES ('Pendiente'), ('En Tramitacion'), ('En Subsanacion'), ('Aprobado'), ('Rechazado')) AS b(estado)
          UNION SELECT DISTINCT estado FROM siget.tramite WHERE institucion_id = p_institucion) AS e
    LEFT JOIN (SELECT estado, count(*)::int AS total FROM siget.tramite WHERE institucion_id = p_institucion GROUP BY estado) AS c
           ON c.estado = e.estado;

  SELECT count(*) FILTER (WHERE estado NOT IN ('Aprobado', 'Rechazado', 'Desistido'))::int AS abiertos,
         count(*) FILTER (WHERE estado NOT IN ('Aprobado', 'Rechazado', 'Desistido') AND fecha_limite < now())::int AS vencidos,
         count(*) FILTER (WHERE estado NOT IN ('Aprobado', 'Rechazado', 'Desistido') AND escalado_en IS NOT NULL)::int AS escalados,
         count(*) FILTER (WHERE estado NOT IN ('Aprobado', 'Rechazado', 'Desistido') AND funcionario_asignado_id IS NULL)::int AS sin_asignar
    INTO v_resumen
    FROM siget.tramite WHERE institucion_id = p_institucion;

  -- Tiempo de resolucion: de la creacion al cambio a Aprobado o Rechazado, en los ultimos 90 dias
  SELECT count(*)::int, round(avg(extract(epoch FROM (e.creado_en - t.creado_en)) / 86400.0)::numeric, 1) INTO v_resueltos, v_dias
    FROM siget.evento_auditoria e JOIN siget.tramite t ON t.id = e.tramite_id
   WHERE t.institucion_id = p_institucion AND e.accion = 'cambio_estado' AND e.estado_nuevo IN ('Aprobado', 'Rechazado')
     AND e.creado_en >= now() - interval '90 days';

  -- Carga por funcionario: solo personal de ESA institucion (nunca quien solicito un tramite)
  SELECT coalesce(jsonb_agg(jsonb_build_object('usuario_id', x.id, 'usuario', x.username, 'abiertos', x.abiertos)
                            ORDER BY x.abiertos DESC, x.username), '[]'::jsonb) INTO v_carga
    FROM (SELECT u.id, u.username, count(*)::int AS abiertos
            FROM siget.tramite t JOIN siget.usuario u ON u.id = t.funcionario_asignado_id
           WHERE t.institucion_id = p_institucion AND t.estado NOT IN ('Aprobado', 'Rechazado', 'Desistido')
             AND EXISTS (SELECT 1 FROM siget.membresia m
                          WHERE m.usuario_id = u.id AND m.institucion_id = p_institucion AND m.rol IN ('funcionario', 'supervisor'))
           GROUP BY u.id, u.username) AS x;

  RETURN jsonb_build_object(
    'por_estado', v_estados, 'abiertos', v_resumen.abiertos, 'vencidos', v_resumen.vencidos,
    'escalados_abiertos', v_resumen.escalados, 'sin_asignar', v_resumen.sin_asignar,
    'resueltos_90_dias', v_resueltos, 'dias_promedio_resolucion', v_dias, 'por_funcionario', v_carga);
END $$;
REVOKE ALL ON FUNCTION siget.indicadores_institucion(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION siget.indicadores_institucion(int) TO app_role;

COMMIT;
