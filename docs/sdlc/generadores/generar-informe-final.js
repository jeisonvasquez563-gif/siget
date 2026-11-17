// Genera el informe final del trabajo realizado en SIGET, con lo que hizo cada integrante (.docx).
// Uso: NODE_PATH=<node_modules con docx> node docs/sdlc/generadores/generar-informe-final.js
const fs = require("fs");
const path = require("path");
const {
  Document, Packer, Paragraph, TextRun, ImageRun, Table, TableRow, TableCell, HeadingLevel, AlignmentType,
  WidthType, ShadingType, BorderStyle, PageBreak, LevelFormat, Footer, PageNumber, TableOfContents,
} = require("docx");

const RAIZ = path.resolve(__dirname, "../../..");
const EV_SDLC = path.join(RAIZ, "docs/sdlc/evidencia");
const EV_ANALISIS = "C:/Users/jeiva/Desktop/Proyecto-Ciber5/docs/analisis-seguridad";
const SALIDA = path.join(RAIZ, "docs/SIGET_Informe_Final_Trabajo_Realizado.docx");
const FUENTE = "Calibri";

// ---------------------------------------------------------------- utilidades
let nFig = 0, nTab = 0;
const t = (texto, o = {}) => new TextRun({ text: texto, font: FUENTE, size: 22, ...o });
const code = (texto) => new TextRun({ text: texto, font: "Consolas", size: 20 });
function runs(texto) {
  const partes = texto.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).filter(Boolean);
  return partes.map((p) => p.startsWith("`") ? code(p.slice(1, -1)) : p.startsWith("**") ? t(p.slice(2, -2), { bold: true }) : t(p));
}
const p = (texto, o = {}) => new Paragraph({ children: runs(texto), spacing: { after: 120, line: 276 }, alignment: AlignmentType.JUSTIFIED, ...o });
const h1 = (texto) => new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(texto)] });
const h2 = (texto) => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(texto)] });
const h3 = (texto) => new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun(texto)] });
const vineta = (texto) => new Paragraph({ numbering: { reference: "vinetas", level: 0 }, children: runs(texto), spacing: { after: 60 } });
const salto = () => new Paragraph({ children: [new PageBreak()] });
// Quién lo hizo y quién lo revisó, al principio de cada sección
const autoria = (hizo, reviso) => new Paragraph({
  spacing: { before: 60, after: 160 }, shading: { type: ShadingType.CLEAR, color: "auto", fill: "EAF1FB" },
  indent: { left: 120, right: 120 },
  children: [t("Realizado por: ", { bold: true, color: "1F3864" }), t(hizo), ...(reviso ? [t("     Revisado por: ", { bold: true, color: "1F3864" }), t(reviso)] : [])],
});

function tamPng(archivo) {
  const b = fs.readFileSync(archivo);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}
function figura(base, rel, leyenda, anchoMax = 600) {
  const archivo = path.join(base, rel);
  if (!fs.existsSync(archivo)) { console.warn("FALTA", archivo); return []; }
  const { w, h } = tamPng(archivo);
  let ancho = Math.min(anchoMax, w), alto = Math.round(h * ancho / w);
  if (alto > 760) { alto = 760; ancho = Math.round(w * alto / h); }
  nFig += 1;
  return [
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 120, after: 40 }, keepNext: true,
      children: [new ImageRun({ type: "png", data: fs.readFileSync(archivo), transformation: { width: ancho, height: alto },
        altText: { title: `Figura ${nFig}`, description: leyenda, name: path.basename(rel) } })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 },
      children: [t(`Figura ${nFig}. `, { bold: true, italics: true, size: 18 }), t(leyenda, { italics: true, size: 18 })] }),
  ];
}
const figA = (rel, leyenda) => figura(EV_ANALISIS, rel, leyenda);
const figS = (rel, leyenda) => figura(EV_SDLC, rel, leyenda);

