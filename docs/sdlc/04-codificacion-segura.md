# Guía de codificación segura de SIGET

**Etapa 4: Desarrollo** · Responsable: **Andy Martínez** · Revisa: **Jeison Vásquez**

> Capacitar en prácticas de codificación segura, incorporar herramientas de prueba de seguridad al desarrollo y evaluar las dependencias. (Red Hat, *Seguridad en el ciclo de vida de desarrollo del software*.)

## Cómo completarla

1. Escribí entre 10 y 15 reglas, cada una con un ejemplo real de SIGET (el archivo donde se aplica). La primera está resuelta.
2. Explicá cómo leer un fallo de `security-scan.yml` y cuándo un `# nosec` o un `nosemgrep` está justificado (siempre con el motivo escrito al lado).
3. Prepará la charla de 20 minutos con esta guía.

## Reglas

| # | Regla | Ejemplo en SIGET |
|---|---|---|
| 1 | Las consultas SQL siempre con parámetros, nunca armando el texto con datos del usuario | `cursor.execute(sql, [valores])` en `apps/identidad/equipo.py` |
| 2 | [completar] |  |
| 3 | [completar] |  |
| 4 | [completar] |  |
| 5 | [completar] |  |
| 6 | [completar] |  |
| 7 | [completar] |  |
| 8 | [completar] |  |
| 9 | [completar] |  |
| 10 | [completar] |  |

## Herramientas del CI de seguridad

| Herramienta | Qué revisa | Qué hacer si falla |
|---|---|---|
| Bandit | Código Python del backend | [completar] |
| Semgrep | Todo el código (OWASP Top 10) | [completar] |
| pip-audit | Dependencias de Python | [completar] |
| npm audit | Dependencias del frontend | [completar] |
| Gitleaks | Secretos en el historial | [completar] |
