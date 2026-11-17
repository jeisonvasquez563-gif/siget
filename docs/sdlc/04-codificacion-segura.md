# Guía de codificación segura de SIGET

**Etapa 4: Desarrollo** · Responsable: **Andy Martínez** · Revisa: **Jeison Vásquez**

> Capacitar en prácticas de codificación segura, incorporar herramientas de prueba de seguridad al desarrollo y evaluar las dependencias. (Red Hat, *Seguridad en el ciclo de vida de desarrollo del software*.)

## Cómo se elaboró

1. Se redactaron 14 reglas de codificación segura, cada una con un ejemplo real de SIGET (el archivo donde se aplica y, cuando corresponde, la función). Cada ejemplo se comprobó leyendo el código de la rama con las correcciones del análisis estático y dinámico, y las ramas `feature/backend-documentos`, `feature/backend-registro-configurable` y `feature/backend-plazos` ya desplegadas.
2. Se explica cómo leer un fallo de `security-scan.yml` y cuándo un `# nosec` o un `nosemgrep` está justificado (siempre con el motivo escrito al lado).
3. Con esta guía se armó el guion de la charla de 20 minutos y la lista de preguntas que puede hacer el profesor.

## Reglas

| # | Regla | Ejemplo en SIGET |
|---|---|---|
| 1 | Las consultas SQL siempre con parámetros, nunca armando el texto con datos del usuario | `cursor.execute(sql, [valores])` en `apps/identidad/equipo.py` (`c.execute("select siget.tramites_abiertos_de(%s, %s)", [persona_id, institucion_id])`) y en `fijar_contexto` de `apps/nucleo/contexto.py` |
| 2 | Validar el tipo y el rango de todo dato que llega por la API antes de usarlo: un entero es un entero (no un booleano, un texto ni un número gigante) | `entero_positivo` en `apps/tramites/serializacion.py` rechaza `True`, textos, decimales y valores que no caben en un `bigint`; `fijar_contexto` en `apps/nucleo/contexto.py` hace la misma comprobación antes de tocar la base |
| 3 | Denegar por defecto: si nadie permitió la acción de forma explícita, se niega, y cualquier fallo del control de acceso también niega | `apps/autorizacion/pdp.py` (punto de decisión de acceso): cualquier excepción se traduce en `Decision(False, "fallo_del_pdp", ...)`; `PermisoPDP` en `apps/autorizacion/permisos.py` niega la vista que no declara su `accion_pdp` |
| 4 | Toda operación sobre un recurso pasa por el punto de decisión, nunca por un `if` suelto en la vista | `autorizar(request, accion, recurso)` en `apps/autorizacion/permisos.py`: consulta al PDP y, si no permite, lanza 403 |
| 5 | No usar `assert` para validar: Python lo borra al ejecutar con `-O`, y entonces la validación desaparece sin avisar. Se valida con una excepción explícita | `apps/nucleo/management/commands/sembrar_demo.py` lanza `CommandError` cuando la API responde algo inesperado (antes usaba `assert`; Bandit B101) |
| 6 | Los secretos nunca van en el código ni en el repositorio: se entregan como `podman secret` (un archivo) y la aplicación los lee de ahí | `_leer(nombre)` en `backend/config/settings.py` lee `NOMBRE_FILE` y exige el secreto: `SECRET_KEY = _leer("SIGET_SECRET_KEY", obligatorio=True)`, igual para `SIGET_JWT_KEY`, `SIGET_MFA_KEY` y la clave de la base de datos |
| 7 | Las contraseñas se guardan con un hash lento y con sal (Argon2), jamás en claro ni con hashes rápidos; y se prefiere la longitud sobre las reglas de composición (NIST SP 800-63B) | `PASSWORD_HASHERS = ["django.contrib.auth.hashers.Argon2PasswordHasher"]` en `backend/config/settings.py`; `apps/autenticacion/contrasenas.py` (`hashear` usa `make_password`; `inutilizable()` para cuentas sin contraseña) |
| 8 | Los mensajes de error no deben permitir adivinar si un usuario existe: misma respuesta y mismo tiempo para «usuario inexistente» y «contraseña incorrecta» | `iniciar_sesion` en `apps/autenticacion/servicio.py` devuelve siempre `credenciales_invalidas`; `verificacion_falsa` en `apps/autenticacion/contrasenas.py` gasta el mismo tiempo de cálculo cuando el usuario no existe; `autorizar` responde siempre «No tienes autorización para esta operación.» sin decir qué regla falló |
| 9 | Los archivos subidos se validan por su contenido (bytes iniciales), no por la extensión que dice el nombre, y se limita el tamaño | `validar` en `apps/tramites/documentos.py` (rama `feature/backend-documentos`): detecta PDF, PNG o JPEG por sus bytes mágicos (por ejemplo `%PDF-`), y la extensión debe coincidir con lo detectado |
| 10 | La ruta de un archivo en disco la genera el servidor, nunca el nombre que manda la persona (evita recorrer carpetas con `../`) | `nueva_ubicacion()` en `apps/tramites/documentos.py` genera `secrets.token_hex(16)`; `_ruta` en `apps/tramites/almacen.py` solo acepta 32 caracteres hexadecimales y escribe con permisos 600 sin pisar archivos existentes |
| 11 | Las descargas siempre como archivo, nunca para abrirse dentro de la página, y el navegador no debe adivinar el tipo | `content_disposition` en `apps/tramites/documentos.py` devuelve `attachment; filename=...`; `X-Content-Type-Options: nosniff` en `infra/podman/vm1-app-backend/nginx.conf` y `SECURE_CONTENT_TYPE_NOSNIFF = True` en `backend/config/settings.py` |
| 12 | Nada de scripts ni estilos escritos dentro del HTML o de los componentes: la política de contenido (CSP) los bloquea, así que cualquier inyección de código no se ejecuta | CSP `default-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'` en `infra/podman/vm1-app-backend/nginx.conf`; el frontend cumple con hojas de estilo propias y una prueba (`frontend/src/pruebas/seguridad.prueba.js`) falla si aparece `dangerouslySetInnerHTML`, `eval` o `new Function` |
| 13 | El token de acceso vive solo en memoria del navegador; lo que debe durar (el token de refresco) viaja en una cookie `HttpOnly`, `Secure` y `SameSite=Strict`, que el JavaScript no puede leer | `frontend/src/api.js` (variable `tokenDeAcceso`, nunca `localStorage`); `apps/autenticacion/vistas.py` (`set_cookie(... httponly=True, secure=True, samesite="Strict")`) |
| 14 | La bitácora de seguridad no guarda datos personales (cédula, correo, contraseñas ni códigos) y es de solo inserción | `registrar_evento` en `apps/autenticacion/servicio.py` (el registro se anota «sin datos personales»); `SoloInsercion` en `apps/nucleo/modelos.py` para las tablas de auditoría |

