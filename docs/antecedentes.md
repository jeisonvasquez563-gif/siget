> Versión en Markdown de `Antecedentes_SIGET.docx` (versión ampliada de los antecedentes). Fecha de consulta de las fuentes: 6-oct-2026.

**ANTECEDENTES DEL PROYECTO** 
**SIGET** 
**Sistema de Gestión y Trazabilidad** 
**Marco contextual, normativo y tecnológico de la gestión de trámites ante el Estado panameño** 
**Ciberseguridad 5 — Universidad Tecnológica de Panamá (UTP)** 
**Elaborado por: Jeison Vásquez — Grupo Ciber5** 
***Octubre de 2026*** 

## Resumen

Este documento presenta los antecedentes del proyecto **SIGET — Sistema de Gestión y Trazabilidad**, una propuesta académica desarrollada en el marco de Ciberseguridad 5 (UTP). Su objetivo es contribuir a la **trazabilidad y la transparencia en el seguimiento de trámites ante el Estado panameño**, empleando la seguridad de la información como método para que ese seguimiento sea confiable.

A partir de una revisión documental de prensa panameña, sitios oficiales y normativa vigente, se describen cuatro bloques: (1) la magnitud y complejidad de los trámites públicos y los retrasos que los afectan, con énfasis en los permisos de construcción; (2) el marco jurídico que ya reconoce el derecho de las personas a conocer el estado de sus trámites; (3) los esfuerzos de transformación digital del Estado —entre ellos Panamá Conecta, el sistema 311 y la Alcaldía Digital—; y (4) el aumento de los incidentes de ciberseguridad en instituciones públicas entre 2025 y 2026. El documento concluye identificando las brechas que justifican el proyecto y la forma en que su diseño responde a ellas.

**Palabras clave:** trámites gubernamentales, trazabilidad, transparencia, gobierno digital, ciberseguridad, Panamá.

## 1. Introducción

### 1.1 Objetivo del proyecto

SIGET aborda un problema que es, en esencia, un problema público antes que técnico: las personas y las empresas que inician un trámite ante una institución del Estado con frecuencia no pueden saber con precisión en qué etapa se encuentra, quién es el responsable de resolverlo ni cuánto tiempo ha transcurrido; el expediente puede permanecer “en revisión” sin que el retraso tenga consecuencias visibles. Las secciones siguientes documentan la evidencia disponible sobre esta situación.

El proyecto propone un sistema que (a) registre de forma inmutable cada actuación realizada sobre un trámite, (b) haga exigibles plazos de atención (SLA) por tipo de trámite, (c) escale automáticamente a un supervisor los trámites vencidos y (d) permita al solicitante consultar el estado de su trámite en cualquier momento. La seguridad —aislamiento de red, control de acceso por roles, autenticación multifactor y una auditoría que no puede alterarse— es el **mecanismo que garantiza que la trazabilidad sea confiable**; no es el tema del proyecto en sí.

### 1.2 Objetivo y alcance de este documento

Este documento reúne los antecedentes que respaldan el proyecto y responde tres preguntas:

- ¿Qué se ha documentado en Panamá sobre la complejidad, los retrasos y la falta de seguimiento de los trámites públicos?
- ¿Qué normativa respalda el derecho a conocer el estado de un trámite y la digitalización de los procedimientos?
- ¿Qué iniciativas tecnológicas existen y qué riesgos de seguridad enfrentan hoy las instituciones públicas que las operan?

No pretende ser un estudio estadístico exhaustivo ni asesoría jurídica: es una revisión documental que fundamenta la pertinencia del proyecto.

### 1.3 Metodología

La información se recopiló mediante revisión documental, con fecha de consulta del **6 de octubre de 2026**, priorizando fuentes panameñas en este orden: (a) texto de la normativa en repositorios oficiales (Legispan de la Asamblea Nacional y compilaciones de la Gaceta Oficial); (b) sitios de instituciones públicas (Municipio de Panamá, Ministerio Público); (c) prensa panameña (La Prensa, La Estrella de Panamá, Panamá América y TVN Noticias); y (d) publicaciones académicas de la UTP. Se usaron fuentes complementarias no panameñas (Security Affairs, Derechos Digitales, DPL News) únicamente cuando no se halló un equivalente local, y así se indica.

Las cifras de prensa se citan con su autor y fecha, y no fueron auditadas de forma independiente. Para la normativa se contrastó el texto del articulado (Ley 38 de 2000 y Ley 83 de 2012) y no únicamente resúmenes. Las citas siguen el formato APA 7.ª edición; la bibliografía completa se encuentra al final.

## 2. El problema: trámites, burocracia y falta de seguimiento en Panamá

### 2.1 Magnitud y complejidad de los trámites

En 2018, el informe *El fin del eterno trámite* del Banco Interamericano de Desarrollo (BID), reseñado por La Prensa, indicó que realizar un trámite en Panamá toma en promedio **4,2 horas** (frente a 5,4 horas en la región), que el país mantiene **más de 3,000 procedimientos distintos** y que el **31 %** de ellos requiere tres o más interacciones para concluirse, lo que colocaba a Panamá en el cuarto lugar entre 18 países latinoamericanos en ese indicador (La Prensa, 2018). El mismo reporte señalaba que las personas de menores ingresos acceden a menos servicios por el tiempo, el transporte y las fotocopias que implica cada gestión, y que Panamá contaba entonces con 120 trámites en línea (frente a 30 anteriormente) con la meta de llegar a 450 a finales de 2019.

