# Runbook — SIGET (Sistema de Gestión y Trazabilidad)

**Aprovisionamiento de infraestructura y checkpoint de Base de Datos + Apache (login y gestión de usuarios)**
Ciberseguridad 5, UTP — Elaborado por: Jeison Vásquez — Grupo Ciber5

## 0. Alcance de este documento

Este runbook documenta, paso a paso y en el orden real en que se ejecutaron, todas las acciones realizadas sobre las dos máquinas virtuales del proyecto SIGET (VM1 = `app-backend` y VM2 = `db-server`) desde su creación en VMware Workstation Pro hasta dejar funcionando un checkpoint de PostgreSQL + Apache/pgAdmin solicitado como avance de entrega. No cubre la arquitectura final del proyecto (Podman rootless, Django, nginx), que corresponde a una fase posterior aún no ejecutada.

> **Nota:** los comandos marcados con el símbolo de consola (`$`) se ejecutaron por SSH desde la máquina Windows del desarrollador hacia las VMs, salvo que se indique explícitamente "consola de VMware" o "terminal del host Windows".

## 1. Infraestructura base: creación de las VMs

Se crearon dos máquinas virtuales en VMware Workstation Pro, ambas con Rocky Linux 9:

| VM  | Rol         | SO                          |
|-----|-------------|------------------------------|
| VM1 | app-backend | Rocky Linux 9.7 (Blue Onyx) |
| VM2 | db-server   | Rocky Linux 9.7 (Blue Onyx) |

> **Nota:** durante la instalación (Anaconda) de ambas VMs se detectó un problema crítico: si al crear el usuario administrador (`jeison_vasquez`) no se marca la casilla "Make this user administrator", el usuario no queda en el grupo `wheel` y `sudo` falla con el error `user is not in the sudoers file. This incident will be reported`. Como no se contaba con la contraseña de root para revertirlo, se optó por reinstalar ambas VMs marcando correctamente esa casilla. Ver sección 7 para el detalle de este incidente.

## 2. Acceso remoto por SSH con clave pública

### 2.1 Generación de claves dedicadas

Se generó un par de claves ED25519 independiente por cada VM (aislamiento: si se compromete una VM, la otra no se ve afectada), en la máquina Windows del desarrollador:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/ciber5_vm1 -N "" -C "claude-code@proyecto-ciber5"
ssh-keygen -t ed25519 -f ~/.ssh/ciber5_vm2 -N "" -C "claude-code@proyecto-ciber5-db"
```

### 2.2 Copia de la clave pública a cada VM

El portapapeles de VMware Tools no funciona en consolas de texto sin entorno gráfico, así que copiar y pegar el comando directamente en la consola de VMware no fue posible. La solución fue usar `ssh-copy-id` desde la propia terminal del desarrollador (Git Bash en Windows), que solicita la contraseña una única vez:

```bash
ssh-copy-id -i ~/.ssh/ciber5_vm1.pub jeison_vasquez@<IP_NAT_VM1>
ssh-copy-id -i ~/.ssh/ciber5_vm2.pub jeison_vasquez@<IP_NAT_VM2>
```

> **Nota:** regla de seguridad seguida durante todo el proceso: ninguna contraseña personal del usuario se tipeó ni se manejó dentro de la sesión de asistencia (Claude Code). Todo comando que requería una contraseña interactiva se ejecutó por el propio desarrollador en su terminal.

### 2.3 Verificación de conexión

```bash
ssh -i ~/.ssh/ciber5_vm1 jeison_vasquez@<IP_NAT_VM1> "whoami && hostname"
```

Resultado esperado: conexión sin solicitud de contraseña.

### 2.4 Gotcha: cambio de host key al reinstalar una VM

Al reutilizar una IP que antes perteneció a otra instalación, SSH advierte "REMOTE HOST IDENTIFICATION HAS CHANGED" por seguridad (posible MITM). En un laboratorio local esto es benigno si se confirma que la IP corresponde a una VM propia recién creada. Se resolvió con:

```bash
ssh-keygen -R <IP_DE_LA_VM>
```

## 3. Configuración de sudo sin contraseña

Para poder ejecutar tareas administrativas de forma no interactiva se configuró sudo NOPASSWD para el usuario `jeison_vasquez`, una vez confirmado que pertenecía al grupo `wheel`:

```bash
echo "jeison_vasquez ALL=(ALL) NOPASSWD: ALL" | sudo tee /etc/sudoers.d/90-jeison-nopasswd
sudo chmod 440 /etc/sudoers.d/90-jeison-nopasswd
```

Ejecutado en la consola de cada VM (requiere la contraseña del propio usuario una última vez). Verificación:

```bash
sudo -n whoami   # debe devolver "root" sin pedir contraseña
```

## 4. Red interna dedicada VM1 ↔ VM2

### 4.1 Creación de la red virtual en VMware

En VMware Workstation Pro: **Edit → Virtual Network Editor → Change Settings** (requiere permisos de administrador de Windows):

1. Add Network → se asignó el identificador `VMnet2`.
2. Tipo de red: "Solo para hosts" (host-only) — red privada, sin salida a internet.
3. IP de subred: `192.168.100.0` — Máscara de subred: `255.255.255.0`
4. Se desmarcó "Usar el servicio DHCP local" — las IPs se asignan a mano.
5. Aplicar → Aceptar.

### 4.2 Adaptador de red adicional en cada VM

Con las VMs apagadas, en VM Settings → Add → Network Adapter → "Custom: Specific virtual network" → `VMnet2`, repetido en VM1 y VM2.

### 4.3 Asignación de IP estática dentro de cada VM

Al encender las VMs apareció una segunda interfaz (`ens224`) sin configurar. Se le asignó IP fija por `nmcli`, sin tocar la conexión NAT autogenerada:

```bash
# En VM1:
sudo nmcli con add type ethernet ifname ens224 con-name red-interna \
  ipv4.method manual ipv4.addresses 192.168.100.10/24 ipv6.method disabled
