# Historial del proyecto: todo lo que se hizo

Registro completo, en orden, de lo construido en SIGET entre el 24 de septiembre y el 21 de octubre de 2026: qué se hizo, por qué, cómo se verificó y dónde está documentado. Es el mapa para encontrar cualquier detalle: cada hito apunta a la sección del [runbook](./runbook.md) (el paso a paso técnico) y al [CHANGELOG](../CHANGELOG.md) (cada cambio, con su motivo).

**El proyecto en una frase:** seguimiento trazable y seguro de los trámites del Estado panameño, donde la seguridad (Zero Trust, sin superusuario, auditoría inalterable) es el método para que esa trazabilidad sea confiable.

## 1. El resultado hoy

| Qué | Estado |
|---|---|
| **Plataforma web funcionando** en https://192.168.159.137:8443 | ✅ Interfaz React + API Django, TLS 1.3, segundo factor obligatorio |
| Roles | 10 roles (4 de aplicación, 5 de plataforma con control dual, 1 auditor), **sin superusuario** |
| Backend | Django 5.2 LTS + DRF: autenticación (Argon2, JWT corto, MFA TOTP), PDP (ABAC), trámites, catálogo, equipo, auditoría, transparencia, simulador |
| Base de datos | PostgreSQL 16 rootless en VM2: esquema `siget` de 12 tablas, RLS, disparadores, auditoría de solo inserción, 9 migraciones, respaldo diario con prueba de restauración |
| Interfaz | 15 pantallas por rol, sistema de diseño propio («el Canal»), claro/oscuro, accesible, responsiva |
| Pruebas | **415** del backend + **141** del frontend + **6 verificaciones contra la base real** (11, 15, 71, 51, 34 y 39 pasos) + ensayo de la demo (**59 de 59**) |
| CI en GitHub | `backend-ci` y `frontend-ci` pasan en cada push y PR |
| Documentación | Más de 25 documentos en `docs/`, runbook de 32 secciones, contrato de la API, guion y guía de acceso |

## 2. Cronología

### Fase 0 — Repositorio y checkpoint de Apache + PHP (24 sep – 6 oct)

- Dos VMs Rocky Linux 9.7 (`app-backend`, `db-server`), red interna `192.168.100.0/24`, firewall, SELinux enforcing, acceso por clave SSH. → runbook 1–7
- **Checkpoint pedido por el profesor:** primero pgAdmin (no era lo pedido), luego la aplicación real de login y gestión de usuarios en PHP + Apache contra PostgreSQL, con bcrypt, CSRF, registro y restablecimiento de contraseña, bloqueo tras 3 intentos. → runbook 8–10
- Acceso del equipo por **Tailscale** (el reenvío de puertos no funcionó en la red del aula). → runbook 10.9
- Repositorio público en GitHub, monorepo, **GitFlow**, protección de ramas, política de documentación obligatoria. → `CONTRIBUTING.md`
- **Incidente:** contraseñas reales quedaron en texto plano en la documentación; se rotaron y redactaron. → CHANGELOG, 24-sep
- Documentos de antecedentes (fuentes panameñas, APA) e introductorio.

### Fase 1 — Infraestructura y diseño (8 – 15 oct)

- **Diseño de arquitectura Zero Trust** (NIST SP 800-207): ABAC, matriz de roles y permisos, mapa de instituciones, modelo de amenazas. → `docs/superpowers/specs/2026-10-08-arquitectura-zero-trust-design.md`
- **Podman rootless + Quadlet** en las dos VMs, usuario de servicio `siget`. → runbook 12, 15
- Cuentas de Linux del equipo; **endurecimiento**: SSH solo por clave, Cockpit fuera del firewall, sudo de mínimo privilegio. → runbook 13, 14, 20
- **Roles de base de datos sin superusuario** y cierre de la brecha del checkpoint (la app ya no usa `postgres`). 24 pruebas. → runbook 17, `docs/roles-permisos-bd.md`
- **División del rol de plataforma en cinco roles** con control dual (nadie reúne todo el poder). → runbook 19
- **TLS 1.3 entre la aplicación y la base** con verificación del certificado. → runbook 18
- Respaldo de la base antes de migrar. → runbook 16
- Matriz de cobertura de los 7 principios de Zero Trust. → `docs/zero-trust-cobertura.md`

### Fase 2 — Contenedores y backend (20 oct)

