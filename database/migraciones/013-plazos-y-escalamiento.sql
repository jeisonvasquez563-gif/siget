-- ============================================================================
-- Migracion 013: plazos en dias habiles y escalamiento automatico de tramites vencidos (PT-3)
-- ============================================================================
-- Se ejecuta como siget_owner (duenio de los objetos), no como superusuario.
--
-- * siget.feriado: dias feriados nacionales de Panama. No cuentan para los plazos en dias habiles. La lista inicial se
--   carga aqui (verificada con fuentes oficiales, ver docs/feriados-panama.md); app_role solo la LEE.
-- * tramite.escalado_en: cuando el tramite supero su fecha limite sin resolverse. app_role NO puede escribir esta columna
--   (su UPDATE sigue limitado a estado y funcionario_asignado_id): solo la marca siget.escalar_vencidos().
-- * siget.escalar_vencidos(): en UNA transaccion marca los tramites abiertos con la fecha limite vencida y escribe un
--   evento 'escalamiento' por cada uno (actor nulo: lo hace el sistema). Idempotente: no re-escala.
-- * escalador_role: LOGIN, sin superusuario, sin BYPASSRLS, sin acceso a ninguna tabla; solo EXECUTE sobre esa funcion.
--   Su contrasena NO va aqui: se fija aparte (ALTER ROLE ... PASSWORD) y vive como podman secret en VM1.
--
-- Los tramites existentes conservan su fecha limite (calculada en dias calendario): solo los nuevos usan dias habiles.
-- ============================================================================
BEGIN;
SET LOCAL ROLE siget_owner;

CREATE TABLE siget.feriado (
  fecha        date PRIMARY KEY,
  descripcion  text NOT NULL CHECK (length(descripcion) BETWEEN 3 AND 120)
);
GRANT SELECT ON siget.feriado TO app_role, auditor_role;

-- Feriados de ley 2026 y 2027 (Codigo de Trabajo arts. 46 y 47, texto de la Ley 28 de 2015 y la Ley 291 de 2022).
-- Incluye los que caen en sabado (no cambian el calculo) y el lunes habilitado cuando caen en domingo.
-- NO incluye cierres de oficinas por decreto (p. ej. 4 de noviembre, lunes de Carnaval): ver docs/feriados-panama.md.
INSERT INTO siget.feriado (fecha, descripcion) VALUES
  ('2026-01-01', 'Año Nuevo'),
  ('2026-01-09', 'Día de los Mártires (duelo nacional)'),
  ('2026-02-17', 'Martes de Carnaval'),
  ('2026-04-03', 'Viernes Santo (duelo nacional)'),
  ('2026-05-01', 'Día del Trabajador'),
  ('2026-11-03', 'Separación de Panamá de Colombia'),
  ('2026-11-05', 'Consolidación de la Separación (Colón)'),
  ('2026-11-10', 'Primer Grito de Independencia (Villa de Los Santos)'),
  ('2026-11-28', 'Independencia de Panamá de España'),
  ('2026-12-08', 'Día de las Madres'),
  ('2026-12-20', 'Duelo Nacional por el 20 de diciembre de 1989'),
  ('2026-12-21', 'Descanso por el 20 de diciembre (cae domingo, art. 47)'),
  ('2026-12-25', 'Navidad'),
  ('2027-01-01', 'Año Nuevo'),
  ('2027-01-09', 'Día de los Mártires (duelo nacional)'),
  ('2027-02-09', 'Martes de Carnaval'),
  ('2027-03-26', 'Viernes Santo (duelo nacional)'),
  ('2027-05-01', 'Día del Trabajador'),
  ('2027-11-03', 'Separación de Panamá de Colombia'),
  ('2027-11-05', 'Consolidación de la Separación (Colón)'),
  ('2027-11-10', 'Primer Grito de Independencia (Villa de Los Santos)'),
  ('2027-11-28', 'Independencia de Panamá de España'),
  ('2027-11-29', 'Descanso por el 28 de noviembre (cae domingo, art. 47)'),
  ('2027-12-08', 'Día de las Madres'),
  ('2027-12-20', 'Duelo Nacional por el 20 de diciembre de 1989'),
  ('2027-12-25', 'Navidad');

ALTER TABLE siget.tramite ADD COLUMN escalado_en timestamptz;
CREATE INDEX tramite_vencidos_sin_escalar ON siget.tramite (fecha_limite)
  WHERE escalado_en IS NULL AND estado NOT IN ('Aprobado', 'Rechazado');

CREATE FUNCTION siget.escalar_vencidos() RETURNS int LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = siget, pg_temp AS $$
DECLARE
  v_total int;
BEGIN
  WITH escalados AS (
    UPDATE siget.tramite t
       SET escalado_en = now()
     WHERE t.escalado_en IS NULL
       AND t.fecha_limite IS NOT NULL
       AND t.fecha_limite < now()
       AND t.estado NOT IN ('Aprobado', 'Rechazado')
    RETURNING t.id, t.institucion_id, t.estado, t.fecha_limite
  ), eventos AS (
    INSERT INTO siget.evento_auditoria (tramite_id, institucion_id, actor_id, accion, estado_anterior, estado_nuevo, atributos)
    SELECT id, institucion_id, NULL, 'escalamiento', estado, estado,
           jsonb_build_object('regla', 'plazo_vencido', 'fecha_limite', fecha_limite)
      FROM escalados
    RETURNING 1
  )
  SELECT count(*) INTO v_total FROM eventos;
  RETURN v_total;
END $$;
REVOKE ALL ON FUNCTION siget.escalar_vencidos() FROM PUBLIC;

COMMIT;

-- El rol se crea fuera del SET LOCAL ROLE: crear roles requiere CREATEROLE (lo hace el superusuario del contenedor).
BEGIN;
CREATE ROLE escalador_role LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 2;
GRANT CONNECT ON DATABASE tramites_demo TO escalador_role;
GRANT USAGE ON SCHEMA siget TO escalador_role;
GRANT EXECUTE ON FUNCTION siget.escalar_vencidos() TO escalador_role;
COMMIT;
