# Cobertura de Zero Trust en SIGET

Matriz que contrasta cada principio de Zero Trust con lo que SIGET implementa hoy y lo que falta, con tareas y semanas. Es la lista de control para poder afirmar, con evidencia, que el sistema aplica **todos** los conceptos. Diseño general: [`2026-10-08-arquitectura-zero-trust-design.md`](./superpowers/specs/2026-10-08-arquitectura-zero-trust-design.md). Verificación en la base: [`roles-permisos-bd.md`](./roles-permisos-bd.md).

**Marco:** los 7 principios de la sección 2.1 de NIST SP 800-207 (Rose et al., 2020), contrastados con el PDF oficial el 15 de octubre de 2026. NIST aclara que son un objetivo ideal y que no todos tienen que implementarse en su forma más pura; aquí se declara qué se logra y qué no.

**Leyenda:** ✅ implementado y verificado · 🔄 parcial · ⏳ pendiente · ➖ fuera de alcance (declarado).

## 1. Cobertura por principio

| # | Principio (NIST SP 800-207, sec. 2.1) | Cómo lo cubre SIGET | Estado | Falta |
|---|---|---|---|---|
| 1 | Todas las fuentes de datos y servicios de cómputo son recursos | Recursos clasificados: trámites (con `sensibilidad`), auditoría, decisiones del PDP, catálogo, secretos, VMs y contenedores. Cada uno con su dueño y sus reglas de acceso | 🔄 | Inventario formal de recursos con clasificación (ZT-1) |
| 2 | Toda la comunicación se asegura sin importar la ubicación de red | SSH solo por clave ✅ · Tailscale (WireGuard) para el equipo ✅ · **TLS 1.3 entre aplicación y base con verificación del certificado ✅** (runbook 18) · TLS en el borde con HSTS ⏳ · red interna aislada ✅ | 🔄 | TLS en nginx (ZT-3). **Hoy el checkpoint sirve el login por HTTP: es el desvío más visible** |
| 3 | El acceso a cada recurso se concede por sesión y con el mínimo privilegio | Roles de base sin superusuario ✅ · `app_role` sin `UPDATE/DELETE` en auditoría ✅ · membresías por institución ✅ · JWT de vida corta ⏳ · contexto fijado por transacción (`SET LOCAL`) ⏳ | 🔄 | JWT corto y refresh (ZT-5); mínimo privilegio de `sudo` (ZT-4) |
| 4 | El acceso lo decide una política dinámica con atributos de identidad, recurso y entorno | Modelo ABAC diseñado ✅ (nivel de aseguramiento, MFA reciente, institución, hora, intentos) · RLS activo ✅ · PDP en Django ⏳ | 🔄 | PDP con deniega-por-defecto y *fail closed* (ZT-6) |
| 5 | Se monitorea la integridad y la postura de seguridad de todos los activos | SELinux en Enforcing ✅ · journal persistente ✅ · parches con `dnf` (manual) · integridad de archivos ⏳ · postura de los dispositivos de los ciudadanos ➖ | 🔄 | Reporte periódico de parches y AIDE (ZT-7). El dispositivo del ciudadano queda fuera: declarado en la sección 4 |
| 6 | Autenticación y autorización dinámicas y estrictas antes de cada acceso, con reevaluación continua | Contraseña con hash y bloqueo tras 3 intentos ✅ (checkpoint) · MFA TOTP ⏳ · MFA reciente para cambiar estados ⏳ · revocación de sesión ⏳ | 🔄 | Argon2, MFA y reautenticación escalonada (ZT-5) |
| 7 | Se recopila información del estado de activos, red y accesos para mejorar la política | `evento_auditoria` y `decision_pdp` de solo inserción ✅ (esquema aplicado, sin datos reales aún) · registros de sudo ✅ | 🔄 | Registro real de decisiones, reporte de denegaciones y alertas (ZT-8) |