## Herramientas del CI de seguridad

El flujo `.github/workflows/security-scan.yml` corre en cada pull request, en cada push a `develop` o `main` y una vez por semana (los lunes, porque aparecen vulnerabilidades nuevas en dependencias que no cambiaron). **Cualquier hallazgo hace fallar el flujo**: un PR con alguna de estas luces en rojo no se fusiona.

| Herramienta | Qué revisa | Qué hacer si falla |
|---|---|---|
| Bandit | Código Python del backend (`backend/apps`, `backend/config`, `manage.py`; excluye `backend/tests`) | 1) Abrir el registro del job y ubicar el código del hallazgo (por ejemplo `B101` = uso de `assert`, `B105` = posible contraseña escrita en el código, `B108` = directorio temporal inseguro), el archivo y la línea. 2) Decidir si es real. Si lo es, **corregir el código** (así se pasó de 20 hallazgos a 0: `CommandError` en lugar de `assert`, un directorio propio con permisos 700 en lugar de `/tmp`). 3) Solo si es un falso positivo, agregar `# nosec BXXX` en esa línea, con el motivo escrito al lado. 4) Volver a correr `bandit -r backend/apps backend/config backend/manage.py -x backend/tests` y confirmar 0 hallazgos antes de subir el cambio |
| Semgrep | Todo el código (backend, frontend, infraestructura, demo y base de datos) con las reglas del OWASP Top 10, Django, Python, JavaScript, React y detección de secretos | 1) Leer en el log el identificador de la regla (por ejemplo `generic.nginx.security.request-host-used`) y el archivo. 2) Entender qué riesgo describe la regla; el enlace de la regla trae un ejemplo de arreglo. 3) Corregir el código siempre que se pueda. 4) Si la regla es un falso positivo, escribir `nosemgrep: <id-de-la-regla> -- motivo` en un comentario justo encima de la línea (así está en `infra/podman/vm1-app-backend/nginx.conf`, donde el `map` de nginx ES la validación del Host). 5) Repetir con `semgrep scan --error --config p/owasp-top-ten ...` hasta quedar limpio |
| pip-audit | Dependencias de Python (`requirements.txt` y `requirements-dev.txt`) contra bases de vulnerabilidades conocidas | 1) Anotar paquete, versión instalada, identificador de la vulnerabilidad (CVE o PYSEC) y la versión que la corrige (la salida la muestra con `--desc on`). 2) Subir la versión en el archivo de requisitos a la corregida. Dependabot suele haber abierto ya un PR con ese cambio: revisarlo y fusionarlo. 3) Correr las pruebas, porque una actualización puede romper algo. 4) Si todavía no existe versión corregida, no se oculta el aviso: se documenta el riesgo, se evalúa si SIGET usa la función afectada y se busca una mitigación o un paquete alternativo |
| npm audit | Dependencias del frontend, sobre el árbol exacto de `package-lock.json` | 1) Leer el paquete, la gravedad y la ruta de dependencias que lo trae. 2) Correr `npm audit fix` en `frontend`, que actualiza sin cambios incompatibles; evitar `--force` sin revisar, porque puede subir versiones mayores y romper la interfaz. 3) Si la vulnerabilidad está en una dependencia indirecta, actualizar el paquete que la trae. 4) Ejecutar las pruebas y la compilación del frontend, y subir el `package-lock.json` actualizado |
| Gitleaks | Secretos (claves, contraseñas, tokens) en todo el historial de Git, no solo en el último commit | 1) Tratar el hallazgo como una filtración real hasta demostrar lo contrario: ver el archivo, el commit y el tipo de secreto (el log lo muestra tapado con `--redact`). 2) Si es una credencial real, **rotarla de inmediato** (crear una nueva y anular la vieja): borrarla del código no basta, porque queda en el historial. 3) Mover el valor a un `podman secret` y leerlo con `_leer(..._FILE)`. 4) Solo si es un valor de prueba que nunca fue una credencial, agregar su huella (commit, archivo, regla y línea) a `.gitleaksignore` con un comentario que explique por qué es inofensivo, como ya está documentado para las contraseñas de prueba de `demo/ensayo.py` |

