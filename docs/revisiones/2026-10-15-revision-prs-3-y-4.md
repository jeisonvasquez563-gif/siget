# Revisión de los PRs 3 y 4 y auditoría de VM1/VM2

Fecha: 15 de octubre de 2026. Revisados los PRs abiertos por Andy Martínez (`Axdyrrr`) y contrastados con el estado real de las VMs. Ambos PRs apuntan a `develop`, son mergeables y están pendientes de revisión (la protección de rama exige 1 aprobación).

## PR 3: Podman rootless + primera unidad Quadlet (`feature/podman-quadlet`)

**Veredicto: aprobar.** Cambios: `docs/runbook.md` (sección 12), `infra/podman/plan-podman-quadlet.md`, `infra/podman/vm1-app-backend/siget-prueba.container` y `CHANGELOG.md`.

Verificado en VM1 el 15-oct:

| Afirmación del PR | Resultado |
|---|---|
| Podman 5.8.2 instalado | Confirmado (`rpm` y `dnf history`, 10-oct 15:51, 24 paquetes) |
| SELinux en Enforcing, sin denegaciones | Confirmado (sin AVC en la última semana) |
| Rango `subuid/subgid` de 65536 | Confirmado (`296608:65536`) |
| La unidad Quadlet versionada es la desplegada | Confirmado (idéntica) |
| Apache y la app del checkpoint siguen funcionando | Confirmado (`httpd` y `php-fpm` activos, login responde 200) |
| Sin cambios de sistema no documentados | Confirmado (solo usuarios, subuid, sudoers y políticas de SELinux) |
| VM2 sin tocar | Confirmado (sin Podman, sin sudo para Andy) |

Matices para el autor:
- El runbook dice que `siget-prueba` "sigue corriendo", pero no es así: con `Linger=no` el contenedor se detiene al cerrar la última sesión de Andy. Conviene reformular o resolver el linger.
- La instalación actualizó `selinux-policy` y `selinux-policy-targeted`. Está documentado; es un cambio de seguridad que el equipo debe conocer.
- El plan describe `sudo` como "no disponible" para Andy; ya no es así (ver [`acceso-equipo.md`](../acceso-equipo.md)).
- Probable conflicto menor en `CHANGELOG.md` con `develop`.

## PR 4: diseño Zero Trust en spec y plan (`docs/zero-trust-spec-plan`)

**Veredicto: aprobar con dos comentarios.** Cambios: `docs/architecture/spec.md`, `docs/architecture/plan.md` y `CHANGELOG.md`.

El contenido es fiel al diseño aprobado ([`2026-10-08-arquitectura-zero-trust-design.md`](../superpowers/specs/2026-10-08-arquitectura-zero-trust-design.md)): ABAC con membresías, capas, matriz de 6 roles, flujo de decisión, STRIDE, mapa de 6 instituciones, RLS y la regla de `REVOKE UPDATE, DELETE` sobre la auditoría. El plan agrega el motor ABAC como siguiente especificación.

Comentarios para dejar en el PR:

1. **Asignaciones a Jeison:** el plan escribe "la lleva Jeison" y "a cargo de Jeison" para migrar PostgreSQL a contenedor. Confirmar con Jeison o quitar esas frases.
2. **Referencias NIST:** los DOI de NIST SP 800-162 y SP 800-207 no se verificaron en línea; abrirlos antes de la entrega.

## Auditoría de las VMs

Resultado frente a los estándares del proyecto:

| Control | VM1 | VM2 |
|---|---|---|
| SELinux Enforcing | Sí | Sí |
| Acceso SSH solo por clave | Corregido el 15-oct | Corregido el 15-oct |
| `root` sin SSH por contraseña | Sí (`prohibit-password`) | Sí |
| Firewall restrictivo | `http ssh` | `ssh` + 5432 solo desde 192.168.100.10 |
| Cuentas del equipo sin contraseña | Sí | Sí |
| Sudo limitado | Jeison y Andy | Solo Jeison |
| Secretos en home de Andy | Ninguno | Ninguno |
| Intentos SSH fallidos desde el 10-oct | 0 | 0 |

Detalle de lo corregido: [`endurecimiento-vms.md`](../endurecimiento-vms.md).

**Limitaciones de la auditoría:** el journal no conservó el registro de los `sudo` de Andy, así que su instalación se verificó por `dnf history` y `rpm`. El conteo de claves por usuario falló por permisos y no se usa.

## Pendientes abiertos

| Pendiente | Responsable | Nota |
|---|---|---|
| Aprobar y mergear PR 3 y PR 4 | Jeison | Resolver el conflicto de `CHANGELOG.md` |
| Cargar claves públicas de 7 compañeros | Jeison, luego se cargan en las VMs | Sin clave no pueden entrar (ya no hay contraseña por SSH) |
| Bind de PostgreSQL solo a IP interna | Migración a contenedor | Hoy escucha en `0.0.0.0:5432`, contenido por el firewall |
| Usuario que corre los contenedores y su linger | Decisión de Jeison | Planteado en el plan de Podman |
| Puertos 80/443 en VM1 | Decisión de Jeison | Apache los ocupa; tocar la app PHP requiere aprobación |
| Podman en VM2 | Andy, con sudo en VM2 si Jeison lo autoriza | Hoy Andy no tiene sudo allí |
| Especificación y plan propios del motor ABAC | Equipo | Siguiente entrega de diseño |
| ~~Verificar los DOI de NIST~~ | Hecho el 15-oct | Ambos DOI resuelven a NIST; títulos, autores y años coinciden con las referencias |
