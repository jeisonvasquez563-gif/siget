# CI/CD (planeado)

Todavía no hay pipelines activos porque `backend/` y `frontend/` no tienen código aún (Fase 2). Cuando arranquen, este directorio va a tener:

- `backend-ci.yml` — lint (ruff/flake8) + tests (pytest) del backend Django
- `frontend-ci.yml` — lint (eslint) + build de la SPA React
- `security-scan.yml` — escaneo de dependencias / secretos antes de cada merge a `develop` o `main`

No se agregan workflows vacíos o rotos a propósito — mejor no tener CI que tener CI verde en falso sin nada real que validar.
