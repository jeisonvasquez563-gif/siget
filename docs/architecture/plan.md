# Plan de trabajo — SIGET

Orden de ejecución del proyecto, con estado real actualizado. Para la especificación técnica (qué se construye), ver [`spec.md`](./spec.md). Para el detalle paso a paso de lo ya hecho, ver [`../runbook.md`](../runbook.md).

## Orden de trabajo original

1. **Crear VM1 y VM2 en VMware, configurar red interna, confirmar ping entre ambas.**
   ✅ Completo — ver `spec.md` sección 2 y `runbook.md` secciones 1-6.

2. **Instalar Podman rootless en ambas VMs, configurar Quadlet.**
   ⏳ Pendiente. Próximo bloque de trabajo grande de la Fase 2.

3. **Desplegar PostgreSQL en VM2 (bind a IP interna, `pg_hba.conf` restringido, rol `app_role` con los permisos acotados).**
   ⚠️ Parcial — PostgreSQL está desplegado y funcionando, pero **nativo (vía dnf), no en contenedor Podman**, como parte del checkpoint intermedio pedido por el profesor. Falta: migrar a contenedor y crear el rol `app_role` con únicamente `SELECT`/`INSERT` en `evento_auditoria` (hoy se usa el superusuario `postgres` directamente, aceptable solo para el checkpoint).

4. **Desplegar Django + DRF en VM1 (pod con nginx), con las migraciones del modelo de datos.**
   ⏳ Pendiente. Requiere Podman/Quadlet (punto 2) resuelto primero.

5. **Confirmar conectividad app↔BD por TLS.**
   ⚠️ Parcial — la conectividad está confirmada y funcionando (verificado en el checkpoint), pero **sin TLS todavía** — el tráfico PostgreSQL viaja sin cifrar por la red interna. No explotable desde fuera del laboratorio (red host-only sin salida), pero debe corregirse antes de cualquier despliegue con datos reales.

6. **Cargar el catálogo de `TipoTramite`, empezando por Permiso de Construcción Municipal.**
   ⏳ Pendiente. Depende del modelo de datos en Django (punto 4).

7. **Validar el flujo completo: crear trámite → cambiar estado → verificar `EventoAuditoria` → forzar vencimiento de SLA → confirmar escalamiento automático.**
   ⏳ Pendiente. Es la validación final de todo el sistema, depende de todos los puntos anteriores.

## Checkpoints intermedios (fuera del orden original, resueltos por pedidos puntuales del profesor)

Estos no estaban en el plan original — se insertaron para cumplir avances de entrega solicitados durante el curso, deliberadamente separados de la arquitectura final (ver `checkpoints/` en la raíz del repo):

- ✅ **Checkpoint 1 — BD + panel de administración (pgAdmin4).** Primer intento, no era exactamente lo pedido.
- ✅ **Checkpoint 2 — App de login y gestión de usuarios (PHP + Apache + PostgreSQL).** La entrega real, verificada de punta a punta.
- ✅ **Repositorio Git + estructura de monorepo + GitFlow.** Formalización del proyecto para trabajo en equipo.
- ✅ **Redacción de credenciales y rotación de contraseñas.** Tras hacer el repo público.
- ✅ **Branch protection en `main` y `develop`.**

## Próximos pasos (en orden sugerido)

1. Instalar Podman rootless + Quadlet en VM1 y VM2 (punto 2 del plan original).
2. Migrar PostgreSQL de instalación nativa a contenedor, crear `app_role` con permisos acotados.
3. Definir política de secretos con `podman secret`, reemplazando las contraseñas en texto plano actuales.
4. Iniciar `backend/` con Django + DRF, primeras migraciones del modelo de datos (`Usuario`, `Institucion`, `TipoTramite`, `Tramite`, `EventoAuditoria`).
5. Configurar TLS entre app y BD.
6. Iniciar `frontend/` con React + Vite, consumiendo la API de Django.
7. Cargar catálogo de `TipoTramite`, empezando por Permiso de Construcción Municipal.
8. Validar flujo end-to-end completo (punto 7 del plan original).
9. Decidir destino del checkpoint PHP actual (conservar como referencia, migrar su lógica, o retirarlo) — requiere aprobación explícita antes de tocar nada.
