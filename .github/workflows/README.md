# CI/CD

Cada frente tiene su propia verificación y solo corre cuando cambia su carpeta (ver [`docs/organizacion-backend-frontend.md`](../../docs/organizacion-backend-frontend.md)):

| Flujo | Qué verifica | Cuándo corre |
|---|---|---|
| `backend-ci.yml` | `pytest` del backend (pruebas sin base de datos: PDP, autenticación, serialización, auditoría de rutas públicas) | Cambios en `backend/` |
| `frontend-ci.yml` | `npm ci` + `npm run build` y que no haya estilos ni scripts en línea (la CSP de nginx lo prohíbe) | Cambios en `frontend/` |

Las pruebas contra la base real (`verificar_esquema`, `verificar_tramites`, `verificar_auditoria`…) no corren aquí: necesitan PostgreSQL con RLS y los roles del proyecto y se ejecutan en VM1 (ver `docs/runbook.md`).

## Planeado

- `security-scan.yml`: escaneo de dependencias (`pip-audit`, `npm audit`) y de secretos (gitleaks) antes de cada merge a `develop` o `main`.
- Lint (`ruff` y `eslint`) cuando el equipo acuerde las reglas.