const borde = { style: BorderStyle.SINGLE, size: 4, color: "A6A6A6" };
const bordes = { top: borde, bottom: borde, left: borde, right: borde };
function tabla(titulo, cabecera, filas, anchos) {
  nTab += 1;
  const total = anchos.reduce((a, b) => a + b, 0);
  const celda = (txt, i, esCab) => new TableCell({
    borders: bordes, width: { size: anchos[i], type: WidthType.DXA },
    shading: esCab ? { type: ShadingType.CLEAR, color: "auto", fill: "1F3864" } : undefined,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: [new Paragraph({ children: esCab ? [t(txt, { bold: true, color: "FFFFFF", size: 19 })] : runs(txt) })],
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

// ---------------------------------------------------------------- portada
const portada = [
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 600, after: 80 }, children: [t("UNIVERSIDAD TECNOLÓGICA DE PANAMÁ", { bold: true, size: 32 })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 80 }, children: [t("Ciberseguridad 5", { size: 26 })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 700 }, children: [t("Proyecto semestral — Grupo Ciber5", { size: 24 })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 160 }, children: [t("SIGET: informe final del trabajo realizado", { bold: true, size: 40, color: "1F3864" })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 600 }, children: [t("Análisis estático y dinámico, correcciones en producción, funcionalidades nuevas, ciclo de vida de desarrollo seguro (8 etapas) y mantenimiento de las máquinas virtuales", { size: 23, italics: true })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 120 }, children: [t("Integrantes", { bold: true, size: 24 })] }),
  ...INTEGRANTES.map((n) => new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 40 }, children: [t(n, { size: 23 })] })),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 500, after: 60 }, children: [t("Profesor: ", { bold: true }), t("[nombre del profesor]")] }),
  new Paragraph({ alignment: AlignmentType.CENTER, children: [t("17 de noviembre de 2026")] }),
  salto(),
  new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Contenido")] }),
  new TableOfContents("Contenido", { hyperlink: true, headingStyleRange: "1-2" }),
  p("Si el índice aparece vacío, en Word: clic derecho sobre él y «Actualizar campos».", { alignment: AlignmentType.LEFT }),
  salto(),
];

// ---------------------------------------------------------------- 1. introducción
const intro = [
  h1("1. Introducción"),
  p("SIGET es la plataforma de gestión de trámites del Estado que el grupo construyó durante el semestre: un backend en Django 5.2 con Django REST Framework, una interfaz en React 18, PostgreSQL 16 con seguridad por filas, y una arquitectura Zero Trust en la que cada acción la decide un punto de decisión de políticas (PDP). Corre en dos máquinas virtuales con Rocky Linux: **VM1** (aplicación, nginx y backend en contenedores Podman sin root) y **VM2** (base de datos)."),
  p("Este informe reúne **todo el trabajo de la última etapa del proyecto** y deja escrito **quién hizo cada parte y quién la revisó**. Cubre cinco frentes:"),
  vineta("**Análisis estático y dinámico** de la plataforma y la corrección de lo encontrado."),
  vineta("**Correcciones aplicadas en producción**, siempre con respaldo previo y vuelta atrás."),
  vineta("**Tres funcionalidades nuevas** desplegadas: plazos con feriados y escalamiento automático (PT-3), registro por invitación (PT-2) y documentos adjuntos cifrados (PT-8)."),
  vineta("**Las ocho etapas del ciclo de vida de desarrollo seguro** de Red Hat implementadas sobre SIGET, una por integrante."),
  vineta("**Mantenimiento de las máquinas virtuales**: actualización a Rocky Linux 9.9, cortafuegos, repositorios y limpieza de instantáneas."),
  p("Todo lo que se afirma aquí tiene evidencia (salida completa en texto y captura) en el repositorio, en `docs/analisis-seguridad/` y `docs/sdlc/evidencia/`, y cada cambio quedó registrado en el `CHANGELOG.md`, el runbook y los pull requests de GitHub."),
  salto(),
];

