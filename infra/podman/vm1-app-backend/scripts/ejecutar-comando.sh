#!/bin/bash
# Reconstruye la imagen del backend (si existe /tmp/bk_src.tgz) y ejecuta UN comando de manage.py en un contenedor
# desechable con los secretos montados: así corren las verificaciones contra la base real (verificar_*, sembrar_demo).
#
# Uso (en VM1, desde una cuenta que pueda operar como `siget`):
#   1. Subir el código:  tar --exclude=.venv --exclude=__pycache__ -czf bk_src.tgz -C <carpeta con backend/> bk_src  y copiarlo a /tmp/bk_src.tgz
#   2. bash ejecutar-comando.sh /tmp/salida.out verificar_politicas
#   3. Leer /tmp/ejec.log (termina en FIN) y la salida; BORRAR la salida si trae credenciales (shred -u).
# Los secretos no están aquí: son `podman secret` ya creados en VM1.
OUT=$1; shift
exec > /tmp/ejec.log 2>&1
R() { sudo -H -u siget bash -lc "cd /tmp && export XDG_RUNTIME_DIR=/run/user/\$(id -u) && $1"; }
if [ -f /tmp/bk_src.tgz ]; then
  cd /tmp && rm -rf bk_src && tar xzf bk_src.tgz && chmod -R a+rX bk_src
  R "cd /tmp/bk_src && timeout 600 podman build -q -t siget-backend:dev -f Containerfile ." | tail -1
  rm -rf /tmp/bk_src /tmp/bk_src.tgz
fi
RUN="podman run --rm --secret siget-db-app-password,mode=0444 --secret siget-django-key,mode=0444 --secret siget-ca,mode=0444 --secret siget-jwt-key,mode=0444 --secret siget-mfa-key,mode=0444 --secret siget-db-auditor-password,mode=0444 -e SIGET_DB_PASSWORD_FILE=/run/secrets/siget-db-app-password -e SIGET_SECRET_KEY_FILE=/run/secrets/siget-django-key -e SIGET_DB_SSLROOTCERT=/run/secrets/siget-ca -e SIGET_JWT_KEY_FILE=/run/secrets/siget-jwt-key -e SIGET_MFA_KEY_FILE=/run/secrets/siget-mfa-key -e SIGET_DB_AUDITOR_PASSWORD_FILE=/run/secrets/siget-db-auditor-password -e SIGET_ALLOWED_HOSTS=localhost localhost/siget-backend:dev python manage.py"
R "timeout 280 $RUN $*" > $OUT 2>&1
chmod 600 $OUT
echo FIN
