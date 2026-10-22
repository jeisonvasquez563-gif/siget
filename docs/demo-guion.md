# Guion de la demostración

Qué mostrar al profesor y en qué orden. La plataforma corre en VM1 (`app-backend`) detrás de nginx con TLS 1.3 y trabaja contra PostgreSQL en VM2. Esta guía no contiene contraseñas: están solo en el PC de Jeison, en `demo-local/` (ignorado por git).

## Lista de verificación del día de la demostración (30 minutos antes)

1. **Encender las VMs** y esperar 2 minutos. Si se encienden a la vez, el backend reintenta solo hasta que la base responda. **No reiniciar ninguna VM ahora** (ambas tienen un reinicio por actualizaciones pendiente: se hace *después* de la presentación y se comprueba que todo arranca solo).
2. **Ensayo automático** (≈3 minutos, no deja nada roto; solo agrega tres trámites):
   ```bash
   backend/.venv/Scripts/python.exe demo/ensayo.py
   ```
   Debe terminar en **«59 de 59 comprobaciones correctas»**. Revisa la hora de las VMs, el certificado, TLS 1.3, las 13 cuentas, el segundo factor, la auditoría, el simulador y el cierre de sesión. Si algo falla, ver «Si algo falla en vivo».
3. **Confiar en la CA interna** para que el navegador no avise «conexión no privada» (PowerShell, usuario normal):
   ```powershell
   certutil -addstore -user Root infra\pki\siget-ca.crt
   ```
4. **Abrir** `https://192.168.159.137:8443` (o `https://100.104.206.118:8443` por Tailscale) y comprobar que se ve el acceso. Zoom del navegador al 110 % si se proyecta; probar el modo claro y el oscuro (botón de la barra superior).
5. **Códigos del segundo factor** (el código cambia cada 30 s y no se puede reutilizar):
   ```bash
   backend/.venv/Scripts/python.exe demo/codigo.py            # todas las cuentas: contraseña y código vigente
   backend/.venv/Scripts/python.exe demo/codigo.py fabio.mop  # una sola
   ```
6. **Para el alta del segundo factor en vivo** (paso 12): tener el celular con una aplicación de autenticación (Google Authenticator, Microsoft Authenticator, Aegis…).
7. **Plan B a mano:** `?mock` del frontend (ver `frontend/README.md`) muestra todas las pantallas sin servidores, con datos de ejemplo; y las capturas de la sección «Si algo falla».

## Las cuentas (una por rol)

| Cuenta | Rol | Qué ve |
|---|---|---|
| `ana.ciudadana`, `beto.ciudadano` | Ciudadanía | Mis trámites, Iniciar un trámite, Mi seguridad, Segundo factor, Roles y permisos |
| `fabio.mop`, `flor.mop` | Funcionario del MOP | Lo anterior + Bandeja de la institución |
| `saul.mop` | Supervisor del MOP | Lo anterior + Supervisión (reasignar) y Equipo |
| `carla.mop` | Coordinadora del MOP | Equipo y roles; **no** ve trámites |
| `felix.minsa` | Funcionario del MINSA | Bandeja del MINSA (no ve la del MOP) |
| `ines.infra`, `ivan.identidades`, `cata.catalogo`, `sergio.seguridad`, `silvia.secretos` | Los 5 roles de plataforma | Solo su consola («próximamente») y «Acceso a trámites» |
| `aldo.auditor` | Auditor | Auditoría: decisiones de acceso, eventos de seguridad y actuaciones en trámites (solo lectura) |

## Recorrido sugerido (≈20 minutos; los pasos marcados ★ son los imprescindibles)

