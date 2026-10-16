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
ssh-keygen -t ed25519 -f ~/.ssh/ciber5_vm1 -N "" -C "equipo-siget-vm1"
ssh-keygen -t ed25519 -f ~/.ssh/ciber5_vm2 -N "" -C "equipo-siget-vm2"
```

### 2.2 Copia de la clave pública a cada VM

El portapapeles de VMware Tools no funciona en consolas de texto sin entorno gráfico, así que copiar y pegar el comando directamente en la consola de VMware no fue posible. La solución fue usar `ssh-copy-id` desde la propia terminal del desarrollador (Git Bash en Windows), que solicita la contraseña una única vez:

```bash
ssh-copy-id -i ~/.ssh/ciber5_vm1.pub jeison_vasquez@<IP_NAT_VM1>
ssh-copy-id -i ~/.ssh/ciber5_vm2.pub jeison_vasquez@<IP_NAT_VM2>
```

> **Nota:** regla de seguridad seguida durante todo el proceso: ninguna contraseña personal del usuario se tipeó ni se manejó dentro de los scripts de configuración automatizados. Todo comando que requería una contraseña interactiva se ejecutó por el propio desarrollador en su terminal.

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

Se evaluó exponer la app directamente a internet con un túnel rápido de Cloudflare (`cloudflared tunnel --url http://localhost:80`, sin necesidad de cuenta) para no depender de la red del aula. **Se descartó esta opción por política de seguridad del equipo** antes de completarla — no llegó a levantarse ningún túnel, ya que exponer la aplicación a cualquiera en internet no era aceptable solo para resolver un problema de acceso local. Se optó por Tailscale (sección 10.9.1), que da acceso privado en vez de exposición pública.

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
| Usuario Linux administrador (ambas VMs) | jeison_vasquez |
| Usuarios Linux del equipo (ambas VMs) | `nombre_apellido`, ver sección 13 |
| Acceso del equipo (recomendado) | Tailscale: VM1 `100.104.206.118`, VM2 `100.120.115.100` (las IP NAT solo sirven desde la máquina del anfitrión) |
| App de gestión de usuarios (entrega real) | http://192.168.159.137/gestion/ |
| Usuario de la app (semilla) | admin |
| pgAdmin4 URL (capacidad adicional) | http://192.168.159.137/pgadmin4/ |
| pgAdmin4 usuario | admin@ciber5.com |
| PostgreSQL usuario | postgres |
| Base de datos demo | tramites_demo |
| Tabla de usuarios de la app | app_usuarios |

> **Nota:** las contraseñas de servicio (PostgreSQL, pgAdmin) no se incluyen en este documento por buena práctica documental; están registradas en el informe interno del proyecto y deben rotarse antes de cualquier entrega pública o despliegue fuera del laboratorio.

## 12. Podman rootless + Quadlet en VM1 (primer bloque de la Fase 2)

Fecha de ejecución: 10 de octubre de 2026. Ejecutado por Andy Martínez (usuario `andy_martinez`) en VM1 (`app-backend`), con la aprobación explícita de Jeison. El plan completo, con los riesgos y las decisiones pendientes, está en [`infra/podman/plan-podman-quadlet.md`](../infra/podman/plan-podman-quadlet.md).

### 12.1 Estado previo

Comprobado por SSH (por la IP de Tailscale de VM1) con comandos de solo lectura:

- Rocky Linux 9.7 (Blue Onyx).
- `podman` y `git` no instalados (`orden no encontrada`).
- El usuario `andy_martinez` pertenece al grupo `ciber5` y requiere contraseña para usar `sudo`.

### 12.2 Instalación de Podman

```bash
sudo dnf install podman
```

Instaló `podman 5.8.2` y sus dependencias (`container-selinux`, `crun`, `netavark`, `aardvark-dns`, `passt`, `fuse-overlayfs`, entre otras) y actualizó `selinux-policy` y `selinux-policy-targeted`, necesarios para `container-selinux`. La sesión SSH se cortó durante la instalación (`client_loop: send disconnect: Connection reset`); al reconectar se verificó que Podman quedó instalado:

