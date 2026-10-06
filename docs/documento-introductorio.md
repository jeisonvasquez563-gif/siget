> Versión en Markdown de `SIGET_Documento_Introductorio.docx` (entrega al profesor). Si hay diferencias, la fuente de verdad es este `.md`.
> Las cifras de prensa se citan con autor y fecha y no fueron auditadas de forma independiente. Los plazos (SLA) del catálogo son parámetros de diseño, no plazos legales. El cronograma asume inicio el 12-oct-2026 y es ajustable.

**DOCUMENTO INTRODUCTORIO AL SEMESTRAL** 
**SIGET** 
**Sistema de Gestión y Trazabilidad** 
**Aplicación web para el seguimiento trazable y seguro de trámites ante el Estado panameño** 
**Ciberseguridad 5 — Universidad Tecnológica de Panamá (UTP)** 
**Elaborado por: Jeison Vásquez — Grupo Ciber5** 
***Octubre de 2026*** 

## 1. Introducción

Los trámites ante el Estado son el punto de contacto más frecuente entre las personas, las empresas y la administración pública. En Panamá, la evidencia documentada muestra procedimientos numerosos, con revisiones sucesivas en varias instituciones y poca visibilidad, para quien los inicia, de la etapa en que se encuentra su expediente, de quién es responsable de resolverlo y de cuánto tiempo ha transcurrido. Cuando además los sistemas que soportan esos trámites son blanco de incidentes de ciberseguridad, la confianza en el registro mismo del trámite también se ve comprometida.

Este documento introduce el proyecto semestral **SIGET — Sistema de Gestión y Trazabilidad**: una aplicación web que registra de forma verificable cada actuación sobre un trámite, hace exigibles los plazos de atención, escala automáticamente los trámites vencidos y permite al solicitante consultar su estado en cualquier momento. La seguridad —aislamiento de red, control de acceso por roles, autenticación multifactor y una auditoría que no puede alterarse— es el **mecanismo que hace confiable la trazabilidad**; no es el tema del proyecto en sí.

### 1.1 Objetivo general

Diseñar e implementar una aplicación que permita dar seguimiento trazable, verificable y seguro a los trámites ante el Estado, aplicando la ciberseguridad como método.

### 1.2 Objetivos específicos

- Registrar cada cambio de estado de un trámite como un evento de auditoría que no pueda modificarse ni eliminarse.
- Validar las transiciones de estado contra una tabla de transiciones permitidas.
- Calcular la fecha límite de atención por tipo de trámite y escalar automáticamente los trámites vencidos.
- Proteger el sistema con controles por capas: aislamiento de red, SELinux, contenedores sin privilegios de administrador, autenticación multifactor y control de acceso por roles.

### 1.3 Metodología y estructura del documento

Los antecedentes se obtuvieron mediante revisión documental con fecha de consulta del 6 de octubre de 2026, priorizando normativa en repositorios oficiales, sitios de instituciones públicas, publicaciones académicas y organismos, y, de forma complementaria, prensa panameña para datos coyunturales (la bibliografía distingue estos grupos). Las cifras de prensa se citan con autor y fecha y no fueron auditadas de forma independiente. El documento sigue la estructura solicitada: antecedentes del sector (sección 2), propósito de la aplicación (3), diseño propuesto (4), tiempo estimado del proyecto con diagrama de Gantt (5) y referencias bibliográficas (6).

## 2. Antecedentes del sector

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

### 2.6 Marco normativo panameño relevante

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

### 2.7 Transformación digital del Estado panameño

#### 2.7.1 La AIG y la agenda digital

La Autoridad Nacional para la Innovación Gubernamental (AIG), creada por la Ley 65 de 2009 y modificada por la Ley 83 de 2012, es el ente rector de la agenda digital. Según DPL News (2022a), la agenda se organiza en seis ejes: gobernanza, marco normativo, infraestructura digital, articulación territorial, gestión de datos y ciberseguridad. En agosto de 2025, el administrador de la AIG declaró la meta de que Panamá sea “uno de los 40 países del mundo más digitalizados” en 2027, y ubicó la posición actual del país entre los puestos 50 y 70 (TVN Noticias, 2025).

#### 2.7.2 Plataformas existentes

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

#### 2.7.3 Lo que estas plataformas resuelven y lo que dejan abierto

