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

// ================================================================ contenido
const portada = [
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 600, after: 80 }, children: [t("UNIVERSIDAD TECNOLÓGICA DE PANAMÁ", { bold: true, size: 32 })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 80 }, children: [t("Ciberseguridad 5", { size: 26 })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 900 }, children: [t("Proyecto semestral — Grupo Ciber5", { size: 24 })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 160 }, children: [t("Análisis del mantenimiento de SIGET en las cuatro fases del ciclo de vida de Red Hat", { bold: true, size: 38, color: "1F3864" })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 900 }, children: [t("Estado actual de la plataforma, ubicación de cada componente en su fase y plan de mantenimiento", { italics: true, size: 26 })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 120 }, children: [t("Integrantes", { bold: true, size: 24 })] }),
  ...INTEGRANTES.map((n) => new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 40 }, children: [t(n, { size: 23 })] })),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 500, after: 60 }, children: [t("Profesor: ", { bold: true }), t("[nombre del profesor]")] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 60 }, children: [t("Panamá, noviembre de 2026")] }),
  salto(),
];

const indice = [
  new Paragraph({ children: [t("Contenido", { bold: true, size: 32, color: "1F3864" })], spacing: { after: 200 } }),
  new TableOfContents("Contenido", { hyperlink: true, headingStyleRange: "1-2" }),
  p("(Si el índice aparece vacío, en Word: clic derecho sobre él → «Actualizar campos».)", { alignment: AlignmentType.LEFT }),
  salto(),
];

const intro = [
  h1("1. Introducción"),
  p("Todo sistema en producción vive dentro del ciclo de vida de las piezas sobre las que se construye. SIGET corre sobre **Rocky Linux 9**, una reconstrucción binaria de **Red Hat Enterprise Linux 9 (RHEL 9)**, usa contenedores basados en las **imágenes UBI 9** de Red Hat y se apoya en PostgreSQL 16, Python 3.12, Django 5.2 y nginx 1.26. Cada una de esas piezas tiene fechas en las que deja de recibir mejoras, correcciones o parches de seguridad. Mantener la plataforma es, en buena parte, **saber en qué fase está cada pieza y actuar antes de que llegue a la siguiente**."),
  p("Este informe aplica las **cuatro fases del ciclo de vida de RHEL** que publica Red Hat (soporte completo, soporte de mantenimiento, ciclo de vida extendido y fase de vida extendida) al estado **real** de SIGET, medido en sus dos máquinas virtuales el 12 de noviembre de 2026, y propone un plan de mantenimiento con fechas."),
  h2("1.1 Alcance y metodología"),
  vineta("**Fuentes oficiales:** las páginas de ciclo de vida de Red Hat (RHEL, Application Streams, UBI y Container Tools), la API de ciclos de vida de productos de Red Hat, y las políticas de Rocky Linux, PostgreSQL, Python, Django y Node.js. Todas consultadas el 12 de noviembre de 2026 (ver bibliografía)."),
  vineta("**Inspección de la plataforma:** comandos de solo lectura en VM1 (`app-backend`, 192.168.159.137) y VM2 (`db-server`, 192.168.100.20): versión del sistema, kernel, avisos de seguridad pendientes (`dnf updateinfo`), historial de `dnf` y versiones dentro de los contenedores. Para el análisis no se modificó nada en las máquinas. Cada salida está como captura y como texto en `docs/mantenimiento/evidencia/`."),
  vineta("**Análisis:** se ubica cada componente en su fase, se identifican los riesgos de mantenimiento y se arma un calendario de acciones."),
  salto(),
];

