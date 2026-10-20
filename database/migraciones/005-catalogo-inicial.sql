-- ============================================================================
-- Migracion 005: catalogo inicial de instituciones y tipos de tramite
-- ============================================================================
-- Seis instituciones (tres reales y tres de demostracion) y sus tramites, con los plazos (SLA) del
-- diseno. Los plazos son parametros de diseno, NO plazos legales. Es solo datos: el motor es generico,
-- agregar una institucion o un tramite es insertar filas, no escribir codigo.
-- Se ejecuta como siget_owner. Es idempotente (se puede repetir sin duplicar).
-- ============================================================================

SET LOCAL ROLE siget_owner;

INSERT INTO siget.institucion (nombre, tipo) VALUES
  ('Alcaldía (Municipio de Panamá)', 'real'),
  ('Ministerio Público / 311',       'real'),
  ('AMPYME',                         'real'),
  ('MINSA',                          'demostracion'),
  ('MOP',                            'demostracion'),
  ('MiAmbiente',                     'demostracion')
ON CONFLICT (nombre) DO NOTHING;

INSERT INTO siget.tipo_tramite (institucion_id, nombre, sla_dias)
SELECT i.id, t.nombre, t.sla_dias
FROM (VALUES
  ('Alcaldía (Municipio de Panamá)', 'Permiso de Construcción Municipal',   15),
  ('Ministerio Público / 311',       'Solicitud o denuncia ciudadana',       5),
  ('AMPYME',                         'Registro empresarial simplificado',   10),
  ('MINSA',                          'Trámite de demostración (MINSA)',     10),
  ('MOP',                            'Trámite de demostración (MOP)',       10),
  ('MiAmbiente',                     'Trámite de demostración (MiAmbiente)', 10)
) AS t(institucion, nombre, sla_dias)
JOIN siget.institucion i ON i.nombre = t.institucion
ON CONFLICT (institucion_id, nombre) DO NOTHING;

RESET ROLE;
