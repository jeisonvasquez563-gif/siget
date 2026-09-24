# infra/podman

Unidades Quadlet (systemd) para gestionar los contenedores Podman rootless del proyecto. Pendiente — Fase 2.

## Convención esperada

```
infra/podman/
├── vm1-app-backend/
│   ├── django-app.container
│   ├── nginx.container
│   └── siget-app.pod
└── vm2-db-server/
    └── postgres.container
```

Sin `docker-compose` — el proyecto usa exclusivamente Podman + Quadlet, gestionado por systemd en cada VM (decisión de arquitectura, ver `docs/`).