const marco = [
  h1("2. El ciclo de vida de RHEL en cuatro fases"),
  p("Red Hat publica para cada versión mayor de RHEL un ciclo de vida de **diez años de soporte estándar más cuatro de soporte extendido opcional**, dividido en cuatro fases. Para RHEL 9 (disponible desde el 18 de mayo de 2022) las fechas son las siguientes. Red Hat advierte que las fechas futuras son aproximaciones y pueden cambiar."),
  ...tabla("Fases del ciclo de vida de RHEL 9 (API de Product Life Cycles de Red Hat)", ["Fase", "Desde", "Hasta", "Qué entrega Red Hat"], [
    ["1. Soporte completo (Full Support)", "18-may-2022", "31-may-2027", "Correcciones de seguridad y de errores, **versiones menores** nuevas, habilitación de hardware nuevo, mejoras de software e imágenes de instalación actualizadas"],
    ["2. Soporte de mantenimiento (Maintenance Support)", "1-jun-2027", "31-may-2032", "Solo correcciones de seguridad y de errores según el criterio estándar. **Sin funciones nuevas, sin versiones menores y sin Application Streams nuevos**"],
    ["3. Ciclo de vida extendido (ELS / ELCP, de pago)", "1-jun-2032", "31-may-2036", "Correcciones según el criterio estándar, solo para la versión menor elegible y **solo con suscripción adicional**"],
    ["4. Fase de vida extendida (Extended Life Phase)", "1-jun-2036", "sin fin", "Solo asistencia para instalaciones existentes: **ni correcciones de errores ni de seguridad**"],
  ], [2500, 1150, 1150, 4560]),
  p("**Criterio estándar de correcciones** (vigente desde el 1 de abril de 2025): Red Hat publica avisos de seguridad para vulnerabilidades críticas, importantes y moderadas con CVSS de 7 o más, y correcciones de errores urgentes y de alta prioridad seleccionadas."),
  p("**Nota sobre los nombres de la tercera fase:** en 2026 Red Hat unificó sus ofertas extendidas bajo «Extended Life Cycle Premium» (ELCP). La API de ciclos de vida todavía la llama «Extended life cycle support (ELS) add-on» y la página de ofertas heredadas, «Extended Life Cycle (ELC)». En los tres casos se trata de la misma fase de pago posterior al soporte de mantenimiento."),
  h2("2.1 Versiones menores, Application Streams e imágenes UBI"),
  vineta("**Versiones menores (9.0, 9.1… 9.10):** son acumulativas y, según las fechas publicadas, salen cada seis meses (mayo y noviembre). La última de RHEL 9 será la 9.10."),
  vineta("**Rocky Linux** reproduce las fases 1 y 2 de RHEL 9: soporte activo hasta el 31-may-2027 y soporte de seguridad hasta el 31-may-2032. **No tiene equivalente a la fase 3.** Además, su política es explícita: solo se da soporte a la última versión menor; ninguna versión menor sigue soportada después de que sale la siguiente."),
  vineta("**Application Streams:** las versiones de lenguajes y servicios que trae RHEL (Python 3.12, nginx 1.26, PostgreSQL 16) tienen un ciclo **igual o más corto** que el de RHEL. Al retirarse, dejan de recibir actualizaciones y correcciones."),
  vineta("**Imágenes UBI 9:** siguen el ciclo de RHEL 9, se reconstruyen cada seis semanas (antes si aparece un CVE crítico o importante) y no tienen fase EUS. Sobre un sistema que no es de Red Hat, como Rocky, reciben actualizaciones pero sin soporte de Red Hat."),
  salto(),
];

