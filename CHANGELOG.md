# Changelog — SIGET

Registro cronológico de cada cambio significativo del proyecto. Formato inspirado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/). Cada entrada debe decir **qué** cambió y, cuando no sea obvio, **por qué**.

> Documentar acá es obligatorio para todo PR — ver [`CONTRIBUTING.md`](./CONTRIBUTING.md#documentación--obligatoria-no-opcional).

## [Sin liberar] — en desarrollo

### Añadido
- Política de documentación obligatoria en `CONTRIBUTING.md`.
- **Tailscale en VM1 y VM2** (`siget-app-backend` 100.104.206.118, `siget-db-server` 100.120.115.100), en una tailnet nueva dedicada al proyecto — no en la tailnet personal/compartida que ya tenía el desarrollador. Solución de fondo para que compañeros y profesor accedan a la app sin depender del enrutamiento de la red del aula.

### Cambiado
- El port forwarding por NAT (`8080 -> VM1:80`) queda como intento previo que no funcionó para los compañeros (probablemente aislamiento de clientes en la WiFi del aula) — no se revirtió, pero el acceso real ahora es por Tailscale.

### Descartado
- Túnel público con `cloudflared` (exponer la app a todo internet): bloqueado por el clasificador de seguridad del propio entorno de trabajo antes de completarse. Se optó por Tailscale (acceso privado) en su lugar.
- Este `CHANGELOG.md`.
- **Crear cuenta y restablecer contraseña en la app SIGET** (`checkpoints/siget-gestion-usuarios/register.php` y `reset-password.php`), enlazados desde `login.php`. Pedido explícito para que el profesor pueda ver ambos flujos, no solo el login con el usuario semilla.
  - `register.php`: alta de cuenta autoservicio (usuario + contraseña, con confirmación), valida longitud mínima y usuario único, hashea con bcrypt.
  - `reset-password.php`: restablecimiento directo (usuario + contraseña nueva) — **sin verificación por email**, porque el entorno de laboratorio no tiene servidor de correo configurado. La página lo aclara explícitamente en pantalla. Devuelve el mismo mensaje exista o no el usuario, para no permitir enumeración de cuentas.
  - Verificado end-to-end: cuenta creada → login con ella → contraseña restablecida → login con la nueva contraseña funciona, con la vieja ya no.
- **Mensaje de "Acceso denegado" y rate limiting de 3 intentos en el login** de la app SIGET. Nuevas columnas `intentos_fallidos` y `bloqueado_hasta` en `app_usuarios`. Bloqueo de 5 minutos tras 3 intentos fallidos, incluso con la contraseña correcta mientras dure el bloqueo.
- **Acceso a la app desde la red del aula** (compañeros y profesor, no solo la laptop del desarrollador): port forwarding TCP 8080 → VM1:80 configurado en VMware NAT (`vmnetnat.conf`), y regla de entrada en el Firewall de Windows restringida a la subred del aula (`172.29.16.0/20`).

### Corregido
- **Dos bugs en el rate limiting del login**, encontrados y corregidos antes de dar la funcionalidad por terminada:
  1. La comparación de si una cuenta seguía bloqueada se hacía en PHP con `strtotime()`, que interpreta el timestamp con la zona horaria por defecto de PHP — podía no coincidir con la de PostgreSQL y hacer que el bloqueo pareciera vencido apenas se guardaba. Se movió la comparación a la propia consulta SQL (`bloqueado_hasta > now()`).
  2. Se esperaba que PDO devolviera un `BOOLEAN` de Postgres como el string `'t'`, pero en este entorno lo devuelve como `bool` nativo de PHP — la comparación `=== 't'` era siempre falsa. Corregido a `=== true`.

## 2026-09-24

### Añadido
- `docs/architecture/spec.md` y `docs/architecture/plan.md`, separando la especificación técnica del plan de trabajo (antes un único `handoff-original.md`).

### Cambiado
- Repositorio `siget` pasado de **privado a público** para compartir con compañeros del grupo.
- Branch protection configurada en `main` y `develop`: 1 aprobación requerida por PR, sin force-push, sin borrado de rama, conversaciones deben resolverse antes de mergear.

### Seguridad
- **Incidente**: `docs/runbook.md`, `docs/informe-avance.md`, `docs/demo-comandos.md`, `docs/Comandos_Demo_SIGET.txt` y `docs/Runbook_SIGET.docx` tenían contraseñas reales (PostgreSQL, pgAdmin, usuario admin de la app) en texto plano, expuestas al hacer público el repo.
- **Remediación**: se rotaron las tres contraseñas afectadas en las VMs, se redactó toda la documentación (reemplazo por placeholders), y se verificó que no queda ningún rastro en el árbol de trabajo actual (incluyendo el `.docx`, regenerado desde su script fuente).
- **Gotcha documentado**: al rotar el hash bcrypt del usuario admin de la app vía un comando SSH remoto embebido en comillas dobles, los signos `$` del hash se interpretaron como variables de shell y lo corrompieron silenciosamente. Solución: transferir el SQL como archivo (`scp` + `psql -f`) en vez de embeberlo en un string de comando.

### Eliminado
- `docs/architecture/handoff-original.md` (contenido repartido en `spec.md` y `plan.md`).

## 2026-09-22

### Añadido
- Repositorio Git privado creado en GitHub (`jeisonvasquez563-gif/siget`).
- Estructura de monorepo: `backend/`, `frontend/`, `infra/` (con `podman/`), `database/`, `checkpoints/`, `docs/`.
- Flujo de trabajo GitFlow (`main` + `develop`), documentado en `README.md`.
- `.editorconfig` y `CONTRIBUTING.md` con convención de commits (Conventional Commits).
- Toda la documentación existente migrada a Markdown dentro de `docs/` (antes solo en `.docx`/`.txt`).

### Cambiado
- `checkpoints/siget-gestion-usuarios/db.php` refactorizado para leer credenciales desde `config.php` (fuera de git) en vez de tenerlas hardcodeadas — se agregó `config.example.php` como plantilla.
- Nombre visible de la app de checkpoint (login/dashboard) cambiado a **SIGET — Sistema de Gestión y Trazabilidad** (antes "Sistema de Gestión de Usuarios", y originalmente "Panamá Conecta").

## 2026-09-20

### Añadido
- Aplicación de checkpoint real pedida por el profesor: login + gestión de usuarios (crear/eliminar) en PHP (PHP-FPM) sobre Apache en VM1, contra PostgreSQL en VM2. Tabla `app_usuarios` con contraseñas hasheadas (bcrypt), consultas parametrizadas (PDO), protección CSRF.
- Primer checkpoint: PostgreSQL 16 nativo en VM2 (base `tramites_demo`, tabla `demo_tramite`) + Apache/pgAdmin4 en VM1 como panel de administración de base de datos.
- Documentos `Runbook_SIGET.docx`, `Informe_Avance_SIGET.docx`, `Comandos_Demo_SIGET.txt` generados por primera vez.

### Corregido
- Ambas VMs reinstaladas tras detectar que el usuario administrativo no había quedado en el grupo `wheel` (no se marcó "Make this user administrator" en el instalador), lo que impedía usar `sudo`.

## Fase 1 — infraestructura base (fecha original de ejecución)

### Añadido
- VM1 (`app-backend`) y VM2 (`db-server`), Rocky Linux 9, en VMware Workstation Pro.
- Acceso SSH por clave pública ED25519 (una clave dedicada por VM) + sudo NOPASSWD.
- Red interna dedicada `192.168.100.0/24` (VMnet2, host-only, sin DHCP) con IP estática en cada VM.
- Hostnames (`app-backend`, `db-server`) y resolución cruzada en `/etc/hosts`.
- Firewall de VM2 restringido: 5432/TCP solo desde `192.168.100.10` (rich rule de firewalld).

Detalle completo de esta fase en [`docs/runbook.md`](./docs/runbook.md) secciones 1-7.
