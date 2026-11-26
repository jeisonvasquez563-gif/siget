# Módulos de SIGET: qué hay hoy y qué se construye

Respuesta corta para el profesor: **están implementados y probados los módulos de datos, de seguridad de la infraestructura, del backend y del frontend que forman el flujo completo de un trámite, la autenticación con segundo factor, la auditoría y la transparencia de roles y permisos.** Las consolas de los operadores de plataforma, los plazos con escalamiento automático, los documentos adjuntos y los derechos sobre los datos personales ya están construidos y en producción; lo único que falta son las notificaciones. Esta página da los números exactos (actualizada el 24 de noviembre de 2026; antes estaba al 21 de octubre).

## 1. Resumen

| Capa | Módulos | Implementados hoy | Planificados |
|---|---|---|---|
| Base de datos | 13 tablas del diseño | **12** (aplicadas y probadas) | 1 (notificaciones) |
| Seguridad de infraestructura | 6 | **6** | 0 |
| Backend (Django) | 8 | **7 completos** | 1 (notificaciones; los documentos adjuntos ya están) |
| Frontend (React) | 16 módulos | **16 completos** (incluidas las cinco consolas de plataforma y «Mis datos») | 0 |

## 2. Módulos de base de datos

Esquema `siget`, con 16 migraciones (002–017), seguridad por filas (RLS), disparadores y las verificaciones contra la base real. Además de las 12 tablas del diseño existen `perfil`, `restablecimiento`, `rotacion_secreto`, `feriado`, `invitacion` y `solicitud_derecho`, que sirven a las consolas, los plazos, el registro por invitación y los derechos sobre los datos. Detalle en [`roles-permisos-bd.md`](./roles-permisos-bd.md).

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
| 12 | Documentos adjuntos (cifrados, PT-8) | `documento` | ✅ migración 015 |
| 13 | Notificaciones | `notificacion` | ⏳ por modelar |

## 3. Seguridad de la infraestructura

| # | Módulo | Estado |
|---|---|---|
| 1 | Aislamiento de red (red interna, firewall, SELinux) | ✅ |
| 2 | Acceso del equipo (Tailscale, SSH solo por clave) | ✅ |
| 3 | Roles de base de datos sin superusuario y RLS | ✅ |
| 4 | Cifrado app ↔ base de datos (TLS 1.3 con verificación del certificado) | ✅ |
| 5 | Registro del sistema (journal persistente) | ✅ |
| 6 | TLS en el borde con HSTS y CSP (nginx) | ✅ |

Además: respaldos automáticos diarios con restauración probada (PT-1), checkpoint PHP y pgAdmin web retirados y puerto 80 cerrado (PT-13, 17-nov; runbook 38) y las dos VMs en Rocky Linux 9.9.

PostgreSQL, el backend y nginx corren como contenedores Podman rootless gestionados con Quadlet; los secretos llegan como `podman secret`.

## 4. Módulos de backend (Django)

| # | Módulo (app) | Qué hace | Estado |
|---|---|---|---|
| 1 | Autenticación (`autenticacion`) | Registro, Argon2, JWT de vida corta, refresco de un solo uso, MFA TOTP, reautenticación escalonada, bloqueo, actividad de seguridad propia | ✅ runbook 25 |
| 2 | Autorización (`autorizacion`) | **PDP** (ABAC, niega por defecto, *fail closed*), módulos por rol (la matriz de permisos, el simulador y la vista de la base se retiraron en el runbook 45) | ✅ runbook 30, 31, 45 |
| 3 | Catálogo (`catalogo`) | Instituciones y tipos de trámite con su SLA | ✅ runbook 26 |
| 4 | Trámites (`tramites`) | Crear, listar, ver, cambiar de estado, reasignar e historial, con RLS y auditoría en la misma transacción | ✅ runbook 26 |
| 5 | Identidad y equipo (`identidad`) | Usuarios, membresías y el equipo de cada institución | ✅ runbook 27 |
| 6 | Auditoría (`auditoria`) | Consola de solo lectura con **su propio rol de base de datos**; registra cada consulta | ✅ runbook 28 |
| 7 | Plazos y escalamiento | Fecha límite en días hábiles con feriados y escalamiento de vencidos (systemd timer) | ✅ runbook 35 (PT-3) |
| 8 | Documentos y notificaciones | Adjuntos cifrados (✅ runbook 37, PT-8) y avisos al solicitante y a los responsables (⏳ pendiente) | ✅ / ⏳ |

Además, `nucleo` trae la prueba de salud, el contexto RLS por transacción y los comandos `verificar_*` y `sembrar_demo`.

## 5. Módulos de la interfaz (React) y quién los ve

El servidor calcula el menú de cada persona (`/auth/yo/` → `modulos`); la interfaz solo lo dibuja. **Cada petición se vuelve a autorizar**: un módulo mostrado de más no abre ningún acceso.

Diagrama: [`diagrama-roles-modulos.svg`](./diagrama-roles-modulos.svg) (generado desde la matriz del backend).

Matriz **módulo × rol** de los 10 roles (✅ lo ve · — no lo ve · ⏳ módulo anunciado, aún sin construir; hoy todos están construidos). Se genera desde `modulos_para()` y se comprueba en `test_modulos.py`. Desde el 26-nov-2026 el módulo «Roles y permisos» ya no existe (runbook 45); el diagrama SVG de arriba se generó antes y todavía lo dibuja.