### Cuándo está justificado un `# nosec` o un `nosemgrep`

Silenciar una advertencia es decir «ya revisé esto y es seguro». Por eso solo vale si se cumplen las tres condiciones:

1. **Es un falso positivo demostrable**: la herramienta se equivoca porque no entiende el contexto. No es «no tengo tiempo de arreglarlo» ni «seguro no pasa nada».
2. **Lleva el motivo escrito al lado**: quien lea el código entiende por qué se omitió. Se pone el identificador exacto (`# nosec B105`, nunca un `# nosec` a secas que apague todo).
3. **Nunca tapa un hallazgo real**: si el código sí es vulnerable, se corrige.

Ejemplo real en SIGET: en `apps/nucleo/management/commands/verificar_autenticacion.py` (y `verificar_plataforma.py`) hay líneas como `{"username": "int_ana", "password": "corta"}  # nosec B105`. Bandit las marca como «contraseña escrita en el código» (B105), pero son contraseñas **inválidas a propósito**: la prueba las envía para comprobar que la API las rechaza (demasiado corta, demasiado común, incorrecta). No protegen ninguna cuenta. Al inicio del archivo un comentario lo explica, y son 9 líneas omitidas de forma específica (`B105`), no un apagado general. En cambio, el caso de las cuentas de prueba con el hash `"x"` (B106) sí era un hallazgo real de diseño y se corrigió con `contrasenas.inutilizable()`, sin `nosec`.

## Guion de la charla (20 minutos)

| Bloque | Tiempo | Contenido |
|---|---|---|
| 1. Qué es un SDLC seguro | 3 min | Qué es el ciclo de vida de desarrollo, por qué los fallos son más baratos de arreglar al inicio (shift left) y qué es DevSecOps según Red Hat: la seguridad en todas las etapas y con responsabilidad compartida. Dónde cae la etapa 4 (Desarrollo) dentro de las 8 etapas de SIGET |
| 2. Reglas de codificación segura de SIGET | 6 min | Recorrido por las 14 reglas, con el ejemplo real de cada una. Tres para mostrar el código en pantalla: consultas parametrizadas (regla 1), denegar por defecto con `autorizar()` (reglas 3 y 4) y no usar `assert` (regla 5). El resto, en una frase cada una |
| 3. Secretos, contraseñas y archivos | 3 min | Reglas 6 a 11: `podman secret` con `_leer`, Argon2, errores genéricos con `verificacion_falsa`, validación de archivos por contenido y rutas generadas por el servidor, descargas como `attachment` |
| 4. Herramientas del CI de seguridad | 4 min | Qué revisa cada una (Bandit, Semgrep, pip-audit, npm audit, Gitleaks) y cuál es SAST y cuál SCA; Dependabot que propone actualizaciones; mostrar un PR con el flujo `security-scan.yml` en verde y cuándo se justifica un `nosec` (el caso B105) |
| 5. Resultados y lo aprendido | 2 min | De 20 hallazgos de Bandit a 0, el ensayo 101/101 y ZAP sin alertas de riesgo; qué se corrigió y qué se justificó |
| 6. Preguntas | 2 min | Responder con la sección «Preguntas que puede hacer el profesor» como apoyo |