const inventario = [
  h1("3. Inventario de SIGET y fase de cada componente"),
  p("Versiones medidas en las máquinas el 12 de noviembre de 2026, con la fecha de fin de soporte que publica el responsable de cada pieza."),
  ...tabla("Componentes de SIGET, su origen y su fin de soporte", ["Componente", "Versión en SIGET", "Ciclo que lo gobierna", "Fin de soporte", "Estado hoy"], [
    ["Sistema operativo (VM1 y VM2)", "Rocky Linux **9.7**, kernel 5.14.0-611.5.1.el9_7", "Rocky 9 (sigue a RHEL 9)", "Soporte activo 31-may-2027; seguridad 31-may-2032", "**Fase 1, pero en una versión menor sin soporte**: la 9.8 salió el 28-may-2026"],
    ["Contenedores (Podman)", "5.8.2", "Container Tools (rolling) de RHEL 9", "Toda la vida de RHEL 9", "Fase 1; se actualiza con el sistema"],
    ["Imagen base del backend", "UBI 9.8 + Python 3.12.15", "UBI 9 y Application Stream Python 3.12", "Application Stream: **abril de 2027**; Python upstream: oct-2028", "Fase 1, **el componente que vence antes**"],
    ["Django", "5.2.18 (LTS)", "Django Software Foundation", "Abril de 2028 (desde dic-2025 solo seguridad)", "En soporte extendido: solo seguridad"],
    ["nginx (imagen)", "UBI **9.7** + nginx 1.26.3 (imagen de hace 6 meses)", "Application Stream nginx 1.26", "Mayo de 2028", "Fase 1, pero **la imagen no se ha reconstruido** con las correcciones de 9.8"],
    ["PostgreSQL (imagen)", "16.15 sobre **Debian** (`docker.io/library/postgres`)", "**Proyecto PostgreSQL**, no Red Hat", "9-nov-2028 (la versión menor vigente ya es 16.16)", "Fuera del ciclo de Red Hat; una versión menor atrás"],
    ["PostgreSQL nativo (VM2)", "postgresql-server 16.15, servicio inactivo", "Application Stream PostgreSQL 16", "Mayo de 2029", "**Instalado sin usarse**: superficie que no aporta nada"],
    ["Apache y PHP (checkpoint, VM1)", "httpd 2.4.62, PHP 8.3", "Application Streams de RHEL 9", "Según el Application Stream", "Servicio heredado pendiente de retiro (PT-13)"],
    ["Herramientas del frontend", "Node.js 24, React 18", "Node.js / Meta", "Node 24: 30-abr-2028; React 18: sin fecha oficial", "Solo se usan para compilar la interfaz"],
  ], [1650, 1900, 1750, 1900, 2160]),
  ...figura("01_vm1_sistema.png", "VM1: Rocky Linux 9.7, kernel y Podman instalados."),
  ...figura("02_vm2_sistema.png", "VM2: Rocky Linux 9.7, kernel y Podman instalados."),
  ...figura("08_vm1_contenedores.png", "VM1: imágenes de contenedor; el backend usa UBI 9.8 y la de nginx sigue en UBI 9.7."),
  ...figura("09_vm2_contenedores.png", "VM2: PostgreSQL en una imagen Debian de docker.io y el servidor nativo instalado pero inactivo."),
  salto(),
];

