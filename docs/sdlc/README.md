# Ciclo de vida de desarrollo seguro (SDLC seguro) en SIGET

Implementación en SIGET de las **ocho etapas** del SDLC seguro de Red Hat (*Seguridad en el ciclo de vida de desarrollo del software*, actualizado el 27-ago-2026). La organización del equipo, con lo que hace cada persona y el calendario, está en [`../SIGET_Organizacion_SDLC_Seguro.docx`](../SIGET_Organizacion_SDLC_Seguro.docx). Las mismas plantillas, listas para imprimir o repartir, están en [`../SIGET_Plantillas_SDLC_Seguro.docx`](../SIGET_Plantillas_SDLC_Seguro.docx).

**Estado (actualizado el 26-nov-2026): las 8 etapas están completas** con datos reales de SIGET y evidencia en [`evidencia/`](./evidencia/). La primera versión es del 16-nov-2026; el 26-nov se actualizaron todas con lo hecho desde el 17-nov (PT-15, contenido del trámite, cambio de contraseña, notificaciones, alertas y catálogo). El resumen de todo lo hecho, con quién hizo y quién revisó cada parte, está en el **informe final** ([`../SIGET_Informe_Final_Trabajo_Realizado.docx`](../SIGET_Informe_Final_Trabajo_Realizado.docx)), que se genera con `generadores/generar-informe-final.js`. Para preparar la presentación, cada integrante tiene su sección en la **guía de defensa** ([`../SIGET_Guia_de_Defensa_SDLC_Seguro.docx`](../SIGET_Guia_de_Defensa_SDLC_Seguro.docx)), con preguntas probables del profesor y sus respuestas.

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
| 1. Planificación | 27 riesgos evaluados; 13 con algo pendiente (5 de nivel Alto y 8 de nivel Medio), ordenados para Jeison. Mitigados: R5 (parches, 16-nov), R8 y R24 (17-nov) y R22 (alertas, 26-nov); nuevos R25, R26 y R27 |
| 2. Requisitos | 26 requisitos (24 cumplen, 1 parcial, 1 no cumple) y 11 artículos de las leyes 81 de 2019, 83 de 2012 y 6 de 2002 (7 cumplen, 3 parciales, 1 no cumple). Los derechos del titular y el aviso de privacidad (Ley 81) se implementaron el 24-nov (PT-15) y las alertas el 26-nov (PT-10); queda RS-26, que depende del Registro Civil y de un servidor de correo, y la política de conservación de la Ley 81 |
| 3. Diseño | 62 amenazas STRIDE en 10 componentes, con diagrama de flujo de datos: 42 mitigadas, 19 parciales, 1 abierta (una sola persona con sudo en VM2). Las 21 nuevas son de las alertas, las notificaciones, el catálogo y el contenido del trámite |
| 4. Desarrollo | 19 reglas de codificación segura (las 5 nuevas salieron de los despliegues del 24 al 26-nov); CI de seguridad automático (PR #16, 5 controles en verde) y Dependabot |
| 5. Documentación | 57 controles inventariados (14 nuevos desde el 17-nov) y `SECURITY.md` completa |
| 6. Pruebas | Backend 1399 y frontend 424 pruebas en el último PR (#31); verificaciones contra la base real del último despliegue: `verificar_tramites` 214/214, `verificar_autenticacion` 200/200, `verificar_plataforma` 154/154, `verificar_equipo` 133/133, `verificar_politicas` 41/41, `verificar_auditoria` 34/34 y `verificar_integracion` 15/15; pruebas de la base con `ROLLBACK` (escalamiento 10, notificaciones 36, alertas 57, catálogo 82); ensayo de 119/119 contra producción; lista de revisión de 12 puntos (10 al aplicarla a los PR #10 y #12) |
| 7. Implementación | Revisión del entorno de VM1 y VM2 (16-nov): SELinux, SSH, cortafuegos, TLS 1.3 (A), contenedor sin root; 5 hallazgos, los 5 corregidos (regla del 5432, avisos críticos y Rocky 9.9 el 16-nov; repositorios pgdg y checkpoint PHP, pgAdmin web y puerto 80 retirados el 17-nov). Desde el 24-nov, seis cambios aplicados con respaldo, ensayo y la imagen verificada antes de reiniciar (rol `detector_role`, `pg_hba.conf` y `nginx.conf` editados en el mismo inodo) |
| 8. Mantenimiento | Supervisión: primera semana, procedimiento ante intrusiones y, desde el 26-nov, la consola de alertas con cuatro reglas y revisión con nota. Parches: de 2 críticos por VM (línea base) a 0 críticos y 0 pendientes tras actualizar a Rocky 9.9 el 16-nov; no se midió de nuevo después del 17-nov |

## Cómo se trabaja

1. Desde `develop`, crear una rama: `docs/sdlc-01-riesgos`, `docs/sdlc-02-requisitos`, etc.
2. Completar la plantilla: lo que dice **[completar]** es lo que falta. Las filas de ejemplo ya resueltas se dejan.
3. Abrir un pull request a `develop` y pedir la revisión de la persona indicada en la tabla.
4. Si te trabás más de un día, avisá en el grupo.

**Nunca** se suben contraseñas, claves ni datos personales reales.