// ---------------------------------------------------------------- 2. quién hizo qué
const quien = [
  h1("2. Quién hizo qué"),
  p("El reparto sigue la organización que el grupo presentó el 12 de noviembre (`SIGET_Organizacion_SDLC_Seguro.docx`): cada integrante es responsable de un frente, con un entregable verificable y otra persona que lo revisa."),
  ...tabla("Trabajo realizado por cada integrante", ["Integrante", "Responsabilidad", "Trabajo realizado", "Revisó"], [
    ["**Jeison Vásquez**", "Coordinación, infraestructura y etapa 7 (implementación)", "Coordinación del equipo; despliegue en producción de las correcciones y de PT-3, PT-2 y PT-8 con respaldo y vuelta atrás; revisión del entorno de VM1 y VM2; actualización a Rocky 9.9; corrección de los hallazgos del entorno", "Andy Martínez"],
    ["**Simna De Gracia**", "Etapa 1: planificación", "Registro de 24 riesgos con probabilidad, impacto, control y estado", "Jeison Vásquez"],
    ["**Gabriel González**", "Etapa 2: análisis de requisitos", "Matriz de 26 requisitos de seguridad y 11 artículos de las leyes 81 de 2019, 83 de 2012 y 6 de 2002", "Simna De Gracia"],
    ["**Joel Medina**", "Etapa 3: diseño", "Modelo de amenazas STRIDE con diagrama de flujo de datos: 41 amenazas en 6 componentes; diseño de seguridad de los documentos cifrados (PT-8)", "Andy Martínez"],
    ["**Andy Martínez**", "Etapa 4: desarrollo", "Análisis estático (Bandit, Semgrep, pip-audit, npm audit, Gitleaks) y corrección del código; desarrollo de PT-3, PT-2 y PT-8; CI de seguridad automático y Dependabot; 14 reglas de codificación segura", "Jeison Vásquez"],
    ["**Jorge Medina**", "Etapa 5: documentación", "`SECURITY.md`, inventario de 43 controles, CHANGELOG y runbook de cada cambio", "Gabriel González"],
    ["**Bradley Morales**", "Etapa 6: pruebas", "Análisis dinámico (Nmap, OWASP ZAP, verificación manual de la alerta de inyección SQL, pruebas con curl); plan de pruebas; verificaciones contra la base real y ensayo de 101 comprobaciones; revisión de los PR #10 y #12", "Joel Medina"],
    ["**Anyurie Sánchez**", "Etapa 8: supervisión", "Bitácora semanal de supervisión de seguridad y procedimiento ante intrusiones", "Walter Sanjur"],
    ["**Walter Sanjur**", "Etapa 8: parches y dependencias", "Bitácora de parches con línea base y seguimiento; calendario de fin de soporte; deshabilitación de los repositorios con firma inválida y retiro de las instantáneas", "Jeison Vásquez"],
  ], [1700, 2000, 4160, 1500]),
  salto(),
];