const fases = [
  h1("4. Análisis de SIGET en cada una de las cuatro fases"),
  h2("4.1 Fase 1 — Soporte completo (hoy, hasta el 31 de mayo de 2027)"),
  p("Es la fase más favorable: llegan correcciones, versiones menores y mejoras. **Mantener aquí significa absorber esas actualizaciones de forma regular.** La inspección muestra que SIGET no lo está haciendo:"),
  vineta("**Nunca se ejecutó una actualización completa del sistema.** El historial de `dnf` de ambas máquinas tiene solo instalaciones puntuales (Apache, PHP, pgAdmin, Tailscale, Podman, open-vm-tools); no hay ningún `dnf update`."),
  vineta("**Hay 170 avisos de seguridad pendientes en VM1 y 177 en VM2**, de ellos **2 críticos** en cada una (`ca-certificates`, RLSA-2026:88459, y las bibliotecas de Samba, RLSA-2026:25049) y más de 90 importantes. Unos 50 son del kernel."),
  vineta("**Las máquinas están en la versión menor 9.7, que Rocky dejó de soportar el 28 de mayo de 2026** al publicar la 9.8. VM1 está además en un estado mixto: los paquetes instalados después de esa fecha (Apache, PHP) ya vienen de los repositorios de 9.8, pero el sistema base sigue en 9.7."),
  vineta("**Las imágenes de contenedor no se reconstruyen a la par:** la del backend está en UBI 9.8 (se reconstruyó al desplegar), pero la de nginx tiene seis meses y sigue en UBI 9.7, aunque Red Hat publica imágenes nuevas cada seis semanas."),
  ...figura("03_vm1_avisos.png", "VM1: avisos de seguridad pendientes por severidad."),
  ...figura("04_vm2_avisos.png", "VM2: avisos de seguridad pendientes por severidad."),
  ...figura("05_vm1_criticos.png", "VM1: los dos avisos críticos pendientes."),
  ...figura("06_vm1_kernel.png", "VM1: kernel instalado de 9.7 frente al disponible en 9.8."),
  ...figura("07_historial_dnf.png", "VM1: historial de dnf sin ninguna actualización completa del sistema."),
  ...figura("07b_historial_dnf_vm2.png", "VM2: historial de dnf, también sin actualizaciones completas."),
  p("**Qué corresponde hacer en esta fase:** actualizar ambas VMs a 9.8 con respaldo previo y reinicio en una ventana acordada; reconstruir las imágenes de contenedor con la base más reciente; establecer una rutina mensual de parches; y, antes de que termine la fase, **migrar todo lo que dependa de piezas que vencen pronto**, porque en la fase 2 ya no llegan versiones nuevas de los Application Streams."),
  h2("4.2 Fase 2 — Soporte de mantenimiento (1-jun-2027 a 31-may-2032)"),
  p("Solo llegan correcciones de seguridad y de errores; **no hay versiones menores ni Application Streams nuevos**. Para SIGET esto tiene tres consecuencias concretas:"),
  vineta("**Python 3.12 vence en abril de 2027**, antes de que empiece esta fase. La imagen del backend tiene que pasar a un Application Stream de Python más nuevo mientras RHEL 9 todavía los publica (fase 1). Si no, el backend queda sobre un intérprete sin parches durante toda la fase 2."),
  vineta("**Django 5.2 vence en abril de 2028** y **nginx 1.26 en mayo de 2028**: dentro de esta fase hay que pasar a la siguiente versión LTS de Django y a una versión de nginx con soporte. Como en la fase 2 no hay Application Streams nuevos, la alternativa para nginx es usar una imagen UBI de una versión posterior o planificar el salto a RHEL/Rocky 10."),
  vineta("**PostgreSQL 16 vence el 9 de noviembre de 2028** según el proyecto PostgreSQL, que es el que gobierna nuestra imagen Debian. Hay que planificar la migración a una versión mayor con `pg_upgrade` o con volcado y restauración (el respaldo diario con restauración probada ya existe), o pasar a la imagen de PostgreSQL de Red Hat, cuyo Application Stream dura hasta mayo de 2029."),
  h2("4.3 Fase 3 — Ciclo de vida extendido (1-jun-2032 a 31-may-2036)"),
  p("Esta fase **solo existe con una suscripción adicional de Red Hat** y para una versión menor elegible. **Rocky Linux no ofrece nada equivalente**: para SIGET, el 31 de mayo de 2032 es el fin real de los parches de seguridad del sistema operativo. La acción que corresponde es **migrar a Rocky Linux 10 (o RHEL 10) bastante antes de esa fecha**. Las piezas que ya están en contenedores (backend, nginx, PostgreSQL) facilitan el traslado, porque dependen poco del sistema anfitrión."),
  h2("4.4 Fase 4 — Fase de vida extendida (desde el 1-jun-2036)"),
  p("Sin correcciones de errores ni de seguridad: solo asistencia para instalaciones existentes. **Ningún sistema que publique servicios debe llegar a esta fase.** Para SIGET se trata como un límite que no se cruza: el plan de la sección 6 termina la migración mucho antes."),
  salto(),
];

const hallazgos = [
  h1("5. Hallazgos"),
  ...tabla("Hallazgos del análisis de mantenimiento", ["#", "Hallazgo", "Riesgo", "Fase afectada"], [
    ["1", "Ninguna actualización completa del sistema desde la instalación; 170 y 177 avisos de seguridad pendientes (2 críticos en cada VM)", "**Alto**", "1"],
    ["2", "Las VMs corren Rocky 9.7, versión menor sin soporte desde el 28-may-2026; VM1 en estado mixto 9.7/9.8", "**Alto**", "1"],
    ["3", "Kernel de 9.7 con unos 50 avisos de kernel pendientes", "**Alto**", "1"],
    ["4", "El Application Stream de Python 3.12 (imagen del backend) se retira en abril de 2027", "**Alto** (fecha próxima)", "1 → 2"],
    ["5", "La imagen de nginx tiene seis meses (UBI 9.7) y no se reconstruye a la par del sistema", "Medio", "1"],
    ["6", "PostgreSQL usa una imagen Debian de docker.io: queda fuera del ciclo de Red Hat y una versión menor atrás (16.15 frente a 16.16)", "Medio", "2"],
    ["7", "PostgreSQL nativo instalado sin usarse en VM2; imagen de prueba `quay.io/podman/hello` sin uso", "Bajo", "—"],
    ["8", "Django 5.2 (abr-2028), nginx 1.26 (may-2028) y PostgreSQL 16 (nov-2028) vencen dentro de la fase 2", "Medio (planificable)", "2"],
    ["9", "Rocky no tiene fase 3: el soporte de seguridad del sistema termina el 31-may-2032", "Medio (planificable)", "3"],
  ], [500, 5560, 1700, 1600]),
  salto(),
];

