# Feriados de Panamá para los plazos en días hábiles

Los plazos de los trámites (`fecha_limite`) cuentan **días hábiles**: lunes a viernes que no sean feriado. Los feriados viven en la tabla `siget.feriado`, cargada por la migración [`013-plazos-y-escalamiento.sql`](../database/migraciones/013-plazos-y-escalamiento.sql). Fecha de consulta de las fuentes: 12 de noviembre de 2026.

## Base legal

- **Código de Trabajo, art. 46**, con el texto que le dio la **Ley 28 de 4 de mayo de 2015** (art. 18) y la modificación de la **Ley 291 de 31 de marzo de 2022** (art. 7). Son días de fiesta o duelo nacional: 1 de enero, 9 de enero, Martes de Carnaval, Viernes Santo, 1 de mayo, 3, 5, 10 y 28 de noviembre, y 8, 20 y 25 de diciembre. También el 1 de julio del año de la toma de posesión presidencial (el próximo es 2029).
- **Art. 47** (también según la Ley 28 de 2015): si uno de esos días cae **domingo**, el **lunes siguiente** es de descanso obligatorio. Si cae sábado no se traslada. Desde 2015 ya no hay «días puente».
- **No son feriados de ley:** el 4 de noviembre y el lunes de Carnaval. Algunos años el Ejecutivo cierra las oficinas públicas esos días por decreto; por ejemplo, el 4-nov-2026 según la prensa (Decreto Ejecutivo 27 de 2026, que no se pudo verificar en la Gaceta).

## Fechas cargadas

| 2026 | 2027 |
|---|---|
| 1-ene Año Nuevo | 1-ene Año Nuevo |
| 9-ene Día de los Mártires | 9-ene (sábado) |
| 17-feb Martes de Carnaval | 9-feb Martes de Carnaval |
| 3-abr Viernes Santo | 26-mar Viernes Santo |
| 1-may Día del Trabajador | 1-may (sábado) |
| 3, 5 y 10-nov | 3, 5 y 10-nov |
| 28-nov (sábado) | 28-nov (domingo) y **29-nov** lunes de descanso |
| 8-dic Día de las Madres | 8-dic Día de las Madres |
| 20-dic (domingo) y **21-dic** lunes de descanso | 20-dic Duelo Nacional |
| 25-dic Navidad | 25-dic (sábado) |

Las fechas de 2026 coinciden con el calendario publicado por la prensa. Las de 2027 se calcularon aplicando la ley, porque todavía no hay un calendario oficial publicado. Pascua cae el 5-abr-2026 y el 28-mar-2027; el Martes de Carnaval es Pascua menos 47 días y el Viernes Santo, Pascua menos 2.

## Mantenimiento (cada año)

1. Agregar los feriados del año siguiente con una migración nueva, verificando la Gaceta Oficial.
2. Revisar los **decretos de cierre de oficinas públicas** del año (lunes de Carnaval, 4 de noviembre, 24 y 31 de diciembre, feriados distritales). Si la institución no atiende ese día, cargarlo también: para un trámite del Estado es un día inhábil.
3. Los trámites ya creados conservan su fecha límite: un feriado nuevo solo afecta a los que se inicien después.

Pendiente: una pantalla para que el operador de catálogo mantenga el calendario con control dual (hoy se mantiene por migración).

## Referencias

Asamblea Nacional de Panamá. (2013). *Ley 118 de 27 de diciembre de 2013*. Gaceta Oficial Digital N.º 27443-A. https://www.gacetaoficial.gob.pa/pdfTemp/27443_A/GacetaNo_27443a_20131230.pdf

Asamblea Nacional de Panamá. (2015). *Ley 28 de 4 de mayo de 2015* (arts. 18 a 22: modifica los arts. 46, 47, 49 y 50 del Código de Trabajo). Gaceta Oficial N.º 27772-A. https://s3-legispan.asamblea.gob.pa/legispan/NORMAS/2010/2015/LEY/Administrador%20Legispan_27772-A_2015_5_4_ASAMBLEA%20NACIONAL_28.pdf

Asamblea Nacional de Panamá. (2022). *Ley 291 de 31 de marzo de 2022, que adopta medidas de concientización nacional sobre el 20 de diciembre de 1989*. Gaceta Oficial Digital N.º 29507-B. https://www.gacetaoficial.gob.pa/pdfTemp/29507_B/GacetaNo_29507b_20220331.pdf

Asamblea Nacional de Panamá. (2025). *Compendio de leyes sobre días históricos 1990–2025*. https://asamblea.gob.pa/Uploads/DocumentosCompartidos/242/Documento_Compendio_de_Leyes_sobre_dias_historicos_1990-_2025.pdf

Tuñón, E. (2025, 31 de diciembre). *Panamá tendrá 12 días feriados nacionales en 2026 según calendario oficial*. La Estrella de Panamá. https://www.laestrella.com.pa/panama/informacion-util/panama-tendra-12-dias-feriados-nacionales-en-2026-segun-calendario-oficial-HL18751879

Telemetro. (2026, 31 de octubre). *Días feriados de noviembre y diciembre de 2026: cuándo descansan los trabajadores*. https://www.telemetro.com/c6097161