sudo nmcli con up red-interna

# En VM2:
sudo nmcli con add type ethernet ifname ens224 con-name red-interna \
  ipv4.method manual ipv4.addresses 192.168.100.20/24 ipv6.method disabled
sudo nmcli con up red-interna
```

### 4.4 Verificación de conectividad

```bash
ping -c 4 192.168.100.20   # ejecutado desde VM1
```

Resultado: 0% de pérdida de paquetes, confirmando la comunicación por la red interna.

## 5. Hostnames y resolución de nombres

```bash
# VM1:
sudo hostnamectl set-hostname app-backend
# VM2:
sudo hostnamectl set-hostname db-server
```

Se agregó además resolución cruzada en `/etc/hosts` de cada VM, para poder referirse a la otra máquina por nombre en vez de IP:

```bash
# En VM1 (/etc/hosts):
192.168.100.20 db-server
# En VM2 (/etc/hosts):
192.168.100.10 app-backend
```

## 6. Firewall (firewalld)

Ambas interfaces de red de cada VM (NAT e interna) conviven en la misma zona firewalld `public`. Para restringir el acceso a PostgreSQL exclusivamente desde VM1 sin abrir el puerto también hacia la red NAT, se usó una rich rule con IP de origen explícita, en vez de un simple `--add-port`:

```bash
# En VM2 (db-server):
sudo firewall-cmd --permanent --zone=public --add-rich-rule=\
  'rule family="ipv4" source address="192.168.100.10/32" port protocol="tcp" port="5432" accept'
