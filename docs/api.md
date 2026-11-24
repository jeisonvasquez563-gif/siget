# Contrato de la API de SIGET

Es la **frontera entre backend y frontend**: el backend promete esto; el frontend lo consume y no depende de nada más. Cualquier cambio que rompa este documento se acuerda entre ambos frentes y se refleja aquí **en el mismo PR**.

- Base: `https://<vm1>:8443` (mismo origen que la interfaz: sin CORS). Todo viaja en JSON (`Content-Type: application/json`).
- Autenticación: `Authorization: Bearer <access_token>` (dura 10 minutos). El refresco va en la cookie `siget_refresh` (`HttpOnly; Secure; SameSite=Strict; Path=/auth/`) y se canjea con `POST /auth/refresh/` más la cabecera `X-SIGET-CSRF: 1`. El refresco es **de un solo uso**: pedirlo en paralelo revoca la sesión.
- Scopes del token: `completo` (todo) y `enrolar_mfa` (solo el alta del segundo factor, `/auth/yo/`, `/auth/logout/`).
- Todo lo que no esté aquí responde 404; todo lo privado sin token, 401.

## Errores (formato único)

```json
{ "codigo": "acceso_denegado", "detalle": "No tienes autorización para esta operación.", "reautenticacion_sugerida": true }
```

| HTTP | Significado | Qué hace la interfaz |
|---|---|---|
| 400 | Datos inválidos (`datos_invalidos`, `paginacion_invalida`, o `errores: [...]` en el registro) | Mostrar el mensaje junto al campo |
| 401 | Sin sesión o token vencido | Renovar una vez; si falla, ir al login |
| 403 | El PDP negó. Si `reautenticacion_sugerida` es `true`, falta un código reciente del segundo factor | Abrir el modal de reautenticación y repetir |
| 404 | No existe **o** no tienes acceso (no se distingue a propósito) | Mensaje neutro |
| 409 | Conflicto (transición rechazada, trámite cambió mientras tanto) | Recargar y avisar |
| 415 / 429 | Tipo no admitido / demasiadas peticiones | Esperar |

Los mensajes de autenticación son genéricos a propósito (`Credenciales inválidas o cuenta bloqueada temporalmente.`): nunca revelan si un usuario existe.

## Autenticación (`/auth/`)

| Método y ruta | Cuerpo | Respuesta |
|---|---|---|
| `GET /auth/configuracion/` | — (pública) | `{registro: "abierto"\|"invitacion"\|"cerrado", aviso_demostracion: bool}` |
| `POST /auth/registro/` | `{username, password, nombre, apellidos, cedula, fecha_nacimiento (AAAA-MM-DD), provincia, ciudad, correo, invitacion?}`; todos obligatorios, mayor de 18 años, provincia de las 13 de Panamá, cédula con formato panameño (p. ej. `8-123-456`). `invitacion` (`XXXX-XXXX-XXXX`) solo cuando el registro es por invitación | `201`; `400 {codigo, errores[]}` (dice qué campo falla); `400 invitacion_invalida` (código malo, usado o vencido: misma respuesta); `403 registro_cerrado`; `409` genérico si el usuario, la cédula o el correo ya existen (no revela cuál) |

