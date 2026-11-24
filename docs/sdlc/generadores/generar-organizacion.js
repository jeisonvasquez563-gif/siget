// Genera el análisis de mantenimiento de SIGET según el ciclo de vida de Red Hat (.docx).
const fs = require("fs");
const path = require("path");
const {
  Document, Packer, Paragraph, TextRun, ImageRun, Table, TableRow, TableCell, HeadingLevel, AlignmentType,
  WidthType, ShadingType, BorderStyle, PageBreak, LevelFormat, Footer, PageNumber, TableOfContents,
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

// ================================================================ informe de organización (SDLC seguro)
const SALIDA_ORG = path.join(RAIZ, "docs/SIGET_Organizacion_SDLC_Seguro.docx");

const portadaOrg = [
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 600, after: 80 }, children: [t("UNIVERSIDAD TECNOLÓGICA DE PANAMÁ", { bold: true, size: 32 })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 80 }, children: [t("Ciberseguridad 5", { size: 26 })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 800 }, children: [t("Proyecto semestral — Grupo Ciber5", { size: 24 })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 160 }, children: [t("Organización del equipo para implementar el ciclo de vida de desarrollo seguro en SIGET", { bold: true, size: 38, color: "1F3864" })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 800 }, children: [t("Las 8 etapas del SDLC seguro de Red Hat: responsables, tareas, entregables y calendario", { italics: true, size: 26 })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 120 }, children: [t("Integrantes", { bold: true, size: 24 })] }),
  ...INTEGRANTES.map((n) => new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 40 }, children: [t(n, { size: 23 })] })),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 500, after: 60 }, children: [t("Profesor: ", { bold: true }), t("[nombre del profesor]")] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 60 }, children: [t("Panamá, 12 de noviembre de 2026")] }),
  salto(),
];

const objetivo = [
  h1("1. Objetivo"),
  p("Implementar en SIGET las **ocho etapas del ciclo de vida de desarrollo de software seguro** que describe Red Hat (*Seguridad en el ciclo de vida de desarrollo del software*, actualizado el 27 de agosto de 2026): planificación, análisis de requisitos, diseño, desarrollo, documentación, pruebas, implementación y mantenimiento. La idea central es aplicar la seguridad **desde el inicio y en cada etapa** (*shift left*), con responsabilidad compartida entre desarrollo, operaciones y seguridad (*DevSecOps*)."),
  p("Este documento define **quién hace qué**: cada integrante es responsable de una etapa, con tareas concretas, un entregable verificable, la persona que lo revisa y una fecha. SIGET ya cubre parte de cada etapa; aquí se reparte lo que falta."),
  h2("1.1 Reglas de trabajo para todo el equipo"),
  vineta("**Cada entregable va al repositorio** en una rama propia (`docs/sdlc-<etapa>` o `feature/...`) y entra por **pull request a `develop`** con la revisión de otra persona. Nadie sube directo a `develop` ni a `main`."),
  vineta("**Las plantillas ya están preparadas** en `docs/sdlc/` (sección 4). Cada persona completa la suya; no se empieza de cero."),
  vineta("**Ningún cambio en las máquinas virtuales** sin la aprobación de Jeison. Las tareas de supervisión son de solo lectura."),
  vineta("**Nunca se suben contraseñas, claves ni datos personales** al repositorio ni a los documentos de entrega."),
  vineta("**Si alguien se traba más de un día, avisa en el grupo**: su revisor lo acompaña. Pedir ayuda a tiempo es parte de la tarea."),
  vineta("**Cada integrante escribe su conclusión** en el informe final: qué hizo, qué aprendió y qué haría distinto."),
  salto(),
];

