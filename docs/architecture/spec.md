# Especificación técnica — SIGET

Especificación de arquitectura, stack y modelo de datos del proyecto. Para el orden de ejecución por fases, ver [`plan.md`](./plan.md). Para el estado actual verificado, ver [`../informe-avance.md`](../informe-avance.md).

> **Actualizado el 11 de octubre de 2026** para incorporar el diseño de seguridad Zero Trust (*Arquitectura Zero Trust: diseño de seguridad, roles y permisos*, Jeison Vásquez, Grupo Ciber5, octubre de 2026). El cambio principal: la autorización pasa de RBAC con grupos de Django a ABAC con Row Level Security en PostgreSQL. Ver la sección 4.

## Regla de oro del proyecto (no negociable)

Nunca eliminar archivos, funciones, tablas ni datos dentro de las VMs sin aprobación explícita de Jei, caso por caso. Todo cambio se documenta antes de ejecutarse. Si se va a hacer algo que no está ya descrito en la documentación del proyecto, se describe el plan primero y se espera confirmación. Ante cualquier duda técnica sobre Rocky Linux 9 / Podman / Django que no esté cubierta acá, se verifica contra documentación oficial actualizada antes de aplicar cambios — no se asume.

## 1. Contexto y problemática

Curso: Ciberseguridad 5, UTP. Referencia funcional inicial: Panamá Conecta (portal panameño de trámites virtuales). Nombre definitivo del proyecto: **SIGET — Sistema de Gestión y Trazabilidad**.

Problema real que resuelve el proyecto (no es un proyecto "de ciberseguridad" temáticamente, es un proyecto de gobierno construido con seguridad como método): falta de trazabilidad y transparencia en el seguimiento de trámites/solicitudes ante el Estado panameño — expedientes que quedan indefinidamente "en revisión", sin plazos exigibles ni rendición de cuentas (documentado en un análisis de La Prensa, jun 2026, y en el sistema 311/AIG).

La seguridad (SELinux, Podman rootless, autorización ABAC con Zero Trust, Row Level Security, auditoría inmutable) es el mecanismo que garantiza que la trazabilidad sea confiable, no el tema del proyecto en sí.

El objetivo es un sistema donde cada actuación sobre un trámite queda registrada de forma que nadie pueda alterarla, ni siquiera un administrador, con plazos exigibles y escalamiento automático cuando se vencen. Como SIGET integra trámites de varias instituciones, el desafío central es que **ninguna institución pueda ver ni modificar lo que pertenece a otra**, y que cada decisión de acceso se tome y se registre en cada petición.

| Público | Qué necesita | Qué se le da |
|---|---|---|
| Ciudadanos y empresas | Saber en qué etapa va su trámite, quién lo atiende y desde cuándo | Consulta de estado con acceso solo a lo propio |
| Funcionarios | Gestionar los trámites de su institución con reglas claras | Cola de trabajo y cambios de estado validados |
| Supervisores e instituciones | Plazos exigibles y detección de trámites estancados | SLA, escalamiento automático y gestión de su personal |
| Entes de control (ANTAI, Contraloría, Defensoría) | Evidencia confiable para rendir cuentas | Rol de auditor con lectura de eventos inalterables y de las decisiones de acceso |

Usuario principal: el ciudadano. Amenaza principal a controlar: la manipulación o el acceso indebido desde dentro de las instituciones.

## 2. Infraestructura

| Elemento | Decisión |
|---|---|
| Hypervisor | VMware Workstation Pro, local |
| SO (ambas VMs) | Rocky Linux 9, SELinux enforcing (nunca desactivar) |
| VM1 | `app-backend`, IP interna `192.168.100.10` |
| VM2 | `db-server`, IP interna `192.168.100.20` |
| Red | Adaptador NAT (internet/actualizaciones) + red interna VMware dedicada `192.168.100.0/24` |
| Acceso del equipo | Tailscale, tailnet dedicada al proyecto |
| Firewall VM2 | Solo aceptar TCP/5432 desde `192.168.100.10` |

## 3. Stack de software