1. ★ **Login en dos pasos y segundo factor.** Entrar como `ana.ciudadana`: primero solo usuario y contraseña; **el campo del código aparece después**, solo si la contraseña es correcta (así la pantalla no delata quién tiene segundo factor). Escribir el código y entrar. Mostrar «Mi seguridad»: la credencial, la ventana del segundo factor y lo que *puede* y *no puede* hacer.
2. **La ciudadana inicia un trámite** (Iniciar un trámite → MOP) y ve su estado e historial con las esclusas. No ve qué funcionario lo atiende.
3. ★ **`fabio.mop` (funcionario).** Cerrar sesión y entrar. Bandeja: solo trámites del MOP. Abrir el trámite nuevo y pasarlo a «En tramitación»; aparece en el historial **con quién lo hizo**. Probar el tablero. Aprobarlo (pide confirmación: es un estado final) y mostrar el sello.
   - **Ojo con la reautenticación escalonada:** el código con el que se inicia sesión ya cuenta como segundo factor reciente (dura 15 minutos), así que **el cuadro «Confirma que eres tú» NO aparece al cambiar el estado justo después de entrar**. Para mostrarlo en vivo, ver «Cómo mostrar la reautenticación escalonada» abajo.
4. ★ **Conflicto de interés.** Con `fabio.mop`, iniciar un trámite propio y abrirlo: no puede gestionarlo.
5. **`saul.mop` (supervisor).** Supervisión → reasignar un trámite a `flor.mop`. Mostrar «Equipo».
6. **`felix.minsa`.** Su bandeja solo tiene trámites del MINSA: lo del MOP **no existe** para él (404, no «prohibido»).
7. **`carla.mop` (coordinadora).** Ve el equipo y los roles de su institución, pero la lista de trámites está vacía: gestionar personas no da acceso a los datos de la ciudadanía.
8. ★ **Un rol de plataforma** (por ejemplo `ines.infra`). Menú distinto: solo su consola. En «Acceso a trámites», pulsar el botón: el servidor responde 403 y la decisión queda registrada. *Ningún operador, ni el de infraestructura, ve trámites; y no existe un superusuario.*
9. ★ **`aldo.auditor`.** Auditoría: el resumen muestra cuántas decisiones permitió y negó el sistema y qué políticas las motivaron; en «Decisiones de acceso» se filtra por «Solo negadas» y se ve quién intentó qué (por ejemplo, Ines pidiendo trámites). Remarcar: **la consola lee con un rol de base de datos de solo lectura** y **la propia consulta del auditor queda registrada** (quién audita al auditor).
10. ★ **Roles y permisos** (cualquier cuenta, mejor `saul.mop`). Menú «Seguridad y permisos» → «Roles y permisos»:
    - *Roles y módulos* y **Módulos por rol:** los 10 roles, cuántas acciones puede cada uno y sus módulos; la tabla **Módulos por rol** cruza los 15 módulos con los 10 roles (un rol llega a varios módulos y un módulo lo comparten varios roles); el aviso verde **«No existe un superusuario»** (el que más puede hace 6 de 18).
    - *Matriz de permisos:* cada ✔/✖ sale de evaluar el motor de decisiones real. Pulsar una celda explica **la política que decidió**. Alternar «Fuera de su ámbito». La llave marca lo que **exige segundo factor reciente**.
    - *¿Qué pasaría si…?:* **la pieza más vistosa.** Elegir un escenario («El segundo factor venció», «…y el trámite lo pidió él mismo», «El operador de infraestructura quiere ver un trámite») y mostrar el veredicto, **la traza regla por regla** y «qué lo cambiaría» (con «Probarlo»). Armar uno propio cambiando el rol y las circunstancias. Remarcar: *lo responde el motor de decisiones real y no deja rastro en la auditoría*.
    - *Base de datos:* elegir `auditor_role` (solo lee) y `app_role` (inserta decisiones pero no las altera ni borra); ningún rol es superusuario; RLS y disparadores por tabla.
    - *Cómo se decide:* las cinco capas y «si esta capa fallara…».
