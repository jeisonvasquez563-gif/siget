# Respaldos automáticos de la base (VM2)

| Archivo | Va a |
|---|---|
| `siget-respaldo.sh` | `/usr/local/sbin/siget-respaldo.sh` (750, root) |
| `siget-respaldo.service`, `siget-respaldo.timer` | `/etc/systemd/system/` |

Instalar (cuenta con sudo): copiar los tres archivos, `sudo restorecon -v` sobre ellos, `sudo systemctl daemon-reload` y `sudo systemctl enable --now siget-respaldo.timer`.

**Qué hace cada corrida (02:30):** volcado de `tramites_demo` y de los roles → comprueba que trae las 11 tablas → lo restaura en la base desechable `siget_restauracion_prueba` y compara con la viva → la borra → huella en `SHA256SUMS` → borra los de más de 14 días (siempre deja al menos 3; no toca los manuales `pre-*`). Todo en `/var/backups/siget` (carpeta 700, archivos 600).

```bash
sudo systemctl start siget-respaldo.service          # correrlo ahora
sudo journalctl -u siget-respaldo.service -n 20      # ver el resultado (termina en «OK: …»)
systemctl list-timers siget-respaldo.timer           # próxima corrida
sudo systemctl is-failed siget-respaldo.service      # «failed» = el último respaldo no sirvió
```

**Restaurar de verdad** (con el contenedor `siget-postgres` en marcha): `pg_restore --no-owner -d <base> < tramites_demo-AAAAMMDD-HHMMSS.dump`, y los roles desde `globals-AAAAMMDD-HHMMSS.sql`. Los volcados traen hashes de contraseñas: nunca al repositorio.

**Pendiente:** copia fuera de VM2 (un respaldo en la misma máquina no protege de perder la máquina).
