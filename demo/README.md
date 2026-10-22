# Herramientas de la demostración

Scripts de apoyo para preparar, ensayar y presentar la demostración. **No contienen credenciales:** las leen de
`demo-local/siembra.local.txt`, que genera `sembrar_demo` (ver `docs/runbook.md`) y **está ignorado por git**.

Todos usan el Python del backend (`backend/.venv/Scripts/python.exe`, que trae `pyotp`) y las VMs deben estar encendidas.

| Script | Para qué |
|---|---|
| `ensayo.py` | **Ensayo completo** del guion (`docs/demo-guion.md`) contra producción por HTTPS: preparación (hora, certificado, TLS 1.3, cabeceras), las 13 cuentas, MFA y su anti-repetición, auditoría, roles y permisos, simulador. ~3 minutos. Las escrituras las hace sobre trámites nuevos (no gasta los sembrados). |
| `codigo.py` | Muestra el código TOTP vigente de una cuenta (o de todas) para iniciar sesión sin celular. |
| `e2e.py` | Resumen rápido por rol: qué módulos y qué datos ve cada cuenta. |
| `capturar_fixtures.py` | Guarda la matriz de permisos y los privilegios de la base **reales** como datos de ejemplo del frontend. |
| `capturar_simulador.py` | Lo mismo para los escenarios del simulador. |

## Cosas que conviene saber

- **Un código TOTP no se acepta dos veces** (es la protección anti-repetición): si dos scripts entran con la misma cuenta en el mismo intervalo de 30 segundos, el segundo recibe 401. `ensayo.py` espera al siguiente intervalo antes de empezar.
- **Tres códigos incorrectos bloquean la cuenta 5 minutos.** No lances los scripts en bucle.
- El ensayo **deja datos** (un trámite aprobado y otros dos) porque el registro es inalterable; es lo esperado.