### 2.2 Costo económico e institucional

En septiembre de 2024, la Cámara de Comercio, Industria y Agricultura de Panamá solicitó acelerar la digitalización de los procesos públicos, al sostener que la falta de sistemas y procedimientos digitalizados genera sobrecostos, retrasos en pagos y complicaciones que afectan tanto a la empresa privada como a los servicios públicos. El gremio destacó como casos de modernización al Tribunal Electoral, la Autoridad del Tránsito y Transporte Terrestre y la Autoridad de Pasaportes, y planteó que la digitalización mejora la eficiencia y la transparencia de la administración (Panamá América, 2024).

En la misma línea, De Puy (2024) describe la burocracia como “uno de los mayores obstáculos” para el desarrollo, caracterizada por procedimientos engorrosos, retrasos innecesarios y falta de coordinación entre instituciones, y propone simplificar y digitalizar los trámites y promover la transparencia administrativa.

### 2.3 Caso de estudio: los permisos de construcción

Los permisos de construcción ilustran con claridad el problema, porque involucran a múltiples instituciones y tienen un impacto económico directo. La siguiente tabla resume lo documentado entre 2015 y 2026.

**Tabla 1. Evolución documentada de los trámites de permisos de construcción (2015–2026)**

| Año | Hallazgo | Fuente |
|---|---|---|
| 2015 | Planos pendientes por unos US$500 millones en valor declarado de obras. Alrededor de ocho instituciones más el Municipio de Panamá intervienen en la revisión. El alcalde reconoció que el proceso “siempre ha sido demorado y lento” y planteó la necesidad de digitalizar procesos. | TVN Noticias (2015) |
| 2017 | El promotor debe cumplir trámites en 19 instituciones, entre 60 y 90 trámites según el tipo de proyecto (dato de Convivienda). Los plazos pasaron de unos dos años a tres o cuatro. La aprobación de planos tomaba de 5 a 9 meses en 7 entidades. El sector aporta US$8,824 millones al PIB (16 %). | La Prensa (2017) |
| 2025 | El Municipio de Panamá recibe entre 1,700 y 2,000 solicitudes semanales (permisos, planos y sanciones). Los procedimientos son predominantemente manuales, con esperas de meses e incluso más de un año, y se señala falta de transparencia sobre dónde se estancan los trámites. De enero a abril de 2025 se aprobaron US$190 millones en permisos, con US$809 millones pendientes. | Mojica (2025) |
| 2025 | El Acuerdo N.° 110 del 22 de abril de 2025 habilita el Permiso Digital de Construcción en la plataforma Alcaldía Digital: validación del cálculo en un plazo no mayor de 3 días hábiles (Art. 133) y emisión del permiso en no más de 5 días hábiles desde el pago de la tasa (Art. 135). | Municipio de Panamá (2026) |
| 2026 | Se propone una Ventanilla Única y la figura del curador urbano. Se describen revisiones secuenciales entre instituciones, traslados repetitivos, revisiones duplicadas y falta de capacidad técnica en municipios pequeños. Se citan 1,524 planos recibidos por el Municipio de Panamá en 2026 y 37,000 empleos perdidos en construcción entre 2018 y 2025; el país tiene 81 municipios. | La Prensa (2026) |

Fuente: elaboración propia a partir de las fuentes indicadas. Las cifras son las reportadas por cada fuente.

Del recorrido se desprende un patrón: la lentitud no se debe a un único trámite, sino a la **suma de revisiones sucesivas** en varias instituciones, con poca visibilidad del punto exacto en que se encuentra cada expediente. La digitalización reciente del Municipio de Panamá (Acuerdo N.° 110) fija plazos cortos para etapas concretas, lo que refuerza la idea de que los plazos exigibles y medibles son una herramienta posible.

### 2.4 Seguimiento ciudadano: el sistema 311

El Centro de Atención Ciudadana 311, administrado por la Autoridad Nacional para la Innovación Gubernamental (AIG), registra quejas, denuncias y sugerencias y las remite a las entidades responsables (Domínguez et al., 2017). Un estudio de estudiantes de la UTP sobre reportes ciudadanos señaló que el sistema presentaba **falta de transparencia**, porque los reportes no se dan a conocer al público y solo quien reporta puede seguir su caso mediante un número asignado, y que algunas entidades mostraban **bajos porcentajes de atención** (Domínguez et al., 2017). La Tabla 2 reproduce los datos de abril de 2016 que ese estudio toma del propio portal 311.

**Tabla 2. Gestión de casos del sistema 311 por entidad, abril de 2016**

| Entidad | Casos creados | % de casos atendidos |
|---|---|---|
| IDAAN | 8,172 | 66 % |
| MOP | 136 | 11 % |
| MiAmbiente | 134 | 40 % |
| MINSA | 531 | 22 % |
| CSS | 129 | 62 % |
| ENA | 18 | 56 % |

Fuente: Domínguez et al. (2017), con datos de 311.gob.pa. Son cifras históricas (2016) y se presentan como antecedente, no como estado actual.

Como contrapunto, el Ministerio Público informó en 2019 que su Oficina de Atención Ciudadana fue evaluada con 100 % en la revisión de casos atendidos mediante el 311, bajo supervisión de un oficial de calidad de la AIG (Ministerio Público de Panamá, 2019). La diferencia entre entidades sugiere que el desempeño depende de la institución y que contar con un registro verificable permite medirlo.