const reparto = [
  h1("2. Reparto de responsabilidades"),
  ...tabla("Responsable de cada etapa del SDLC seguro", ["Etapa", "Responsable", "Revisa", "Entregable"], [
    ["Coordinación general e infraestructura (etapa 7)", "**Jeison Vásquez**", "Andy Martínez", "Revisión del entorno de despliegue, actualización de las VMs y aprobación de todo cambio en producción"],
    ["1. Planificación", "**Simna De Gracia**", "Jeison Vásquez", "Registro de riesgos de SIGET"],
    ["2. Análisis de requisitos", "**Gabriel González**", "Simna De Gracia", "Matriz de requisitos de seguridad y cumplimiento"],
    ["3. Diseño", "**Joel Medina**", "Andy Martínez", "Modelo de amenazas STRIDE"],
    ["4. Desarrollo", "**Andy Martínez**", "Jeison Vásquez", "Seguridad automatizada en el CI y guía de codificación segura"],
    ["5. Documentación", "**Jorge Medina**", "Gabriel González", "Política de seguridad (`SECURITY.md`) e inventario de controles"],
    ["6. Pruebas", "**Bradley Morales**", "Joel Medina", "Plan de pruebas de seguridad y lista de revisión de código"],
    ["8. Mantenimiento: supervisión", "**Anyurie Sánchez**", "Walter Sanjur", "Bitácora semanal de supervisión de seguridad"],
    ["8. Mantenimiento: parches y dependencias", "**Walter Sanjur**", "Jeison Vásquez", "Bitácora de parches y calendario de fin de soporte"],
  ], [2400, 1750, 1650, 3560]),
  p("Las dos personas de la etapa 8 trabajan en pareja: una vigila lo que pasa en la plataforma y la otra lo que hay que actualizar."),
  salto(),
];

// ---------------------------------------------------------------- fichas por persona
function ficha(numero, nombre, etapa, porque, pasos, entregable, terminado, revisa) {
  return [
    h2(`3.${numero} ${nombre} — ${etapa}`),
    p(`**Qué busca esta etapa (según Red Hat):** ${porque}`),
    p("**Paso a paso:**"),
    ...pasos.map((x) => paso(x)),
    p(`**Entregable:** ${entregable}`),
    p(`**Está terminado cuando:** ${terminado}`),
    p(`**Revisa:** ${revisa}.`),
  ];
}