```bash
podman --version      # podman version 5.8.2
getenforce            # Enforcing
```

SELinux se mantuvo en `Enforcing` en todo momento.

### 12.3 Verificación del modo rootless

```bash
grep andy_martinez /etc/subuid /etc/subgid
# /etc/subuid:andy_martinez:296608:65536
# /etc/subgid:andy_martinez:296608:65536
podman info --format '{{.Host.Security.Rootless}}'    # true
```

El usuario ya tenía un rango de 65536 UIDs/GIDs asignado, por lo que no hizo falta modificar `/etc/subuid` ni `/etc/subgid`.

### 12.4 Contenedor de prueba

```bash
podman run --rm quay.io/podman/hello
podman ps -a        # vacío (--rm eliminó el contenedor)
podman images       # quay.io/podman/hello  latest
```

Descargó la imagen y mostró el mensaje "Hello Podman World". Quedó solo la imagen descargada, en `~/.local/share/containers` del usuario.

### 12.5 Verificación de SELinux

```bash
sudo ausearch -m avc -ts today
# <no matches>
```

Sin denegaciones de SELinux durante la instalación ni las pruebas.

### 12.6 Primera unidad Quadlet

Archivo `~/.config/containers/systemd/siget-prueba.container` (copia en `infra/podman/vm1-app-backend/siget-prueba.container`):

```ini
[Unit]
Description=Contenedor de prueba SIGET (Quadlet)

[Container]
Image=registry.access.redhat.com/ubi9/ubi-minimal:latest
ContainerName=siget-prueba
Exec=sleep infinity
```

Es un contenedor de prueba que solo espera: no abre puertos y no toca Apache ni la app del checkpoint.

```bash
systemctl --user daemon-reload
systemctl --user list-unit-files | grep siget-prueba     # siget-prueba.service  generated
systemctl --user start siget-prueba.service
systemctl --user status siget-prueba.service --no-pager  # active (running)
podman ps                                                # siget-prueba, Up
systemctl --user restart siget-prueba.service
podman ps                                                # nuevo ID de contenedor: se recreó
```

Resultado: Quadlet generó `siget-prueba.service` a partir del archivo; el servicio corre bajo `user-1003.slice`, es decir, sin root. Tras el `restart`, el ID del contenedor cambió (`f6b70addf2d0` → `41c2ef63c58e`), lo que confirma que systemd lo detuvo y lo volvió a crear.

```bash
loginctl show-user andy_martinez | grep Linger     # Linger=no
```

Con `Linger=no`, los contenedores del usuario se detienen al cerrar su última sesión. Activar el linger queda pendiente (ver 12.8).

### 12.7 Gotcha: bloques multilínea pegados en la terminal SSH

Pegar de una vez un bloque con `cat > archivo << 'EOF' ... EOF` en la terminal SSH aplastó todo en una sola línea y no se pudo ejecutar. Solución: crear el archivo con un `echo "..." > archivo` para la primera línea y `echo "..." >> archivo` para cada línea siguiente, y comprobar el resultado con `cat`.

### 12.8 Pendiente de este bloque

- ~~Instalar Podman en VM2 (`db-server`) y repetir las verificaciones.~~ Hecho el 15-oct, ver 12.9.
- Decidir qué usuario corre los contenedores del proyecto (usuario de servicio dedicado o el de cada integrante) y activar el linger en ese usuario: `sudo loginctl enable-linger <usuario>`.
- Resolver los puertos 80 y 443 en VM1 (Apache los ocupa y los contenedores rootless no pueden usar puertos menores a 1024 por defecto).
- Decidir qué se hace con el contenedor de prueba `siget-prueba`. Con `Linger=no` solo corre mientras `andy_martinez` tiene una sesión abierta; al cerrarla systemd lo detiene. No se elimina sin aprobación de Jeison.
- Git no está instalado en las VMs; no es necesario, porque el código se trabaja desde la PC de cada integrante.

### 12.9 Podman rootless en VM2 (`db-server`)