Las plataformas descritas avanzan en **digitalizar la entrada** del trámite (solicitar, adjuntar y pagar) y en **concentrar el acceso** del ciudadano en un solo lugar. En las fuentes consultadas no se encontró información pública que describa registros de auditoría inmutables de cada actuación ni mecanismos automáticos de escalamiento cuando un trámite excede su plazo. Esto no prueba que no existan, pero sí indica que no forman parte del discurso público sobre estas plataformas, y es precisamente el espacio que SIGET busca explorar.

### 2.8 Ciberseguridad en el sector público panameño

Un sistema de trazabilidad solo es útil si su registro es íntegro, está disponible y protege los datos de las personas. Por eso es relevante el entorno de amenazas que enfrentan hoy las instituciones públicas.

#### 2.8.1 Incidentes recientes

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

#### 2.8.2 Tendencia y causas señaladas

En mayo de 2026, el administrador de la AIG afirmó que el aumento de los intentos de ataque había sido “exponencial”, con incrementos de 200 %, 300 % y hasta 500 % en los últimos seis meses, y que el Estado no realizó pagos a organizaciones criminales para recuperar datos (La Estrella de Panamá, 2026a). Según La Prensa, en 2025 los intentos o sospechas de fraude se estimaron en cerca de US$125 millones, con unos US$20 millones concretados (Fernández Aguilar, 2026).

Entre las causas que el mismo reportaje atribuye a la situación están las deficiencias históricas en ciberseguridad gubernamental, el descuido en la protección de bases de datos de usuarios, la escasez de profesionales capacitados en el sector público y la relevancia geopolítica del país por el Canal y la actividad portuaria (Fernández Aguilar, 2026).

#### 2.8.3 Respuesta del Estado

- **Inversión y estructura:** la AIG anunció una inversión de US$6 millones en ciberseguridad (más de US$20 millones en total estatal), el fortalecimiento del equipo nacional de respuesta a incidentes (CSIRT), la creación de un Centro de Operaciones de Ciberseguridad del Estado y el monitoreo de 15 instituciones críticas (La Estrella de Panamá, 2026a).
- **Estándares mínimos:** la AIG anunció una resolución con estándares mínimos obligatorios de ciberseguridad para las instituciones (La Estrella de Panamá, 2026a).
- **“Escudo tecnológico”:** medidas como autenticación multifactor obligatoria, verificación en dos pasos para accesos remotos, parchado y actualización de sistemas, pruebas de penetración, segmentación de redes, protección contra malware y refuerzo del correo institucional frente al phishing (Concepción, 2026).
- **Marco normativo:** Decreto Ejecutivo 36 de 2026 y Estrategia Nacional de Ciberseguridad 2021–2024 (sección 2.6).

#### 2.8.4 Implicación para un sistema de trazabilidad

Las medidas anunciadas por el Estado coinciden con los controles que SIGET incorpora desde su diseño: autenticación multifactor, segmentación de red, control de acceso por roles y protección de las credenciales. La experiencia de los incidentes de 2025 y 2026 muestra además que **un registro de trámites debe poder demostrar que no fue alterado**, por lo que la integridad de la auditoría es un requisito de diseño y no un complemento.

### 2.9 Brechas identificadas

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

## 3. Propósito de la aplicación

El propósito de SIGET es convertir en práctica verificable un derecho que la ley panameña ya reconoce —conocer el estado de un trámite (Asamblea Legislativa de Panamá, 2000, Art. 44; Asamblea Nacional de Panamá, 2012, Art. 4)— y hacerlo con garantías de integridad y seguridad. La Tabla 7 resume los beneficios esperados para el sector, según los actores involucrados.

**Tabla 7. Beneficios esperados de la aplicación para el sector**

| Actor | Beneficio | Cómo se logra | Antecedente |
|---|---|---|---|
| Ciudadanos y empresas | Saber en todo momento en qué etapa está su trámite, quién lo atiende y desde cuándo. | Consulta de estado alimentada por el registro de eventos (actuación, fase, responsable, fecha). | Ley 83, Art. 2 y 4; Ley 38, Art. 44 |
| Instituciones y supervisores | Plazos exigibles y detección temprana de trámites estancados. | Fecha límite (SLA) por tipo de trámite; escalamiento automático al supervisor con notificación. | Esperas de meses o años en permisos (Mojica, 2025) |
| Entes de control (ANTAI, Defensoría, Contraloría) | Rendición de cuentas basada en evidencia que no puede alterarse. | Auditoría de solo inserción: no hay UPDATE ni DELETE sobre los eventos. | Ley 6 de 2002 y Ley 33 de 2013; 311 (Domínguez et al., 2017) |
| Sectores productivos (construcción, emprendimiento) | Menos tiempos muertos y mayor previsibilidad. | Seguimiento por etapas y plazos visibles en los trámites del catálogo. | US$809 millones en permisos pendientes (Mojica, 2025) |
| Personas cuyos datos se tratan | Protección de datos personales y de las credenciales de acceso. | Argon2, MFA, RBAC, cifrado entre aplicación y base de datos, secretos fuera del código. | Ley 81 de 2019; incidentes de 2025–2026 |
| Otras instituciones (a futuro) | Un modelo común reutilizable. | Motor genérico de trámites: nuevos tipos se agregan como datos de catálogo. | Propuesta de Ventanilla Única (La Prensa, 2026) |

