# Changelog — SIGET

Registro cronológico de cada cambio significativo del proyecto. Formato inspirado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/). Cada entrada debe decir **qué** cambió y, cuando no sea obvio, **por qué**.

> Documentar acá es obligatorio para todo PR — ver [`CONTRIBUTING.md`](./CONTRIBUTING.md#documentación--obligatoria-no-opcional).

## [Sin liberar] — en desarrollo

### Añadido
- **Base de datos nativa apagada y deshabilitada** (tarea 2.3 cerrada; `runbook.md` 21.8): sin conexiones de clientes al momento de apagarla, el puerto 5432 ya no escucha y la app trabaja solo contra el contenedor. Sus datos se conservan en disco; no se desinstaló nada. Pendientes: apuntar pgAdmin al puerto 5433 con SSL y quitar la regla del 5432 del firewall.
- **PostgreSQL en contenedor rootless** (tareas 2.2 y 2.3; `runbook.md` sección 21): imagen oficial `postgres:16.15` bajo el usuario `siget`, unidad Quadlet versionada en `infra/podman/vm2-db-server/`, puerto 5433 solo en la IP interna, TLS 1.3 con `podman secret`, `pg_hba.conf` propio y sin contraseña de superusuario. Roles, esquema y datos migrados desde la base nativa; la app del checkpoint ya trabaja contra el contenedor y las 24 pruebas pasan. La base nativa sigue encendida pero desactualizada, pendiente de apagar con aprobación.
- `database/psql-contenedor.sh` y la demo (`database/demo-roles.sh`) apuntan por defecto al contenedor.
- **Sudo de mínimo privilegio para `andy_martinez`** (ZT-4; `runbook.md` sección 20): de `NOPASSWD: ALL` a poder operar como `siget` y ejecutar comandos de diagnóstico de solo lectura como root. Verificado: ya no puede ser root ni instalar paquetes.
- `docs/estructura-plataforma.md` y `docs/img/estructura-plataforma.svg`: explicación de la estructura de la plataforma con diagrama (aplicación en VM1, base de datos en VM2, TLS entre ambas), flujo de una petición, estado real frente al plan y carpetas del repositorio.
- **Rol de plataforma dividido en cinco** (`operador_infraestructura`, `operador_identidades`, `operador_catalogo`, `operador_seguridad` y `custodio_secretos`) con **control dual** (`siget.aprobacion`) y la regla de un solo rol de plataforma por persona, sin membresías de institución (ni al revés). Migración `database/migraciones/002-dividir-rol-plataforma.sql` aplicada en la base real; pruebas de 19 a 24, todas contra el esquema real (`runbook.md` sección 19). Los roles de la aplicación pasan de 6 a 10. Los módulos de base de datos pasan de 10 a 11 (se suma el control dual).
- **TLS 1.3 entre la aplicación y la base de datos** (ZT-2; `runbook.md` sección 18): CA interna, certificado del servidor con verificación `verify-full` en el PHP del checkpoint y `hostssl` en `pg_hba.conf`; una conexión sin TLS ahora es rechazada. Nuevo `docs/modulos.md` con el conteo de módulos implementados y planificados.
- **Roles sin la palabra "administrador"**: `admin_institucional` pasa a `coordinador_institucional` y `admin_plataforma` a `operador_plataforma` (enumeraciones renombradas en la base real, SQL, pruebas, spec, plan, diseño Zero Trust, `backend/README.md` y los `.docx` de la introducción y de la arquitectura). Nueva `docs/zero-trust-cobertura.md` con la matriz de los 7 principios de NIST SP 800-207, desvíos actuales y tareas ZT-1 a ZT-10. El plan deja explícito que el checkpoint PHP no es parte del sistema final y se retira en la semana 6.
- **Roles de base de datos en marcha y brecha del superusuario cerrada** (`runbook.md` sección 17): esquema `siget` aplicado en `tramites_demo` (8 tablas, 6 políticas RLS, 5 triggers, roles `siget_owner`, `app_role` y `auditor_role`), la app PHP del checkpoint pasa de `postgres` a `checkpoint_app` (solo `app_usuarios`), pgAdmin pasa a `pgadmin_lectura` (solo lectura), `postgres` queda sin contraseña y rechazado por red en `pg_hba.conf`. Verificado con login real y las 19 pruebas contra el esquema aplicado. Incidente: la contraseña anterior de `postgres` quedó impresa en el registro de la sesión; ya está anulada.
- **Diseño de roles, permisos y módulos a nivel de base de datos** (`database/diseno-roles-permisos.sql`, `database/diseno-pruebas.sql`, `database/demo-roles.sh` y `docs/roles-permisos-bd.md`): esquema `siget` con 8 tablas, roles `siget_owner`, `app_role` y `auditor_role`, permisos mínimos, RLS, triggers de integridad y auditoría inmutable. **Sin superusuario en la operación** (nuevo principio Zero Trust). Validado con 19 pruebas dentro de una transacción con ROLLBACK; no está aplicado en la base. Brecha registrada: la app del checkpoint sigue conectándose como `postgres`.
- **Respaldo de `tramites_demo`** antes de la migración a contenedor (tarea 2.1; `runbook.md` sección 16): volcado en VM2 verificado con una restauración de prueba y copiado fuera de la VM con hash comprobado. Los respaldos no se versionan: `.gitignore` ahora excluye `*.dump`, `globals-*.sql` y `respaldos-siget/`.
- **Podman 5.8.2 rootless en VM2** (tarea 1.2; `runbook.md` 12.9): instalado desde la cuenta de Jeison, sin dar sudo adicional a nadie. Verificado con el usuario `siget`: rootless, SELinux en Enforcing sin denegaciones, contenedor de prueba correcto. El PostgreSQL nativo y el firewall no cambiaron.
- **Usuario de servicio `siget` en VM1 y VM2** (decisión D1, tarea 1.1; `runbook.md` sección 15): cuenta dedicada para los contenedores, sin contraseña, sin SSH y sin sudo, con rango subuid/subgid y linger activo. Podman rootless verificado en VM1.
- **Journal persistente en VM1 y VM2** (`runbook.md` 14.6): los comandos `sudo` ya no se pierden al reiniciar. Se verificaron los DOI de NIST SP 800-207 y SP 800-162 contra los PDF oficiales (tareas 1.4 y 1.8 del plan de las semanas 1 y 2).
- `docs/architecture/plan-semanas-1-2.md`: plan operativo de las semanas 1 y 2 del cronograma (Podman en VM2, PostgreSQL en contenedor con `app_role` y `podman secret`, esqueletos de backend y frontend, especificación del ABAC), con decisiones previas, responsables propuestos, camino crítico y riesgos.
- `docs/Runbook_SIGET.docx` regenerado desde `docs/runbook.md` (19 páginas): incluye las secciones 12 (Podman/Quadlet), 13 (cuentas y sudo del equipo) y 14 (endurecimiento de SSH y firewall).
- `docs/runbook.md`: secciones 13 (cuentas de Linux del equipo y sudo) y 14 (endurecimiento de SSH y firewall); se corrigió la tabla de la sección 11 (usuarios del equipo y acceso por Tailscale) y el estado de `siget-prueba` en 12.8.
- `docs/revisiones/2026-10-15-revision-prs-3-y-4.md`: revisión de los PRs 3 (Podman/Quadlet) y 4 (Zero Trust) contra el estado real de VM1 y VM2, auditoría de estándares de seguridad y tabla de pendientes abiertos.
- **Endurecimiento de SSH y firewall en VM1 y VM2** (`docs/endurecimiento-vms.md`): `PasswordAuthentication no` (acceso solo por clave) y Cockpit retirado de firewalld, tras una auditoría que los detectó como desvíos preexistentes. Pendiente: bind de PostgreSQL a la IP interna al migrar a contenedor.
- `andy_martinez` recibe sudo `NOPASSWD` en VM1 (archivo `/etc/sudoers.d/andy_martinez`, validado con `visudo`) para instalar Podman. Autorizado por Jeison. No tiene sudo en VM2.
- **Cuentas de Linux para el equipo** en VM1 y VM2 (8 integrantes, formato `nombre_apellido`, grupo `ciber5`, sin sudo y sin contraseña: acceso solo por clave pública SSH vía Tailscale). Pendiente: cargar las claves públicas de cada integrante. Ver [`docs/acceso-equipo.md`](./docs/acceso-equipo.md).
- **Diseño de arquitectura Zero Trust** (`docs/superpowers/specs/2026-10-08-arquitectura-zero-trust-design.md` y `docs/SIGET_Arquitectura_Zero_Trust.docx`): respuesta a "qué deseo hacer / a quién deseo llegar", autorización ABAC con membresías (institución, rol), PEP/PDP en Django más RLS en PostgreSQL, matriz de 6 roles, mapa de 6 instituciones (3 reales y 3 de demostración), modelo de amenazas STRIDE y plan de verificación. El motor ABAC tendrá especificación y plan propios (pendiente).
- **Podman 5.8.2 rootless + primera unidad Quadlet en VM1 (`app-backend`)**, con aprobación de Jeison. Contenedor de prueba `siget-prueba` gestionado por `systemctl --user`, sin root y sin denegaciones de SELinux. Documentado en `docs/runbook.md` sección 12; unidad en `infra/podman/vm1-app-backend/siget-prueba.container`. Pendiente: VM2, linger y puertos 80/443.
- `infra/podman/plan-podman-quadlet.md`: borrador del plan para instalar Podman rootless + Quadlet en VM1 y VM2, con el estado verificado de VM1, los pasos propuestos, los riesgos y las decisiones pendientes de Jeison (usuario que corre los contenedores, puertos 80/443 y permisos de sudo).
- `docs/documento-introductorio.md`, `docs/antecedentes.md` y `docs/datos-clave-investigacion.md`: la investigación y el documento de entrega pasados a Markdown para el equipo, más una ficha rápida con cifras, artículos de ley verificados y advertencias sobre las fuentes.
- Política de documentación obligatoria en `CONTRIBUTING.md`.
- `docs/Antecedentes_SIGET.docx`: documento de antecedentes del proyecto solicitado por el profesor (16 páginas, 8 tablas). Recoge la evidencia sobre la complejidad y el seguimiento de los trámites en Panamá (BID, permisos de construcción 2015–2026, sistema 311), el marco normativo (Leyes 38 de 2000, 83 de 2012, 144 de 2020, 81 de 2019, entre otras, con artículos verificados contra el texto), la transformación digital del Estado (Panamá Conecta, Panamá Digital, Alcaldía Digital), los incidentes de ciberseguridad en instituciones públicas de 2025–2026, las brechas identificadas y la justificación de SIGET. Bibliografía en formato APA con 30 fuentes, mayoritariamente panameñas, y fecha de consulta del 6 de octubre de 2026. Incluye una sección de limitaciones de la revisión.
- `docs/capturas-evidencia.md`: comandos organizados por tema (red, SELinux, firewall, servicios, BD, app) para que cada integrante del grupo tome su propia captura de la configuración, con un reparto sugerido de tareas entre el equipo.
- **Tailscale en VM1 y VM2** (`siget-app-backend` 100.104.206.118, `siget-db-server` 100.120.115.100), en una tailnet nueva dedicada al proyecto — no en la tailnet personal/compartida que ya tenía el desarrollador. Solución de fondo para que compañeros y profesor accedan a la app sin depender del enrutamiento de la red del aula.

### Seguridad
- **Auth keys de Tailscale revocadas** desde el panel de administración, ya que se habían compartido por chat durante el alta de VM1 y VM2. Verificado que ambas VMs siguen conectadas con normalidad tras la revocación.

### Cambiado
- `docs/architecture/spec.md` y `docs/architecture/plan.md`: se incorpora el diseño de seguridad Zero Trust (Jeison Vásquez, octubre de 2026). La autorización pasa de RBAC con grupos de Django a ABAC con Row Level Security en PostgreSQL; se pasa de 4 a 6 roles (administrador institucional y de plataforma separados, más auditor); se agrega la entidad `Membresia`, el registro de decisiones del PDP y 3 instituciones de demostración (MINSA, MOP, MiAmbiente). El plan suma la especificación del motor ABAC como próximo entregable de diseño. Solo documentación, sin cambios en las VMs.
- El port forwarding por NAT (`8080 -> VM1:80`) queda como intento previo que no funcionó para los compañeros (probablemente aislamiento de clientes en la WiFi del aula) — no se revirtió, pero el acceso real ahora es por Tailscale.

### Descartado
- Túnel público con `cloudflared` (exponer la app a todo internet): descartado por política de seguridad del equipo antes de completarse. Se optó por Tailscale (acceso privado) en su lugar.
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
