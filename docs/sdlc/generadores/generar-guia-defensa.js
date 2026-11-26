// Genera la guía de defensa del SDLC seguro (.docx): una parte común y una sección por persona con las preguntas probables
// del profesor, tomadas de la sección «Preguntas que puede hacer el profesor» de cada etapa en docs/sdlc/.
// Uso: node generar-guia-defensa.js   (necesita el paquete docx de npm)
const fs = require("fs");
const path = require("path");
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, HeadingLevel, AlignmentType, WidthType, ShadingType,
  BorderStyle, PageBreak, LevelFormat, Footer, PageNumber, TableOfContents,
} = require("docx");

const SDLC = path.resolve(__dirname, "..");
const SALIDA = path.resolve(SDLC, "..", "SIGET_Guia_de_Defensa_SDLC_Seguro.docx");
const FUENTE = "Calibri";

const t = (texto, o = {}) => new TextRun({ text: texto, font: FUENTE, size: 22, ...o });
const code = (texto) => new TextRun({ text: texto, font: "Consolas", size: 20 });
function runs(texto, base = {}) {
  return texto.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).filter(Boolean)
    .map((s) => s.startsWith("`") ? code(s.slice(1, -1)) : s.startsWith("**") ? t(s.slice(2, -2), { ...base, bold: true }) : t(s, base));
}
const p = (texto, o = {}) => new Paragraph({ children: runs(texto), spacing: { after: 120, line: 276 }, alignment: AlignmentType.JUSTIFIED, ...o });
const h1 = (x) => new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(x)] });
const h2 = (x) => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(x)] });
const h3 = (x) => new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun(x)] });
const vineta = (x) => new Paragraph({ numbering: { reference: "vinetas", level: 0 }, children: runs(x), spacing: { after: 60 } });
const salto = () => new Paragraph({ children: [new PageBreak()] });

const borde = { style: BorderStyle.SINGLE, size: 4, color: "A6A6A6" };
function tabla(cab, filas, anchos) {
  const celda = (x, i, esCab) => new TableCell({
    borders: { top: borde, bottom: borde, left: borde, right: borde }, width: { size: anchos[i], type: WidthType.DXA },
    shading: esCab ? { type: ShadingType.CLEAR, color: "auto", fill: "1F3864" } : undefined, margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: [new Paragraph({ children: esCab ? [t(x, { bold: true, color: "FFFFFF", size: 19 })] : runs(x) })],
  });
  return [new Table({ width: { size: anchos.reduce((a, b) => a + b, 0), type: WidthType.DXA }, columnWidths: anchos,
    rows: [new TableRow({ tableHeader: true, children: cab.map((c, i) => celda(c, i, true)) }), ...filas.map((f) => new TableRow({ children: f.map((c, i) => celda(c, i, false)) }))] }),
  new Paragraph({ spacing: { after: 120 }, children: [] })];
}

