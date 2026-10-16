# Roles, permisos y módulos a nivel de base de datos

Material para mostrar al profesor. Resume qué roles, permisos y módulos define SIGET en PostgreSQL y qué parte está comprobada. El detalle vive en [`database/diseno-roles-permisos.sql`](../database/diseno-roles-permisos.sql) y las pruebas en [`database/diseno-pruebas.sql`](../database/diseno-pruebas.sql). El diseño general está en [`2026-10-08-arquitectura-zero-trust-design.md`](./superpowers/specs/2026-10-08-arquitectura-zero-trust-design.md).

## 1. Qué está implementado y qué es diseño

| Elemento | Estado | Dónde |
|---|---|---|
| Esquema `siget`, 3 roles, 8 tablas, 6 políticas RLS y 5 triggers | **Aplicado el 15-oct en `tramites_demo` (VM2) y validado con 19 pruebas** contra el esquema real | `database/diseno-*.sql`, runbook 17 |
| Base del checkpoint (`tramites_demo`): tablas `app_usuarios` y `demo_tramite` | **Implementado** | VM2 |
| La app PHP del checkpoint | **Brecha cerrada**: ya no usa `postgres`; se conecta como `checkpoint_app` (solo `app_usuarios`). `postgres` quedó sin contraseña y rechazado por red | `checkpoints/`, runbook 17 |

Estado real de la base hoy, consultado en VM2: 6 roles (`postgres` es el único superusuario, sin contraseña y rechazado por red; `siget_owner`, `app_role` y `auditor_role` sin privilegios especiales; `checkpoint_app` y `pgadmin_lectura` con `LOGIN`), 6 políticas RLS y 5 triggers. **Todavía no hay datos reales en el esquema `siget`**: `app_role` está `NOLOGIN` hasta que exista el backend, y la base sigue siendo la instalación nativa (la migración a contenedor es la tarea 2.2).

## 2. Principio: no hay superusuario en la operación

Zero Trust: ninguna pieza opera con privilegios de administrador absoluto.

- `postgres` (superusuario) solo ejecuta el **arranque inicial** (crear roles y esquema) y después **no se usa**: ni la aplicación, ni las migraciones, ni los respaldos.
- Los objetos pertenecen a `siget_owner`, que no es superusuario.
- Ningún rol del proyecto puede crear roles, crear bases ni saltarse RLS (`NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB`). Las pruebas 18 y 19 lo verifican.

## 3. Roles de PostgreSQL

| Rol | Quién lo usa | Puede | No puede |
|---|---|---|---|
| `siget_owner` | Solo las migraciones (`NOLOGIN`, se asume con `SET ROLE`) | Crear y modificar objetos del esquema `siget` | Ser superusuario; modificar la auditoría (lo impide el trigger); usarlo la aplicación |
| `app_role` | Django, con contraseña desde `podman secret` | Leer catálogos; crear y leer trámites **dentro de su institución**; cambiar `estado` y `funcionario_asignado_id`; insertar eventos y decisiones | `UPDATE` o `DELETE` sobre auditoría; borrar trámites; modificar `rol_plataforma`; saltarse RLS |
| `auditor_role` | Consultas de auditoría | Leer `evento_auditoria` y `decision_pdp` de **todas** las instituciones | Leer trámites; escribir en cualquier tabla |

## 4. Roles de aplicación (los evalúa el PDP, viven como datos)

Los 6 roles del diseño no son roles de PostgreSQL: se guardan en `usuario.rol_plataforma` y en `membresia(usuario, institución, rol)`, y el PDP de Django decide con ellos. La base los respalda con RLS.

| Rol de aplicación | Dónde se representa |
|---|---|
| Ciudadano, funcionario, supervisor, coordinador institucional, operador de plataforma, auditor institucional | `membresia.rol` (por institución) |
| Operador de plataforma, auditor | `usuario.rol_plataforma` |

## 5. Módulos (tablas)