| `POST /auth/registro/` | `{username, password, nombre, apellidos, cedula, fecha_nacimiento (AAAA-MM-DD), provincia, ciudad, correo, acepta_aviso}`; todos obligatorios, mayor de 18 años, provincia de las 13 de Panamá, cédula con formato panameño (p. ej. `8-123-456`). **`acepta_aviso` debe ser exactamente `true`** (confirma que leyó el aviso de privacidad; si falta o es otra cosa, `400` con el mensaje «debes leer el aviso de privacidad…»). Se guardan `aviso_version` y `aviso_leido_en` en el perfil, en la misma transacción | `201`; `400 {codigo, errores[]}` (dice qué campo falla); `409` genérico si el usuario, la cédula o el correo ya existen (no revela cuál) |
| `GET /auth/aviso-privacidad/` | — (público) | `200` con `{version, vigente_desde, titulo, base_legal, plazo_respuesta_dias_habiles, secciones[{titulo, texto}], datos[{dato, para_que}], derechos[], texto}`: responsable, finalidad de cada dato, quién accede, cuánto tiempo, derechos ARCO y cómo ejercerlos. La interfaz lo muestra en `#/privacidad` |
| `POST /auth/login/` | `{username, password, codigo?}` (`codigo` = 6 dígitos TOTP) | `200 {access_token, tipo, expira_en, scope, mfa_enrolamiento_requerido?}` + cookie; `401 {codigo: "mfa_requerido"\|"credenciales_invalidas"}` |
| `POST /auth/refresh/` | — (cookie + `X-SIGET-CSRF: 1`) | igual que el login |
| `POST /auth/logout/` | `{}` | `200` y borra la cookie |
| `GET /auth/yo/` | — | ver abajo |
| `GET /auth/actividad/` | — | `{eventos: [{id, evento, creado_en, ip}]}`: los últimos 25 eventos de seguridad de la propia cuenta |
| `POST /auth/mfa/enrolar/` | `{}` | `201 {secreto, uri}`; el secreto se muestra **una sola vez** (la `uri` se dibuja como QR) |
| `POST /auth/mfa/confirmar/` | `{codigo}` | `200` con tokens de scope `completo` |
| `POST /auth/mfa/verificar/` | `{codigo}` | `200`; renueva la vigencia del segundo factor (15 min) |

`GET /auth/yo/`:

```json
{
  "id": 12, "usuario": "fabio.mop", "scope": "completo", "rol_plataforma": "ninguno",
  "membresias": [{ "institucion_id": 3, "institucion": "MOP", "rol": "funcionario" }],
  "modulos": [{ "id": "bandeja", "nombre": "Bandeja de la institución", "descripcion": "…", "estado": "disponible" }],
  "mfa_activo": true, "mfa_ventana_minutos": 15, "inactividad_minutos": 10, "mfa_obligatorio": true, "mfa_verificado_en": "2026-10-21T18:00:00Z", "nivel_aseguramiento": 2
}
```

`inactividad_minutos` es el tiempo sin actividad tras el cual la interfaz cierra la sesión (avisa 60 s antes); el servidor además rechaza renovar un refresco con más de 15 min (`SIGET_REFRESH_MAX_EDAD_SEGUNDOS`) y ninguna sesión supera las 8 h aunque se renueve (cada renovación hereda el vencimiento). `mfa_ventana_minutos` es la duración de un segundo factor «reciente» (la configuración real del servidor): la interfaz **nunca** lo escribe a mano. `modulos` es **solo ayuda para armar el menú** (`estado`: `disponible` o `proximamente`). La interfaz nunca decide qué se puede hacer: el servidor vuelve a autorizar cada petición.

## Derechos sobre los datos personales (`/auth/mis-datos/…`) — scope `completo` (PT-15, Ley 81 de 2019)

Cada ruta consulta al PDP al inicio (la decisión queda registrada): las acciones `ver_mis_datos`, `exportar_mis_datos`, `crear_solicitud_datos` y `corregir_mis_datos` valen solo para quien no tiene rol de plataforma y sobre su propio perfil (26 acciones en total en la matriz, con `responder_subsanacion`). Todo es sobre la **propia** cuenta: ninguna ruta recibe el identificador de otra persona (cualquier `usuario_id` en un cuerpo se rechaza o se ignora). Las respuestas con datos personales llevan `Cache-Control: no-store`. Cancelar **no borra nada automáticamente**: los trámites son expediente público con conservación obligatoria; la respuesta del operador explica qué se puede borrar y qué no.

