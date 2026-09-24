# VM2 — db-server

Rocky Linux 9, capa de datos del proyecto SIGET.

- IP interna (red del proyecto): `192.168.100.20`
- Servicio: PostgreSQL 16
- Base de datos: `tramites_demo` (ver `database/schema.sql`)
- SELinux: `Enforcing`
- Firewall (firewalld): 5432/TCP permitido **solo** desde `192.168.100.10/32` (VM1) vía rich rule; nada más entra

El procedimiento completo de instalación y configuración está documentado paso a paso en `docs/Runbook_SIGET.docx`.
