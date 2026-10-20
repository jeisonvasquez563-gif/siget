# Documentación — SIGET

La documentación "viva" del proyecto vive acá en Markdown, versionada junto con el código. Los `.docx` se mantienen aparte solo como formato de entrega formal (para compartir con el profesor o imprimir) — si hay alguna diferencia entre un `.docx` y su equivalente `.md`, **el `.md` es la fuente de verdad** porque es el que se sigue actualizando.

| Documento | Contenido |
|---|---|
| [`architecture/spec.md`](./architecture/spec.md) | Especificación técnica: problemática, infraestructura, stack, modelo de datos. La base de todas las decisiones. |
| [`architecture/plan.md`](./architecture/plan.md) | Plan de trabajo: orden de ejecución por fases, estado real de cada punto, próximos pasos. |
| [`superpowers/specs/2026-10-08-arquitectura-zero-trust-design.md`](./superpowers/specs/2026-10-08-arquitectura-zero-trust-design.md) | **Diseño de arquitectura Zero Trust**: identidad y atributos (ABAC), capas, matriz de roles y permisos, mapa de instituciones, modelo de amenazas y verificación. Versión de entrega: `SIGET_Arquitectura_Zero_Trust.docx`. |
| [`architecture/plan-semanas-1-2.md`](./architecture/plan-semanas-1-2.md) | Plan operativo de las semanas 1 y 2: decisiones previas, tareas con responsable propuesto y criterio de terminado, camino crítico y riesgos. |
| [`estructura-plataforma.md`](./estructura-plataforma.md) | Cómo está organizada la plataforma: diagrama (VM1 aplicación, VM2 base de datos), qué pasa en cada petición, qué existe hoy y qué se construye, carpetas del repo y qué decir al profesor. |
| [`superpowers/specs/2026-10-20-motor-abac-design.md`](./superpowers/specs/2026-10-20-motor-abac-design.md) | Diseño del motor de control de acceso ABAC (PDP): atributos, orden de evaluación, reglas por rol, integración con DRF y la base, decisiones y límites. |
| [`modulos.md`](./modulos.md) | Módulos de SIGET con números exactos: cuáles están implementados hoy (8 de datos, 5 de seguridad de infraestructura) y cuáles se construyen (7 de backend, 6 vistas de frontend), con semana. Qué se puede afirmar al profesor y qué no. |
| [`zero-trust-cobertura.md`](./zero-trust-cobertura.md) | Matriz de cobertura de los 7 principios de Zero Trust (NIST SP 800-207): qué está implementado, qué falta, tareas ZT-1 a ZT-10 con semana, límites y desvíos actuales. |
| [`roles-permisos-bd.md`](./roles-permisos-bd.md) | Roles, permisos y módulos a nivel de base de datos (para mostrar al profesor): qué está implementado y qué es diseño, roles de PostgreSQL, módulos, 24 pruebas y demo en vivo. Sin superusuario en la operación. |
| [`acceso-equipo.md`](./acceso-equipo.md) | Cuentas de Linux del equipo en las VMs, cómo cargar claves SSH y reglas de acceso. |
| [`endurecimiento-vms.md`](./endurecimiento-vms.md) | Desvíos de seguridad hallados en la auditoría de las VMs, cambios aplicados (SSH solo por clave, Cockpit fuera del firewall), verificación y reversión. |
| [`revisiones/2026-10-15-revision-prs-3-y-4.md`](./revisiones/2026-10-15-revision-prs-3-y-4.md) | Revisión de los PRs de Podman y Zero Trust contra el estado real de las VMs, auditoría de estándares y lista de pendientes abiertos. |
| [`runbook.md`](./runbook.md) | Paso a paso técnico completo de todo lo ejecutado: VMs, red, SSH, firewall, checkpoint de BD/Apache. |
| [`informe-avance.md`](./informe-avance.md) | Resumen ejecutivo: qué se hizo, decisiones técnicas, estado actual, pendientes y riesgos. |
| [`demo-comandos.md`](./demo-comandos.md) | Guion de comandos para hacer una demo en vivo (túnel SSH, verificación de infraestructura, app SIGET, pgAdmin). |
| [`capturas-evidencia.md`](./capturas-evidencia.md) | Comandos organizados por tema para que cada integrante del grupo tome su propia captura de la configuración (red, SELinux, firewall, servicios, BD, app). |
| `Antecedentes_SIGET.docx` | Documento de antecedentes del proyecto (entrega solicitada por el profesor): contexto de los trámites en Panamá, marco normativo, transformación digital del Estado, ciberseguridad en el sector público, brechas y justificación de SIGET, con bibliografía en formato APA de fuentes panameñas. Su versión editable es el propio `.docx`. |
| `Runbook_SIGET.docx` / `Informe_Avance_SIGET.docx` | Versiones formales en Word de los dos documentos de arriba, para entrega. |
| `Comandos_Demo_SIGET.txt` | Versión en texto plano del guion de demo (previa a la conversión a Markdown). |
