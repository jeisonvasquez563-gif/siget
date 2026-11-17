# Autenticación — diseño

Especificación del módulo de autenticación del backend (módulo 18 de [`modulos.md`](../../modulos.md)). Concreta el principio 6 de Zero Trust ("la autenticación y la autorización son dinámicas y se exigen estrictamente antes de cada acceso") de la [matriz de cobertura](../../zero-trust-cobertura.md). Implementación en [`backend/apps/autenticacion/`](../../../backend/apps/autenticacion/); migración [`004-autenticacion.sql`](../../../database/migraciones/004-autenticacion.sql).

## 1. Qué se decidió y por qué

| Tema | Decisión | Motivo |
|---|---|---|
| Contraseñas | Argon2, mínimo 12 caracteres, máximo 128; se rechazan las comunes, las repeticiones de una palabra común y las secuencias de teclado o alfabeto; no puede contener el usuario | Prima la longitud sobre la composición (NIST SP 800-63B) |
| Sesión | JWT de acceso de **10 minutos** (HS256, algoritmo fijado) y token de refresco opaco de **8 horas, de un solo uso** | Una credencial robada sirve poco tiempo; el refresco rota |
| Dónde viaja el refresco | Cookie `HttpOnly`, `Secure`, `SameSite=Strict`, solo para la ruta `/auth/` | JavaScript no puede leerla; no sale a otras rutas ni a otros sitios |
| Token de refresco en la base | **Solo su hash** (SHA-256) | Un volcado de la base no entrega sesiones |
| Reuso de un refresco gastado | Se rechaza y **se revocan todas las sesiones** de la persona | Un token gastado que reaparece indica robo |
| Segundo factor | TOTP (RFC 6238), secreto **cifrado con Fernet** en la base; un código no sirve dos veces; ventana de ±1 paso | La base nunca ve el secreto en claro; evita la repetición |
| Reautenticación escalonada | `POST /auth/mfa/verificar/` renueva `mfa_verificado_en`, que el PDP exige de ≤15 minutos para acciones sensibles | El segundo factor "reciente" que pide la matriz |
| Bloqueo | 3 fallos bloquean la cuenta 5 minutos; también cuentan los códigos MFA erróneos (y cierran todas las sesiones) | Frena la fuerza bruta sobre 6 dígitos |
| Mensajes de error | **Siempre el mismo**, con tiempo parecido exista o no el usuario (verificación falsa) | No se enumeran usuarios |
| Revocación | La sesión y la cuenta se comprueban **en cada petición**, no solo al emitir el token | Cerrar sesión o suspender una cuenta surte efecto de inmediato |
| Registro de seguridad | Tabla `evento_seguridad` de solo inserción (permisos y trigger) | Principio 7: recopilar información para mejorar la política |

## 2. Alcance del token

| Scope | Para qué sirve | Cómo se obtiene |
|---|---|---|
| `enrolar_mfa` | Solo `/auth/mfa/enrolar/`, `/auth/mfa/confirmar/`, `/auth/yo/` y `/auth/logout/` | Al iniciar sesión cuando el segundo factor es obligatorio y aún no está activo |
| `completo` | Todo, incluido el PDP | Con el segundo factor activo (o no obligatorio) |

El PDP (`PermisoPDP`) rechaza cualquier token que no sea `completo`.

## 3. Cuándo es obligatorio el segundo factor

- **Siempre:** quien tiene un rol de plataforma (los cinco operadores y el auditor) y quien tiene una membresía de funcionario, supervisor o coordinador institucional.
- **Ciudadano:** según `SIGET_MFA_CIUDADANO_OBLIGATORIO` (por defecto sí, como dice el diseño). **La decisión final sigue pendiente de Jeison.**

## 4. Endpoints

| Ruta | Quién | Qué hace |
|---|---|---|
| `POST /auth/registro/` | Público | Crea una cuenta de ciudadano (10 por hora por origen) |
| `POST /auth/login/` | Público | Usuario, contraseña y, si el segundo factor está activo, `codigo`. Devuelve el token de acceso en el cuerpo y el refresco en la cookie (10 por minuto) |
| `POST /auth/refresh/` | Cookie | Rota el refresco; exige la cabecera `X-SIGET-CSRF: 1` |
| `POST /auth/logout/` | Con token | Revoca la sesión y borra la cookie |
| `GET /auth/yo/` | Con token | Datos de la persona autenticada y su estado de segundo factor |
| `POST /auth/mfa/enrolar/` | Con token | Genera el secreto y la URI para la app de autenticación; el secreto se muestra **una sola vez** |
| `POST /auth/mfa/confirmar/` | Con token | Activa el segundo factor con un primer código y devuelve un acceso `completo` |
| `POST /auth/mfa/verificar/` | Token `completo` | Reautenticación escalonada |

Solo se aceptan cuerpos JSON (otros tipos reciben 415).

## 5. Dos decisiones de implementación que importan

1. **Las vistas de autenticación no son atómicas** (`non_atomic_requests`): los contadores de intentos y los eventos de seguridad deben guardarse aunque la respuesta sea un 401. DRF, al lanzar una excepción de API, marca la transacción para revertirla; sin esta decisión se perdería justo el registro del intento fallido. Los fallos esperados se devuelven como resultado, no como excepción.
2. **Las decisiones del PDP se guardan por una conexión aparte** (`decisiones`, en autocommit): una decisión negada hace que DRF revierta la petición, y sin esto se perdería el registro más importante. Si no se puede registrar la decisión, se niega la acción: no hay acción permitida sin su evidencia.

## 6. Límites declarados

- **Sin recuperación de contraseña**: el laboratorio no tiene servidor de correo. Una cuenta con la contraseña perdida requiere la intervención de un operador de identidades (restablecer el segundo factor sí está en su matriz; el restablecimiento de contraseña queda por diseñar).
- **Límite de tasa de DRF por proceso**: usa la caché local de cada uno de los 3 procesos de `gunicorn`, así que el límite efectivo es mayor que el nominal. La protección principal es la de `nginx` (por origen, en el borde) y el bloqueo por cuenta, que vive en la base y sí es exacto.
- **Los tokens de acceso no se pueden revocar uno por uno**, pero cada petición comprueba su sesión en la base, que sí se revoca al instante.
- **Hay un solo servidor de claves** (`SIGET_JWT_KEY`): una rotación invalida todas las sesiones. La clave Fernet del segundo factor, si se rota, exige recifrar los secretos (no está implementado).
- **El primer rol de cada operador** aún no tiene un procedimiento de arranque que respete la separación de funciones.

## 7. Verificación

- **188 pruebas unitarias** (sin base de datos): tokens (vencimiento exacto, clave y emisor distintos, ataque de algoritmo `none`, algoritmo distinto, token alterado, basura, scope inventado, tolerancia de reloj), TOTP (ventana, repetición, formatos), bloqueo, contraseñas y el permiso del PDP.
- **`verificar_autenticacion`: 47 de 47 pasos** contra la base real, por HTTP, en una transacción que se revierte y con el reloj controlado: registro, contraseñas débiles, no enumeración, cookie con sus tres atributos, secreto TOTP cifrado, código repetido, rotación y reuso del refresco, cierre de sesión inmediato, vencimiento a los 10 minutos, bloqueo y desbloqueo, cuenta suspendida, límite de tasa, eventos de solo inserción y ausencia de secretos en los registros.