Fuente: elaboración propia.

**Alcance:** SIGET es un prototipo académico. No sustituye ni busca interoperar con las plataformas existentes del Estado en esta etapa, y los plazos (SLA) de los trámites del catálogo son parámetros de diseño definidos con fines académicos, no plazos legales ni reglamentarios de las instituciones mencionadas.

## 4. Diseño propuesto

### 4.1 Arquitectura general

La solución se despliega en dos servidores Linux (Rocky Linux 9) con SELinux en modo enforcing, comunicados por una red interna dedicada (192.168.100.0/24) sin salida a internet. El firewall del servidor de datos solo acepta conexiones al puerto de la base desde la IP del servidor de aplicación. La Tabla 8 muestra las capas.

**Tabla 8. Capas de la arquitectura propuesta**

| Capa | Componente | Ubicación | Función |
|---|---|---|---|
| 1. Cliente | Navegador web (SPA en React) | Equipo del usuario | Interfaz para ciudadano, funcionario, supervisor y administrador. |
| 2. Entrada | nginx con TLS | Servidor de aplicación (VM1) | Terminación TLS y cabeceras de seguridad (HSTS, CSP, X-Frame-Options). |
| 3. Aplicación | Django + Django REST Framework | Servidor de aplicación (VM1), mismo pod que nginx | API: autenticación, RBAC, máquina de estados, escalamiento. |
| 4. Datos | PostgreSQL 16 | Servidor de datos (VM2) | Almacenamiento y auditoría de solo inserción; acceso solo desde VM1. |
| Transversal | Podman rootless + Quadlet (systemd), SELinux, firewalld, podman secret | VM1 y VM2 | Contenedores sin privilegios de administrador, políticas de acceso y secretos fuera del código. |

Fuente: diseño del proyecto.

### 4.2 Tecnologías seleccionadas

**Tabla 9. Stack tecnológico y decisión de seguridad asociada**

| Elemento | Tecnología | Decisión de seguridad |
|---|---|---|
| Backend | Django + DRF (API-first) | Validación de transiciones de estado en el servidor, nunca en el cliente. |
| Contraseñas | Argon2 | Hash resistente a ataques de fuerza bruta. |
| Sesión de API | JWT de corta duración + refresh token | El token de acceso vive en memoria; el de refresco en cookie httpOnly, Secure y SameSite=Strict. |
| MFA | django-otp (TOTP) | Obligatorio para funcionario, supervisor y administrador. |
| Base de datos | PostgreSQL 16 con TLS | Escucha solo en la IP interna; rol de aplicación con permisos mínimos. |
| Frontend | React + Vite + Tailwind CSS + shadcn/ui | CORS con lista exacta de orígenes, nunca comodín. |
| Contenedores | Podman rootless, gestionado con Quadlet | Sin demonio privilegiado ni docker-compose. |
| Secretos | podman secret | Nunca archivos .env en texto plano. |

Fuente: diseño del proyecto.

### 4.3 Modelo de datos y roles

El modelo de datos prevé siete entidades. La Tabla 10 describe su propósito y la Tabla 11, los roles de usuario.

**Tabla 10. Entidades del modelo de datos**

| Entidad | Propósito |
|---|---|
| Usuario | Persona autenticada en el sistema, asociada a un rol. |
| Institucion | Entidad pública responsable de uno o más tipos de trámite. |
| TipoTramite | Define un trámite del catálogo: institución, plazo (SLA) y reglas. |
| Tramite | Solicitud concreta de un ciudadano, con su estado actual y fecha límite. |
| EventoAuditoria | Registro de solo inserción de cada actuación sobre un trámite. |
| Documento | Archivos adjuntos a un trámite. |
| Notificacion | Avisos al solicitante y a los responsables (cambios de estado, escalamientos). |