// ---------------------------------------------------------------- 3. análisis estático y dinámico
const analisis = [
  h1("3. Análisis estático y dinámico"),
  p("El análisis se hizo dos veces con las mismas herramientas y los mismos parámetros: **antes** de corregir y **después**, sobre el código corregido y la plataforma ya desplegada. El informe completo es `Informe_Analisis_Estatico_Dinamico_SIGET.docx`; aquí va el resumen y quién lo hizo."),
  h2("3.1 Análisis estático (SAST, SCA y secretos)"),
  autoria("Andy Martínez", "Jeison Vásquez"),
  ...tabla("Herramientas del análisis estático", ["Herramienta", "Qué revisa", "Por qué se eligió", "Resultado"], [
    ["Bandit 1.9.4", "Código Python del backend", "Es la herramienta de referencia de PyCQA para Python", "Hallazgos B108, B101 y B106 corregidos; los B105 eran falsos positivos y quedaron justificados en el código"],
    ["Semgrep 1.184", "Todo el código con reglas OWASP, Django, React y secretos", "Cubre Python, JavaScript y la configuración de nginx con reglas mantenidas por la comunidad", "Detectó que nginx aceptaba cualquier nombre de host; corregido"],
    ["pip-audit 2.10", "Dependencias del backend", "Usa la base de vulnerabilidades de PyPI (OSV)", "Sin vulnerabilidades"],
    ["npm audit", "Dependencias del frontend", "Viene con npm y audita el árbol exacto del lockfile", "Vulnerabilidades corregidas al actualizar; quedó en 0"],
    ["Gitleaks 8.30", "Secretos en todo el historial de git", "Revisa cada commit, no solo el código actual", "Hallazgos revisados uno por uno; el ensayo ahora genera su contraseña de prueba"],
  ], [1500, 2200, 2800, 2860]),
  ...figA("antes/02_bandit_backend_01.png", "Bandit sobre el backend, antes de corregir"),
  ...figA("despues/02_bandit_backend_01.png", "Bandit sobre el backend, después de corregir"),
  ...figA("antes/05_semgrep_codigo.png", "Semgrep sobre todo el código, antes de corregir"),
  ...figA("despues/07_npm_audit.png", "npm audit sin vulnerabilidades después de actualizar las dependencias"),
  h2("3.2 Análisis dinámico (DAST)"),
  autoria("Bradley Morales", "Joel Medina"),
  p("Se probó la plataforma **en ejecución**, contra producción en VM1, con Nmap (puertos y TLS), OWASP ZAP (escaneo de la aplicación web) y pruebas manuales con curl. ZAP marcó una posible inyección SQL; se verificó a mano y resultó un **falso positivo** causado por el límite de peticiones de la plataforma. Las pruebas manuales encontraron que nginx respondía a cualquier cabecera Host, que Apache tenía TRACE habilitado y mostraba su versión, y que la cookie de sesión del checkpoint PHP no tenía `HttpOnly` ni `SameSite`."),
  ...figA("antes/10_nmap_puertos_tls_01.png", "Nmap: puertos abiertos y configuración TLS de VM1"),
  ...figA("antes/11b_zap_reporte_html.png", "Reporte de OWASP ZAP antes de corregir"),
  ...figA("antes/12_verificacion_sqli.png", "Verificación manual de la alerta de inyección SQL: falso positivo"),
  ...figA("despues/11b_zap_reporte_html.png", "Reporte de OWASP ZAP después de corregir: sin alertas de riesgo"),
  h2("3.3 Correcciones aplicadas en producción"),
  autoria("Jeison Vásquez (despliegue) y Andy Martínez (código)", "Bradley Morales (verificación)"),
  ...tabla("Correcciones aplicadas en VM1 el 8 de noviembre", ["Cambio", "Respaldo o vuelta atrás"], [
    ["nginx solo acepta los nombres de host de la plataforma", "`nginx.conf.respaldo-2026-11-08`"],
    ["Imagen del backend reconstruida desde el código corregido", "Imagen `siget-backend:respaldo-2026-11-08`"],
    ["Apache: `TraceEnable Off`, `ServerTokens Prod`, `ServerSignature Off`", "Borrar `endurecimiento.conf` y recargar Apache"],
    ["PHP: `expose_php = Off` y cookie de sesión con `HttpOnly`, `SameSite=Strict` y modo estricto", "Borrar `99-siget-endurecimiento.ini` y reiniciar php-fpm"],
  ], [5600, 3760]),
  ...figA("correcciones/08_nginx_desplegar.png", "Despliegue de la configuración corregida de nginx"),
  ...figA("correcciones/11_php_cookie_sesion.png", "Cookie de sesión del checkpoint PHP protegida"),
  salto(),
];