| Método y ruta | Cuerpo | Respuesta |
|---|---|---|
| `GET /auth/mis-datos/` | — | `{cuenta, perfil, campos_editables, tramites: {total}, aviso_aceptado, aviso_vigente, solicitudes[], solicitudes_abiertas_maximo, plazo_respuesta_dias_habiles}`. `perfil` es `{nombre, apellidos, cedula, fecha_nacimiento, provincia, ciudad, correo, creado_en, actualizado_en}` con la **cédula enmascarada**: solo quedan visibles los últimos 3 caracteres y se respetan los guiones (`8-123-456` → `*-***-456`); la cédula completa solo sale en la exportación. Consulta al PDP (acción `ver_mis_datos`, sin segundo factor; `403` para cuentas de plataforma). El perfil es `null` en cuentas sin perfil (p. ej. de plataforma). `aviso_aceptado` es `{version, leido_en, vigente}` o `null` en perfiles anteriores al aviso |
| `PATCH /auth/mis-datos/` | `{correo?, provincia?, ciudad?}` (al menos uno; **los mismos validadores del registro**) | `200 {codigo, campos_cambiados[], perfil}` (si no cambió nada, `campos_cambiados: []`); `400 {codigo: "datos_invalidos", errores[]}` (también si se manda `nombre`, `apellidos`, `cedula` o `fecha_nacimiento`: esos van por una solicitud de rectificación); `403` con `reautenticacion_sugerida` si falta **segundo factor reciente** (acción `corregir_mis_datos` del PDP); `429` pasadas **10 correcciones por hora** por persona (límite propio, para que el `409` de correo repetido no sirva de oráculo); la `perfil` de la respuesta también lleva la cédula enmascarada; `409 {codigo: "usuario_existente"}` si el correo ya es de otra cuenta (mismo código y estado que el registro: no revela de quién); `404 sin_perfil` |
| `GET /auth/mis-datos/exportar/` | — | **Exige segundo factor reciente** (acción `exportar_mis_datos` del PDP; `403` con `reautenticacion_sugerida` si falta). Portabilidad: JSON descargable (`Content-Disposition: attachment; filename="siget-mis-datos-<usuario>-<fecha>.json"`, `no-store`) con `{formato, generado_en, aviso_privacidad, cuenta, perfil, tramites[{…Tramite, historial[]}], solicitudes[], actividad_de_seguridad[{evento, creado_en, ip}]}`. Los trámites son los que la persona ya ve por `/tramites/` (los propios). Límite de tasa: 20 por hora |
| `GET /auth/mis-datos/solicitudes/` | — | `{solicitudes[], plazo_respuesta_dias_habiles, abiertas_maximo}` (acción `ver_mis_datos` del PDP) |
| `POST /auth/mis-datos/solicitudes/` | `{tipo: rectificacion\|cancelacion\|oposicion, detalle (10 a 1000 caracteres)}` | `201 Solicitud`; `400 datos_invalidos`; `409 {codigo: "demasiadas_abiertas"}` (máximo 3 abiertas por persona); consulta al PDP con la acción `crear_solicitud_datos` (sin segundo factor). La base fuerza que nazca `recibida`, sin respuesta y con `vence_en` entre 10 y 30 días |

`Solicitud`: `{id, tipo, detalle, estado: recibida\|atendida\|rechazada, creada_en, vence_en, vencida, respondida_en, respuesta}`. `vence_en` es **10 días hábiles** después de recibirla (lunes a viernes; hasta integrar el calendario de feriados de PT-3 no se excluyen feriados). Cada acción deja un evento de seguridad (`datos_personales_corregidos` con los **nombres** de los campos y nunca los valores, `datos_personales_exportados`, `solicitud_derecho_creada` sin el detalle).

### Consola de solicitudes (operador de identidades)

Solo el operador de identidades, con segundo factor reciente (acciones `consultar_solicitudes_datos` y `responder_solicitud_datos` del PDP). Nunca devuelve datos de trámites ni nombre, cédula o correo: la persona es su `id` y su `usuario`.