Fecha: 15 de octubre de 2026, tarea 1.2 del plan de las semanas 1 y 2. Ejecutado por Jeison desde su cuenta con sudo (decisión D3: no se dio sudo adicional a nadie).

```bash
sudo nohup bash -c "dnf install -y podman > /tmp/dnf-podman.log 2>&1; echo EXIT=\$? >> /tmp/dnf-podman.log" &
```

Se lanzó con `nohup` dentro de la VM porque en VM1 la sesión SSH se cortó durante la instalación (se actualiza `selinux-policy`). Resultado: `EXIT=0`, sin cortes.

Verificación:

- `podman --version` informa 5.8.2, con `container-selinux`, `crun`, `netavark`, `aardvark-dns` y `passt` instalados. Es la misma versión que en VM1.
- SELinux sigue en `Enforcing` y `ausearch -m avc` no registra denegaciones.
- Como `siget`: `podman info` informa `rootless=true`, driver `overlay` y red `netavark`; `podman run --rm quay.io/podman/hello` funciona.
- El firewall no cambió (`dhcpv6-client ssh` y la regla del 5432 solo desde `192.168.100.10`) y el PostgreSQL nativo sigue activo, así que el checkpoint no se tocó.

Gotcha: el servicio de PostgreSQL se llama `postgresql`, no `postgresql-16`; `systemctl is-active postgresql-16` responde `inactive` aunque la base esté funcionando.

## 13. Cuentas de Linux del equipo y sudo

Fecha: 10 y 15 de octubre de 2026. Ejecutado por Jeison, en VM1 y VM2. Detalle y guía de uso en [`acceso-equipo.md`](./acceso-equipo.md).

### 13.1 Creación de las cuentas

Se creó una cuenta por integrante con formato `nombre_apellido` (`simna_degracia`, `gabriel_gonzalez`, `andy_martinez`, `joel_medina`, `jorge_medina`, `bradley_morales`, `anyurie_sanchez`, `walter_sanjur`), todas en el grupo `ciber5`, sin contraseña utilizable y con el directorio `~/.ssh` preparado:

```bash
sudo groupadd ciber5
sudo useradd -m -s /bin/bash -c "Nombre Apellido" -G ciber5 nombre_apellido
sudo passwd -l nombre_apellido
sudo install -d -m 700 -o nombre_apellido -g nombre_apellido /home/nombre_apellido/.ssh
sudo install -m 600 -o nombre_apellido -g nombre_apellido /dev/null /home/nombre_apellido/.ssh/authorized_keys
sudo restorecon -R /home/nombre_apellido/.ssh
```

Verificación: `getent group ciber5` lista las 8 cuentas en ambas VMs y `sudo -l -U joel_medina` responde "not allowed to run sudo".

### 13.2 Carga de claves públicas

Cada integrante genera su clave con `ssh-keygen -t ed25519` y entrega **solo la pública**. Antes de cargarla se valida su formato y huella con `ssh-keygen -l -f`, y se agrega a `authorized_keys` en ambas VMs con propietario y permisos correctos (`.ssh` en 700, `authorized_keys` en 600) y el contexto SELinux `ssh_home_t` (`restorecon`). Estado al 15-oct: solo `andy_martinez` tiene su clave cargada; faltan los otros siete integrantes.

### 13.3 Sudo de `andy_martinez`

Autorizado por Jeison el 10-oct para poder instalar Podman. Como su cuenta no tiene contraseña, la regla es `NOPASSWD`, solo en VM1:

```bash
echo "andy_martinez ALL=(ALL) NOPASSWD: ALL" | sudo tee /etc/sudoers.d/andy_martinez
sudo chmod 440 /etc/sudoers.d/andy_martinez
sudo visudo -cf /etc/sudoers.d/andy_martinez    # parsed OK
```

Es sudo completo. Para revocarlo: `sudo rm /etc/sudoers.d/andy_martinez`. No tiene sudo en VM2.

### 13.4 Gotcha: el sudo de Andy no dejó registro consultable

