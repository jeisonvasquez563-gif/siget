-- ============================================================================
-- Migracion 008: datos personales de la persona que se registra (perfil)
-- ============================================================================
-- Se ejecuta como siget_owner (duenio de los objetos), no como superusuario.
--
-- Los datos personales viven en una tabla APARTE de `usuario` por minimo privilegio:
--   * Solo app_role puede leerla y escribirla (SELECT, INSERT). auditor_role, pgadmin_lectura y checkpoint_app NO ven nada:
--     el rol de auditoria audita acciones, no identidades civiles.
--   * Nadie puede modificar ni borrar un perfil con la aplicacion (sin UPDATE ni DELETE): un cambio de datos sera un tramite.
--   * La cedula NO se guarda en claro: `cedula_cifrada` (Fernet, clave derivada de SIGET_MFA_KEY con un contexto propio) y
--     `cedula_huella` (HMAC-SHA256 con otra clave derivada) que solo sirve para impedir dos cuentas con la misma cedula.
--   * El correo no se verifica todavia (no hay servidor de correo en el laboratorio): se guarda como dato de contacto.
-- ============================================================================
BEGIN;
SET LOCAL ROLE siget_owner;

CREATE TABLE siget.perfil (
  usuario_id        int PRIMARY KEY REFERENCES siget.usuario(id),
  nombre            text NOT NULL CHECK (char_length(nombre) BETWEEN 1 AND 60),
  apellidos         text NOT NULL CHECK (char_length(apellidos) BETWEEN 1 AND 80),
  cedula_cifrada    text NOT NULL,
  cedula_huella     text NOT NULL UNIQUE CHECK (char_length(cedula_huella) = 64),
  fecha_nacimiento  date NOT NULL CHECK (fecha_nacimiento BETWEEN DATE '1900-01-01' AND current_date),
  provincia         text NOT NULL CHECK (char_length(provincia) BETWEEN 1 AND 40),
  ciudad            text NOT NULL CHECK (char_length(ciudad) BETWEEN 1 AND 60),
  correo            text NOT NULL CHECK (char_length(correo) BETWEEN 3 AND 254),
  creado_en         timestamptz NOT NULL DEFAULT now()
);
-- Un correo, una cuenta (sin distinguir mayusculas)
CREATE UNIQUE INDEX perfil_correo_unico ON siget.perfil (lower(correo));

REVOKE ALL ON siget.perfil FROM PUBLIC;
GRANT SELECT, INSERT ON siget.perfil TO app_role;
-- pgadmin_lectura recibia SELECT por los privilegios por defecto del esquema: es un dato personal, no lo debe leer
REVOKE ALL ON siget.perfil FROM pgadmin_lectura, auditor_role, checkpoint_app;

COMMIT;