| Ruta | Qué hace |
|---|---|
| `GET /plataforma/solicitudes-datos/?estado=recibida\|atendida\|rechazada` | `{solicitudes[], resumen: {recibidas, vencidas}}`. Cada una: `{id, tipo, detalle, estado, creada_en, vence_en, vencida, respondida_en, respuesta, persona: {id, usuario}, respondida_por: {id, usuario}\|null}`. Las abiertas primero, las que vencen antes arriba. `400` si el estado no existe |
| `POST /plataforma/solicitudes-datos/<id>/responder/` `{estado: atendida\|rechazada, respuesta (10 a 2000 caracteres)}` | `200`; `400 datos_invalidos`; `409 ya_resuelta` (una solicitud se responde una sola vez, la base lo impone); `409 no_a_si_mismo`. No borra ni modifica datos de la persona: solo registra la respuesta (evento `solicitud_derecho_respondida`, sin el texto) |

## Trámites (`/tramites/`) — scope `completo`

| Método y ruta | Cuerpo / parámetros | Respuesta |
|---|---|---|
| `GET /tramites/` | `?limite=1..100&desplazamiento=&escalados=1` | `{resultados: [Tramite], limite, desplazamiento}` — solo los que la persona puede ver; `escalados=1` deja solo los escalados (otro valor: `400 filtro_invalido`) |
| `POST /tramites/` | `{tipo_tramite: <id>, datos: {…}}` | `201 Tramite` (con `datos` y `formulario`). El solicitante siempre es quien llama. `datos` se valida contra el `formulario` del tipo (ver abajo): `400 {codigo: "datos_invalidos", detalle, errores: {<id_del_campo>: <mensaje>}}`; los errores que no son de un campo concreto van bajo la clave `datos`. Si el tipo no tiene campos obligatorios, `datos` puede omitirse. La consulta al PDP va antes de validar. Si el contenido supera lo que admite la base (el CHECK de 16 KB, que Python anticipa con un tope de 15 000 bytes), responde `400 datos_invalidos` con `errores.datos`, no 500. Si el formulario del tipo está mal definido (problema del catálogo, no de quien envía): `503 {codigo: "formulario_no_disponible"}`, sin repetir la definición ni lo recibido, y queda un evento de seguridad `formulario_no_disponible` con solo el id del tipo |
| `GET /tramites/<id>/` | — | `Tramite` con `datos` y `formulario` (se ve igual para quien lo pidió y para el personal de la institución). El listado `GET /tramites/` **no** lleva `datos` ni `formulario` |
| `POST /tramites/<id>/estado/` | `{estado, motivo?}` | `200 Tramite`; `403` (el PDP decide **antes** de mirar el motivo: quien no puede cambiar el estado recibe 403 aunque falte o sobre el motivo, nunca 400); `400` (`motivo_obligatorio` o `datos_invalidos` con `errores.motivo`); `409`. **`motivo` es obligatorio** (texto de 10 a 2000 caracteres, con al menos una letra o un número; el mínimo no cuenta los invisibles) al pasar a `Rechazado`, al pasar a `En Subsanacion` y al cerrar una subsanación (`En Subsanacion` → `En Tramitacion`); en las demás transiciones es opcional (si viene, también se valida). La base lo exige de nuevo y lo guarda en el historial |
| `POST /tramites/<id>/subsanacion/` | `{respuesta, datos?}` | La persona que pidió el trámite responde la subsanación: `200 Tramite` (vuelve a `En Tramitacion`; `respuesta` queda como `motivo` del evento). `respuesta`: texto de 10 a 2000 caracteres con al menos una letra o un número, obligatorio (`400 datos_invalidos`, `errores.respuesta`). `datos` es opcional: si viene, se valida completo contra el formulario y **reemplaza** al contenido anterior (`400` con `errores` por campo); si no viene, no se toca. `404` si el trámite no es de quien llama (como el resto de las rutas); `403` para el personal, la supervisión y las cuentas de plataforma sobre trámites que no pidieron (quien es personal y pidió su propio trámite sí responde, solo como solicitante); `503 formulario_no_disponible` si manda `datos` y el formulario está mal definido; `409 no_en_subsanacion` si el trámite no está en subsanación; `409 conflicto` si cambió mientras se procesaba (concurrencia optimista). Acción `responder_subsanacion` del PDP: solo el solicitante, **sin exigir segundo factor reciente** (igual que adjuntar documentos) |
| `POST /tramites/<id>/reasignar/` | `{funcionario_id: <id>\|null}` | `200 Tramite` (solo supervisión) |
| `GET /tramites/<id>/historial/` | — | `{tramite, eventos: [Evento]}` |
| `GET /tramites/<id>/documentos/` | — | `{tramite, documentos: [{id, nombre, tipo, tamano, creado_en}]}`; el personal ve además `subido_por` y `sha256` |
| `POST /tramites/<id>/documentos/` | **multipart** con un solo campo `archivo` (la única ruta que no es JSON) | `201 Documento`. Solo quien pidió el trámite y mientras no tenga resolución final. `413 demasiado_grande` (más de 5 MB), `415` (`extension_no_permitida`, `contenido_no_permitido`, `extension_no_coincide`), `409 tramite_cerrado`, `409 demasiados_documentos` (20), `503 documentos_no_disponibles` (sin clave configurada) |
| `GET /tramites/<id>/documentos/<doc>/` | — | El archivo, con `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff` y `Cache-Control: no-store`. Si el archivo no supera la verificación de integridad: `500 documento_no_disponible` y un evento de seguridad `documento_alterado` |