| Capa | Decisión |
|---|---|
| Contenedores | Podman rootless, gestionado con unidades systemd (Quadlet) — no Docker, no docker-compose. nginx, Django y PostgreSQL en contenedores separados |
| Backend | Django + Django REST Framework (Python), diseño API-first |
| Hash de contraseñas | Argon2 |
| Auth API | JWT de corta duración (`djangorestframework-simplejwt`) + refresh token |
| MFA | `django-otp` (TOTP). El ciudadano lo activa al registrarse; para funcionario y supervisor se exige un segundo factor reciente (≤15 min) al cambiar estados; obligatorio para el auditor |
| Autorización | **ABAC** (NIST SP 800-162): middleware de Django como PEP y módulo de políticas como PDP. Base: membresías (institución, rol), enriquecida con reglas contextuales. Denegar por defecto y *fail closed*. Ver sección 4 |
| Base de datos | PostgreSQL 16, contenedor en VM2, bind solo a IP interna, TLS app↔BD, rol `app_role` con permisos mínimos y **Row Level Security** por institución |
| Secretos | `podman secret`, nunca `.env` plano |
| Frontend | React + Vite + Tailwind CSS + shadcn/ui (SPA) |
| CORS | Allowlist exacta al origen del frontend, nunca `*` |
| Almacenamiento de JWT en frontend | Access token en memoria (nunca localStorage); refresh token en cookie httpOnly, Secure, SameSite=Strict |
| Reverse proxy | nginx en contenedor, mismo pod que django-app en VM1, TLS termination, cabeceras HSTS/CSP/X-Frame-Options, límites de tasa. Es el único puerto expuesto |

## 4. Arquitectura de seguridad (Zero Trust)

Sigue el modelo de NIST SP 800-207 (Rose et al., 2020): no confiar por ubicación de red, verificar de forma explícita cada petición y asumir que ya hay una brecha.

### 4.1 Principios

| Principio | Cómo se aplica en SIGET |
|---|---|
| Verificar explícitamente | Identidad (contraseña Argon2 + MFA), JWT de vida corta y contexto evaluado en cada petición |
| Mínimo privilegio | Permisos por (institución, rol); el rol de aplicación en la base solo tiene los permisos necesarios |
| Asumir la brecha | Segmentación de red y de contenedores, dos barreras independientes de aislamiento de datos, auditoría inalterable |
| Denegar por defecto | Si ninguna política permite la acción, se niega; si el motor de decisión falla, se niega (*fail closed*) |
| Separación de funciones | Quien administra la plataforma no ve trámites; nadie modifica la auditoría |

### 4.2 Modelo de atributos (ABAC)

El rol es un atributo más. Esto permite que una capa de roles por institución sea la base y se enriquezca con reglas contextuales.

- **Sujeto:** `nivel_aseguramiento` (bajo, medio o alto), `mfa_verificado_en`, `membresias` (lista de institución y rol; una persona puede tener roles distintos en instituciones distintas), `estado_cuenta` (activa, bloqueada, suspendida). Roles de plataforma sin acceso a trámites: administrador de plataforma y auditor.
- **Recurso (trámite):** institución dueña, tipo de trámite, estado, solicitante, funcionario asignado, sensibilidad y si está vencido.
- **Acción:** ver, crear, cambiar estado, reasignar, escalar, consultar auditoría, administrar catálogo y administrar usuarios.
- **Entorno:** MFA reciente (por ejemplo, ≤15 minutos para cambiar estados), red de origen, hora, intentos fallidos recientes y estado de la cuenta.

**Identidad ciudadana y nivel de aseguramiento.** El ciudadano se registra con correo y contraseña (Argon2) y activa TOTP. La identidad no se verifica contra el Registro Civil: el diseño lo declara con el atributo `nivel_aseguramiento` y lo usa en las políticas (un trámite sensible puede exigir nivel medio o alto). Es el punto de integración previsto con la identidad real del Estado en una fase futura.

### 4.3 Arquitectura de capas

Cada capa asume que la anterior ya fue vulnerada.

| Capa | Componentes | Control principal |
|---|---|---|
| 1. Borde y red | nginx con TLS, HSTS y CSP; firewalld; red interna `192.168.100.0/24`; Tailscale para el equipo | Un solo puerto expuesto; la base solo acepta conexiones desde la IP de la aplicación |
| 2. Contenedores | Podman rootless con Quadlet; nginx, Django y PostgreSQL en contenedores separados; SELinux enforcing | Sin root, mínimos puertos y volúmenes por contenedor |
| 3. PEP y PDP | Middleware de Django (PEP) y módulo de políticas ABAC (PDP) | Toda petición se evalúa; se verifica JWT y MFA; la decisión se registra |
| 4. Datos | PostgreSQL con TLS; rol `app_role` mínimo; Row Level Security por institución; `EventoAuditoria` de solo inserción | Dos barreras independientes de aislamiento; auditoría inalterable |
| 5. Secretos | `podman secret` | Nada de `.env` ni contraseñas en el código o el repositorio |
| 6. Detección | Registro de decisiones del PDP, bloqueo por intentos fallidos, escalamiento de SLA con systemd timer | Visibilidad de lo ocurrido y de lo denegado |