Como indicador del volumen de reclamos ciudadanos ante el Estado, la Defensoría del Pueblo procesó 7,597 solicitudes en 2024 (2,021 quejas y 4,484 orientaciones) y mantenía 391 investigaciones abiertas a inicios de 2025 (Rodríguez Morán, 2025). Estas cifras abarcan materias más amplias que los trámites administrativos y se incluyen solo como contexto.

### 2.5 Síntesis del problema

- **Multiplicidad y secuencialidad:** muchos procedimientos, varias instituciones y revisiones por etapas.
- **Procesos manuales:** esperas de meses o años donde subsisten expedientes en papel.
- **Poca visibilidad del estado:** el interesado no siempre puede saber la etapa, el responsable ni el tiempo transcurrido.
- **Desempeño desigual entre instituciones**, difícil de medir sin un registro común.
- **Costo económico:** retrasos que afectan inversión, empleo y precios finales (Panamá América, 2024; La Prensa, 2017; Mojica, 2025).

## 3. Marco normativo panameño relevante

Una conclusión importante de la revisión es que **SIGET no inventa un derecho nuevo: operacionaliza uno que la ley panameña ya reconoce**. La Tabla 3 resume las normas más pertinentes; los números de artículo de las leyes 38 y 83 se verificaron contra el texto del articulado.

**Tabla 3. Normas relevantes para la trazabilidad y la seguridad de los trámites**

| Norma | Contenido relevante | Relación con SIGET |
|---|---|---|
| Ley 38 de 31 de julio de 2000 Procedimiento Administrativo General (G. O. 24109) | Art. 34: las actuaciones administrativas se rigen por celeridad, eficacia, economía y legalidad. Art. 40: respuesta a peticiones dentro de los 30 días siguientes a su presentación, salvo excepciones. Art. 44: toda persona tiene derecho a conocer el estado en que se encuentra la tramitación, y la entidad debe informarlo en 5 días; si no puede resolver en el término legal, debe exponer las razones de la demora. Art. 70: acceso al expediente para las partes interesadas. Art. 201, num. 104 (glosario): el silencio administrativo se configura cuando la administración no contesta en dos meses; se entiende negada la petición y se abre la vía contencioso-administrativa (Asamblea Legislativa de Panamá, 2000). | Fundamento del derecho a conocer el estado del trámite y de los plazos exigibles. Muestra que, por regla general, el silencio es negativo (se entiende denegado), no aprobatorio. |
| Ley 83 de 9 de noviembre de 2012 Medios electrónicos en trámites gubernamentales (G. O. 27160) | Art. 2, num. 5 (transparencia): el interesado podrá conocer en todo momento el estado de su trámite. Art. 4, num. 8: servicio electrónico de acceso restringido para consultar el estado, que comprende las actuaciones realizadas, su contenido, la fase de la gestión, la unidad responsable y la fecha de cada una. Art. 3: define el expediente electrónico. Art. 15: crea el Sistema Nacional de Interoperabilidad y de Seguridad. Art. 18: planes anuales de simplificación de trámites (Asamblea Nacional de Panamá, 2012). | Define casi literalmente lo que un registro de trazabilidad debe contener (actuación, fase, responsable, fecha). Es la base legal más directa del modelo de eventos de auditoría. |
| Ley 144 de 15 de abril de 2020 | Modifica la Ley 83 de 2012 y hace obligatorio el uso de medios electrónicos en los trámites gubernamentales, de forma gradual según el cronograma anual de la AIG; prevé sanciones a servidores que incumplan (descuento de hasta 30 % del salario o destitución), según Panamá América (2020b). | Respalda la digitalización obligatoria y el seguimiento electrónico de los trámites. |
| Ley 6 de 2002 y Ley 33 de 25 de abril de 2013 | La Ley 6 regula la transparencia y el acceso a la información pública; la Ley 33 crea la Autoridad Nacional de Transparencia y Acceso a la Información (ANTAI). En el monitoreo de abril de 2017, 12 de 111 instituciones tenían cero información de transparencia en sus sitios y 26 (23 %) cumplían al 100 % (Gordón Guerrel, 2017). | Muestra que la transparencia activa requiere verificación periódica, que un registro auditable facilita. |
| Ley 5 de 11 de enero de 2007 Apertura de empresas (G. O. 25709) | Agiliza el proceso de apertura de empresas; base de la plataforma Panamá Emprende (Asamblea Nacional de Panamá, 2007). | Antecedente del trámite de registro empresarial incluido en el catálogo del proyecto. |
| Ley 81 de 26 de marzo de 2019 Protección de datos personales | Vigente desde el 29 de marzo de 2021 y reglamentada por el Decreto Ejecutivo 285 de 28 de mayo de 2021. Exige establecer protocolos de seguridad para los datos que se almacenen, procesen o transmitan; prevé multas de B/. 1,000 a B/. 10,000 (RSM Panamá, s. f.). Precedente: en noviembre de 2020, ANTAI anunció que remitiría al Ministerio Público una denuncia por la venta de bases de datos personales (Panamá América, 2020a). | Un sistema de trámites concentra datos personales; la ley obliga a protegerlos con medidas técnicas y organizativas. |
| Decreto Ejecutivo 36 de 7 de mayo de 2026 G. O. 30520-A | Declara las tecnologías emergentes como áreas de seguridad nacional y crea la Comisión Nacional para Tecnologías Críticas y Emergentes, presidida por el Ministerio de la Presidencia (La Estrella de Panamá, 2026b). | Refleja la prioridad estatal de proteger plataformas digitales críticas. |
| Estrategia Nacional de Ciberseguridad 2021–2024 Resolución N.° 17 de la AIG (G. O. 29434-A) | Publicada el 15 de diciembre de 2021; actualiza la estrategia de 2013 y se estructura en cuatro pilares: proteger la privacidad y los derechos de los ciudadanos, disuadir y castigar el comportamiento criminal, fortalecer la seguridad e infraestructura crítica, y fomentar una cultura nacional de ciberseguridad (Lara, 2024). | Marco de política pública en el que se inscribe la dimensión de seguridad del proyecto. |
| Acuerdo N.° 110 de 22 de abril de 2025 Municipio de Panamá | Regula el Permiso Digital de Construcción, la Autorización Transitoria de Construcción y el Permiso Digital de Ocupación (Municipio de Panamá, 2026). | Antecedente directo del trámite de permiso de construcción que el proyecto toma como caso de prueba. |

