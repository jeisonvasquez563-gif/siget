# Informe de Avance — SIGET (Sistema de Gestión y Trazabilidad)

**Infraestructura, red interna, checkpoint de Base de Datos + Apache, y repositorio del proyecto**
Ciberseguridad 5, UTP — Elaborado por: Jeison Vásquez — Grupo Ciber5

## 1. Resumen ejecutivo

Se completó la Fase 1 del plan de arquitectura (infraestructura de red y acceso a las dos máquinas virtuales del proyecto) y se resolvió, además, un pedido de avance del profesor: una aplicación web propia, corriendo sobre Apache, con pantalla de login y gestión de usuarios (creación y eliminación) reflejada en tiempo real en una base de datos PostgreSQL alojada en la otra máquina. El pedido se entregó en dos iteraciones: una primera versión con un panel de administración de base de datos genérico (pgAdmin4), y tras aclarar el requerimiento exacto con el profesor, la aplicación real solicitada (login + alta/baja de usuarios).

Además, se formalizó el proyecto en un repositorio Git privado en GitHub, con estructura de monorepo (`backend/`, `frontend/`, `infra/`, `checkpoints/`, `database/`, `docs/`) y flujo de trabajo GitFlow, dejando todo listo para arrancar la Fase 2 (Podman, Django, React) sin tener que reorganizar nada a mitad de camino.

## 2. Qué se hizo

### 2.1 Infraestructura y acceso (Fase 1 del diseño)

- Dos VMs Rocky Linux 9.7 creadas en VMware Workstation Pro: VM1 (`app-backend`) y VM2 (`db-server`).
- Acceso SSH configurado por clave pública (ED25519, una clave dedicada por VM) en reemplazo de autenticación por contraseña.
- Sudo sin contraseña (NOPASSWD) configurado para el usuario administrativo en ambas VMs.
- Red interna dedicada `192.168.100.0/24` creada en VMware (VMnet2, host-only, sin DHCP) y configurada con IP estática en cada VM: `192.168.100.10` (VM1) y `192.168.100.20` (VM2).
- Conectividad VM1 ↔ VM2 verificada por ping (0% de pérdida de paquetes) sobre la red interna.
- Hostnames configurados (`app-backend`, `db-server`) y resolución cruzada agregada en `/etc/hosts` de cada VM.
- Firewall de VM2 (firewalld) restringido mediante rich rule: el puerto 5432/TCP solo acepta conexiones desde la IP interna de VM1 (`192.168.100.10/32`), no desde la red NAT ni desde ninguna otra IP.

### 2.2 Primera iteración del checkpoint: BD + Apache/pgAdmin

- PostgreSQL 16 instalado de forma nativa en VM2, con una base de datos de demostración (`tramites_demo`) y una tabla de ejemplo con datos coherentes con el dominio del proyecto (trámites municipales).
- Apache (httpd) instalado en VM1, sirviendo pgAdmin4 en modo web (mod_wsgi) como panel de interacción visual con la base de datos.
- Conexión app↔BD verificada de extremo a extremo desde el navegador: login en pgAdmin → conexión al servidor db-server por la red interna → consulta SQL ejecutada con éxito sobre la tabla de ejemplo.
- Esta primera versión quedó funcionando e instalada, pero el profesor aclaró después que el pedido era otro (ver 2.3) — se mantiene disponible como capacidad adicional, no como la entrega principal.

### 2.3 Segunda iteración (entrega real): aplicación de login y gestión de usuarios

- Se instaló PHP 8.3 con soporte PostgreSQL (PDO) en VM1, integrado con el Apache ya existente vía PHP-FPM (en Rocky Linux 9 ya no existe mod_php para PHP 8.x).
- Se construyó una aplicación propia con pantalla de login (autenticación contra la base de datos, contraseñas hasheadas con bcrypt) y una pantalla de gestión con formulario para crear usuarios y botón para eliminarlos.
- Se agregó una tabla dedicada (`app_usuarios`) en la misma base PostgreSQL de VM2, separada de la tabla de trámites de la primera iteración.
- Se verificó el flujo completo no solo visualmente sino contra la base de datos real: se creó un usuario desde el formulario y se confirmó su existencia con una consulta SQL directa en VM2; se eliminó ese mismo usuario desde el botón correspondiente y se confirmó su baja de la misma manera.
- Se aplicaron medidas de seguridad básicas de desarrollo web: consultas parametrizadas (sin concatenación de SQL), protección CSRF por token de sesión en los formularios, y bloqueo para que un usuario no pueda eliminarse a sí mismo estando logueado.
- Todo esto respetando las medidas de seguridad ya establecidas en fases anteriores: SELinux se mantuvo en modo enforcing en ambas VMs en todo momento, y no se abrió ningún puerto más allá de lo estrictamente necesario.
- El nombre visible en la aplicación pasó por dos ajustes hasta llegar al definitivo: "Panamá Conecta" (nombre de trabajo original) → "Sistema de Gestión de Usuarios" (neutro) → **SIGET — Sistema de Gestión y Trazabilidad** (nombre final del proyecto).

