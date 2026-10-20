# Plan de trabajo — Semanas 1 y 2

Detalle operativo de las dos primeras semanas del cronograma de 10 semanas (ver [`documento-introductorio.md`](../documento-introductorio.md), sección 5). Complementa el orden general de [`plan.md`](./plan.md) y la especificación de [`spec.md`](./spec.md).

> **Estado de partida (15 de octubre de 2026):** la semana 1 empezó el lunes 12 de octubre, así que este plan cuenta desde el jueves 15. Las asignaciones de personas son una **propuesta**: Jeison las confirma o cambia. Las tareas que tocan las VMs con `sudo` solo las pueden hacer Jeison (ambas VMs) y Andy (solo VM1, por ahora).

## 1. Objetivo de las dos semanas

Dejar listos los cimientos de la Fase 2 para que Django tenga dónde correr desde la semana 3:

1. Podman rootless + Quadlet en **VM1 y VM2**.
2. **PostgreSQL en contenedor** en VM2, con `app_role`, secretos con `podman secret` y bind a la IP interna.
3. Esqueleto de **backend** (Django + DRF) y **frontend** (React) funcionando en las PCs del equipo, sin depender de las VMs.
4. **Especificación y plan del motor ABAC** escritos y aprobados.

## 2. Decisiones que desbloquean el trabajo (Jeison, antes del lunes 19)

| # | Decisión | Opciones | Recomendación |
|---|---|---|---|
| D1 | Usuario que corre los contenedores | A: usuario de servicio dedicado `siget` · B: el de cada integrante | **A**: el sistema no depende de una persona y el linger se activa una sola vez |
| D2 | Puertos 80/443 en VM1 (Apache ocupa el 80; rootless no puede usar puertos <1024) | A: nginx en puertos altos (8080/8443) y redirección con firewalld; Apache sigue con el checkpoint · B: bajar `net.ipv4.ip_unprivileged_port_start` y mover Apache | **A**: no se toca la app PHP del checkpoint, que requiere aprobación explícita |
| D3 | Sudo de Andy en VM2 | Dar `NOPASSWD` en VM2 · Que Jeison ejecute los pasos con sudo | Dar sudo solo mientras dure la instalación y revocarlo después (mínimo privilegio) |
| D4 | Destino de `siget-prueba` | Dejarlo · Retirarlo cuando exista el usuario `siget` | Retirarlo después de D1, con aprobación de Jeison |

## 3. Semana 1 (jueves 15 – domingo 18 de octubre)

| ID | Tarea | Responsable (propuesto) | Depende de | Criterio de terminado |
|---|---|---|---|---|
| 1.1 ✅ | Crear el usuario de servicio `siget` con rango subuid/subgid y linger | Jeison | D1 | **Hecho el 15-oct** (runbook 15): `Linger=yes` en VM1 y VM2, Podman rootless verificado en VM1 |
| 1.2 ✅ | Instalar Podman en VM2 y repetir las verificaciones de VM1 (rootless, SELinux, sin AVC) | Jeison (D3: sin sudo adicional para Andy) | D3 | **Hecho el 15-oct** (runbook 12.9): Podman 5.8.2, rootless, SELinux Enforcing sin AVC |
| 1.3 | Cargar las claves públicas de los 7 compañeros restantes en VM1 y VM2 | Jeison (con las claves de cada uno) | — | Cada integrante entra por SSH con su usuario |
| 1.4 ✅ | Habilitar journal persistente o `auditd` para trazar el uso de sudo | Jeison | — | **Hecho el 15-oct** (runbook 14.6): journal persistente en VM1 y VM2 |
| 1.5 ✅ | Escribir la **especificación del motor ABAC**: atributos, reglas, interfaz del PDP | Equipo ABAC (por asignar) | Diseño Zero Trust aprobado | **Hecho el 20-oct**: [`2026-10-20-motor-abac-design.md`](../superpowers/specs/2026-10-20-motor-abac-design.md), implementado en `backend/apps/autorizacion/` con 84 pruebas |
| 1.6 🔄 | Esqueleto de **backend**: proyecto Django + DRF en `backend/`, apps y modelos, migraciones | Equipo backend (por asignar) | — | **Esqueleto, configuración segura y PDP hechos el 20-oct** (84 pruebas). Faltan los modelos de las tablas del esquema `siget` y la autenticación |
| 1.7 | Esqueleto de **frontend**: React + Vite + Tailwind + shadcn/ui en `frontend/`, pantalla de login contra datos simulados | Dos integrantes (por asignar) | — | `npm run dev` levanta y muestra el login |
| 1.8 ✅ | Verificar los DOI de las referencias NIST y corregir la bibliografía | Cualquiera | — | **Hecho el 15-oct**: ambos DOI resuelven a NIST y coinciden títulos, autores y años |

