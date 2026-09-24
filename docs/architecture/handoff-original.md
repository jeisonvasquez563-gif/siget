# Handoff de arquitectura original — SIGET (ref. Panamá Conecta)

Proyecto de Aplicación de Gobierno Digital — Ciberseguridad 5 (UTP)

> Este documento es el diseño original consolidado al arrancar el proyecto, antes de que se le pusiera el nombre definitivo (SIGET). Se conserva tal cual para trazabilidad de las decisiones — el nombre de trabajo "Panamá Conecta" era solo la referencia funcional inicial, no el nombre del producto (ver `docs/informe-avance.md` para la decisión de renombrar).

## 0. Regla de oro del proyecto

Nunca eliminar archivos, funciones, tablas ni datos dentro de las VMs sin aprobación explícita de Jei, caso por caso. Todo cambio se documenta antes de ejecutarse. Si se va a hacer algo que no está ya descrito en este documento o en un informe de fase, se describe el plan primero y se espera confirmación. Ante cualquier duda técnica sobre Rocky Linux 9 / Podman / Django que no esté cubierta acá, se verifica contra documentación oficial actualizada antes de aplicar cambios — no se asume. Este documento es la fuente de verdad de las decisiones originales; los informes de cada fase (en `docs/`) tienen el detalle y la justificación de lo ya ejecutado.

## 1. Contexto y problemática

Curso: Ciberseguridad 5, UTP. Referencia funcional inicial: Panamá Conecta (portal panameño de trámites virtuales).

Problema real que resuelve el proyecto (no es un proyecto "de ciberseguridad" temáticamente, es un proyecto de gobierno construido con seguridad como método): falta de trazabilidad y transparencia en el seguimiento de trámites/solicitudes ante el Estado panameño — expedientes que quedan indefinidamente "en revisión", sin plazos exigibles ni rendición de cuentas (documentado en un análisis de La Prensa, jun 2026, y en el sistema 311/AIG).

La seguridad (SELinux, Podman rootless, RBAC, auditoría inmutable) es el mecanismo que garantiza que la trazabilidad sea confiable, no el tema del proyecto en sí.

## 2. Infraestructura (Fase 1)

| Elemento | Decisión |
|---|---|
| Hypervisor | VMware Workstation/Player, local |
| SO (ambas VMs) | Rocky Linux 9, SELinux enforcing (nunca desactivar) |
| VM1 | app-backend, IP interna 192.168.100.10 |
| VM2 | db-server, IP interna 192.168.100.20 |
| Red | Adaptador NAT (internet/actualizaciones) + red interna VMware personalizada 192.168.100.0/24 |
| Firewall VM2 | Solo aceptar TCP/5432 desde 192.168.100.10 |

## 3. Stack de software (Fase 2)

| Capa | Decisión |
|---|---|
| Contenedores | Podman rootless, gestionado con unidades systemd (Quadlet) — no Docker, no docker-compose |
| Backend | Django + Django REST Framework (Python), diseño API-first |
| Hash de contraseñas | Argon2 |
| Auth API | JWT de corta duración (djangorestframework-simplejwt) + refresh token |
| MFA | django-otp (TOTP), obligatorio para funcionario/supervisor/admin |
| RBAC | Grupos y permisos nativos de Django: ciudadano, funcionario, supervisor, administrador |
| Base de datos | PostgreSQL 16, contenedor en VM2, bind solo a IP interna, TLS app↔BD |
| Secretos | `podman secret`, nunca `.env` plano |
| Frontend | React + Vite + Tailwind CSS + shadcn/ui (SPA) |
| CORS | Allowlist exacta al origen del frontend, nunca `*` |
| Almacenamiento de JWT en frontend | Access token en memoria (nunca localStorage); refresh token en cookie httpOnly, Secure, SameSite=Strict |
| Reverse proxy | nginx en contenedor, mismo pod que django-app en VM1, TLS termination, cabeceras HSTS/CSP/X-Frame-Options |

## 4. Modelo de datos (Fase 3)

Entidades: `Usuario`, `Institucion`, `TipoTramite`, `Tramite`, `EventoAuditoria` (append-only), `Documento`, `Notificacion`.

**Máquina de estados de `Tramite`:** Pendiente → En Tramitación ↔ En Subsanación → Aprobado / Rechazado. Las transiciones se validan en el backend contra una tabla de transiciones permitidas, nunca libres.

**Garantía de trazabilidad a nivel de BD (crítico, no omitir):**

- El rol de PostgreSQL que usa Django (`app_role`) tiene `SELECT`, `INSERT` en `evento_auditoria`, con `REVOKE UPDATE, DELETE` explícito.
- Trigger `BEFORE UPDATE OR DELETE ON evento_auditoria` que lanza excepción incondicionalmente (defensa en profundidad sobre el REVOKE).
- El cambio de estado de `Tramite` y el `INSERT` en `EventoAuditoria` ocurren en la misma transacción atómica de Django — nunca uno sin el otro.

**Escalamiento automático:** Django management command corriendo por un timer de systemd (dentro del Quadlet del contenedor django-app), que reasigna a supervisor y notifica cuando se vence el `fecha_limite_sla` de un trámite.

### Catálogo de trámites del MVP

(mismo motor genérico, sin lógica especial por tipo en el backend)

| TipoTramite | Institución | SLA | Orden de construcción |
|---|---|---|---|
| Permiso de Construcción Municipal | Alcaldía | 15 días | 1º — caso de prueba, construir primero end-to-end |
| Solicitud/denuncia ciudadana | Ministerio Público / 311 | 5 días | 2º — solo datos de catálogo + frontend |
| Registro empresarial simplificado | AMPYME | 10 días | 3º — solo datos de catálogo + frontend |

## 5. Reglas de operación para la ejecución

- Documentar cada paso antes de ejecutarlo.
- No borrar nada dentro de las VMs sin aprobación explícita.
- Generar un informe/resumen de cierre por cada bloque de trabajo significativo.
- Verificar contra este documento antes de tomar decisiones nuevas; si algo no está cubierto acá, no asumir — preguntar o buscar documentación oficial actualizada.

## 6. Orden de trabajo original

1. Crear VM1 y VM2 en VMware según la sección 2, configurar red interna, confirmar ping entre ambas. **✅ Completo.**
2. Instalar Podman rootless en ambas VMs, configurar Quadlet. **⏳ Pendiente.**
3. Desplegar PostgreSQL en VM2 (bind a IP interna, `pg_hba.conf` restringido, rol `app_role` con los permisos de la sección 4). **⚠️ Parcial** — PostgreSQL desplegado nativo (no en contenedor) como parte del checkpoint intermedio; falta migrar a Podman y crear el rol `app_role` con los permisos acotados.
4. Desplegar Django + DRF en VM1 (pod con nginx), con las migraciones del modelo de datos de la sección 4. **⏳ Pendiente.**
5. Confirmar conectividad app↔BD por TLS. **⚠️ Parcial** — conectividad confirmada, TLS todavía no configurado.
6. Cargar el catálogo de `TipoTramite`, empezando por Permiso de Construcción Municipal. **⏳ Pendiente.**
7. Validar el flujo completo: crear trámite → cambiar estado → verificar `EventoAuditoria` → forzar vencimiento de SLA → confirmar escalamiento automático. **⏳ Pendiente.**

---

Ver `docs/runbook.md` para el detalle paso a paso de lo ya ejecutado, y `docs/informe-avance.md` para el estado actual completo y los riesgos abiertos.
