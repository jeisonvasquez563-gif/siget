# Evidencia del análisis estático y dinámico de SIGET

Respaldo del informe [`../Informe_Analisis_Estatico_Dinamico_SIGET.docx`](../Informe_Analisis_Estatico_Dinamico_SIGET.docx) (8 de noviembre de 2026).
Cada paso tiene su salida completa (`.txt`) y su captura (`.png`); las salidas largas se reparten en capturas numeradas (`_01`, `_02`, …).

| Carpeta | Qué contiene |
|---|---|
| [`antes/`](./antes/) | Etapa inicial: Bandit, Semgrep, pip-audit, npm audit y Gitleaks sobre el commit `14d3bd6`; Nmap, OWASP ZAP, verificación manual de la alerta de inyección SQL y pruebas con curl contra VM1 antes de corregir |
| [`correcciones/`](./correcciones/) | Pruebas del frontend y del backend antes y después de corregir, actualización de dependencias y despliegue de nginx en VM1 |
| [`despues/`](./despues/) | Las mismas herramientas con los mismos parámetros sobre el código corregido y la plataforma ya desplegada, más el ensayo de la demostración |
| [`herramientas/`](./herramientas/) | `captura.py` (ejecuta un comando y dibuja su salida real), `zap-plan.yaml` y `zap-plan-despues.yaml` (planes de ZAP) y `verificar_sqli.py` |

## Cómo se generaron las capturas

```bash
python docs/analisis-seguridad/herramientas/captura.py cmd <carpeta> <nombre> "<título>" -- <comando ...>
python docs/analisis-seguridad/herramientas/captura.py html <carpeta> <nombre> <reporte.html>
```

Requiere Playwright para Python (usa el Microsoft Edge instalado). La carpeta local donde están instaladas las herramientas se reemplaza por `<carpeta-herramientas>` (variable `CAPTURA_RUTA_HERRAMIENTAS`); los posibles secretos los oculta la propia herramienta (`--redact` en Gitleaks).

## Commits de las correcciones (rama `fix/analisis-estatico-dinamico`)

| Commit | Corrección |
|---|---|
| `caa5ae1` | Dependencias del frontend sin vulnerabilidades (npm audit) y escenario del simulador |
| `9158f45` | Hallazgos de Bandit (B108, B101, B106) y falsos positivos B105 justificados |
| `a91c0ea` | nginx solo acepta los nombres de host de la plataforma (Semgrep + prueba dinámica) |
| `73c39e7` | El ensayo genera su contraseña de prueba; `.gitleaksignore` con los hallazgos revisados |

## Aplicado en producción (VM1, 8-nov-2026)

| Cambio | Respaldo / vuelta atrás |
|---|---|
| `nginx.conf` con el `map` de nombres de host permitidos | `/home/siget/config/nginx.conf.respaldo-2026-11-08` |
| Imagen del backend reconstruida desde el commit corregido | imagen `localhost/siget-backend:respaldo-2026-11-08` |
| `/etc/httpd/conf.d/endurecimiento.conf`: `TraceEnable Off`, `ServerTokens Prod`, `ServerSignature Off` | borrar el archivo y `systemctl reload httpd` |
| `/etc/php.d/99-siget-endurecimiento.ini`: `expose_php = Off` | borrar el archivo y `systemctl restart php-fpm` |

## Recomendaciones que quedan

- Cookie de sesión del checkpoint PHP: agregar `session.cookie_httponly = 1`, `session.cookie_samesite = Strict` y `session.use_strict_mode = 1`. La medida definitiva es retirar el checkpoint y cerrar el puerto 80 (PT-13).
- Rotar la contraseña de PostgreSQL que guarda la configuración local del checkpoint (archivo ignorado por git).