El journal de las VMs no conservó los comandos `sudo` ejecutados por Andy el 10-oct (no hay persistencia o se perdió tras un reinicio). La instalación de Podman se verificó por `dnf history` y `rpm -q`. Resuelto el 15-oct con el journal persistente (ver 14.6); `auditd` queda como mejora opcional.

## 14. Endurecimiento de SSH y firewall

Fecha: 15 de octubre de 2026, con aprobación explícita de Jeison. Detalle completo en [`endurecimiento-vms.md`](./endurecimiento-vms.md).

### 14.1 Origen

La auditoría de los cambios de Podman contra los estándares del proyecto encontró desvíos preexistentes: SSH aceptaba contraseña en ambas VMs, `cockpit` estaba permitido en firewalld y PostgreSQL escucha en `0.0.0.0:5432`.

### 14.2 SSH solo por clave (VM1 y VM2)

```bash
printf 'PasswordAuthentication no
KbdInteractiveAuthentication no
' | sudo tee /etc/ssh/sshd_config.d/40-siget-hardening.conf
sudo sshd -t && sudo systemctl reload sshd
sudo sshd -T | grep -iE '^(passwordauthentication|kbdinteractiveauthentication)'
```

Se aplicó con la sesión abierta, validando con `sshd -t` y probando una conexión nueva por clave antes de cerrar. Verificación: sesión por clave correcta y el intento por contraseña responde `Permission denied (publickey,gssapi-keyex,gssapi-with-mic)`.

### 14.3 Cockpit fuera del firewall

```bash
sudo firewall-cmd --permanent --remove-service=cockpit && sudo firewall-cmd --reload
```

Resultado: VM1 expone `dhcpv6-client http ssh`; VM2 `dhcpv6-client ssh`, más la regla del 5432 solo desde `192.168.100.10`, que sigue intacta.

### 14.4 Reversión

Borrar `/etc/ssh/sshd_config.d/40-siget-hardening.conf` y recargar sshd. Para Cockpit: `sudo firewall-cmd --permanent --add-service=cockpit && sudo firewall-cmd --reload`.

### 14.5 Pendiente

- PostgreSQL escucha en `0.0.0.0:5432` (contenido por el firewall). El spec pide bind solo a la IP interna; se corrige al migrar a contenedor.
- Las cuentas sin clave cargada ya no tienen ninguna vía de acceso por SSH.

### 14.6 Journal persistente (trazabilidad del uso de sudo)

Antes, el journal de las VMs era volátil (no existía `/var/log/journal`) y se perdía al reiniciar, por eso no había registro de los `sudo` de Andy (13.4). El 15 de octubre se activó el almacenamiento persistente en VM1 y VM2:

```bash
sudo mkdir -p /var/log/journal
printf '[Journal]
Storage=persistent
SystemMaxUse=200M
' | sudo tee /etc/systemd/journald.conf.d/40-siget-persistente.conf
sudo systemd-tmpfiles --create --prefix /var/log/journal
sudo systemctl restart systemd-journald && sudo journalctl --flush
```

Verificación: `/var/log/journal` existe con contexto SELinux `var_log_t`, `systemd-journald` activo y `journalctl --disk-usage` informa 16 MB en ambas VMs. Desde ahora `sudo journalctl _COMM=sudo` conserva el historial entre reinicios. El tope de 200 MB evita que el journal crezca sin control.

**Gotcha:** el primer script se colgó al final (la sesión SSH no volvió) aunque la configuración ya estaba aplicada. Se repitió con `timeout` en los comandos de recarga y funcionó. Conviene usar siempre `timeout` al reiniciar servicios de logging por SSH.

## 15. Usuario de servicio `siget` para los contenedores

Fecha: 15 de octubre de 2026. Decisión D1 del [plan de las semanas 1 y 2](./architecture/plan-semanas-1-2.md), tomada por Jeison: los contenedores del proyecto corren bajo un usuario de servicio dedicado y no bajo la cuenta de un integrante, para que el sistema no dependa de una persona. Tarea 1.1 del plan.

### 15.1 Creación (VM1 y VM2)