const fichas = [
  h1("3. Qué hace cada persona"),
  p("Cada ficha dice qué busca la etapa, los pasos a seguir, qué hay que entregar y cómo saber que está terminado."),
  ...ficha(1, "Simna De Gracia", "Etapa 1: Planificación",
    "evaluar los riesgos y el panorama de amenazas, y el impacto que tendría un incidente de seguridad (por ejemplo, para la reputación de la institución).",
    [
      "Leer `docs/antecedentes.md` (incidentes reales en Panamá) y la sección «Riesgos» de la especificación de pendientes.",
      "Abrir la plantilla `docs/sdlc/01-registro-de-riesgos.md`. Ya trae 5 riesgos de ejemplo.",
      "Agregar al menos 10 riesgos más. Para cada uno completar: qué puede pasar, a qué afecta (datos de ciudadanos, trámites, disponibilidad), probabilidad (baja, media o alta), impacto (bajo, medio o alto) y qué control de SIGET lo reduce.",
      "Para encontrar los controles, buscar en `docs/zero-trust-cobertura.md` y en el informe de análisis estático y dinámico.",
      "Marcar los riesgos sin control como «pendiente» y pasárselos a Jeison.",
    ],
    "`docs/sdlc/01-registro-de-riesgos.md` con al menos 15 riesgos evaluados.",
    "cada riesgo tiene probabilidad, impacto y un control o la marca «pendiente».",
    "Jeison Vásquez"),
  ...ficha(2, "Gabriel González", "Etapa 2: Análisis de requisitos",
    "incluir los requisitos de seguridad desde el principio y entender los requisitos de cumplimiento normativo.",
    [
      "Abrir la plantilla `docs/sdlc/02-requisitos-de-seguridad.md`. Ya trae los requisitos de autenticación como ejemplo.",
      "Completar la matriz para estas áreas: autenticación, autorización, protección de datos personales, auditoría, cifrado, disponibilidad (respaldos) y registro de cuentas.",
      "Para cada requisito, escribir dónde lo cumple SIGET (archivo o prueba) usando `docs/api.md`, `docs/modulos.md` y el CHANGELOG.",
      "Buscar la ley panameña de protección de datos personales en Legispan (Asamblea Nacional) y anotar, con la cita del artículo, qué exige y cómo lo cumple SIGET. **Copiar la referencia exacta, no resumirla de memoria.**",
      "Marcar los requisitos que SIGET todavía no cumple.",
    ],
    "`docs/sdlc/02-requisitos-de-seguridad.md` con la matriz completa y las citas legales.",
    "cada requisito tiene su evidencia en SIGET o la marca «no cumple».",
    "Simna De Gracia"),
  ...ficha(3, "Joel Medina", "Etapa 3: Diseño",
    "elaborar modelos de amenazas e incluir la seguridad como parte integral de la arquitectura.",
    [
      "Leer el diseño Zero Trust (`docs/superpowers/specs/2026-10-08-arquitectura-zero-trust-design.md`) y mirar el diagrama de roles y módulos.",
      "Abrir la plantilla `docs/sdlc/03-modelo-de-amenazas.md`. Explica STRIDE con un ejemplo resuelto: suplantación, alteración, repudio, divulgación de información, denegación de servicio y elevación de privilegios.",
      "Aplicar STRIDE a cada pieza de SIGET: navegador, nginx, backend, base de datos, temporizador de escalamiento y archivos de documentos.",
      "Para cada amenaza, anotar qué control la frena (por ejemplo, la seguridad por filas frena la divulgación entre instituciones) o marcarla como abierta.",
      "Pedirle a Andy 30 minutos para revisar juntos las amenazas que no queden claras.",
    ],
    "`docs/sdlc/03-modelo-de-amenazas.md` con la tabla STRIDE de todos los componentes.",
    "las 6 categorías STRIDE están revisadas en los 6 componentes.",
    "Andy Martínez"),
  ...ficha(4, "Andy Martínez", "Etapa 4: Desarrollo",
    "capacitar en codificación segura, incorporar herramientas de prueba de seguridad en el proceso de desarrollo y evaluar las dependencias.",
    [
      "Revisar y fusionar el flujo `.github/workflows/security-scan.yml`, ya preparado: Bandit, Semgrep, pip-audit, npm audit y Gitleaks corren en cada PR y cada semana.",
      "Revisar `.github/dependabot.yml`, que abre PRs de actualización de dependencias cada semana.",
      "Escribir `docs/sdlc/04-codificacion-segura.md`: entre 10 y 15 reglas con ejemplos de SIGET (consultas con parámetros, nunca `assert` para validar, nada de secretos en el código, rutas generadas por el servidor, etc.).",
      "Dar al equipo una charla de 20 minutos sobre esa guía y sobre cómo leer un fallo del CI de seguridad.",
    ],
    "el flujo de seguridad en verde en `develop` y la guía de codificación segura publicada.",
    "el CI de seguridad corre en cada PR y la charla está dada.",
    "Jeison Vásquez"),
  ...ficha(5, "Jorge Medina", "Etapa 5: Documentación",
    "documentar los procesos y controles de seguridad y reunir la información para auditorías y revisiones.",
    [
      "Revisar y completar `SECURITY.md` (ya preparado): cómo reportar una vulnerabilidad, qué versión tiene soporte y en cuánto tiempo se responde.",
      "Abrir la plantilla `docs/sdlc/05-inventario-de-controles.md` y listar cada control de seguridad de SIGET (segundo factor, bloqueo progresivo, seguridad por filas, auditoría inalterable, cifrado de documentos, TLS 1.3, respaldos…), con dónde está documentado y cómo se verifica.",
      "Comprobar que cada control tiene su entrada en el runbook o en `docs/api.md`. Si falta, anotarlo.",
      "Mantener actualizada la carpeta de evidencias del informe final: cada etapa con su captura.",
    ],
    "`SECURITY.md` y `docs/sdlc/05-inventario-de-controles.md`.",
    "cada control tiene responsable, documento y forma de verificarlo.",
    "Gabriel González"),
  ...ficha(6, "Bradley Morales", "Etapa 6: Pruebas",
    "implementar procesos de revisión de código y hacer pruebas estáticas y dinámicas de seguridad.",
    [
      "Abrir la plantilla `docs/sdlc/06-plan-de-pruebas.md`. Ya lista las pruebas que existen: 555 del backend, 206 del frontend, las verificaciones contra la base real, el ensayo de 101 comprobaciones y los análisis de seguridad.",
      "Correr en tu computadora las pruebas del frontend (`npm test` en `frontend/`) y las del backend (`pytest` en `backend/`) siguiendo el README, y sacar captura del resultado.",
      "Escribir la lista de revisión de código: qué mirar en cada PR (permisos, validación de datos, secretos, pruebas nuevas, CHANGELOG).",
      "Usar esa lista para revisar al menos 2 PR abiertos y dejar los comentarios en GitHub.",
    ],
    "`docs/sdlc/06-plan-de-pruebas.md`, con la lista de revisión y las capturas.",
    "las pruebas corren en tu computadora y hay al menos 2 revisiones hechas con la lista.",
    "Joel Medina"),
  ...ficha(7, "Jeison Vásquez", "Etapa 7: Implementación y coordinación",
    "evaluar la seguridad del entorno de despliegue y revisar las configuraciones de seguridad.",
    [
      "Correr la revisión automática del entorno (script de solo lectura: SELinux, cortafuegos, SSH, puertos abiertos, cabeceras y TLS) y dejar la salida como evidencia.",
      "Actualizar las dos VMs a Rocky 9.8 con respaldo previo, en una ventana acordada, y repetir las verificaciones y el ensayo.",
      "Aprobar o rechazar todo cambio en producción y fusionar los PR revisados.",
      "Coordinar una reunión de seguimiento de 15 minutos dos veces por semana.",
    ],
    "`docs/sdlc/07-revision-del-entorno.md` con la salida de la revisión y el registro de la actualización.",
    "la revisión no tiene hallazgos abiertos y las VMs están en 9.8.",
    "Andy Martínez"),
  ...ficha(8, "Anyurie Sánchez", "Etapa 8: Mantenimiento (supervisión)",
    "supervisar el sistema para detectar amenazas y prepararse para responder a una intrusión.",
    [
      "Pedir a Jeison una cuenta con rol de auditoría en la plataforma (solo lectura).",
      "Una vez por semana, entrar a la consola de auditoría y revisar los eventos de seguridad: inicios de sesión fallidos, cuentas bloqueadas, accesos denegados, documentos alterados y escalamientos.",
      "Anotar en `docs/sdlc/08-bitacora-supervision.md` (plantilla con ejemplo) qué se vio, si hay algo raro y a quién se avisó.",
      "Escribir, con Walter, un procedimiento corto de qué hacer si se detecta una intrusión: a quién avisar, qué no tocar y cómo bloquear una cuenta.",
    ],
    "la bitácora con al menos 2 revisiones semanales y el procedimiento de respuesta.",
    "cada semana tiene su entrada y el procedimiento está revisado por Jeison.",
    "Walter Sanjur"),
  ...ficha(9, "Walter Sanjur", "Etapa 8: Mantenimiento (parches y dependencias)",
    "eliminar los puntos vulnerables que se descubran y mantener el sistema actualizado.",
    [
      "Leer el informe «Análisis del mantenimiento de SIGET en las cuatro fases del ciclo de vida de Red Hat»: ahí están las fechas de fin de soporte de cada componente.",
      "Cada lunes, revisar en GitHub los PR que abra Dependabot y los resultados del CI de seguridad, y anotar en `docs/sdlc/08-bitacora-parches.md` qué se actualizó.",
      "Pedir a Jeison la salida de `dnf updateinfo summary` de las dos VMs una vez por semana y anotar cuántos avisos críticos e importantes quedan.",
      "Mantener el calendario de fin de soporte (Python 3.12 en abril de 2027, Rocky 9 activo hasta mayo de 2027…) y avisar con un mes de anticipación.",
    ],
    "la bitácora de parches con al menos 2 semanas y el calendario actualizado.",
    "cada semana tiene su entrada y ningún aviso crítico queda sin atender más de 7 días.",
    "Jeison Vásquez"),
  salto(),
];

