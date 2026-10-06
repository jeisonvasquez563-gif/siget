# Datos clave de la investigación — ficha rápida para el equipo

Resumen de bolsillo de lo investigado para el [documento introductorio](./documento-introductorio.md) y los [antecedentes ampliados](./antecedentes.md). Sirve para citar rápido en presentaciones o preguntas del profesor. **Fecha de consulta de todas las fuentes: 6-oct-2026.** El detalle y la bibliografía APA completa están en esos dos documentos.

## Cifras que podemos citar

| Dato | Valor | Fuente |
|---|---|---|
| Tiempo promedio de un trámite en Panamá (2018) | 4,2 horas (región: 5,4) | BID, *El fin del trámite eterno* (Roseth, Reyes y Santiso, 2018); reseña de La Prensa (2018) |
| Procedimientos distintos | más de 3,000 | BID 2018 |
| Trámites que requieren 3 o más interacciones | 31 % (4.º de 18 países) | BID 2018 |
| Permisos de construcción pendientes (2015) | ~US$500 millones | TVN (2015) |
| Permisos: entidades involucradas (2017) | 19 instituciones, 60–90 trámites, 3–4 años | La Prensa / E&N (2017) |
| Solicitudes semanales al Municipio de Panamá (2025) | 1,700–2,000; US$809 millones pendientes | La Prensa (Mojica, 2025) |
| Panamá Conecta (lanzamiento 17-jun-2025) | US$149,000; 16 servicios; ~850,000 transacciones | La Estrella (Yangüez, 2025) |
| Aumento de intentos de ciberataque a plataformas estatales | +200 % a +500 % (según AIG) | La Estrella (2026) |

## Marco legal (artículos verificados contra el texto)

| Norma | Qué aporta a SIGET |
|---|---|
| Ley 38 de 2000 (G.O. 24109) | Art. 44: derecho a conocer el estado del trámite (respuesta en 5 días). Art. 40: plazo general de 30 días. Art. 201 num. 104: silencio administrativo, 2 meses = negada. |
| Ley 83 de 2012 (G.O. 27160) | Art. 4 num. 8: el "estado" de un trámite incluye actuaciones, contenido, fase, unidad responsable y fecha. Es lo que modela `EventoAuditoria`. |
| Ley 65 de 2009 (G.O. 26400-C) | Crea la AIG (Autoridad Nacional para la Innovación Gubernamental). |
| Ley 81 de 2019 | Protección de datos personales; vigente desde el 29-mar-2021 (multas B/.1,000–10,000). |
| Ley 6 de 2002 / Ley 33 de 2013 | Transparencia y ANTAI. |
| Acuerdo 110 de 22-abr-2025 (Municipio de Panamá) | Permiso digital de construcción: validación ≤3 días hábiles, emisión ≤5. Base del trámite "caso de prueba". |

## Cosas que el equipo debe saber antes de citar

- Gran parte de las cifras coyunturales vienen de **prensa panameña**, no de sitios oficiales; por eso la bibliografía las separa (sección 6.3). Si el profesor exige solo "sitios avalados", reforzar con fuentes oficiales.
- Los **plazos (SLA) del catálogo** (15 / 5 / 10 días) son **parámetros de diseño**, no plazos legales de las instituciones.
- El **cronograma** (10 semanas desde el 12-oct-2026) es un supuesto; ajustar al calendario real del semestre.
- Un artículo de La Prensa sobre "expedientes en revisión" (jun-2026) **no se pudo encontrar**, así que no se cita.
- El dato del BID es **4,2 horas**; la URL del informe dice "42-horas" por un error de slug.
- Los documentos entregados no deben mencionar herramientas de IA; mantener esa regla en futuras ediciones.

## Cómo se generan los `.docx`

Los `.docx` se generan con scripts de Node (paquete `docx`) que no están versionados; el `.md` es la fuente de verdad. Si hay que cambiar algo del `.docx`, editar el `.md` y regenerar o editar el Word directamente y sincronizar el `.md`.