Estados: `Pendiente → En Tramitacion → (En Subsanacion ↔ En Tramitacion) → Aprobado \| Rechazado`. Los estados finales no admiten cambios.

**Contenido del trámite (migración 017).** Cada tipo de trámite trae su `formulario` (en `GET /catalogo/tipos-tramite/` y en el detalle del trámite): una lista de campos `{id, etiqueta, tipo, obligatorio, max?, opciones?, ayuda?, entero?}`.

| `tipo` | Qué acepta | Notas |
|---|---|---|
| `texto` | Texto de una línea de hasta `max` caracteres | Se quitan los espacios de los bordes; no admite saltos de línea ni caracteres de control |
| `texto_largo` | Texto de hasta `max` caracteres | Admite saltos de línea; sin caracteres de control |
| `numero` | Número JSON (no booleano, no texto) de 0 a `max` | Con `entero: true` rechaza decimales |
| `fecha` | Texto `AAAA-MM-DD` | Fecha real, desde 1900 y **no futura** (hora de Panamá) |
| `seleccion` | Exactamente una de `opciones` | |

Un campo de texto **obligatorio** (y el `motivo` y la `respuesta`) debe tener al menos una letra o un número (categorías Unicode L y N): un texto de solo espacios, signos o caracteres invisibles (U+200C, U+200D) no vale. En `motivo` y `respuesta` el mínimo de largo se cuenta sin los invisibles. La base lo exige de nuevo para el `motivo` (`[[:alnum:]]`, y sin caracteres de control salvo salto de línea y tabulación).

Un campo `obligatorio` ausente, nulo o en blanco se rechaza; uno opcional vacío no se guarda. Un campo que el formulario no tiene se rechaza (`errores.datos`, sin repetir lo recibido). Los textos se normalizan (NFC). Tope de contenido: 15 000 bytes de JSON en Python, con margen bajo el CHECK de 16 KB de la base. `datos` solo se escribe al crear y al responder una subsanación; ningún formulario pide cédula, nombre ni correo (minimización de datos, Ley 81). Los trámites anteriores a la migración tienen `datos: {}`.

Los `Tramite` de detalle incluyen además `"datos": {…}` y `"formulario": […]`. La exportación de «Mis datos» también los lleva.

**Tramite** — lo que se ve depende de quién mira:

```json
{ "id": 30, "tipo_tramite": {"id": 2, "nombre": "…"}, "institucion": {"id": 3, "nombre": "MOP"}, "estado": "Pendiente",
  "fecha_limite": "…", "vencido": false, "escalado": false, "creado_en": "…",
  "asignado": false }                                              // ciudadanía
  // personal de la institución, en lugar de `asignado`:
  // "solicitante_id": 5, "funcionario_asignado_id": 9, "sensibilidad": 2, "escalado_en": "…" | null
```

**Plazos (migración 013):** `fecha_limite` se calcula en **días hábiles de Panamá** (lunes a viernes, sin los feriados de la tabla `siget.feriado`), a la misma hora del inicio. Los trámites anteriores conservan su plazo en días calendario. `escalado` es `true` cuando el temporizador de escalamiento detectó el plazo vencido sin resolución; desde ahí lo atiende la supervisión. Ver [`feriados-panama.md`](./feriados-panama.md).

**Evento** — `{id, accion, estado_anterior, estado_nuevo, institucion_id, creado_en, motivo}`; el personal ve además `actor_id` y `atributos`. `motivo` (texto o `null`): el personal ve el de todos los eventos; la ciudadanía **solo** el de los eventos `cambio_estado` hacia `Rechazado`, hacia `En Subsanacion` y de `En Subsanacion` a `En Tramitacion` (el cierre por el personal o su propia respuesta). En los demás cambios de estado el motivo es un comentario interno y le llega `null`. Del resto de `atributos` no ve nada. En los eventos de personal `atributos` puede traer `{motivo}` y `{datos_actualizados: true}` (la respuesta cambió el contenido). Acciones: `creacion`, `cambio_estado`, `reasignacion` y `escalamiento` (lo escribe el sistema: `actor_id` nulo, `atributos: {regla: "plazo_vencido", fecha_limite}`).

## Catálogo y equipo

| Ruta | Respuesta |
|---|---|
| `GET /catalogo/instituciones/` | `[{id, nombre, tipo}]` |
| `GET /catalogo/tipos-tramite/?institucion=<id>` | `[{id, nombre, sla_dias, audiencia, formulario: [Campo], institucion: {id, nombre}}]` (`audiencia`: `ciudadania`, `institucion` o `ambas`; quién puede iniciarlo) |
| `GET /equipo/` | `{equipos: [{institucion: {id, nombre}, personal: [{usuario_id, usuario, rol}]}]}` — coordinación y supervisión de esa institución |

## Auditoría (`/auditoria/`) — solo rol `auditor`, nivel 3 y segundo factor reciente

Todas son de lectura y paginadas: `{total, limite, desplazamiento, resultados[]}`, de la más reciente a la más antigua.

| Ruta | Filtros | Cada fila |
|---|---|---|
| `GET /auditoria/resumen/` | — | `{decisiones: {total, permitidas, negadas, ultimas_24h, negadas_24h}, por_politica[], denegaciones_por_persona[], seguridad[], tramites[]}` |
| `GET /auditoria/decisiones/` | `resultado=permitidas\|negadas`, `politica`, `accion`, `actor` | `{id, creado_en, actor, accion, recurso, permitido, politica, motivo, institucion_id}` |
| `GET /auditoria/seguridad/` | `evento`, `actor` | `{id, creado_en, evento, ip, actor, detalle}` |
| `GET /auditoria/tramites/` | `accion`, `actor` | `{id, creado_en, tramite_id, institucion_id, accion, estado_anterior, estado_nuevo, actor}` |

## Transparencia: roles, permisos y base de datos (`/politicas/`) — cualquier persona autenticada

Información de las reglas, no datos de nadie. Se calcula en el momento: no está escrita a mano.