const calendario = [
  h1("4. Calendario y seguimiento"),
  ...tabla("Calendario de trabajo", ["Cuándo", "Qué", "Quién"], [
    ["Jueves 12-nov", "Presentación de esta organización y reparto de plantillas", "Todo el equipo"],
    ["Viernes 13-nov", "Cada persona confirma que abrió su plantilla y que entiende su tarea (o pide ayuda)", "Todo el equipo"],
    ["Lunes 16-nov", "Primera reunión de seguimiento; charla de codificación segura", "Jeison y Andy"],
    ["Lunes 16 a viernes 20-nov", "Etapas 1, 2, 3 y 5 en borrador; CI de seguridad fusionado; primera revisión semanal de supervisión y de parches", "Simna, Gabriel, Joel, Jorge, Andy, Anyurie y Walter"],
    ["Jueves 19-nov", "Segunda reunión de seguimiento; revisión cruzada de los borradores", "Todo el equipo"],
    ["Lunes 23 a miércoles 25-nov", "Correcciones de la revisión; pruebas y revisión de PR (etapa 6); revisión del entorno y actualización de las VMs (etapa 7)", "Bradley y Jeison"],
    ["Jueves 26-nov", "Todo fusionado en `develop`; informe final con las 8 etapas, evidencias y la conclusión de cada integrante", "Todo el equipo"],
  ], [2000, 5260, 2100]),
  p("Las fechas son una propuesta y se ajustan a la fecha de entrega que indique el profesor."),
  h2("4.1 Cómo se mide el avance"),
  vineta("Cada entregable es un PR en GitHub: se ve quién lo hizo, cuándo y quién lo revisó."),
  vineta("En cada reunión de seguimiento, cada persona responde tres preguntas: qué hice, qué voy a hacer y en qué estoy trabado."),
  vineta("Una etapa está terminada cuando cumple su criterio de «terminado» y su revisor aprobó el PR."),
  salto(),
];

