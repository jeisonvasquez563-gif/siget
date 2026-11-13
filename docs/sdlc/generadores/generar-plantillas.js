// Genera el análisis de mantenimiento de SIGET según el ciclo de vida de Red Hat (.docx).
const fs = require("fs");
const path = require("path");
const {
  Document, Packer, Paragraph, TextRun, ImageRun, Table, TableRow, TableCell, HeadingLevel, AlignmentType,
  WidthType, ShadingType, BorderStyle, PageBreak, LevelFormat, Footer, PageNumber, TableOfContents, PageOrientation,
} = require("docx");

const RAIZ = "C:/Users/jeiva/Desktop/siget-plazos";
const EV = path.join(RAIZ, "docs/mantenimiento/evidencia");
const SALIDA = path.join(RAIZ, "docs/SIGET_Analisis_Mantenimiento_Ciclo_de_Vida.docx");
const ANCHO = 9360; // 6.5" de contenido en carta con márgenes de 1"
const FUENTE = "Calibri";

// ---------------------------------------------------------------- utilidades
let nFig = 0, nTab = 0;
const t = (texto, o = {}) => new TextRun({ text: texto, font: FUENTE, size: 22, ...o });
const code = (texto) => new TextRun({ text: texto, font: "Consolas", size: 20 });
// Texto con `código` y **negrita** en línea
function runs(texto) {
  const partes = texto.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).filter(Boolean);
  return partes.map((p) => p.startsWith("`") ? code(p.slice(1, -1)) : p.startsWith("**") ? t(p.slice(2, -2), { bold: true }) : t(p));
}
const p = (texto, o = {}) => new Paragraph({ children: runs(texto), spacing: { after: 120, line: 276 }, alignment: AlignmentType.JUSTIFIED, ...o });
const h1 = (texto) => new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(texto)] });
const h2 = (texto) => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(texto)] });
const h3 = (texto) => new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun(texto)] });
const vineta = (texto) => new Paragraph({ numbering: { reference: "vinetas", level: 0 }, children: runs(texto), spacing: { after: 60 } });
const paso = (texto) => new Paragraph({ numbering: { reference: "pasos", level: 0 }, children: runs(texto), spacing: { after: 60 } });
const comando = (texto) => new Paragraph({
  children: [code(texto)], spacing: { before: 60, after: 120 }, indent: { left: 360 },
  shading: { type: ShadingType.CLEAR, color: "auto", fill: "F2F2F2" },
});
const salto = () => new Paragraph({ children: [new PageBreak()] });

function tamPng(archivo) {
  const b = fs.readFileSync(archivo);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

// Figura con su leyenda. Si el archivo no existe se omite (y se avisa en consola).
function figura(rel, leyenda, anchoMax = 624) {
  const archivo = path.join(EV, rel);
  if (!fs.existsSync(archivo)) { console.warn("FALTA", rel); return []; }
  const { w, h } = tamPng(archivo);
  let ancho = Math.min(anchoMax, w), alto = Math.round(h * ancho / w);
  if (alto > 780) { alto = 780; ancho = Math.round(w * alto / h); }
  nFig += 1;
  return [
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 120, after: 40 }, keepNext: true,
      children: [new ImageRun({ type: "png", data: fs.readFileSync(archivo), transformation: { width: ancho, height: alto },
        altText: { title: `Figura ${nFig}`, description: leyenda, name: path.basename(rel) } })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 },
      children: [t(`Figura ${nFig}. `, { bold: true, italics: true, size: 18 }), t(leyenda, { italics: true, size: 18 }),
        t(`  (evidencia: ${rel})`, { size: 16, color: "666666" })] }),
  ];
}

const borde = { style: BorderStyle.SINGLE, size: 4, color: "A6A6A6" };
const bordes = { top: borde, bottom: borde, left: borde, right: borde };
function tabla(titulo, cabecera, filas, anchos) {
  nTab += 1;
  const total = anchos.reduce((a, b) => a + b, 0);
  const celda = (txt, i, esCab) => new TableCell({
    borders: bordes, width: { size: anchos[i], type: WidthType.DXA },
    shading: esCab ? { type: ShadingType.CLEAR, color: "auto", fill: "1F3864" } : undefined,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: [new Paragraph({ children: esCab ? [t(txt, { bold: true, color: "FFFFFF", size: 19 })] : runs(txt).map((r) => r) })],
  });
  return [
    new Paragraph({ keepNext: true, spacing: { before: 160, after: 60 },
      children: [t(`Tabla ${nTab}. `, { bold: true, size: 20 }), t(titulo, { italics: true, size: 20 })] }),
    new Table({
      width: { size: total, type: WidthType.DXA }, columnWidths: anchos,
      rows: [new TableRow({ tableHeader: true, children: cabecera.map((c, i) => celda(c, i, true)) }),
        ...filas.map((f) => new TableRow({ children: f.map((c, i) => celda(c, i, false)) }))],
    }),
    new Paragraph({ spacing: { after: 120 }, children: [] }),
  ];
}

// ---------------------------------------------------------------- datos
const INTEGRANTES = ["Simna De Gracia", "Gabriel González", "Andy Martínez", "Joel Medina", "Jorge Medina",
  "Bradley Morales", "Anyurie Sánchez", "Walter Sanjur", "Jeison Vásquez"];
const existe = (rel) => fs.existsSync(path.join(EV, rel));
const leer = (rel) => existe(rel) ? fs.readFileSync(path.join(EV, rel), "utf8") : "";

