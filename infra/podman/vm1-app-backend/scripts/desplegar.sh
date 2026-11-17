#!/bin/bash
# Despliegue de la interfaz y de la configuración en VM1 (tal como se usó hasta el 21-oct-2026).
# Espera en /tmp: fe.tgz (carpeta dist/ del frontend), nginx.conf y los dos archivos .container de infra/podman/vm1-app-backend.
# OJO: escribe en /home/siget con `sudo` (root); quien solo puede operar como `siget` debe adaptarlo a `sudo -u siget`.
# Reinicia el pod en el orden correcto (pod -> backend -> nginx): reiniciar backend y nginx a la vez detiene el pod.
# Borra los archivos de /tmp al terminar: una segunda ejecución sin volver a copiarlos no sobrescribe nada.
exec > /tmp/despliegue.log 2>&1
R() { sudo -H -u siget bash -lc "cd /tmp && export XDG_RUNTIME_DIR=/run/user/\$(id -u) && $1"; }
U=/home/siget/.config/containers/systemd
cd /tmp && rm -rf dist && tar xzf fe.tgz
sudo rm -rf /home/siget/frontend && sudo mkdir -p /home/siget/frontend && sudo cp -r dist/. /home/siget/frontend/ && sudo chown -R siget:siget /home/siget/frontend && sudo chmod -R a+rX /home/siget/frontend
sudo tee /home/siget/config/nginx.conf < /tmp/nginx.conf >/dev/null; sudo chown siget:siget /home/siget/config/nginx.conf
for f in siget-nginx.container siget-backend.container; do sudo tee $U/$f < /tmp/$f >/dev/null; sudo chown siget:siget $U/$f; done
R "systemctl --user daemon-reload"
R "systemctl --user stop siget-nginx.service siget-backend.service siget-pod.service"
R "systemctl --user start siget-pod.service"
sleep 3
R "systemctl --user start siget-backend.service siget-nginx.service"
sleep 8
R "systemctl --user is-active siget-pod.service siget-backend.service siget-nginx.service | tr '\n' ' '"; echo
rm -rf /tmp/dist /tmp/fe.tgz /tmp/nginx.conf /tmp/siget-nginx.container /tmp/siget-backend.container
echo FIN
