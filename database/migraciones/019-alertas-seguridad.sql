-- ============================================================================
-- Migracion 019: alertas ante patrones sospechosos (PT-10, requisito RS-24, ZT-8)
-- ============================================================================
-- Se ejecuta como siget_owner (duenio de los objetos), no como superusuario.
--
-- * siget.alerta_seguridad: una alerta por patron sospechoso detectado en los eventos de seguridad y en las decisiones del PDP. El
--   detalle lleva SOLO contadores y nombres de evento o de politica: nunca contrasenas, tokens, hashes, cedula ni correo. La persona
--   involucrada, cuando la hay, es usuario_id (la interfaz muestra su username); la IP, cuando el patron es por IP.
-- * siget.detectar_anomalias(): las crea o las actualiza (SECURITY DEFINER, ruta de busqueda fija, como escalar_vencidos de la 013).
--   Cuatro reglas sobre ventanas recientes:
--     rafaga_login_fallido_ip  (media): 10 o mas login_fallido o cambio_contrasena_fallido desde una misma IP en 10 minutos.
--     denegaciones_persona     (media): 5 o mas decisiones del PDP negadas para una misma persona en 10 minutos.
--     reuso_token_refresco     (alta):  cualquier refresh_reuso (una alerta por persona mientras este abierta).
--     bloqueos_repetidos       (alta):  2 o mas cuenta_bloqueada de una misma cuenta en 24 horas.
--   Las ventanas son deslizantes: se mira la hora de cada evento, no solo el periodo anterior a la corrida. Las reglas de 10 minutos
--   revisan la ultima hora y las de 24 horas, el ultimo dia, para no perder una rafaga si el temporizador estuvo detenido.
--   Dedupe: UNA alerta abierta por (regla, persona, IP). Si ya existe, se actualizan conteo y ultima_vez en lugar de crear otra.
--   Idempotente: sin eventos nuevos, correrla de nuevo no cambia nada y devuelve 0. Una alerta ya revisada o descartada no se reabre
--   ni se repite con los MISMOS eventos: solo cuentan los posteriores a su ultima_vez.
--   Devuelve cuantas alertas creo o actualizo.
-- * detector_role: LOGIN, sin superusuario, sin BYPASSRLS, sin acceso a ninguna tabla; solo EXECUTE sobre esa funcion. Su contrasena NO va
--   aqui: se fija aparte y vive como podman secret en VM1 (igual que escalador_role).
-- * Revision: app_role ve las alertas y cambia SOLO estado, revisada_por, revisada_en y nota (UPDATE por columna); no inserta ni borra
--   (solo inserta la funcion). Un disparador deja pasar unicamente abierta -> revisada o descartada, una vez, con nota, y por un usuario
--   con rol_plataforma = 'operador_seguridad' que ademas sea quien tiene el contexto de la sesion; la hora la fija la base. Seguridad por
--   filas: app_role ve y revisa alertas solo si la sesion es de un operador de seguridad activo; auditor_role las lee (como el resto de
--   la auditoria). Nada para pgadmin_lectura, escalador_role ni checkpoint_app.
-- * Indices nuevos en evento_seguridad y decision_pdp (los filtros son por tiempo y no tenian ninguno que sirviera).
-- ============================================================================
BEGIN;
SET LOCAL ROLE siget_owner;

-- ---------------------------------------------------------------------------
-- 1. La tabla
-- ---------------------------------------------------------------------------
CREATE TABLE siget.alerta_seguridad (
  id            bigserial PRIMARY KEY,
  regla         text NOT NULL CHECK (regla IN ('rafaga_login_fallido_ip', 'denegaciones_persona', 'reuso_token_refresco', 'bloqueos_repetidos')),
  severidad     text NOT NULL CHECK (severidad IN ('media', 'alta')),
  usuario_id    int REFERENCES siget.usuario(id),
  ip            inet,
  conteo        int NOT NULL CHECK (conteo >= 1),
  primera_vez   timestamptz NOT NULL,
  ultima_vez    timestamptz NOT NULL,
  detalle       jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(detalle) = 'object'),
  estado        text NOT NULL DEFAULT 'abierta' CHECK (estado IN ('abierta', 'revisada', 'descartada')),
  revisada_por  int REFERENCES siget.usuario(id),
  revisada_en   timestamptz,
  nota          text CHECK (nota IS NULL OR length(nota) <= 1000),
  CONSTRAINT alerta_ultima_despues_de_primera CHECK (ultima_vez >= primera_vez),
  -- Abierta: sin datos de revision. Cerrada: con quien, cuando y por que
  CONSTRAINT alerta_revision_coherente CHECK (
    (estado = 'abierta' AND revisada_por IS NULL AND revisada_en IS NULL AND nota IS NULL)
    OR (estado <> 'abierta' AND revisada_por IS NOT NULL AND revisada_en IS NOT NULL AND nota IS NOT NULL AND length(btrim(nota)) >= 3))
);
-- Una alerta ABIERTA por (regla, persona, IP). Los NULL cuentan como iguales (sustitutos que no son ni un id ni una IP reales)
CREATE UNIQUE INDEX alerta_abierta_unica ON siget.alerta_seguridad (regla, COALESCE(usuario_id, 0), COALESCE(ip, '0.0.0.0'::inet))
  WHERE estado = 'abierta';
