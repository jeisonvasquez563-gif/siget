#!/bin/bash
# Respaldo diario de la base de SIGET con verificación y PRUEBA DE RESTAURACIÓN (hallazgo H-1 de docs/revision-seguridad-2026-10-22.md).
# Corre como root desde siget-respaldo.timer en VM2. Un respaldo que nunca se restauró no es un respaldo: cada corrida
# restaura el volcado en una base desechable, compara con la viva y la borra. Si algo falla, termina con error y el servicio
# queda en «failed» (visible con `systemctl status siget-respaldo`).
# Los volcados contienen hashes de contraseñas: carpeta 700, archivos 600, nunca al repositorio.
set -euo pipefail
umask 077

DIR=/var/backups/siget
RETENCION_DIAS=14
MINIMO_A_CONSERVAR=3
SELLO=$(date +%Y%m%d-%H%M%S)
SIGET_UID=$(id -u siget)
BASE=tramites_demo
PRUEBA=siget_restauracion_prueba
TABLAS_ESPERADAS=11

log() { echo "$*"; logger -t siget-respaldo -- "$*"; }
fallar() { log "ERROR: $*"; exit 1; }
pc() { runuser -u siget -- env XDG_RUNTIME_DIR=/run/user/"$SIGET_UID" podman exec -i -u postgres siget-postgres "$@"; }
sql() { pc psql -U postgres -v ON_ERROR_STOP=1 -tA "$@"; }

install -d -m 700 "$DIR"
VOLCADO="$DIR/$BASE-$SELLO.dump"
GLOBALES="$DIR/globals-$SELLO.sql"

# 1. Volcado (formato personalizado, consistente: una sola transacción)
pc pg_dump -Fc -d "$BASE" > "$VOLCADO.tmp" || fallar "pg_dump falló"
mv "$VOLCADO.tmp" "$VOLCADO"
pc pg_dumpall -U postgres --globals-only > "$GLOBALES" || fallar "pg_dumpall (roles) falló"
chmod 600 "$VOLCADO" "$GLOBALES"
TAM=$(stat -c %s "$VOLCADO")
[ "$TAM" -gt 10000 ] || fallar "el volcado pesa solo $TAM bytes: sospechoso"

# 2. El volcado se puede leer y trae todas las tablas del esquema
TABLAS=$(pc pg_restore -l < "$VOLCADO" | grep -c ' TABLE siget ' || true)
[ "$TABLAS" -ge "$TABLAS_ESPERADAS" ] || fallar "el volcado trae $TABLAS tablas y se esperaban $TABLAS_ESPERADAS"

# 3. Prueba de restauración en una base desechable (sin propietarios ni privilegios: solo importa que los datos vuelvan)
sql -d postgres -c "DROP DATABASE IF EXISTS $PRUEBA" >/dev/null
sql -d postgres -c "CREATE DATABASE $PRUEBA" >/dev/null
trap 'sql -d postgres -c "DROP DATABASE IF EXISTS '"$PRUEBA"'" >/dev/null 2>&1 || true' EXIT
pc pg_restore --no-owner --no-privileges -d "$PRUEBA" < "$VOLCADO" || fallar "pg_restore falló"
for t in usuario tramite evento_auditoria decision_pdp evento_seguridad; do
  restauradas=$(sql -d "$PRUEBA" -c "SELECT count(*) FROM siget.$t")
  vivas=$(sql -d "$BASE" -c "SELECT count(*) FROM siget.$t")
  # Las tablas solo crecen mientras corre la prueba: lo restaurado nunca puede ser MÁS que lo vivo, y no puede estar vacío
  { [ "$restauradas" -ge 1 ] && [ "$restauradas" -le "$vivas" ]; } || fallar "tabla $t: restauradas=$restauradas vivas=$vivas"
done
RESTAURADAS_TABLAS=$(sql -d "$PRUEBA" -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='siget'")
[ "$RESTAURADAS_TABLAS" -ge "$TABLAS_ESPERADAS" ] || fallar "la base restaurada tiene $RESTAURADAS_TABLAS tablas"

# 4. Huella y retención (solo los volcados automáticos; los manuales «pre-*» no se tocan)
( cd "$DIR" && sha256sum "$(basename "$VOLCADO")" "$(basename "$GLOBALES")" >> SHA256SUMS ) && chmod 600 "$DIR/SHA256SUMS"
mapfile -t VIEJOS < <(find "$DIR" -maxdepth 1 -name "$BASE-*.dump" -mtime +"$RETENCION_DIAS" | sort)
TOTAL=$(find "$DIR" -maxdepth 1 -name "$BASE-*.dump" | wc -l)
for v in "${VIEJOS[@]}"; do
  [ "$TOTAL" -gt "$MINIMO_A_CONSERVAR" ] || break
  sello_viejo=$(basename "$v" .dump); sello_viejo=${sello_viejo#"$BASE"-}
  rm -f "$v" "$DIR/globals-$sello_viejo.sql"; TOTAL=$((TOTAL - 1)); log "retención: se borró $(basename "$v")"
done

log "OK: $(basename "$VOLCADO") ($TAM bytes, $TABLAS tablas), restauración probada y verificada contra la base viva"
