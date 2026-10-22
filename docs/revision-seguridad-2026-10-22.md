# Revisión de seguridad de SIGET — 22 de octubre de 2026

Revisión de lo construido hasta hoy, con **evidencia tomada en vivo** de las dos VM (solo lectura, ningún cambio) y del código. Sirve para decirle al profesor, con honestidad, qué está sólido, qué tiene debilidades conocidas y qué se corrige después.

**Alcance:** puerta de entrada (nginx/TLS), aplicación (autenticación, autorización, API), base de datos, contenedores y servidores, cadena de suministro y operación.
**Lo que NO es:** una prueba de penetración. No se hizo fuzzing de la API ni explotación activa; las pruebas dinámicas se limitan a los sondeos de la sección 2 y al ensayo de la demostración (55 de 55).

## 1. Veredicto

| Área | Estado | En una frase |
|---|---|---|
| Transporte (TLS) | 🟢 Sólido | TLS 1.3 solo, HSTS, 7 cabeceras de seguridad, base de datos con TLS 1.3 y verificación completa del certificado |
| Identidad y sesión | 🟢 Sólido | Argon2, JWT de 10 min, refresco de un solo uso con detección de reuso, TOTP sin reutilización, bloqueo por intentos |
| Autorización | 🟢 Sólido | PDP que niega por defecto + RLS en la base; ningún rol puede las 18 acciones |
| Base de datos | 🟢 Sólido, con matices | Sin superusuario por red, registro inalterable comprobado, `SECURITY DEFINER` con ruta fija; RLS solo en 2 de 11 tablas (ver H-5) |
| Contenedores y servidores | 🟡 Bueno | Rootless, solo lectura, SELinux *enforcing*, SSH solo por clave; endurecimiento de SSH pendiente |
| Operación | 🟠 Débil | **Sin respaldos automáticos**, sin alertas, sin bitácora central |
| Superficie heredada | 🟠 Débil | El checkpoint Apache/PHP sigue en HTTP :80 |
| Cadena de suministro | 🟢 Limpia hoy, 🟡 sin automatizar | 0 vulnerabilidades conocidas, pero el escaneo no corre en el CI |

**Ningún hallazgo crítico.** Los dos puntos naranja (respaldos y checkpoint PHP) están documentados y asignados a Andy ([plan](./architecture/plan-pendientes-andy.md)).

## 2. Lo que se comprobó en vivo y salió bien

