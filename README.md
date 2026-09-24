# SIGET — Sistema de Gestión y Trazabilidad

Proyecto de gobierno digital (Ciberseguridad 5, UTP). Referencia funcional inicial: Panamá Conecta.

**Autor:** Jeison Vásquez — Grupo Ciber5

## Problemática

Falta de trazabilidad y transparencia en el seguimiento de trámites ante el Estado — expedientes que quedan indefinidamente "en revisión", sin plazos exigibles ni rendición de cuentas. La seguridad (SELinux, aislamiento de red, RBAC, auditoría) es el mecanismo que garantiza que esa trazabilidad sea confiable, no el tema del proyecto en sí.

## Estado actual

Infraestructura base (Fase 1) completa y checkpoint de aplicación funcionando:

- Dos VMs Rocky Linux 9 (`app-backend` / `db-server`), red interna dedicada `192.168.100.0/24`, SELinux enforcing, firewall restrictivo.
- Checkpoint de entrega: aplicación PHP con login y gestión de usuarios (crear/eliminar), corriendo sobre Apache en VM1, contra PostgreSQL en VM2.

La arquitectura final del proyecto (Podman rootless, Django + DRF, React, JWT/MFA, modelo de datos completo con trazabilidad a nivel de BD) está definida pero pendiente de implementar — ver `docs/`.

## Estructura del repositorio (monorepo)

```
.
├── backend/                      # Django + DRF — API del proyecto (Fase 2, pendiente)
├── frontend/                     # React + Vite + Tailwind + shadcn/ui (Fase 2, pendiente)
├── infra/
│   ├── vm1-app-backend/          # Notas de configuración de VM1
│   ├── vm2-db-server/            # Notas de configuración de VM2
│   └── podman/                   # Unidades Quadlet (systemd) — Fase 2, pendiente
├── database/
│   └── schema.sql                # Esquema de la base de datos (sin credenciales)
├── checkpoints/
│   └── siget-gestion-usuarios/   # Entrega de checkpoint: login + CRUD en PHP (separada de la arquitectura final)
├── docs/
│   ├── Runbook_SIGET.docx        # Paso a paso técnico completo
│   ├── Informe_Avance_SIGET.docx # Resumen ejecutivo, decisiones, pendientes
│   └── Comandos_Demo_SIGET.txt   # Guion de comandos para demos
├── .github/workflows/            # CI/CD (planeado, ver README ahí)
├── .editorconfig
└── CONTRIBUTING.md               # Convención de ramas y commits
```

`backend/` y `frontend/` son el desarrollo real del proyecto en Django y React. `checkpoints/` guarda las entregas puntuales de avance (como la app PHP de login/usuarios) que se construyeron rápido para cumplir un pedido específico del profesor, separadas a propósito de la arquitectura final — no se van a ir mezclando con el código definitivo.

## Flujo de trabajo (GitFlow)

- **`main`** — versión estable, lista para mostrar/entregar. Solo recibe merges desde `develop` o `hotfix/*`.
- **`develop`** — rama de integración, donde conviven los avances antes de consolidarse.
- **`feature/<nombre>`** — una rama por bloque de trabajo (ej. `feature/podman-quadlet`, `feature/django-modelo-datos`), sale de `develop` y vuelve a `develop` por PR.
- **`release/<version>`** — cuando se prepara una entrega formal, sale de `develop`, se estabiliza ahí, y se mergea a `main` y de vuelta a `develop`.
- **`hotfix/<nombre>`** — arreglos urgentes sobre `main`, se mergean a `main` y a `develop`.

Convención de mensajes de commit y reglas de seguridad para cada PR: ver [`CONTRIBUTING.md`](./CONTRIBUTING.md).

Ejemplo para arrancar un bloque nuevo de trabajo:

```bash
git checkout develop
git pull
git checkout -b feature/podman-quadlet
# ... trabajo ...
git push -u origin feature/podman-quadlet
# Pull Request feature/podman-quadlet -> develop
```

## Regla de oro del proyecto

Nunca se elimina ni se sobreescribe nada en las VMs sin aprobación explícita, caso por caso. Todo cambio se documenta antes de ejecutarse.

## Seguridad

- `checkpoints/*/config.php` **nunca se sube a git** (está en `.gitignore`) — contiene credenciales reales. Usar `config.example.php` como plantilla.
- SELinux se mantiene en modo `enforcing` en ambas VMs en todo momento.
- El acceso a PostgreSQL está restringido por firewall a la IP interna exacta de la VM de aplicación.
