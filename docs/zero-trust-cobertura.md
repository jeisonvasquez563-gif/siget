# Cobertura de Zero Trust en SIGET

Matriz que contrasta cada principio de Zero Trust con lo que SIGET implementa hoy y lo que falta, con tareas y semanas (**actualizada el 21 de octubre de 2026**). Es la lista de control para poder afirmar, con evidencia, que el sistema aplica **todos** los conceptos. Diseño general: [`2026-10-08-arquitectura-zero-trust-design.md`](./superpowers/specs/2026-10-08-arquitectura-zero-trust-design.md). Verificación en la base: [`roles-permisos-bd.md`](./roles-permisos-bd.md).

**Marco:** los 7 principios de la sección 2.1 de NIST SP 800-207 (Rose et al., 2020), contrastados con el PDF oficial el 15 de octubre de 2026. NIST aclara que son un objetivo ideal y que no todos tienen que implementarse en su forma más pura; aquí se declara qué se logra y qué no.

**Leyenda:** ✅ implementado y verificado · 🔄 parcial · ⏳ pendiente · ➖ fuera de alcance (declarado).

## 1. Cobertura por principio

| # | Principio (NIST SP 800-207, sec. 2.1) | Cómo lo cubre SIGET | Estado | Falta |
|---|---|---|---|---|
| 1 | Todas las fuentes de datos y servicios de cómputo son recursos | Recursos clasificados: trámites (con `sensibilidad`), auditoría, decisiones del PDP, catálogo, secretos, VMs y contenedores. Cada uno con su dueño y sus reglas de acceso | 🔄 | Inventario formal de recursos con clasificación (ZT-1) |
| 2 | Toda la comunicación se asegura sin importar la ubicación de red | SSH solo por clave ✅ · Tailscale (WireGuard) para el equipo ✅ · **TLS 1.3 entre aplicación y base con verificación del certificado ✅** (runbook 18) · **TLS 1.3 en el borde con HSTS, CSP y límite de tasa ✅** (nginx, runbook 24) · red interna aislada ✅ | 🔄 | **El checkpoint PHP aún sirve el login por HTTP** (Apache, puerto 80): es el desvío más visible y desaparece con su retiro (ZT-9) |
| 3 | El acceso a cada recurso se concede por sesión y con el mínimo privilegio | Roles de base sin superusuario ✅ · `app_role` sin `UPDATE/DELETE` en auditoría ✅ · membresías por institución ✅ · **JWT de 10 minutos y refresco de un solo uso ✅** · **contexto RLS fijado por transacción ✅** · **la consola de auditoría lee con su propio rol de solo lectura ✅** · sudo de mínimo privilegio ✅ | ✅ | Inventario formal de recursos (ZT-1) |
| 4 | El acceso lo decide una política dinámica con atributos de identidad, recurso y entorno | **PDP (ABAC) en Django ✅**: niega por defecto y ante fallos, decide con atributos del sujeto, del recurso y del entorno (segundo factor reciente, nivel de aseguramiento, institución, conflicto de interés, control dual) · RLS activo ✅ · **la matriz y el simulador de «qué pasaría si…» lo muestran en vivo ✅** | ✅ | — |
| 5 | Se monitorea la integridad y la postura de seguridad de todos los activos | SELinux en Enforcing ✅ · journal persistente ✅ · parches con `dnf` (manual) · integridad de archivos ⏳ · postura de los dispositivos de los ciudadanos ➖ | 🔄 | Reporte periódico de parches y AIDE (ZT-7). El dispositivo del ciudadano queda fuera: declarado en la sección 4 |
| 6 | Autenticación y autorización dinámicas y estrictas antes de cada acceso, con reevaluación continua | **Argon2, TOTP obligatorio con el secreto cifrado, anti-repetición, bloqueo tras 3 intentos, reautenticación escalonada para cambiar trámites, sesión y cuenta comprobadas en cada petición, revocación ante el reuso de un refresco ✅** (runbook 25) | ✅ | Recuperación de contraseña y rotación de claves |
| 7 | Se recopila información del estado de activos, red y accesos para mejorar la política | **`evento_auditoria`, `decision_pdp` (también las negadas) y `evento_seguridad` de solo inserción con datos reales ✅** · **consola de auditoría ✅** · actividad de seguridad visible para cada persona ✅ · registros de sudo ✅ | 🔄 | Alertas automáticas ante patrones (muchas denegaciones de una persona, reuso de tokens) y exportación firmada (ZT-8) |

