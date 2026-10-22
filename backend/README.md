# backend

Django 5.2 LTS + Django REST Framework (API-first). Corre en un contenedor Podman rootless en VM1, gestionado por Quadlet, junto a nginx.

## Estado

| Parte | Estado |
|---|---|
| Esqueleto del proyecto (`config/`), configuración segura | ✅ |
| Motor de decisión de acceso (PDP) y denegar por defecto en DRF | ✅ 84 pruebas |
| Contexto RLS por transacción e integración con la base real | ✅ 15 pasos contra la base real |
| Imagen del contenedor (`Containerfile`) | ✅ construida en VM1 |
| Modelos de las tablas del esquema `siget` | ✅ 9 modelos verificados contra la base real |
| Autenticación (Argon2, JWT corto, MFA TOTP, reautenticación, bloqueo) | ✅ 47 pasos contra la base real |
| Trámites y catálogo (crear, bandeja, estado, reasignar, historial) | ✅ 51 pasos contra la base real |
| Equipo, módulos por rol y cuentas de demostración (`sembrar_demo`) | ✅ |
| Consola de auditoría con rol de base de datos propio (solo lectura) | ✅ 34 pasos contra la base real |
| Transparencia: matriz de permisos calculada por el PDP y permisos reales de la base (`/politicas/`), actividad de seguridad propia | ✅ 30 pasos contra la base real |
| Consolas de plataforma (control dual), plazos hábiles y escalamiento, documentos, notificaciones | ⏳ ([hoja de ruta](../docs/organizacion-backend-frontend.md)) |

## Stack

- Django 5.2 LTS + DRF; hash de contraseñas Argon2.
- Auth: JWT de acceso de 10 minutos y refresco opaco de un solo uso, con PyJWT (no `simplejwt`: nuestro usuario no es el de Django). Ver [`docs/superpowers/specs/2026-10-20-autenticacion-design.md`](../docs/superpowers/specs/2026-10-20-autenticacion-design.md).
- MFA: TOTP con `pyotp`; el secreto se guarda cifrado con Fernet.
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
│   ├── autenticacion/      # login, MFA, sesiones, tokens y eventos de seguridad
│   ├── autorizacion/       # PDP (pdp.py) y permisos de DRF
│   ├── catalogo/           # Institucion, TipoTramite
│   ├── identidad/          # Usuario, Membresia, Aprobacion y el adaptador al PDP
│   ├── tramites/           # Tramite, Transicion
│   ├── auditoria/          # EventoAuditoria, DecisionPdp (solo inserción)
│   └── nucleo/             # salud, contexto RLS y comandos verificar_esquema / verificar_integracion / verificar_autenticacion
└── tests/
```

## Cómo trabajar en local

```bash
cd backend
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements-dev.txt     # en Linux/Mac: .venv/bin/python
.venv/Scripts/python -m pytest
```

Las pruebas de `pytest` no necesitan la base de datos. Para probar contra la base real hay un contenedor y dos comandos de gestión:

- `python manage.py verificar_esquema`: compara cada modelo con su tabla real.
- `python manage.py verificar_integracion`: recorrido por el ORM (RLS, triggers, auditoría, permisos) en una transacción que se revierte.
- `python manage.py verificar_autenticacion`: recorrido HTTP de la autenticación (registro, login, MFA, refresco, bloqueo, límites) en una transacción que se revierte, con el reloj controlado.

Se ejecutan en VM1 con la imagen del `Containerfile` y los secretos como `podman secret`; el comando exacto está en [`docs/runbook.md`](../docs/runbook.md) sección 23.

## Configuración (sin secretos en el código)

Todo se lee de variables de entorno. Los secretos pueden venir de un archivo con el sufijo `_FILE`, que es como los monta `podman secret`.

| Variable | Qué es | Por defecto |
|---|---|---|
| `SIGET_SECRET_KEY` o `SIGET_SECRET_KEY_FILE` | Clave de Django | **Obligatoria**: sin ella el arranque falla |
| `SIGET_DB_HOST`, `SIGET_DB_PORT` | Base de datos | `192.168.100.20`, `5433` |
| `SIGET_DB_NAME`, `SIGET_DB_USER` | Base y rol | `tramites_demo`, `app_role` |
| `SIGET_DB_PASSWORD` o `SIGET_DB_PASSWORD_FILE` | Contraseña de `app_role` | vacía |
| `SIGET_JWT_KEY` o `SIGET_JWT_KEY_FILE` | Clave que firma los tokens de acceso (mínimo 32 caracteres) | **Obligatoria** |
| `SIGET_MFA_KEY` o `SIGET_MFA_KEY_FILE` | Clave Fernet que cifra los secretos TOTP | **Obligatoria** |
| `SIGET_ACCESS_TTL_SEGUNDOS`, `SIGET_REFRESH_TTL_SEGUNDOS` | Vigencia del acceso y del refresco | `600`, `28800` |
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

## Contrato con el frontend

Las rutas, formatos y errores que consume la interfaz están en [`docs/api.md`](../docs/api.md). Cambiarlos exige actualizar ese archivo en el mismo PR. Cómo se reparte el trabajo: [`docs/organizacion-backend-frontend.md`](../docs/organizacion-backend-frontend.md).
