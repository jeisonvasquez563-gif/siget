# Cómo abrir la plataforma SIGET

Guía paso a paso para **abrir, probar y operar** SIGET: desde encender las máquinas virtuales hasta iniciar sesión con cada rol. Sirve para cualquier integrante del equipo. La presentación al profesor tiene su propia guía: [`demo-guion.md`](./demo-guion.md).

> **Resumen en tres líneas:** enciende VM1 y VM2 → instala la CA del proyecto una sola vez → abre **https://192.168.159.137:8443** e inicia sesión con una cuenta de demostración y su código del segundo factor.

## 1. Qué es lo que se abre

```
 Tu navegador                VM1  app-backend  (192.168.159.137)             VM2  db-server  (192.168.100.20)
 ─────────────   HTTPS      ┌────────────────────────────────────────┐     ┌──────────────────────────────┐
  Interfaz React ─────────► │ nginx  :8443 (TLS 1.3, única entrada)  │     │ PostgreSQL 16 (contenedor)   │
  (la sirve nginx)  8443    │   ├─ /            → interfaz (React)   │     │  puerto 5433, TLS 1.3        │
                            │   └─ /auth /tramites /catalogo         │ TLS │  roles sin superusuario,     │
                            │      /equipo /auditoria /politicas     ├────►│  RLS y auditoría inalterable │
                            │      → Django + DRF (gunicorn)         │1.3  └──────────────────────────────┘
                            └────────────────────────────────────────┘
```

- **Una sola dirección** para todo: la interfaz y la API comparten origen (`https://…:8443`), sin configuración extra.
- Todo lo que no es la interfaz ni una ruta de la API responde **404**; lo privado sin sesión, **401**.
- `http://…:8080` solo redirige a HTTPS.

> **¿Abrirla a todo internet?** Hoy solo se accede por la red de VMware o por Tailscale. El plan para publicarla en un enlace público (con sus riesgos y decisiones pendientes) está en [`abrir-a-internet.md`](./abrir-a-internet.md).

## 2. Antes de empezar (una sola vez por equipo)

### 2.1 Requisitos

- **VMware Workstation** con las dos VMs del proyecto: `app-backend` (VM1) y `db-server` (VM2).
- El PC desde el que abres la plataforma debe alcanzar a VM1: por la red NAT de VMware (`192.168.159.137`) o por **Tailscale** (`100.104.206.118`) si estás en otra máquina del equipo (ver [`acceso-equipo.md`](./acceso-equipo.md)).
- Un navegador actual (Chrome, Edge o Firefox).

### 2.2 Instalar la CA del proyecto (para que el navegador confíe en el certificado)

El certificado de nginx lo firma la **CA interna de SIGET** (`infra/pki/siget-ca.crt`). Sin instalarla, el navegador avisa «la conexión no es privada»: se puede continuar, pero conviene confiar en la CA.

**Antes de confiar en ella, verifica su huella** (así sabes que es la del proyecto y no otra):

```bash
openssl x509 -in infra/pki/siget-ca.crt -noout -fingerprint -sha256
# SHA256 Fingerprint=F4:F4:15:F6:E5:4F:93:A7:77:7B:83:16:E3:97:87:17:31:AB:3B:08:6B:88:B9:C4:AD:77:C7:78:AD:8A:CC:E0
```

| Sistema / navegador | Cómo |
|---|---|
| **Windows** (Chrome y Edge) | PowerShell, usuario normal: `certutil -addstore -user Root infra\pki\siget-ca.crt` y aceptar el aviso |
| **Firefox** (cualquier sistema) | Ajustes → Privacidad y seguridad → Certificados → *Ver certificados* → *Autoridades* → *Importar* → marcar «Confiar en esta CA para identificar sitios web» |
| **macOS** | Abrir `siget-ca.crt` (Acceso a Llaveros) → añadir a «Sistema» → doble clic → Confiar → «Siempre confiar» |
| **Linux (Rocky/Fedora)** | `sudo cp infra/pki/siget-ca.crt /etc/pki/ca-trust/source/anchors/ && sudo update-ca-trust` |
| **Linux (Debian/Ubuntu)** | `sudo cp infra/pki/siget-ca.crt /usr/local/share/ca-certificates/siget-ca.crt && sudo update-ca-certificates` |

El certificado del servidor es válido para `192.168.159.137`, `192.168.100.10`, `100.104.206.118`, `127.0.0.1`, `app-backend` y `localhost`, y vence el 20 de octubre de 2027.

## 3. Encender y comprobar la plataforma