| Módulo | Tabla | Función |
|---|---|---|
| Instituciones | `institucion` | 3 reales y 3 de demostración |
| Identidad | `usuario` | Atributos del sujeto: `nivel_aseguramiento`, `estado_cuenta`, `mfa_verificado_en`, `rol_plataforma` |
| Permisos | `membresia` | (usuario, institución, rol); una persona no puede asignarse a sí misma (`CHECK asignado_por <> usuario_id`) |
| Catálogo | `tipo_tramite` | Un trámite por institución con su SLA, mismo motor genérico |
| Trámites | `tramite` | La institución del trámite debe coincidir con la de su tipo (clave foránea compuesta) |
| Máquina de estados | `transicion` | Solo las transiciones válidas; un trigger rechaza las demás |
| Auditoría | `evento_auditoria` | Solo inserción; el cambio de estado la escribe en la misma transacción |
| Decisiones del PDP | `decision_pdp` | Decisiones permitidas y negadas; solo inserción |

**Pendientes de modelar:** documentos adjuntos y notificaciones.

## 6. Las dos barreras de aislamiento entre instituciones

1. **ABAC en Django (PDP):** decide con atributos del sujeto, recurso y entorno.
2. **RLS en PostgreSQL:** aunque el PDP o el código fallen, la base no entrega filas de otra institución. Django fija `app.usuario_id` y `app.instituciones` en cada transacción y las políticas filtran con ellos.

## 7. Resultado de las pruebas (19 de 19 pasan)

| # | Qué se prueba | Resultado |
|---|---|---|
| 1-2 | Un funcionario del MOP ve 1 trámite (el del MOP) y 0 del MINSA | PASA |
| 3 | La ciudadana ve solo el suyo | PASA |
| 4 | Un ciudadano no puede cambiar estados | PASA |
| 5 | No se puede crear un trámite a nombre de otro | PASA |
| 6-7 | Un cambio de estado válido funciona y genera su evento de auditoría en la misma transacción | PASA |
| 8 | Una transición inválida (`En Tramitación → Pendiente`) se rechaza | PASA |
| 9-10 | `app_role` no puede `UPDATE` ni `DELETE` la auditoría | PASA |
| 11 | `app_role` no puede borrar trámites | PASA |
| 12 | Nadie se asigna un rol a sí mismo | PASA |
| 13 | `app_role` no puede subirse a operador de plataforma | PASA |
| 14 | El trigger bloquea el `UPDATE` de la auditoría incluso al propietario | PASA |
| 15-17 | El auditor lee la auditoría, pero no los trámites ni puede escribir | PASA |
| 18-19 | Ningún rol ni tabla del proyecto depende de un superusuario | PASA |

Las pruebas se ejecutan dentro de `BEGIN … ROLLBACK`: verificado que después no quedan ni el esquema ni los roles, y que los datos del checkpoint (8 usuarios) siguen intactos.

## 8. Cómo mostrarlo en vivo

En VM2 están los archivos y un script que ejecuta todo y revierte:

```bash
bash ~/siget-diseno/demo.sh
```

Muestra primero el **estado real** de la base (un solo rol, sin RLS) y luego las 19 pruebas del diseño. No deja ningún cambio.

## 9. Brechas conocidas y siguiente paso

| Brecha | Estado |
|---|---|
| La app PHP del checkpoint usaba `postgres` (superusuario) | **Cerrada el 15-oct** (runbook 17): usa `checkpoint_app`, de mínimo privilegio |
| `postgres` conservaba acceso por red con contraseña | **Cerrada**: sin contraseña y `reject` en `pg_hba.conf` |
| pgAdmin se conectaba como `postgres` | **Cerrada**: ahora usa `pgadmin_lectura` (solo lectura) |
| `app_role` sin `LOGIN` | Pendiente: se activa con `podman secret` cuando exista el backend |
| La base sigue siendo la instalación nativa | Pendiente: migrar a contenedor y repetir esta configuración (tareas 2.2 y 2.3) |