// ---------------------------------------------------------------- 4. funcionalidades nuevas
const funcionalidades = [
  h1("4. Funcionalidades nuevas desplegadas"),
  p("Las tres siguieron el mismo procedimiento de despliegue: respaldo verificado de la base, ensayo de la migración con `ROLLBACK`, migración real, backend e interfaz reconstruidos con respaldo de la imagen anterior y verificaciones contra la base real. Al final, `verificar_tramites` dio 77/77, `verificar_plataforma` 91/91, `verificar_autenticacion` 84/84 y el ensayo completo contra producción 101/101, con 555 pruebas del backend y 206 del frontend."),
  h2("4.1 Plazos con feriados y escalamiento automático (PT-3)"),
  autoria("Andy Martínez (desarrollo) y Jeison Vásquez (despliegue)", "Bradley Morales"),
  p("Los plazos de los trámites se cuentan en días hábiles, descontando fines de semana y feriados nacionales (migración 013). Un temporizador de systemd ejecuta cada cierto tiempo `siget.escalar_vencidos()` con un rol propio, `escalador_role`, que **solo** puede ejecutar esa función: no lee ni modifica nada más. Así un trámite vencido sube a supervisión sin que nadie tenga que acordarse."),
  ...figS("08_temporizador_escalamiento.png", "Temporizador de escalamiento activo en VM1"),
  h2("4.2 Registro por invitación (PT-2)"),
  autoria("Andy Martínez (desarrollo) y Jeison Vásquez (despliegue)", "Gabriel González"),
  p("El registro de cuentas se puede configurar como abierto, por invitación o cerrado (`SIGET_REGISTRO`). Por invitación, el operador de identidades emite un código de un solo uso (60 bits) que vence en 7 días y se gasta en la misma transacción en que se crea la cuenta. La base solo guarda el hash del código (migración 014), y un código malo, usado o vencido siempre recibe la misma respuesta, para no dar pistas."),
  h2("4.3 Documentos adjuntos cifrados (PT-8)"),
  autoria("Andy Martínez (desarrollo), Joel Medina (diseño de seguridad) y Jeison Vásquez (despliegue)", "Bradley Morales"),
  p("Quien pide un trámite puede adjuntar PDF, PNG o JPEG de hasta 5 MB. El tipo se valida por contenido (bytes mágicos), no por la extensión, y se rechazan ejecutables disfrazados, doble extensión, HTML y SVG (50 pruebas de archivos hostiles). Cada archivo se cifra con **AES-256-GCM** y una clave aparte guardada como secreto de Podman, atado a su trámite con datos autenticados, y se verifica su SHA-256 al descargar: un archivo alterado no se entrega y genera un evento de seguridad. La tabla `documento` (migración 015) tiene seguridad por filas y no admite modificación ni borrado."),
  salto(),
];