Fuente: diseño del proyecto.

**Tabla 11. Roles de usuario (RBAC)**

| Rol | Responsabilidad prevista | MFA |
|---|---|---|
| Ciudadano | Crea trámites y consulta el estado de los propios. | No |
| Funcionario | Tramita y cambia el estado de los trámites de su institución. | Obligatorio |
| Supervisor | Recibe los trámites escalados por vencimiento y supervisa a los funcionarios. | Obligatorio |
| Administrador | Gestiona usuarios, instituciones y el catálogo de trámites. | Obligatorio |

Fuente: diseño del proyecto. El detalle de permisos por rol se afinará en el diseño detallado.

### 4.4 Máquina de estados del trámite

Un trámite avanza por estados definidos y solo se permiten las transiciones de la Tabla 12; cualquier otra es rechazada por el servidor.

**Tabla 12. Transiciones de estado permitidas (propuesta inicial)**

| Estado actual | Estados siguientes permitidos |
|---|---|
| Pendiente | En Tramitación |
| En Tramitación | En Subsanación, Aprobado, Rechazado |
| En Subsanación | En Tramitación |
| Aprobado / Rechazado | Ninguno (estados finales) |

Fuente: diseño del proyecto. La tabla se refinará durante el diseño detallado.

### 4.5 Trazabilidad e integridad garantizadas

- **Permisos de base de datos:** el rol que usa la aplicación puede consultar e insertar en la tabla de eventos de auditoría, pero tiene revocados los permisos de actualización y borrado.
- **Defensa adicional:** un disparador (trigger) en la base de datos rechaza cualquier intento de actualizar o borrar un evento, aunque los permisos fallaran.
- **Atomicidad:** el cambio de estado del trámite y el registro de su evento se guardan en la misma transacción; nunca ocurre uno sin el otro.
- **Escalamiento automático:** un proceso programado revisa los trámites con fecha límite vencida, los reasigna a un supervisor y notifica.

### 4.6 Catálogo de trámites del proyecto

**Tabla 13. Trámites del catálogo (mismo motor genérico, sin lógica especial por tipo)**

| Trámite | Institución | Plazo (SLA) de diseño | Antecedente |
|---|---|---|---|
| Permiso de Construcción Municipal (caso de prueba, se construye primero) | Alcaldía | 15 días | Sección 2.3 y Acuerdo N.° 110 de 2025 |
| Solicitud o denuncia ciudadana | Ministerio Público / 311 | 5 días | Sección 2.4 (sistema 311) |
| Registro empresarial simplificado | AMPYME | 10 días | Sección 2.6 (Ley 5 de 2007; Ampyme) |

Fuente: diseño del proyecto.

### 4.7 Avance actual

A la fecha están implementados: (a) la infraestructura base —dos servidores con red interna aislada, firewall restrictivo y SELinux enforcing—; (b) una aplicación de demostración con registro de cuentas, inicio de sesión, restablecimiento de contraseña y bloqueo tras tres intentos fallidos; (c) el acceso del equipo mediante una red privada (Tailscale); y (d) un repositorio con flujo de trabajo GitFlow y documentación versionada. El motor de trámites, la auditoría inmutable y el frontend corresponden a las etapas siguientes del cronograma.

## 5. Tiempo estimado del proyecto

El cronograma estima **10 semanas** de trabajo a partir de la semana del 12 de octubre de 2026, después de completada la fase 0. Las fechas se ajustarán al calendario académico del semestre. El diagrama de Gantt de la Figura 1 muestra la duración y el solapamiento de las actividades.

**Figura 1. Diagrama de Gantt del proyecto (semanas S1 a S10)**