- **PostgreSQL en contenedor rootless** con Quadlet, TLS y sin contraseña de superusuario; la base nativa se apagó. → runbook 21
- **Corrección de la hora de las VMs** (iban 1 h 45 min atrasadas aunque decían estar sincronizadas): la auditoría y los plazos dependen de ella. → runbook 22
- **Esqueleto de Django y motor de decisión (PDP)**: deniega por defecto y ante fallos (*fail closed*), 84 pruebas, 6 mutaciones detectadas. → `docs/superpowers/specs/2026-10-20-motor-abac-design.md`
- **Modelos, contexto RLS por transacción y verificación contra la base real**. → runbook 23
- **nginx con TLS 1.3** como única puerta de entrada, backend como pod permanente, cabeceras de seguridad y límite de tasa. → runbook 24
- **Autenticación completa:** Argon2, JWT de 10 minutos, refresco de un solo uso con detección de reuso, TOTP con el secreto cifrado, reautenticación escalonada, bloqueo, eventos de seguridad inalterables. 47 pasos contra la base real. → runbook 25
- **API de trámites y catálogo** con PDP, RLS y auditoría en la misma transacción. 51 pasos contra la base real. → runbook 26

### Fase 3 — Plataforma utilizable (21 oct)

- **Interfaz web React** con menú por rol, equipo, cuentas de demostración (una por rol) y trámites de ejemplo creados por la propia API. Hallazgo corregido: la coordinadora veía trámites por una RLS demasiado amplia. → runbook 27
- **Consola de auditoría** que lee con **su propio rol de base de datos de solo lectura**; cada consulta del auditor queda registrada («quién audita al auditor»). → runbook 28
- **División en backend y frontend** con el contrato de la API como frontera, hojas de ruta y CI por carpeta. → `docs/organizacion-backend-frontend.md`, `docs/api.md`
- **Rediseño de la interfaz «el Canal»:** sistema de diseño propio, recorrido por esclusas (el estado del trámite hecho imagen), tablero, credencial de seguridad, claro/oscuro, accesibilidad. → runbook 29
- **Pruebas automáticas del frontend** (Vitest, Testing Library, axe, ESLint; 9 mutaciones detectadas) y **transparencia**: matriz de permisos calculada por el propio PDP, privilegios reales de PostgreSQL, módulo de segundo factor con prueba en vivo. → runbook 30
- **Simulador de «qué pasaría si…»**: evalúa una situación con el PDP real y muestra veredicto, traza regla por regla y qué lo cambiaría; no registra decisiones. → runbook 31
- **Ensayo de la demostración** (55 de 55), ventana del segundo factor controlada desde el servidor, respaldo verificado y guion corregido. → runbook 32

### Fase 4 — Demostración y endurecimiento (22 oct)

- **Matriz módulo × rol** (15 módulos por 10 roles) calculada por el servidor, **revisión de seguridad** con evidencia en vivo (13 hallazgos, sin críticos) y **estado de la base de datos**. → `docs/revision-seguridad-2026-10-22.md`, `docs/estado-base-de-datos.md`
- **Cierre por inactividad** (aviso a los 9 min, cierre a los 10), tope absoluto de 8 h por sesión y límites de tasa compartidos entre procesos. → runbook 33.1
- **Acceso en dos pasos**, **registro con datos personales** (cédula cifrada, tabla `perfil`) y **bloqueo progresivo** (5, 15 y 60 min). → runbook 33.2 y 33.3
- **Respaldos automáticos con prueba de restauración**, SSH endurecido, logs de conexión de PostgreSQL y mínimo privilegio para `pgadmin_lectura`. → runbook 33.4 y 33.5

## 3. Decisiones importantes y por qué

| Decisión | Motivo |
|---|---|
| **Sin superusuario en la operación**; 5 roles de plataforma con control dual y ningún rol llamado «administrador» | Zero Trust: nadie reúne todos los poderes. Lo comprueba una prueba que falla si algún rol puede las 18 acciones |
| **Dos barreras independientes** (PDP en Django y RLS en PostgreSQL) | Si la aplicación falla o se vulnera, la base sigue negando |
| **ABAC con denegar por defecto y *fail closed*** | Ante cualquier error o regla ausente, se niega |
| **Auditoría inalterable escrita por la base en la misma transacción** | No se puede cambiar un estado sin dejar rastro ni borrar el rastro |
| **La consola de auditoría lee con un rol de base propio de solo lectura** | Aunque el backend se comprometiera, esa vía no puede escribir |
| **Lo ajeno no existe (404)**, no «prohibido» | No revela qué existe |
| **Token de acceso en memoria; refresco en cookie HttpOnly de un solo uso** | Un token robado deja de servir en minutos; su reuso revoca la sesión |
| **Sin estilos ni scripts en línea** (CSP `default-src 'self'`) | Por eso la interfaz usa CSS propio y no Tailwind/shadcn (que inyectan estilos) |
| **Matriz y simulador calculados por el PDP real** | La documentación en pantalla no puede mentir ni desactualizarse |
| **Frontend y backend como dos frentes con contrato** | Cada uno avanza y se verifica por separado |
| **Cuentas de demostración y respaldos fuera del repositorio** | Evitar repetir el incidente de contraseñas en git |

