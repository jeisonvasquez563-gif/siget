-- ============================================================================
-- Migracion 018: notificaciones dentro de la plataforma (PT-9)
-- ============================================================================
-- Se ejecuta como siget_owner (duenio de los objetos), no como superusuario.
--
-- * siget.notificacion: un aviso para UNA persona sobre UN tramite. No lleva texto libre ni datos personales: solo el tipo (lista
--   cerrada), el tramite y las fechas. El texto lo arma la interfaz; el motivo y los datos se leen en el detalle del tramite, que ya
--   tiene sus propios controles (PDP y seguridad por filas). Asi una notificacion no puede filtrar nada que el tramite no filtre.
-- * LA GENERA LA BASE, no la aplicacion: un disparador AFTER UPDATE sobre tramite (siget.generar_notificaciones, SECURITY DEFINER con
--   ruta de busqueda fija; corre como siget_owner, duenio de la tabla, por eso escribe aunque app_role no pueda) inserta en la misma
--   transaccion del cambio. Si el cambio se revierte, la notificacion tambien. Cubre cualquier camino que cambie el tramite: la API, el
--   escalador o un UPDATE directo.
--     - A quien lo solicito: Pendiente -> En Tramitacion (tramite_en_atencion), -> En Subsanacion (subsanacion_pedida), -> Aprobado y
--       -> Rechazado.
--     - A quien lo atiende (funcionario asignado, si hay): En Subsanacion -> En Tramitacion cuando QUIEN ACTUALIZA ES EL SOLICITANTE
--       (subsanacion_respondida). Si cierra la subsanacion el personal, no se avisa al asignado.
--     - A la supervision de la institucion del tramite (membresia de supervisor NO revocada): cuando escalado_en pasa de NULL a un
--       valor (tramite_escalado). Eso lo hace siget.escalar_vencidos() (013), que corre como escalador_role SIN contexto de usuario
--       (ctx_usuario() es NULL): el disparador no lee nada del contexto salvo para no avisar al propio actor.
--     - Nunca se notifica al propio actor: si quien cambia (ctx_usuario()) es el destinatario, no se crea.
-- * Seguridad por filas: app_role ve y marca SOLO las filas con usuario_id = ctx_usuario(). Permisos: SELECT y UPDATE (leida_en);
--   NINGUN INSERT ni DELETE (solo el disparador inserta). Un disparador impide desmarcar: leida_en solo pasa de NULL a un valor (que
--   fija la base con now(), no la aplicacion) y no vuelve a cambiar; ninguna otra columna cambia.
-- * Nada para auditor_role, pgadmin_lectura, checkpoint_app ni escalador_role (el disparador es SECURITY DEFINER: escalador_role no
--   necesita ningun permiso sobre la tabla para que escalar_vencidos() notifique).
-- * Compatibilidad: el backend anterior no lee esta tabla ni la necesita; el disparador solo agrega filas. Se puede migrar la base
--   antes de desplegar el codigo nuevo.
-- ============================================================================
BEGIN;
SET LOCAL ROLE siget_owner;

-- ---------------------------------------------------------------------------
-- 1. La tabla
-- ---------------------------------------------------------------------------
CREATE TABLE siget.notificacion (
  id          bigserial PRIMARY KEY,
  usuario_id  int NOT NULL REFERENCES siget.usuario(id),
  tipo        text NOT NULL CHECK (tipo IN ('tramite_en_atencion', 'subsanacion_pedida', 'tramite_aprobado', 'tramite_rechazado',
                                            'subsanacion_respondida', 'tramite_escalado')),
  tramite_id  bigint NOT NULL REFERENCES siget.tramite(id),
  creada_en   timestamptz NOT NULL DEFAULT now(),
  leida_en    timestamptz
);
CREATE INDEX notificacion_usuario_idx ON siget.notificacion (usuario_id, leida_en, creada_en);

-- ---------------------------------------------------------------------------
-- 2. Generacion: disparador sobre tramite
-- ---------------------------------------------------------------------------
CREATE FUNCTION siget.generar_notificaciones() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = siget, pg_temp AS $$
DECLARE
  v_actor int := siget.ctx_usuario();  -- NULL cuando lo hace el sistema (escalador_role)
  v_tipo  text;