CREATE INDEX alerta_estado_idx ON siget.alerta_seguridad (estado, ultima_vez DESC);
CREATE INDEX alerta_usuario_idx ON siget.alerta_seguridad (usuario_id);  -- la clave foranea

-- Filtros por tiempo del detector: sin estos indices recorreria las dos tablas de auditoria enteras en cada corrida
CREATE INDEX evento_seguridad_evento_creado_idx ON siget.evento_seguridad (evento, creado_en);
CREATE INDEX decision_pdp_negadas_idx ON siget.decision_pdp (creado_en) WHERE NOT permitido;

-- Una alerta es evidencia: no se borra ni se vacia la tabla
CREATE TRIGGER alerta_sin_borrado BEFORE DELETE ON siget.alerta_seguridad
  FOR EACH ROW EXECUTE FUNCTION siget.bloquear_modificacion();
CREATE TRIGGER alerta_sin_truncate BEFORE TRUNCATE ON siget.alerta_seguridad
  FOR EACH STATEMENT EXECUTE FUNCTION siget.bloquear_modificacion();

-- ---------------------------------------------------------------------------
-- 2. Auxiliares
-- ---------------------------------------------------------------------------
-- La IP de evento_seguridad es texto libre (la pone la aplicacion): una invalida no debe romper al detector
CREATE FUNCTION siget.ip_o_nulo(p text) RETURNS inet LANGUAGE plpgsql IMMUTABLE
  SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF p IS NULL OR position('/' IN p) > 0 THEN
    RETURN NULL;
  END IF;
  RETURN p::inet;
EXCEPTION WHEN invalid_text_representation THEN
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION siget.ip_o_nulo(text) FROM PUBLIC;

-- ¿Es una persona con el rol de operador de seguridad y la cuenta activa? SECURITY DEFINER: la usan la seguridad por filas y el
-- disparador de revision, que corren como app_role
CREATE FUNCTION siget.es_operador_seguridad(p_usuario int) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = siget, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM siget.usuario u
                  WHERE u.id = p_usuario AND u.rol_plataforma = 'operador_seguridad' AND u.estado_cuenta = 'activa')