**Cierre de semana 1:** Podman rootless en las dos VMs, usuario `siget` con linger, todos los compañeros con acceso SSH, y la especificación del ABAC en borrador.

## 4. Semana 2 (lunes 19 – domingo 25 de octubre)

| ID | Tarea | Responsable (propuesto) | Depende de | Criterio de terminado |
|---|---|---|---|---|
| 2.1 ✅ | **Respaldo** de `tramites_demo` y `app_usuarios` antes de tocar la base (volcado con `pg_dump`) | Jeison | — | **Hecho el 15-oct** (runbook 16): restauración de prueba correcta y copia fuera de la VM con hash verificado |
| 2.2 ✅ | **PostgreSQL 16 en contenedor** en VM2 con Quadlet, bind solo a `192.168.100.20`, `pg_hba.conf` restringido a `192.168.100.10` | Jeison | 1.1, 1.2 | **Hecho el 20-oct** (runbook 21): contenedor rootless de `siget` en el puerto 5433, TLS 1.3 y secretos con `podman secret` |
| 2.3 ✅ | Migrar los datos del PostgreSQL nativo al contenedor y comprobar que la app PHP sigue funcionando | Jeison | 2.1, 2.2 | **Hecho el 20-oct** (runbook 21): datos migrados, app funcionando contra el contenedor y base nativa apagada y deshabilitada (sin borrar sus datos) |
| 2.4 🔄 | Aplicar el esquema de [`database/diseno-roles-permisos.sql`](../../database/diseno-roles-permisos.sql): roles `siget_owner`, `app_role` y `auditor_role`, **sin superusuario en la operación**, `REVOKE UPDATE, DELETE` sobre auditoría y RLS. Reemplazar el uso de `postgres` en la app del checkpoint | Jeison | 2.2 | **Hecho el 15-oct sobre la base nativa** (runbook 17): 24 pruebas pasan contra el esquema real y la app usa `checkpoint_app`. Falta repetirlo en el contenedor (2.2) y activar `app_role` con secret |
| 2.5 🔄 | **Secretos con `podman secret`**: la contraseña de la base deja de estar en archivos en texto plano | Jeison, con Andy | 2.2 | **Hecho para el contenedor** (clave TLS como secreto y sin contraseña de superusuario). Falta la contraseña de `checkpoint_app`, que está en el `config.php` del PHP y desaparece con su retiro |
| 2.6 | Plan de implementación del ABAC integrado al cronograma (primero membresías, luego reglas contextuales) | Equipo de la 1.5 | 1.5 | Plan aprobado |
| 2.7 | Backend: autenticación (Argon2, JWT de vida corta y refresh), registro y login | Equipo de la 1.6 | 1.6 | Tests de login correcto, incorrecto y bloqueo tras 3 intentos |
| 2.8 | Backend: esqueleto del PDP (deniega por defecto, *fail closed*) y primeras pruebas de la matriz | Equipo de la 1.6 y la 1.5 | 1.5, 1.6 | Un caso permitido y uno denegado por cada fila implementada |
| 2.9 | Frontend: login real contra la API y vista de "mis trámites" del ciudadano | Equipo de la 1.7 | 2.7 | Entra con un usuario real y lista trámites propios |
| 2.10 | Documentar todo lo ejecutado en el runbook y el `CHANGELOG.md` | Quien ejecute cada tarea | — | Cada tarea ejecutada aparece en `runbook.md` |

