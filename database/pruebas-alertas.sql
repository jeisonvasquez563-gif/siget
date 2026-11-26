-- ============================================================================
-- SIGET: pruebas de la migracion 019 (alertas ante patrones sospechosos)
-- Se ejecuta como el superusuario del contenedor, DESPUES de aplicar la migracion, dentro de una transaccion que se
-- revierte (no deja nada guardado):  psql -v ON_ERROR_STOP=1 -f pruebas-alertas.sql  ... y termina en ROLLBACK.
-- Cada prueba imprime PASA o FALLA con RAISE NOTICE y al final hay un resumen.
-- Crea sus propios eventos de prueba (personas p019_*, IP de documentacion 192.0.2.0/24) y corre siget.detectar_anomalias() COMO
-- detector_role. Cada asercion filtra por esas personas e IP: corre sobre la base real, que puede tener eventos reales, y no depende
-- de que no los haya. (La funcion procesa tambien los eventos reales: las alertas que cree por ellos se revierten con el ROLLBACK.)
-- ADVERTENCIA: conviene correrlo con el temporizador del detector detenido o lejos de los minutos multiplos de 5. No se usa psql -1
-- (el archivo ya trae su BEGIN y su ROLLBACK).
-- ============================================================================
BEGIN;

CREATE TEMP TABLE _p019 (clave text PRIMARY KEY, id bigint NOT NULL) ON COMMIT DROP;
CREATE TEMP TABLE _res (ok boolean NOT NULL, texto text NOT NULL) ON COMMIT DROP;

