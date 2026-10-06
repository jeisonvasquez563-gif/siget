# Especificación técnica — SIGET

Especificación de arquitectura, stack y modelo de datos del proyecto. Para el orden de ejecución por fases, ver [`plan.md`](./plan.md). Para el estado actual verificado, ver [`../informe-avance.md`](../informe-avance.md).

## Regla de oro del proyecto (no negociable)

Nunca eliminar archivos, funciones, tablas ni datos dentro de las VMs sin aprobación explícita de Jei, caso por caso. Todo cambio se documenta antes de ejecutarse. Si se va a hacer algo que no está ya descrito en la documentación del proyecto, se describe el plan primero y se espera confirmación. Ante cualquier duda técnica sobre Rocky Linux 9 / Podman / Django que no esté cubierta acá, se verifica contra documentación oficial actualizada antes de aplicar cambios — no se asume.

## 1. Contexto y problemática

Curso: Ciberseguridad 5, UTP. Referencia funcional inicial: Panamá Conecta (portal panameño de trámites virtuales). Nombre definitivo del proyecto: **SIGET — Sistema de Gestión y Trazabilidad**.

Problema real que resuelve el proyecto (no es un proyecto "de ciberseguridad" temáticamente, es un proyecto de gobierno construido con seguridad como método): falta de trazabilidad y transparencia en el seguimiento de trámites/solicitudes ante el Estado panameño — expedientes que quedan indefinidamente "en revisión", sin plazos exigibles ni rendición de cuentas (documentado en un análisis de La Prensa, jun 2026, y en el sistema 311/AIG).

La seguridad (SELinux, Podman rootless, RBAC, auditoría inmutable) es el mecanismo que garantiza que la trazabilidad sea confiable, no el tema del proyecto en sí.

## 2. Infraestructura

| Elemento | Decisión |
|---|---|
| Hypervisor | VMware Workstation Pro, local |
| SO (ambas VMs) | Rocky Linux 9, SELinux enforcing (nunca desactivar) |
| VM1 | `app-backend`, IP interna `192.168.100.10` |
| VM2 | `db-server`, IP interna `192.168.100.20` |
| Red | Adaptador NAT (internet/actualizaciones) + red interna VMware dedicada `192.168.100.0/24` |
| Firewall VM2 | Solo aceptar TCP/5432 desde `192.168.100.10` |

## 3. Stack de software

| Capa | Decisión |
|---|---|
| Contenedores | Podman rootless, gestionado con unidades systemd (Quadlet) — no Docker, no docker-compose |
| Backend | Django + Django REST Framework (Python), diseño API-first |
| Hash de contraseñas | Argon2 |
| Auth API | JWT de corta duración (`djangorestframework-simplejwt`) + refresh token |
| MFA | `django-otp` (TOTP), obligatorio para funcionario/supervisor/admin |
| RBAC | Grupos y permisos nativos de Django: ciudadano, funcionario, supervisor, administrador |
| Base de datos | PostgreSQL 16, contenedor en VM2, bind solo a IP interna, TLS app↔BD |
| Secretos | `podman secret`, nunca `.env` plano |
| Frontend | React + Vite + Tailwind CSS + shadcn/ui (SPA) |
| CORS | Allowlist exacta al origen del frontend, nunca `*` |
| Almacenamiento de JWT en frontend | Access token en memoria (nunca localStorage); refresh token en cookie httpOnly, Secure, SameSite=Strict |
| Reverse proxy | nginx en contenedor, mismo pod que django-app en VM1, TLS termination, cabeceras HSTS/CSP/X-Frame-Options |

## 4. Modelo de datos

Entidades: `Usuario`, `Institucion`, `TipoTramite`, `Tramite`, `EventoAuditoria` (append-only), `Documento`, `Notificacion`.

**Máquina de estados de `Tramite`:** Pendiente → En Tramitación ↔ En Subsanación → Aprobado / Rechazado. Las transiciones se validan en el backend contra una tabla de transiciones permitidas, nunca libres.

### Garantía de trazabilidad a nivel de BD (crítico, no omitir)

- El rol de PostgreSQL que usa Django (`app_role`) tiene `SELECT`, `INSERT` en `evento_auditoria`, con `REVOKE UPDATE, DELETE` explícito.
- Trigger `BEFORE UPDATE OR DELETE ON evento_auditoria` que lanza excepción incondicionalmente (defensa en profundidad sobre el REVOKE).
- El cambio de estado de `Tramite` y el `INSERT` en `EventoAuditoria` ocurren en la misma transacción atómica de Django — nunca uno sin el otro.

### Escalamiento automático

Django management command corriendo por un timer de systemd (dentro del Quadlet del contenedor django-app), que reasigna a supervisor y notifica cuando se vence el `fecha_limite_sla` de un trámite.

### Catálogo de trámites del MVP

Mismo motor genérico, sin lógica especial por tipo en el backend:

| TipoTramite | Institución | SLA |
|---|---|---|
| Permiso de Construcción Municipal | Alcaldía | 15 días |
| Solicitud/denuncia ciudadana | Ministerio Público / 311 | 5 días |
| Registro empresarial simplificado | AMPYME | 10 días |

(orden de construcción de cada uno en [`plan.md`](./plan.md))

## 5. Reglas de operación

- Documentar cada paso antes de ejecutarlo.
- No borrar nada dentro de las VMs sin aprobación explícita.
- Generar un informe/resumen de cierre por cada bloque de trabajo significativo.
- Verificar contra esta especificación antes de tomar decisiones nuevas; si algo no está cubierto acá, no asumir — preguntar o buscar documentación oficial actualizada.