// ================================================================ plantillas del SDLC seguro: .md + .docx
const PLANTILLAS = require("./plantillas-datos.js");
const DIR_MD = path.join(RAIZ, "docs/sdlc");
const SALIDA_PL = path.join(RAIZ, "docs/SIGET_Plantillas_SDLC_Seguro.docx");
fs.mkdirSync(DIR_MD, { recursive: true });

const celdaMd = (x) => String(x).replace(/\|/g, "\\|");
for (const pl of PLANTILLAS) {
  const md = [`# ${pl.titulo}`, "", `**${pl.etapa}** · Responsable: **${pl.responsable}** · Revisa: **${pl.revisa}**`, "",
    `> ${pl.objetivo} (Red Hat, *Seguridad en el ciclo de vida de desarrollo del software*.)`, "", "## Cómo completarla", "",
    ...pl.instrucciones.map((x, i) => `${i + 1}. ${x}`), ""];
  for (const s of pl.secciones) {
    md.push(`## ${s.titulo}`, "");
    if (s.texto) md.push(s.texto, "");
    if (s.tabla) {
      md.push(`| ${s.tabla.cab.map(celdaMd).join(" | ")} |`, `|${s.tabla.cab.map(() => "---").join("|")}|`);
      for (const f of s.tabla.filas) md.push(`| ${f.map(celdaMd).join(" | ")} |`);
      md.push("");
    }
  }
  fs.writeFileSync(path.join(DIR_MD, pl.archivo), md.join("\n"), "utf8");
}

// .docx: una sección por plantilla, en horizontal para que las tablas anchas se lean
const ANCHO_H = 12960; // 9" útiles en carta horizontal con márgenes de 1"
function tablaAncha(cab, filas) {
  const pesos = cab.map((c, i) => Math.max(c.length, ...filas.map((f) => String(f[i] || "").length), 6));
  const total = pesos.reduce((a, b) => a + b, 0);
  const anchos = pesos.map((p) => Math.max(700, Math.round((p / total) * ANCHO_H)));
  const ajuste = ANCHO_H - anchos.reduce((a, b) => a + b, 0); anchos[anchos.length - 1] += ajuste;
  return tabla("", cab, filas.map((f) => f.map((x) => String(x))), anchos).slice(1);
}
const portadaPl = [
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 1400, after: 120 }, children: [t("SIGET — Grupo Ciber5", { bold: true, size: 30 })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 160 }, children: [t("Plantillas de trabajo del ciclo de vida de desarrollo seguro", { bold: true, size: 40, color: "1F3864" })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 600 }, children: [t("Una plantilla por etapa, con ejemplos resueltos. Cada responsable completa la suya.", { italics: true, size: 24 })] }),
  ...tablaAncha(["Plantilla", "Etapa", "Responsable", "Revisa", "Archivo en el repositorio"],
    PLANTILLAS.map((pl) => [pl.titulo, pl.etapa, pl.responsable, pl.revisa, `docs/sdlc/${pl.archivo}`])),
  p("Se puede completar en este documento o en el archivo del repositorio; la versión que se entrega es la del repositorio (por pull request a `develop`). Lo que dice **[completar]** es lo que falta llenar."),
];
const seccionesPl = PLANTILLAS.map((pl) => ({
  properties: { page: { size: { width: 12240, height: 15840, orientation: PageOrientation.LANDSCAPE }, margin: { top: 1080, right: 1440, bottom: 1080, left: 1440 } } },
  footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [t(`${pl.etapa} · ${pl.responsable} · `, { size: 18, color: "808080" }), new TextRun({ children: [PageNumber.CURRENT], size: 18, color: "808080", font: FUENTE })] })] }) },
  children: [
    h1(`${pl.etapa}: ${pl.titulo}`),
    p(`**Responsable:** ${pl.responsable} · **Revisa:** ${pl.revisa} · **Archivo:** \`docs/sdlc/${pl.archivo}\``, { alignment: AlignmentType.LEFT }),
    p(`**Objetivo:** ${pl.objetivo}`),
    h2("Cómo completarla"),
    ...pl.instrucciones.map((x) => paso(x)),
    ...pl.secciones.flatMap((s) => [h2(s.titulo), ...(s.texto ? [p(s.texto)] : []), ...(s.tabla ? tablaAncha(s.tabla.cab, s.tabla.filas) : [])]),
  ],
}));

const docPl = new Document({
  creator: "Grupo Ciber5", title: "Plantillas del SDLC seguro de SIGET",
  styles: {
    default: { document: { run: { font: FUENTE, size: 21 } } },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: FUENTE, size: 30, bold: true, color: "1F3864" }, paragraph: { spacing: { before: 0, after: 140 }, keepNext: true, outlineLevel: 0 } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: FUENTE, size: 24, bold: true, color: "2E5597" }, paragraph: { spacing: { before: 200, after: 100 }, keepNext: true, outlineLevel: 1 } },
    ],
  },
  numbering: { config: [
    { reference: "vinetas", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
    { reference: "pasos", levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
  ] },
  sections: [{ properties: { page: { size: { width: 12240, height: 15840, orientation: PageOrientation.LANDSCAPE }, margin: { top: 1080, right: 1440, bottom: 1080, left: 1440 } } }, children: portadaPl }, ...seccionesPl],
});
Packer.toBuffer(docPl).then((buf) => { fs.writeFileSync(SALIDA_PL, buf); console.log("OK", SALIDA_PL, PLANTILLAS.length, "plantillas"); });