### 4.4 Flujo de decisión por petición

1. nginx termina TLS y aplica límites de tasa.
2. El PEP extrae y valida el JWT (firma, expiración) y el estado de la cuenta.
3. El PEP arma el contexto: sujeto, recurso, acción y entorno.
4. El PDP evalúa las políticas. Si ninguna permite, deniega. Si falla, deniega.
5. Se registra la decisión (permitida o negada) con los atributos usados.
6. Si se permite, la aplicación abre la sesión de base con las instituciones autorizadas del sujeto y PostgreSQL aplica RLS.
7. El cambio de estado y su evento de auditoría se guardan en la misma transacción.

### 4.5 Matriz de roles y permisos

Todo lo que no está permitido queda denegado.

| Rol | Puede | Condiciones |
|---|---|---|
| Ciudadano | Crear trámite; ver y adjuntar documentos a sus propios trámites | Solo los suyos; MFA activo |
| Funcionario | Ver trámites de su institución; cambiar estado; pedir subsanación | Misma institución; trámite asignado a él o en su cola; MFA ≤15 min; transición válida |
| Supervisor | Lo del funcionario; reasignar; atender escalados | Solo su institución; MFA ≤15 min |
| Administrador institucional | Gestionar usuarios, membresías, tipos de trámite y SLA | Solo su institución; no cambia estados ni lee documentos |
| Administrador de plataforma | Alta de instituciones, infraestructura, catálogo base | Sin acceso a trámites ni a documentos |
| Auditor | Leer eventos de auditoría y decisiones del PDP | Solo lectura, transversal; nivel de aseguramiento alto y MFA obligatorio |

**Reglas cruzadas:**

- Un funcionario no puede cambiar el estado de un trámite que él mismo creó como ciudadano (conflicto de interés).
- Nadie se otorga permisos a sí mismo: las membresías las asigna otro rol y todo cambio queda en la auditoría.
- Los estados finales (Aprobado, Rechazado) no admiten más transiciones.

### 4.6 Modelo de amenazas (STRIDE)

| Amenaza | Ejemplo | Control |
|---|---|---|
| Suplantación | Robo de credenciales de un funcionario | Argon2, MFA, JWT de vida corta, bloqueo tras 3 intentos |
| Manipulación | Editar un evento para ocultar un retraso | Auditoría de solo inserción, trigger, misma transacción |
| Repudio | "Yo no cambié ese estado" | Cada evento guarda actor, atributos, hora y decisión del PDP |
| Fuga de información | Funcionario del MOP ve trámites del MINSA | ABAC más RLS, dos barreras independientes |
| Denegación de servicio | Ráfaga de peticiones al login | Límites de tasa en nginx y en la aplicación |
| Escalada de privilegios | Auto-asignarse un rol | Las membresías las crea otro rol, con auditoría |

### 4.7 Manejo de fallos

- Si el PDP no responde o hay un error: se deniega (*fail closed*).
- Si falla el registro de auditoría, el cambio de estado se revierte: no hay acción sin evidencia.
- Un token vencido o una cuenta bloqueada se rechazan antes de llegar al PDP.

### 4.8 Verificación

- Pruebas automáticas de la matriz: por cada fila, un caso permitido y uno denegado.
- Pruebas de aislamiento entre instituciones contra la base real, con RLS activo.
- Intento de `UPDATE` y `DELETE` sobre `EventoAuditoria`, que debe fallar.
- Demostración en vivo: un funcionario del MOP intenta abrir un trámite del MINSA, recibe la negación y queda el registro en la auditoría.

### 4.9 Límites declarados

- La identidad ciudadana no está verificada contra el Registro Civil.
- El laboratorio no tiene servidor de correo ni SIEM real.
- El PDP integrado en Django es migrable a un motor externo (OPA) en una fase futura; la interfaz se diseña para que el cambio no sea una reescritura.
- Los plazos (SLA) del catálogo son parámetros de diseño, no plazos legales.

### 4.10 Alternativas consideradas

