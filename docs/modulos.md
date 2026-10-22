# Módulos de SIGET: qué hay hoy y qué se construye

Respuesta corta para el profesor: **están implementados y probados los módulos de datos, de seguridad de la infraestructura, del backend y del frontend que forman el flujo completo de un trámite, la autenticación con segundo factor, la auditoría y la transparencia de roles y permisos.** Lo que falta son las consolas de los operadores de plataforma, los plazos con escalamiento automático, los documentos adjuntos y las notificaciones. Esta página da los números exactos (actualizada el 21 de octubre de 2026).

## 1. Resumen

| Capa | Módulos | Implementados hoy | Planificados |
|---|---|---|---|
| Base de datos | 13 tablas del diseño | **11** (aplicadas y probadas) | 2 (documentos y notificaciones) |
| Seguridad de infraestructura | 6 | **6** | 0 |
| Backend (Django) | 8 | **6 completos** | 2 (plazos y escalamiento; documentos y notificaciones) |
| Frontend (React) | 11 módulos | **10 completos** | 1 (las consolas de plataforma, una por rol; hoy «próximamente») |

## 2. Módulos de base de datos

Esquema `siget`, con 7 migraciones (002–007), seguridad por filas (RLS), disparadores y 3 verificaciones contra la base real. Detalle en [`roles-permisos-bd.md`](./roles-permisos-bd.md).

| # | Módulo | Tabla | Estado |
|---|---|---|---|
| 1 | Instituciones | `institucion` | ✅ 6 sembradas (3 reales y 3 de demostración) |
| 2 | Identidad (atributos del sujeto) | `usuario` | ✅ con campos del segundo factor y del bloqueo |
| 3 | Permisos por institución | `membresia` | ✅ |
| 4 | Catálogo de trámites | `tipo_tramite` | ✅ 6 sembrados con su SLA |
| 5 | Trámites | `tramite` | ✅ |
| 6 | Máquina de estados | `transicion` | ✅ |
| 7 | Auditoría de solo inserción | `evento_auditoria` | ✅ |
| 8 | Decisiones del PDP | `decision_pdp` | ✅ |
| 9 | Control dual (altas sensibles con dos personas) | `aprobacion` | ✅ |
| 10 | Sesiones (refresco como huella, rotación) | `sesion` | ✅ |
| 11 | Eventos de seguridad de solo inserción | `evento_seguridad` | ✅ |
| 12 | Documentos adjuntos | `documento` | ⏳ por modelar |
| 13 | Notificaciones | `notificacion` | ⏳ por modelar |

## 3. Seguridad de la infraestructura

| # | Módulo | Estado |
|---|---|---|
| 1 | Aislamiento de red (red interna, firewall, SELinux) | ✅ |
| 2 | Acceso del equipo (Tailscale, SSH solo por clave, sudo de mínimo privilegio) | ✅ |
| 3 | Roles de base de datos sin superusuario y RLS | ✅ |
| 4 | Cifrado app ↔ base de datos (TLS 1.3 con verificación del certificado) | ✅ |
| 5 | Registro del sistema (journal persistente) y hora verificada | ✅ |
| 6 | TLS 1.3 en el borde con HSTS, CSP y límite de tasa (nginx) | ✅ |

PostgreSQL, el backend y nginx corren como contenedores Podman rootless gestionados con Quadlet; los secretos llegan como `podman secret`.

## 4. Módulos de backend (Django)

