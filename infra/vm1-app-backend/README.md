# VM1 — app-backend

Rocky Linux 9, capa de aplicación del proyecto SIGET.

- IP interna (red del proyecto): `192.168.100.10`
- Servicios: Apache (httpd) + PHP-FPM 8.3
- Sirve la app de checkpoint en `/gestion/` (ver `checkpoints/siget-gestion-usuarios/`)
- SELinux: `Enforcing`
- Firewall (firewalld): servicios `ssh`, `http`, `cockpit` habilitados en zona `public`

El procedimiento completo de instalación y configuración está documentado paso a paso en `docs/Runbook_SIGET.docx`.