| Ruta | Respuesta |
|---|---|
| `GET /politicas/matriz/` | La matriz de roles y permisos, **generada evaluando el PDP real**: `{ventana_minutos, roles: [{id, nombre, ambito, descripcion, modulos[], acciones_permitidas, acciones_totales}], acciones: [{id, nombre, grupo, casos}], matriz: {<rol>: {<accion>: {favorable: {permitido, politica}, desfavorable: {permitido, politica}, exige_segundo_factor}}}, denegaciones: [{politica, descripcion}], ningun_rol_puede_todo}` |
| `GET /politicas/base-de-datos/` | Los privilegios REALES de cada rol de PostgreSQL (`has_table_privilege`): `{roles: [{nombre, descripcion, superusuario, omite_rls, puede_conectar, limite_conexiones, ...}], tablas: [{nombre, rls, politicas, triggers}], privilegios: {<rol>: {<tabla>: {SELECT, INSERT, UPDATE, DELETE}}}, administrador_del_motor, ningun_rol_de_aplicacion_es_superusuario}`; cada privilegio es `total`, `columnas` (solo algunas columnas) o `no` |

| `GET /politicas/simular/` | El formulario del simulador: `{variables: {<accion>: [variables que importan]}, etiquetas, valores: {<variable>: [{valor, etiqueta}]}, defectos}` |
| `POST /politicas/simular/` | Cuerpo `{rol, accion, <variables>}` con valores de listas cerradas (`segundo_factor`: reciente\|vencido\|ninguno; `cuenta`: activa\|bloqueada\|suspendida; `institucion`: propia\|ajena; `solicitante`/`alta_propuesta_por`: otra_persona\|yo; `asignado`: nadie\|yo\|otra_persona; `estado` y `estado_destino`; `tipo_alta`; `nivel`: 1\|2\|3; `perfil_de`: yo\|otra_persona, solo para `corregir_mis_datos`). Respuesta: `{ventana_minutos, entrada, decision: {permitido, politica, motivo}, traza: [{fase, regla, resultado, politica, motivo}], alternativas: [{variable, valor, etiqueta_variable, etiqueta_valor, permitido, politica}], hipotetico: true}`. Entrada inválida: `400 {codigo: "datos_invalidos", errores[]}` |

El simulador evalúa el **PDP real** con una situación hipotética: es puro (no toca la base) y **no registra decisiones** (no es una acción real). `alternativas` son los cambios de UNA sola variable que invertirían el resultado.

El `modulos` de `/auth/yo/` incluye siempre `seguridad`, `mfa` y `roles_permisos` (transparencia para todos los roles).

## Reglas para cambiar el contrato

1. **Agregar** campos o rutas es compatible: se documenta aquí.
2. **Quitar o cambiar** un campo, un estado o un código de error rompe al otro frente: se avisa y se acuerda antes, y el PR toca este archivo, `frontend/` y `backend/` a la vez.
3. El backend cubre cada ruta con pruebas (incluida la auditoría de rutas públicas); el frontend no inventa rutas que no estén aquí.

### Gestión del equipo (`/equipo/…`)

`GET /equipo/` ahora indica por institución `puede_gestionar` y, por persona, `gestionable`. Las acciones exigen la **coordinación de esa institución** con segundo factor reciente (si no, `403`).

| Ruta | Cuerpo | Respuestas |
|---|---|---|
| `POST /equipo/<institucion>/miembros/` | `{usuario, rol}` (`funcionario` o `supervisor`) | `201`; `400 {errores[]}` (no existe, plataforma, cuenta inactiva, ya lo es); `409 no_a_si_mismo` |
| `POST /equipo/<institucion>/miembros/<persona>/cambiar-rol/` | `{rol}` | `200`; `409 no_corresponde` |
| `POST /equipo/<institucion>/miembros/<persona>/quitar/` | — | `200`; `409 tiene_tramites_abiertos {tramites_abiertos}` (supervisión debe reasignarlos antes); `409 no_corresponde` |

Quitar **revoca** la membresía (no se borra): queda quién la dio y quién la quitó.

### Puertas de entrada