// ---------------------------------------------------------------- 5. SDLC seguro
const etapa = (titulo, hizo, reviso, parrafos, extras = []) => [h2(titulo), autoria(hizo, reviso), ...parrafos.map((x) => p(x)), ...extras];
const sdlc = [
  h1("5. Ciclo de vida de desarrollo seguro: las 8 etapas"),
  p("Se tomó como marco la guía de Red Hat *Seguridad en el ciclo de vida de desarrollo del software*: aplicar la seguridad desde el inicio y en cada etapa (*shift left*) con responsabilidad compartida entre desarrollo, operaciones y seguridad (*DevSecOps*). Cada etapa tiene su entregable en `docs/sdlc/` y su responsable."),
  ...tabla("Resultado de cada etapa", ["Etapa", "Responsable", "Resultado"], [
    ["1. Planificación", "Simna De Gracia", "24 riesgos evaluados; 12 con algo pendiente, priorizados"],
    ["2. Requisitos", "Gabriel González", "26 requisitos (20 cumplen, 2 parciales, 4 no cumplen) y 11 artículos de leyes panameñas"],
    ["3. Diseño", "Joel Medina", "41 amenazas STRIDE: 24 mitigadas, 14 parciales, 3 abiertas"],
    ["4. Desarrollo", "Andy Martínez", "14 reglas de codificación segura; CI de seguridad con 5 controles en verde y Dependabot"],
    ["5. Documentación", "Jorge Medina", "43 controles inventariados y `SECURITY.md` completa"],
    ["6. Pruebas", "Bradley Morales", "Plan de pruebas; lista de revisión de 10 puntos aplicada a los PR #10 y #12"],
    ["7. Implementación", "Jeison Vásquez", "Revisión de VM1 y VM2: 5 hallazgos, 4 corregidos y 1 abierto (puerto 80 del checkpoint PHP)"],
    ["8. Mantenimiento", "Anyurie Sánchez y Walter Sanjur", "Supervisión semanal y bitácora de parches: de 2 avisos críticos por VM a 0 críticos y 0 pendientes"],
  ], [2000, 2100, 5260]),
  ...etapa("5.1 Etapa 1 — Planificación", "Simna De Gracia", "Jeison Vásquez", [
    "Se armó el **registro de riesgos** de SIGET (`01-registro-de-riesgos.md`): 24 riesgos, cada uno con qué puede pasar, a qué afecta (datos de la ciudadanía, trámites, disponibilidad), probabilidad, impacto, nivel y el control que lo reduce. Los 12 que tienen algo pendiente quedaron ordenados por prioridad. Dos se mitigaron durante el trabajo: R5 (parches del sistema sin aplicar) el 16 de noviembre y R24 (repositorios con firma inválida) el 17.",
  ]),
  ...etapa("5.2 Etapa 2 — Análisis de requisitos", "Gabriel González", "Simna De Gracia", [
    "Se definieron 26 **requisitos de seguridad** (`02-requisitos-de-seguridad.md`) y se cruzaron con 11 artículos de la Ley 81 de 2019 (protección de datos personales), la Ley 83 de 2012 (gobierno electrónico) y la Ley 6 de 2002 (transparencia). Resultado: 20 se cumplen, 2 parcialmente y 4 no. Los incumplidos más importantes son los derechos de la persona sobre sus datos (ver, corregir y eliminar) y el aviso de privacidad, que quedan como trabajo futuro.",
  ]),
  ...etapa("5.3 Etapa 3 — Diseño", "Joel Medina", "Andy Martínez", [
    "Se hizo el **modelo de amenazas STRIDE** (`03-modelo-de-amenazas.md`) sobre el diagrama de flujo de datos de SIGET: 41 amenazas en 6 componentes (navegador e interfaz, nginx, backend Django, base de datos PostgreSQL, temporizador de escalamiento y archivos de documentos). Para cada una se anotó el control que la frena; por ejemplo, la seguridad por filas frena la divulgación de trámites entre instituciones y la auditoría inalterable frena el repudio. Quedan 24 mitigadas, 14 parciales y 3 abiertas.",
  ]),
  ...etapa("5.4 Etapa 4 — Desarrollo", "Andy Martínez", "Jeison Vásquez", [
    "Se escribieron **14 reglas de codificación segura** (`04-codificacion-segura.md`) a partir de los hallazgos reales del análisis estático, y se automatizó la seguridad en el CI (`.github/workflows/security-scan.yml`): Bandit, Semgrep, pip-audit, npm audit y Gitleaks corren en cada pull request, en cada push a `develop` y `main` y una vez por semana. Gitleaks se descarga verificando su suma SHA-256 oficial. Dependabot propone las actualizaciones de dependencias por PR y `CODEOWNERS` exige revisión en lo sensible. El PR #16 quedó con los 5 controles en verde.",
  ]),
  ...etapa("5.5 Etapa 5 — Documentación", "Jorge Medina", "Gabriel González", [
    "Se completó la **política de seguridad** (`SECURITY.md`: cómo reportar una vulnerabilidad, versiones con soporte, qué pasa después del reporte y alcance) y el **inventario de 43 controles** (`05-inventario-de-controles.md`), cada uno con lo que protege, dónde está documentado, cómo se verifica y quién responde por él. Cada cambio del proyecto quedó en el `CHANGELOG.md` y en el runbook.",
  ]),
  ...etapa("5.6 Etapa 6 — Pruebas", "Bradley Morales", "Joel Medina", [
    "Se escribió el **plan de pruebas de seguridad** (`06-plan-de-pruebas.md`), que junta las pruebas automáticas (555 del backend y 206 del frontend), las verificaciones contra la base real, el ensayo de 101 comprobaciones contra producción y el análisis dinámico. Se armó una **lista de revisión de código de 10 puntos** y se aplicó a los PR #10 y #12.",
  ]),
  ...etapa("5.7 Etapa 7 — Implementación", "Jeison Vásquez", "Andy Martínez", [
    "Se revisó el **entorno de despliegue** de VM1 y VM2 solo con comandos de lectura (`07-revision-del-entorno.md`): SELinux en Enforcing, SSH solo con clave, cortafuegos, TLS 1.3 con calificación A, cabeceras de seguridad y contenedores sin root. Salieron 5 hallazgos y 4 se corrigieron: una regla sobrante del puerto 5432 en VM2, los avisos críticos sin aplicar, la versión de Rocky sin soporte y los repositorios con firma inválida. Queda abierto el puerto 80 del checkpoint PHP.",
  ], [...figS("07_vm1_revision.png", "Revisión del entorno de VM1 (solo lectura)"), ...figS("07_tls_cabeceras.png", "TLS 1.3 y cabeceras de seguridad de la plataforma")]),
  ...etapa("5.8 Etapa 8 — Mantenimiento: supervisión", "Anyurie Sánchez", "Walter Sanjur", [
    "Se abrió la **bitácora semanal de supervisión** (`08-bitacora-supervision.md`): eventos de seguridad, cuentas bloqueadas, accesos denegados, estado de los temporizadores y del respaldo diario. Se escribió además el **procedimiento ante una intrusión**: a quién avisar, cómo contener (bloquear la cuenta, cerrar sesiones) y qué evidencia guardar.",
  ], figS("08_supervision_semana.png", "Primera revisión semanal de supervisión")),
  ...etapa("5.9 Etapa 8 — Mantenimiento: parches y dependencias", "Walter Sanjur", "Jeison Vásquez", [
    "Se tomó la **línea base de parches** el 16 de noviembre: 2 avisos críticos en cada VM (203 avisos de seguridad en VM1 y 192 en VM2), con lo que se incumplía la regla de 7 días para los críticos. Esa misma noche se actualizó todo (sección 6) y la bitácora (`08-bitacora-parches.md`) registra el después: 0 críticos y 0 pendientes. También se armó el calendario de fin de soporte (por ejemplo, Python 3.12 vence en abril de 2027 y PostgreSQL 16 en noviembre de 2028), con aviso un mes antes de cada fecha.",
  ], [...figS("08_parches_linea_base.png", "Línea base: avisos pendientes antes de actualizar"), ...figS("10_parches_despues.png", "Después de actualizar: 0 avisos críticos y 0 pendientes")]),
  salto(),
];

