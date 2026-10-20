# Despliegue de la aplicación en VM1 (pod rootless)

Unidades Quadlet que corren `nginx` y el backend Django como el pod `siget`, bajo el usuario de servicio `siget`. Documentación completa en [`docs/runbook.md`](../../../docs/runbook.md) sección 24.

| Archivo | Dónde se instala en VM1 |
|---|---|
| `siget.pod`, `siget-backend.container`, `siget-nginx.container` | `/home/siget/.config/containers/systemd/` |
| `nginx.conf` | `/home/siget/config/` |

**No hay secretos en estos archivos.** Todo llega como `podman secret`: `siget-nginx-crt` y `siget-nginx-key` (TLS), `siget-db-app-password`, `siget-django-key` y `siget-ca`. Se crean desde una cuenta con sudo, sin mostrar los valores. La imagen del backend se construye con [`backend/Containerfile`](../../../backend/Containerfile).

Se activa con `systemctl --user daemon-reload` y `systemctl --user start siget-pod.service siget-backend.service siget-nginx.service`, ejecutados como `siget`.

Para actualizar `nginx.conf` hay que escribir **sobre el mismo archivo** (`tee`), no reemplazarlo.
