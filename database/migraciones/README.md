# Migraciones de la base de datos

Cambios incrementales sobre el esquema `siget` que ya está aplicado. Se ejecutan **en orden**, dentro de una transacción (`BEGIN; … COMMIT;`), por el superusuario del contenedor por el socket local (`database/psql-contenedor.sh`); cada archivo asume el rol `siget_owner` con `SET LOCAL ROLE`. **Antes de aplicar una migración se hace un respaldo** (`pg_dump -Fc`) y, si es posible, un ensayo con `ROLLBACK`.

| # | Archivo | Qué hace | Aplicada |
|---|---|---|---|
| 002 | `002-dividir-rol-plataforma.sql` | Divide el rol de plataforma en cinco y agrega el control dual | 15-oct-2026 |
| 003 | `003-login-app-role.sql` | Permite el `LOGIN` de `app_role` y concede `CONNECT` a los cinco roles | 20-oct-2026 |
| 004 | `004-autenticacion.sql` | Segundo factor, bloqueo por intentos, sesiones y eventos de seguridad | 20-oct-2026 |
| 005 | `005-catalogo-inicial.sql` | Siembra 6 instituciones y 6 tipos de trámite con su plazo | 20-oct-2026 |
| 006 | `006-historial-solicitante.sql` | Política RLS: el solicitante ve el historial de sus trámites | 20-oct-2026 |

## Para una base nueva

`database/diseno-roles-permisos.sql` ya incluye lo de la migración 002 (es el script de arranque consolidado). En una base nueva se ejecuta ese archivo y después **solo las migraciones 003 a 006**.

## Reglas

- La contraseña de `app_role` **nunca** va en una migración: se fija aparte y vive como `podman secret`.
- Una migración debe ser segura de leer: sin datos personales ni secretos.
- Al quitar un permiso a `PUBLIC`, conceder primero a los roles que lo usan y **verificar con un login real** (la migración 003 dejó el login del checkpoint sin base unos minutos por no hacerlo).