| Enfoque | Decisión | Motivo |
|---|---|---|
| PDP dentro de Django más RLS en PostgreSQL | **Elegido** | Pocas piezas, probable en 10 semanas, defensa en profundidad real |
| PDP externo con OPA | Fase futura | Separación PEP/PDP más fiel, pero una pieza más que operar en VMs con poca memoria y un lenguaje nuevo para el equipo |
| Solo RLS como autoridad | Descartado | Las reglas contextuales (MFA reciente, nivel de aseguramiento) son incómodas en SQL y se auditan peor |

Pendiente de este diseño: una especificación propia del motor ABAC (catálogo de atributos, lenguaje de políticas, interfaz del PDP y estrategia de implementación por capas: primero membresías por institución, luego reglas contextuales). Ver [`plan.md`](./plan.md).

## 5. Modelo de datos

Entidades: `Usuario`, `Institucion`, `Membresia` (usuario, institución y rol), `TipoTramite`, `Tramite`, `EventoAuditoria` (append-only), `Documento`, `Notificacion`, más el registro de decisiones del PDP (su estructura exacta se define en la especificación del motor ABAC).

**Máquina de estados de `Tramite`:** Pendiente → En Tramitación ↔ En Subsanación → Aprobado / Rechazado. Las transiciones se validan en el backend contra una tabla de transiciones permitidas, nunca libres. Los estados finales (Aprobado, Rechazado) no admiten más transiciones.

### Garantía de trazabilidad y aislamiento a nivel de BD (crítico, no omitir)

- El rol de PostgreSQL que usa Django (`app_role`) tiene `SELECT`, `INSERT` en `evento_auditoria`, con `REVOKE UPDATE, DELETE` explícito, y solo los permisos necesarios en el resto de las tablas.
- Trigger `BEFORE UPDATE OR DELETE ON evento_auditoria` que lanza excepción incondicionalmente (defensa en profundidad sobre el REVOKE).
- El cambio de estado de `Tramite` y el `INSERT` en `EventoAuditoria` ocurren en la misma transacción atómica de Django — nunca uno sin el otro.
- **Row Level Security por institución** sobre los trámites: la aplicación abre la sesión de base con las instituciones autorizadas del sujeto y PostgreSQL filtra las filas. Es la segunda barrera, independiente del PDP.

### Escalamiento automático

Django management command corriendo por un timer de systemd (dentro del Quadlet del contenedor django-app), que reasigna a supervisor y notifica cuando se vence el `fecha_limite_sla` de un trámite.

### Catálogo de trámites y mapa de instituciones

Mismo motor genérico, sin lógica especial por tipo en el backend: agregar una institución o un trámite es insertar datos de catálogo, no escribir código.

| Institución | TipoTramite | SLA | Tipo |
|---|---|---|---|
| Alcaldía (Municipio de Panamá) | Permiso de Construcción Municipal (caso de prueba) | 15 días | Real |
| Ministerio Público / 311 | Solicitud/denuncia ciudadana | 5 días | Real |
| AMPYME | Registro empresarial simplificado | 10 días | Real |
| MINSA | Trámite de demostración | Parámetro de demostración | Demostración |
| MOP | Trámite de demostración | Parámetro de demostración | Demostración |
| MiAmbiente | Trámite de demostración | Parámetro de demostración | Demostración |

Las tres instituciones de demostración sirven para probar en vivo que un funcionario de una institución no accede a nada de otra. Los SLA son parámetros de diseño, no plazos legales.

(orden de construcción de cada uno en [`plan.md`](./plan.md))

## 6. Reglas de operación

- Documentar cada paso antes de ejecutarlo.
- No borrar nada dentro de las VMs sin aprobación explícita.
- Generar un informe/resumen de cierre por cada bloque de trabajo significativo.
- Verificar contra esta especificación antes de tomar decisiones nuevas; si algo no está cubierto acá, no asumir — preguntar o buscar documentación oficial actualizada.

## Referencias

- Hu, V. C., Ferraiolo, D., Kuhn, R., Schnitzer, A., Sandlin, K., Miller, R., & Scarfone, K. (2014). *Guide to attribute based access control (ABAC) definition and considerations* (NIST SP 800-162). https://doi.org/10.6028/NIST.SP.800-162
- Rose, S., Borchert, O., Mitchell, S., & Connelly, S. (2020). *Zero trust architecture* (NIST SP 800-207). https://doi.org/10.6028/NIST.SP.800-207
- PostgreSQL Global Development Group. (s. f.). Row security policies. En *PostgreSQL documentation*. https://www.postgresql.org/docs/16/ddl-rowsecurity.html