Fuente: elaboración propia a partir de los textos y fuentes citados.

**Nota:** La numeración de artículos se verificó en las compilaciones consultadas (Legispan y Justia Panamá). Antes de citar una disposición con fines jurídicos, se recomienda confirmar su vigencia y texto en la Gaceta Oficial.

## 4. Transformación digital del Estado panameño

### 4.1 La AIG y la agenda digital

La Autoridad Nacional para la Innovación Gubernamental (AIG), creada por la Ley 65 de 2009 y modificada por la Ley 83 de 2012, es el ente rector de la agenda digital. Según DPL News (2022a), la agenda se organiza en seis ejes: gobernanza, marco normativo, infraestructura digital, articulación territorial, gestión de datos y ciberseguridad. En agosto de 2025, el administrador de la AIG declaró la meta de que Panamá sea “uno de los 40 países del mundo más digitalizados” en 2027, y ubicó la posición actual del país entre los puestos 50 y 70 (TVN Noticias, 2025).

### 4.2 Plataformas existentes

**Tabla 4. Principales plataformas y sistemas de trámites digitales**

| Plataforma | Descripción y datos disponibles | Fuente |
|---|---|---|
| PanamáTramita | La Ley 83 de 2012 designa a www.panamatramita.gob.pa como sede administrativa electrónica oficial para la prestación de servicios y la relación con los usuarios. | Asamblea Nacional (2012) |
| Sistema 311 (Centro de Atención Ciudadana) | Punto único de contacto para quejas, denuncias, sugerencias y consultas, con línea telefónica y portal web; permite dar seguimiento mediante número de caso. | Domínguez et al. (2017) |
| Panamá Digital (2022) | Portal único del ciudadano. La AIG y el Banco Hipotecario digitalizaron 12 trámites de financiamiento de vivienda, con más de 39,000 clientes del banco beneficiados. | DPL News (2022b) |
| Panamá Conecta (17 de junio de 2025) | Plataforma web, aplicación y canal 311 que centraliza trámites. Inició con Ifarhu, Mitradel, Ampyme, DIJ, Cancillería, Minsa, Siacap, Anati y el 311. Primera etapa: US$149,000. En agosto de 2025 reportaba 16 servicios y cerca de 850,000 transacciones, con metas de 100 servicios a corto plazo y 385 a largo plazo. | Yangüez (2025); TVN Noticias (2025) |
| Alcaldía Digital / Permiso Digital de Construcción (2025) | Plataforma del Municipio de Panamá para tramitar el permiso de construcción en línea, con plazos de 3 y 5 días hábiles para etapas definidas. | Municipio de Panamá (2026) |
| Panamá Emprende y registro de AMPYME | La Ley 5 de 2007 agiliza la apertura de empresas. En 2025, AMPYME reportó un aumento de 23 % en el registro de sociedades de emprendimiento, con la expectativa de superar las 1,000; costo de US$230, sin necesidad de abogado y con exención del impuesto sobre la renta durante los dos primeros años. | García Armuelles (2025) |

Fuente: elaboración propia a partir de las fuentes indicadas.

### 4.3 Lo que estas plataformas resuelven y lo que dejan abierto

Las plataformas descritas avanzan en **digitalizar la entrada** del trámite (solicitar, adjuntar y pagar) y en **concentrar el acceso** del ciudadano en un solo lugar. En las fuentes consultadas no se encontró información pública que describa registros de auditoría inmutables de cada actuación ni mecanismos automáticos de escalamiento cuando un trámite excede su plazo. Esto no prueba que no existan, pero sí indica que no forman parte del discurso público sobre estas plataformas, y es precisamente el espacio que SIGET busca explorar.

## 5. Ciberseguridad en el sector público panameño

Un sistema de trazabilidad solo es útil si su registro es íntegro, está disponible y protege los datos de las personas. Por eso es relevante el entorno de amenazas que enfrentan hoy las instituciones públicas.

### 5.1 Incidentes recientes

**Tabla 5. Incidentes de ciberseguridad en instituciones públicas (2025–2026)**