| Comprobación | Resultado |
|---|---|
| Versión de TLS | TLS 1.3 solamente; un cliente limitado a TLS 1.2 es rechazado |
| Cabeceras en `/` | HSTS (1 año), CSP `default-src 'self'`, `frame-ancestors 'none'`, `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, COOP; `Server: nginx` sin versión |
| Rutas que no existen | `/admin/`, `/.git/config`, `/static/x`, `/api/` → **404** (nginx solo deja pasar 7 prefijos de la API) |
| Rutas privadas sin sesión | `/auth/yo/`, `/tramites/`, `/politicas/matriz/` → **401** |
| Método `TRACE` | 405 |
| HTTP | El puerto 8080 solo redirige (301) a HTTPS |
| Puertos en VM1 | 22, 80 (heredado), 8080 y 8443; el backend (gunicorn) escucha solo dentro del pod |
| Puertos en VM2 | 22 y 5433 **solo en la IP interna** `192.168.100.20`; el 5432 nativo está cerrado |
| Firewall | VM2 sin servicios salvo SSH; VM1 solo SSH, HTTP heredado y 8443/8080 |
| SELinux | *Enforcing* en las dos VM |
| SSH | Sin contraseñas (`PasswordAuthentication no`) |
| Contenedores | `NoNewPrivileges`, `DropCapability=ALL`, sistema de archivos de solo lectura; los 4 en ejecución (`infra`, `backend`, `nginx`, `postgres`) |
| Secretos | 8 secretos en VM1 y 2 en VM2 como `podman secret`; ninguno en el repositorio ni en la imagen |
| Conexión a la base | Única sesión de aplicación: `app_role` desde `192.168.100.10`, **TLSv1.3** |
| Cifrado de claves de la base | `scram-sha-256`; `ssl_min_protocol_version = TLSv1.3` |
| Privilegios sobre el registro inalterable | **0 filas**: ningún rol puede `UPDATE`, `DELETE` ni `TRUNCATE` sobre `evento_auditoria`, `decision_pdp`, `evento_seguridad` ni `transicion` |
| Funciones `SECURITY DEFINER` | Las 3 tienen `search_path` fijo (`siget, pg_temp`): evita el secuestro por esquema |
| Parches | 0 actualizaciones de seguridad pendientes en las dos VM |
| Dependencias | `pip-audit` (backend) y `npm audit --omit=dev` (frontend): **0 vulnerabilidades** |
| Ensayo de la demostración | **55 de 55** contra producción (13 cuentas, segundo factor, anti-repetición, auditoría, cierre de sesión) |
| Pruebas | 355 del backend, 131 del frontend, ESLint limpio |

## 3. Hallazgos y recomendaciones

Gravedad pensando en el uso actual (aula, red privada). Las marcadas **(internet)** suben si se abre a internet.

| # | Hallazgo | Gravedad | Evidencia | Recomendación |
|---|---|---|---|---|
| H-1 | 🟡 **Casi cerrado el 22-oct:** respaldo diario automático (`siget-respaldo.timer`, 02:30) con verificación y **prueba de restauración** en cada corrida, retención de 14 días y permisos 600 (los dos volcados viejos en 644 corregidos). **Falta la copia fuera de la VM** (decisión de destino pendiente). **No hay respaldos automáticos de la base viva.** Los últimos volcados en `/var/backups/siget` (VM2) son del 15 y 20 de octubre; no existe ningún temporizador. Dos volcados tienen permisos `644` (contienen hashes de contraseñas) aunque el directorio los protege | **Alta** (disponibilidad) | `ls /var/backups/siget`, `systemctl list-timers` | Temporizador de systemd con `pg_dump`, permisos `600`, copia fuera de la VM y **restauración probada** (paquete de Andy). Antes de la demo: un respaldo manual |
| H-2 | **El checkpoint Apache/PHP sigue en HTTP :80** (texto plano) en VM1, con `checkpoint_app` aún activo en la base | **Media** | `ss -tlnp` (httpd en `*:80`), firewall con `http` | Retirarlo en la semana 6 (ya planeado), o cerrar el puerto 80 hasta entonces si no se necesita para la demostración |
| H-3 | 🟡 **Mitigado en parte el 22-oct:** el bloqueo ahora es progresivo (5, 15 y 60 min, con reinicio al acertar), lo que frena más la fuerza bruta pero NO elimina que alguien bloquee a una víctima a propósito; falta el bloqueo por IP. **Bloqueo de cuenta usable como ataque** (3 fallos en 5 min). Se vio en vivo: 58 eventos `login_rechazado_bloqueada` y 1 `cuenta_bloqueada`; un atacante podría bloquear a la persona auditora o a un operador | **Media (internet: alta)** | `evento_seguridad` (sección 7 del estado de la BD) | Bloqueo progresivo por cuenta **y** por IP, y restablecimiento asistido; documentado en [`abrir-a-internet.md`](./abrir-a-internet.md) |
| H-4 | ✅ **Corregido el 22-oct.** **Los límites de tasa de Django se cuentan por proceso.** No hay `CACHES` configurado: se usa memoria local y gunicorn corre 3 procesos, así que el límite real es ~3 veces el nominal y se reinicia al reiniciar. (nginx sí limita bien: 20 req/s por IP) | Baja–Media **(internet)** | `config/settings.py` sin `CACHES`; `--workers 3` | Caché compartida (base de datos o archivo) para el *throttling*, o contar intentos fallidos en la base (el bloqueo por cuenta ya vive en la base) |
| H-5 | **RLS solo en 2 de 11 tablas** (`tramite`, `evento_auditoria`). `usuario` y `sesion` son legibles por `app_role` completas (incluidos hashes Argon2 y hashes de refresco); `rls_forzada` está apagada | Baja (diseño) | `estado-bd.sql`, sección 3 | Es lo que el login necesita y los hashes están protegidos por Argon2/SHA-256, pero si el backend se comprometiera se leerían. Mitigación futura: vistas de login con `SECURITY DEFINER` y `REVOKE SELECT` sobre las columnas sensibles. `FORCE RLS` no aporta hoy: el dueño (`siget_owner`) no tiene inicio de sesión |
| H-6 | ✅ **Corregido el 22-oct** (`/etc/ssh/sshd_config.d/00-siget-endurecimiento.conf` en las dos VM; `sshd -T` confirma `permitrootlogin no`, `x11forwarding no`, `maxauthtries 3`, reconexión probada). **SSH sin endurecer del todo:** `PermitRootLogin without-password` (root podría entrar con clave), `X11Forwarding yes`, `MaxAuthTries 6` | Baja | `sshd -T` | `PermitRootLogin no`, `X11Forwarding no`, `MaxAuthTries 3`. Cambia las VM: **requiere la aprobación de Jeison** |
| H-7 | 🟡 **Parcial el 22-oct:** `log_connections` y `log_disconnections` ya están en `on` (recarga, sin reinicio). **Sin bitácora central ni alertas.** `log_connections`/`log_disconnections` apagados en PostgreSQL; `fail2ban` inactivo; nadie recibe aviso de ráfagas de denegaciones o de reuso de token | Baja–Media | `pg_settings`, `systemctl is-active` | Activar ambos *logs* de PostgreSQL; alertas sobre `evento_seguridad` (paquete de Andy) |
| H-8 | **Registro abierto y cuentas de demostración con claves conocidas por el equipo.** Cualquiera con acceso a la red puede crear cuentas de ciudadanía | Baja hoy · **Alta (internet)** | `POST /auth/registro/` público | Cerrar o poner por invitación y rotar las claves de demostración antes de abrir a internet |
| H-9 | **La CA interna no tiene `keyUsage`**: Python 3.14 con verificación estricta la rechaza; los scripts relajan `VERIFY_X509_STRICT` | Baja (deuda) | `infra/pki/siget-ca.crt` | Reemitir la CA con `keyUsage` (paquete de Andy) |
| H-10 | **El escaneo de dependencias y secretos no corre en el CI** (`security-scan.yml` figura como «Planeado»). Hoy está limpio porque se corrió a mano | Baja | `.github/workflows/` | Crear el flujo con `pip-audit`, `npm audit` y `gitleaks` |
| H-11 | Los secretos se montan con modo `0444` dentro del contenedor | Info | `siget-backend.container` | Aceptable (contenedor de un solo propósito, sin root); se puede bajar a `0440` con un grupo |
| H-14 | ✅ **Hallado y corregido el 22-oct:** `pgadmin_lectura` («solo lectura») era miembro de `pg_read_all_data` y podía leer **todo**: hashes de contraseñas y de refresco, y los datos personales recién añadidos | **Media** | `pg_auth_members`, `has_table_privilege` | Migración 009: sin esa membresía y con `SELECT` explícito solo sobre lo no sensible; verificado `lee_hash = f` |
| H-12 | `listen_addresses = *` dentro del contenedor de PostgreSQL | Info | `pg_settings` | Compensado: el contenedor publica solo `192.168.100.20:5433` y `pg_hba.conf` solo admite a VM1 con TLS |
| H-13 | Las dos VM acaban de arrancar y `chronyc` no devolvió datos con este usuario, así que **no se verificó la sincronización horaria hoy** | Info | — | Comprobar con `sudo chronyc tracking` (la auditoría y los plazos dependen de la hora); la hora observada, 16:21 UTC, es coherente |

### Cosas que se miraron y están bien (para no repetirlas)

- **Un rol de plataforma nunca ve trámites** (lo impone el PDP y la base) y **nadie reúne todos los poderes**: el que más puede (supervisor) hace 6 de 18 acciones. Lo comprueba una prueba que fallaría si alguien lo rompiera.
- **El control dual** impide aprobar un alta propia (`siget.aprobacion`, regla del PDP, sin filas aún porque las consolas no están construidas).
- **La IP del cliente** llega bien a Django: nginx *reemplaza* `X-Forwarded-For` por la IP real (`$remote_addr`), así que no se puede falsificar desde fuera.
- **El token de acceso vive solo en memoria** y el de refresco en cookie `HttpOnly; Secure; SameSite=Strict; Path=/auth/`, con cabecera `X-SIGET-CSRF` para los métodos con cookie.
- **No hay credenciales en el repositorio**: las de demostración viven en `demo-local/` (ignorado por git).

### Añadido el mismo día: sesiones

Tras esta revisión se añadió el **cierre de sesión por inactividad** (10 min en la interfaz con aviso de 60 s; 15 min como máximo en el servidor) y un **tope absoluto de 8 h por sesión**: antes cada renovación del refresco sumaba otras 8 horas y una sesión podía prolongarse sin límite. Recargar la página devuelve al Inicio. Ver `CHANGELOG.md` y [`zero-trust-cobertura.md`](./zero-trust-cobertura.md).

## 4. Orden sugerido de corrección

| Cuándo | Qué | Quién |
|---|---|---|
| **Antes de la demo de hoy** | Respaldo manual de la base (H-1); decidir si se cierra el puerto 80 (H-2) | Jeison |
| Esta semana | H-1 automatizado, H-6 (SSH), H-7 (logs de PostgreSQL), H-10 (CI de seguridad) | Andy, con aprobación de Jeison para lo que toque las VM |
| Antes de abrir a internet | H-3, H-4, H-8 y los pendientes de [`abrir-a-internet.md`](./abrir-a-internet.md) | Andy / Jeison |
| Semana 6 | H-2 (retirar PHP), H-9 (CA), H-5 (vistas de login) | Andy |

## 5. Cómo repetir esta revisión

```bash
# Estado de la base (solo lectura), desde VM2:
database/psql-contenedor.sh -d tramites_demo -f database/estado-bd.sql
# Sondeos de la puerta de entrada: ver la sección 2 (curl con --ssl-no-revoke)
# Ensayo completo de la demostración:
python demo/ensayo.py
```

Estado de la base de datos con las cifras de hoy: [`estado-base-de-datos.md`](./estado-base-de-datos.md).