1. **Enciende las dos VMs** en VMware (en cualquier orden; si arrancan juntas, el backend reintenta solo hasta que la base responda, ≈1–2 minutos).
2. **Espera 2 minutos** y comprueba que responde:

   ```bash
   curl -k https://192.168.159.137:8443/salud/        # → {"estado":"ok"}
   ```
3. **Comprobación completa (opcional, ≈3 minutos):** el ensayo automático recorre todo el sistema con las cuentas reales.

   ```bash
   backend/.venv/Scripts/python.exe demo/ensayo.py     # debe terminar en «55 de 55 comprobaciones correctas»
   ```
4. Los servicios arrancan solos con la VM (Podman rootless + Quadlet con `linger`). Si algo no arrancó, ver la sección 7.

## 4. Abrir la plataforma

| Desde dónde | Dirección |
|---|---|
| El PC donde corren las VMs (red NAT de VMware) | **https://192.168.159.137:8443** |
| Otra máquina del equipo (por Tailscale) | **https://100.104.206.118:8443** |
| Redirección | `http://192.168.159.137:8080` → HTTPS automáticamente |

Verás la pantalla de acceso de SIGET. En el celular también funciona (la interfaz es responsiva); el modo claro y el oscuro se cambian con el botón de la luna, arriba a la derecha.

## 5. Iniciar sesión

SIGET exige **usuario + contraseña + código del segundo factor (TOTP)** para todas las cuentas.

### 5.1 Las cuentas de demostración (una por rol)

| Cuenta | Rol | Qué verás |
|---|---|---|
| `ana.ciudadana`, `beto.ciudadano` | Ciudadanía | Mis trámites, iniciar un trámite |
| `fabio.mop`, `flor.mop` | Funcionario del MOP | Bandeja de la institución |
| `saul.mop` | Supervisor del MOP | Supervisión (reasignar) y equipo |
| `carla.mop` | Coordinadora del MOP | Equipo y roles; **no** ve trámites |
| `felix.minsa` | Funcionario del MINSA | Bandeja del MINSA |
| `ines.infra`, `ivan.identidades`, `cata.catalogo`, `sergio.seguridad`, `silvia.secretos` | Los 5 roles de plataforma | Solo su consola («próximamente») y «Acceso a trámites» |
| `aldo.auditor` | Auditor | Consola de auditoría (solo lectura) |

Todas ven además **Mi seguridad**, **Segundo factor (MFA)** y **Roles y permisos** (con el simulador «¿qué pasaría si…?»).

### 5.2 Contraseñas y códigos

**Las contraseñas no están en el repositorio** (nunca se suben). Las generó el comando `sembrar_demo` y quedaron en un archivo local de quien lo ejecutó: `demo-local/siembra.local.txt` (ignorado por git). Pídeselas a Jeison, o si tienes acceso a ese archivo:

```bash
backend/.venv/Scripts/python.exe demo/codigo.py              # todas las cuentas: contraseña y código vigente
backend/.venv/Scripts/python.exe demo/codigo.py fabio.mop    # una sola
```

- El **código cambia cada 30 segundos y no se puede reutilizar**: si el login falla con todo correcto, espera al siguiente código.
- **Tres intentos fallidos bloquean la cuenta 5 minutos.**

### 5.3 Crear tu propia cuenta (y activar el segundo factor)

1. En la pantalla de acceso, **«Crea tu cuenta»** → elige usuario y una contraseña larga.
2. **Ingresa** con ellas (deja el código vacío): SIGET te lleva a **activar el segundo factor**.
3. Abre una aplicación de autenticación en tu celular (Google Authenticator, Microsoft Authenticator, Aegis…), **escanea el código QR** (o escribe la clave) y confirma con el código de 6 dígitos.
4. Listo: desde ahora entras con usuario, contraseña y el código del celular. El secreto se muestra **una sola vez** y queda cifrado en la base.

> Una cuenta nueva es ciudadana. Los roles de personal y de plataforma los asigna quien tiene la facultad (nadie se asigna un rol a sí mismo: lo impone la base de datos).

## 6. Qué hacer una vez dentro

| Quiero… | Dónde |
|---|---|
| Ver qué puedo y qué no puedo hacer | **Mi seguridad** |
| Entender y probar el segundo factor (incluye reenviar un código para ver que se rechaza) | **Segundo factor (MFA)** |
| Ver quién puede qué en todo el sistema, y probar situaciones hipotéticas | **Roles y permisos** → «Matriz de permisos» y «¿Qué pasaría si…?» |
| Ver los permisos reales de la base de datos | **Roles y permisos** → «Base de datos» |
| Iniciar un trámite y seguirlo | **Iniciar un trámite** / **Mis trámites** (ciudadanía) |
| Atender trámites | **Bandeja** (funcionario) o **Supervisión** (supervisor) |
| Auditar lo que pasa | **Auditoría** (`aldo.auditor`) |

