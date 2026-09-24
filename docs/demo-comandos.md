# Guion de comandos — Demo SIGET

Ciberseguridad 5, UTP — Jeison Vásquez, Grupo Ciber5

Este documento trae, en orden, todo lo necesario para mostrar en vivo la infraestructura, la seguridad configurada y la aplicación SIGET funcionando de punta a punta.

## Paso 0 — Abrir el túnel SSH

En una ventana de terminal aparte, dejarla abierta durante **toda** la demo:

```bash
ssh -i ~/.ssh/ciber5_vm1 -N -L 8080:localhost:80 jeison_vasquez@192.168.159.137
```

Esta ventana se queda "colgada" a propósito (flag `-N`) — es el túnel funcionando, no está trabada. No cerrarla hasta terminar. Para cortarla al final: `Ctrl+C`.

## Paso 1 — Abrir la sesión SSH interactiva

En **otra** ventana, esta sí para escribir comandos:

```bash
ssh -i ~/.ssh/ciber5_vm1 jeison_vasquez@192.168.159.137
```

## Paso 2 — Mostrar infraestructura y seguridad

Dentro de esa sesión, correr uno por uno, en orden:

```bash
# Identidad y acceso: logueado por clave SSH, sin password
hostname && whoami
```

```bash
# Red interna dedicada del proyecto (192.168.100.0/24)
ip -br a
```

```bash
# Conectividad real hacia VM2 (db-server) por la red interna
ping -c 4 192.168.100.20
```

```bash
# SELinux nunca se desactivó — debe devolver "Enforcing"
getenforce
```

```bash
# Servicios corriendo: Apache + PHP-FPM
sudo systemctl status httpd php-fpm --no-pager | head -12
```

```bash
# Resolución de nombres interna (app-backend <-> db-server)
cat /etc/hosts
```

## Paso 3 — Aplicación SIGET (login + gestión de usuarios)

En el navegador, con el túnel del Paso 0 activo:

```bash
start http://localhost:8080/gestion/
```

- **Usuario:** `admin`
- **Contraseña:** `Admin123!`

Mostrar en vivo:

1. Login.
2. Crear un usuario nuevo desde el formulario.
3. Eliminarlo con el botón "Eliminar".

(Ambas acciones se reflejan en PostgreSQL, en la VM2, en tiempo real.)

## Paso 4 — Respaldo: ver la misma base de datos desde pgAdmin

Mismo túnel, no hace falta abrir uno nuevo:

```bash
start http://localhost:8080/pgadmin4/
```

- **Usuario:** `admin@ciber5.com`
- **Contraseña:** `CheckpointCiber5_2026`

Navegar: `Servers → db-server (VM2) → Databases → tramites_demo → Query Tool`, y correr:

```sql
SELECT * FROM app_usuarios;
```

Esto muestra, desde una herramienta profesional de administración de bases de datos, los mismos usuarios que creó/borró la app SIGET.

## Datos de referencia rápida

| Recurso | Valor |
|---|---|
| VM1 (app-backend) IP NAT | 192.168.159.137 |
| VM1 (app-backend) IP interna | 192.168.100.10 |
| VM2 (db-server) IP NAT | 192.168.159.138 |
| VM2 (db-server) IP interna | 192.168.100.20 |
| Usuario Linux (ambas VMs) | jeison_vasquez |
| Red interna dedicada | 192.168.100.0/24 (VMnet2, host-only, sin DHCP) |
| Firewall VM2 | puerto 5432/TCP solo desde 192.168.100.10 (rich rule) |
| Base de datos | tramites_demo (PostgreSQL 16, en VM2) |
| Tabla de usuarios de la app | app_usuarios |