BEGIN
  IF NEW.estado IS DISTINCT FROM OLD.estado THEN
    v_tipo := CASE
      WHEN OLD.estado = 'Pendiente' AND NEW.estado = 'En Tramitacion' THEN 'tramite_en_atencion'
      WHEN NEW.estado = 'En Subsanacion' THEN 'subsanacion_pedida'
      WHEN NEW.estado = 'Aprobado' THEN 'tramite_aprobado'
      WHEN NEW.estado = 'Rechazado' THEN 'tramite_rechazado'
    END;
    -- A quien solicito el tramite, salvo que sea quien lo cambia
    IF v_tipo IS NOT NULL AND NEW.solicitante_id IS DISTINCT FROM v_actor THEN
      INSERT INTO siget.notificacion (usuario_id, tipo, tramite_id) VALUES (NEW.solicitante_id, v_tipo, NEW.id);
    END IF;
    -- A quien lo atiende, cuando la persona solicitante responde la subsanacion (si cierra el personal, no)
    IF OLD.estado = 'En Subsanacion' AND NEW.estado = 'En Tramitacion'
       AND NEW.funcionario_asignado_id IS NOT NULL
       AND v_actor IS NOT NULL AND v_actor = NEW.solicitante_id
       AND NEW.funcionario_asignado_id <> v_actor THEN
      INSERT INTO siget.notificacion (usuario_id, tipo, tramite_id)
      VALUES (NEW.funcionario_asignado_id, 'subsanacion_respondida', NEW.id);
    END IF;
  END IF;

  -- A la supervision vigente de la institucion cuando el tramite se escala
  IF OLD.escalado_en IS NULL AND NEW.escalado_en IS NOT NULL THEN
    INSERT INTO siget.notificacion (usuario_id, tipo, tramite_id)
    SELECT m.usuario_id, 'tramite_escalado', NEW.id
      FROM siget.membresia m
     WHERE m.institucion_id = NEW.institucion_id
       AND m.rol = 'supervisor'
       AND m.revocada_en IS NULL
       AND m.usuario_id IS DISTINCT FROM v_actor;
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION siget.generar_notificaciones() FROM PUBLIC;
-- AFTER: ya pasaron la validacion de la transicion (validar_transicion, 017) y el registro de la auditoria
CREATE TRIGGER tramite_genera_notificaciones AFTER UPDATE OF estado, escalado_en ON siget.tramite
  FOR EACH ROW EXECUTE FUNCTION siget.generar_notificaciones();

-- ---------------------------------------------------------------------------
-- 3. Solo se marca como leida, una vez, y la hora la pone la base
-- ---------------------------------------------------------------------------
-- Invoker: no necesita privilegios propios. La unica columna que app_role puede actualizar es leida_en; las demas condiciones son una
-- segunda barrera por si algun dia se concede otra columna o actualiza otro rol.
CREATE FUNCTION siget.notificacion_solo_marca_leida() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.usuario_id IS DISTINCT FROM OLD.usuario_id OR NEW.tipo IS DISTINCT FROM OLD.tipo
     OR NEW.tramite_id IS DISTINCT FROM OLD.tramite_id OR NEW.creada_en IS DISTINCT FROM OLD.creada_en THEN
    RAISE EXCEPTION 'De una notificacion solo cambia la fecha de lectura';
  END IF;
  IF OLD.leida_en IS NOT NULL THEN
    IF NEW.leida_en IS DISTINCT FROM OLD.leida_en THEN
      RAISE EXCEPTION 'Una notificacion leida no se desmarca ni se vuelve a marcar';
    END IF;
  ELSIF NEW.leida_en IS NOT NULL THEN
    NEW.leida_en := now();
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION siget.notificacion_solo_marca_leida() FROM PUBLIC;
CREATE TRIGGER notificacion_valida_lectura BEFORE UPDATE ON siget.notificacion
  FOR EACH ROW EXECUTE FUNCTION siget.notificacion_solo_marca_leida();

-- ---------------------------------------------------------------------------
-- 4. Permisos y seguridad por filas
-- ---------------------------------------------------------------------------
REVOKE ALL ON siget.notificacion FROM PUBLIC;
-- pgadmin_lectura (009), el auditor, el checkpoint y el escalador solo leen lo que se les concede tabla por tabla, asi que nada se les
-- concedio sobre esta; el REVOKE es explicito para dejar constancia
REVOKE ALL ON siget.notificacion FROM pgadmin_lectura, auditor_role, checkpoint_app, escalador_role;
-- Sin INSERT ni DELETE (y sin USAGE de la secuencia): solo inserta el disparador
GRANT SELECT ON siget.notificacion TO app_role;
GRANT UPDATE (leida_en) ON siget.notificacion TO app_role;

ALTER TABLE siget.notificacion ENABLE ROW LEVEL SECURITY;
CREATE POLICY notificacion_ver ON siget.notificacion FOR SELECT TO app_role
  USING (usuario_id = siget.ctx_usuario());
CREATE POLICY notificacion_marcar ON siget.notificacion FOR UPDATE TO app_role
  USING (usuario_id = siget.ctx_usuario())
  WITH CHECK (usuario_id = siget.ctx_usuario());

COMMIT;
