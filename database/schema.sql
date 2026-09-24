-- SIGET — Sistema de Gestión y Trazabilidad
-- Esquema de la base de datos del checkpoint (PostgreSQL 16, en db-server / VM2)
-- No incluye datos ni contraseñas reales — solo estructura.

-- Tabla de usuarios de la aplicación de checkpoint (login, registro, reset de password,
-- gestión de usuarios y rate limiting de intentos de login).
CREATE TABLE IF NOT EXISTS app_usuarios (
    id                  SERIAL PRIMARY KEY,
    username            VARCHAR(50) UNIQUE NOT NULL,
    password_hash       TEXT NOT NULL,
    creado_en           TIMESTAMP DEFAULT now(),
    intentos_fallidos   INT NOT NULL DEFAULT 0,
    bloqueado_hasta     TIMESTAMP NULL
);

-- Migración si la tabla ya existía sin estas columnas (idempotente):
-- ALTER TABLE app_usuarios ADD COLUMN IF NOT EXISTS intentos_fallidos INT NOT NULL DEFAULT 0;
-- ALTER TABLE app_usuarios ADD COLUMN IF NOT EXISTS bloqueado_hasta TIMESTAMP NULL;

-- Tabla de ejemplo del primer checkpoint (trámites)
CREATE TABLE IF NOT EXISTS demo_tramite (
    id              SERIAL PRIMARY KEY,
    descripcion     TEXT,
    estado          VARCHAR(30) DEFAULT 'Pendiente',
    creado_en       TIMESTAMP DEFAULT now()
);

-- Regla de firewall aplicada en VM2 (referencia, no se ejecuta desde SQL):
--   firewall-cmd --permanent --zone=public --add-rich-rule=
--     'rule family="ipv4" source address="192.168.100.10/32" port protocol="tcp" port="5432" accept'