| Fecha | Institución | Incidente reportado | Fuente |
|---|---|---|---|
| Sep. 2025 | Ministerio de Salud (Minsa) | Exposición de nombres de usuario, contraseñas, correos electrónicos y cédulas de identidad. | Fernández Aguilar (2026) |
| Sep. 2025 | Ministerio de Economía y Finanzas (MEF) | Software malicioso detectado en una estación de trabajo. El grupo INC Ransom alegó haber sustraído más de 1.5 TB (correos, presupuestos y documentos financieros). El MEF informó que sus plataformas centrales no fueron comprometidas. | Security Affairs (2025); Fernández Aguilar (2026) |
| Mar. 2026 | Caja de Seguro Social (CSS) | Amenaza cibernética detectada en su plataforma tecnológica. | Fernández Aguilar (2026) |
| Abr. 2026 | Contraloría General de la República | Publicación de imágenes no autorizadas en su cuenta oficial de Instagram. | Fernández Aguilar (2026) |
| 2026 | Panamá Emprende y Ministerio de Trabajo (junto con CSS, Minsa y MEF) | Incluidos entre los cinco incidentes de alto impacto que la AIG atendió en los meses previos a mayo de 2026. | La Estrella de Panamá (2026a) |
| Ago. 2026 | Metro de Panamá | Incidente de ciberseguridad en parte de su infraestructura tecnológica; se activaron protocolos de contención y se inició una investigación técnica para determinar el alcance. | EFE y Panamá América (2026) |

Fuente: elaboración propia a partir de las fuentes indicadas. Los incidentes se citan según lo informado públicamente; el alcance de varios de ellos continuaba bajo investigación.

### 5.2 Tendencia y causas señaladas

En mayo de 2026, el administrador de la AIG afirmó que el aumento de los intentos de ataque había sido “exponencial”, con incrementos de 200 %, 300 % y hasta 500 % en los últimos seis meses, y que el Estado no realizó pagos a organizaciones criminales para recuperar datos (La Estrella de Panamá, 2026a). Según La Prensa, en 2025 los intentos o sospechas de fraude se estimaron en cerca de US$125 millones, con unos US$20 millones concretados (Fernández Aguilar, 2026).

Entre las causas que el mismo reportaje atribuye a la situación están las deficiencias históricas en ciberseguridad gubernamental, el descuido en la protección de bases de datos de usuarios, la escasez de profesionales capacitados en el sector público y la relevancia geopolítica del país por el Canal y la actividad portuaria (Fernández Aguilar, 2026).

### 5.3 Respuesta del Estado

- **Inversión y estructura:** la AIG anunció una inversión de US$6 millones en ciberseguridad (más de US$20 millones en total estatal), el fortalecimiento del equipo nacional de respuesta a incidentes (CSIRT), la creación de un Centro de Operaciones de Ciberseguridad del Estado y el monitoreo de 15 instituciones críticas (La Estrella de Panamá, 2026a).
- **Estándares mínimos:** la AIG anunció una resolución con estándares mínimos obligatorios de ciberseguridad para las instituciones (La Estrella de Panamá, 2026a).
- **“Escudo tecnológico”:** medidas como autenticación multifactor obligatoria, verificación en dos pasos para accesos remotos, parchado y actualización de sistemas, pruebas de penetración, segmentación de redes, protección contra malware y refuerzo del correo institucional frente al phishing (Concepción, 2026).
- **Marco normativo:** Decreto Ejecutivo 36 de 2026 y Estrategia Nacional de Ciberseguridad 2021–2024 (sección 3).

### 5.4 Implicación para un sistema de trazabilidad

Las medidas anunciadas por el Estado coinciden con los controles que SIGET incorpora desde su diseño: autenticación multifactor, segmentación de red, control de acceso por roles y protección de las credenciales. La experiencia de los incidentes de 2025 y 2026 muestra además que **un registro de trámites debe poder demostrar que no fue alterado**, por lo que la integridad de la auditoría es un requisito de diseño y no un complemento.

## 6. Brechas identificadas

La Tabla 6 sintetiza las brechas que la revisión permitió identificar y la respuesta prevista por el proyecto.

**Tabla 6. Brechas identificadas y respuesta de SIGET**

| Brecha | Evidencia | Respuesta de SIGET |
|---|---|---|
| Poca visibilidad del estado del trámite | El derecho existe en la ley (Ley 38, Art. 44; Ley 83, Art. 2 y 4). En el 311, los reportes no son públicos y el seguimiento es limitado (Domínguez et al., 2017). En permisos se señala falta de transparencia sobre dónde se estancan los trámites (Mojica, 2025). | Consulta del estado por el solicitante y registro de cada actuación con su fase, responsable y fecha. |
| Plazos sin consecuencia visible | Esperas de meses o años en permisos (Mojica, 2025; La Prensa, 2017). El silencio administrativo, por regla general, equivale a una negativa tras dos meses (Ley 38, Art. 201). | Fecha límite (SLA) por tipo de trámite y escalamiento automático a un supervisor con notificación cuando se vence. |
| Fragmentación entre instituciones | 19 instituciones y revisiones secuenciales (La Prensa, 2017); propuesta de Ventanilla Única (La Prensa, 2026). | Un motor genérico de trámites con máquina de estados, reutilizable por distintas instituciones sin lógica especial por tipo. |
| Integridad del registro | Incidentes de seguridad en entidades públicas (Tabla 5); una trazabilidad que puede alterarse pierde valor. | Registro de eventos de solo inserción: el rol de la aplicación no puede actualizar ni borrar, con un disparador de defensa adicional; el cambio de estado y su evento se guardan en una misma transacción. |
| Protección de datos y accesos | Exposición de credenciales y cédulas (Minsa); Ley 81 de 2019; aumento de intentos de ataque (La Estrella de Panamá, 2026a). | Contraseñas con Argon2, tokens de corta duración, MFA obligatorio para roles internos, RBAC, cifrado entre aplicación y base de datos, secretos fuera del código y red interna aislada. |
| Desempeño desigual y difícil de medir | Variación entre entidades en el 311 (Tabla 2). | El registro de eventos permite, como trabajo futuro, calcular indicadores de cumplimiento de plazos por institución. |

