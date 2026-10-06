# Documentación — SIGET

La documentación "viva" del proyecto vive acá en Markdown, versionada junto con el código. Los `.docx` se mantienen aparte solo como formato de entrega formal (para compartir con el profesor o imprimir) — si hay alguna diferencia entre un `.docx` y su equivalente `.md`, **el `.md` es la fuente de verdad** porque es el que se sigue actualizando.

| Documento | Contenido |
|---|---|
| [`architecture/spec.md`](./architecture/spec.md) | Especificación técnica: problemática, infraestructura, stack, modelo de datos. La base de todas las decisiones. |
| [`architecture/plan.md`](./architecture/plan.md) | Plan de trabajo: orden de ejecución por fases, estado real de cada punto, próximos pasos. |
| [`runbook.md`](./runbook.md) | Paso a paso técnico completo de todo lo ejecutado: VMs, red, SSH, firewall, checkpoint de BD/Apache. |
| [`informe-avance.md`](./informe-avance.md) | Resumen ejecutivo: qué se hizo, decisiones técnicas, estado actual, pendientes y riesgos. |
| [`demo-comandos.md`](./demo-comandos.md) | Guion de comandos para hacer una demo en vivo (túnel SSH, verificación de infraestructura, app SIGET, pgAdmin). |
| [`capturas-evidencia.md`](./capturas-evidencia.md) | Comandos organizados por tema para que cada integrante del grupo tome su propia captura de la configuración (red, SELinux, firewall, servicios, BD, app). |
| `Antecedentes_SIGET.docx` | Documento de antecedentes del proyecto (entrega solicitada por el profesor): contexto de los trámites en Panamá, marco normativo, transformación digital del Estado, ciberseguridad en el sector público, brechas y justificación de SIGET, con bibliografía en formato APA de fuentes panameñas. Su versión editable es el propio `.docx`. |
| `Runbook_SIGET.docx` / `Informe_Avance_SIGET.docx` | Versiones formales en Word de los dos documentos de arriba, para entrega. |
| `Comandos_Demo_SIGET.txt` | Versión en texto plano del guion de demo (previa a la conversión a Markdown). |