**Cierre de semana 2:** PostgreSQL en contenedor con `app_role` y secretos, esqueleto de backend con autenticación y primer PDP, frontend con login real, y plan del ABAC aprobado. Esto habilita la semana 3 del cronograma (modelo de datos y máquina de estados).

## 5. Camino crítico y riesgos

El camino crítico es **D1 → 1.1 → 2.2 → 2.3 → 2.4**: sin el usuario `siget` no hay contenedor de base, y sin la base en contenedor no hay `app_role` ni RLS.

| Riesgo | Efecto | Mitigación |
|---|---|---|
| La migración de datos rompe el login del checkpoint | Se pierde lo que ya se entregó al profesor | Respaldo previo (2.1) y no apagar el PostgreSQL nativo hasta verificar el contenedor |
| Dependemos de Jeison para casi toda tarea con `sudo` | Cuello de botella | Dar sudo temporal y acotado (D3) y automatizar con scripts versionados en `infra/` |
| El ABAC completo se come el cronograma | Retrasa backend y frontend | Implementarlo por capas: primero membresías por institución; las reglas contextuales después |
| Integrantes sin clave cargada no pueden trabajar | Tareas del equipo sin avanzar | 1.3 va primero y el trabajo de backend y frontend no depende de las VMs |
| Contraseñas en texto plano mientras llega `podman secret` | Exposición accidental | No commitear configuración real; `config.php` sigue fuera de git |

## 6. Reglas de trabajo durante estas semanas

- Una rama por tarea (`feature/…` o `docs/…`) y PR a `develop`, con Conventional Commits.
- Cada tarea ejecutada se documenta en `docs/runbook.md` y `CHANGELOG.md` en el mismo PR.
- Nada se apaga ni se elimina en las VMs sin aprobación explícita de Jeison.
- Ningún secreto en el repositorio.
- Las asignaciones de la tabla son una propuesta; en el cierre de cada semana se actualiza el estado real en [`plan.md`](./plan.md).

## 7. Retiro del checkpoint PHP y cobertura de Zero Trust

**El PHP no es parte del sistema final.** Es el checkpoint que se entregó al profesor y se mantiene solo como referencia hasta que Django y React lo reemplacen. Fecha objetivo de retiro: **semana 6 (16–22 de noviembre de 2026)**, con aprobación de Jeison. Mientras tanto no recibe funciones nuevas, solo correcciones de seguridad (por ejemplo, ya no se conecta como superusuario; ver `runbook.md` sección 17). Ningún trabajo de estas dos semanas debe depender de PHP.

**Zero Trust:** las tareas para cubrir los 7 principios están en [`../zero-trust-cobertura.md`](../zero-trust-cobertura.md). Las que caen en estas dos semanas:

| ID | Tarea | Semana |
|---|---|---|
| ZT-1 | Inventario de recursos con clasificación | S2 |
| ZT-2 ✅ | TLS entre la aplicación y la base (el checkpoint pasa a `sslmode=verify-full`): **hecho el 15-oct**, runbook 18 | S2 |
| ZT-4 ✅ | Sudo de mínimo privilegio para `andy_martinez`: **hecho el 15-oct**, runbook 20 | S2 |

**Nombres de roles:** ningún rol del sistema lleva el nombre "administrador". Los roles de gestión son `coordinador_institucional` y cinco roles de operación de plataforma por función (`operador_infraestructura`, `operador_identidades`, `operador_catalogo`, `operador_seguridad` y `custodio_secretos`), con control dual en las altas sensibles.
