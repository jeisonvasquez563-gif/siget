# Plan: Podman rootless + Quadlet en VM1 y VM2

**Estado:** borrador, pendiente de aprobación explícita de Jeison (regla de oro del proyecto).
**Autor:** Andy Martínez, Grupo Ciber5.
**Fecha:** 10 de octubre de 2026.
**Corresponde a:** punto 2 del orden de trabajo en [`docs/architecture/plan.md`](../../docs/architecture/plan.md).

> Este documento solo describe lo que se quiere hacer. No se ejecuta ningún cambio en las VMs hasta que esté aprobado, y cada paso se documenta en `docs/runbook.md` cuando se ejecute.

## 1. Objetivo

Pasar de servicios instalados directamente en cada VM a contenedores Podman rootless, gestionados por systemd mediante unidades Quadlet, tal como define [`docs/architecture/spec.md`](../../docs/architecture/spec.md) (sección 3). Es el requisito previo para desplegar PostgreSQL en contenedor (VM2) y nginx + Django (VM1).

## 2. Estado verificado hoy en VM1 (`app-backend`)

Comprobado por SSH con el usuario `andy_martinez`, solo con comandos de lectura:

| Elemento | Resultado |
|---|---|
| Sistema operativo | Rocky Linux 9.7 (Blue Onyx) |
| `podman` | No instalado (`orden no encontrada`) |
| `git` | No instalado |
| `sudo` para `andy_martinez` | No disponible (pide contraseña) |
| Grupos de `andy_martinez` | `andy_martinez`, `ciber5` |
| SELinux | `unconfined_u:unconfined_r:unconfined_t` en la sesión (el sistema sigue en enforcing según el runbook) |

Pendiente de verificar en VM2 (`db-server`) y de comprobar `/etc/subuid` y `/etc/subgid` para el usuario que correrá los contenedores.

## 3. Alcance

**Incluido:**
- Instalar Podman en VM1 y VM2.
- Preparar el usuario que correrá los contenedores (rangos subuid/subgid, linger).
- Probar un contenedor rootless inofensivo.
- Crear la primera unidad Quadlet y arrancarla con `systemctl --user`.
- Documentar la convención de carpetas en `infra/podman/`.

**No incluido en este bloque** (bloques posteriores del plan):
- Migrar PostgreSQL a contenedor y crear `app_role`.
- Desplegar Django + nginx.
- TLS entre aplicación y base de datos.
- Política de secretos con `podman secret`.

## 4. Pasos propuestos

### Paso 1: instalación de paquetes (requiere `sudo`, lo ejecuta Jeison)

En VM1 y VM2:

```
sudo dnf install podman
```

Opcionalmente `container-tools`, que agrega utilidades como `skopeo` y `buildah`. Verificación: `podman --version`.

### Paso 2: preparar el usuario que corre los contenedores (requiere `sudo`)

- Confirmar rangos en `/etc/subuid` y `/etc/subgid` para ese usuario.
- Activar linger para que los contenedores sigan corriendo sin sesión abierta:

```
sudo loginctl enable-linger <usuario>
```

### Paso 3: contenedor de prueba rootless (sin `sudo`)

Con el usuario ya preparado, correr un contenedor mínimo que no toque Apache ni la app actual. Confirmar que arranca, que se puede detener y que SELinux no registra denegaciones (`ausearch -m avc -ts recent`).

### Paso 4: primera unidad Quadlet (sin `sudo`)

- Crear un archivo `.container` en `~/.config/containers/systemd/` del usuario.
- Recargar y arrancar con `systemctl --user daemon-reload` y `systemctl --user start <unidad>`.
- Verificar que la unidad reinicia tras `systemctl --user restart`.
- Guardar una copia de la unidad en `infra/podman/vm1-app-backend/` o `infra/podman/vm2-db-server/`, según la convención del README de esa carpeta.

## 5. Decisiones que debe tomar Jeison

1. **Usuario que corre los contenedores.** Un usuario de servicio dedicado del proyecto (propuesta de este plan) o el usuario de cada integrante. Un usuario dedicado evita que el sistema dependa de una persona.
2. **Puertos 80 y 443 en VM1.** Los contenedores rootless no pueden usar puertos por debajo de 1024 por defecto, y Apache ya ocupa el 80. Resolverlo implica tocar la app PHP del checkpoint, cuyo destino el plan marca como "requiere aprobación explícita antes de tocar nada". Hasta decidirlo, los contenedores de prueba usan puertos altos.
3. **Permiso de `sudo`** para quien ejecute los pasos 1 y 2, o si los hace Jeison directamente.

## 6. Riesgos y cómo se mitigan

| Riesgo | Mitigación |
|---|---|
| Un contenedor de prueba interfiere con Apache o la app actual | Puertos altos y sin tocar `httpd` ni PHP-FPM |
| SELinux bloquea volúmenes de contenedores | Usar la etiqueta `:Z` en los volúmenes; nunca desactivar SELinux |
| Los contenedores se detienen al cerrar la sesión | Activar linger (paso 2) |
| Cambios no documentados | Cada paso ejecutado se registra en `docs/runbook.md` y `CHANGELOG.md` |

## 7. Criterios para dar el bloque por terminado

- `podman --version` responde en VM1 y VM2.
- Un contenedor de prueba rootless arranca, se detiene y no genera denegaciones de SELinux.
- Una unidad Quadlet arranca con `systemctl --user` y sobrevive a un reinicio de la unidad.
- La app actual del checkpoint (login) sigue funcionando sin cambios.
- El runbook y el `CHANGELOG.md` reflejan todo lo ejecutado.
