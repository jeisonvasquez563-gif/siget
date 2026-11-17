# Ciclo de vida de desarrollo seguro (SDLC seguro) en SIGET

Implementación en SIGET de las **ocho etapas** del SDLC seguro de Red Hat (*Seguridad en el ciclo de vida de desarrollo del software*, actualizado el 27-ago-2026). La organización del equipo, con lo que hace cada persona y el calendario, está en [`../SIGET_Organizacion_SDLC_Seguro.docx`](../SIGET_Organizacion_SDLC_Seguro.docx). Las mismas plantillas, listas para imprimir o repartir, están en [`../SIGET_Plantillas_SDLC_Seguro.docx`](../SIGET_Plantillas_SDLC_Seguro.docx).

| Etapa | Plantilla | Responsable | Revisa |
|---|---|---|---|
| 1. Planificación | [`01-registro-de-riesgos.md`](./01-registro-de-riesgos.md) | Simna De Gracia | Jeison Vásquez |
| 2. Análisis de requisitos | [`02-requisitos-de-seguridad.md`](./02-requisitos-de-seguridad.md) | Gabriel González | Simna De Gracia |
| 3. Diseño | [`03-modelo-de-amenazas.md`](./03-modelo-de-amenazas.md) | Joel Medina | Andy Martínez |
| 4. Desarrollo | [`04-codificacion-segura.md`](./04-codificacion-segura.md) | Andy Martínez | Jeison Vásquez |
| 5. Documentación | [`05-inventario-de-controles.md`](./05-inventario-de-controles.md) y [`../../SECURITY.md`](../../SECURITY.md) | Jorge Medina | Gabriel González |
| 6. Pruebas | [`06-plan-de-pruebas.md`](./06-plan-de-pruebas.md) | Bradley Morales | Joel Medina |
| 7. Implementación | [`07-revision-del-entorno.md`](./07-revision-del-entorno.md) | Jeison Vásquez | Andy Martínez |
| 8. Mantenimiento (supervisión) | [`08-bitacora-supervision.md`](./08-bitacora-supervision.md) | Anyurie Sánchez | Walter Sanjur |
| 8. Mantenimiento (parches) | [`08-bitacora-parches.md`](./08-bitacora-parches.md) | Walter Sanjur | Jeison Vásquez |

## Cómo se trabaja

1. Desde `develop`, crear una rama: `docs/sdlc-01-riesgos`, `docs/sdlc-02-requisitos`, etc.
2. Completar la plantilla: lo que dice **[completar]** es lo que falta. Las filas de ejemplo ya resueltas se dejan.
3. Abrir un pull request a `develop` y pedir la revisión de la persona indicada en la tabla.
4. Si te trabás más de un día, avisá en el grupo.

**Nunca** se suben contraseñas, claves ni datos personales reales.