```bash
sudo useradd -m -s /bin/bash -c "Usuario de servicio SIGET (contenedores)" siget
sudo passwd -l siget
sudo chmod 750 /home/siget
sudo loginctl enable-linger siget
```

Resultado en ambas VMs: `uid=1009(siget)`, rango subuid/subgid `689824:65536` asignado automáticamente por `useradd`, contraseña bloqueada, sin directorio `~/.ssh` y sin sudo.

### 15.2 Verificación

- `loginctl show-user siget` informa `Linger=yes` y `State=lingering`, y existe `/run/user/1009`: el gestor de usuario de systemd arranca con el sistema, así que sus contenedores sobreviven al cierre de cualquier sesión.
- En VM1, `podman info` como `siget` informa `rootless=true` y `systemctl --user is-system-running` responde `running`.
- En VM2 el usuario existe y tiene linger, pero Podman aún no está instalado (tarea 1.2).

### 15.3 Cómo se usa

`siget` **no admite acceso por SSH** (sin contraseña ni claves). Se opera desde una cuenta con sudo:

```bash
sudo -H -u siget bash -c 'cd ~ && XDG_RUNTIME_DIR=/run/user/$(id -u) systemctl --user status'
```

Las unidades Quadlet del proyecto van en `/home/siget/.config/containers/systemd/`.

### 15.4 Gotchas

- Ejecutar `sudo -u siget podman …` desde un directorio que `siget` no puede leer (por ejemplo el home de otro usuario) falla con `Error: setting up the process`. Hay que hacer `cd ~` antes, como en el comando de arriba.
- Hay que fijar `XDG_RUNTIME_DIR=/run/user/<uid>` para que `systemctl --user` y Podman encuentren el bus del usuario.
- El script de creación se colgó en VM2 pasados los 90 segundos aunque todo ya estaba aplicado; conviene usar `timeout` y verificar el estado por separado.

### 15.5 Pendiente

- Retirar el contenedor de prueba de `andy_martinez` y recrearlo bajo `siget` (decisión D4, requiere aprobación de Jeison).
- Instalar Podman en VM2 (tarea 1.2).
- El acceso a los puertos 80/443 en VM1 sigue pendiente de la decisión D2.

## 16. Respaldo de la base de datos antes de la migración a contenedor

Fecha: 15 de octubre de 2026, tarea 2.1 del plan de las semanas 1 y 2. Ejecutado por Jeison en VM2 (`db-server`), PostgreSQL 16.15 nativo. Es de solo lectura: no modifica la base.

### 16.1 Contenido respaldado

| Base | Tamaño | Datos |
|---|---|---|
| `tramites_demo` | 7,9 MB | `app_usuarios` (8 filas) y `demo_tramite` (1 fila) |
| `postgres` | 7,7 MB | Sin datos del proyecto (no se respalda) |

### 16.2 Comandos

```bash
sudo install -d -m 700 -o postgres -g postgres /var/backups/siget
sudo -u postgres pg_dump -Fc -d tramites_demo -f /var/backups/siget/tramites_demo-AAAAMMDD-HHMM.dump
sudo -u postgres pg_dump -Fp --no-owner -d tramites_demo -f /var/backups/siget/tramites_demo-AAAAMMDD-HHMM.sql
sudo -u postgres pg_dumpall --globals-only -f /var/backups/siget/globals-AAAAMMDD-HHMM.sql
```

Se generaron tres archivos con permisos 600 en un directorio 700: el volcado en formato personalizado (`.dump`, 6 KB), el mismo contenido en SQL plano (4,6 KB) y los roles de PostgreSQL (`globals`, 671 bytes). El sello de este respaldo es `20261015-1608`.

### 16.3 Verificación

- `pg_restore --list` muestra los datos de `app_usuarios` y `demo_tramite`.
- **Prueba de restauración:** se restauró el `.dump` en una base temporal `restore_test`, que devolvió `app_usuarios=8` y `demo_tramite=1` (los mismos conteos que el original). Después se eliminó y se comprobó que no quedó rastro.
- La base original quedó intacta.

### 16.4 Copia fuera de la VM