| Módulo | Estado | Ciudadanía | Funcionario | Supervisor | Coordinación | Infraest. | Identid. | Catálogo | Seguridad | Secretos | Auditor | Roles |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| **Mis trámites** | ✅ | ✅ | ✅ | ✅ | ✅ | — | — | — | — | — | — | 4 |
| **Iniciar un trámite** | ✅ | ✅ | ✅ | ✅ | ✅ | — | — | — | — | — | — | 4 |
| **Mis datos** | ✅ | ✅ | ✅ | ✅ | ✅ | — | — | — | — | — | — | 4 |
| **Bandeja de la institución** | ✅ | — | ✅ | ✅ | — | — | — | — | — | — | — | 2 |
| **Supervisión** | ✅ | — | — | ✅ | — | — | — | — | — | — | — | 1 |
| **Equipo de la institución** | ✅ | — | — | ✅ | ✅ | — | — | — | — | — | — | 2 |
| **Mi seguridad** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 10 |
| **Segundo factor (MFA)** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 10 |
| **Acceso a trámites** | ✅ | — | — | — | — | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 6 |
| **Infraestructura** | ✅ | — | — | — | — | ✅ | — | — | — | — | — | 1 |
| **Identidades** | ✅ | — | — | — | — | — | ✅ | — | — | — | — | 1 |
| **Catálogo** | ✅ | — | — | — | — | — | — | ✅ | — | — | — | 1 |
| **Respuesta a incidentes** | ✅ | — | — | — | — | — | — | — | ✅ | — | — | 1 |
| **Custodia de secretos** | ✅ | — | — | — | — | — | — | — | — | ✅ | — | 1 |
| **Auditoría** | ✅ | — | — | — | — | — | — | — | — | — | ✅ | 1 |
| **Módulos que ve** | | 5 | 6 | 8 | 6 | 4 | 4 | 4 | 4 | 4 | 4 | |

Lectura rápida: un rol llega a varios módulos (el supervisor ve 8) y un módulo lo comparten varios roles (los dos de transparencia —Mi seguridad y Segundo factor— los ven los diez). Los cinco roles de plataforma comparten el mismo patrón: su consola + «Acceso a trámites» + transparencia, y ninguno ve trámites.

Los cinco roles de plataforma (infraestructura, identidades, catálogo, seguridad y custodio de secretos) tienen cada uno su consola, y ninguno ve trámites. El auditor es un sexto rol de plataforma de solo lectura.

### Tres módulos de la interfaz que se suman (26-nov-2026)

Se agregan **«Mis documentos»**, **«Indicadores»** y **«Ayuda»**. El servidor los incluye en `modulos_para()` y la interfaz los dibuja; como siempre, cada petición se vuelve a autorizar (PDP y base).

| Módulo | Qué es | Ciudadanía | Funcionario | Supervisor | Coordinación | Cuentas de plataforma (6 roles) |
|---|---|:-:|:-:|:-:|:-:|:-:|
| **Mis documentos** (sección «Mi espacio») | Todos los documentos que la persona adjuntó en sus trámites, con búsqueda por nombre o trámite, descarga y enlace al trámite. Solo lo propio: `GET /tramites/mis-documentos/` | ✅ | ✅ | ✅ | ✅ | — |
| **Indicadores** (sección «Mi institución») | Cifras agregadas de la institución: trámites por estado (gráfico de barras en SVG con las cifras como texto), vencidos, escalados, tiempo de resolución y carga por funcionario. `GET /equipo/<id>/indicadores/`, migración 022 | — | — | ✅ | ✅ | — |
| **Ayuda** (sección propia) | Preguntas frecuentes en lenguaje llano, adaptadas al rol, con buscador y acordeón accesible. Pantalla estática: no llama al servidor | ✅ | ✅ | ✅ | ✅ | ✅ |

La coordinación **no ve trámites**, pero sí los indicadores: salen de una función de la base que devuelve solo agregados (sin ids de trámites ni datos de personas) y que comprueba adentro que quien pregunta sea supervisión o coordinación vigente de esa institución. Con estos tres, el menú de la ciudadanía queda en 8 módulos, el del funcionario en 9, el de la supervisión en 12, el de la coordinación en 11 y el de cada cuenta de plataforma en 6 (valores de `modulos_para()`). La tabla de arriba es anterior a estos módulos y al catálogo de la institución: se regenera al integrar con la limpieza de «Roles y permisos».

## 6. Qué decir y qué no decir

**Se puede afirmar con evidencia:** el flujo completo de un trámite funciona de punta a punta con 13 cuentas (una por rol) en producción; hay autenticación con segundo factor obligatorio, un decisor de acceso que niega por defecto, aislamiento por institución en dos barreras, auditoría inalterable y una consola de auditoría con su propio rol de solo lectura. Todo está probado: 1044 pruebas del backend y 292 del frontend (último cambio, 24-nov), las verificaciones contra la base real y un ensayo de la demostración de **112 de 112** comprobaciones contra producción (24-nov). Además hay plazos en días hábiles con escalamiento automático, documentos adjuntos cifrados, derechos sobre los datos personales (Ley 81), las cinco consolas de plataforma con control dual, respaldos diarios con restauración probada y CI de seguridad.

**No se debe afirmar:** que están construidas las notificaciones (siguen como diseño). Tampoco que la identidad del ciudadano se verifica contra el Registro Civil (límite declarado).

**Sobre el PHP:** el checkpoint intermedio que existía antes ya **se retiró el 17 de noviembre de 2026**, junto con pgAdmin web y el puerto 80 (PT-13; runbook 38).
