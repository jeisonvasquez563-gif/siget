# Plan de trabajo — SIGET

Orden de ejecución del proyecto, con estado real actualizado. Para la especificación técnica (qué se construye), ver [`spec.md`](./spec.md). Para el detalle paso a paso de lo ya hecho, ver [`../runbook.md`](../runbook.md).

> **Actualizado el 11 de octubre de 2026** con el diseño de seguridad Zero Trust (ABAC + Row Level Security). Ver la sección "Cambios de diseño" más abajo.

## Orden de trabajo original

1. **Crear VM1 y VM2 en VMware, configurar red interna, confirmar ping entre ambas.**
   ✅ Completo — ver `spec.md` sección 2 y `runbook.md` secciones 1-6.

2. **Instalar Podman rootless en ambas VMs, configurar Quadlet.**
   🔄 En progreso. VM1 (`app-backend`) hecho el 10 de octubre de 2026: Podman 5.8.2 rootless, SELinux en Enforcing sin denegaciones y primera unidad Quadlet de prueba (`siget-prueba`) — ver `runbook.md` sección 12 y [`../../infra/podman/plan-podman-quadlet.md`](../../infra/podman/plan-podman-quadlet.md). Pendiente: VM2 (`db-server`), definir el usuario que corre los contenedores del proyecto y activar su linger, y resolver los puertos 80/443 en VM1. La migración a contenedores de PostgreSQL y del resto la lleva Jeison.

3. **Desplegar PostgreSQL en VM2 (bind a IP interna, `pg_hba.conf` restringido, rol `app_role` con los permisos acotados).**
   ⚠️ Parcial — PostgreSQL está desplegado y funcionando, pero **nativo (vía dnf), no en contenedor Podman**, como parte del checkpoint intermedio pedido por el profesor. Falta: migrar a contenedor y crear el rol `app_role` con únicamente `SELECT`/`INSERT` en `evento_auditoria` y permisos mínimos en el resto (hoy se usa el superusuario `postgres` directamente, aceptable solo para el checkpoint), más las políticas de Row Level Security por institución del diseño Zero Trust.

4. **Desplegar Django + DRF en VM1 (pod con nginx), con las migraciones del modelo de datos.**
   ⏳ Pendiente. Requiere Podman/Quadlet (punto 2) resuelto primero.

5. **Confirmar conectividad app↔BD por TLS.**
   ⚠️ Parcial — la conectividad está confirmada y funcionando (verificado en el checkpoint), pero **sin TLS todavía** — el tráfico PostgreSQL viaja sin cifrar por la red interna. No explotable desde fuera del laboratorio (red host-only sin salida), pero debe corregirse antes de cualquier despliegue con datos reales.

6. **Cargar el catálogo de `TipoTramite` y de instituciones, empezando por Permiso de Construcción Municipal.**
   ⏳ Pendiente. Depende del modelo de datos en Django (punto 4). Ahora incluye 6 instituciones: Alcaldía, Ministerio Público / 311 y AMPYME (reales), más MINSA, MOP y MiAmbiente con un trámite de demostración cada una, para probar el aislamiento entre instituciones.

7. **Validar el flujo completo: crear trámite → cambiar estado → verificar `EventoAuditoria` → forzar vencimiento de SLA → confirmar escalamiento automático.**
   ⏳ Pendiente. Es la validación final de todo el sistema, depende de todos los puntos anteriores. Se suman las verificaciones de seguridad de `spec.md` sección 4.8: pruebas automáticas de la matriz de roles (un caso permitido y uno denegado por fila), pruebas de aislamiento entre instituciones contra la base real con RLS activo, intento de `UPDATE`/`DELETE` sobre `EventoAuditoria` (debe fallar) y la demostración en vivo de un funcionario del MOP intentando abrir un trámite del MINSA.

## Cambios de diseño (octubre de 2026)

El diseño de seguridad Zero Trust (*Arquitectura Zero Trust*, Jeison Vásquez, octubre de 2026) modifica la especificación original. Lo que cambia, ya reflejado en [`spec.md`](./spec.md):

| Tema | Antes | Ahora |
|---|---|---|
| Autorización | RBAC con grupos de Django | ABAC (NIST SP 800-162): PEP en middleware de Django y PDP como módulo de políticas; denegar por defecto y *fail closed* |
| Aislamiento entre instituciones | No definido | Dos barreras independientes: ABAC más Row Level Security en PostgreSQL |
| Roles | 4 (ciudadano, funcionario, supervisor y un rol de gestión único) | 10: ciudadano, funcionario, supervisor, coordinador institucional, cinco roles de operación de plataforma sin acceso a trámites (infraestructura, identidades, catálogo, seguridad y custodio de secretos) y auditor. Control dual y un solo rol de plataforma por persona |
| Identidad | Usuario y rol | Membresías (institución, rol) y atributo `nivel_aseguramiento`; la identidad ciudadana no se verifica contra el Registro Civil (límite declarado) |
| Auditoría | Eventos de cambio de estado | Además, registro de las decisiones del PDP, permitidas y negadas |
| Catálogo | 3 trámites reales | 3 reales más 3 de demostración (MINSA, MOP, MiAmbiente) |

Un motor externo (OPA) queda como fase futura: el PDP integrado en Django se diseña para poder migrarlo sin reescribir.

## Cobertura de Zero Trust

