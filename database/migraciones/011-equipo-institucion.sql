-- ============================================================================
-- Migracion 011: gestion del equipo de una institucion desde la web
-- ============================================================================
-- Se ejecuta como siget_owner (duenio de los objetos), no como superusuario.
--
-- * membresia ya no se borra nunca (la aplicacion no tiene DELETE): quitar a alguien es REVOCAR su membresia
--   (revocada_en y revocada_por). Asi queda quien dio el acceso, quien lo quito y cuando. Reasignar a la misma persona en el
--   mismo rol reactiva la fila (la clave primaria es usuario + institucion + rol).
-- * Nadie revoca su propio acceso ni lo da: la misma regla que ya impone `membresia_no_autoasignada`.
-- * siget.tramites_abiertos_de(): devuelve SOLO un conteo. La coordinacion necesita saber si alguien tiene tramites abiertos
--   asignados antes de quitarle el acceso, pero por la seguridad por filas (RLS) no ve los tramites: esta funcion
--   (SECURITY DEFINER, ruta de busqueda fija) responde el numero y nada mas.
-- ============================================================================
BEGIN;
SET LOCAL ROLE siget_owner;

ALTER TABLE siget.membresia
  ADD COLUMN revocada_en  timestamptz,
  ADD COLUMN revocada_por int REFERENCES siget.usuario(id),
  ADD CONSTRAINT membresia_revocacion_coherente CHECK ((revocada_en IS NULL) = (revocada_por IS NULL)),
  ADD CONSTRAINT membresia_no_autorevocada CHECK (revocada_por IS NULL OR revocada_por <> usuario_id);

GRANT UPDATE (revocada_en, revocada_por, asignado_por) ON siget.membresia TO app_role;

CREATE FUNCTION siget.tramites_abiertos_de(p_usuario int, p_institucion int) RETURNS int
  LANGUAGE sql SECURITY DEFINER STABLE SET search_path = siget, pg_temp AS $$
  SELECT count(*)::int FROM siget.tramite
   WHERE funcionario_asignado_id = p_usuario AND institucion_id = p_institucion AND estado NOT IN ('Aprobado', 'Rechazado');
$$;
REVOKE ALL ON FUNCTION siget.tramites_abiertos_de(int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION siget.tramites_abiertos_de(int, int) TO app_role;

COMMIT;