11. ★ **Segundo factor (MFA)** (`fabio.mop`). Menú «Segundo factor (MFA)»: explicar los 6 pasos; escribir el código actual en «Pruébalo ahora» → la ventana se renueva; luego **«Enviar el mismo código de nuevo»** → el servidor lo rechaza (anti-repetición). Mostrar la actividad de seguridad propia. *No introducir códigos incorrectos a propósito: tres bloquean la cuenta, y el bloqueo es progresivo (5 minutos, luego 15 y luego 60). Si se quiere mostrar, hacerlo con una cuenta que no se vaya a usar después.*
12. ★ **Crear una cuenta y alta del segundo factor en vivo:** «Crear una cuenta» pide nombre, apellidos, cédula (formato panameño, p. ej. `8-123-456`), fecha de nacimiento (mayor de 18), provincia, ciudad y correo, más usuario y contraseña de 12 caracteres o más. Al enviar, entra directo al código QR para escanear con el celular → confirmar con el código. Remarcar: *la cédula se guarda cifrada y ni el auditor ni ningún otro rol puede leer los datos personales; el correo aún no se verifica (no hay servidor de correo). Deja una cuenta nueva en la base: el registro es inalterable y la cuenta se puede suspender, no borrar.*
13. ★ **Cierre por inactividad y recarga.** Con una sesión abierta y un trámite a la vista: **recargar la página (F5)** → vuelve al Inicio (la vista no se recuerda). Dejar la sesión sin tocar: a los 9 minutos sale el aviso «¿Sigues ahí?» con cuenta regresiva y a los 10 se cierra la sesión (se revoca en el servidor) y el acceso explica el motivo. Para no esperar 10 minutos, ver «Cómo mostrar el cierre por inactividad».
14. **Bloqueo progresivo** (opcional, con una cuenta de prueba): tres intentos fallidos bloquean 5 minutos; si se repite, 15; luego 60. Un inicio de sesión correcto reinicia la escalera. La respuesta es idéntica a una contraseña mala: no revela que la cuenta está bloqueada.

## Cómo mostrar la reautenticación escalonada

Es la pieza del segundo factor que más impresiona y la que no aparece sola, porque el inicio de sesión ya verifica el factor. Tres formas, de la más segura a la más vistosa:

- **A. Con el simulador (sin riesgo):** escenario «El segundo factor venció» → se niega y «qué lo cambiaría» dice que con un segundo factor reciente se permitiría. Es el mismo motor que decide de verdad.
- **B. Esperar:** iniciar sesión como `fabio.mop`, mostrar otras pantallas y volver a cambiar un estado pasados 15 minutos (útil si la presentación es larga).
- **C. Acortar la ventana para la demostración (decisión de Jeison):** en VM1, agregar `Environment=SIGET_MFA_RECIENTE_MINUTOS=2` a `/home/siget/.config/containers/systemd/siget-backend.container`, y reiniciar:
  ```bash
  sudo -H -u siget bash -lc 'export XDG_RUNTIME_DIR=/run/user/1009; systemctl --user daemon-reload; systemctl --user stop siget-nginx.service siget-backend.service siget-pod.service; systemctl --user start siget-pod.service; sleep 3; systemctl --user start siget-backend.service siget-nginx.service'
  ```
  Toda la interfaz (anillo, textos, matriz y simulador) toma la ventana del servidor. Al terminar, quitar la línea y repetir el reinicio para volver a 15 minutos. Es una ventana **más estricta**, no más débil.

## Cómo mostrar el cierre por inactividad

La sesión se cierra a los **10 minutos** sin actividad, con aviso un minuto antes; el servidor además rechaza renovar un acceso que nadie usó durante 15 minutos y ninguna sesión pasa de 8 horas. Para no esperar 10 minutos (decisión de Jeison): en VM1, agregar `Environment=SIGET_INACTIVIDAD_MINUTOS=2` a `/home/siget/.config/containers/systemd/siget-backend.container` y reiniciar el pod con el mismo comando de la opción C de arriba. Con 2 minutos, el aviso sale al minuto y el cierre a los 2. Al terminar, quitar la línea y reiniciar. Es una ventana **más estricta**, no más débil.