### 2.4 Repositorio Git y estructura de monorepo

- Se creó un repositorio **privado** en GitHub bajo el perfil del usuario: `https://github.com/jeisonvasquez563-gif/siget`.
- Se definió una estructura de monorepo alineada a la arquitectura final: `backend/` (Django + DRF, pendiente), `frontend/` (React + Vite + Tailwind + shadcn/ui, pendiente), `infra/` (notas de VM1/VM2 + `podman/` para las unidades Quadlet futuras), `database/` (esquema SQL), `checkpoints/` (entregas puntuales como la app PHP actual, deliberadamente separadas del código final), `docs/` (esta documentación).
- Se armó el flujo **GitFlow**: rama `main` (estable) y `develop` (integración), con convención de `feature/*`, `release/*` y `hotfix/*` documentada en `CONTRIBUTING.md`.
- Se corrigió una mala práctica antes de subir el código: `db.php` tenía la contraseña de PostgreSQL escrita directo en el código fuente. Se separó en `config.php` (credenciales reales, excluido por `.gitignore`, nunca se sube) y `config.example.php` (plantilla sin datos sensibles, sí versionada).

## 3. Decisiones técnicas relevantes

- **Checkpoint separado de la arquitectura final**: se decidió con el responsable del proyecto resolver el pedido del profesor sin usar todavía Podman/contenedores (PostgreSQL y Apache se instalaron nativos vía `dnf`), para priorizar velocidad de entrega. Esta instalación es temporal y deberá revisarse — no reemplazar sin aviso — al migrar a la arquitectura final con Podman rootless.
- **Reinstalación de ambas VMs**: se detectó que el usuario administrativo no había quedado en el grupo `wheel` durante la instalación inicial (no se marcó la casilla de administrador en Anaconda), lo que impedía usar sudo. Sin contraseña de root disponible para recuperarlo, se optó por reinstalar las dos VMs en vez de ejecutar un procedimiento de recuperación por GRUB, priorizando simplicidad dado que aún no había datos de producción en juego.
- **Restricción de PostgreSQL por rich rule en vez de puerto abierto**: como las interfaces NAT e interna de VM2 comparten la misma zona de firewalld, se usó una rich rule con IP de origen específica para que el puerto 5432 solo sea alcanzable desde VM1, en línea con el principio de mínimo privilegio de red que pide el diseño original.
- **Ninguna contraseña personal del usuario fue manejada por el asistente**: todo comando que requería una contraseña interactiva (`ssh-copy-id`, configuración de sudoers) fue ejecutado directamente por el desarrollador en su propia terminal, nunca dentro de la sesión de automatización.
- **Pivote de pgAdmin a aplicación propia sin descartar lo ya hecho**: al aclararse que el pedido real era una aplicación de login y gestión de usuarios (no un panel de administración de base de datos), se optó por construir la nueva aplicación en una ruta separada (`/gestion/`) dejando pgAdmin intacto en su propia ruta (`/pgadmin4/`), evitando así rehacer trabajo o eliminar algo sin necesidad.
- **Monorepo en vez de repos separados**: decisión explícita del responsable del proyecto — backend, frontend, infraestructura y documentación conviven en un solo repositorio, con carpetas dedicadas por dominio en vez de repos independientes.
- **Sin CI/CD todavía**: se documentó la intención (lint + tests de backend/frontend, escaneo de seguridad) en `.github/workflows/README.md`, pero no se agregaron pipelines vacíos — un CI que no valida código real da una falsa sensación de seguridad.

## 4. Estado actual verificado

