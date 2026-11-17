# Ciclo de vida de desarrollo seguro (SDLC seguro) en SIGET

Implementación en SIGET de las **ocho etapas** del SDLC seguro de Red Hat (*Seguridad en el ciclo de vida de desarrollo del software*, actualizado el 27-ago-2026). La organización del equipo, con lo que hace cada persona y el calendario, está en [`../SIGET_Organizacion_SDLC_Seguro.docx`](../SIGET_Organizacion_SDLC_Seguro.docx). Las mismas plantillas, listas para imprimir o repartir, están en [`../SIGET_Plantillas_SDLC_Seguro.docx`](../SIGET_Plantillas_SDLC_Seguro.docx).

**Estado (16-nov-2026): las 8 etapas están completas** con datos reales de SIGET y evidencia en [`evidencia/`](./evidencia/). Para preparar la presentación, cada integrante tiene su sección en la **guía de defensa** ([`../SIGET_Guia_de_Defensa_SDLC_Seguro.docx`](../SIGET_Guia_de_Defensa_SDLC_Seguro.docx)), con preguntas probables del profesor y sus respuestas.

| Etapa | Entregable | Responsable | Revisa |
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

## Resumen de resultados

| Etapa | Resultado |
|---|---|
| 1. Planificación | 23 riesgos evaluados; 13 con algo pendiente, ordenados para Jeison |
| 2. Requisitos | 26 requisitos (20 cumplen, 2 parciales, 4 no cumplen) y 11 artículos de las leyes 81 de 2019, 83 de 2012 y 6 de 2002 |
| 3. Diseño | 41 amenazas STRIDE en 6 componentes, con diagrama de flujo de datos: 23 mitigadas, 14 parciales, 4 abiertas |
| 4. Desarrollo | 14 reglas de codificación segura; CI de seguridad automático (PR #16, 5 controles en verde) y Dependabot |
| 5. Documentación | 43 controles inventariados y `SECURITY.md` completa |
| 6. Pruebas | Pruebas corridas (backend y frontend), lista de revisión de 10 ítems aplicada a los PR #10 y #12 |
| 7. Implementación | Revisión del entorno de VM1 y VM2: SELinux, SSH, cortafuegos, TLS 1.3 (A), contenedor sin root; 4 hallazgos |
| 8. Mantenimiento | Primera semana de supervisión, procedimiento ante intrusiones y línea base de parches (2 críticos por VM) |

## Cómo se trabaja

1. Desde `develop`, crear una rama: `docs/sdlc-01-riesgos`, `docs/sdlc-02-requisitos`, etc.
2. Completar la plantilla: lo que dice **[completar]** es lo que falta. Las filas de ejemplo ya resueltas se dejan.
3. Abrir un pull request a `develop` y pedir la revisión de la persona indicada en la tabla.
4. Si te trabás más de un día, avisá en el grupo.

**Nunca** se suben contraseñas, claves ni datos personales reales.