## Preguntas que puede hacer el profesor

**1. ¿Qué es «shift left» y qué es DevSecOps según Red Hat?**
Shift left («correr hacia la izquierda») es llevar la seguridad a las primeras etapas del proyecto, en lugar de dejarla para el final, porque corregir un fallo al diseñar o programar cuesta mucho menos que corregirlo con el sistema ya en producción. DevSecOps, según Red Hat, es integrar la seguridad en todo el ciclo de desarrollo y operación, de forma automática y con responsabilidad compartida entre desarrollo, seguridad y operaciones. En SIGET lo aplicamos con revisiones obligatorias y un flujo de seguridad que corre solo en cada cambio.

**2. ¿Qué es SAST y qué es SCA?**
SAST (análisis estático de seguridad) revisa nuestro propio código fuente sin ejecutarlo, buscando patrones peligrosos, como si un corrector leyera un texto buscando errores. SCA (análisis de composición de software) revisa las librerías de terceros que usamos, buscando versiones con vulnerabilidades ya conocidas. En SIGET, Bandit y Semgrep son SAST; pip-audit y npm audit son SCA.

**3. ¿Qué hace cada herramienta de seguridad del CI?**
Bandit busca fallos de seguridad en el código Python del backend. Semgrep revisa todo el código (backend, frontend e infraestructura) con reglas del OWASP Top 10. pip-audit y npm audit comparan las librerías de Python y de JavaScript con bases públicas de vulnerabilidades. Gitleaks busca claves y contraseñas olvidadas en todo el historial de Git. Si cualquiera encuentra algo, el flujo falla y el cambio no se fusiona.

**4. ¿Qué es Dependabot?**
Es un servicio de GitHub que vigila las librerías que usa el proyecto y, cuando sale una versión nueva o una corrección de seguridad, abre automáticamente una propuesta de cambio (un pull request). Nosotros lo configuramos cada semana para el backend y el frontend. La propuesta no se aplica sola: pasa por las pruebas, el análisis de seguridad y la revisión de una persona.

**5. ¿Qué es la inyección SQL y cómo se evita?**
Es cuando alguien escribe, en un campo de texto, instrucciones de base de datos y el sistema las ejecuta como si fueran suyas, pudiendo leer o borrar información. Se evita separando siempre la consulta de los datos: la consulta lleva marcadores (`%s`) y los valores se pasan aparte, así la base los trata solo como datos y nunca como órdenes. En SIGET lo hacemos así en `apps/identidad/equipo.py` y en `apps/nucleo/contexto.py`.

**6. ¿Por qué no usamos `assert` para validar?**
Porque Python puede ejecutarse en modo optimizado (`-O`), y en ese modo borra todos los `assert` sin avisar: la validación desaparecería justo en producción. Por eso validamos con una excepción explícita (`CommandError` o un error de la API) que siempre se ejecuta. Bandit lo detecta con la regla B101 y así lo corregimos en `sembrar_demo.py`.

**7. ¿Cómo se guardan los secretos?**
Nunca en el código ni en el repositorio. Se crean como `podman secret`, que el contenedor recibe como un archivo, y la aplicación lo lee con la función `_leer` de `settings.py`; si falta uno obligatorio, la aplicación ni arranca. Además, Gitleaks revisa todo el historial por si alguien sube una clave por error y, si ocurre, la clave se cambia de inmediato.

**8. ¿Cómo se guardan las contraseñas y por qué Argon2?**
No se guardan: se guarda una «huella» irreversible de la contraseña, calculada con Argon2, un algoritmo diseñado para ser lento y costoso de repetir. Así, aunque alguien robara la base de datos, adivinar las contraseñas le tomaría muchísimo tiempo. Además, exigimos contraseñas largas, que protegen más que las reglas de mayúsculas y símbolos.

**9. ¿Cuándo es válido usar `# nosec` o `nosemgrep`?**
Solo cuando la herramienta se equivoca (falso positivo), con el identificador exacto y el motivo escrito al lado, nunca para esconder un problema real. En SIGET tenemos 9 líneas con `# nosec B105` en `verificar_autenticacion.py`: son contraseñas inválidas a propósito, usadas para comprobar que el sistema las rechaza, y no protegen ninguna cuenta.

**10. ¿Por qué el mensaje de error del inicio de sesión no dice si el usuario existe?**
Porque si dijera «el usuario no existe» o «la contraseña es incorrecta», un atacante podría probar nombres hasta descubrir cuáles son reales. Por eso siempre respondemos lo mismo («credenciales inválidas») y además tardamos el mismo tiempo en ambos casos (`verificacion_falsa`), para que nadie pueda deducirlo midiendo la demora.