// ---------------------------------------------------------------- 6. mantenimiento de las VMs
const vms = [
  h1("6. Mantenimiento de las máquinas virtuales"),
  autoria("Jeison Vásquez y Walter Sanjur", "Andy Martínez"),
  h2("6.1 Actualización a Rocky Linux 9.9 (16 de noviembre)"),
  p("Las dos VMs pasaron de Rocky 9.7, sin soporte desde mayo, a **9.9**, con todos los avisos de seguridad aplicados. Se hizo con cinco cuidados: respaldo verificado de la base, una instantánea de VMware de cada VM, una máquina por vez (primero VM2 y, verificada, VM1), reinicio para cargar el kernel nuevo y verificaciones completas contra la base real (77/77, 91/91, 84/84 y ensayo 101/101). En VM2 se quitó además la regla del cortafuegos del puerto 5432, que no se usaba."),
  ...figS("09_vm1_actualizacion.png", "Actualización de VM1 a Rocky Linux 9.9"),
  h2("6.2 Repositorios con firma inválida (17 de noviembre)"),
  p("Tras el reinicio apareció que los seis repositorios externos de PostgreSQL en VM1 (`pgdg-common` y `pgdg14` a `pgdg18`), que habían quedado de la instalación de pgAdmin, fallaban la verificación de firma GPG. Un repositorio así no se debe usar: no se puede confirmar que los paquetes sean legítimos. Se respaldó su archivo y se deshabilitaron los seis; `dnf` volvió a funcionar sin errores y siguen 0 avisos pendientes."),
  ...figS("11_vm1_repos_pgdg.png", "Repositorios pgdg deshabilitados y dnf sin errores"),
  h2("6.3 Retiro de las instantáneas (17 de noviembre)"),
  p("Confirmado que todo seguía funcionando, se borraron las instantáneas «antes-de-rocky-9.8-2026-11-16» de las dos VMs. Una instantánea vieja ocupa disco y hace más lento el acceso a los discos virtuales. VMware dejó los discos marcados para consolidar porque la consola los tenía abiertos; se completa con «Manage > Clean Up Disks» con las VMs apagadas, y mientras tanto las VMs funcionan igual."),
  ...figS("12_instantaneas_borradas.png", "Las dos VMs sin instantáneas"),
  salto(),
];

