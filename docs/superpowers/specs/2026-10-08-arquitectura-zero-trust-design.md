# Arquitectura Zero Trust de SIGET — Diseño de seguridad, roles y permisos

**SIGET — Sistema de Gestión y Trazabilidad** · Ciberseguridad 5 — UTP · Jeison Vásquez — Grupo Ciber5 · Octubre de 2026

> Estado: diseño aprobado por el equipo (8-oct-2026). El modelo de autorización ABAC tendrá su propia especificación y plan de implementación (ver sección 12). Este documento es la fuente de verdad; el `.docx` se genera a partir de él.

## 1. Qué deseo hacer y a quién deseo llegar

### 1.1 ¿Qué deseo hacer?

Construir un sistema donde **cada actuación sobre un trámite ante el Estado queda registrada de forma que nadie pueda alterarla, ni siquiera un administrador**, con plazos exigibles y escalamiento automático cuando se vencen. La seguridad no es un adorno: es el mecanismo que hace confiable la trazabilidad. Como SIGET integra trámites de varias instituciones, el desafío central es que **ninguna institución pueda ver ni modificar lo que pertenece a otra**, y que cada decisión de acceso se tome y se registre en cada petición (Zero Trust).

### 1.2 ¿A quién deseo llegar?

| Público | Qué necesita | Qué le damos |
|---|---|---|
| Ciudadanos y empresas | Saber en qué etapa va su trámite, quién lo atiende y desde cuándo | Consulta de estado con acceso solo a lo propio |
| Funcionarios | Gestionar los trámites de su institución con reglas claras | Cola de trabajo y cambios de estado validados |
| Supervisores e instituciones | Plazos exigibles y detección de trámites estancados | SLA, escalamiento automático y gestión de su personal |
| Entes de control (ANTAI, Contraloría, Defensoría) | Evidencia confiable para rendir cuentas | Rol de auditor con lectura de eventos inalterables y de las decisiones de acceso |

Usuario principal: el **ciudadano** (a quién deseamos llegar). Amenaza principal a controlar: la **manipulación o el acceso indebido desde dentro de las instituciones**. Esto diferencia a SIGET de las plataformas de consulta existentes (ver [`antecedentes.md`](../../antecedentes.md)).

## 2. Qué significa Zero Trust en SIGET

Se sigue el modelo de NIST SP 800-207 (Rose et al., 2020): nunca confiar por ubicación de red, verificar de forma explícita cada petición y asumir que ya hay una brecha.

| Principio | Cómo se aplica en SIGET |
|---|---|
| Verificar explícitamente | Identidad (contraseña Argon2 + MFA), token JWT de vida corta y contexto evaluado en **cada** petición |
| Mínimo privilegio | Permisos por `(institución, rol)`; el rol de aplicación en la base solo tiene los permisos necesarios |
| Asumir la brecha | Segmentación de red y de contenedores, dos barreras independientes de aislamiento de datos, auditoría inalterable |
| Denegar por defecto | Si ninguna política permite la acción, se niega; si el motor de decisión falla, se niega (*fail closed*) |
| Separación de funciones | Quien administra la plataforma no ve trámites; nadie modifica la auditoría |

## 3. Modelo de identidad y atributos

La autorización es **ABAC** (control de acceso basado en atributos, NIST SP 800-162, Hu et al., 2014). El rol es un atributo más; esto permite que una capa de roles por institución sea la base y se enriquezca con reglas contextuales.

### 3.1 Sujeto (quién actúa)

- `nivel_aseguramiento`: bajo, medio o alto. Refleja cuánta confianza hay en la identidad (ver 3.5).
- `mfa_verificado_en`: momento del último segundo factor.
- `membresías`: lista de `(institución, rol)`. Una persona puede tener roles distintos en instituciones distintas.
- `estado_cuenta`: activa, bloqueada, suspendida.
- Roles de plataforma (sin acceso a trámites): administrador de plataforma y auditor.

### 3.2 Recurso (sobre qué actúa)

Trámite: `institución_dueña`, `tipo_trámite`, `estado`, `solicitante`, `funcionario_asignado`, `sensibilidad` y `vencido`.

### 3.3 Acción

Ver, crear, cambiar estado, reasignar, escalar, consultar auditoría, administrar catálogo y administrar usuarios.

### 3.4 Entorno (en qué contexto)