| # | Módulo (app) | Qué hace | Estado |
|---|---|---|---|
| 1 | Autenticación (`autenticacion`) | Registro, Argon2, JWT de vida corta, refresco de un solo uso, MFA TOTP, reautenticación escalonada, bloqueo, actividad de seguridad propia | ✅ runbook 25 |
| 2 | Autorización (`autorizacion`) | **PDP** (ABAC, niega por defecto, *fail closed*), módulos por rol, **matriz de permisos calculada por el PDP**, privilegios reales de la base y **simulador** | ✅ runbook 30, 31 |
| 3 | Catálogo (`catalogo`) | Instituciones y tipos de trámite con su SLA | ✅ runbook 26 |
| 4 | Trámites (`tramites`) | Crear, listar, ver, cambiar de estado, reasignar e historial, con RLS y auditoría en la misma transacción | ✅ runbook 26 |
| 5 | Identidad y equipo (`identidad`) | Usuarios, membresías y el equipo de cada institución | ✅ runbook 27 |
| 6 | Auditoría (`auditoria`) | Consola de solo lectura con **su propio rol de base de datos**; registra cada consulta | ✅ runbook 28 |
| 7 | Plazos y escalamiento | Fecha límite en días hábiles y escalamiento de vencidos (systemd timer) | ⏳ (hoy: días calendario) |
| 8 | Documentos y notificaciones | Adjuntos y avisos al solicitante y a los responsables | ⏳ |

Además, `nucleo` trae la prueba de salud, el contexto RLS por transacción y los comandos `verificar_*` y `sembrar_demo`.

## 5. Módulos de la interfaz (React) y quién los ve

El servidor calcula el menú de cada persona (`/auth/yo/` → `modulos`); la interfaz solo lo dibuja. **Cada petición se vuelve a autorizar**: un módulo mostrado de más no abre ningún acceso.

| Módulo | Qué hace | Ciudadanía | Funcionario | Supervisor | Coordinación | Plataforma | Auditor |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|
| Mis trámites | Seguimiento con el recorrido por esclusas | ✅ | ✅ | ✅ | ✅ | — | — |
| Iniciar un trámite | Institución y trámite del catálogo, con su plazo | ✅ | ✅ | ✅ | ✅ | — | — |
| Bandeja de la institución | Lista y tablero; cambio de estado con confirmación | — | ✅ | ✅ | — | — | — |
| Supervisión | Vencidos, sin asignar y reasignación | — | — | ✅ | — | — | — |
| Equipo de la institución | Personal y roles | — | — | ✅ | ✅ | — | — |
| Auditoría | Decisiones, eventos de seguridad y actuaciones | — | — | — | — | — | ✅ |
| Acceso a trámites | Demuestra en vivo que un rol de plataforma no ve trámites | — | — | — | — | ✅ | ✅ |
| Consola de su área | Infraestructura, identidades, catálogo, seguridad o secretos | — | — | — | — | ⏳ (una por rol) | — |
| Mi seguridad | Credencial, ventana del segundo factor, lo que el rol puede y no puede | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Segundo factor (MFA) | Cómo funciona, prueba en vivo con anti-repetición, actividad propia | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Roles y permisos | Roles y módulos, matriz, **simulador**, base de datos, capas de defensa | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

Los cinco roles de plataforma (infraestructura, identidades, catálogo, seguridad y custodio de secretos) tienen cada uno su consola, y ninguno ve trámites. El auditor es un sexto rol de plataforma de solo lectura.

## 6. Qué decir y qué no decir

**Se puede afirmar con evidencia:** el flujo completo de un trámite funciona de punta a punta con 13 cuentas (una por rol) en producción; hay autenticación con segundo factor obligatorio, un decisor de acceso que niega por defecto, aislamiento por institución en dos barreras, auditoría inalterable y una consola de auditoría con su propio rol de solo lectura. Todo está probado: 354 pruebas del backend, 130 del frontend, 6 verificaciones contra la base real y un ensayo de la demostración de 55 comprobaciones.

**No se debe afirmar:** que están construidos los plazos con escalamiento automático, los documentos adjuntos, las notificaciones ni las consolas de los operadores de plataforma (existen como diseño y como módulos «próximamente»). Tampoco que la identidad del ciudadano se verifica contra el Registro Civil (límite declarado).

**Sobre el PHP:** el login que existía antes es el checkpoint intermedio y no es parte del sistema final; se retira en la semana 6 (ver el [plan](./architecture/plan.md)).