// --- lee la sección de preguntas de un .md y la convierte en párrafos (### / **pregunta** / listas / párrafos)
function preguntasDe(archivo) {
  const md = fs.readFileSync(path.join(SDLC, archivo), "utf8").replace(/\r\n/g, "\n");
  const i = md.search(/^## Preguntas que puede hacer el profesor/m);
  if (i < 0) return [p("*(Esta etapa todavía no tiene su sección de preguntas.)*")];
  const cuerpo = md.slice(i).split("\n").slice(1);
  const fin = cuerpo.findIndex((l) => /^## /.test(l));
  const lineas = (fin < 0 ? cuerpo : cuerpo.slice(0, fin));
  const salida = [];
  let parrafo = [];
  const volcar = () => { if (parrafo.length) { salida.push(p(parrafo.join(" "))); parrafo = []; } };
  for (const l of lineas) {
    const s = l.trim();
    if (!s) { volcar(); continue; }
    let m;
    if ((m = s.match(/^#{3,4}\s+(.*)/))) { volcar(); salida.push(new Paragraph({ children: runs(m[1].replace(/^\d+[.)]\s*/, ""), { color: "1F3864" }).map((r) => r), spacing: { before: 180, after: 60 }, keepNext: true })); salida[salida.length - 1] = new Paragraph({ children: runs("**" + m[1].replace(/\*\*/g, "") + "**"), spacing: { before: 180, after: 60 }, keepNext: true }); continue; }
    if ((m = s.match(/^\d+[.)]\s+(\*\*.*)/))) { volcar(); salida.push(new Paragraph({ children: runs(m[1]), spacing: { before: 180, after: 60 }, keepNext: true })); continue; }
    // «**1. ¿Pregunta?**» sola en su línea: es el título de la pregunta; la respuesta sigue en las líneas siguientes
    if (/^\*\*[^*]+\*\*$/.test(s)) { volcar(); salida.push(new Paragraph({ children: runs(s, { color: "1F3864" }), spacing: { before: 200, after: 60 }, keepNext: true })); continue; }
    if ((m = s.match(/^[-*]\s+(.*)/))) { volcar(); salida.push(vineta(m[1])); continue; }
    if (s.startsWith(">")) { parrafo.push(s.replace(/^>\s?/, "")); continue; }
    parrafo.push(s);
  }
  volcar();
  return salida;
}

const PERSONAS = [
  { nombre: "Simna De Gracia", etapa: "1. Planificación", archivos: ["01-registro-de-riesgos.md"],
    resumen: "Identificamos qué puede salir mal en SIGET, qué tan probable es y qué tan grave sería, y anotamos qué control lo reduce. Lo que no tiene control queda como pendiente para Jeison." },
  { nombre: "Gabriel González", etapa: "2. Análisis de requisitos", archivos: ["02-requisitos-de-seguridad.md"],
    resumen: "Escribimos qué tiene que cumplir SIGET en seguridad (autenticación, permisos, datos personales, auditoría, cifrado, disponibilidad) y qué exigen las leyes de Panamá, y para cada requisito mostramos dónde se cumple." },
  { nombre: "Joel Medina", etapa: "3. Diseño", archivos: ["03-modelo-de-amenazas.md"],
    resumen: "Analizamos cada pieza de SIGET con STRIDE: suplantación, alteración, repudio, divulgación, denegación de servicio y elevación de privilegios, y anotamos qué control frena cada amenaza." },
  { nombre: "Andy Martínez", etapa: "4. Desarrollo", archivos: ["04-codificacion-segura.md"],
    resumen: "Llevamos la seguridad al día a día del código: reglas de codificación segura y un flujo automático (Bandit, Semgrep, pip-audit, npm audit y Gitleaks) que revisa cada cambio, más Dependabot para las dependencias." },
  { nombre: "Jorge Medina", etapa: "5. Documentación", archivos: ["05-inventario-de-controles.md"],
    resumen: "Documentamos cada control de seguridad (qué protege, dónde está escrito y cómo se comprueba) y la política para reportar vulnerabilidades (SECURITY.md)." },
  { nombre: "Bradley Morales", etapa: "6. Pruebas", archivos: ["06-plan-de-pruebas.md"],
    resumen: "Reunimos todas las pruebas de SIGET (unitarias, contra la base real, de extremo a extremo, estáticas y dinámicas), las corrimos y definimos una lista de revisión de código que se aplicó a PR reales." },
  { nombre: "Jeison Vásquez", etapa: "7. Implementación y coordinación", archivos: ["07-revision-del-entorno.md"],
    resumen: "Revisamos la seguridad del entorno donde corre SIGET: SELinux, SSH, cortafuegos, puertos, TLS, contenedores sin privilegios; actualizamos las dos máquinas a Rocky 9.9 y documentamos cada cambio del entorno desde el 24 de noviembre (el rol y el temporizador del detector de alertas, nginx, la base)." },
  { nombre: "Anyurie Sánchez", etapa: "8. Mantenimiento: supervisión", archivos: ["08-bitacora-supervision.md"],
    resumen: "Cada semana revisamos los eventos de seguridad de la plataforma, desde el 26 de noviembre empezando por la consola de alertas que abre un detector automático, y tenemos un procedimiento escrito para responder a una intrusión." },
  { nombre: "Walter Sanjur", etapa: "8. Mantenimiento: parches", archivos: ["08-bitacora-parches.md"],
    resumen: "Cada semana revisamos los avisos de seguridad pendientes y las actualizaciones de dependencias, y vigilamos las fechas de fin de soporte de cada componente." },
];

const comun = [
  h1("1. Lo que todos tienen que saber explicar"),
  h2("1.1 Qué es SIGET"),
  p("SIGET (Sistema de Gestión y Trazabilidad) es una plataforma para que la ciudadanía siga sus trámites ante instituciones del Estado panameño y para que cada actuación quede registrada en una auditoría que no se puede alterar. Tiene una interfaz web (React), un backend (Django) y una base de datos (PostgreSQL), en dos máquinas virtuales con Rocky Linux 9 y contenedores Podman. Además del seguimiento y la auditoría, incluye plazos con escalamiento automático, documentos cifrados, derechos de la persona sobre sus datos (Ley 81), notificaciones, alertas ante patrones sospechosos y la gestión del catálogo de trámites por cada institución."),
  h2("1.2 Qué es el SDLC seguro (según Red Hat)"),
  p("El ciclo de vida de desarrollo de software (SDLC) es el marco que sigue un software desde que se planifica hasta que se mantiene. El **SDLC seguro** agrega medidas de seguridad **en cada una de sus etapas**, en lugar de dejar la seguridad para el final. Red Hat lo describe en ocho etapas:"),
  ...tabla(["Etapa", "Qué pide Red Hat", "Responsable"], [
    ["1. Planificación", "Evaluar riesgos y amenazas y el impacto de un incidente", "Simna"],
    ["2. Requisitos", "Incluir requisitos de seguridad y de cumplimiento normativo", "Gabriel"],
    ["3. Diseño", "Modelar amenazas; la seguridad como parte de la arquitectura", "Joel"],
    ["4. Desarrollo", "Codificación segura, pruebas de seguridad integradas, evaluar dependencias", "Andy"],
    ["5. Documentación", "Documentar procesos y controles; preparar auditorías", "Jorge"],
    ["6. Pruebas", "Revisión de código y pruebas estáticas y dinámicas", "Bradley"],
    ["7. Implementación", "Evaluar el entorno de despliegue y revisar configuraciones", "Jeison"],
    ["8. Mantenimiento", "Supervisar amenazas, eliminar vulnerabilidades y responder a intrusiones", "Anyurie y Walter"],
  ], [2200, 5160, 2000]),
  h2("1.3 Tres ideas que aparecen en cualquier pregunta"),
  vineta("**Shift left (desplazar a la izquierda):** aplicar la seguridad lo antes posible en el ciclo. Corregir un problema en el diseño cuesta mucho menos que corregirlo en producción."),
  vineta("**DevSecOps:** desarrollo, seguridad y operaciones comparten la responsabilidad de la seguridad, y las comprobaciones se automatizan (en SIGET, el flujo `security-scan` corre solo en cada cambio)."),
  vineta("**Zero Trust (confianza cero):** nunca confiar, siempre verificar. En SIGET cada petición se autentica, el decisor de acceso (PDP) decide con los datos de la persona y la base de datos vuelve a filtrar por institución (seguridad por filas): dos barreras independientes."),
  h2("1.4 Preguntas generales que puede hacer el profesor"),
  ...[
    ["¿Por qué eligieron las ocho etapas de Red Hat?", "Porque cubren todo el ciclo, desde planificar hasta mantener, y para cada etapa dicen qué medida de seguridad aplicar. Nos permitió revisar SIGET de punta a punta y repartir el trabajo: cada integrante es responsable de una etapa."],
    ["¿Qué etapa les costó más y por qué?", "El mantenimiento: al revisar encontramos que las máquinas nunca se habían actualizado y que la versión de Rocky Linux ya no tenía soporte. Lo documentamos y el 16 de noviembre lo corregimos: actualizamos las dos máquinas a Rocky 9.9 con respaldo, instantáneas y verificaciones, y quedaron en cero avisos críticos."],
    ["¿Cómo saben que lo que dicen es verdad?", "Todo tiene evidencia en el repositorio: capturas y salidas completas de cada comando en `docs/sdlc/evidencia/`, pruebas automáticas que cualquiera puede correr y el historial de cambios en GitHub con quién hizo y quién revisó cada cosa."],
    ["¿Qué es lo más importante que falta?", "Lo que depende de infraestructura que el laboratorio no tiene: una copia de los respaldos fuera de la VM de la base, una segunda persona con sudo y una segunda copia de la clave de los documentos fuera del PC anfitrión. También falta la exportación firmada de la auditoría, las pruebas de punta a punta de la interfaz con Playwright, la política de conservación de datos de la Ley 81, volver la inactividad a 10 minutos después de la demostración y, como límite declarado, verificar la identidad de quien se registra, que depende del Registro Civil y de un servidor de correo. Ya están hechos los parches (Rocky 9.9), el retiro del checkpoint PHP, los derechos sobre los datos personales y las alertas automáticas."],
    ["¿Qué hicieron después del 17 de noviembre?", "Seis cambios en producción, del 24 al 26 de noviembre: derechos sobre los datos personales y aviso de privacidad (PT-15), el contenido del trámite con motivo obligatorio, el cambio de contraseña con cierre de sesiones, las notificaciones, las alertas ante patrones sospechosos (PT-10) y la gestión del catálogo por cada institución. Cada uno con respaldo verificado, ensayo de la migración y sus pruebas en una transacción revertida, la imagen verificada antes de reiniciar y un ensayo final que pasó de 101 a 119 comprobaciones."],
    ["¿Cómo despliegan un cambio sin riesgo?", "Con un procedimiento fijo: respaldo verificado de la base, ensayo de la migración con sus pruebas en una transacción que se revierte, migración real, imagen nueva verificada contra la base real antes de reiniciar, despliegue con respaldo de la imagen anterior y ensayo completo al final. Dos lecciones quedaron escritas: un reemplazo de texto rompió seis pasos de una verificación y se atrapó antes de desplegar, y una ruta que nginx no dejaba pasar solo se vio comprobando desde afuera."],
    ["¿Qué harían distinto?", "Haber empezado la supervisión y los parches desde el primer día: las máquinas estuvieron meses sin actualizarse hasta que la revisión de mantenimiento lo descubrió. El SDLC seguro dice justamente eso: la seguridad no es una etapa final, va en todas."],
  ].flatMap(([q, a]) => [new Paragraph({ children: runs("**" + q + "**"), spacing: { before: 160, after: 60 }, keepNext: true }), p(a)]),
  h2("1.5 Glosario rápido"),
  ...tabla(["Término", "En simple"], [
    ["Vulnerabilidad", "Una debilidad que alguien podría aprovechar"], ["Amenaza", "Lo que podría aprovecharla (una persona, un error, un fallo)"],
    ["Riesgo", "La combinación de qué tan probable es y qué tan grave sería"], ["Control", "Lo que reduce un riesgo (una regla, una configuración, una prueba)"],
    ["SAST", "Análisis estático: revisar el código sin ejecutarlo (Bandit, Semgrep)"], ["DAST", "Análisis dinámico: atacar la aplicación funcionando (OWASP ZAP)"],
    ["SCA", "Revisar las librerías de terceros por vulnerabilidades conocidas (pip-audit, npm audit)"], ["CVE / RLSA", "Identificador público de una vulnerabilidad / aviso de seguridad de Rocky Linux"],
    ["PDP", "El decisor de acceso de SIGET: dice si una persona puede hacer algo"], ["Detector de alertas", "Función de la base que corre cada 5 minutos y abre una alerta ante un patrón sospechoso; la revisa una persona"], ["ARCO", "Derechos de acceso, rectificación, cancelación y oposición sobre los datos personales (Ley 81 de 2019)"], ["RLS", "Seguridad por filas: la base de datos solo devuelve las filas que esa persona puede ver"],
    ["Segundo factor (MFA)", "Un código del teléfono además de la contraseña"], ["PR (pull request)", "Pedido para incorporar un cambio, que otra persona revisa antes"],
  ], [2600, 6760]),
  salto(),
];

const porPersona = [
  h1("2. Guía de cada persona"),
  p("Cada sección explica la etapa en una frase y trae las preguntas probables con su respuesta. Leé tu sección completa y, si te alcanza el tiempo, la de la etapa anterior y la siguiente: el profesor puede preguntar cómo se conectan."),
  ...PERSONAS.flatMap((x) => [
    h2(`${x.nombre} — Etapa ${x.etapa}`),
    p(`**En una frase:** ${x.resumen}`),
    p(`**Tu documento:** ${x.archivos.map((a) => "`docs/sdlc/" + a + "`").join(", ")}. Abrilo durante la presentación si te piden mostrar algo.`),
    h3("Preguntas que puede hacer el profesor"),
    ...x.archivos.flatMap(preguntasDe),
    salto(),
  ]),
];

const portada = [
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 1200, after: 120 }, children: [t("SIGET — Grupo Ciber5 · Ciberseguridad 5, UTP", { bold: true, size: 28 })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 160 }, children: [t("Guía de defensa: el ciclo de vida de desarrollo seguro en SIGET", { bold: true, size: 40, color: "1F3864" })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 400 }, children: [t("Qué hizo cada integrante y cómo responder las preguntas del profesor", { italics: true, size: 24 })] }),
  p("**Cómo usar esta guía:** primero la sección 1, que todos deben poder explicar. Después la sección de cada uno. Las respuestas están escritas para decirlas con tus palabras: no hace falta memorizarlas, hace falta entenderlas. Si no sabés algo, la respuesta correcta es «eso lo trabajó [nombre], te lo explica», nunca inventar."),
  new TableOfContents("Contenido", { hyperlink: true, headingStyleRange: "1-2" }),
  salto(),
];

const doc = new Document({
  creator: "Grupo Ciber5", title: "Guía de defensa del SDLC seguro de SIGET", features: { updateFields: true },
  styles: { default: { document: { run: { font: FUENTE, size: 22 } } }, paragraphStyles: [
    { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: FUENTE, size: 32, bold: true, color: "1F3864" }, paragraph: { spacing: { before: 240, after: 160 }, keepNext: true, outlineLevel: 0 } },
    { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: FUENTE, size: 26, bold: true, color: "2E5597" }, paragraph: { spacing: { before: 220, after: 120 }, keepNext: true, outlineLevel: 1 } },
    { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: FUENTE, size: 23, bold: true, color: "404040" }, paragraph: { spacing: { before: 180, after: 100 }, keepNext: true, outlineLevel: 2 } },
  ] },
  numbering: { config: [{ reference: "vinetas", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] }] },
  sections: [{ properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
    footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [t("SIGET — Guía de defensa · ", { size: 18, color: "808080" }), new TextRun({ children: [PageNumber.CURRENT], size: 18, color: "808080", font: FUENTE })] })] }) },
    children: [...portada, ...comun, ...porPersona] }],
});
Packer.toBuffer(doc).then((b) => { fs.writeFileSync(SALIDA, b); console.log("OK", SALIDA); });