| Actividad | S1 (12 oct) | S2 (19 oct) | S3 (26 oct) | S4 (2 nov) | S5 (9 nov) | S6 (16 nov) | S7 (23 nov) | S8 (30 nov) | S9 (7 dic) | S10 (14 dic) |
|---|---|---|---|---|---|---|---|---|---|---|
| **Fase 0 — Infraestructura base y aplicación de demostración** | ✅ completada |  |  |  |  |  |  |  |  |  |
| 1. Podman rootless y Quadlet en ambos servidores | ██ | ██ |  |  |  |  |  |  |  |  |
| 2. PostgreSQL en contenedor, rol de aplicación y podman secret |  | ██ | ██ |  |  |  |  |  |  |  |
| 3. Backend: modelo de datos y máquina de estados |  |  | ██ | ██ | ██ |  |  |  |  |  |
| 4. Autenticación: Argon2, JWT, MFA y RBAC |  |  |  | ██ | ██ | ██ |  |  |  |  |
| 5. Auditoría inmutable, SLA y escalamiento automático |  |  |  |  | ██ | ██ | ██ |  |  |  |
| 6. TLS entre aplicación y base de datos; nginx con TLS |  |  |  |  |  | ██ | ██ |  |  |  |
| 7. Frontend en React |  |  |  |  |  | ██ | ██ | ██ | ██ |  |
| 8. Catálogo de trámites (3 tipos) |  |  |  |  |  |  |  | ██ | ██ |  |
| 9. Pruebas de punta a punta y validación de plazos |  |  |  |  |  |  |  |  | ██ | ██ |
| 10. Documentación final y presentación |  |  |  |  |  |  |  |  | ██ | ██ |

Fuente: elaboración propia. Los bloques ██ marcan la duración planificada de cada actividad. S1 = semana del 12 de octubre de 2026.

### 5.1 Hitos

- **Fin de S3:** servidores con contenedores y base de datos lista, con secretos gestionados.
- **Fin de S6:** modelo de datos, autenticación con MFA y control de acceso por roles operativos.
- **Fin de S7:** auditoría inmutable, escalamiento automático y cifrado de las comunicaciones completos.
- **Fin de S9:** interfaz web conectada y los tres trámites del catálogo cargados.
- **Fin de S10:** pruebas de punta a punta superadas, documentación final y presentación.

### 5.2 Forma de trabajo

El equipo trabaja con un repositorio en monorepo y flujo GitFlow (ramas principal y de integración, con una rama por bloque de trabajo), y todo cambio se documenta en el registro de cambios y en los documentos técnicos del proyecto. Las etapas se validan con pruebas verificables contra la base de datos real, no solo con la interfaz.

## 6. Referencias bibliográficas

Fecha de consulta de todas las fuentes en línea: 6 de octubre de 2026. Formato APA, 7.ª edición.

### 6.1 Normativa y fuentes oficiales

Asamblea Legislativa de Panamá. (2000). *Ley 38 de 31 de julio de 2000, que aprueba el Estatuto Orgánico de la Procuraduría de la Administración, regula el Procedimiento Administrativo General y dicta disposiciones especiales* (Gaceta Oficial N.° 24109). Justia Panamá. http://panama.justia.com/federales/leyes/38-de-2000-aug-2-2000/gdoc/

Asamblea Nacional de Panamá. (2007). *Ley 5 de 11 de enero de 2007, que agiliza el proceso de apertura de empresas y establece otras disposiciones* (Gaceta Oficial N.° 25709). Legispan. https://docs.panama.justia.com/federales/leyes/5-de-2007-jan-12-2007.pdf

Asamblea Nacional de Panamá. (2009). *Ley 65 de 30 de octubre de 2009, que crea la Autoridad Nacional para la Innovación Gubernamental* (Gaceta Oficial N.° 26400-C). Legispan. https://s3-legispan.asamblea.gob.pa/legispan/NORMAS/2000/2009/LEY/Administrador%20Legispan_26400-C_2009_10_30_ASAMBLEA%20NACIONAL_65.pdf

Asamblea Nacional de Panamá. (2012). *Ley 83 de 9 de noviembre de 2012, que regula el uso de medios electrónicos para los trámites gubernamentales y modifica la Ley 65 de 2009, que crea la Autoridad Nacional para la Innovación Gubernamental* (Gaceta Oficial N.° 27160). Legispan. https://s3-legispan.asamblea.gob.pa/legispan/NORMAS/2010/2012/LEY/Administrador%20Legispan_27160_2012_11_9_ASAMBLEA%20NACIONAL_83.pdf

Ministerio Público de Panamá. (2019, 26 de junio). La Oficina de Atención Ciudadana es evaluada con un 100 en la revisión de casos atendidos a través de la plataforma del 311 [Nota de prensa]. https://ministeriopublico.gob.pa/notas-de-prensa/la-oficina-de-atencion-ciudadana-es-evaluada-con-un-100-en-la-revision-de-casos-atendidos-a-traves-de-la-plataforma-del-311/

Municipio de Panamá. (2026). *Guía de usuario FPCP: Permiso Digital de Construcción para Plano Registrado (Acuerdo N.° 110 del 22 de abril de 2025)* [Guía en PDF]. Dirección de Obras y Construcciones. https://doyc.mupa.gob.pa/wp-content/uploads/2026/05/Guia_FPCP_.pdf