Los archivos `.dump` y `.sql` de `tramites_demo` se copiaron al equipo de Jeison, **fuera del repositorio** (`Desktop/respaldos-siget/`), y sus hashes SHA-256 coinciden con los de la VM:

| Archivo | SHA-256 |
|---|---|
| `tramites_demo-20261015-1608.dump` | `eaed2ed5732c0871bf3025f13fbc2a10440484640958918c933d72fdb2c6e065` |
| `tramites_demo-20261015-1608.sql` | `16e31a9ac000c3c033d4234bb11b259d4557ea7da0882328580c3d1e2b541a9b` |

El archivo de roles (`globals`) **no se copió** fuera de la VM: contiene los hashes de contraseña de los roles de PostgreSQL.

### 16.5 Seguridad: estos archivos no van al repositorio

Los respaldos contienen los hashes bcrypt de las cuentas de la app, así que nunca se commitean. Se agregó `*.dump` y `globals-*.sql` a `.gitignore` como protección. `database/schema.sql` sigue versionado, porque es el esquema sin datos.

### 16.6 Cómo restaurar

```bash
sudo -u postgres createdb tramites_demo
sudo -u postgres pg_restore -d tramites_demo /var/backups/siget/tramites_demo-AAAAMMDD-HHMM.dump
```

### 16.7 Gotchas

- Un comodín como `chmod 600 /var/backups/siget/*` falla si el directorio es 700 y no pertenece a quien lo ejecuta, porque el shell lo expande antes de `sudo`. Hay que usar `sudo bash -c "chmod 600 …/*"`.
- Las VMs no tienen `rg`: los scripts remotos deben usar `grep`.
- `pg_stat_user_tables.n_live_tup` mostró 0 filas aunque había datos (las estadísticas no estaban actualizadas); para contar hay que usar `select count(*)`.

### 16.8 Pendiente

- Mantener este respaldo hasta verificar la migración (tarea 2.3). El PostgreSQL nativo **no se apaga** hasta entonces.
- Definir una retención y un respaldo periódico (por ejemplo, con un systemd timer) cuando la base esté en contenedor.

## 17. Roles de base de datos en marcha y cierre de la brecha del superusuario

Fecha: 15 de octubre de 2026, parte de la tarea 2.4 del plan de las semanas 1 y 2. Ejecutado por Jeison en VM2 y VM1, con su aprobación explícita. Se aplicó sobre la base nativa actual; la migración a contenedor (tareas 2.2 y 2.3) queda pendiente. Detalle del diseño en [`roles-permisos-bd.md`](./roles-permisos-bd.md).

### 17.1 Antes

La base tenía un único rol (`postgres`, superusuario), dueño de todo, y la app PHP del checkpoint se conectaba con él. Contradecía el principio Zero Trust de no operar con superusuario.

### 17.2 Respaldo previo

`pg_dump` (`pre-roles-AAAAMMDD-HHMM.dump`) y copia de `pg_hba.conf` en `/var/backups/siget/` de VM2, antes de tocar nada. La contraseña de `postgres` no se modificó hasta verificar el login.

### 17.3 Qué se aplicó (una sola transacción)

Ejecutado por `postgres` como arranque inicial, a partir de [`database/diseno-roles-permisos.sql`](../database/diseno-roles-permisos.sql):

- Esquema `siget` (8 tablas, 6 políticas RLS, 5 triggers) y roles `siget_owner`, `app_role` y `auditor_role` (los tres `NOLOGIN` por ahora: `app_role` se activará con su secret cuando exista Django).
- `checkpoint_app`: rol `LOGIN` de la app PHP, con `SELECT, INSERT, UPDATE, DELETE` **solo** sobre `app_usuarios` y `USAGE` de su secuencia. No puede leer `demo_tramite`, borrar tablas, crear objetos ni roles.
- `pgadmin_lectura`: rol `LOGIN` de solo lectura (`pg_read_all_data`, `pg_monitor`) para pgAdmin. No puede escribir y RLS le oculta los trámites.
- La base y las tablas del checkpoint pasaron a ser propiedad de `siget_owner`. `REVOKE ALL … FROM PUBLIC` sobre la base y las tablas.