`POST /auth/login/` acepta además `canal` (`ciudadania`, `institucion` o `plataforma`) e `institucion_id` (entero, solo con `institucion`). Se comprueba tras validar contraseña y segundo factor: si la cuenta no corresponde a esa puerta responde `401 {codigo: "canal_incorrecto", acceso_correcto, instituciones[]}` y no abre sesión (no cuenta como intento fallido). Una puerta inexistente responde como credenciales inválidas. Sin `canal` el comportamiento no cambia. `GET /auth/instituciones/` (pública) devuelve `[{id, nombre}]` para la puerta del personal.

### Recuperación de contraseña (pública)

| Ruta | Cuerpo | Respuestas |
|---|---|---|
| `POST /auth/restablecer/` | `{username, codigo, password}` (el código lo emitió el operador de identidades) | `200`; `400 {codigo: "codigo_invalido"}` (**idéntico** si el código es incorrecto, ya se usó, venció o el usuario no existe); `400 {codigo: "datos_invalidos", errores[]}` si la contraseña no cumple la política (el código no se gasta) |

Un código vale una vez y 15 minutos; al usarlo se cierran todas las sesiones de la persona y el segundo factor sigue siendo obligatorio. Límite de tasa: 10 por hora.

## Consolas de plataforma (`/plataforma/…`)

Todas exigen acceso completo y que el rol de plataforma correspondiente tenga el segundo factor reciente (si no, `403` con `reautenticacion_sugerida`). Ninguna devuelve trámites ni datos personales. Se aplican el PDP y, debajo, la base de datos.

| Ruta | Quién | Qué hace |
|---|---|---|
| `GET /plataforma/personas/?q=` | identidades, seguridad | Cuentas: `id`, `usuario`, `estado_cuenta`, `rol_plataforma`, `mfa_activo`, `sesiones_activas`, `bloqueada_hasta` |
| `POST /plataforma/personas/<id>/restablecer-contrasena/` | identidades | `201 {codigo_restablecimiento, vence_en}`: el código en claro **solo en esta respuesta** (`Cache-Control: no-store`) |
| `POST /plataforma/personas/<id>/restablecer-mfa/` | identidades | Desactiva el segundo factor y cierra sus sesiones |
| `GET/POST /plataforma/invitaciones/` `{nota?}` | identidades | Lista (`modo_registro`, `invitaciones: [{id, nota, emitida_por, creado_en, vence_en, usada, estado}]`, nunca el código) y emite: `201 {id, codigo_invitacion, vence_en}`, el código **solo en esta respuesta** (`Cache-Control: no-store`) |
| `POST /plataforma/personas/<id>/bloquear/` `{motivo}` · `…/desbloquear/` · `…/revocar-sesiones/` | seguridad | Bloqueo de cuenta (motivo de 5 a 200 caracteres) y cierre de sesiones |
| `GET /plataforma/eventos/` | seguridad | Últimos eventos de seguridad |
| `GET/POST /plataforma/aprobaciones/` | identidades (altas de coordinadora), catálogo (altas de institución) | Lista y propone. El tipo sale del rol, nunca del cliente |
| `POST /plataforma/aprobaciones/<id>/resolver/` `{decision: aprobar\|rechazar}` | el mismo rol, **otra persona** | Aprueba (y aplica el efecto) o rechaza. Quien propuso recibe `403` |
| `GET/POST /plataforma/secretos/` | custodio de secretos | Estado de los 8 secretos y registro de una rotación (`{secreto, nota}`); nunca valores |
| `GET /plataforma/infraestructura/` | infraestructura | Salud de la base (respuesta, TLS, tamaño), del proceso y vencimiento del certificado |

Errores propios: `409 no_a_si_mismo` (nadie actúa sobre su cuenta), `409 conflicto_de_funciones` (quien emitió el código de contraseña de una cuenta no restablece además su segundo factor en 24 horas, ni al revés), `409 ya_resuelta`, `409 no_corresponde`, `400 datos_invalidos {errores[]}`.