const plan = [
  h1("6. Plan de mantenimiento"),
  h2("6.1 Calendario"),
  ...tabla("Acciones de mantenimiento con fecha límite", ["Cuándo", "Acción", "Hallazgo"], [
    ["Inmediato (nov-2026)", "Respaldo verificado de la base y de VM1 (incluida la clave de documentos, guardada aparte). Actualizar VM2 y luego VM1 a Rocky 9.8 con `dnf update`, en una ventana acordada, y reiniciar. Comprobar que todo arranca solo y correr las verificaciones y el ensayo", "1, 2, 3"],
    ["Inmediato", "Reconstruir la imagen de nginx con la UBI 9 más reciente y actualizar la imagen de PostgreSQL a 16.16", "5, 6"],
    ["Inmediato", "Desinstalar el PostgreSQL nativo de VM2, cerrar su puerto y borrar la imagen de prueba", "7"],
    ["Antes de abril de 2027", "Pasar la imagen del backend a un Application Stream de Python vigente y validar con las 555 pruebas del backend y el ensayo", "4"],
    ["Antes del 31-may-2027", "Dejar la plataforma en la última versión menor disponible al cerrar la fase 1 y con todas las imágenes reconstruidas", "2, 5"],
    ["2027–2028", "Migrar a la siguiente versión LTS de Django (antes de abr-2028), a una versión de nginx con soporte (antes de may-2028) y a una versión mayor de PostgreSQL (antes del 9-nov-2028), cada una con su propio ensayo y respaldo", "8"],
    ["2029–2031", "Planificar y ejecutar la migración a Rocky Linux 10 / RHEL 10, empezando por una VM de prueba", "9"],
    ["31-may-2032", "Fecha límite: ningún servicio de SIGET sobre Rocky 9", "9"],
  ], [1800, 6260, 1300]),
  h2("6.2 Rutina permanente"),
  vineta("**Mensual:** revisar `dnf updateinfo` en ambas VMs y aplicar los avisos críticos e importantes. Los críticos se aplican antes, en cuanto aparecen."),
  vineta("**Cada seis semanas** (la cadencia de reconstrucción de UBI): reconstruir las imágenes del backend y de nginx y desplegarlas con el procedimiento de respaldo y vuelta atrás que ya se usa."),
  vineta("**Cada seis meses**, con cada versión menor nueva (mayo y noviembre): actualizar de versión menor en la ventana siguiente, porque Rocky deja de soportar la anterior apenas sale la nueva."),
  vineta("**Una vez al año:** revisar esta tabla de fechas contra las fuentes oficiales, porque Red Hat aclara que las fechas futuras pueden cambiar."),
  vineta("**Siempre:** cada actualización con respaldo previo, verificaciones contra la base real (`verificar_*`), ensayo de la demostración y registro en el runbook y en el CHANGELOG, como se hizo en los despliegues de noviembre."),
  salto(),
];

const conclusiones = [
  h1("7. Conclusiones"),
  p("SIGET está hoy en la mejor fase del ciclo de vida de RHEL 9, la de soporte completo, pero **no la está aprovechando**: lleva toda su vida sin una actualización completa, corre una versión menor que Rocky ya no soporta y acumula avisos de seguridad críticos. Lo positivo es que la arquitectura en contenedores, los respaldos con restauración probada y las verificaciones automáticas permiten corregirlo con poco riesgo y medirlo después. Las fechas importantes no están lejos: abril de 2027 para Python 3.12 y mayo de 2027 para el fin de la fase 1."),
  p("Cada integrante agrega su conclusión en su apartado."),
  ...INTEGRANTES.flatMap((n) => [h2(n), new Paragraph({ spacing: { after: 240 }, children: [t("[Escribe aquí tu conclusión.]", { italics: true, color: "808080" })] })]),
  salto(),
];

