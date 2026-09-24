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
sudo -u postgres psql -c "ALTER USER postgres PASSWORD 'CheckpointCiber5_2026';"
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
     PGADMIN_SETUP_PASSWORD='CheckpointCiber5_2026' \
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
2. Login con `admin@ciber5.com` / `CheckpointCiber5_2026`
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
php -r "echo password_hash('Admin123!', PASSWORD_BCRYPT), PHP_EOL;"
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

1. Login en `http://<IP_NAT_VM1>/gestion/` con `admin` / `Admin123!` → acceso concedido al dashboard.
2. Se creó el usuario "funcionario1" desde el formulario del dashboard → mensaje de éxito en pantalla.
3. Se verificó por SELECT directo en `psql` (VM2) que el registro nuevo efectivamente llegó a la tabla `app_usuarios` — no solo el mensaje de la aplicación.
4. Se eliminó "funcionario1" desde el botón de la tabla → mensaje de éxito en pantalla.
5. Se verificó por SELECT directo en `psql` (VM2) que el registro fue efectivamente borrado de la base.

Resultado: flujo completo de autenticación y gestión de usuarios (crear/eliminar) funcionando de punta a punta, con persistencia real verificada en PostgreSQL — no solo mensajes de interfaz.

### 10.6 Ajuste de nombre en pantalla

El nombre en las pantallas de login y dashboard de esta aplicación de checkpoint pasó por dos ajustes: primero se retiró la referencia al nombre de trabajo original ("Panamá Conecta") por uno neutro ("Sistema de Gestión de Usuarios"), y luego se reemplazó por el nombre definitivo del proyecto: **SIGET — Sistema de Gestión y Trazabilidad**.

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