sudo firewall-cmd --reload
```

Verificación:

```bash
sudo firewall-cmd --list-all
```

## 7. Incidente: reinstalación de las VMs por falta de sudo

Durante la configuración inicial se detectó que `jeison_vasquez` no tenía privilegios de sudo en ninguna de las dos VMs. El diagnóstico paso a paso fue:

1. `sudo -n true` devolvía "a password is required" — ambiguo, no distingue entre "está en sudoers pero pide contraseña" y "no está en sudoers".
2. Al forzar el prompt interactivo, apareció el mensaje real: `jeison_vasquez is not in the sudoers file. This incident will be reported.`
3. Se verificó que no existía ningún otro usuario administrable con UID 0 ni con shell de login (solo cuentas de sistema como `sync`, `shutdown`, `halt`, `operator`, todas con `/sbin/nologin`).
4. Sin contraseña de root conocida, la única salida sin reinstalar era resetear la contraseña de root vía GRUB (parámetro de arranque `rd.break`, montaje del sistema de archivos en modo lectura-escritura, `chroot`, `passwd root`, y — crítico por tratarse de un sistema con SELinux enforcing — tocar `/.autorelabel` para forzar un reetiquetado completo antes del siguiente arranque, evitando que el sistema quede bloqueado por contextos SELinux incorrectos).
5. Se decidió junto con el responsable del proyecto reinstalar ambas VMs desde cero, esta vez marcando correctamente la casilla "Make this user administrator" en el instalador, en lugar de ejecutar el procedimiento de recuperación por GRUB.

> **Nota:** consecuencia práctica: las direcciones IP NAT de las VMs cambiaron entre la primera y la segunda instalación. Se limpiaron las entradas antiguas de `known_hosts` en la máquina del desarrollador con `ssh-keygen -R` antes de reconectar.

## 8. Checkpoint solicitado por el profesor: primer intento (PostgreSQL + Apache/pgAdmin)

Como avance de entrega intermedio, separado de la arquitectura final del proyecto (que usará contenedores Podman), se armó una primera demostración funcional de base de datos con panel de administración web accesible por navegador (pgAdmin4).

> **Nota:** este primer intento quedó funcionando e instalado, pero tras aclarar el pedido directamente con el profesor se determinó que no era exactamente lo solicitado: se pedía una aplicación propia con pantalla de login y gestión de usuarios (crear/eliminar), no un panel de administración de base de datos genérico. pgAdmin se dejó instalado como capacidad adicional (ver sección 9), y se construyó la aplicación real en la sección 10.

### 8.1 Instalación de PostgreSQL 16 en VM2

```bash
sudo dnf module enable -y postgresql:16
sudo dnf install -y postgresql-server postgresql-contrib
sudo /usr/bin/postgresql-setup --initdb
sudo systemctl enable --now postgresql
```

### 8.2 Configuración de acceso remoto (solo desde VM1)

Se editó `postgresql.conf` para escuchar en todas las interfaces (el firewall ya limita quién puede llegar) y se agregó una regla de autenticación en `pg_hba.conf` restringida a la IP interna de VM1:

```bash
sudo sed -i "s/^#listen_addresses = 'localhost'/listen_addresses = '*'/" \
  /var/lib/pgsql/data/postgresql.conf

echo 'host  all  all  192.168.100.10/32  scram-sha-256' | \
  sudo tee -a /var/lib/pgsql/data/pg_hba.conf

sudo systemctl restart postgresql
```

### 8.3 Contraseña y datos de ejemplo

```bash
sudo -u postgres psql -c "ALTER USER postgres PASSWORD '<PASSWORD_NO_PUBLICADA>';"
sudo -u postgres psql -c "CREATE DATABASE tramites_demo;"
sudo -u postgres psql -d tramites_demo -c \
  "CREATE TABLE demo_tramite (id SERIAL PRIMARY KEY, descripcion TEXT,
   estado VARCHAR(30) DEFAULT 'Pendiente', creado_en TIMESTAMP DEFAULT now());"
sudo -u postgres psql -d tramites_demo -c \
  "INSERT INTO demo_tramite (descripcion, estado) VALUES
   ('Permiso de Construccion Municipal - prueba', 'Pendiente');"
```

### 8.4 Instalación de Apache en VM1

```bash
sudo dnf install -y httpd
```

### 8.5 Instalación de pgAdmin4 en modo web

pgAdmin4 requiere su propio repositorio RPM, distinto del repositorio oficial de PostgreSQL (PGDG):

```bash
sudo dnf install -y https://download.postgresql.org/pub/repos/yum/reporpms/EL-9-x86_64/pgdg-redhat-repo-latest.noarch.rpm
sudo dnf install -y https://ftp.postgresql.org/pub/pgadmin/pgadmin4/yum/pgadmin4-redhat-repo-2-1.noarch.rpm
sudo dnf install -y pgadmin4-web
```

Configuración de la integración con Apache, en modo no interactivo:

```bash
sudo PGADMIN_SETUP_EMAIL=admin@ciber5.com \
     PGADMIN_SETUP_PASSWORD='<PASSWORD_NO_PUBLICADA>' \
     /usr/pgadmin4/bin/setup-web.sh --yes
