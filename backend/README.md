# backend

Django + Django REST Framework (API-first). Pendiente de implementación — Fase 2 del proyecto.

## Stack definido

- Django + DRF
- Hash de contraseñas: Argon2
- Auth: JWT de corta duración (`djangorestframework-simplejwt`) + refresh token
- MFA: `django-otp` (TOTP), obligatorio para funcionario/supervisor/administrador
- RBAC: grupos y permisos nativos de Django (ciudadano, funcionario, supervisor, administrador)
- Corre en contenedor Podman rootless (VM1), gestionado por Quadlet, junto a nginx en el mismo pod

## Estructura esperada (convención estándar Django)

```
backend/
├── manage.py
├── requirements.txt / pyproject.toml
├── config/                 # settings, urls, wsgi/asgi del proyecto
├── apps/
│   ├── usuarios/
│   ├── tramites/
│   ├── auditoria/
│   └── notificaciones/
└── tests/
```

## Por qué no está el checkpoint PHP acá

El checkpoint de login/gestión de usuarios (`checkpoints/siget-gestion-usuarios/`) fue una entrega rápida en PHP nativo para cumplir un pedido puntual del profesor, separada a propósito de la arquitectura final. Este directorio (`backend/`) es donde va el desarrollo real del proyecto en Django.
