# Migraciones de la base de datos

Cambios incrementales sobre el esquema `siget` que ya está aplicado. Se ejecutan **en orden**, dentro de una transacción (`BEGIN; … COMMIT;`), por el superusuario del contenedor por el socket local (`database/psql-contenedor.sh`); cada archivo asume el rol `siget_owner` con `SET LOCAL ROLE`. **Antes de aplicar una migración se hace un respaldo** (`pg_dump -Fc`) y, si es posible, un ensayo con `ROLLBACK`.

| # | Archivo | Qué hace | Aplicada |
|---|---|---|---|
| 002 | `002-dividir-rol-plataforma.sql` | Divide el rol de plataforma en cinco y agrega el control dual | 15-oct-2026 |
| 003 | `003-login-app-role.sql` | Permite el `LOGIN` de `app_role` y concede `CONNECT` a los cinco roles | 20-oct-2026 |
| 004 | `004-autenticacion.sql` | Segundo factor, bloqueo por intentos, sesiones y eventos de seguridad | 20-oct-2026 |
| 005 | `005-catalogo-inicial.sql` | Siembra 6 instituciones y 6 tipos de trámite con su plazo | 20-oct-2026 |
| 006 | `006-historial-solicitante.sql` | Política RLS: el solicitante ve el historial de sus trámites | 20-oct-2026 |
| 007 | `007-auditor-login.sql` | `auditor_role` puede conectarse (solo lectura) y ve solo `id`, `username` y rol de plataforma de las personas | 21-oct-2026 |
| 008 | `008-perfil-ciudadano.sql` | Tabla `perfil` con los datos personales del registro (cédula cifrada); solo `app_role` la lee e inserta | 22-oct-2026 |
| 009 | `009-pgadmin-minimo-privilegio.sql` | `pgadmin_lectura` deja de leer todo (`pg_read_all_data`): solo lo no sensible | 22-oct-2026 |
| 010 | `010-plataforma-y-restablecimiento.sql` | Consolas de plataforma, control dual, códigos de restablecimiento y registro de rotaciones | aplicada (comprobado 12-nov-2026) |
| 011 | `011-equipo-institucion.sql` | Revocación de membresías y `siget.tramites_abiertos_de()` | aplicada (comprobado 12-nov-2026) |
| 012 | `012-tramites-entre-instituciones.sql` | `tipo_tramite.audiencia` y el trigger `tramite_valida_inicio` | aplicada (comprobado 12-nov-2026) |
| 013 | `013-plazos-y-escalamiento.sql` | Tabla `feriado` (feriados de ley 2026–2027), `tramite.escalado_en`, función `siget.escalar_vencidos()` y rol `escalador_role` (solo `EXECUTE` sobre ella). Pruebas: [`../pruebas-escalamiento.sql`](../pruebas-escalamiento.sql) (10 de 10) | 12-nov-2026 |
| 014 | `014-invitaciones.sql` | Tabla `invitacion` (registro por invitación): solo el hash del código, vencimiento, un solo uso (trigger) y `app_role` solo marca el uso | 12-nov-2026 |
| 015 | `015-documentos.sql` | Tabla `documento` con seguridad por filas (la ve el solicitante o el personal de la institución; adjunta solo el solicitante), sin modificación ni borrado (trigger), institución igual a la del trámite y nada en trámites resueltos | 12-nov-2026 |

| 016 | `016-derechos-datos.sql` | Derechos sobre los datos personales (Ley 81): la persona corrige solo correo, provincia y ciudad (`UPDATE` por columna en `perfil`), constancia del aviso de privacidad y tabla `solicitud_derecho` (rectificación, cancelación y oposición, respuesta en 10 días hábiles) | 24-nov-2026 |
| 017 | `017-contenido-tramite.sql` | Contenido del trámite: `tipo_tramite.formulario` (definición de los datos que pide cada trámite, cargada para los 5 del catálogo) y `tramite.datos` (objeto de hasta 16 KB); motivo de 10 a 2000 caracteres obligatorio al rechazar, pedir subsanación o cerrarla (se fija con `siget.motivo` y queda en `evento_auditoria.atributos`); `datos` solo cambia cuando la persona solicitante responde una subsanación (política RLS y triggers propios) | 24-nov-2026 |
| 018 | `018-notificaciones.sql` | Notificaciones dentro de la plataforma: tabla `notificacion` (tipo de una lista cerrada, trámite y fechas; sin texto libre ni datos personales) que genera un disparador `AFTER UPDATE` sobre `tramite` (al solicitante, al funcionario asignado cuando el solicitante responde una subsanación y a la supervisión vigente cuando `escalar_vencidos()` escala; nunca al propio actor). Seguridad por filas: `app_role` ve y marca solo las suyas (`SELECT` y `UPDATE (leida_en)`, sin `INSERT` ni `DELETE`); `leida_en` solo pasa de nulo a la hora de la base. Pruebas: [`../pruebas-notificaciones.sql`](../pruebas-notificaciones.sql) | 24-nov-2026 |
| 019 | `019-alertas-seguridad.sql` | Alertas ante patrones sospechosos (PT-10, RS-24): tabla `alerta_seguridad` (solo contadores y nombres en el detalle; una alerta abierta por regla, persona e IP), función `siget.detectar_anomalias()` (`SECURITY DEFINER`; cuatro reglas: ráfaga de fallos de inicio de sesión por IP, denegaciones del PDP por persona, reúso del token de refresco y bloqueos repetidos) y rol `detector_role` (solo `EXECUTE` sobre ella). `app_role` ve y revisa (`UPDATE (estado, revisada_por, revisada_en, nota)`, una sola vez, con nota y por un operador de seguridad; sin `INSERT` ni `DELETE`); `auditor_role` solo lee. Pruebas: [`../pruebas-alertas.sql`](../pruebas-alertas.sql) | pendiente de aplicar |

## Para una base nueva

`database/diseno-roles-permisos.sql` ya incluye lo de la migración 002 (es el script de arranque consolidado). En una base nueva se ejecuta ese archivo y después **solo las migraciones 003 a 009** (y las posteriores que ya estén en `main`, como la 016, la 017, la 018 y la 019 cuando se liberen).

## Reglas

- La contraseña de `app_role` **nunca** va en una migración: se fija aparte y vive como `podman secret`.
- Una migración debe ser segura de leer: sin datos personales ni secretos.
- Al quitar un permiso a `PUBLIC`, conceder primero a los roles que lo usan y **verificar con un login real** (la migración 003 dejó el login del checkpoint sin base unos minutos por no hacerlo).
- Los números 013 a 015 existen en otras ramas: no se reutilizan. Si dos ramas toman el mismo número, la que se integra después se renumera.
