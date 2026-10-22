# Abrir SIGET a internet (pendiente)

**Estado: aplazado el 21 de octubre de 2026.** El análisis está hecho y las decisiones, sin tomar. Este documento deja todo listo para retomarlo sin repetir la investigación. Hoy la plataforma solo es accesible desde la red de VMware (`192.168.159.137`) y por la red privada Tailscale del proyecto (`100.104.206.118`); ver [`como-abrir-la-plataforma.md`](./como-abrir-la-plataforma.md).

**Objetivo:** que cualquier computador con internet pueda abrir un enlace `https://…` y usar SIGET, sin instalar la CA del proyecto ni estar en la tailnet.

## 1. Opciones

| Opción | Cómo funciona | A favor | En contra |
|---|---|---|---|
| **Tailscale Funnel (recomendada)** | Publica un servicio de VM1 en `https://app-backend.<tailnet>.ts.net`. Ya usamos Tailscale | Certificado válido (nadie instala la CA). **El TLS lo termina la propia VM**: los relays de Tailscale no descifran el tráfico. Se apaga al instante. Sin tocar el router ni exponer la IP doméstica | Solo los puertos públicos 443, 8443 y 10000 y solo dominios `*.ts.net`. Límites de ancho de banda no configurables. Requiere habilitar HTTPS y Funnel en la consola de Tailscale. Una cabecera de IP real por confirmar (ver 2.1) |
| **Cloudflare Tunnel** | `cloudflared` abre un túnel saliente hacia Cloudflare | Protección contra DDoS y WAF; permite una puerta de acceso previa (Cloudflare Access) | Un enlace estable requiere un dominio (~US$10 al año); el «quick tunnel» sin dominio cambia de URL en cada reinicio y no admite Access. **El TLS se descifra en Cloudflare** (un tercero ve el tráfico) |
| Reenvío de puertos + DDNS + Let's Encrypt | Se abre un puerto del router hacia el PC | Sin intermediarios | Expone la IP doméstica, probable choque con CGNAT, y las VMs están detrás del NAT de VMware. **No recomendada** |

Requisitos de Funnel según la documentación de Tailscale: cliente 1.38.3 o superior, MagicDNS y HTTPS habilitados, y el atributo `funnel` en la política de la tailnet (la consola ofrece «Add Funnel to policy»; también se aprueba al ejecutar `tailscale funnel`). Un mismo puerto no puede servirse a la vez en modo privado (`serve`) y público (`funnel`).

## 2. Lo que hay que resolver antes de abrirla

Abrir SIGET a internet cambia el modelo de amenazas. Estos puntos son específicos de nuestro sistema:

1. **La IP real del cliente.** Los límites de tasa de nginx y el bloqueo por intentos de la autenticación se calculan por IP, y nginx hoy usa la dirección del par (`$remote_addr`). Detrás de un proxy, todos los visitantes llegarían con la misma IP: **un solo atacante podría provocar errores 429 a todos**. Hay que configurar nginx para leer la IP real (`set_real_ip_from` + `real_ip_header`) y confiar solo en el proxy conocido. Confirmar qué cabecera reenvía Funnel (la documentación consultada no lo dice) o la de Cloudflare (`CF-Connecting-IP`).
2. **Las cuentas de demostración.** Sus contraseñas (3 palabras y 4 dígitos) sirven para un laboratorio, no para internet. El segundo factor impide el robo de cuenta, pero **el bloqueo tras 3 intentos permitiría a cualquiera bloquear a propósito a `fabio.mop` o a `aldo.auditor`**. Rotarlas por contraseñas largas o suspenderlas y crear cuentas nuevas para el público.
3. **El registro abierto.** Cualquiera podría crear cuentas, y la auditoría es inalterable: esos registros quedarían para siempre. Cerrar el registro o exigir un código de invitación (configuración, no código fijo).
4. **Ajustes menores:** agregar el nuevo nombre a `SIGET_ALLOWED_HOSTS`; un aviso visible de «demostración académica»; no pedir ni aceptar datos reales (cédula, etc.).
5. **Disponibilidad:** todo corre en un PC con VMware; el enlace vive solo mientras el PC y las VMs estén encendidos.
6. **Parches:** ambas VMs tienen actualizaciones pendientes; con exposición pública conviene aplicarlas antes (con respaldo previo, ver runbook 32.2).
7. **Vigilancia:** la consola de auditoría ya muestra los inicios de sesión fallidos; durante la ventana pública conviene revisarla. Una alerta automática ante ráfagas sigue pendiente (ZT-8).
8. **Ventana acotada:** abierta solo durante la presentación y apagada después.

## 3. Plan propuesto (Funnel, ventana acotada)

| # | Paso | Quién |
|---|---|---|
| 1 | Decidir las preguntas de la sección 4 | Jeison |
| 2 | Respaldo de la base (runbook 32.2) y, si se decide, actualizar y reiniciar las VMs | Operador de las VMs |
| 3 | nginx: leer la IP real del cliente desde el proxy; límites de tasa por esa IP | Backend / infraestructura |
| 4 | Variable `SIGET_REGISTRO` (cerrado / con invitación / abierto) y pruebas del registro | Backend |
| 5 | Nuevo nombre en `SIGET_ALLOWED_HOSTS` y aviso de «demostración académica» en la interfaz | Backend y frontend |
| 6 | Rotar o suspender las cuentas de demostración y crear las del público | Operador de las VMs |
| 7 | Habilitar MagicDNS, HTTPS y Funnel en la consola de Tailscale (requiere sesión de la persona dueña de la tailnet) | Jeison |
| 8 | En VM1, publicar con Funnel hacia nginx (`https+insecure://127.0.0.1:8443`, por el certificado de la CA interna) y **confirmar la sintaxis con la documentación vigente** | Operador de las VMs |
| 9 | Probar desde un celular con datos móviles: abre, TLS válido, login con segundo factor, límites de tasa por IP real, bloqueo de una cuenta que no afecte a otras | Equipo |
| 10 | Documentar en el runbook y apagar al terminar (`tailscale funnel` en modo apagado) | Operador de las VMs |

**Criterios de «listo»:** desde internet se abre sin advertencias; un intento de fuerza bruta desde una IP no bloquea a las demás; con el registro cerrado no se crean cuentas; el ensayo (`demo/ensayo.py`) sigue en 55 de 55; y se puede apagar en un solo comando.

## 4. Decisiones pendientes

1. ¿Tailscale Funnel (recomendada) o Cloudflare Tunnel (requiere un dominio)?
2. ¿Abierto de forma **permanente** o **solo durante la presentación**?
3. ¿Registro **cerrado**, o abierto **con código de invitación**?
4. ¿Se **rotan** las contraseñas de las cuentas de demostración por unas largas, o se **suspenden** y se crean cuentas nuevas para el público?

## 5. Fuentes

- Tailscale, [Tailscale Funnel](https://tailscale.com/kb/1223/funnel): requisitos, puertos públicos (443, 8443, 10000), terminación del TLS en el dispositivo y límites.
- Cloudflare, documentación de [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/): túneles con nombre (requieren una zona en Cloudflare) y túneles rápidos (sin cuenta, URL efímera).
