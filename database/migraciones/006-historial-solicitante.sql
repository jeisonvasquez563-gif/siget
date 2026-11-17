-- ============================================================================
-- Migracion 006: el solicitante puede ver el historial de SU tramite
-- ============================================================================
-- Hasta ahora la politica RLS de evento_auditoria solo dejaba ver los eventos a quienes tienen
-- membresia en la institucion del tramite. La persona que pidio el tramite quedaba sin poder ver su
-- propia trazabilidad, que es el derecho que SIGET existe para garantizar (conocer el estado de un
-- tramite: actuaciones, fase, unidad responsable y fecha; Ley 83 de 2012, Art. 4 num. 8).
--
-- Solo agrega lectura: el solicitante sigue sin poder escribir ni modificar nada. Las politicas de
-- distintos origenes se suman (OR): se mantiene la del personal de la institucion.
-- Se ejecuta como siget_owner.
-- ============================================================================

SET LOCAL ROLE siget_owner;

CREATE POLICY evento_ver_solicitante ON siget.evento_auditoria FOR SELECT TO app_role
  USING (EXISTS (
    SELECT 1 FROM siget.tramite t
    WHERE t.id = evento_auditoria.tramite_id AND t.solicitante_id = siget.ctx_usuario()
  ));

RESET ROLE;