```

> **Nota:** gotcha detectado: pgAdmin4 rechaza en su formulario de login (validación del lado del cliente, en React) cualquier correo cuyo dominio termine en `.local`, con el mensaje "Email/Username is not valid", sin siquiera llegar a golpear el servidor. Se resolvió usando un dominio con TLD convencional (`.com`) para el usuario administrador.

## 9. Habilitación final y verificación de pgAdmin

### 9.1 Apertura de puerto HTTP y verificación de SELinux

```bash
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --reload
getenforce   # debe devolver "Enforcing"
getsebool httpd_can_network_connect_db httpd_can_network_connect
```

Ambos booleans de SELinux quedaron en "on" automáticamente, configurados por el propio script `setup-web.sh` de pgAdmin — no fue necesario relajar la política manualmente ni desactivar SELinux.

### 9.2 Verificación end-to-end

1. Se accedió desde el navegador a `http://<IP_NAT_VM1>/pgadmin4/`
2. Login con `admin@ciber5.com` / *(contraseña no publicada en el repo)*
3. Se registró el servidor "db-server (VM2)" apuntando a `192.168.100.20:5432`, usuario `postgres`.
4. Se abrió el Query Tool sobre la base `tramites_demo` y se ejecutó `SELECT * FROM demo_tramite;` obteniendo la fila de ejemplo cargada previamente.

Resultado: conexión exitosa de punta a punta — navegador → Apache → pgAdmin4 → red interna `192.168.100.0/24` → PostgreSQL en VM2 — respetando el firewall y SELinux enforcing configurados en las secciones anteriores.

## 10. Checkpoint solicitado por el profesor: aplicación real de login y gestión de usuarios

Tras recibir la aclaración exacta del pedido por parte del profesor — una máquina con Apache corriendo, otra con la base de datos, y una interfaz propia con pantalla de login y otra pantalla para crear/eliminar usuarios reflejando los cambios en la base de datos — se construyó una aplicación propia en PHP sobre el Apache ya instalado en VM1.

### 10.1 Instalación de PHP 8.3 con soporte PostgreSQL en VM1

> **Nota:** el repositorio de pgAdmin4 (agregado en el checkpoint anterior) presentó un error de verificación de firma GPG al ejecutar cualquier comando dnf en VM1. Se resolvió sin desinstalar nada, simplemente ignorando ese repositorio puntualmente con `--disablerepo=pgAdmin4` en los comandos de instalación de PHP.

```bash
sudo dnf module enable -y php:8.3 --disablerepo=pgAdmin4
sudo dnf install -y php php-pgsql php-pdo php-session --disablerepo=pgAdmin4
sudo systemctl enable --now php-fpm
sudo systemctl restart httpd
```

> **Nota:** en Rocky Linux 9 ya no existe `mod_php` para PHP 8.x — Apache sirve PHP exclusivamente vía PHP-FPM (FastCGI). El paquete `php` instala automáticamente la configuración de integración en `/etc/httpd/conf.d/php.conf`; solo hizo falta habilitar y arrancar el servicio `php-fpm`.

### 10.2 Tabla de usuarios de la aplicación en PostgreSQL (VM2)

```bash
sudo -u postgres psql -d tramites_demo -c \
  "CREATE TABLE app_usuarios (id SERIAL PRIMARY KEY, username VARCHAR(50) UNIQUE NOT NULL,
   password_hash TEXT NOT NULL, creado_en TIMESTAMP DEFAULT now());"
```

Se generó un usuario administrador semilla, con el hash de contraseña calculado con la misma función que usa la aplicación (bcrypt vía `password_hash` de PHP), para garantizar compatibilidad con `password_verify`:

```bash
php -r "echo password_hash('<PASSWORD_NO_PUBLICADA>', PASSWORD_BCRYPT), PHP_EOL;"
# Con el hash resultante:
sudo -u postgres psql -d tramites_demo -c \
  "INSERT INTO app_usuarios (username, password_hash) VALUES ('admin', '<hash_generado>');"
```

### 10.3 Estructura de la aplicación en VM1

Archivos PHP ubicados en `/var/www/html/gestion/`, propiedad de `apache:apache` y con contexto SELinux `httpd_sys_content_t` (aplicado con `restorecon`):

```
db.php         → conexión PDO a PostgreSQL (host 192.168.100.20, dbname tramites_demo)
login.php      → pantalla de login: valida usuario/contraseña con password_verify()
                  contra la tabla app_usuarios, usa sesiones PHP
dashboard.php  → pantalla protegida (requiere sesión activa): formulario para crear
                  usuario (INSERT + password_hash) y tabla con botón Eliminar por fila
                  (DELETE), protegido con token CSRF por sesión
logout.php     → destruye la sesión y redirige al login
index.php      → redirige a login o dashboard según haya sesión activa
```

> **Nota:** medidas de seguridad aplicadas en la aplicación: contraseñas siempre hasheadas con bcrypt (nunca en texto plano), consultas SQL parametrizadas con PDO (sin concatenación de strings, previene inyección SQL), token CSRF por sesión en los formularios de creación y borrado, y el propio usuario logueado no puede eliminarse a sí mismo.

### 10.4 Despliegue

```bash
sudo mkdir -p /var/www/html/gestion
# transferencia de los 5 archivos .php por scp
sudo chown -R apache:apache /var/www/html/gestion
sudo chmod -R 644 /var/www/html/gestion/*.php
sudo restorecon -Rv /var/www/html/gestion
```

### 10.5 Verificación end-to-end

1. Login en `http://<IP_NAT_VM1>/gestion/` con `admin` / *(contraseña no publicada en el repo)* → acceso concedido al dashboard.
2. Se creó el usuario "funcionario1" desde el formulario del dashboard → mensaje de éxito en pantalla.
3. Se verificó por SELECT directo en `psql` (VM2) que el registro nuevo efectivamente llegó a la tabla `app_usuarios` — no solo el mensaje de la aplicación.
4. Se eliminó "funcionario1" desde el botón de la tabla → mensaje de éxito en pantalla.
5. Se verificó por SELECT directo en `psql` (VM2) que el registro fue efectivamente borrado de la base.

Resultado: flujo completo de autenticación y gestión de usuarios (crear/eliminar) funcionando de punta a punta, con persistencia real verificada en PostgreSQL — no solo mensajes de interfaz.

### 10.6 Ajuste de nombre en pantalla

El nombre en las pantallas de login y dashboard de esta aplicación de checkpoint pasó por dos ajustes: primero se retiró la referencia al nombre de trabajo original ("Panamá Conecta") por uno neutro ("Sistema de Gestión de Usuarios"), y luego se reemplazó por el nombre definitivo del proyecto: **SIGET — Sistema de Gestión y Trazabilidad**.

## 10.7 Crear cuenta y restablecer contraseña

Pedido explícito para que la pantalla de login tenga, además del ingreso con el usuario semilla, las opciones de autorregistro y recuperación de contraseña visibles — el profesor también va a interactuar con esto.

Dos archivos nuevos en `/var/www/html/gestion/`:

```
register.php        → formulario de alta de cuenta: usuario + contraseña + confirmación.
                       Valida longitud mínima, usuario único, hashea con bcrypt.
reset-password.php   → restablecimiento directo: usuario + contraseña nueva + confirmación.
```

`login.php` se actualizó con dos enlaces ("Crear cuenta" / "Olvidé mi contraseña") y mensajes de confirmación después de cada acción (`?registrado=1`, `?reset_ok=1`).

> **Nota — limitación deliberada, documentada en la propia pantalla**: `reset-password.php` NO envía un correo con un enlace de un solo uso, porque el entorno de laboratorio no tiene servidor de correo (SMTP) configurado. El restablecimiento es directo: se pide el usuario y la contraseña nueva en el mismo formulario. La página lo aclara explícitamente al usuario. En la arquitectura final (Django + email transaccional) esto se reemplaza por un token de un solo uso enviado por correo, con expiración.

