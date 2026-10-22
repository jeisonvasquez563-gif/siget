# Estado de la base de datos — 22 de octubre de 2026

Fotografía **en vivo** de `tramites_demo` (PostgreSQL 16.15 en contenedor rootless, VM2), tomada con [`database/estado-bd.sql`](../database/estado-bd.sql), que es de **solo lectura**. Para repetirla:

```bash
database/psql-contenedor.sh -d tramites_demo -f database/estado-bd.sql
```

## 1. Resumen

| Dato | Valor |
|---|---|
| Motor | PostgreSQL 16.15 (imagen oficial) en Podman rootless, puerto `192.168.100.20:5433` solo en la red interna |
| Tamaño | 8,8 MB |
| Esquema | `siget`: 11 tablas, 7 funciones, migraciones 002 a 007 aplicadas |
| Conexión | TLS 1.3 obligatorio, verificación completa del certificado, `scram-sha-256` |
| Superusuario | `postgres` existe pero **sin contraseña** y rechazado por red; solo por el socket local del contenedor |
| Roles de aplicación con superusuario u omisión de RLS | **Ninguno** |
| Registro inalterable | Ningún rol puede `UPDATE`, `DELETE` ni `TRUNCATE` sobre `evento_auditoria`, `decision_pdp`, `evento_seguridad` ni `transicion` |
| Respaldos automáticos | 🟠 **No** (último volcado manual de los que quedan en la VM: 20-oct; ver H-1 del [informe de seguridad](./revision-seguridad-2026-10-22.md)) |

## 2. Roles de PostgreSQL

| Rol | Inicio de sesión | Límite | Qué es |
|---|:-:|:-:|---|
| `app_role` | ✅ | 20 | El backend Django; solo lo que necesita (sin `DELETE`, `UPDATE` solo en columnas concretas) |
| `auditor_role` | ✅ | 5 | La consola de auditoría; **solo `SELECT`** y sin columnas de secretos |
| `siget_owner` | ❌ | — | Dueño de las tablas; nadie se conecta con él |
| `checkpoint_app` | ✅ | — | Checkpoint PHP heredado (se retira en la semana 6) |
| `pgadmin_lectura` | ✅ | — | Consulta de solo lectura para el equipo |
| `postgres` | ✅ (solo socket) | — | Administración del motor; sin contraseña |

Ninguno es superusuario salvo `postgres`, ninguno crea roles ni bases, y ninguno omite la seguridad por filas.

## 3. Tablas

| Tabla | Filas | Tamaño | RLS | Políticas | Disparadores | Para qué sirve |
|---|--:|--:|:-:|:-:|:-:|---|
| `usuario` | 14 | 88 kB | — | 0 | 1 | Cuentas, hash Argon2, segundo factor, rol de plataforma |
| `institucion` | 6 | 48 kB | — | 0 | 0 | Catálogo de instituciones |
| `membresia` | 5 | 24 kB | — | 0 | 1 | Rol de una persona en una institución (excluye al rol de plataforma) |
| `tipo_tramite` | 6 | 64 kB | — | 0 | 0 | Catálogo de trámites y plazos |
| `tramite` | 11 | 56 kB | ✅ | 3 | 2 | Trámites; cada rol ve solo lo suyo o lo de su institución |
| `transicion` | 5 | 24 kB | — | 0 | 0 | Historial de estados (solo inserción, por disparador) |
| `evento_auditoria` | 23 | 32 kB | ✅ | 4 | 2 | Actuaciones sobre trámites, inalterable |
| `decision_pdp` | 129 | 80 kB | — | 0 | 1 | Cada decisión de acceso del motor, inalterable |
| `evento_seguridad` | 117 | 88 kB | — | 0 | 2 | Inicios de sesión, bloqueos, segundo factor; inalterable |
| `aprobacion` | 0 | 32 kB | — | 0 | 0 | Control dual (aún sin uso: faltan las consolas de plataforma) |
| `sesion` | 58 | 104 kB | — | 0 | 0 | Sesiones de refresco (solo el hash) |

RLS en 2 de 11 tablas es una decisión de diseño con matices: ver H-5 del informe de seguridad.

## 4. Datos de hoy

**Cuentas (14):** 8 de ciudadanía/personal de institución (7 con segundo factor activo), y **una por cada rol de plataforma** (infraestructura, identidades, catálogo, seguridad, secretos y auditor), todas con segundo factor. Ninguna bloqueada ahora mismo.

**Sesiones:** 58 en total, 0 vigentes (las VM acaban de arrancar y las de 8 h expiraron), 2 revocadas.

**Eventos de seguridad (últimos 7 días, 117):**

| Evento | Cantidad |
|---|--:|
| `login_rechazado_bloqueada` | 58 |
| `login_ok` | 47 |
| `login_fallido` | 5 |
| `mfa_verificado` | 2 |
| `mfa_verificacion_fallida` | 2 |
| `logout` | 2 |
| `cuenta_bloqueada` | 1 |

Los 58 rechazos por bloqueo y la cuenta bloqueada son coherentes con los ensayos de la protección contra fuerza bruta (no se identificó la cuenta ni la IP de cada uno); sirven para mostrar que **todo intento queda registrado**.

**Decisiones del PDP (129):** 72 permitidas y 57 negadas. Que casi la mitad sean negaciones es lo esperado: los ensayos prueban a propósito lo que no se debe poder hacer.

**Conexiones activas:** una sola de aplicación (`app_role` desde `192.168.100.10`, TLSv1.3) y la del administrador por socket local.

## 5. Defensas verificadas

| Defensa | Cómo se comprobó |
|---|---|
| Registro inalterable | Consulta de privilegios: 0 filas con `UPDATE`/`DELETE`/`TRUNCATE` para cualquier rol; además los disparadores `bloquear_modificacion` |
| `SECURITY DEFINER` seguro | Las 3 funciones con `search_path = siget, pg_temp` |
| Sin acceso remoto del superusuario | `pg_hba.conf`: `host all postgres all reject` |
| Solo VM1 puede conectarse | `pg_hba.conf` limita a `192.168.100.10/32` con `hostssl` |
| TLS mínimo | `ssl_min_protocol_version = TLSv1.3` |
| Claves | `password_encryption = scram-sha-256`; las claves de `app_role` y `auditor_role` viven como `podman secret` |

## 6. Pendiente

- **Respaldos automáticos con restauración probada** (alta prioridad).
- Activar `log_connections` y `log_disconnections`.
- Retirar `checkpoint_app` y la copia del PostgreSQL nativo cuando se apague el checkpoint PHP.
- Considerar vistas de login para no exponer `usuario` y `sesion` completas a `app_role`.
