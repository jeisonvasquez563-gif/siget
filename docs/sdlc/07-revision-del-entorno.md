# Revisión de la seguridad del entorno de despliegue

**Etapa 7: Implementación** · Responsable: **Jeison Vásquez** · Revisa: **Andy Martínez**

> Evaluar la seguridad del entorno de despliegue y revisar las configuraciones de seguridad. (Red Hat, *Seguridad en el ciclo de vida de desarrollo del software*.)

## Cómo completarla

1. Todas las comprobaciones son de solo lectura. Anotá el resultado y la fecha de cada una.
2. Si algo no da lo esperado, abrí un hallazgo y no cambies nada sin respaldo y ventana acordada.

## Comprobaciones

| Comprobación | Comando | Esperado | VM1 | VM2 |
|---|---|---|---|---|
| SELinux | `getenforce` | Enforcing | [completar] | [completar] |
| Cortafuegos | `sudo firewall-cmd --list-all` | Solo los puertos necesarios | [completar] | [completar] |
| SSH sin contraseña | `sudo sshd -T \| grep passwordauthentication` | no | [completar] | [completar] |
| Puertos abiertos | `sudo ss -tlnp` | Solo los servicios de SIGET | [completar] | [completar] |
| Versión del sistema | `cat /etc/rocky-release` | La última versión menor (9.8) | [completar] | [completar] |
| Avisos críticos | `sudo dnf updateinfo list --security` | Ninguno crítico | [completar] | [completar] |
| TLS y cabeceras | `nmap --script ssl-enum-ciphers,http-security-headers -p 8443` | TLS 1.3, calificación A, HSTS y CSP | [completar] | — |
| Contenedores sin root | `podman exec siget-backend id -u` | 1001 | [completar] | — |

## Registro de la actualización a Rocky 9.8

Fecha, respaldo previo, resultado de `dnf update`, reinicio, verificaciones (`verificar_*`) y ensayo después de actualizar.