> **Nota — mitigación de enumeración de usuarios**: `reset-password.php` redirige al mismo mensaje de éxito exista o no el usuario ingresado, para que el formulario no sirva para averiguar qué nombres de usuario están registrados.

Despliegue:

```bash
sudo cp login.php register.php reset-password.php /var/www/html/gestion/
sudo chown apache:apache /var/www/html/gestion/{login,register,reset-password}.php
sudo restorecon /var/www/html/gestion/{login,register,reset-password}.php
```

Verificación end-to-end:

1. Se creó una cuenta de prueba desde `register.php` → verificado con SELECT directo en `psql` (VM2) que el usuario quedó en `app_usuarios`.
2. Login exitoso con esa cuenta recién creada.
3. Se restableció la contraseña de esa cuenta desde `reset-password.php`.
4. Login con la contraseña **nueva** → éxito. Login con la contraseña **vieja** → rechazado.
5. Cuenta de prueba eliminada al terminar la verificación (dato de testing, no de producto).

## 10.8 Control de acceso: mensaje de "Acceso denegado" y rate limiting (3 intentos)

Pedido explícito: cuando la contraseña es incorrecta, el sistema debe decirlo claramente ("Acceso denegado") y bloquear la cuenta temporalmente tras varios intentos fallidos — protección básica contra fuerza bruta.

### Cambios en la base de datos (VM2)

```bash
sudo -u postgres psql -d tramites_demo -c "ALTER TABLE app_usuarios ADD COLUMN IF NOT EXISTS intentos_fallidos INT NOT NULL DEFAULT 0;"
sudo -u postgres psql -d tramites_demo -c "ALTER TABLE app_usuarios ADD COLUMN IF NOT EXISTS bloqueado_hasta TIMESTAMP NULL;"
```

### Lógica en `login.php`

- Máximo **3 intentos** fallidos (`MAX_INTENTOS`), bloqueo de **5 minutos** (`MINUTOS_BLOQUEO`).
- Cada intento fallido con un usuario que existe suma 1 a `intentos_fallidos` y muestra cuántos intentos quedan.
- Al llegar a 3, se guarda `bloqueado_hasta = now() + 5 minutos` y el mensaje pasa a "Acceso denegado: superaste el máximo de intentos...".
- Mientras `bloqueado_hasta` siga en el futuro, **ni siquiera la contraseña correcta funciona** — se rechaza con el mensaje de bloqueo.
- Al vencer el bloqueo, un login exitoso resetea `intentos_fallidos` a 0 y `bloqueado_hasta` a `NULL`.
- Usuario inexistente: mismo mensaje genérico de "Acceso denegado", sin distinguir si el usuario existe o no (evita enumeración de cuentas).

### Gotcha — dos bugs encontrados y corregidos antes de dar el fix por bueno

1. **Comparación de fechas hecha en PHP en vez de en la base**: la primera versión traía `bloqueado_hasta` a PHP y comparaba con `strtotime(...) > time()`. Esto rompía porque `strtotime()` interpreta el string del timestamp con la zona horaria por defecto de PHP, que no necesariamente coincide con la del servidor de PostgreSQL — el bloqueo parecía "ya vencido" apenas se guardaba. **Fix**: la comparación se mueve a la propia consulta SQL (`bloqueado_hasta > now()`), evitando el desajuste de zona horaria por completo.
2. **Tipo de dato incorrecto al leer el booleano de Postgres**: se esperaba que PDO devolviera el `BOOLEAN` de Postgres como el string `'t'`/`'f'`, pero en este entorno (PHP 8.3 + PDO_PGSQL) lo devuelve como `bool` nativo de PHP. La comparación `=== 't'` era siempre falsa. Se detectó con un script de debug corriendo en el mismo contexto de Apache (`var_dump()` del resultado real). **Fix**: comparar contra `true` en vez de `'t'`.

### Verificación end-to-end (tras corregir ambos bugs)