**Componentes lógicos de NIST (PEP, PDP, administrador de política):** el PEP son las vistas de Django (`autorizar`), el PDP es el módulo de políticas (`pdp.py`) y la base respalda con RLS. Están implementados y separados (ZT-6).

## 2. Lo que ya está verificado hoy

- **Separación de funciones en la base:** el rol de plataforma se divide en cinco por función; una persona tiene uno solo, no puede mezclarlo con membresías y las altas sensibles exigen control dual (runbook 19).
- Ningún rol del proyecto es superusuario ni evita RLS; `postgres` no tiene contraseña y se rechaza por red (runbook 17).
- Aislamiento entre instituciones por RLS, auditoría de solo inserción, transiciones de estado válidas y que nadie se auto-asigne un rol: 24 pruebas contra el esquema real (`bash ~/siget-diseno/demo.sh`).
- SSH solo por clave, firewall restrictivo, SELinux en Enforcing y journal persistente en las dos VMs (runbook 14).
- La app del checkpoint usa un rol de mínimo privilegio y pgAdmin uno de solo lectura.
- El PDP del backend deniega por defecto y ante fallos (*fail closed*); toda la API de DRF nace denegada (`backend/`, especificación en [`2026-10-20-motor-abac-design.md`](./superpowers/specs/2026-10-20-motor-abac-design.md)).
- nginx es la única puerta de entrada del sistema nuevo: TLS 1.3, cabeceras de seguridad y límite de tasa; el backend solo escucha dentro del pod (runbook 24).
- La hora de los servidores se corrigió el 20-oct (iba 1 h 45 min atrasada) y se contrastó con cuatro referencias externas (runbook 22). La auditoría y los vencimientos dependen de un reloj correcto.
- **Autenticación dinámica (principio 6):** Argon2, JWT de 10 minutos, refresco de un solo uso con detección de reuso, segundo factor TOTP con el secreto cifrado, reautenticación escalonada, bloqueo por intentos y comprobación de sesión y cuenta en cada petición (runbook 25). Registro de seguridad de solo inserción (principio 7).
- PostgreSQL corre en un contenedor rootless del usuario de servicio `siget`, con TLS 1.3, sin contraseña de superusuario y sin privilegios (runbook 21).
- La conexión entre la app y la base va cifrada con TLS 1.3 verificando el certificado del servidor, y la base rechaza las conexiones sin TLS (runbook 18).
- **Aislamiento entre instituciones en dos barreras:** el PDP y la seguridad por filas de PostgreSQL. Un hallazgo del recorrido (la coordinadora veía los trámites de su institución por una RLS demasiado amplia) se corrigió y quedó cubierto por una prueba contra la base real (runbook 27).
- **La consola de auditoría lee con un rol de base de datos propio de solo lectura**: la base le niega escribir, borrar y leer hashes o secretos; cada consulta queda registrada («quién audita al auditor») (runbook 28).
- **Transparencia que no puede mentir:** la matriz de permisos se calcula evaluando el PDP real; una prueba falla si algún rol pudiera las 18 acciones (no existe un superusuario); los privilegios de PostgreSQL se leen de la base en vivo (runbook 30).
- **Verificación continua:** 354 pruebas del backend, 130 del frontend (accesibilidad y seguridad del código incluidas), 6 verificaciones contra la base real y CI en GitHub; ensayo de la demostración de 55 comprobaciones (runbook 32).

## 3. Plan de implementación

Semanas del [cronograma](./documento-introductorio.md): S1 = 12 oct. Los responsables son una propuesta que Jeison confirma.