const yaHecho = [
  h1("5. Lo que SIGET ya tiene en cada etapa"),
  p("Para que nadie empiece de cero: esto ya existe y sirve como base y como evidencia."),
  ...tabla("Punto de partida por etapa", ["Etapa", "Ya existe en SIGET"], [
    ["1. Planificación", "Antecedentes con incidentes reales en Panamá; especificación con riesgos y mitigaciones"],
    ["2. Requisitos", "Especificación técnica con los 7 principios Zero Trust; contrato de la API"],
    ["3. Diseño", "Arquitectura Zero Trust: decisor de acceso (PDP), seguridad por filas, auditoría inalterable, control dual"],
    ["4. Desarrollo", "555 pruebas del backend y 206 del frontend en el CI; flujo de seguridad y Dependabot preparados"],
    ["5. Documentación", "Runbook con todos los procedimientos, CHANGELOG, contrato de la API, informes entregados"],
    ["6. Pruebas", "Análisis estático y dinámico con correcciones (Bandit, Semgrep, ZAP, Nmap); verificaciones contra la base real; ensayo de 101 comprobaciones; revisión obligatoria en GitHub"],
    ["7. Implementación", "Despliegues con respaldo previo y vuelta atrás automática; endurecimiento de nginx, Apache, PHP y SSH"],
    ["8. Mantenimiento", "Respaldos diarios con restauración probada; escalamiento automático; análisis del ciclo de vida de Red Hat con calendario"],
  ], [2400, 6960]),
];

const docOrg = new Document({
  creator: "Grupo Ciber5", title: "Organización del equipo para el SDLC seguro en SIGET",
  styles: {
    default: { document: { run: { font: FUENTE, size: 22 } } },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: FUENTE, size: 32, bold: true, color: "1F3864" }, paragraph: { spacing: { before: 240, after: 160 }, keepNext: true, outlineLevel: 0 } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: FUENTE, size: 26, bold: true, color: "2E5597" }, paragraph: { spacing: { before: 220, after: 120 }, keepNext: true, outlineLevel: 1 } },
      { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: FUENTE, size: 23, bold: true, color: "404040" }, paragraph: { spacing: { before: 180, after: 100 }, keepNext: true, outlineLevel: 2 } },
    ],
  },
  numbering: { config: [
    { reference: "vinetas", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
    { reference: "pasos", levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
  ] },
  sections: [{
    properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
    footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [t("SIGET — Organización del SDLC seguro · ", { size: 18, color: "808080" }), new TextRun({ children: [PageNumber.CURRENT], size: 18, color: "808080", font: FUENTE })] })] }) },
    children: [...portadaOrg, ...objetivo, ...reparto, ...fichas, ...calendario, ...yaHecho],
  }],
});
Packer.toBuffer(docOrg).then((buf) => { fs.writeFileSync(SALIDA_ORG, buf); console.log("OK", SALIDA_ORG, `${nTab} tablas`); });