Fuente: elaboración propia.

## 7. Justificación y enfoque del proyecto SIGET

### 7.1 Objetivos

**Objetivo general.** Diseñar e implementar un sistema que permita dar seguimiento trazable y verificable a los trámites ante el Estado, con seguridad aplicada como método.

**Objetivos específicos.**

- Registrar cada cambio de estado de un trámite como un evento de auditoría que no pueda modificarse ni eliminarse.
- Validar las transiciones de estado contra una tabla de transiciones permitidas, nunca libres.
- Calcular la fecha límite de atención y escalar automáticamente los trámites vencidos.
- Aplicar controles de seguridad por capas: aislamiento de red, SELinux en modo enforcing, contenedores sin privilegios de administrador (Podman rootless), autenticación multifactor y control de acceso por roles.

### 7.2 Alineación con la normativa

El estado de un trámite que la Ley 83 de 2012 (Art. 4, num. 8) exige poder consultar —actuaciones realizadas, su contenido, la fase, la unidad responsable y la fecha— es el nivel de detalle que el modelo de eventos de auditoría de SIGET debe permitir reconstruir: el modelo de datos prevé que cada cambio de estado genere un evento cuyos campos se definirán para registrar qué ocurrió, el estado resultante, quién lo realizó y cuándo. Asimismo, los plazos de la Ley 38 (30 días para peticiones; 5 días para informar el estado) justifican que cada tipo de trámite tenga un plazo exigible y visible.

### 7.3 Catálogo de trámites del proyecto

El proyecto toma tres trámites como caso de uso, que se corresponden con los antecedentes de las secciones 2 y 4:

**Tabla 7. Trámites del catálogo del proyecto**

| Trámite | Institución | Plazo (SLA) del proyecto | Antecedente |
|---|---|---|---|
| Permiso de Construcción Municipal (caso de prueba, se construye primero) | Alcaldía | 15 días | Sección 2.3 y Acuerdo N.° 110 (2025) |
| Solicitud o denuncia ciudadana | Ministerio Público / 311 | 5 días | Sección 2.4 (sistema 311) |
| Registro empresarial simplificado | AMPYME | 10 días | Sección 4.2 (Ley 5 de 2007; Ampyme) |

Fuente: diseño del proyecto.

**Aclaración:** Los plazos de la Tabla 7 son **parámetros de diseño** definidos con fines académicos; no reproducen los plazos legales ni los reglamentarios de las instituciones mencionadas.

### 7.4 Estado actual del proyecto

A la fecha de este documento se encuentran implementadas la infraestructura base (dos servidores Linux con red interna aislada, firewall restrictivo y SELinux en modo enforcing) y una aplicación de demostración con registro de cuentas, inicio de sesión, restablecimiento de contraseña y limitación de intentos fallidos. El motor de trámites con máquina de estados y auditoría inmutable corresponde a la siguiente etapa y se encuentra en fase de diseño.

## 8. Conclusiones

- Los trámites públicos en Panamá se caracterizan por su gran número, su complejidad y la participación de múltiples instituciones; el BID estimó en 2018 que 31 % requería tres o más interacciones, y los permisos de construcción muestran esperas de meses o años documentadas entre 2015 y 2026.
- El derecho a conocer el estado de un trámite **ya está reconocido** en la Ley 38 de 2000 y en la Ley 83 de 2012, que además describe qué información debe incluir. El problema no es la ausencia de norma, sino la dificultad de hacerla verificable en la práctica.
- El Estado ha avanzado con Panamá Conecta, el 311, Panamá Digital y la Alcaldía Digital, centradas sobre todo en facilitar el acceso y la presentación de solicitudes. Las fuentes consultadas no describen mecanismos públicos de auditoría inmutable ni de escalamiento automático por vencimiento de plazos.
- Los incidentes de ciberseguridad de 2025 y 2026 en instituciones públicas, y el aumento reportado de los intentos de ataque, muestran que cualquier sistema de seguimiento debe garantizar la integridad y la confidencialidad de sus registros.
- SIGET se justifica como una propuesta que combina trazabilidad exigible (estados, plazos y escalamiento) con seguridad por diseño, alineada con el marco normativo y con las medidas que el propio Estado ha anunciado.

## 9. Limitaciones de la revisión

