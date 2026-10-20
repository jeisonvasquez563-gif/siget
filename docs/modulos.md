# Módulos de SIGET: qué hay hoy y qué se construye

Respuesta corta para el profesor: **hoy están implementados y probados los módulos de datos y de seguridad de la infraestructura; los módulos de aplicación (backend y frontend) están diseñados y planificados, pero todavía no existe su código.** Esta página da los números exactos.

Los nombres de las apps de Django y las vistas de React son una **propuesta** que el equipo confirma al iniciar cada bloque.

## 1. Resumen

| Capa | Módulos | Implementados hoy | Planificados |
|---|---|---|---|
| Base de datos | 11 | **9** (aplicados y probados) | 2 (documentos y notificaciones) |
| Seguridad de infraestructura | 6 | **6** | 0 |
| Backend (Django) | 7 | **1 completo** (autenticación) y el PDP del módulo 2 hecho | 6 |
| Frontend (React) | 6 vistas | **0** | 6 |

## 2. Módulos de base de datos

Esquema `siget` aplicado el 15 de octubre de 2026, con 24 pruebas que pasan (`bash ~/siget-diseno/demo.sh`). Detalle en [`roles-permisos-bd.md`](./roles-permisos-bd.md).

| # | Módulo | Tabla | Estado |
|---|---|---|---|
| 1 | Instituciones | `institucion` | ✅ |
| 2 | Identidad (atributos del sujeto) | `usuario` | ✅ |
| 3 | Permisos por institución | `membresia` | ✅ |
| 4 | Catálogo de trámites | `tipo_tramite` | ✅ |
| 5 | Trámites | `tramite` | ✅ |
| 6 | Máquina de estados | `transicion` | ✅ |
| 7 | Auditoría de solo inserción | `evento_auditoria` | ✅ |
| 8 | Decisiones del PDP | `decision_pdp` | ✅ |
| 9 | Control dual (altas sensibles con dos personas) | `aprobacion` | ✅ |
| 10 | Documentos adjuntos | `documento` | ⏳ por modelar |
| 11 | Notificaciones | `notificacion` | ⏳ por modelar |

## 3. Seguridad de la infraestructura

| # | Módulo | Estado |
|---|---|---|
| 1 | Aislamiento de red (red interna, firewall, SELinux) | ✅ |
| 2 | Acceso del equipo (Tailscale, SSH solo por clave) | ✅ |
| 3 | Roles de base de datos sin superusuario y RLS | ✅ |
| 4 | Cifrado app ↔ base de datos (TLS 1.3 con verificación del certificado) | ✅ (checkpoint) |
| 5 | Registro del sistema (journal persistente) | ✅ |
| 6 | TLS en el borde con HSTS, CSP y límite de tasa (nginx) | ✅ (20-oct) |

El backend y `nginx` corren como un pod rootless (`siget`) en VM1. Contenedores Podman rootless con Quadlet: instalados en las dos VMs. **PostgreSQL ya corre en un contenedor** (20-oct, runbook 21); falta desplegar `nginx` y Django.

## 4. Módulos de backend (Django) planificados

| # | Módulo | Qué hace | Semana |
|---|---|---|---|
| 1 | Identidad y autenticación | Registro, Argon2, JWT de vida corta, MFA TOTP, bloqueo y eventos de seguridad. **Hecho el 20-oct** (runbook 25) | ✅ |
| 2 | Autorización (PEP y PDP) | Decide cada petición con atributos; deniega por defecto. **El PDP ya está hecho y probado (84 pruebas)**; falta el PEP que lo conecta a las vistas | S4–S6 |
| 3 | Instituciones y catálogo | Instituciones y tipos de trámite con su SLA; altas con control dual | S3–S5 |
| 4 | Trámites | Crear, consultar y cambiar de estado con transiciones válidas | S3–S5 |
| 5 | Auditoría y decisiones | Registra cada actuación y cada decisión del PDP | S5–S7 |
| 6 | Plazos y escalamiento | Calcula la fecha límite y escala los vencidos (systemd timer) | S5–S7 |
| 7 | Documentos y notificaciones | Adjuntos y avisos al solicitante y a los responsables | S8–S9 |

## 5. Vistas de frontend (React) planificadas

| # | Vista | Para quién | Semana |
|---|---|---|---|
| 1 | Inicio de sesión y registro | Todos | S6 |
| 2 | Mis trámites y nuevo trámite | Ciudadano | S6–S9 |
| 3 | Cola de trabajo y cambio de estado | Funcionario | S7–S9 |
| 4 | Escalados y reasignación | Supervisor | S7–S9 |
| 5 | Usuarios, membresías y catálogo de su institución | Coordinador institucional | S8–S9 |
| 6 | Auditoría y decisiones del PDP | Auditor | S8–S9 |

Los cinco roles de operación de plataforma (infraestructura, identidades, catálogo, seguridad y custodio de secretos) trabajan sobre sus funciones y ninguno tiene vista de trámites.

## 6. Qué decir y qué no decir

**Se puede afirmar con evidencia:** el modelo de datos completo de los 9 módulos centrales está aplicado y probado, con roles sin superusuario, aislamiento por institución, auditoría inalterable y cifrado de la conexión con la base.

**No se debe afirmar:** que existe el backend, el frontend o el control de acceso por atributos en funcionamiento. Existe el diseño, el esquema que lo respalda y el plan con fechas.

**Sobre el PHP:** el login que se ve hoy funcionando es el checkpoint intermedio y no es parte del sistema final; se retira en la semana 6 (ver el [plan](./architecture/plan.md)).
