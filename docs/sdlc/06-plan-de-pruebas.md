# Plan de pruebas de seguridad y revisión de código

**Etapa 6: Pruebas** · Responsable: **Bradley Morales** · Revisa: **Joel Medina**

> Implementar procesos de revisión de código y realizar pruebas estáticas y dinámicas de seguridad. (Red Hat, *Seguridad en el ciclo de vida de desarrollo del software*.)

## Cómo completarla

1. La tabla de pruebas ya lista lo que existe: corré las dos primeras en tu computadora y pegá la captura del resultado.
2. Backend: en la carpeta `backend/`, crear un entorno con `python -m venv .venv`, instalar `pip install -r requirements-dev.txt` y correr `python -m pytest -q`.
3. Frontend: en la carpeta `frontend/`, `npm ci` y después `npm test`.
4. Completá la lista de revisión de código y usala en al menos 2 PR abiertos (dejá los comentarios en GitHub).

## Pruebas existentes

| Prueba | Qué cubre | Dónde corre | Resultado (fecha y captura) |
|---|---|---|---|
| Backend (pytest) | PDP, autenticación, plazos, documentos, registro | Tu computadora y CI | [completar] |
| Frontend (Vitest) | Pantallas por rol, accesibilidad, seguridad del código | Tu computadora y CI | [completar] |
| `verificar_*` | Contra la base real: seguridad por filas, permisos, auditoría | VM1 (Jeison) | 77/77, 91/91, 84/84 (12-nov-2026) |
| Ensayo de la demostración | Recorrido completo contra producción | Jeison | 101/101 (12-nov-2026) |
| CI de seguridad | Bandit, Semgrep, pip-audit, npm audit, Gitleaks | GitHub Actions | [completar] |
| Análisis dinámico | OWASP ZAP, Nmap, pruebas manuales | Informe de noviembre | 0 alertas altas, medias ni bajas |

## Lista de revisión de código (completar)

| # | Qué revisar en cada PR | Por qué |
|---|---|---|
| 1 | ¿Toda ruta nueva pasa por el PDP y exige permisos? | Denegar por defecto: una ruta sin control queda abierta |
| 2 | [completar] |  |
| 3 | [completar] |  |
| 4 | [completar] |  |
| 5 | [completar] |  |
| 6 | [completar] |  |
| 7 | [completar] |  |
| 8 | [completar] |  |

## PR revisados

| PR | Fecha | Comentarios hechos |
|---|---|---|
| [completar] |  |  |
| [completar] |  |  |