MFA reciente (por ejemplo, ≤15 minutos para cambiar estados), red de origen, hora, intentos fallidos recientes y estado de la cuenta.

### 3.5 Identidad ciudadana y nivel de aseguramiento

El ciudadano se registra con correo y contraseña (Argon2) y activa TOTP. **La identidad no se verifica contra el Registro Civil**: el diseño lo declara con el atributo `nivel_aseguramiento` y lo usa en las políticas (un trámite sensible puede exigir nivel medio o alto). Es el punto de integración previsto con la identidad real del Estado en una fase futura.

## 4. Arquitectura de capas

Cada capa asume que la anterior ya fue vulnerada.

| Capa | Componentes | Control principal |
|---|---|---|
| 1. Borde y red | nginx con TLS, HSTS y CSP; firewalld; red interna 192.168.100.0/24; Tailscale para el equipo | Un solo puerto expuesto; la base solo acepta conexiones desde la IP de la aplicación |
| 2. Contenedores | Podman rootless gestionado con Quadlet; nginx, Django y PostgreSQL en contenedores separados; SELinux enforcing | Sin root, mínimos puertos y volúmenes por contenedor |
| 3. PEP y PDP | Middleware de Django (PEP) y módulo de políticas ABAC (PDP) | Toda petición se evalúa; se verifica JWT y MFA; la decisión se registra |
| 4. Datos | PostgreSQL con TLS; rol `app_role` mínimo; Row Level Security por institución; `EventoAuditoria` de solo inserción | Dos barreras independientes de aislamiento; auditoría inalterable |
| 5. Secretos | `podman secret` | Nada de `.env` ni contraseñas en el código o el repositorio |
| 6. Detección | Registro de decisiones del PDP, bloqueo por intentos fallidos, escalamiento de SLA con systemd timer | Visibilidad de lo ocurrido y de lo denegado |

### 4.1 Flujo de decisión por petición

1. nginx termina TLS y aplica límites de tasa.
2. El PEP extrae y valida el JWT (firma, expiración) y el estado de la cuenta.
3. El PEP arma el contexto: sujeto, recurso, acción y entorno.
4. El PDP evalúa las políticas. Si ninguna permite, deniega. Si falla, deniega.
5. Se registra la decisión (permitida o negada) con los atributos usados.
6. Si se permite, la aplicación abre la sesión de base con las instituciones autorizadas del sujeto y PostgreSQL aplica RLS.
7. El cambio de estado y su evento de auditoría se guardan en la misma transacción.

## 5. Matriz de roles y permisos

Todo lo que no está permitido queda denegado.

| Rol | Puede | Condiciones |
|---|---|---|
| Ciudadano | Crear trámite; ver y adjuntar documentos a sus propios trámites | Solo los suyos; MFA activo |
| Funcionario | Ver trámites de su institución; cambiar estado; pedir subsanación | Misma institución; trámite asignado a él o en su cola; MFA ≤15 min; transición válida |
| Supervisor | Lo del funcionario; reasignar; atender escalados | Solo su institución; MFA ≤15 min |
| Administrador institucional | Gestionar usuarios, membresías, tipos de trámite y SLA | Solo su institución; no cambia estados ni lee documentos |
| Administrador de plataforma | Alta de instituciones, infraestructura, catálogo base | Sin acceso a trámites ni a documentos |
| Auditor | Leer eventos de auditoría y decisiones del PDP | Solo lectura, transversal; nivel de aseguramiento alto y MFA obligatorio |

### 5.1 Reglas cruzadas

- Un funcionario no puede cambiar el estado de un trámite que él mismo creó como ciudadano (conflicto de interés).
- Nadie se otorga permisos a sí mismo: las membresías las asigna otro rol y todo cambio queda en la auditoría.
- Los estados finales (Aprobado, Rechazado) no admiten más transiciones.

## 6. Mapa de instituciones

El motor es genérico: agregar una institución o un trámite es insertar datos de catálogo, no escribir código.

| Institución | Trámite | Tipo |
|---|---|---|
| Alcaldía (Municipio de Panamá) | Permiso de Construcción Municipal (caso de prueba) | Real |
| Ministerio Público / 311 | Solicitud o denuncia ciudadana | Real |
| AMPYME | Registro empresarial simplificado | Real |
| MINSA | Trámite de demostración | Demostración |
| MOP | Trámite de demostración | Demostración |
| MiAmbiente | Trámite de demostración | Demostración |

