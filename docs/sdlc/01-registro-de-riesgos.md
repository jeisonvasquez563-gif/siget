# Registro de riesgos de SIGET

**Etapa 1: Planificación** · Responsable: **Simna De Gracia** · Revisa: **Jeison Vásquez**

> Evaluar los riesgos y el panorama de amenazas de SIGET y el impacto que tendría un incidente de seguridad. (Red Hat, *Seguridad en el ciclo de vida de desarrollo del software*.)

## Cómo completarla

1. Leé `docs/antecedentes.md` (incidentes reales en Panamá) y la sección «Riesgos» de `docs/superpowers/specs/2026-10-21-pendientes-design.md`.
2. Las primeras 5 filas son ejemplos resueltos: usalas como modelo y no las borres.
3. Agregá al menos 10 riesgos más (en total, 15 o más).
4. Probabilidad e impacto: **Baja / Media / Alta**. Nivel = el mayor de los dos (si alguno es Alta, el nivel es Alto).
5. En «Control en SIGET» poné qué lo reduce y dónde se ve (archivo, prueba o documento). Si no hay control, escribí **pendiente**.
6. Ideas para buscar riesgos: robo de contraseñas, acceso de una institución a trámites de otra, pérdida de la base, caída de una VM, documentos con malware, un funcionario que altera un trámite, una clave filtrada, un parche que no se aplicó.

## Matriz de riesgos

| # | Riesgo (qué puede pasar) | Afecta a | Probabilidad | Impacto | Nivel | Control en SIGET (dónde se ve) |
|---|---|---|---|---|---|---|
| R1 | Alguien adivina o roba la contraseña de un funcionario | Trámites de su institución | Media | Alta | Alto | Segundo factor obligatorio para el personal; bloqueo progresivo tras 3 fallos (`verificar_autenticacion`) |
| R2 | Un funcionario del MOP intenta ver un trámite del MINSA | Confidencialidad entre instituciones | Media | Alta | Alto | Seguridad por filas en PostgreSQL y PDP (`verificar_tramites`, «quién ve qué») |
| R3 | Se pierde la base de datos (falla del disco, error humano) | Todos los trámites y la auditoría | Baja | Alta | Alto | Respaldo diario con restauración probada (runbook 32) |
| R4 | Un ciudadano sube un ejecutable disfrazado de PDF | Funcionarios que lo descarguen | Media | Media | Medio | Validación por contenido y descarga siempre como adjunto (PT-8) |
| R5 | No se aplican los parches de seguridad del sistema | Las dos VMs | Alta | Alta | Alto | **pendiente**: 170 y 177 avisos sin aplicar (informe de mantenimiento) |
| R6 | [completar] |  |  |  |  |  |
| R7 | [completar] |  |  |  |  |  |
| R8 | [completar] |  |  |  |  |  |
| R9 | [completar] |  |  |  |  |  |
| R10 | [completar] |  |  |  |  |  |
| R11 | [completar] |  |  |  |  |  |
| R12 | [completar] |  |  |  |  |  |
| R13 | [completar] |  |  |  |  |  |
| R14 | [completar] |  |  |  |  |  |
| R15 | [completar] |  |  |  |  |  |

## Riesgos pendientes para Jeison

Copiá aquí los riesgos marcados como «pendiente», ordenados del nivel más alto al más bajo.