1. 3 intentos con contraseña incorrecta → mensajes "Te queda(n) 2 / 1 intento(s)" y luego "Cuenta bloqueada por 5 minutos".
2. Intento con la contraseña **correcta** mientras el bloqueo sigue activo → rechazado con el mensaje de bloqueo (no entra).
3. Se simuló el vencimiento del bloqueo (`bloqueado_hasta` movido al pasado directamente en la BD, para no esperar 5 minutos reales) → login con contraseña correcta funciona y resetea `intentos_fallidos`/`bloqueado_hasta`.

## 10.9 Acceso desde otras máquinas de la red del aula

Pedido explícito: que compañeros y el profesor puedan entrar a la app desde sus propias computadoras, no solo desde la laptop donde corren las VMs.

Las VMs solo tienen IP en redes virtuales de VMware (NAT `192.168.159.0/24` e interna `192.168.100.0/24`), no directamente alcanzables desde la red WiFi del aula. Se evaluaron dos opciones:

| Opción | Descripción | Elegida |
|---|---|---|
| Adaptador puenteado (bridged) | VM1 obtiene IP propia en la red del aula, como una PC más de esa red | No — mayor superficie expuesta, y depende de que la red del aula permita DHCP a dispositivos nuevos (muchas redes institucionales lo bloquean) |
| Port forwarding por NAT | La laptop reenvía un puerto propio hacia VM1, sin exponer la VM directamente a la red | **Sí** |

### Configuración aplicada

1. **VMware Workstation Pro** → `Edit → Virtual Network Editor → Change Settings` → seleccionar la red **NAT** → **NAT Settings...** → **Add** un reenvío: puerto de host `8080` (TCP) → `192.168.159.137:80` (VM1). Esto se guarda en `C:\ProgramData\VMware\vmnetnat.conf`, sección `[incomingtcp]`:
   ```
   8080 = 192.168.159.137:80
   ```
   (Este archivo solo lo puede editar una cuenta con permisos de administrador de Windows — por eso el cambio se hizo desde la UI de VMware, no por edición directa.)

2. **Firewall de Windows**, regla de entrada restringida a la subred del aula (no abierta a cualquier IP de internet):
   ```powershell
   New-NetFirewallRule -DisplayName "SIGET app (VM1 port forward)" -Direction Inbound -Protocol TCP -LocalPort 8080 -RemoteAddress 172.29.16.0/20 -Action Allow
   ```

### Verificación

```bash
curl http://172.29.31.48:8080/gestion/login.php   # IP de la laptop en la red WiFi del aula
```

Devolvió `200 OK` con el `<title>Ingresar - SIGET</title>` esperado — confirma que el reenvío llega hasta Apache en VM1 pasando por NAT.

> **Acceso para compañeros/profesor**: `http://172.29.31.48:8080/gestion/` (la IP puede cambiar si la laptop se reconecta a la WiFi y le asignan otra por DHCP — verificar con `ipconfig` antes de compartir el link si pasó tiempo).

### Intento descartado: túnel público (cloudflared)

Se evaluó exponer la app directamente a internet con un túnel rápido de Cloudflare (`cloudflared tunnel --url http://localhost:80`, sin necesidad de cuenta) para no depender de la red del aula. **El propio entorno de trabajo bloqueó la ejecución** (clasificador de seguridad de la sesión, categoría "External Ingress Tunnel") antes de completarse — no llegó a levantarse ningún túnel. Se descartó esta vía en favor de Tailscale (sección 10.9.1), que da acceso privado en vez de exponer la app a cualquiera en internet.

## 10.9.1 Acceso por Tailscale (solución definitiva de red)

El port forwarding por NAT (arriba) no funcionó para los compañeros — la hipótesis, no confirmada de forma concluyente pero consistente con la evidencia, es **aislamiento de clientes (AP/client isolation)** en la red WiFi del aula (`Hw_Estudiantes 2`, perfil `Public` en Windows), común en redes institucionales para evitar que los dispositivos conectados se vean entre sí. Ni el firewall de Windows ni el de la VM estaban bloqueando nada — ambos ya permitían el tráfico correctamente.