## 4. Incidentes y lecciones

| Qué pasó | Lección |
|---|---|
| Contraseñas en texto plano en la documentación (24-sep) | Redactar antes de documentar; verificar también dentro de los `.docx` |
| Reinstalación de las VMs por falta de sudo (7) | Verificar la pertenencia a `wheel` al instalar |
| La migración 003 dejó el login del checkpoint sin base unos minutos | Al quitar un permiso a `PUBLIC`, conceder antes a quienes lo usan y **probar con un login real** |
| Relojes de las VMs 1 h 45 min atrasados | Verificar contra referencias externas; la auditoría y los plazos dependen de la hora |
| Dígito Unicode en el código MFA provocaba un 500 | Validar con `isascii()`; las entradas de seguridad se prueban con casos hostiles |
| La coordinadora veía trámites (RLS demasiado amplia) | Verificar **cada rol** de punta a punta, no solo el caso feliz |
| Un `rol` enviado como lista provocaba un 500 en el simulador | Comprobar el tipo antes de usar un valor como clave |
| El «15 minutos» estaba escrito a mano en la interfaz | Una sola fuente de verdad: el servidor |
| El guion prometía un cuadro de reautenticación que no aparece tras iniciar sesión | Ensayar con datos reales antes de presentar |
| No había respaldos automáticos de la base viva | Respaldar antes de cada cambio y automatizar (pendiente) |
| Una prueba débil dejó vivir una mutación | Una prueba debe mirar algo que **realmente aparezca** en ese estado |

## 5. Dónde está cada cosa

| Quiero… | Documento |
|---|---|
| **Abrir la plataforma** | [`como-abrir-la-plataforma.md`](./como-abrir-la-plataforma.md) |
| Presentarla al profesor | [`demo-guion.md`](./demo-guion.md) |
| El paso a paso técnico de todo (32 secciones) | [`runbook.md`](./runbook.md) |
| Qué cambió y por qué, cambio a cambio | [`../CHANGELOG.md`](../CHANGELOG.md) |
| Las rutas, formatos y errores de la API | [`api.md`](./api.md) |
| Cómo se organiza el equipo en backend y frontend | [`organizacion-backend-frontend.md`](./organizacion-backend-frontend.md) |
| La estructura de la plataforma | [`estructura-plataforma.md`](./estructura-plataforma.md) |
| Los módulos y los roles | [`modulos.md`](./modulos.md), [`roles-permisos-bd.md`](./roles-permisos-bd.md) |
| Cómo se cubre Zero Trust | [`zero-trust-cobertura.md`](./zero-trust-cobertura.md) |
| Los diseños | [`superpowers/specs/`](./superpowers/specs/) |

## 6. Qué falta

**Backend:** consolas de los operadores de plataforma con control dual real, plazos en días hábiles con escalamiento automático, documentos adjuntos y notificaciones, recuperación de contraseña, rotación de claves JWT y Fernet, reemisión de la CA con `keyUsage`, exportación firmada de la auditoría, **respaldos automáticos con restauración probada**.

**Frontend:** pruebas de recorrido completo (Playwright), revisión de contraste con herramienta, ilustraciones de estados vacíos, internacionalización.

**Abrir a internet (aplazado el 21-oct):** análisis hecho y decisiones pendientes en [`abrir-a-internet.md`](./abrir-a-internet.md) (Tailscale Funnel recomendado; antes hay que leer la IP real del cliente en nginx, cerrar o proteger el registro y rotar las cuentas de demostración).

**Proyecto:** retirar el checkpoint PHP (semana 6), apagar el PostgreSQL nativo y cerrar el puerto 5432, aplicar las actualizaciones pendientes de las VMs y reiniciarlas, repartir el equipo en los cuatro frentes, cargar las llaves SSH de los compañeros, decidir si el segundo factor de la ciudadanía es obligatorio, fusionar el PR 6 (`develop → main`) y regenerar los entregables `.docx`.
