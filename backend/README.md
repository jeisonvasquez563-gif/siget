# backend

Django 5.2 LTS + Django REST Framework (API-first). Corre en un contenedor Podman rootless en VM1, gestionado por Quadlet, junto a nginx.

## Estado

| Parte | Estado |
|---|---|
| Esqueleto del proyecto (`config/`), configuración segura | ✅ |
| Motor de decisión de acceso (PDP) y denegar por defecto en DRF | ✅ 84 pruebas |
| Modelos de las tablas del esquema `siget` | ⏳ |
| Autenticación (Argon2, JWT corto, MFA TOTP) | ⏳ |
| Trámites, catálogo, auditoría, plazos y escalamiento | ⏳ |

## Stack

- Django 5.2 LTS + DRF; hash de contraseñas Argon2.
- Auth: JWT de corta duración (`djangorestframework-simplejwt`) + refresh token. Pendiente.
- MFA: `django-otp` (TOTP). Pendiente.
- Autorización: ABAC con membresías (ver [`docs/superpowers/specs/2026-10-20-motor-abac-design.md`](../docs/superpowers/specs/2026-10-20-motor-abac-design.md)).
- Base de datos: PostgreSQL 16 en contenedor, por TLS con `verify-full`, esquema `siget`, rol `app_role` (sin superusuario).

## Estructura

```
backend/
├── manage.py
├── pytest.ini
├── requirements.txt / requirements-dev.txt
├── config/                 # settings, urls y wsgi
│   └── settings_test.py    # solo para las pruebas
├── apps/
│   ├── autorizacion/       # PDP (pdp.py) y permisos de DRF
│   └── nucleo/             # vista de salud
└── tests/
```

## Cómo trabajar en local

```bash
cd backend
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements-dev.txt     # en Linux/Mac: .venv/bin/python
.venv/Scripts/python -m pytest
```

Las pruebas actuales no necesitan la base de datos.

## Configuración (sin secretos en el código)

Todo se lee de variables de entorno. Los secretos pueden venir de un archivo con el sufijo `_FILE`, que es como los monta `podman secret`.

| Variable | Qué es | Por defecto |
|---|---|---|
| `SIGET_SECRET_KEY` o `SIGET_SECRET_KEY_FILE` | Clave de Django | **Obligatoria**: sin ella el arranque falla |
| `SIGET_DB_HOST`, `SIGET_DB_PORT` | Base de datos | `192.168.100.20`, `5433` |
| `SIGET_DB_NAME`, `SIGET_DB_USER` | Base y rol | `tramites_demo`, `app_role` |
| `SIGET_DB_PASSWORD` o `SIGET_DB_PASSWORD_FILE` | Contraseña de `app_role` | vacía |
| `SIGET_DB_SSLROOTCERT` | CA que verifica el certificado del servidor | `/etc/pki/siget/ca.crt` |
| `SIGET_ALLOWED_HOSTS` | Hosts permitidos, separados por coma | vacío |
| `SIGET_MFA_RECIENTE_MINUTOS` | Vigencia del segundo factor para acciones sensibles | `15` |
| `SIGET_MFA_CIUDADANO_OBLIGATORIO` | MFA obligatorio para el ciudadano | `true` |
| `SIGET_DEBUG` | Modo de depuración | `false` |

## Seguridad desde el arranque

- Toda la API **niega por defecto** (`DenegarPorDefecto`); la única vista pública es `/salud/`, que no toca datos.
- La conexión a la base va cifrada y verifica el certificado. El rol de la base no es superusuario.
- En producción: HSTS, cookies seguras y redirección a HTTPS.

## Por qué no está el checkpoint PHP acá

Vive aislado en `checkpoints/` y se retira en la semana 6. El sistema final es Django + React.