- **Antigüedad de algunas fuentes:** varias cifras provienen de 2015–2018 (TVN Noticias, 2015; La Prensa, 2017, 2018; Domínguez et al., 2017) y se usan como antecedente histórico, no como situación actual.
- **Fuentes periodísticas:** las cifras se reportan tal como las publicó cada medio y no fueron verificadas de forma independiente.
- **Ausencia de estadística consolidada:** no se localizó una estadística oficial consolidada sobre expedientes sin resolver o tiempos reales de resolución por institución; por ello se recurrió a reportes sectoriales y de prensa.
- **Fuentes no panameñas:** el caso del MEF se complementó con Security Affairs, el marco de ciberseguridad con Derechos Digitales y la agenda digital con DPL News, por no hallarse un equivalente local accesible.
- **Verificación jurídica:** la numeración de artículos y la vigencia deben confirmarse en la Gaceta Oficial antes de cualquier uso legal.
- **Fuentes institucionales con acceso restringido:** algunas páginas oficiales no pudieron consultarse en línea durante la revisión; la información de esos temas se tomó de reportes de prensa y se indica en cada caso.

## Anexo A. Glosario

| Término | Significado en este documento |
|---|---|
| AIG | Autoridad Nacional para la Innovación Gubernamental, ente rector de la agenda digital del Estado. |
| ANTAI | Autoridad Nacional de Transparencia y Acceso a la Información (Ley 33 de 2013). |
| CSIRT | Equipo de respuesta a incidentes de seguridad informática; en Panamá, el equipo nacional coordinado por la AIG. |
| Silencio administrativo | Falta de respuesta de la administración dentro del plazo legal; por regla general se entiende negada la petición (Ley 38 de 2000, Art. 201). |
| SLA | Acuerdo de nivel de servicio; en el proyecto, plazo máximo de atención definido por tipo de trámite. |
| Trazabilidad | Capacidad de reconstruir, con evidencia verificable, cada actuación realizada sobre un trámite, quién la realizó y cuándo. |
| Ventanilla Única | Mecanismo que coordina de forma simultánea a las entidades que revisan un proyecto, en lugar de hacerlo por etapas. |

## Bibliografía

Fecha de consulta de todas las fuentes en línea: 6 de octubre de 2026.

Asamblea Legislativa de Panamá. (2000). *Ley 38 de 31 de julio de 2000, que aprueba el Estatuto Orgánico de la Procuraduría de la Administración, regula el Procedimiento Administrativo General y dicta disposiciones especiales* (Gaceta Oficial N.° 24109). Justia Panamá. http://panama.justia.com/federales/leyes/38-de-2000-aug-2-2000/gdoc/

Asamblea Nacional de Panamá. (2007). *Ley 5 de 11 de enero de 2007, que agiliza el proceso de apertura de empresas y establece otras disposiciones* (Gaceta Oficial N.° 25709). Legispan. https://docs.panama.justia.com/federales/leyes/5-de-2007-jan-12-2007.pdf

Asamblea Nacional de Panamá. (2012). *Ley 83 de 9 de noviembre de 2012, que regula el uso de medios electrónicos para los trámites gubernamentales y modifica la Ley 65 de 2009, que crea la Autoridad Nacional para la Innovación Gubernamental* (Gaceta Oficial N.° 27160). Legispan. https://s3-legispan.asamblea.gob.pa/legispan/NORMAS/2010/2012/LEY/Administrador%20Legispan_27160_2012_11_9_ASAMBLEA%20NACIONAL_83.pdf

Concepción, M. V. (2026, 22 de mayo). Estado activa escudo tecnológico ante ola de ciberataques financieros contra el Gobierno. *La Prensa*. https://www.prensa.com/sociedad/estado-activa-escudo-tecnologico-ante-ola-de-ciberataques-financieros-contra-el-gobierno/

De Puy, H. (2024, 5 de diciembre). Los retos de la burocracia: un obstáculo al desarrollo. *Panamá América*. https://panamaamerica.com.pa/opinion/los-retos-de-la-burocracia-un-obstaculo-al-desarrollo-1243775

Domínguez, A., Rodríguez, A., Sánchez, Á., Juárez, H., & Valderrama, E. (2017). Panama reports. *Revista de Iniciación Científica, 3* (2), 49–57. Universidad Tecnológica de Panamá. https://revistas.utp.ac.pa/index.php/ric/article/download/1752/2493

DPL News. (2022a, 28 de noviembre). Los ejes estratégicos de la agenda digital de Panamá. https://dplnews.com/?p=174144

DPL News. (2022b, 9 de mayo). Panamá: AIG y Banco Hipotecario lanzan doce nuevos trámites disponibles en Panamá Digital. https://dplnews.com/?p=150580

EFE & Panamá América. (2026, 1 de agosto). Metro de Panamá informa que fue atacado por ciberdelincuentes. *Panamá América*. https://www.panamaamerica.com.pa/sociedad/metro-de-panama-informa-que-fue-atacado-por-ciberdelincuentes-1264694

Fernández Aguilar, A. (2026, 19 de abril). Datos expuestos, millones en riesgo: la crisis digital que enfrenta el gobierno panameño. *La Prensa*. https://www.prensa.com/sociedad/datos-expuestos-millones-en-riesgo-la-crisis-digital-que-enfrenta-el-gobierno-panameno/

García Armuelles, L. (2025, 24 de septiembre). Registro de nuevos emprendimientos aumenta un 23 %, según Ampyme. *La Estrella de Panamá*. https://www.laestrella.com.pa/economia/registro-de-nuevos-emprendimientos-aumenta-un-23-segun-ampyme-AB16244675