const refs = [
  "Django Software Foundation. (s.f.). *Download Django: Supported versions*. Recuperado el 12 de noviembre de 2026, de https://www.djangoproject.com/download/",
  "Node.js Release Working Group. (s.f.). *Node.js release schedule* [Conjunto de datos]. GitHub. Recuperado el 12 de noviembre de 2026, de https://github.com/nodejs/Release",
  "PostgreSQL Global Development Group. (s.f.). *Versioning policy*. Recuperado el 12 de noviembre de 2026, de https://www.postgresql.org/support/versioning/",
  "Python Software Foundation. (s.f.). *Status of Python versions*. Python Developer's Guide. Recuperado el 12 de noviembre de 2026, de https://devguide.python.org/versions/",
  "Red Hat. (s.f.). *Red Hat Enterprise Linux life cycle*. Recuperado el 12 de noviembre de 2026, de https://access.redhat.com/support/policy/updates/errata",
  "Red Hat. (s.f.). *Red Hat Enterprise Linux legacy extended support offerings*. Recuperado el 12 de noviembre de 2026, de https://access.redhat.com/support/policy/updates/errata_legacy",
  "Red Hat. (s.f.). *Product life cycles API: Red Hat Enterprise Linux* [Conjunto de datos]. Recuperado el 12 de noviembre de 2026, de https://access.redhat.com/product-life-cycles/",
  "Red Hat. (s.f.). *Red Hat Enterprise Linux Application Streams life cycle*. Recuperado el 12 de noviembre de 2026, de https://access.redhat.com/support/policy/updates/rhel-app-streams-life-cycle",
  "Red Hat. (s.f.). *Red Hat Universal Base Image: Content availability*. Recuperado el 12 de noviembre de 2026, de https://access.redhat.com/support/policy/updates/ubi",
  "Red Hat. (s.f.). *Container Tools AppStream: Content availability*. Recuperado el 12 de noviembre de 2026, de https://access.redhat.com/support/policy/updates/containertools",
  "Red Hat. (2024, 3 de mayo). *Red Hat Enterprise Linux 9 Extended Update Support (EUS) and Enhanced EUS FAQ*. https://access.redhat.com/articles/rhel9-eus-faq",
  "Red Hat Developer. (2026, 10 de abril). *Universal Base Images FAQ*. https://developers.redhat.com/articles/ubi-faq",
  "Rocky Enterprise Software Foundation. (s.f.). *Rocky Linux releases*. Rocky Linux Documentation. Recuperado el 12 de noviembre de 2026, de https://docs.rockylinux.org/10/releases/",
];
const bibliografia = [
  h1("8. Bibliografía"),
  ...refs.map((r) => new Paragraph({ indent: { left: 720, hanging: 720 }, spacing: { after: 120, line: 276 },
    children: r.split(/(\*[^*]+\*)/g).filter(Boolean).map((s) => s.startsWith("*") ? t(s.slice(1, -1), { italics: true }) : t(s)) })),
];

const doc = new Document({
  creator: "Grupo Ciber5", title: "Análisis del mantenimiento de SIGET en el ciclo de vida de Red Hat", features: { updateFields: true },
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
    footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [t("SIGET — Mantenimiento y ciclo de vida · ", { size: 18, color: "808080" }), new TextRun({ children: [PageNumber.CURRENT], size: 18, color: "808080", font: FUENTE })] })] }) },
    children: [...portada, ...indice, ...intro, ...marco, ...inventario, ...fases, ...hallazgos, ...plan, ...conclusiones, ...bibliografia],
  }],
});
Packer.toBuffer(doc).then((buf) => { fs.writeFileSync(SALIDA, buf); console.log("OK", SALIDA, `${nFig} figuras, ${nTab} tablas`); });