### 17.4 Cambio en la app (VM1)

Se cambió `DB_USER` y `DB_PASSWORD` en `/var/www/html/gestion/config.php` por los de `checkpoint_app` (archivo local, fuera de git, `apache:apache` 640, contexto `httpd_sys_content_t`). La contraseña se generó al vuelo (28 caracteres aleatorios) y se escribió sin mostrarse. El respaldo del `config.php` anterior se movió a `/root/siget-backups/` (700), fuera del directorio web.

### 17.5 Cierre de la brecha: `postgres` ya no se usa

En `pg_hba.conf`, la regla `host all all 192.168.100.10/32` se reemplazó por:

```
host    all             postgres        192.168.100.10/32       reject
host    tramites_demo   checkpoint_app  192.168.100.10/32       scram-sha-256
host    all             pgadmin_lectura 192.168.100.10/32       scram-sha-256
```

`pg_hba_file_rules` no informa errores. Además se anuló la contraseña de `postgres` (`ALTER ROLE postgres PASSWORD NULL`): solo se entra con el usuario del sistema por socket local.

### 17.6 Verificación

- Registro, login (302 al dashboard, dashboard 200) y "Acceso denegado" con el contador de intentos funcionan igual que antes, ya con `checkpoint_app`. El bloqueo tras 3 intentos también (el `UPDATE` funciona con el rol nuevo).
- `checkpoint_app`: puede leer `app_usuarios`, pero `demo_tramite` y `siget.*` responden permiso denegado; no puede borrar ni crear tablas ni crear roles.
- Las 19 pruebas de `diseno-pruebas.sql` pasan contra el esquema real (`bash ~/siget-diseno/demo.sh`), con `ROLLBACK` de los datos de prueba.
- Los 8 usuarios del checkpoint siguen intactos. Se crearon y se borraron 3 usuarios de prueba (`zz_*`).
- El único rol superusuario es `postgres`, sin contraseña y rechazado por red.

### 17.7 pgAdmin: cambio de conexión

pgAdmin se conectaba como `postgres`; ya no puede. Hay que cambiar la conexión del servidor a **usuario `pgadmin_lectura`**. Su contraseña se guardó **solo en el equipo de Jeison**, fuera del repositorio (`Desktop/respaldos-siget/credencial-pgadmin-lectura.txt`). Es de solo lectura: no sirve para escribir en la base.

### 17.8 Incidente: contraseña expuesta en una salida

Al inspeccionar `config.php`, el filtro que enmascaraba contraseñas no coincidió con la línea `DB_PASSWORD` y la contraseña **anterior** de `postgres` quedó impresa en el registro de la sesión de trabajo. Está anulada (17.5), así que no es utilizable. Lección: para mostrar un archivo de configuración se filtra por el nombre exacto de la constante o no se muestra su contenido.

### 17.9 Gotchas

- Un `tee /dev/stderr` dentro de una sustitución de comandos se traga la salida: no usarlo para mostrar resultados.
- Los campos del formulario de registro son `username`, `password` y `password2`; una prueba con otro nombre devuelve 200 sin crear nada.
- `pg_hba_file_rules` devuelve arreglos en `database` y `user_name`: hay que usar `array_to_string`.

### 17.10 Pendiente

- Activar `LOGIN` de `app_role` con `podman secret` cuando exista el backend.
- Repetir esta configuración en el PostgreSQL en contenedor (tarea 2.2) y aplicar allí el esquema con el mismo script.
- Retirar la app PHP cuando Django la reemplace.

## 18. TLS entre la aplicación y la base de datos

Fecha: 15 de octubre de 2026, tarea ZT-2 de la [matriz de cobertura de Zero Trust](./zero-trust-cobertura.md) (principio 2: toda la comunicación se asegura sin importar la ubicación de red). Ejecutado por Jeison en VM2 y VM1, con su aprobación. Se aplicó al PostgreSQL nativo; se repetirá en el contenedor (tarea 2.2).

### 18.1 Antes