### 6.2 Fuentes académicas y de organismos

Domínguez, A., Rodríguez, A., Sánchez, Á., Juárez, H., & Valderrama, E. (2017). Panama reports. *Revista de Iniciación Científica, 3* (2), 49–57. Universidad Tecnológica de Panamá. https://revistas.utp.ac.pa/index.php/ric/article/download/1752/2493

Lara, J. C. (2024, diciembre). *Ciberseguridad en América Latina: Estrategias nacionales en 2024*. Derechos Digitales (Colaborativa CYRILLA). https://derechosdigitales.org/wp-content/uploads/DD_CYRILLA_ESP_2024.pdf

Roseth, B., Reyes, Á., & Santiso, C. (2018). *El fin del trámite eterno: Ciudadanos, burocracia y gobierno digital*. Banco Interamericano de Desarrollo. https://publications.iadb.org/es/metadata/17381/el-fin-del-tramite-eterno-ciudadanos-burocracia-y-gobierno-digital

### 6.3 Prensa panameña y fuentes complementarias

Se emplean para datos coyunturales (cifras, incidentes y declaraciones) que no se hallaron publicados en un sitio oficial; pueden sustituirse por fuentes oficiales cuando estén disponibles.

Concepción, M. V. (2026, 22 de mayo). Estado activa escudo tecnológico ante ola de ciberataques financieros contra el Gobierno. *La Prensa*. https://www.prensa.com/sociedad/estado-activa-escudo-tecnologico-ante-ola-de-ciberataques-financieros-contra-el-gobierno/

De Puy, H. (2024, 5 de diciembre). Los retos de la burocracia: un obstáculo al desarrollo. *Panamá América*. https://panamaamerica.com.pa/opinion/los-retos-de-la-burocracia-un-obstaculo-al-desarrollo-1243775

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

Mojica, Y. (2025, 27 de abril). Hasta 2000 trámites semanales de permisos de construcción y planos recibe el Municipio de Panamá. *La Prensa*. https://www.prensa.com/sociedad/hasta-2000-tramites-semanales-de-permisos-de-construccion-y-planos-recibe-el-municipio-de-panama/

Panamá América. (2020a, 18 de noviembre). ANTAI remitirá al Ministerio Público denuncia de venta de bases de datos. https://www.panamaamerica.com.pa/judicial/antai-remitira-al-ministerio-publico-denuncia-venta-bases-datos-1176248

Panamá América. (2020b, abril). Sancionan ley sobre el uso de medios electrónicos obligatorio para trámites gubernamentales. https://www.panamaamerica.com.pa/economia/sancionan-ley-sobre-el-uso-de-medios-electronicos-obligatorio-para-tramites-gubernamentales

Panamá América. (2024, 8 de septiembre). Cámara de Comercio pide agilizar digitalización de procesos públicos. https://panamaamerica.com.pa/politica/camara-de-comercio-pide-agilizar-digitalizacion-de-procesos-publicos-1240382

Rodríguez Morán, F. (2025, 6 de marzo). Investigan más de 390 quejas en lo que va del 2025. *Panamá América*. https://panamaamerica.com.pa/sociedad/investigan-mas-390-quejas-en-lo-que-va-del-2025-1246929

RSM Panamá. (s. f.). Ley 81 de Protección de Datos Personales de Panamá. https://www.rsm.global/panama/es/node/62

Security Affairs. (2025, 15 de septiembre). INC ransom group claimed the breach of Panama's Ministry of Economy and Finance. https://securityaffairs.com/?p=182203

TVN Noticias. (2015, 24 de marzo). $500 millones en permisos de construcción y planos pendientes. https://www.tvn-2.com/nacionales/millones-permisos-construccion-planos-pendientes-video_1_1801062.html

TVN Noticias. (2025, 10 de agosto). Administrador de la AIG proyecta a Panamá entre los 40 países más digitalizados del mundo en 2027. https://www.tvn-2.com/nacionales/digitalizacion-panama-gobierno-autoridad-nacional-para-la-innovacion-gubernamental-internet-conectividad_1_2201460.html

Yangüez, B. (2025, 17 de junio). Panamá Conecta, la plataforma que buscará facilitar los trámites estatales. *La Estrella de Panamá*. https://www.laestrella.com.pa/economia/panama-conecta-la-plataforma-que-buscara-facilitar-los-tramites-estatales-GB13744020