| ID | Tarea | Principio | Semana | Criterio de terminado |
|---|---|---|---|---|
| ZT-1 | Inventario de recursos con clasificación (dueño, sensibilidad, quién accede) | 1 | S2 | Tabla en `docs/` y campo `sensibilidad` poblado en el catálogo |
| ZT-2 ✅ | **TLS entre la aplicación y la base** con certificado propio, `hostssl` y verificación del servidor; el checkpoint PHP pasa a `sslmode=verify-full` | 2 | S2 | **Hecho el 15-oct** (runbook 18): `ssl = true` TLSv1.3 y la conexión sin TLS es rechazada |
| ZT-3 ✅ | TLS en el borde (nginx) con HSTS, CSP y redirección de HTTP a HTTPS | 2 | S5 | **Hecho el 20-oct** (runbook 24, antes de lo previsto): TLS 1.3, siete cabeceras, HTTP responde 301 a HTTPS y el límite de tasa responde 429 |
| ZT-4 ✅ | **Sudo de mínimo privilegio**: reemplazar el `NOPASSWD: ALL` de `andy_martinez` por una lista de comandos | 3 | S2 | **Hecho el 15-oct** (runbook 20): `sudo -l -U andy_martinez` lista solo comandos acotados |
| ZT-5 ✅ | Argon2, JWT de vida corta con refresco rotatorio, MFA TOTP y reautenticación para cambiar estados | 3 y 6 | S4–S6 | **Hecho el 20-oct** (runbook 25, antes de lo previsto): 47 pasos contra la base real. Faltan las pantallas del frontend |
| ZT-6 ✅ | PDP: deniega por defecto, *fail closed*, contexto fijado por transacción | 3 y 4 | S4–S6 | **Hecho el 20-oct** (runbook 23 y 26): PDP con 84 pruebas y 6 mutaciones detectadas, contexto RLS por transacción y PDP conectado a todas las vistas con las decisiones registradas aunque se denieguen (51 pasos contra la base real) |
| ZT-7 | Postura de los activos: reporte semanal de parches pendientes y AIDE (integridad de archivos) con un timer de systemd | 5 | S5 | Reporte generado y alerta ante un archivo modificado |
| ZT-8 🔄 | Registro real de decisiones del PDP, reporte de denegaciones y bloqueo ante patrones anómalos | 6 y 7 | S7 | **Registro real y consola de auditoría hechos el 21-oct** (runbook 28): consulta de denegaciones por persona y política. Falta la alerta automática ante patrones |
| ZT-9 | Retirar el checkpoint PHP (ver el [plan](./architecture/plan.md), punto 11) | 2 y 6 | S6 | Apache sin la app PHP; Django con login equivalente |
| ZT-10 | Verificación final de los 7 principios con evidencia | todos | S9–S10 | Esta matriz con todos los ✅ y la evidencia enlazada |

## 4. Límites declarados

- **Postura del dispositivo del ciudadano (principio 5):** NIST aclara que los principios no aplican a usuarios anónimos o de consumo sobre los que la organización no tiene control. SIGET no puede inspeccionar el equipo del ciudadano; lo compensa con MFA y con el atributo `nivel_aseguramiento`.
- **Identidad ciudadana:** no se verifica contra el Registro Civil; es el punto de integración futuro.
- **Sin SIEM ni servidor de correo** en el laboratorio: la detección (principio 7) se limita a consultas y reportes propios.

## 5. Desvíos actuales frente a Zero Trust

Honestidad antes que cumplimiento aparente:

| Desvío | Principio | Plan |
|---|---|---|
| El login del checkpoint PHP se sirve por HTTP (sin TLS), en el puerto 80 de VM1 | 2 | ZT-9 (retiro en la semana 6). El sistema nuevo no tiene este desvío: todo va por TLS 1.3 |
| No hay respaldos automáticos de la base (solo manuales y verificados) | 5 | Temporizador diario con retención y prueba de restauración (runbook 32) |
| La CA interna no trae `keyUsage` | 2 | Reemitirla (clientes estrictos, como Python 3.14, la rechazan) |

## Referencia

Rose, S., Borchert, O., Mitchell, S., & Connelly, S. (2020). *Zero trust architecture* (NIST Special Publication 800-207). National Institute of Standards and Technology. https://doi.org/10.6028/NIST.SP.800-207
