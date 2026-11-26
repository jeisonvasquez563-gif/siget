# Motor de control de acceso ABAC (PDP) — diseño

Especificación del punto de decisión de acceso de SIGET. Concreta la sección 3 y la matriz de la sección 5 del [diseño Zero Trust](./2026-10-08-arquitectura-zero-trust-design.md), que ya estaban aprobadas. Implementación: [`backend/apps/autorizacion/pdp.py`](../../../backend/apps/autorizacion/pdp.py), con 84 pruebas en `backend/tests/`.

## 1. Qué hace y qué no

El PDP responde una pregunta: **¿puede este sujeto hacer esta acción sobre este recurso, ahora?** Responde con una decisión (permitida o negada) y la política que la motivó. No consulta la base de datos, no emite sesiones y no ejecuta la acción: es una función pura. Eso lo hace fácil de probar y de razonar.

## 2. Atributos

| Entrada | Atributos |
|---|---|
| Sujeto | `id`, `estado_cuenta`, `nivel_aseguramiento` (1 a 3), `mfa_verificado_en`, `rol_plataforma`, `membresias` (conjunto de institución y rol) |
| Recurso | `tipo`, `institucion_id`, `solicitante_id`, `funcionario_asignado_id`, `estado`, `estado_destino`, `propuesto_por` |
| Entorno | `ahora`, `mfa_reciente_minutos` (15), `mfa_ciudadano_obligatorio` |
| Acción | 18 acciones: ver, crear, cambiar estado, reasignar, escalar, adjuntar y ver documentos, gestionar usuarios y catálogo de la institución, proponer y aprobar altas, administrar infraestructura, restablecer MFA, bloquear cuenta, revocar sesión, rotar secretos, consultar auditoría y decisiones |

## 3. Orden de evaluación

1. **Denegaciones** (anulan todo lo demás): cuenta no activa, roles de plataforma sobre trámites o documentos, conflicto de interés y control dual.
2. **Permisos:** alguna regla debe permitir explícitamente.
3. **Si ninguna permite, se niega** (`sin_regla_que_permita`).
4. **Si algo falla, se niega** (`fallo_del_pdp`, *fail closed*) y se registra el error.

## 4. Reglas

| Rol | Permitido | Condiciones |
|---|---|---|
| Ciudadano | Crear trámite; ver y adjuntar documentos propios | Solo lo propio; MFA activado si el diseño lo exige |
| Funcionario | Ver trámites y documentos de su institución; cambiar estado | Misma institución; trámite asignado a él o en cola; MFA ≤15 min; transición válida |
| Supervisor | Lo del funcionario sin importar la asignación; reasignar; atender escalados | Misma institución; MFA ≤15 min |
| Coordinador institucional | Gestionar usuarios y catálogo de su institución | Misma institución; MFA ≤15 min; no ve trámites ni documentos |
| Operador de infraestructura | Administrar infraestructura | MFA ≤15 min |
| Operador de identidades | Proponer y aprobar altas de coordinadores; restablecer MFA | MFA ≤15 min; solo el alta de coordinadores |
| Operador de catálogo | Proponer y aprobar altas de instituciones | MFA ≤15 min; solo el alta de instituciones |
| Operador de seguridad | Bloquear cuentas; revocar sesiones | MFA ≤15 min |
| Custodio de secretos | Rotar secretos | MFA ≤15 min |
| Auditor | Consultar auditoría y decisiones | Nivel de aseguramiento 3; MFA ≤15 min |

**Denegaciones transversales:** cuenta bloqueada o suspendida; ningún rol de plataforma accede a trámites ni a documentos; nadie gestiona como funcionario un trámite que él mismo creó; quien propone un alta no la aprueba.

## 5. Integración con el resto del sistema

- **Capa web (DRF):** toda vista nace denegada (`DenegarPorDefecto`). Cada vista construye `Sujeto`, `Recurso` y `Entorno`, llama a `decidir` y registra la decisión.
- **Base de datos:** cuando el PDP permite, la aplicación fija `app.usuario_id` y `app.instituciones` en la transacción (`SET LOCAL`) y las políticas RLS filtran las filas. Es la segunda barrera, independiente del PDP.
- **Transiciones de estado:** el PDP conoce una copia de las transiciones válidas para dar una respuesta rápida; la autoridad es la tabla `siget.transicion` y su trigger.
- **Registro:** cada decisión, permitida o negada, se guardará en `siget.decision_pdp` (tabla de solo inserción).

## 6. Decisiones y supuestos

| Tema | Decisión | Motivo |
|---|---|---|
| MFA del ciudadano | Obligatorio por defecto; se puede relajar con `SIGET_MFA_CIUDADANO_OBLIGATORIO=false` | El diseño lo exige; la decisión final sigue pendiente de Jeison |
| El rol de ciudadano | No es un rol de membresía: lo es toda persona sin rol de plataforma, sobre sus propios trámites | RLS ya limita al solicitante a lo suyo |
| Funcionarios sin trámites asignados | Se tratan como "en cola" de su institución | Coincide con la matriz |
| Un rol de plataforma por persona | La base lo impone; el PDP además deniega a los operadores todo acceso a trámites | Separación de funciones |

## 7. Límites

- El PDP no verifica el segundo factor: confía en `mfa_verificado_en`, que fija el módulo de autenticación.
- No evalúa atributos de red u horarios todavía; el `Entorno` está preparado para sumarlos.
- Migrar a un motor externo (OPA) queda como fase futura: la interfaz `decidir(sujeto, accion, recurso, entorno)` no cambia.

## 8. Pruebas

84 pruebas en `backend/tests/`: un caso permitido y uno denegado por cada fila de la matriz, los límites de tiempo del segundo factor, las transiciones inválidas, el control dual, la denegación por defecto y el cierre ante fallos. Se comprobó con **mutaciones**: se rompieron deliberadamente 6 reglas y las pruebas detectaron las 6.