$$;
REVOKE ALL ON FUNCTION siget.es_operador_seguridad(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION siget.es_operador_seguridad(int) TO app_role;

-- ---------------------------------------------------------------------------
-- 3. El detector
-- ---------------------------------------------------------------------------
CREATE FUNCTION siget.detectar_anomalias() RETURNS int LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = siget, pg_temp AS $$
DECLARE
  v_total int;
BEGIN
  WITH
  -- regla, severidad, ventana (minutos), umbral
  reglas (regla, severidad, ventana_min, umbral) AS (VALUES
    ('rafaga_login_fallido_ip', 'media', 10, 10),
    ('denegaciones_persona',    'media', 10, 5),
    ('reuso_token_refresco',    'alta',  1440, 1),
    ('bloqueos_repetidos',      'alta',  1440, 2)),
  -- Los eventos que cuentan para alguna regla: (regla, persona, IP, nombre del evento o de la politica, hora)
  eventos AS (
    SELECT 'rafaga_login_fallido_ip' AS regla, NULL::int AS usuario_id, siget.ip_o_nulo(e.ip) AS ip, e.evento AS nombre, e.creado_en
      FROM siget.evento_seguridad e
     WHERE e.evento IN ('login_fallido', 'cambio_contrasena_fallido') AND e.creado_en > now() - interval '1 hour'
       AND siget.ip_o_nulo(e.ip) IS NOT NULL
    UNION ALL
    SELECT 'denegaciones_persona', d.actor_id, NULL::inet, coalesce(d.politica, 'sin_politica'), d.creado_en
      FROM siget.decision_pdp d
     WHERE NOT d.permitido AND d.actor_id IS NOT NULL AND d.creado_en > now() - interval '1 hour'
    UNION ALL
    SELECT 'reuso_token_refresco', e.actor_id, NULL::inet, e.evento, e.creado_en
      FROM siget.evento_seguridad e
     WHERE e.evento = 'refresh_reuso' AND e.actor_id IS NOT NULL AND e.creado_en > now() - interval '24 hours'
    UNION ALL
    SELECT 'bloqueos_repetidos', e.actor_id, NULL::inet, e.evento, e.creado_en
      FROM siget.evento_seguridad e
     WHERE e.evento = 'cuenta_bloqueada' AND e.actor_id IS NOT NULL AND e.creado_en > now() - interval '24 hours'),
  -- Hasta donde llega lo que ya se revisó o descartó para cada clave: esos eventos no vuelven a alertar
  cerradas AS (
    SELECT regla, usuario_id, ip, max(ultima_vez) AS hasta
      FROM siget.alerta_seguridad WHERE estado <> 'abierta' GROUP BY regla, usuario_id, ip),
  nuevos AS (
    SELECT e.* FROM eventos e
      LEFT JOIN cerradas c ON c.regla = e.regla AND c.usuario_id IS NOT DISTINCT FROM e.usuario_id AND c.ip IS NOT DISTINCT FROM e.ip
     WHERE e.creado_en > coalesce(c.hasta, '-infinity'::timestamptz)),
  -- Cuantos eventos de la misma clave hay en la ventana que termina en cada uno (la ventana deslizante)
  ventanas AS (
    SELECT n.*,
           count(*) OVER w10 AS n10, first_value(n.creado_en) OVER w10 AS desde10,
           count(*) OVER w24 AS n24, first_value(n.creado_en) OVER w24 AS desde24
      FROM nuevos n
    WINDOW w10 AS (PARTITION BY n.regla, n.usuario_id, n.ip ORDER BY n.creado_en RANGE BETWEEN interval '10 minutes' PRECEDING AND CURRENT ROW),
           w24 AS (PARTITION BY n.regla, n.usuario_id, n.ip ORDER BY n.creado_en RANGE BETWEEN interval '24 hours' PRECEDING AND CURRENT ROW)),
  candidatas AS (
    SELECT v.regla, r.severidad, v.usuario_id, v.ip, r.ventana_min, r.umbral,
           max(CASE WHEN r.ventana_min = 10 THEN v.n10 ELSE v.n24 END) AS conteo,
           min(CASE WHEN r.ventana_min = 10 THEN v.desde10 ELSE v.desde24 END) AS primera_vez,
           max(v.creado_en) AS ultima_vez
      FROM ventanas v JOIN reglas r ON r.regla = v.regla
     WHERE CASE WHEN r.ventana_min = 10 THEN v.n10 ELSE v.n24 END >= r.umbral
     GROUP BY v.regla, r.severidad, v.usuario_id, v.ip, r.ventana_min, r.umbral),
  -- El detalle: cuantos eventos hubo de cada nombre entre la primera y la ultima vez. Solo contadores y nombres
  detalladas AS (
    SELECT c.*,
           (SELECT jsonb_object_agg(x.nombre, x.k)
              FROM (SELECT n.nombre, count(*) AS k FROM nuevos n
                     WHERE n.regla = c.regla AND n.usuario_id IS NOT DISTINCT FROM c.usuario_id AND n.ip IS NOT DISTINCT FROM c.ip
                       AND n.creado_en BETWEEN c.primera_vez AND c.ultima_vez
                     GROUP BY n.nombre) x) AS por_nombre
      FROM candidatas c),
  cambios AS (
    INSERT INTO siget.alerta_seguridad AS a (regla, severidad, usuario_id, ip, conteo, primera_vez, ultima_vez, detalle)
    SELECT d.regla, d.severidad, d.usuario_id, d.ip, d.conteo, d.primera_vez, d.ultima_vez,
           jsonb_build_object('ventana_minutos', d.ventana_min, 'umbral', d.umbral, 'por_nombre', coalesce(d.por_nombre, '{}'::jsonb))
      FROM detalladas d
    ON CONFLICT (regla, COALESCE(usuario_id, 0), COALESCE(ip, '0.0.0.0'::inet)) WHERE estado = 'abierta'
    DO UPDATE SET conteo = GREATEST(a.conteo, EXCLUDED.conteo),
                  ultima_vez = GREATEST(a.ultima_vez, EXCLUDED.ultima_vez),
                  detalle = CASE WHEN EXCLUDED.conteo >= a.conteo THEN EXCLUDED.detalle ELSE a.detalle END
      -- Solo si hay algo nuevo: sin eventos nuevos no se toca la fila (y no se cuenta)
      WHERE a.conteo < EXCLUDED.conteo OR a.ultima_vez < EXCLUDED.ultima_vez
    RETURNING 1)
  SELECT count(*) INTO v_total FROM cambios;
  RETURN v_total;
END $$;
REVOKE ALL ON FUNCTION siget.detectar_anomalias() FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 4. La revision: una sola vez, con nota y por el operador de seguridad
-- ---------------------------------------------------------------------------
-- Invoker: no necesita privilegios propios (es_operador_seguridad ya es SECURITY DEFINER). Tambien corre cuando el detector actualiza
-- una alerta abierta: ahi solo cambian conteo, ultima_vez y detalle, y lo demas debe quedar igual.
CREATE FUNCTION siget.alerta_valida_cambio() RETURNS trigger LANGUAGE plpgsql
  SET search_path = siget, pg_temp AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.regla IS DISTINCT FROM OLD.regla OR NEW.severidad IS DISTINCT FROM OLD.severidad
     OR NEW.usuario_id IS DISTINCT FROM OLD.usuario_id OR NEW.ip IS DISTINCT FROM OLD.ip OR NEW.primera_vez IS DISTINCT FROM OLD.primera_vez THEN
    RAISE EXCEPTION 'De una alerta solo cambian el conteo, la ultima vez, el detalle y su revision';
  END IF;
  IF OLD.estado <> 'abierta' THEN
    RAISE EXCEPTION 'Una alerta revisada o descartada no se vuelve a cambiar ni a abrir';
  END IF;
  IF NEW.estado = 'abierta' THEN
    -- Sigue abierta: nadie la revisa por esta via (la restriccion de la tabla tambien lo exige)
    IF NEW.revisada_por IS NOT NULL OR NEW.revisada_en IS NOT NULL OR NEW.nota IS NOT NULL THEN
      RAISE EXCEPTION 'Una alerta abierta no lleva datos de revision';
    END IF;
    RETURN NEW;
  END IF;
  -- abierta -> revisada o descartada
  IF NEW.conteo IS DISTINCT FROM OLD.conteo OR NEW.ultima_vez IS DISTINCT FROM OLD.ultima_vez OR NEW.detalle IS DISTINCT FROM OLD.detalle THEN
    RAISE EXCEPTION 'Al revisar una alerta no se cambian sus contadores';
  END IF;
  IF NEW.nota IS NULL OR length(btrim(NEW.nota)) < 3 THEN
    RAISE EXCEPTION 'Revisar una alerta exige una nota';
  END IF;
  IF NEW.revisada_por IS NULL OR NOT siget.es_operador_seguridad(NEW.revisada_por) THEN
    RAISE EXCEPTION 'Solo un operador de seguridad revisa alertas';
  END IF;
  -- Con sesion de la aplicacion, quien revisa es quien tiene el contexto (nadie revisa a nombre de otra persona)
  IF siget.ctx_usuario() IS NOT NULL AND siget.ctx_usuario() <> NEW.revisada_por THEN
    RAISE EXCEPTION 'La revision se registra a nombre de quien la hace';
  END IF;
  NEW.revisada_en := now();
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION siget.alerta_valida_cambio() FROM PUBLIC;
CREATE TRIGGER alerta_valida_cambio BEFORE UPDATE ON siget.alerta_seguridad
  FOR EACH ROW EXECUTE FUNCTION siget.alerta_valida_cambio();

-- ---------------------------------------------------------------------------
-- 5. Permisos y seguridad por filas
-- ---------------------------------------------------------------------------
REVOKE ALL ON siget.alerta_seguridad FROM PUBLIC;
REVOKE ALL ON siget.alerta_seguridad FROM pgadmin_lectura, checkpoint_app, escalador_role;
-- Sin INSERT ni DELETE (y sin USAGE de la secuencia): solo inserta la funcion del detector
GRANT SELECT ON siget.alerta_seguridad TO app_role;
GRANT UPDATE (estado, revisada_por, revisada_en, nota) ON siget.alerta_seguridad TO app_role;
GRANT SELECT ON siget.alerta_seguridad TO auditor_role;  -- como lee evento_seguridad y decision_pdp

ALTER TABLE siget.alerta_seguridad ENABLE ROW LEVEL SECURITY;
CREATE POLICY alerta_ver_operador ON siget.alerta_seguridad FOR SELECT TO app_role
  USING (siget.es_operador_seguridad(siget.ctx_usuario()));
CREATE POLICY alerta_revisar_operador ON siget.alerta_seguridad FOR UPDATE TO app_role
  USING (siget.es_operador_seguridad(siget.ctx_usuario()))
  WITH CHECK (siget.es_operador_seguridad(siget.ctx_usuario()));
CREATE POLICY alerta_ver_auditor ON siget.alerta_seguridad FOR SELECT TO auditor_role
  USING (true);

COMMIT;

-- El rol se crea fuera del SET LOCAL ROLE: crear roles requiere CREATEROLE (lo hace el superusuario del contenedor).
BEGIN;
CREATE ROLE detector_role LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 2;
GRANT CONNECT ON DATABASE tramites_demo TO detector_role;
GRANT USAGE ON SCHEMA siget TO detector_role;
GRANT EXECUTE ON FUNCTION siget.detectar_anomalias() TO detector_role;
COMMIT;
