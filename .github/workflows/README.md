# CI/CD

Cada frente tiene su propia verificación y solo corre cuando cambia su carpeta (ver [`docs/organizacion-backend-frontend.md`](../../docs/organizacion-backend-frontend.md)):

| Flujo | Qué verifica | Cuándo corre |
|---|---|---|
| `backend-ci.yml` | `pytest` del backend (pruebas sin base de datos: PDP, autenticación, serialización, auditoría de rutas públicas) | Cambios en `backend/` |
| `frontend-ci.yml` | `npm ci`, ESLint, **128 pruebas** (Vitest, Testing Library, axe), `npm run build`, que el simulador de desarrollo no llegue a `dist/` y que no haya estilos ni scripts en línea (la CSP de nginx lo prohíbe) | Cambios en `frontend/` |

Las pruebas contra la base real (`verificar_esquema`, `verificar_tramites`, `verificar_auditoria`…) no corren aquí: necesitan PostgreSQL con RLS y los roles del proyecto y se ejecutan en VM1 (ver `docs/runbook.md`).

| `security-scan.yml` | **SDLC seguro, etapas 4 y 6.** Bandit (SAST del backend), Semgrep (OWASP Top 10, Django, React, secretos), pip-audit y npm audit (dependencias) y Gitleaks (secretos en todo el historial, con suma SHA-256 verificada). Cualquier hallazgo hace fallar el flujo | Cada PR, cada push a `develop`/`main`, cada lunes y a mano |

`dependabot.yml` abre PRs semanales de actualización de dependencias (pip, npm, imagen base y acciones de GitHub). `CODEOWNERS` exige la revisión del responsable de infraestructura en lo que toca seguridad.

## Planeado

- Lint (`ruff` y `eslint`) cuando el equipo acuerde las reglas.
