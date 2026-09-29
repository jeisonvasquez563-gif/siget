# Guía de capturas — evidencia de configuración

Lista de comandos para que cada integrante del grupo tome su propia captura de pantalla de una parte de la configuración. Pensada para repartir el trabajo: no hace falta que una sola persona corra todo.

Requisito previo: estar conectado a la tailnet del proyecto (Tailscale) — ver [`runbook.md`](./runbook.md#1091-acceso-por-tailscale-solución-definitiva-de-red) si todavía no te uniste.

## 1. Identidad y sistema operativo

```bash
ssh -i ~/.ssh/ciber5_vm1 jeison_vasquez@192.168.159.137 "hostnamectl"
```
Muestra Rocky Linux 9.7 y el hostname `app-backend`.

```bash
ssh -i ~/.ssh/ciber5_vm2 jeison_vasquez@192.168.159.138 "hostnamectl"
```
Lo mismo para VM2 (`db-server`).

## 2. Red interna (en las dos VMs)

```bash
ssh -i ~/.ssh/ciber5_vm1 jeison_vasquez@192.168.159.137 "ip -br a"
```
Muestra las tres interfaces de VM1: NAT, red interna (`192.168.100.10`) y Tailscale.

```bash
ssh -i ~/.ssh/ciber5_vm2 jeison_vasquez@192.168.159.138 "ip -br a"
```
Lo mismo para VM2 (`192.168.100.20`).

## 3. Ping entre VMs (prueba de comunicación por la red interna)

```bash
ssh -i ~/.ssh/ciber5_vm1 jeison_vasquez@192.168.159.137 "ping -c 4 192.168.100.20"
```

## 4. SELinux — nunca desactivado

```bash
ssh -i ~/.ssh/ciber5_vm1 jeison_vasquez@192.168.159.137 "getenforce"
```
```bash
ssh -i ~/.ssh/ciber5_vm2 jeison_vasquez@192.168.159.138 "getenforce"
```
Las dos deben devolver `Enforcing`.

## 5. Firewall — la regla restrictiva de VM2

```bash
ssh -i ~/.ssh/ciber5_vm2 jeison_vasquez@192.168.159.138 "sudo firewall-cmd --list-all"
```
Esta es la captura más importante de seguridad: muestra la rich rule que hace que PostgreSQL solo acepte conexiones desde `192.168.100.10` (VM1), nada más.

## 6. Servicios corriendo en cada VM

```bash
ssh -i ~/.ssh/ciber5_vm1 jeison_vasquez@192.168.159.137 "sudo systemctl status httpd php-fpm --no-pager | head -15"
```
```bash
ssh -i ~/.ssh/ciber5_vm2 jeison_vasquez@192.168.159.138 "sudo systemctl status postgresql --no-pager | head -8"
```

## 7. Tablas de la base de datos

```bash
ssh -i ~/.ssh/ciber5_vm2 jeison_vasquez@192.168.159.138 "sudo -u postgres psql -d tramites_demo -c '\dt'"
```

## 8. La app funcionando (navegador)

Abrir en el navegador `http://100.104.206.118/gestion/` (por Tailscale) y capturar la pantalla de login.

## Reparto sugerido entre el grupo

| Bloque | Puntos | Tema |
|---|---|---|
| Persona 1 | 2, 3 | Red interna y comunicación entre VMs |
| Persona 2 | 4, 5 | SELinux y firewall (seguridad) |
| Persona 3 | 1, 6, 7 | Identidad, servicios y base de datos |
| Persona 4 | 8 | La app funcionando de punta a punta |

Cada uno corre sus comandos desde su propia conexión Tailscale y captura la salida de la terminal — no hace falta que todos usen la misma laptop.
