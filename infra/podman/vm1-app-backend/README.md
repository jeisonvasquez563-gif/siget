# Despliegue de la aplicación en VM1 (pod rootless)

Unidades Quadlet que corren `nginx` y el backend Django como el pod `siget`, bajo el usuario de servicio `siget`. Documentación completa en [`docs/runbook.md`](../../../docs/runbook.md) sección 24.

| Archivo | Dónde se instala en VM1 |
|---|---|
| `siget.pod`, `siget-backend.container`, `siget-nginx.container` | `/home/siget/.config/containers/systemd/` |
| `nginx.conf` | `/home/siget/config/` |
| La interfaz compilada (`frontend/dist/`) | `/home/siget/frontend/` (montada en nginx como solo lectura) |

**No hay secretos en estos archivos.** Todo llega como `podman secret`: `siget-nginx-crt` y `siget-nginx-key` (TLS), `siget-db-app-password`, `siget-django-key`, `siget-ca`, `siget-jwt-key`, `siget-mfa-key` y `siget-db-auditor-password` (la contraseña de `auditor_role`, que usa la consola de auditoría). Se crean desde una cuenta con sudo, sin mostrar los valores. La imagen del backend se construye con [`backend/Containerfile`](../../../backend/Containerfile).

Se activa con `systemctl --user daemon-reload` y `systemctl --user start siget-pod.service siget-backend.service siget-nginx.service`, ejecutados como `siget`.

Para actualizar `nginx.conf` hay que escribir **sobre el mismo archivo** (`tee`), no reemplazarlo.

**nginx sirve la interfaz y solo reenvía a Django estas rutas:** `auth`, `tramites`, `catalogo`, `equipo`, `auditoria`, `politicas` y `salud`. Todo lo demás responde 404. Cualquier `add_header` dentro de un `location` anula las cabeceras de seguridad del servidor: para el caché se usa `expires`.

**Reinicio ordenado** (reiniciar backend y nginx a la vez detiene el pod, porque están enlazados):

```bash
sudo -H -u siget bash -lc 'export XDG_RUNTIME_DIR=/run/user/1009; systemctl --user daemon-reload; systemctl --user stop siget-nginx.service siget-backend.service siget-pod.service; systemctl --user start siget-pod.service; sleep 3; systemctl --user start siget-backend.service siget-nginx.service'
```

Cómo abrir la plataforma: [`docs/como-abrir-la-plataforma.md`](../../../docs/como-abrir-la-plataforma.md).
