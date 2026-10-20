#!/usr/bin/env bash
# Ejecuta psql dentro del contenedor siget-postgres (VM2) como el usuario del sistema postgres,
# por el socket local (peer): el superusuario no tiene contrasena ni entra por red.
# Se usa desde una cuenta con sudo (hoy solo la de Jeison). Uso: psql-contenedor.sh -d tramites_demo -c "select 1"
cd /tmp
exec sudo -H -u siget env XDG_RUNTIME_DIR=/run/user/$(id -u siget) podman exec -i -u postgres siget-postgres psql -U postgres "$@"
