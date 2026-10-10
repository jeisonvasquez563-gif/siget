# Acceso del equipo a las VMs

Cada integrante tiene una cuenta de Linux propia en VM1 (`app-backend`) y VM2 (`db-server`). Se entra **solo con clave pública SSH** por la red Tailscale del proyecto: las cuentas no tienen contraseña, así que no hay nada que adivinar ni que filtrar.

| Integrante | Usuario |
|---|---|
| Simna De Gracia | `simna_degracia` |
| Gabriel González | `gabriel_gonzalez` |
| Andy Martínez | `andy_martinez` |
| Joel Medina | `joel_medina` |
| Jorge Medina | `jorge_medina` |
| Bradley Morales | `bradley_morales` |
| Anyurie Sánchez | `anyurie_sanchez` |
| Walter Sanjur | `walter_sanjur` |
| Jeison Vásquez | `jeison_vasquez` (administrador, con sudo) |

Todas las cuentas del equipo pertenecen al grupo `ciber5`. **Sudo (NOPASSWD, vía `/etc/sudoers.d/`):** `jeison_vasquez` en VM1 y VM2, y `andy_martinez` solo en VM1 (para instalar Podman, autorizado por Jeison el 10-oct-2026). El resto no tiene sudo. Si alguien necesita privilegios, se pide a Jeison y se registra en el [`CHANGELOG.md`](../CHANGELOG.md).

## Cómo entrar (cada integrante)

1. Tener Tailscale instalado y estar dentro de la tailnet del proyecto.
2. Generar una clave si no tenés una y compartir **solo la pública**:

```bash
ssh-keygen -t ed25519 -C "nombre_apellido"
cat ~/.ssh/id_ed25519.pub
```

Nunca compartas el archivo `id_ed25519` (sin `.pub`): es la clave privada.

3. Pasar la línea que empieza con `ssh-ed25519` a Jeison. Una vez cargada:

```bash
ssh nombre_apellido@100.104.206.118   # VM1 app-backend
ssh nombre_apellido@100.120.115.100   # VM2 db-server
```

## Cómo carga Jeison una clave

```bash
echo "ssh-ed25519 AAAA... comentario" | sudo tee -a /home/USUARIO/.ssh/authorized_keys
sudo restorecon -R /home/USUARIO/.ssh
```

## Reglas

- Una clave por persona, no se comparten cuentas.
- Si se pierde o filtra una clave privada, avisar de inmediato para retirarla de `authorized_keys`.
- Dar de baja a alguien: `sudo userdel -r USUARIO` (siempre con aprobación explícita).
- No guardar contraseñas ni claves en el repositorio.