La conexión entre la app y la base viajaba sin cifrar por la red interna. Se comprobó con una prueba desde VM1: `sslmode=disable` conectaba con `ssl=false`.

### 18.2 Autoridad certificadora y certificado del servidor (VM2)

CA interna propia (`SIGET CA interna`, ECDSA P-256, 5 años) y certificado del servidor (1 año) con `subjectAltName` de la IP `192.168.100.20` y `db-server`. La **clave privada de la CA queda solo en `/root/siget-ca/` (700) de VM2**, para emitir futuros certificados; la clave del servidor está en `/var/lib/pgsql/data/tls/` (600, `postgres`, contexto `postgresql_db_t`).

```bash
openssl ecparam -name prime256v1 -genkey -noout -out ca.key
openssl req -x509 -new -key ca.key -sha256 -days 1825 -subj '/O=SIGET/OU=Ciberseguridad 5 UTP/CN=SIGET CA interna' -out ca.crt
# servidor: clave, CSR y firma con la CA, con SAN IP:192.168.100.20,DNS:db-server
```

PostgreSQL (`ALTER SYSTEM`, recarga sin reinicio): `ssl = on`, `ssl_cert_file`, `ssl_key_file` y `ssl_min_protocol_version = 'TLSv1.3'`.

### 18.3 Cliente (VM1)

La CA **pública** se instaló en `/etc/pki/siget/ca.crt` (contexto `cert_t`). El `db.php` del checkpoint pasó a `sslmode=verify-full;sslrootcert=/etc/pki/siget/ca.crt`, así que el PHP verifica que el servidor es quien dice ser, no solo cifra. El `db.php` anterior se guardó en `/root/siget-backups/`.

### 18.4 Exigir TLS en la base

En `pg_hba.conf`, las reglas de `checkpoint_app` y `pgadmin_lectura` pasaron de `host` a `hostssl`:

```
host     all             postgres        192.168.100.10/32       reject
hostssl  tramites_demo   checkpoint_app  192.168.100.10/32       scram-sha-256
hostssl  all             pgadmin_lectura 192.168.100.10/32       scram-sha-256
```

Una conexión sin TLS ya no encuentra ninguna regla y es rechazada. Respaldo de la regla anterior en `/var/backups/siget/pg_hba.conf.antes-hostssl`.

### 18.5 Verificación

Prueba desde VM1 con el rol de la app (consulta `pg_stat_ssl` dentro de la propia sesión):

| Intento | Antes de `hostssl` | Después de `hostssl` |
|---|---|---|
| `verify-full` con la CA de SIGET | Conecta: `ssl=true`, TLSv1.3, `TLS_AES_256_GCM_SHA384` | Conecta: igual |
| `verify-full` sin confiar en la CA | Rechazada (certificado no verificable) | Rechazada |
| `sslmode=disable` (sin TLS) | **Conectaba** (`ssl=false`) | **Rechazada**: no hay línea en `pg_hba.conf` |

El login real de la app (registro, login, dashboard) siguió funcionando con la base exigiendo TLS. Usuario de prueba creado y borrado; los 8 usuarios reales intactos.

### 18.6 pgAdmin

La conexión de `pgadmin_lectura` ahora **debe usar SSL**: en pgAdmin, pestaña *SSL*, modo `require` (o `verify-full` con el certificado de la CA).

### 18.7 Gotchas

- `ssl` se activa con recarga (`pg_reload_conf()`), sin reiniciar PostgreSQL.
- Con `verify-full` el nombre del servidor debe estar en el `subjectAltName`; por eso el certificado incluye la IP, porque la app se conecta por IP.
- `hostssl` no rechaza explícitamente lo que no es TLS: simplemente no hay regla que lo acepte, y el error es "no hay una línea en pg_hba.conf".

### 18.8 Pendiente

- Renovar el certificado del servidor antes de su vencimiento (octubre de 2027) y definir la rotación.
- Repetir esta configuración en el PostgreSQL en contenedor y guardar la clave del servidor con `podman secret`.
- Cifrado del login HTTP (nginx con TLS): ZT-3, semana 5.