Las tres de demostración sirven para probar en vivo que un funcionario de una institución no accede a nada de otra.

## 7. Modelo de amenazas (STRIDE)

| Amenaza | Ejemplo | Control |
|---|---|---|
| Suplantación | Robo de credenciales de un funcionario | Argon2, MFA, JWT de vida corta, bloqueo tras 3 intentos |
| Manipulación | Editar un evento para ocultar un retraso | Auditoría de solo inserción, trigger, misma transacción |
| Repudio | "Yo no cambié ese estado" | Cada evento guarda actor, atributos, hora y decisión del PDP |
| Fuga de información | Funcionario del MOP ve trámites del MINSA | ABAC más RLS, dos barreras independientes |
| Denegación de servicio | Ráfaga de peticiones al login | Límites de tasa en nginx y en la aplicación |
| Escalada de privilegios | Auto-asignarse un rol | Las membresías las crea otro rol, con auditoría |

## 8. Manejo de fallos

- Si el PDP no responde o hay un error: **se deniega** (fail closed).
- Si falla el registro de auditoría, el cambio de estado se revierte: no hay acción sin evidencia.
- Un token vencido o una cuenta bloqueada se rechazan antes de llegar al PDP.

## 9. Verificación

- Pruebas automáticas de la matriz: por cada fila, un caso permitido y uno denegado.
- Pruebas de aislamiento entre instituciones contra la base real, con RLS activo.
- Intento de UPDATE y DELETE sobre `EventoAuditoria`, que debe fallar.
- Demostración en vivo: un funcionario del MOP intenta abrir un trámite del MINSA, recibe la negación y queda el registro en la auditoría.

## 10. Límites declarados

- La identidad ciudadana no está verificada contra el Registro Civil.
- El laboratorio no tiene servidor de correo ni SIEM real.
- El PDP integrado en Django es migrable a un motor externo (OPA) en una fase futura; la interfaz se diseña para que el cambio no sea una reescritura.
- Los plazos (SLA) del catálogo son parámetros de diseño, no plazos legales.

## 11. Alternativas consideradas

| Enfoque | Decisión | Motivo |
|---|---|---|
| PDP dentro de Django más RLS en PostgreSQL | **Elegido** | Pocas piezas, probable en 10 semanas, defensa en profundidad real |
| PDP externo con OPA | Fase futura | Separación PEP/PDP más fiel, pero una pieza más que operar en VMs con poca memoria y un lenguaje nuevo para el equipo |
| Solo RLS como autoridad | Descartado | Las reglas contextuales (MFA reciente, nivel de aseguramiento) son incómodas en SQL y se auditan peor |

## 12. Próximos pasos

1. Especificación propia del motor ABAC: catálogo de atributos, lenguaje de políticas, interfaz del PDP y estrategia de implementación por capas (primero membresías por institución, luego reglas contextuales).
2. Plan de implementación del ABAC, integrado al cronograma de 10 semanas.
3. Actualizar `docs/architecture/spec.md` y `plan.md` con las decisiones de este diseño.

## Referencias

- Hu, V. C., Ferraiolo, D., Kuhn, R., Schnitzer, A., Sandlin, K., Miller, R., & Scarfone, K. (2014). *Guide to attribute based access control (ABAC) definition and considerations* (NIST Special Publication 800-162). National Institute of Standards and Technology. https://doi.org/10.6028/NIST.SP.800-162
- Rose, S., Borchert, O., Mitchell, S., & Connelly, S. (2020). *Zero trust architecture* (NIST Special Publication 800-207). National Institute of Standards and Technology. https://doi.org/10.6028/NIST.SP.800-207
- Asamblea Nacional de Panamá. (2019). *Ley 81 de 26 de marzo de 2019, sobre protección de datos personales*. Gaceta Oficial de Panamá.
- Asamblea Nacional de Panamá. (2012). *Ley 83 de 9 de noviembre de 2012, que regula el uso de medios electrónicos para los trámites gubernamentales* (Gaceta Oficial N.° 27160). Legispan.
- Asamblea Legislativa de Panamá. (2000). *Ley 38 de 31 de julio de 2000, que regula el Procedimiento Administrativo General* (Gaceta Oficial N.° 24109). Justia Panamá.
- PostgreSQL Global Development Group. (s. f.). *Row security policies*. En *PostgreSQL documentation*. https://www.postgresql.org/docs/16/ddl-rowsecurity.html