| Componente | Estado |
|---|---|
| Acceso SSH por clave (VM1 y VM2) | Completo y verificado |
| Sudo NOPASSWD (VM1 y VM2) | Completo y verificado |
| Red interna 192.168.100.0/24 | Completo y verificado (ping OK) |
| Hostnames y /etc/hosts | Completo |
| Firewall VM2 (restricción 5432) | Completo y verificado |
| PostgreSQL en VM2 (checkpoint) | Completo y verificado |
| Apache + pgAdmin4 en VM1 (1ra iteración) | Completo y verificado |
| Apache + PHP: app de login y gestión de usuarios (entrega real) | Completo y verificado |
| Crear/eliminar usuario reflejado en PostgreSQL | Completo y verificado |
| Repositorio GitHub privado + GitFlow | Completo |
| Estructura de monorepo (backend/frontend/infra) | Completo (carpetas y READMEs, sin código todavía) |
| Separación de credenciales fuera de git (config.php) | Completo en el repo — **pendiente redeploy en VM1** (estaba apagada) |
| Podman rootless + Quadlet (Fase 2) | No iniciado |
| Django + DRF, modelo de datos, RBAC/MFA (Fase 2-3) | No iniciado |
| Frontend React/Vite/Tailwind | No iniciado |

## 5. Qué queda pendiente

Según el orden de trabajo original del handoff de arquitectura, lo que sigue después de este avance es:

- Redesplegar en VM1 el `db.php`/`config.php` con las credenciales separadas (cambio ya en el repo, pendiente de aplicar en el servidor real — VM1 estaba apagada al momento de subir el cambio).
- Fase 2 — Instalar Podman rootless y configurar Quadlet (unidades systemd) en VM1 y VM2, migrando el despliegue de PostgreSQL de instalación nativa a contenedor gestionado.
- Definir y ejecutar la política de secretos con `podman secret` (reemplazando la contraseña en texto plano usada para el checkpoint).
- Desplegar Django + Django REST Framework en VM1 dentro de un pod junto con nginx (reverse proxy, TLS, HSTS/CSP), reemplazando o conviviendo temporalmente con el Apache instalado para el checkpoint — decisión pendiente de tomar con el responsable del proyecto.
- Configurar TLS entre la aplicación (VM1) y la base de datos (VM2) sobre la red interna, hoy en texto plano (`scram-sha-256` sin cifrado de transporte).
- Implementar el modelo de datos completo (Usuario, Institucion, TipoTramite, Tramite, EventoAuditoria append-only, Documento, Notificacion), incluyendo la máquina de estados de Tramite y las garantías de trazabilidad a nivel de base de datos (revoke de UPDATE/DELETE sobre EventoAuditoria + trigger de defensa en profundidad).
- Configurar autenticación JWT de corta duración con refresh token, hash de contraseñas con Argon2, y MFA obligatorio (TOTP) para los roles funcionario/supervisor/administrador.
- Construir el frontend en `frontend/` con React + Vite + Tailwind + shadcn/ui, con manejo seguro de tokens (access en memoria, refresh en cookie httpOnly/Secure/SameSite=Strict).
- Cargar el catálogo real de TipoTramite, comenzando por Permiso de Construcción Municipal como caso de prueba end-to-end.
- Decidir el destino del PostgreSQL, Apache y pgAdmin nativos instalados para este checkpoint (mantener como referencia, migrar sus datos al contenedor, o desinstalar) — requiere aprobación explícita antes de tocar o eliminar nada, según la regla de oro del proyecto.
- Rotar las contraseñas de servicio usadas en este checkpoint (PostgreSQL, pgAdmin, usuario admin de la app) antes de cualquier entrega pública o demo fuera del entorno de laboratorio.
- Evaluar si la aplicación de login y gestión de usuarios construida para este checkpoint se conserva como base para el módulo de administración de usuarios del proyecto final, o si se reemplaza íntegramente por el sistema de autenticación JWT + MFA que exige el diseño con Django.

## 6. Riesgos y puntos de atención

- **Contraseñas en texto plano en el servidor**: aunque ya se corrigió en el código del repo (config.php separado), el servidor real (VM1) todavía corre con la versión vieja hasta que se redepliegue. Aceptable para un entorno de laboratorio, pero incompatible con el diseño final del proyecto, que exige `podman secret`.
- **Sin TLS entre app y BD todavía**: el tráfico PostgreSQL viaja sin cifrar por la red interna. No es explotable desde fuera del laboratorio (red host-only, sin salida), pero debe corregirse antes de cualquier despliegue con datos reales.
- **Triple stack web temporal en VM1**: conviven, sin conflicto de rutas, pgAdmin4 (`/pgadmin4/`), la aplicación PHP de login y usuarios (`/gestion/`) y, a futuro, el nginx en contenedor que exige el diseño final — hay que definir qué se conserva y qué se retira al avanzar a Podman.
- **Malentendido inicial de requerimiento**: la primera entrega (pgAdmin) no coincidía con lo pedido por el profesor; se corrigió a tiempo tras una aclaración directa. Vale la lección para futuras entregas: confirmar el alcance exacto antes de invertir tiempo de implementación.
