# Endurecimiento de SSH y firewall en las VMs

Fecha: 15 de octubre de 2026. Aplicado en VM1 (`app-backend`) y VM2 (`db-server`), con aprobación explícita de Jeison. Surgió de la auditoría de los cambios de Podman, que encontró desvíos preexistentes respecto de los estándares del proyecto.

## Desvíos encontrados

| # | Hallazgo | Estado |
|---|---|---|
| 1 | `PasswordAuthentication yes` en sshd (VM1 y VM2), contradiciendo "acceso solo por clave" | **Corregido** |
| 2 | `cockpit` permitido en firewalld (puerto 9090, sin servicio escuchando) | **Corregido** |
| 3 | PostgreSQL escucha en `0.0.0.0:5432` (VM2); el spec pide bind solo a la IP interna. El firewall lo restringe a 192.168.100.10 | Pendiente: se corrige al migrar a contenedor |

## Cambios aplicados

Archivo `/etc/ssh/sshd_config.d/40-siget-hardening.conf` en ambas VMs:

```
PasswordAuthentication no
KbdInteractiveAuthentication no
```

Se validó con `sshd -t`, se recargó con `systemctl reload sshd` (sin cortar la sesión abierta) y se quitó Cockpit del firewall:

```bash
sudo firewall-cmd --permanent --remove-service=cockpit && sudo firewall-cmd --reload
```

## Verificación

- `sshd -T` muestra `passwordauthentication no` y `kbdinteractiveauthentication no`.
- Una sesión nueva por clave funciona; un intento por contraseña responde `Permission denied (publickey,gssapi-keyex,gssapi-with-mic)`.
- Servicios de firewall: VM1 `dhcpv6-client http ssh`; VM2 `dhcpv6-client ssh`. La regla del 5432 solo desde 192.168.100.10 sigue intacta.

## Reversión

Borrar `/etc/ssh/sshd_config.d/40-siget-hardening.conf` y ejecutar `sudo systemctl reload sshd`. Para Cockpit: `sudo firewall-cmd --permanent --add-service=cockpit && sudo firewall-cmd --reload`.

## Consecuencia para el equipo

Como no hay contraseñas, **solo entra quien tenga su clave pública cargada** (ver [`acceso-equipo.md`](./acceso-equipo.md)). `root` y `jeison_vasquez` conservan contraseña local solo para `sudo` y consola, no para SSH.

## Límite de la verificación

Se probó el acceso por clave con la cuenta de `jeison_vasquez`. No se probó el de los demás integrantes porque se necesita su clave privada.