**Componentes lógicos de NIST (PEP, PDP, administrador de política):** el PEP es el middleware de Django, el PDP es el módulo de políticas y la base respalda con RLS. El diseño los separa; falta implementarlos (ZT-6).

## 2. Lo que ya está verificado hoy

- **Separación de funciones en la base:** el rol de plataforma se divide en cinco por función; una persona tiene uno solo, no puede mezclarlo con membresías y las altas sensibles exigen control dual (runbook 19).
- Ningún rol del proyecto es superusuario ni evita RLS; `postgres` no tiene contraseña y se rechaza por red (runbook 17).
- Aislamiento entre instituciones por RLS, auditoría de solo inserción, transiciones de estado válidas y que nadie se auto-asigne un rol: 24 pruebas contra el esquema real (`bash ~/siget-diseno/demo.sh`).
- SSH solo por clave, firewall restrictivo, SELinux en Enforcing y journal persistente en las dos VMs (runbook 14).
- La app del checkpoint usa un rol de mínimo privilegio y pgAdmin uno de solo lectura.
- La conexión entre la app y la base va cifrada con TLS 1.3 verificando el certificado del servidor, y la base rechaza las conexiones sin TLS (runbook 18).

## 3. Plan de implementación

Semanas del [cronograma](./documento-introductorio.md): S1 = 12 oct. Los responsables son una propuesta que Jeison confirma.

| ID | Tarea | Principio | Semana | Criterio de terminado |
|---|---|---|---|---|
| ZT-1 | Inventario de recursos con clasificación (dueño, sensibilidad, quién accede) | 1 | S2 | Tabla en `docs/` y campo `sensibilidad` poblado en el catálogo |
| ZT-2 ✅ | **TLS entre la aplicación y la base** con certificado propio, `hostssl` y verificación del servidor; el checkpoint PHP pasa a `sslmode=verify-full` | 2 | S2 | **Hecho el 15-oct** (runbook 18): `ssl = true` TLSv1.3 y la conexión sin TLS es rechazada |
| ZT-3 | TLS en el borde (nginx) con HSTS, CSP y redirección de HTTP a HTTPS | 2 | S5 | `curl -I` devuelve HSTS y el HTTP no sirve contenido |
| ZT-4 | **Sudo de mínimo privilegio**: reemplazar el `NOPASSWD: ALL` de `andy_martinez` por una lista de comandos | 3 | S2 | `sudo -l -U andy_martinez` lista solo comandos acotados |
| ZT-5 | Argon2, JWT de vida corta con refresh, MFA TOTP y reautenticación para cambiar estados | 3 y 6 | S4–S6 | Pruebas de login, expiración, MFA y reautenticación |
| ZT-6 | PDP: deniega por defecto, *fail closed*, contexto fijado por transacción | 3 y 4 | S4–S6 | Un caso permitido y uno denegado por cada fila de la matriz |
| ZT-7 | Postura de los activos: reporte semanal de parches pendientes y AIDE (integridad de archivos) con un timer de systemd | 5 | S5 | Reporte generado y alerta ante un archivo modificado |
| ZT-8 | Registro real de decisiones del PDP, reporte de denegaciones y bloqueo ante patrones anómalos | 6 y 7 | S7 | Consulta de denegaciones por actor; una ráfaga de intentos dispara el bloqueo |
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
| El login del checkpoint se sirve por HTTP (sin TLS) | 2 | ZT-3 y ZT-9 |
| `andy_martinez` tiene `sudo` completo en VM1 | 3 | ZT-4 |
| PostgreSQL sigue siendo la instalación nativa | 3 | Tareas 2.2 y 2.3 del plan de las semanas 1 y 2 |
| El MFA todavía no existe | 6 | ZT-5 |

## Referencia

Rose, S., Borchert, O., Mitchell, S., & Connelly, S. (2020). *Zero trust architecture* (NIST Special Publication 800-207). National Institute of Standards and Technology. https://doi.org/10.6028/NIST.SP.800-207
