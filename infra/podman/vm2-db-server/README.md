# Despliegue de PostgreSQL en VM2 (contenedor rootless)

Archivos de la unidad Quadlet que corre PostgreSQL 16.15 en VM2 bajo el usuario de servicio `siget`. Documentación completa en [`docs/runbook.md`](../../../docs/runbook.md) sección 21.

| Archivo | Dónde se instala en VM2 |
|---|---|
| `siget-postgres.container` | `/home/siget/.config/containers/systemd/` |
| `siget-pgdata.volume` | `/home/siget/.config/containers/systemd/` |
| `pg_hba.conf` (reglas de `app_role`, `auditor_role`, `checkpoint_app` y `pgadmin_lectura`, todas `hostssl` y desde la IP interna de VM1) | `/home/siget/config/` |

**No hay secretos en estos archivos.** El certificado y la clave TLS se cargan como `podman secret` (`siget-pg-tls-crt` y `siget-pg-tls-key`). Se crean desde una cuenta con sudo, sin mostrar los valores:

```bash
sudo cat CERTIFICADO | sudo -H -u siget env XDG_RUNTIME_DIR=/run/user/$(id -u siget) podman secret create siget-pg-tls-crt -
```

Se activa con `systemctl --user daemon-reload` y `systemctl --user start siget-postgres.service`, ejecutados como `siget`.

**Respaldos:** hoy son manuales (`pg_dump -Fc` dentro del contenedor, a `/var/backups/siget/`, con copia fuera de la VM); el procedimiento está en el [runbook](../../../docs/runbook.md) sección 32.2. Falta un temporizador diario con retención y una prueba de restauración.
