# Documentación — SIGET

La documentación "viva" del proyecto vive acá en Markdown, versionada junto con el código. Los `.docx` se mantienen aparte solo como formato de entrega formal (para el profesor o para imprimir): si hay alguna diferencia entre un `.docx` y su equivalente `.md`, **el `.md` es la fuente de verdad** porque es el que se sigue actualizando.

> **¿Primera vez aquí?** Empieza por [`como-abrir-la-plataforma.md`](./como-abrir-la-plataforma.md) para abrir y probar la plataforma, y por [`historial-del-proyecto.md`](./historial-del-proyecto.md) para ver todo lo que se hizo.

## 1. Para usar y presentar la plataforma

| Documento | Contenido |
|---|---|
| [`como-abrir-la-plataforma.md`](./como-abrir-la-plataforma.md) | **Cómo abrir SIGET:** encender las VMs, instalar la CA, direcciones, iniciar sesión con cada rol, crear una cuenta con segundo factor, qué hacer si algo no abre, ver la interfaz sin las VMs y publicar una versión nueva |
| [`demo-guion.md`](./demo-guion.md) | Guion de la presentación al profesor: lista de verificación del día, recorrido de 12 pasos, cómo mostrar la reautenticación escalonada, preguntas probables y plan B |
| [`historial-del-proyecto.md`](./historial-del-proyecto.md) | **Todo lo que se hizo**, en orden, con decisiones, incidentes, lecciones y lo que falta |

## 2. Cómo está hecho (arquitectura y diseño)

| Documento | Contenido |
|---|---|
| [`estructura-plataforma.md`](./estructura-plataforma.md) | Cómo está organizada la plataforma: piezas, qué pasa en cada petición, qué existe hoy, carpetas del repositorio |
| [`modulos.md`](./modulos.md) | Módulos de base de datos, infraestructura, backend y frontend con su estado, y qué módulos ve cada rol |
| [`roles-permisos-bd.md`](./roles-permisos-bd.md) | Roles, permisos y módulos a nivel de base de datos: roles de PostgreSQL, 10 roles de aplicación, RLS y pruebas |
| [`zero-trust-cobertura.md`](./zero-trust-cobertura.md) | Matriz de cobertura de los 7 principios de Zero Trust (NIST SP 800-207): qué está implementado, tareas ZT-1 a ZT-10 y límites declarados |
| [`api.md`](./api.md) | **Contrato de la API**: rutas, formatos, errores y reglas para cambiarlo; es la frontera entre backend y frontend |
| [`superpowers/specs/2026-10-08-arquitectura-zero-trust-design.md`](./superpowers/specs/2026-10-08-arquitectura-zero-trust-design.md) | Diseño de arquitectura Zero Trust: identidad y atributos (ABAC), capas, matriz de roles y permisos, mapa de instituciones y modelo de amenazas. Versión de entrega: `SIGET_Arquitectura_Zero_Trust.docx` |
| [`superpowers/specs/2026-10-20-motor-abac-design.md`](./superpowers/specs/2026-10-20-motor-abac-design.md) | Diseño del motor de control de acceso (PDP): atributos, orden de evaluación, reglas por rol, integración con DRF y la base |
| [`superpowers/specs/2026-10-20-autenticacion-design.md`](./superpowers/specs/2026-10-20-autenticacion-design.md) | Diseño de la autenticación: contraseñas, sesión, MFA, bloqueo, endpoints y verificación |
| [`architecture/spec.md`](./architecture/spec.md) | Especificación técnica: problemática, infraestructura, stack y modelo de datos (la base de todas las decisiones) |

## 3. Cómo se trabaja y qué sigue

