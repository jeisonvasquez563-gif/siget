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
| `POST /auth/registro/` | `{username, password}` | `201`; `400 {codigo, errores[]}`; `409` |
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

## Trámites (`/tramites/`) — scope `completo`

| Método y ruta | Cuerpo / parámetros | Respuesta |
|---|---|---|
| `GET /tramites/` | `?limite=1..100&desplazamiento=` | `{resultados: [Tramite], limite, desplazamiento}` — solo los que la persona puede ver |
| `POST /tramites/` | `{tipo_tramite: <id>}` | `201 Tramite`. El solicitante siempre es quien llama |
| `GET /tramites/<id>/` | — | `Tramite` |
| `POST /tramites/<id>/estado/` | `{estado}` | `200 Tramite`; `403`/`409` |
| `POST /tramites/<id>/reasignar/` | `{funcionario_id: <id>\|null}` | `200 Tramite` (solo supervisión) |
| `GET /tramites/<id>/historial/` | — | `{tramite, eventos: [Evento]}` |

Estados: `Pendiente → En Tramitacion → (En Subsanacion ↔ En Tramitacion) → Aprobado \| Rechazado`. Los estados finales no admiten cambios.

**Tramite** — lo que se ve depende de quién mira:

```json
{ "id": 30, "tipo_tramite": {"id": 2, "nombre": "…"}, "institucion": {"id": 3, "nombre": "MOP"}, "estado": "Pendiente",
  "fecha_limite": "…", "vencido": false, "creado_en": "…",
  "asignado": false }                                              // ciudadanía
  // personal de la institución, en lugar de `asignado`:
  // "solicitante_id": 5, "funcionario_asignado_id": 9, "sensibilidad": 2
```

**Evento** — `{id, accion, estado_anterior, estado_nuevo, institucion_id, creado_en}`; el personal ve además `actor_id` y `atributos`.

## Catálogo y equipo

| Ruta | Respuesta |
|---|---|
| `GET /catalogo/instituciones/` | `[{id, nombre, tipo}]` |
| `GET /catalogo/tipos-tramite/?institucion=<id>` | `[{id, nombre, sla_dias, institucion: {id, nombre}}]` |
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
| `POST /politicas/simular/` | Cuerpo `{rol, accion, <variables>}` con valores de listas cerradas (`segundo_factor`: reciente\|vencido\|ninguno; `cuenta`: activa\|bloqueada\|suspendida; `institucion`: propia\|ajena; `solicitante`/`alta_propuesta_por`: otra_persona\|yo; `asignado`: nadie\|yo\|otra_persona; `estado` y `estado_destino`; `tipo_alta`; `nivel`: 1\|2\|3). Respuesta: `{ventana_minutos, entrada, decision: {permitido, politica, motivo}, traza: [{fase, regla, resultado, politica, motivo}], alternativas: [{variable, valor, etiqueta_variable, etiqueta_valor, permitido, politica}], hipotetico: true}`. Entrada inválida: `400 {codigo: "datos_invalidos", errores[]}` |

El simulador evalúa el **PDP real** con una situación hipotética: es puro (no toca la base) y **no registra decisiones** (no es una acción real). `alternativas` son los cambios de UNA sola variable que invertirían el resultado.

El `modulos` de `/auth/yo/` incluye siempre `seguridad`, `mfa` y `roles_permisos` (transparencia para todos los roles).

## Reglas para cambiar el contrato

1. **Agregar** campos o rutas es compatible: se documenta aquí.
2. **Quitar o cambiar** un campo, un estado o un código de error rompe al otro frente: se avisa y se acuerda antes, y el PR toca este archivo, `frontend/` y `backend/` a la vez.
3. El backend cubre cada ruta con pruebas (incluida la auditoría de rutas públicas); el frontend no inventa rutas que no estén aquí.