## Qué decir (hilo conductor: Zero Trust)

- **Nunca confiar, siempre verificar:** cada petición revalida token, sesión, cuenta y política; la interfaz solo *muestra* el menú, quien decide es el servidor (PDP/ABAC) y, otra vez, la base de datos (RLS).
- **Mínimo privilegio y separación de poderes:** 5 roles de plataforma + auditor, sin superusuario; el control dual para altas sensibles; nadie se asigna un rol a sí mismo (lo impone la base).
- **Trazabilidad:** cada cambio de estado queda en el historial inalterable, escrito por la propia base en la misma transacción.
- **Defensa en capas:** TLS 1.3 → nginx → Django/DRF → PDP → RLS en PostgreSQL → contenedores rootless sin privilegios.
- **Verificable:** la matriz y el simulador salen del motor real; hay 415 pruebas del backend, 141 del frontend (con accesibilidad y seguridad del código) y pruebas contra la base real.

## Preguntas que puede hacer el profesor

| Pregunta | Respuesta corta |
|---|---|
| ¿Quién es el administrador? | No existe: 5 roles de plataforma, cada uno con su área y control dual en las altas; el auditor solo lee. El superusuario de PostgreSQL existe pero no tiene contraseña y se rechaza por red. |
| ¿Qué pasa si el backend tiene un error? | La base sigue protegiendo: RLS filtra filas, los disparadores validan transiciones y el registro es de solo inserción. |
| ¿Dónde se guarda el secreto del segundo factor? | Cifrado (Fernet) en la base; solo se muestra una vez, al activarlo. |
| ¿Y si me roban el token? | Dura 10 minutos; el de renovación es de un solo uso y su reuso revoca la sesión. |
| ¿Se puede borrar o alterar la auditoría? | No: sin permisos para ningún rol que se conecta, y disparadores que lo rechazan incluso para el dueño de la tabla. |
| ¿Por qué hay un checkpoint en PHP? | Es el entregable intermedio; se retira en la semana 6 cuando el frontend en React lo reemplaza. |

## Si algo falla en vivo

| Síntoma | Causa probable | Solución |
|---|---|---|
| La página no abre | VM1 apagada o pod caído | En VM1: `sudo -H -u siget bash -lc "export XDG_RUNTIME_DIR=/run/user/1009; systemctl --user start siget-pod.service siget-backend.service siget-nginx.service"` |
| «Usuario, contraseña o código incorrectos» con todo correcto | Código ya usado o reloj desfasado | Esperar al siguiente código (30 s); revisar `date` en las VMs |
| Cuenta bloqueada | 3 intentos fallidos | Se desbloquea sola (5 minutos; 15 o 60 si se repitió); usar otra cuenta del mismo rol mientras tanto |
| Aparece «Confirma que eres tú» | Segundo factor con más de 15 minutos | Es lo esperado: ingresar un código nuevo |
| 500 o «No se pudo conectar» al listar | Contenedor de la base caído en VM2 | `sudo -H -u siget bash -lc "export XDG_RUNTIME_DIR=/run/user/1009; systemctl --user start siget-postgres.service"` |
| El navegador avisa «conexión no privada» | CA interna sin instalar | Instalarla (lista, punto 3) o continuar de todos modos |
| Todo cae a la vez | VMs apagadas o sin red | Plan B: `?mock` del frontend con datos de ejemplo |

## Limpieza posterior

Las cuentas de demostración son solo del laboratorio: antes de cualquier uso real hay que suspenderlas (el operador de seguridad dispone de esa acción) y rotar los secretos. El registro de auditoría es inalterable y conserva todo lo hecho durante la demostración. Después de la presentación: aplicar las actualizaciones pendientes y reiniciar ambas VMs para comprobar que todo arranca solo.