| Documento | Contenido |
|---|---|
| [`organizacion-backend-frontend.md`](./organizacion-backend-frontend.md) | Los dos frentes (backend sólido y seguro; frontend detallado y hermoso), definición de «terminado», hojas de ruta y reparto del equipo |
| [`architecture/plan.md`](./architecture/plan.md) | Plan de trabajo con el **estado actual** y los próximos pasos |
| [`architecture/plan-semanas-1-2.md`](./architecture/plan-semanas-1-2.md) | Plan operativo de las semanas 1 y 2: tareas, responsables, camino crítico y riesgos |
| [`../CONTRIBUTING.md`](../CONTRIBUTING.md) | Ramas (GitFlow), commits, documentación obligatoria y seguridad |
| [`../CHANGELOG.md`](../CHANGELOG.md) | Cada cambio significativo, con su motivo |

## 4. Operación e infraestructura

| Documento | Contenido |
|---|---|
| [`runbook.md`](./runbook.md) | **Paso a paso técnico de todo lo ejecutado** (32 secciones): VMs, red, SSH, firewall, checkpoint PHP, Podman, roles de base de datos, TLS, PostgreSQL y backend en contenedor, nginx, autenticación, API, interfaz, auditoría, pruebas, simulador y ensayo |
| [`acceso-equipo.md`](./acceso-equipo.md) | Cuentas de Linux del equipo en las VMs, cómo cargar claves SSH y reglas de acceso |
| [`endurecimiento-vms.md`](./endurecimiento-vms.md) | Desvíos de seguridad hallados en la auditoría de las VMs, cambios aplicados y reversión |
| [`revisiones/2026-10-15-revision-prs-3-y-4.md`](./revisiones/2026-10-15-revision-prs-3-y-4.md) | Revisión de los PRs de Podman y Zero Trust contra el estado real de las VMs |
| [`../infra/podman/vm1-app-backend/README.md`](../infra/podman/vm1-app-backend/README.md) · [`../infra/podman/vm2-db-server/README.md`](../infra/podman/vm2-db-server/README.md) | Unidades Quadlet, secretos y reinicio ordenado de cada VM |
| [`../database/migraciones/README.md`](../database/migraciones/README.md) | Migraciones 002–007 de la base de datos |
| [`../demo/README.md`](../demo/README.md) | Herramientas de la demostración: ensayo automático, generador de códigos TOTP y capturas |
| [`../backend/README.md`](../backend/README.md) · [`../frontend/README.md`](../frontend/README.md) | Estado, estructura, configuración y pruebas de cada frente |

## 5. Contexto del proyecto y entregables formales

| Documento | Contenido |
|---|---|
| [`informe-avance.md`](./informe-avance.md) | Resumen ejecutivo: qué se hizo, decisiones, estado, pendientes y riesgos (con la actualización al 21 de octubre) |
| [`documento-introductorio.md`](./documento-introductorio.md) | Documento introductorio del proyecto |
| [`antecedentes.md`](./antecedentes.md) · [`datos-clave-investigacion.md`](./datos-clave-investigacion.md) | Antecedentes (trámites en Panamá, marco normativo, brechas) y datos clave de la investigación |
| [`demo-comandos.md`](./demo-comandos.md) | Guion de comandos del checkpoint inicial (túnel SSH, verificación de infraestructura, pgAdmin) |
| [`capturas-evidencia.md`](./capturas-evidencia.md) | Comandos para que cada integrante tome su captura de la configuración |
| `Runbook_SIGET.docx` · `Informe_Avance_SIGET.docx` · `SIGET_Documento_Introductorio.docx` · `Antecedentes_SIGET.docx` · `SIGET_Arquitectura_Zero_Trust.docx` | Versiones formales en Word para entrega |
| `Comandos_Demo_SIGET.txt` | Versión en texto plano del guion de comandos del checkpoint (previa a la conversión a Markdown) |

## Convenciones

- **Nada de credenciales en la documentación.** Las cuentas de demostración y los respaldos viven fuera del repositorio.
- Todo cambio actualiza el `CHANGELOG.md` y, si toca infraestructura o la base, el runbook (regla de siempre).
- Los números que aparecen (pruebas, pasos de verificación) se actualizan cuando cambian; el runbook conserva la fecha de cada medición.