CREATE FUNCTION pg_temp.r(p_ok boolean, p_texto text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO _res VALUES (coalesce(p_ok, false), p_texto);
  RAISE NOTICE '% %', CASE WHEN coalesce(p_ok, false) THEN 'PASA ' ELSE 'FALLA' END, p_texto;
END $$;
CREATE FUNCTION pg_temp.id(p text) RETURNS bigint LANGUAGE sql AS $$ SELECT id FROM _p019 WHERE clave = p $$;
-- Ejecuta una sentencia y devuelve el SQLSTATE con el que fallo, o 'sin_error' si no fallo (en ese caso la deshace)
CREATE FUNCTION pg_temp.intenta(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RAISE EXCEPTION 'sin_error' USING ERRCODE = 'P0099';
EXCEPTION
  WHEN SQLSTATE 'P0099' THEN RETURN 'sin_error';
  WHEN OTHERS THEN RETURN SQLSTATE;
END $$;
-- Cuantas filas afecta una sentencia (y la deshace siempre)
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
END $$;
-- Cuantas alertas de la regla y el estado hay para una IP o para una persona de la prueba
CREATE FUNCTION pg_temp.n_ip(p_ip text, p_estado text DEFAULT NULL) RETURNS int LANGUAGE sql AS
  $$ SELECT count(*)::int FROM siget.alerta_seguridad
      WHERE regla = 'rafaga_login_fallido_ip' AND ip = p_ip::inet AND (p_estado IS NULL OR estado = p_estado) $$;
CREATE FUNCTION pg_temp.n_u(p_regla text, p_usuario text, p_estado text DEFAULT NULL) RETURNS int LANGUAGE sql AS
  $$ SELECT count(*)::int FROM siget.alerta_seguridad
      WHERE regla = p_regla AND usuario_id = pg_temp.id(p_usuario) AND (p_estado IS NULL OR estado = p_estado) $$;

-- ---------------------------------------------------------------------------
-- Preparacion: personas y eventos
-- ---------------------------------------------------------------------------
INSERT INTO siget.usuario (username, password_hash) VALUES
  ('p019_den5', '!'), ('p019_den4', '!'), ('p019_denlento', '!'), ('p019_denperm', '!'),
  ('p019_reuso', '!'), ('p019_reusoviejo', '!'), ('p019_bloq2', '!'), ('p019_bloq1', '!'), ('p019_bloqviejo', '!'),
  ('p019_ciudadana', '!');
INSERT INTO siget.usuario (username, password_hash, rol_plataforma) VALUES
  ('p019_oper', '!', 'operador_seguridad'), ('p019_oper2', '!', 'operador_seguridad');
INSERT INTO _p019 SELECT substr(username, 6), id FROM siget.usuario WHERE username LIKE 'p019\_%';

-- Lo que es de la prueba (por persona o por IP de documentacion)
CREATE TEMP VIEW _alertas_p019 AS
  SELECT * FROM siget.alerta_seguridad WHERE ip <<= '192.0.2.0/24'::inet OR usuario_id IN (SELECT id FROM _p019);

-- Rafagas por IP. El detalle del primer evento lleva un valor que NO debe llegar a la alerta.
INSERT INTO siget.evento_seguridad (actor_id, evento, ip, detalle, creado_en)
SELECT NULL, 'login_fallido', '192.0.2.10', '{"motivo": "valor-sensible-p019"}'::jsonb, now() - interval '9 minutes' + g * interval '30 seconds'
  FROM generate_series(1, 10) g;                                   -- 10 en 10 minutos: alerta
INSERT INTO siget.evento_seguridad (actor_id, evento, ip, creado_en)
SELECT NULL, 'login_fallido', '192.0.2.11', now() - interval '9 minutes' + g * interval '30 seconds'
  FROM generate_series(1, 9) g;                                    -- 9: bajo el umbral
INSERT INTO siget.evento_seguridad (actor_id, evento, ip, creado_en)
SELECT NULL, CASE WHEN g <= 6 THEN 'login_fallido' ELSE 'cambio_contrasena_fallido' END, '192.0.2.12', now() - interval '9 minutes' + g * interval '30 seconds'
  FROM generate_series(1, 10) g;                                   -- 6 + 4 mezclados: cuentan juntos
INSERT INTO siget.evento_seguridad (actor_id, evento, ip, creado_en)
SELECT NULL, 'login_fallido', '192.0.2.13', now() - interval '55 minutes' + g * interval '5 minutes'
  FROM generate_series(1, 10) g;                                   -- 10 repartidos en 50 minutos: nunca 10 en 10 minutos
INSERT INTO siget.evento_seguridad (actor_id, evento, ip, creado_en)
SELECT NULL, 'login_fallido', '192.0.2.14', now() - interval '3 hours' + g * interval '10 seconds'
  FROM generate_series(1, 10) g;                                   -- 10 juntos pero hace 3 horas: fuera de lo que se revisa
INSERT INTO siget.evento_seguridad (actor_id, evento, ip, creado_en)
SELECT NULL, 'login_exitoso', '192.0.2.15', now() - interval '9 minutes' + g * interval '30 seconds'
  FROM generate_series(1, 12) g;                                   -- otros eventos no cuentan
INSERT INTO siget.evento_seguridad (actor_id, evento, ip, creado_en)
SELECT NULL, 'login_fallido', 'no-es-una-ip', now() - interval '9 minutes' + g * interval '30 seconds'
  FROM generate_series(1, 12) g;                                   -- IP invalida: no rompe al detector ni alerta
INSERT INTO siget.evento_seguridad (actor_id, evento, ip, creado_en)
SELECT NULL, 'login_fallido', '192.0.2.16', now() - interval '9 minutes' + g * interval '30 seconds'
  FROM generate_series(1, 10) g;                                   -- para el dedupe

-- Denegaciones del PDP por persona
INSERT INTO siget.decision_pdp (actor_id, accion, recurso, permitido, politica, creado_en)
SELECT pg_temp.id('den5'), 'ver_tramite', 'tramite', false, CASE WHEN g <= 3 THEN 'sin_regla_que_permita' ELSE 'cuenta_no_activa' END,
       now() - interval '5 minutes' + g * interval '20 seconds'
  FROM generate_series(1, 5) g;                                    -- 5 negadas en 10 minutos: alerta
INSERT INTO siget.decision_pdp (actor_id, accion, recurso, permitido, politica, creado_en)
SELECT pg_temp.id('den4'), 'ver_tramite', 'tramite', false, 'sin_regla_que_permita', now() - interval '5 minutes' + g * interval '20 seconds'
  FROM generate_series(1, 4) g;                                    -- 4: bajo el umbral
INSERT INTO siget.decision_pdp (actor_id, accion, recurso, permitido, politica, creado_en)
SELECT pg_temp.id('denlento'), 'ver_tramite', 'tramite', false, 'sin_regla_que_permita', now() - interval '28 minutes' + g * interval '5 minutes'
  FROM generate_series(1, 5) g;                                    -- 5 en 25 minutos: nunca 5 en 10 minutos
INSERT INTO siget.decision_pdp (actor_id, accion, recurso, permitido, politica, creado_en)
SELECT pg_temp.id('denperm'), 'ver_tramite', 'tramite', (g > 3), 'x', now() - interval '5 minutes' + g * interval '20 seconds'
  FROM generate_series(1, 11) g;                                   -- 3 negadas y 8 permitidas: las permitidas no cuentan

-- Un actor_id que no existe en usuario (decision_pdp no tiene clave foranea): 5 negadas no deben romper la corrida ni crear alerta
INSERT INTO _p019 VALUES ('huerfano', (SELECT max(id) + 1000000 FROM siget.usuario));
INSERT INTO siget.decision_pdp (actor_id, accion, recurso, permitido, politica, creado_en)
SELECT pg_temp.id('huerfano'), 'ver_tramite', 'tramite', false, 'sin_regla_que_permita', now() - interval '5 minutes' + g * interval '20 seconds'
  FROM generate_series(1, 5) g;

-- Reuso de token de refresco
INSERT INTO siget.evento_seguridad (actor_id, evento, ip, creado_en) VALUES
  (pg_temp.id('reuso'), 'refresh_reuso', '192.0.2.20', now() - interval '30 minutes'),
  (pg_temp.id('reusoviejo'), 'refresh_reuso', '192.0.2.21', now() - interval '25 hours');   -- fuera del dia que se revisa

-- Bloqueos repetidos
INSERT INTO siget.evento_seguridad (actor_id, evento, ip, creado_en) VALUES
  (pg_temp.id('bloq2'), 'cuenta_bloqueada', '192.0.2.22', now() - interval '5 hours'),
  (pg_temp.id('bloq2'), 'cuenta_bloqueada', '192.0.2.22', now() - interval '2 hours'),       -- 2 en 24 horas: alerta
  (pg_temp.id('bloq1'), 'cuenta_bloqueada', '192.0.2.23', now() - interval '2 hours'),       -- 1: bajo el umbral
  (pg_temp.id('bloqviejo'), 'cuenta_bloqueada', '192.0.2.24', now() - interval '30 hours'),
  (pg_temp.id('bloqviejo'), 'cuenta_bloqueada', '192.0.2.24', now() - interval '1 hour');    -- 2, pero uno hace mas de 24 horas

-- ---------------------------------------------------------------------------
-- Primera corrida, COMO detector_role
-- ---------------------------------------------------------------------------
SET LOCAL ROLE detector_role;
SELECT set_config('p019.corrida1', siget.detectar_anomalias()::text, true) AS corrida_1;
RESET ROLE;

DO $$
DECLARE
  v_ok boolean;
  v_total int;
BEGIN
  -- Rafaga por IP
  v_ok := (SELECT count(*) FROM siget.alerta_seguridad WHERE regla = 'rafaga_login_fallido_ip' AND ip = '192.0.2.10'::inet AND estado = 'abierta'
              AND severidad = 'media' AND conteo = 10 AND usuario_id IS NULL) = 1;
  PERFORM pg_temp.r(v_ok, '10 login_fallido desde una IP en 10 minutos crean UNA alerta media, con conteo 10 y sin persona');
  PERFORM pg_temp.r(pg_temp.n_ip('192.0.2.11') = 0, '9 login_fallido (bajo el umbral) no alertan');
  v_ok := (SELECT count(*) FROM siget.alerta_seguridad WHERE ip = '192.0.2.12'::inet AND conteo = 10 AND detalle -> 'por_nombre' ->> 'login_fallido' = '6'
              AND detalle -> 'por_nombre' ->> 'cambio_contrasena_fallido' = '4') = 1;
  PERFORM pg_temp.r(v_ok, 'login_fallido y cambio_contrasena_fallido de una misma IP se suman (6 + 4) y el detalle los cuenta por nombre');
  PERFORM pg_temp.r(pg_temp.n_ip('192.0.2.13') = 0, '10 fallos repartidos en 50 minutos (nunca 10 en 10 minutos) no alertan');
  PERFORM pg_temp.r(pg_temp.n_ip('192.0.2.14') = 0, '10 fallos de hace 3 horas (fuera de la ventana revisada) no alertan');
  PERFORM pg_temp.r(pg_temp.n_ip('192.0.2.15') = 0, 'otros eventos (login_exitoso) de una IP no cuentan');
  PERFORM pg_temp.r(current_setting('p019.corrida1', true) IS NOT NULL
                    AND NOT EXISTS (SELECT 1 FROM siget.alerta_seguridad WHERE regla = 'rafaga_login_fallido_ip' AND ip IS NULL),
                    'una IP invalida en un evento no rompe al detector ni genera una alerta sin IP');

  -- Denegaciones del PDP
  v_ok := (SELECT count(*) FROM siget.alerta_seguridad WHERE regla = 'denegaciones_persona' AND usuario_id = pg_temp.id('den5') AND ip IS NULL
              AND severidad = 'media' AND estado = 'abierta' AND conteo = 5 AND detalle -> 'por_nombre' ->> 'sin_regla_que_permita' = '3'
              AND detalle -> 'por_nombre' ->> 'cuenta_no_activa' = '2') = 1;
  PERFORM pg_temp.r(v_ok, '5 decisiones negadas de una persona en 10 minutos crean una alerta media, con las politicas contadas en el detalle');
  PERFORM pg_temp.r(pg_temp.n_u('denegaciones_persona', 'den4') = 0, '4 negadas (bajo el umbral) no alertan');
  PERFORM pg_temp.r(pg_temp.n_u('denegaciones_persona', 'denlento') = 0, '5 negadas repartidas en 25 minutos no alertan');
  PERFORM pg_temp.r(pg_temp.n_u('denegaciones_persona', 'denperm') = 0, 'las decisiones permitidas no cuentan (8 permitidas y 3 negadas)');
  PERFORM pg_temp.r(current_setting('p019.corrida1', true) IS NOT NULL
                    AND NOT EXISTS (SELECT 1 FROM siget.alerta_seguridad WHERE usuario_id = pg_temp.id('huerfano')),
                    '5 negadas de un actor_id que no existe en usuario no rompen la corrida ni crean alerta');

  -- Reuso de token
  v_ok := (SELECT count(*) FROM siget.alerta_seguridad WHERE regla = 'reuso_token_refresco' AND usuario_id = pg_temp.id('reuso')
              AND severidad = 'alta' AND estado = 'abierta' AND conteo = 1) = 1;
  PERFORM pg_temp.r(v_ok, 'un solo refresh_reuso crea una alerta alta para esa persona');
  PERFORM pg_temp.r(pg_temp.n_u('reuso_token_refresco', 'reusoviejo') = 0, 'un refresh_reuso de hace mas de 24 horas no alerta');

  -- Bloqueos repetidos
  v_ok := (SELECT count(*) FROM siget.alerta_seguridad WHERE regla = 'bloqueos_repetidos' AND usuario_id = pg_temp.id('bloq2')
              AND severidad = 'alta' AND estado = 'abierta' AND conteo = 2) = 1;
  PERFORM pg_temp.r(v_ok, '2 cuenta_bloqueada de una cuenta en 24 horas crean una alerta alta');
  PERFORM pg_temp.r(pg_temp.n_u('bloqueos_repetidos', 'bloq1') = 0, 'un solo bloqueo no alerta');
  PERFORM pg_temp.r(pg_temp.n_u('bloqueos_repetidos', 'bloqviejo') = 0, '2 bloqueos con uno de hace mas de 24 horas no alertan');

  -- Lo que se guarda en el detalle
  v_ok := (SELECT count(*) FROM _alertas_p019) >= 4
          AND NOT EXISTS (SELECT 1 FROM _alertas_p019 a
                           WHERE a.detalle::text LIKE '%valor-sensible%'
                              OR EXISTS (SELECT 1 FROM jsonb_object_keys(a.detalle) k WHERE k NOT IN ('ventana_minutos', 'umbral', 'por_nombre'))
                              OR EXISTS (SELECT 1 FROM jsonb_each(a.detalle -> 'por_nombre') e WHERE jsonb_typeof(e.value) <> 'number'));
  PERFORM pg_temp.r(v_ok, 'el detalle solo lleva ventana, umbral y contadores por nombre: nada del detalle original de los eventos');

  -- La funcion devolvio, al menos, las alertas de la prueba
  SELECT count(*) INTO v_total FROM _alertas_p019;
  PERFORM pg_temp.r(current_setting('p019.corrida1')::int >= v_total AND v_total = 6,
                    'la primera corrida crea las 6 alertas esperadas (3 por IP, 1 por denegaciones, 1 por reuso y 1 por bloqueos) y devuelve al menos 6');
END $$;

-- ---------------------------------------------------------------------------
-- Idempotencia: otra corrida sin eventos nuevos no cambia nada de lo de la prueba
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE _s1 ON COMMIT DROP AS SELECT id, conteo, ultima_vez, detalle, estado FROM _alertas_p019;
SET LOCAL ROLE detector_role;
SELECT set_config('p019.corrida2', siget.detectar_anomalias()::text, true) AS corrida_2;
RESET ROLE;

DO $$
DECLARE
  v_ok boolean;
BEGIN
  v_ok := (SELECT count(*) FROM _alertas_p019) = (SELECT count(*) FROM _s1)
          AND NOT EXISTS (SELECT 1 FROM _alertas_p019 a JOIN _s1 s USING (id)
                           WHERE a.conteo <> s.conteo OR a.ultima_vez <> s.ultima_vez OR a.detalle <> s.detalle OR a.estado <> s.estado);
  PERFORM pg_temp.r(v_ok, 'idempotente: correrla otra vez sin eventos nuevos no crea ni cambia ninguna alerta de la prueba');
END $$;

-- ---------------------------------------------------------------------------
-- Dedupe: eventos nuevos actualizan la alerta abierta, no crean otra
-- ---------------------------------------------------------------------------
INSERT INTO siget.evento_seguridad (actor_id, evento, ip, creado_en)
SELECT NULL, 'login_fallido', '192.0.2.16', now() - interval '3 minutes' + g * interval '20 seconds' FROM generate_series(1, 3) g;
INSERT INTO siget.evento_seguridad (actor_id, evento, ip, creado_en) VALUES (pg_temp.id('reuso'), 'refresh_reuso', '192.0.2.20', now() - interval '1 minute');
SET LOCAL ROLE detector_role;
SELECT set_config('p019.corrida3', siget.detectar_anomalias()::text, true) AS corrida_3;
RESET ROLE;

DO $$
DECLARE
  v_ok boolean;
BEGIN
  v_ok := pg_temp.n_ip('192.0.2.16', 'abierta') = 1 AND pg_temp.n_ip('192.0.2.16') = 1
          AND (SELECT conteo FROM siget.alerta_seguridad WHERE ip = '192.0.2.16'::inet) = 13
          AND (SELECT ultima_vez FROM siget.alerta_seguridad WHERE ip = '192.0.2.16'::inet) > (SELECT ultima_vez FROM _s1 WHERE id = (SELECT id FROM siget.alerta_seguridad WHERE ip = '192.0.2.16'::inet));
  PERFORM pg_temp.r(v_ok, 'dedupe por IP: tres eventos mas actualizan la misma alerta abierta (conteo 13, ultima_vez mas reciente), no crean otra');
  v_ok := pg_temp.n_u('reuso_token_refresco', 'reuso') = 1
          AND (SELECT conteo FROM siget.alerta_seguridad WHERE regla = 'reuso_token_refresco' AND usuario_id = pg_temp.id('reuso')) = 2;
  PERFORM pg_temp.r(v_ok, 'dedupe por persona: un segundo refresh_reuso sube el conteo a 2 de la alerta abierta, no crea otra');
  PERFORM pg_temp.r(current_setting('p019.corrida3')::int >= 2, 'la corrida que actualiza devuelve al menos las dos alertas actualizadas');
  -- La base tambien impide dos abiertas para la misma clave
  PERFORM pg_temp.r(pg_temp.intenta(format('INSERT INTO siget.alerta_seguridad (regla, severidad, ip, conteo, primera_vez, ultima_vez)
                                            VALUES (''rafaga_login_fallido_ip'', ''media'', ''192.0.2.16'', 10, now(), now())')) = '23505',
                    'la base impide dos alertas abiertas para la misma regla, persona e IP (indice unico parcial)');
  PERFORM pg_temp.r(pg_temp.intenta(format('INSERT INTO siget.alerta_seguridad (regla, severidad, usuario_id, conteo, primera_vez, ultima_vez)
                                            VALUES (''reuso_token_refresco'', ''alta'', %s, 1, now(), now())', pg_temp.id('reuso'))) = '23505',
                    'lo mismo cuando la clave lleva persona y no IP');
  PERFORM pg_temp.r(pg_temp.intenta('INSERT INTO siget.alerta_seguridad (regla, severidad, conteo, primera_vez, ultima_vez)
                                     VALUES (''regla_inventada'', ''media'', 1, now(), now())') = '23514',
                    'la regla es de una lista cerrada (CHECK)');
END $$;

-- ---------------------------------------------------------------------------
-- Revision: app_role, la seguridad por filas y el disparador
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_alerta bigint := (SELECT id FROM siget.alerta_seguridad WHERE regla = 'rafaga_login_fallido_ip' AND ip = '192.0.2.10'::inet);
  v_oper bigint := pg_temp.id('oper');
  v_oper2 bigint := pg_temp.id('oper2');
  v_ciud bigint := pg_temp.id('ciudadana');
  v_r jsonb := '{}'::jsonb;
  v_n int;
  v_estado text;
  v_revisada_en timestamptz;
  v_base text;
BEGIN
  EXECUTE 'SET LOCAL ROLE app_role';

  -- Sin contexto de sesion, y con el de una persona que no es operador: la base no muestra ni deja tocar nada
  v_r := v_r || jsonb_build_object('sin_ctx_ve', (SELECT count(*) FROM siget.alerta_seguridad));
  PERFORM set_config('app.usuario_id', v_ciud::text, true);
  v_r := v_r || jsonb_build_object('ciud_ve', (SELECT count(*) FROM siget.alerta_seguridad));
  v_base := format('UPDATE siget.alerta_seguridad SET estado = ''revisada'', revisada_por = %s, nota = ''Intento de una persona que no es operador'' WHERE id = %s', v_ciud, v_alerta);
  v_r := v_r || jsonb_build_object('ciud_revisa', pg_temp.filas(v_base));

  -- El operador de seguridad ve las alertas
  PERFORM set_config('app.usuario_id', v_oper::text, true);
  v_r := v_r || jsonb_build_object('oper_ve', (SELECT count(*) FROM siget.alerta_seguridad));

  -- Lo que app_role no puede hacer
  v_r := v_r || jsonb_build_object(
    'insert', pg_temp.intenta('INSERT INTO siget.alerta_seguridad (regla, severidad, ip, conteo, primera_vez, ultima_vez) VALUES (''bloqueos_repetidos'', ''alta'', ''192.0.2.99'', 2, now(), now())'),
    'delete', pg_temp.intenta(format('DELETE FROM siget.alerta_seguridad WHERE id = %s', v_alerta)),
    'conteo', pg_temp.intenta(format('UPDATE siget.alerta_seguridad SET conteo = 1 WHERE id = %s', v_alerta)),
    'detalle', pg_temp.intenta(format('UPDATE siget.alerta_seguridad SET detalle = ''{}'' WHERE id = %s', v_alerta)),
    'regla', pg_temp.intenta(format('UPDATE siget.alerta_seguridad SET regla = ''bloqueos_repetidos'' WHERE id = %s', v_alerta)),
    'detectar', pg_temp.intenta('SELECT siget.detectar_anomalias()'),
    'truncate', pg_temp.intenta('TRUNCATE siget.alerta_seguridad'));

  -- El disparador: sin nota, con nota vacia, por quien no es operador, a nombre de otra persona, sin cambiar el estado
  v_r := v_r || jsonb_build_object(
    'sin_nota', pg_temp.intenta(format('UPDATE siget.alerta_seguridad SET estado = ''revisada'', revisada_por = %s WHERE id = %s', v_oper, v_alerta)),
    'nota_vacia', pg_temp.intenta(format('UPDATE siget.alerta_seguridad SET estado = ''revisada'', revisada_por = %s, nota = ''   '' WHERE id = %s', v_oper, v_alerta)),
    'nota_larga', pg_temp.intenta(format('UPDATE siget.alerta_seguridad SET estado = ''revisada'', revisada_por = %s, nota = repeat(''x'', 1001) WHERE id = %s', v_oper, v_alerta)),
    'sin_revisor', pg_temp.intenta(format('UPDATE siget.alerta_seguridad SET estado = ''revisada'', nota = ''Sin indicar quien revisa'' WHERE id = %s', v_alerta)),
    'no_operador', pg_temp.intenta(format('UPDATE siget.alerta_seguridad SET estado = ''revisada'', revisada_por = %s, nota = ''La revisa una persona que no es operador'' WHERE id = %s', v_ciud, v_alerta)),
    'a_nombre_de_otro', pg_temp.intenta(format('UPDATE siget.alerta_seguridad SET estado = ''revisada'', revisada_por = %s, nota = ''Otro operador figura como revisor'' WHERE id = %s', v_oper2, v_alerta)),
    'estado_invalido', pg_temp.intenta(format('UPDATE siget.alerta_seguridad SET estado = ''cerrada'', revisada_por = %s, nota = ''Estado que no existe'' WHERE id = %s', v_oper, v_alerta)),
    'abierta_con_nota', pg_temp.intenta(format('UPDATE siget.alerta_seguridad SET nota = ''Nota sin cerrar la alerta'', revisada_por = %s WHERE id = %s', v_oper, v_alerta)));

  -- La revision correcta: la hora la fija la base (aunque la aplicacion mande otra)
  EXECUTE format('UPDATE siget.alerta_seguridad SET estado = ''revisada'', revisada_por = %s, revisada_en = now() - interval ''5 days'', nota = ''Era una prueba de carga interna'' WHERE id = %s', v_oper, v_alerta);
  SELECT estado, revisada_en INTO v_estado, v_revisada_en FROM siget.alerta_seguridad WHERE id = v_alerta;
  v_r := v_r || jsonb_build_object('revisada', v_estado, 'hora_de_la_base', v_revisada_en = now());

  -- Una sola vez: no se cambia el resultado ni se reabre
  v_r := v_r || jsonb_build_object(
    'otra_vez', pg_temp.intenta(format('UPDATE siget.alerta_seguridad SET estado = ''descartada'', revisada_por = %s, nota = ''Segunda revision'' WHERE id = %s', v_oper, v_alerta)),
    'reabrir', pg_temp.intenta(format('UPDATE siget.alerta_seguridad SET estado = ''abierta'', revisada_por = NULL, revisada_en = NULL, nota = NULL WHERE id = %s', v_alerta)),
    'cambiar_nota', pg_temp.intenta(format('UPDATE siget.alerta_seguridad SET nota = ''Nota cambiada despues'' WHERE id = %s', v_alerta)));

  RESET ROLE;
  PERFORM set_config('app.usuario_id', '', true);

  PERFORM pg_temp.r((v_r ->> 'sin_ctx_ve')::int = 0, 'app_role sin contexto de sesion no ve ninguna alerta (seguridad por filas)');
  PERFORM pg_temp.r((v_r ->> 'ciud_ve')::int = 0 AND (v_r ->> 'ciud_revisa')::int = 0,
                    'con el contexto de una persona que no es operador de seguridad no ve alertas ni puede revisar ninguna');
  PERFORM pg_temp.r((v_r ->> 'oper_ve')::int >= 6, 'con el contexto de un operador de seguridad activo ve las alertas');
  PERFORM pg_temp.r(v_r ->> 'insert' = '42501', 'app_role no puede insertar alertas (solo las inserta la funcion)');
  PERFORM pg_temp.r(v_r ->> 'delete' = '42501', 'app_role no puede borrar alertas');
  PERFORM pg_temp.r(v_r ->> 'truncate' = '42501', 'app_role no puede vaciar la tabla');
  PERFORM pg_temp.r(v_r ->> 'conteo' = '42501' AND v_r ->> 'detalle' = '42501' AND v_r ->> 'regla' = '42501',
                    'app_role solo puede actualizar estado, revisada_por, revisada_en y nota (no conteo, detalle ni regla)');
  PERFORM pg_temp.r(v_r ->> 'detectar' = '42501', 'app_role no puede ejecutar siget.detectar_anomalias()');
  PERFORM pg_temp.r(v_r ->> 'sin_nota' = 'P0001' AND v_r ->> 'nota_vacia' = 'P0001', 'revisar exige una nota (ausente o vacia)');
  PERFORM pg_temp.r(v_r ->> 'nota_larga' = '23514', 'la nota tiene un maximo de 1000 caracteres');
  PERFORM pg_temp.r(v_r ->> 'sin_revisor' = 'P0001' AND v_r ->> 'no_operador' = 'P0001',
                    'revisar exige un revisor con rol de operador de seguridad (ni vacio ni una persona sin ese rol)');
  PERFORM pg_temp.r(v_r ->> 'a_nombre_de_otro' = 'P0001', 'la revision se registra a nombre de quien tiene la sesion, no de otro operador');
  PERFORM pg_temp.r(v_r ->> 'estado_invalido' = '23514', 'el estado es de una lista cerrada (CHECK)');
  PERFORM pg_temp.r(v_r ->> 'abierta_con_nota' = 'P0001', 'una alerta abierta no recibe datos de revision');
  PERFORM pg_temp.r(v_r ->> 'revisada' = 'revisada', 'el operador revisa una alerta abierta con su nota');
  PERFORM pg_temp.r((v_r ->> 'hora_de_la_base')::boolean, 'la hora de la revision la fija la base (now()), no la aplicacion');
  PERFORM pg_temp.r(v_r ->> 'otra_vez' = 'P0001' AND v_r ->> 'reabrir' = 'P0001' AND v_r ->> 'cambiar_nota' = 'P0001',
                    'una alerta revisada no se revisa otra vez, ni se reabre ni cambia su nota');
END $$;

-- La base tambien protege contra el dueño y el superusuario: una alerta no se borra
DO $$
BEGIN
  PERFORM pg_temp.r(pg_temp.intenta('DELETE FROM siget.alerta_seguridad WHERE ip = ''192.0.2.16''::inet') = 'P0001',
                    'ni el dueño borra una alerta (disparador de solo insercion)');
  PERFORM pg_temp.r(pg_temp.intenta('TRUNCATE siget.alerta_seguridad') = 'P0001', 'ni el dueño vacia la tabla');
END $$;

-- ---------------------------------------------------------------------------
-- Una alerta revisada no se repite con los mismos eventos; con eventos nuevos, si
-- ---------------------------------------------------------------------------
SET LOCAL ROLE detector_role;
SELECT set_config('p019.corrida4', siget.detectar_anomalias()::text, true) AS corrida_4;
RESET ROLE;

DO $$
DECLARE
  v_ok boolean;
BEGIN
  v_ok := pg_temp.n_ip('192.0.2.10') = 1 AND pg_temp.n_ip('192.0.2.10', 'abierta') = 0;
  PERFORM pg_temp.r(v_ok, 'una alerta revisada no se vuelve a crear con los MISMOS eventos (siguen dentro de la ventana, pero ya se revisaron)');
END $$;

INSERT INTO siget.evento_seguridad (actor_id, evento, ip, creado_en)
SELECT NULL, 'login_fallido', '192.0.2.10', now() - interval '90 seconds' + g * interval '3 seconds' FROM generate_series(1, 10) g;
SET LOCAL ROLE detector_role;
SELECT set_config('p019.corrida5', siget.detectar_anomalias()::text, true) AS corrida_5;
RESET ROLE;

DO $$
DECLARE
  v_ok boolean;
BEGIN
  -- Solo cuentan los eventos posteriores a la revision: 10, no los 20 que hay en la ventana
  v_ok := pg_temp.n_ip('192.0.2.10') = 2 AND pg_temp.n_ip('192.0.2.10', 'abierta') = 1 AND pg_temp.n_ip('192.0.2.10', 'revisada') = 1
          AND (SELECT conteo FROM siget.alerta_seguridad WHERE ip = '192.0.2.10'::inet AND estado = 'abierta') = 10;
  PERFORM pg_temp.r(v_ok, 'con 10 eventos NUEVOS tras la revision se abre otra alerta (conteo 10, sin sumar los ya revisados) y la revisada queda como estaba');
END $$;

-- ---------------------------------------------------------------------------
-- Permisos de los demas roles y atributos del detector
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_rol text;
  v_codigo text;
  v_n int;
  v_ok boolean;
BEGIN
  -- Auditor: solo lectura
  EXECUTE 'SET LOCAL ROLE auditor_role';
  SELECT count(*) INTO v_n FROM siget.alerta_seguridad;
  v_codigo := pg_temp.intenta('UPDATE siget.alerta_seguridad SET nota = ''El auditor no escribe'' WHERE ip = ''192.0.2.16''::inet');
  RESET ROLE;
  PERFORM pg_temp.r(v_n >= 6 AND v_codigo = '42501', 'auditor_role lee las alertas (como el resto de la auditoria) y no puede modificarlas');

  -- Sin ningun permiso sobre la tabla
  FOREACH v_rol IN ARRAY ARRAY['pgadmin_lectura', 'escalador_role', 'checkpoint_app', 'detector_role'] LOOP
    EXECUTE format('SET LOCAL ROLE %I', v_rol);
    v_codigo := pg_temp.intenta('SELECT count(*) FROM siget.alerta_seguridad');
    RESET ROLE;
    PERFORM pg_temp.r(v_codigo = '42501', format('%s no puede leer la tabla de alertas', v_rol));
  END LOOP;

  -- detector_role: solo EXECUTE sobre la funcion
  EXECUTE 'SET LOCAL ROLE detector_role';
  v_codigo := pg_temp.intenta('SELECT count(*) FROM siget.evento_seguridad');
  v_rol := pg_temp.intenta('SELECT count(*) FROM siget.decision_pdp');
  RESET ROLE;
  PERFORM pg_temp.r(v_codigo = '42501' AND v_rol = '42501', 'detector_role no lee los eventos de seguridad ni las decisiones: solo ejecuta la funcion');
  v_ok := (SELECT rolcanlogin AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolbypassrls AND NOT rolreplication
             FROM pg_roles WHERE rolname = 'detector_role');
  PERFORM pg_temp.r(v_ok, 'detector_role: LOGIN, sin superusuario, sin crear bases ni roles, sin saltar la seguridad por filas');
  v_ok := has_function_privilege('detector_role', 'siget.detectar_anomalias()', 'EXECUTE')
          AND NOT has_function_privilege('app_role', 'siget.detectar_anomalias()', 'EXECUTE')
          AND NOT has_function_privilege('auditor_role', 'siget.detectar_anomalias()', 'EXECUTE')
          AND NOT has_function_privilege('escalador_role', 'siget.detectar_anomalias()', 'EXECUTE')
          AND NOT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a WHERE p.oid = 'siget.detectar_anomalias()'::regprocedure AND a.grantee = 0);
  PERFORM pg_temp.r(v_ok, 'solo detector_role (y el dueño) puede ejecutar siget.detectar_anomalias(): ni PUBLIC ni los demas roles');
  v_ok := (SELECT prosecdef AND pg_get_userbyid(proowner) = 'siget_owner' AND proconfig = ARRAY['search_path=siget, pg_temp']
             FROM pg_proc WHERE oid = 'siget.detectar_anomalias()'::regprocedure);
  PERFORM pg_temp.r(v_ok, 'siget.detectar_anomalias() es SECURITY DEFINER, del dueño y con la ruta de busqueda fija');
  v_ok := NOT has_table_privilege('detector_role', 'siget.alerta_seguridad', 'SELECT,INSERT,UPDATE,DELETE')
          AND NOT has_table_privilege('app_role', 'siget.alerta_seguridad', 'INSERT')
          AND NOT has_table_privilege('app_role', 'siget.alerta_seguridad', 'DELETE')
          AND NOT has_sequence_privilege('app_role', 'siget.alerta_seguridad_id_seq', 'USAGE');
  PERFORM pg_temp.r(v_ok, 'por el catalogo: app_role sin INSERT, DELETE ni la secuencia; detector_role sin ningun permiso de tabla');
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