**Solución adoptada**: red privada mesh con [Tailscale](https://tailscale.com), que no depende del enrutamiento de la red del aula — cada máquina se conecta directo a las demás por un túnel cifrado, sin importar detrás de qué NAT/firewall/aislamiento esté cada una.

> **Importante**: la laptop del desarrollador ya tenía Tailscale instalado, pero conectado a una tailnet compartida con otras cuentas y dispositivos ajenos al proyecto (`kw-piopio-*`, otra cuenta de usuario). **Se decidió explícitamente NO sumar las VMs a esa tailnet** y crear una cuenta de Tailscale nueva y dedicada solo al proyecto SIGET, para no mezclar el acceso del grupo con infraestructura ajena.

### Instalación en VM1 y VM2

```bash
# En cada VM:
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up --auth-key=<AUTH_KEY> --hostname=<nombre-descriptivo>
```

Se usó una **auth key** (generada desde el panel de la tailnet nueva) para automatizar el alta sin necesitar abrir un navegador dentro de la VM. `--hostname` se usó para que cada VM aparezca identificada claramente en la tailnet (`siget-app-backend`, `siget-db-server`) en vez del hostname genérico.

> **Nota de seguridad sobre las auth keys**: las auth keys usadas acá se compartieron por chat durante la sesión de trabajo — quedaron registradas en el historial de la conversación (no en el repositorio de git, eso es distinto). Se recomienda **revocarlas/regenerarlas desde el panel de Tailscale** después del alta inicial, igual criterio que con cualquier secreto que pasó por texto plano en algún momento.

### Verificación de firewall

`firewalld` en ambas VMs asigna la interfaz `tailscale0` a la **zona por defecto** (no aparece en la lista explícita de interfaces de la zona `public`, pero cae ahí por ser la zona default):

```bash
sudo firewall-cmd --get-default-zone        # public
sudo firewall-cmd --get-zone-of-interface=tailscale0   # "no zone" -> cae en la default
```

Como la zona `public` ya tenía `http` habilitado sin restricción de origen (de la sección 9.1), el tráfico por Tailscale hacia el puerto 80 de VM1 quedó permitido automáticamente, sin tocar reglas nuevas. **El firewall de VM2 no se modificó** — PostgreSQL sigue aceptando conexiones solo desde `192.168.100.10` (VM1), Tailscale ahí solo habilita SSH/gestión, no expone la base de datos directamente a la tailnet.

### Verificación end-to-end

```bash
curl http://100.104.206.118/gestion/login.php   # IP Tailscale de VM1 (siget-app-backend)
```

`200 OK` con el `<title>` correcto, probado desde la laptop del desarrollador (que también está en la misma tailnet).

> **Acceso definitivo para compañeros/profesor**: cada uno instala el cliente de Tailscale, se une a la tailnet del proyecto (invitación desde el panel de administración), y entra a `http://100.104.206.118/gestion/` — esta IP no cambia aunque cambien de red física, a diferencia de la IP de WiFi del port forwarding.

## 11. Estado final de acceso (referencia rápida)

| Recurso | Valor |
|---|---|
| VM1 (app-backend) IP NAT | 192.168.159.137 |
| VM1 (app-backend) IP interna | 192.168.100.10 |
| VM2 (db-server) IP NAT | 192.168.159.138 |
| VM2 (db-server) IP interna | 192.168.100.20 |
| Usuario Linux (ambas VMs) | jeison_vasquez |
| App de gestión de usuarios (entrega real) | http://192.168.159.137/gestion/ |
| Usuario de la app (semilla) | admin |
| pgAdmin4 URL (capacidad adicional) | http://192.168.159.137/pgadmin4/ |
| pgAdmin4 usuario | admin@ciber5.com |
| PostgreSQL usuario | postgres |
| Base de datos demo | tramites_demo |
| Tabla de usuarios de la app | app_usuarios |

> **Nota:** las contraseñas de servicio (PostgreSQL, pgAdmin) no se incluyen en este documento por buena práctica documental; están registradas en el informe interno del proyecto y deben rotarse antes de cualquier entrega pública o despliegue fuera del laboratorio.