Gordón Guerrel, I. (2017, 27 de junio). Doce entidades incumplen información de transparencia. *La Estrella de Panamá*. https://www.laestrella.com.pa/panama/politica/doce-entidades-incumplen-informacion-transparencia-LXLE48827

La Estrella de Panamá. (2026a, mayo). Ciberataques en Panamá aumentan hasta 500 %: AIG refuerza medidas de protección en plataformas estatales. https://www.laestrella.com.pa/panama/nacional/ciberataques-en-panama-aumentan-hasta-500-aig-refuerza-medidas-de-proteccion-en-plataformas-estatales-GL22298806

La Estrella de Panamá. (2026b, 8 de mayo). Panamá declara las tecnologías críticas como prioridad nacional. https://www.laestrella.com.pa/panama/nacional/panama-declara-las-tecnologias-criticas-como-prioridad-nacional-LB22236148

La Prensa. (2017, 2 de abril). Panamá: demoras en permisos asfixian a la construcción. *Revista Estrategia & Negocios*. https://www.revistaeyn.com/portada/panama-demoras-en-permisos-asfixian-a-la-construccion-LWEN1058829

La Prensa. (2018, 16 de septiembre). BID: 4,2 horas tarda hacer un trámite en Panamá. *Revista Estrategia & Negocios*. https://www.revistaeyn.com/centroamericaymundo/bid-42-horas-tarda-hacer-un-tramite-en-panama-LYEN1216739

La Prensa. (2026, 18 de julio). Proponen Ventanilla Única y curador urbano para agilizar permisos de construcción. https://www.prensa.com/sociedad/proponen-ventanilla-unica-y-curador-urbano-para-agilizar-permisos-de-construccion/

Lara, J. C. (2024, diciembre). *Ciberseguridad en América Latina: Estrategias nacionales en 2024*. Derechos Digitales (Colaborativa CYRILLA). https://derechosdigitales.org/wp-content/uploads/DD_CYRILLA_ESP_2024.pdf

Ministerio Público de Panamá. (2019, 26 de junio). La Oficina de Atención Ciudadana es evaluada con un 100 en la revisión de casos atendidos a través de la plataforma del 311 [Nota de prensa]. https://ministeriopublico.gob.pa/notas-de-prensa/la-oficina-de-atencion-ciudadana-es-evaluada-con-un-100-en-la-revision-de-casos-atendidos-a-traves-de-la-plataforma-del-311/

Mojica, Y. (2025, 27 de abril). Hasta 2000 trámites semanales de permisos de construcción y planos recibe el Municipio de Panamá. *La Prensa*. https://www.prensa.com/sociedad/hasta-2000-tramites-semanales-de-permisos-de-construccion-y-planos-recibe-el-municipio-de-panama/

Municipio de Panamá. (2026). *Guía de usuario FPCP: Permiso Digital de Construcción para Plano Registrado (Acuerdo N.° 110 del 22 de abril de 2025)* [Guía en PDF]. Dirección de Obras y Construcciones. https://doyc.mupa.gob.pa/wp-content/uploads/2026/05/Guia_FPCP_.pdf

Panamá América. (2020a, 18 de noviembre). ANTAI remitirá al Ministerio Público denuncia de venta de bases de datos. https://www.panamaamerica.com.pa/judicial/antai-remitira-al-ministerio-publico-denuncia-venta-bases-datos-1176248

Panamá América. (2020b, abril). Sancionan ley sobre el uso de medios electrónicos obligatorio para trámites gubernamentales. https://www.panamaamerica.com.pa/economia/sancionan-ley-sobre-el-uso-de-medios-electronicos-obligatorio-para-tramites-gubernamentales

Panamá América. (2024, 8 de septiembre). Cámara de Comercio pide agilizar digitalización de procesos públicos. https://panamaamerica.com.pa/politica/camara-de-comercio-pide-agilizar-digitalizacion-de-procesos-publicos-1240382

Rodríguez Morán, F. (2025, 6 de marzo). Investigan más de 390 quejas en lo que va del 2025. *Panamá América*. https://panamaamerica.com.pa/sociedad/investigan-mas-390-quejas-en-lo-que-va-del-2025-1246929

RSM Panamá. (s. f.). Ley 81 de Protección de Datos Personales de Panamá. https://www.rsm.global/panama/es/node/62

Security Affairs. (2025, 15 de septiembre). INC ransom group claimed the breach of Panama's Ministry of Economy and Finance. https://securityaffairs.com/?p=182203

TVN Noticias. (2015, 24 de marzo). $500 millones en permisos de construcción y planos pendientes. https://www.tvn-2.com/nacionales/millones-permisos-construccion-planos-pendientes-video_1_1801062.html

TVN Noticias. (2025, 10 de agosto). Administrador de la AIG proyecta a Panamá entre los 40 países más digitalizados del mundo en 2027. https://www.tvn-2.com/nacionales/digitalizacion-panama-gobierno-autoridad-nacional-para-la-innovacion-gubernamental-internet-conectividad_1_2201460.html

Yangüez, B. (2025, 17 de junio). Panamá Conecta, la plataforma que buscará facilitar los trámites estatales. *La Estrella de Panamá*. https://www.laestrella.com.pa/economia/panama-conecta-la-plataforma-que-buscara-facilitar-los-tramites-estatales-GB13744020