// ---------------------------------------------------------------- 7. pendientes
const pendientes = [
  h1("7. Lo que queda pendiente"),
  ...tabla("Trabajo pendiente", ["Pendiente", "Por qué importa", "Responsable"], [
    ["Retirar el checkpoint PHP y cerrar el puerto 80 (PT-13)", "Mientras sirva en HTTP, su cookie no puede llevar `Secure`", "Jeison Vásquez"],
    ["Copia de la clave de documentos fuera de VM1", "Si VM1 se pierde, los documentos cifrados no se pueden recuperar", "Jeison Vásquez"],
    ["Consolidar los discos de las VMs", "Terminar la limpieza de las instantáneas", "Jeison Vásquez"],
    ["Derechos sobre los datos personales y aviso de privacidad (Ley 81 de 2019)", "Son los requisitos que no se cumplen", "Gabriel González y Andy Martínez"],
    ["Plan para Python 3.12", "Pierde soporte en abril de 2027", "Walter Sanjur"],
    ["Revisiones semanales de supervisión y parches", "La etapa 8 es continua", "Anyurie Sánchez y Walter Sanjur"],
  ], [3300, 3760, 2300]),
  salto(),
];

// ---------------------------------------------------------------- 8. conclusiones
const conclusiones = [
  h1("8. Conclusiones"),
  p("Cada integrante escribe su conclusión: qué hizo, qué aprendió y qué haría distinto."),
  ...INTEGRANTES.flatMap((n) => [h2(n), p("[Escribir aquí la conclusión]"), new Paragraph({ children: [] })]),
  salto(),
];

// ---------------------------------------------------------------- 9. bibliografía
const biblio = [
  h1("9. Bibliografía"),
  ...[
    "Red Hat. (2026, 27 de agosto). *Seguridad en el ciclo de vida de desarrollo del software*. https://www.redhat.com/es/topics/security/software-development-lifecycle-security",
    "OWASP Foundation. (2021). *OWASP Top 10*. https://owasp.org/Top10/",
    "OWASP Foundation. (2024). *Zed Attack Proxy (ZAP)*. https://www.zaproxy.org/",
    "Shostack, A. (2014). *Threat Modeling: Designing for Security*. Wiley.",
    "PyCQA. (2026). *Bandit*. https://bandit.readthedocs.io/",
    "Semgrep. (2026). *Semgrep documentation*. https://semgrep.dev/docs/",
    "Gitleaks. (2026). *Gitleaks*. https://github.com/gitleaks/gitleaks",
    "Rocky Enterprise Software Foundation. (2026). *Rocky Linux release notes*. https://docs.rockylinux.org/",
    "República de Panamá. (2019). *Ley 81 de 26 de marzo de 2019, sobre protección de datos personales*. Gaceta Oficial.",
    "República de Panamá. (2012). *Ley 83 de 9 de noviembre de 2012, que regula el uso de medios electrónicos para los trámites gubernamentales*. Gaceta Oficial.",
    "República de Panamá. (2002). *Ley 6 de 22 de enero de 2002, que dicta normas para la transparencia en la gestión pública*. Gaceta Oficial.",
  ].map((r) => new Paragraph({ children: runs(r.replace(/\*([^*]+)\*/g, "$1")), spacing: { after: 100 }, indent: { left: 720, hanging: 720 } })),
];

// ---------------------------------------------------------------- documento
const doc = new Document({
  creator: "Grupo Ciber5", title: "SIGET: informe final del trabajo realizado",
  features: { updateFields: true },
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
  ] },
  sections: [{
    properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
    footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [t("SIGET — Grupo Ciber5 — página ", { size: 18 }), new TextRun({ children: [PageNumber.CURRENT], size: 18, font: FUENTE })] })] }) },
    children: [...portada, ...intro, ...quien, ...analisis, ...funcionalidades, ...sdlc, ...vms, ...pendientes, ...conclusiones, ...biblio],
  }],
});

Packer.toBuffer(doc).then((b) => { fs.writeFileSync(SALIDA, b); console.log("OK", SALIDA, nFig, "figuras,", nTab, "tablas"); });