Cada principio de Zero Trust tiene tareas y semanas asignadas en [`../zero-trust-cobertura.md`](../zero-trust-cobertura.md) (ZT-1 a ZT-10). Esa matriz es la lista de control para afirmar, con evidencia, que el sistema aplica los 7 principios de NIST SP 800-207.

## Checkpoints intermedios (fuera del orden original, resueltos por pedidos puntuales del profesor)

Estos no estaban en el plan original — se insertaron para cumplir avances de entrega solicitados durante el curso, deliberadamente separados de la arquitectura final (ver `checkpoints/` en la raíz del repo):

- ✅ **Checkpoint 1 — BD + panel de administración (pgAdmin4).** Primer intento, no era exactamente lo pedido.
- ✅ **Checkpoint 2 — App de login y gestión de usuarios (PHP + Apache + PostgreSQL).** La entrega real, verificada de punta a punta.
- ✅ **Crear cuenta y restablecer contraseña** en la app, enlazados desde el login (reset simplificado, sin email, porque el laboratorio no tiene SMTP — aclarado en la propia pantalla).
- ✅ **Rate limiting de login**: 3 intentos fallidos, bloqueo de 5 minutos, mensajes de "Acceso denegado" claros. Dos bugs encontrados y corregidos en el proceso (comparación de fechas movida a SQL, tipo boolean de PDO_PGSQL).
- ✅ **Repositorio Git + estructura de monorepo + GitFlow.** Formalización del proyecto para trabajo en equipo.
- ✅ **Redacción de credenciales y rotación de contraseñas.** Tras hacer el repo público.
- ✅ **Branch protection en `main` y `develop`.**
- ✅ **Acceso de equipo por Tailscale**: tailnet dedicada al proyecto (no la personal del desarrollador), VM1 y VM2 sumadas. Reemplaza un intento previo de port forwarding por NAT que no funcionó (probable aislamiento de clientes en la WiFi del aula).
- ✅ **Guía de capturas repartida entre el grupo** (`docs/capturas-evidencia.md`) para documentar la configuración con evidencia de cada integrante.
- ✅ **Documento de antecedentes del proyecto** (`docs/Antecedentes_SIGET.docx`), solicitado por el profesor: investigación documental con fuentes panameñas, marco normativo, brechas y justificación de SIGET, con bibliografía APA.

## Próximos pasos (en orden sugerido)

1. Terminar Podman rootless + Quadlet: VM2, usuario que corre los contenedores (con linger) y puertos 80/443 en VM1 (punto 2 del plan original).
2. Migrar PostgreSQL de instalación nativa a contenedor, crear `app_role` con permisos acotados (a cargo de Jeison).
3. Definir política de secretos con `podman secret`, reemplazando las contraseñas en texto plano actuales.
4. **Redactar la especificación propia del motor ABAC**: catálogo de atributos, lenguaje de políticas, interfaz del PDP y estrategia de implementación por capas (primero membresías por institución, luego reglas contextuales como MFA reciente y nivel de aseguramiento). No requiere tocar las VMs.
5. **Plan de implementación del ABAC**, integrado al cronograma de 10 semanas.
6. Iniciar `backend/` con Django + DRF, primeras migraciones del modelo de datos (`Usuario`, `Institucion`, `Membresia`, `TipoTramite`, `Tramite`, `EventoAuditoria`) y las políticas de Row Level Security.
7. Configurar TLS entre app y BD.
8. Iniciar `frontend/` con React + Vite, consumiendo la API de Django.
9. Cargar catálogo de `TipoTramite` e instituciones, empezando por Permiso de Construcción Municipal.
10. Validar flujo end-to-end completo y las verificaciones de seguridad (punto 7 del plan original).
11. **Retirar el checkpoint PHP** (login, registro, reset de password y rate limiting sobre Apache + PHP-FPM). **Decisión: el PHP no forma parte del sistema final**; fue un entregable intermedio pedido por el profesor y vive aislado en `checkpoints/`. El sistema final es Django + DRF y React. **Fecha objetivo: semana 6 (16–22 de noviembre de 2026)**, cuando Django y React ofrezcan registro, login, restablecimiento de contraseña y bloqueo por intentos equivalentes. Hasta entonces se mantiene **sin funciones nuevas**, solo con correcciones de seguridad. El retiro (apagar la app, quitar `/gestion` de Apache y revocar `checkpoint_app`) requiere aprobación explícita de Jeison y se documenta en el runbook. Ver [`../zero-trust-cobertura.md`](../zero-trust-cobertura.md) (ZT-9).
12. Evaluar si conviene remover el port forwarding por NAT que quedó configurado y sin uso (VMware NAT + regla de Firewall de Windows), ya que el acceso real es por Tailscale.

## Completado recientemente

- ✅ **Auth keys de Tailscale revocadas** — las que se compartieron por chat durante el alta de VM1 y VM2 ya no son utilizables; los dispositivos siguen conectados con normalidad (revocar la key no afecta a dispositivos ya autenticados, solo impide su reuso).
- ✅ **Diseño de arquitectura Zero Trust** (octubre de 2026): modelo ABAC, matriz de 10 roles, capas, modelo de amenazas STRIDE y mapa de instituciones. Incorporado a `spec.md` y a este plan el 11 de octubre de 2026.
- ✅ **Podman rootless + primera unidad Quadlet en VM1** (10 de octubre de 2026), documentado en `runbook.md` sección 12. Falta VM2.