El recorrido completo para presentar el sistema está en [`demo-guion.md`](./demo-guion.md).

## 7. Si algo no abre

| Síntoma | Causa probable | Qué hacer |
|---|---|---|
| El navegador no conecta | VM1 apagada, o tu PC no alcanza la red de VMware / Tailscale | Enciende VM1; prueba `ping 192.168.159.137`; si estás en otra máquina, activa Tailscale y usa `100.104.206.118` |
| «Conexión no privada» | CA sin instalar | Instálala (sección 2.2) o continúa de todos modos |
| Responde pero muestra error al iniciar sesión o listar | Base de datos (VM2) caída | Ver abajo: arrancar PostgreSQL |
| «Usuario, contraseña o código incorrectos» con todo bien | Código ya usado en ese intervalo, o hora desfasada | Espera al siguiente código; compara `date` en las VMs con la de tu PC |
| «Cuenta bloqueada» | 3 intentos fallidos | Espera 5 minutos o usa otra cuenta del mismo rol |
| Página en blanco | Caché antigua del navegador | Recarga forzada (Ctrl+F5) |

**Arrancar los servicios a mano** (en la VM correspondiente, con una cuenta del equipo que pueda operar como `siget`):

```bash
# VM1 (app-backend): pod, backend y nginx
sudo -H -u siget bash -lc 'export XDG_RUNTIME_DIR=/run/user/1009; systemctl --user start siget-pod.service siget-backend.service siget-nginx.service'

# VM2 (db-server): PostgreSQL
sudo -H -u siget bash -lc 'export XDG_RUNTIME_DIR=/run/user/1009; systemctl --user start siget-postgres.service'

# Estado
sudo -H -u siget bash -lc 'export XDG_RUNTIME_DIR=/run/user/1009; podman ps --format "{{.Names}}: {{.Status}}"'
```

> Reiniciar **backend y nginx a la vez** detiene el pod (están enlazados): para reiniciar, detén los tres y levanta en orden pod → backend → nginx.

## 8. Ver la interfaz sin las VMs (para desarrollar)

Cualquier integrante puede ver y probar **todas las pantallas por rol sin servidores ni contraseñas**, con datos de ejemplo:

```bash
cd frontend
npm install
npm run dev          # http://localhost:5173
```

Y abrir, por ejemplo: `http://localhost:5173/?mock=saul.mop` (supervisor), `?mock=aldo.auditor`, `?mock=ines.infra`, `?mock=ana.ciudadana`, o `?mock=enrolar` (alta del segundo factor). La lista completa está en [`frontend/README.md`](../frontend/README.md). Es un servidor de mentira que solo existe en desarrollo y **no se incluye en producción**.

Pruebas automáticas:

```bash
cd backend  && python -m pytest -q          # 354 pruebas, sin base de datos
cd frontend && npm run verificar            # lint + 130 pruebas + build
```

## 9. Publicar una versión nueva (quien opera las VMs)

| Qué cambió | Cómo se despliega |
|---|---|
| Interfaz (`frontend/`) | `npm run build`, copiar `dist/` a `/home/siget/frontend` en VM1 y reiniciar el pod (runbook, sección 27.6) |
| Backend (`backend/`) | Reconstruir la imagen `siget-backend:dev` en VM1 y reiniciar el pod (runbook, secciones 23 y 24) |
| Base de datos | Migración SQL numerada en `database/migraciones/` aplicada como superusuario local del contenedor, **con respaldo previo** (runbook, sección 32.2) |

Antes de cambiar nada en las VMs se pide aprobación y se documenta (regla de oro del proyecto).

## 10. Seguridad al usar la plataforma

- Las cuentas de demostración son **solo del laboratorio**: se suspenden tras la presentación.
- No compartas contraseñas ni códigos por chat; no subas `demo-local/` ni respaldos (`*.dump`) al repositorio (están ignorados).
- La plataforma está pensada con **Zero Trust**: cada petición se autentica y autoriza de nuevo; ningún rol puede todo. Explicación completa en [`estructura-plataforma.md`](./estructura-plataforma.md) y [`zero-trust-cobertura.md`](./zero-trust-cobertura.md).
