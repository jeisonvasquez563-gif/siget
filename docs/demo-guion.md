# Guion de la demostración

Qué mostrar al profesor y en qué orden. La plataforma corre en VM1 (`app-backend`) detrás de nginx con TLS 1.3 y trabaja contra PostgreSQL en VM2; esta guía no contiene contraseñas (están solo en el PC de Jeison, en `demo-local/`, ignorado por git).

## Antes de empezar (una sola vez en el PC que se proyecta)

1. Encender VM1 y VM2 y comprobar la hora (`date` en ambas: debe coincidir con la del PC; el segundo factor depende del reloj).
2. Confiar en la CA interna para que el navegador no muestre advertencias (PowerShell, usuario normal):
   ```powershell
   certutil -addstore -user Root infra\pki\siget-ca.crt
   ```
   Si no se instala, el navegador avisa «conexión no privada»: se puede continuar, pero la cookie de sesión funciona igual.
3. Abrir **https://192.168.159.137:8443** (o `https://100.104.206.118:8443` por Tailscale).
4. Tener a mano los códigos del segundo factor. Cada cuenta de demostración ya lo tiene activado; en el PC de Jeison:
   ```bash
   backend/.venv/Scripts/python.exe demo-local/codigo.py            # todas las cuentas, contraseña y código vigente
   backend/.venv/Scripts/python.exe demo-local/codigo.py fabio.mop  # una sola
   ```
   El código cambia cada 30 segundos y no se puede reusar: si el login falla por «código ya usado», esperar al siguiente.

## Las cuentas (una por rol)

| Cuenta | Rol | Qué ve |
|---|---|---|
| `ana.ciudadana`, `beto.ciudadano` | Ciudadanía | Mis trámites, Iniciar un trámite, Mi seguridad |
| `fabio.mop`, `flor.mop` | Funcionario del MOP | Lo anterior + Bandeja de la institución |
| `saul.mop` | Supervisor del MOP | Lo anterior + Supervisión (reasignar) y Equipo |
| `carla.mop` | Coordinadora del MOP | Equipo y roles; **no** ve trámites |
| `felix.minsa` | Funcionario del MINSA | Bandeja del MINSA (no ve la del MOP) |
| `ines.infra`, `ivan.identidades`, `cata.catalogo`, `sergio.seguridad`, `silvia.secretos` | Los 5 roles de plataforma | Solo su consola (próximamente) y «Acceso a trámites» |
| `aldo.auditor` | Auditor | Auditoría: decisiones de acceso, eventos de seguridad y actuaciones en trámites (solo lectura) |

## Recorrido sugerido (≈10 minutos)

1. **Login y segundo factor.** Entrar como `ana.ciudadana` con su contraseña y el código. Mostrar «Mi seguridad»: rol, segundo factor, y la lista de lo que *puede* y *no puede* hacer.
   - Opcional en vivo: «Crear cuenta» con un usuario nuevo → al entrar, la plataforma exige activar el segundo factor con un código QR (el secreto se muestra una sola vez y queda cifrado).
2. **La ciudadana inicia un trámite** (Iniciar un trámite → MOP) y ve su estado e historial. Nota: no ve qué funcionario lo atiende.
3. **Cerrar sesión y entrar como `fabio.mop`** (funcionario). Bandeja: solo trámites del MOP. Abrir el trámite nuevo y pasarlo a «En tramitación» → pide el código del segundo factor reciente (reautenticación escalonada) → se mueve y aparece en el historial con quién lo hizo.
4. **Conflicto de interés.** Con `fabio.mop`, iniciar un trámite propio y abrirlo: no puede gestionarlo.
5. **`saul.mop` (supervisor).** Supervisión → reasignar un trámite a `flor.mop`. Mostrar «Equipo».
6. **`felix.minsa`.** Su bandeja solo tiene trámites del MINSA: lo del MOP **no existe** para él (404, no «prohibido»).
7. **`carla.mop` (coordinadora).** Ve el equipo y los roles de su institución, pero la lista de trámites está vacía: gestionar personas no da acceso a los datos de los ciudadanos.
8. **Un rol de plataforma** (por ejemplo `ines.infra`). Menú distinto: solo su consola. En «Acceso a trámites», pulsar el botón: el PDP responde 403 y la decisión queda registrada. *Ningún operador, ni siquiera el de infraestructura, ve trámites; y no existe un superusuario.*

9. **`aldo.auditor`.** Auditoría: el resumen muestra cuántas decisiones permitió y negó el sistema y qué políticas las motivaron; en «Decisiones de acceso» se filtra por «Solo negadas» y se ve quién intentó qué (por ejemplo, el operador de infraestructura pidiendo trámites). Remarcar: **la consola lee con un rol de base de datos de solo lectura** y **la propia consulta del auditor queda registrada** (quién audita al auditor).

## Qué decir (hilo conductor: Zero Trust)

- **Nunca confiar, siempre verificar:** cada petición revalida token, sesión, cuenta y política; la interfaz solo *muestra* el menú, quien decide es el servidor (PDP/ABAC) y, otra vez, la base de datos (RLS).
- **Mínimo privilegio y separación de poderes:** 5 roles de plataforma + auditor, sin superusuario; el control dual para altas sensibles; nadie se asigna un rol a sí mismo (lo impone la base).
- **Trazabilidad:** cada cambio de estado queda en el historial inalterable, escrito por la propia base en la misma transacción.
- **Defensa en capas:** TLS 1.3 → nginx → Django/DRF → PDP → RLS en PostgreSQL → contenedores rootless sin privilegios.

## Si algo falla en vivo

| Síntoma | Causa probable | Solución |
|---|---|---|
| La página no abre | VM1 apagada o pod caído | En VM1: `sudo -H -u siget bash -lc "export XDG_RUNTIME_DIR=/run/user/1009; systemctl --user start siget-pod.service siget-backend.service siget-nginx.service"` |
| «Credenciales inválidas» con la contraseña correcta | Código ya usado o reloj desfasado | Esperar al siguiente código (30 s); revisar `date` en las VMs |
| Cuenta bloqueada | 3 intentos fallidos | Se desbloquea sola a los 5 minutos |
| Aparece «Confirma tu identidad» | Segundo factor con más de 15 minutos | Es lo esperado: ingresar un código nuevo |
| 500 o conexión rechazada al listar | Contenedor de la base caído en VM2 | `sudo -H -u siget bash -lc "export XDG_RUNTIME_DIR=/run/user/1009; systemctl --user start siget-postgres.service"` |

## Limpieza posterior

Las cuentas de demostración son solo del laboratorio: antes de cualquier uso real hay que suspenderlas (el operador de seguridad dispone de esa acción) y rotar los secretos. El registro de auditoría es inalterable y conserva todo lo hecho durante la demostración.
