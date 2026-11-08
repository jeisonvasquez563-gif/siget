// Genera el informe de análisis estático y dinámico de SIGET (.docx) con las capturas de docs/analisis-seguridad.
const fs = require("fs");
const path = require("path");
const {
  Document, Packer, Paragraph, TextRun, ImageRun, Table, TableRow, TableCell, HeadingLevel, AlignmentType,
  WidthType, ShadingType, BorderStyle, PageBreak, LevelFormat, Footer, PageNumber, TableOfContents,
} = require("docx");

const RAIZ = "C:/Users/jeiva/Desktop/Proyecto-Ciber5";
const EV = path.join(RAIZ, "docs/analisis-seguridad");
const SALIDA = path.join(RAIZ, "docs/Informe_Analisis_Estatico_Dinamico_SIGET.docx");
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

// ---------------------------------------------------------------- portada
const portada = [
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 600, after: 80 }, children: [t("UNIVERSIDAD TECNOLÓGICA DE PANAMÁ", { bold: true, size: 32 })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 80 }, children: [t("Ciberseguridad 5", { size: 26 })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 900 }, children: [t("Proyecto semestral — Grupo Ciber5", { size: 24 })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 160 }, children: [t("Análisis estático y dinámico del código de SIGET", { bold: true, size: 40, color: "1F3864" })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 900 }, children: [t("Sistema de Gestión y Trazabilidad de trámites: hallazgos, correcciones y resultados", { italics: true, size: 26 })] }),
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

// ---------------------------------------------------------------- 1. introducción
const intro = [
  h1("1. Introducción"),
  p("SIGET (Sistema de Gestión y Trazabilidad) es la plataforma del proyecto semestral para dar seguimiento a trámites ante instituciones del Estado panameño con un registro de auditoría inalterable. Está compuesta por un **backend** en Python (Django 5.2 y Django REST Framework), una **interfaz** en React 18 construida con Vite, la **infraestructura** como código (nginx, contenedores Podman con Quadlet y PostgreSQL 16 con Row Level Security) y un **ensayo automatizado** de la demostración. Corre en dos máquinas virtuales Rocky Linux: VM1 (`app-backend`, 192.168.159.137) con nginx y Django, y VM2 (`db-server`) con la base de datos."),
  p("El objetivo de este informe es **corregir el proyecto a partir de dos análisis complementarios**: el **estático**, que examina el código fuente, las dependencias y el historial de git sin ejecutarlos, y el **dinámico**, que ataca y prueba la plataforma en ejecución. Para cada uno se presentan los pasos desde la etapa inicial, los hallazgos, las correcciones realizadas y el resultado al volver a ejecutar las mismas herramientas."),
  h2("1.1 Alcance"),
  vineta("**Código analizado:** el repositorio del proyecto en la rama `develop` (commit `14d3bd6`, 8 de noviembre de 2026): `backend/`, `frontend/`, `infra/`, `demo/` y `database/`."),
  vineta("**Sistema analizado en ejecución:** la plataforma desplegada en VM1 (`https://192.168.159.137:8443`, la redirección `http://…:8080` y el servidor Apache del puerto 80)."),
  vineta("**Correcciones:** se trabajaron en la rama `fix/analisis-estatico-dinamico`, en commits separados por tema. Toda la evidencia (salidas completas en texto, capturas y reportes de cada herramienta) está en `docs/analisis-seguridad/` del repositorio, en las carpetas `antes/`, `correcciones/` y `despues/`."),
  h2("1.2 Metodología"),
  p("Se siguió el ciclo de pruebas técnicas de seguridad de NIST SP 800-115 (planificar, ejecutar, analizar y reportar) y las prácticas de verificación del Secure Software Development Framework (NIST SP 800-218). Para cada herramienta:"),
  paso("**Etapa inicial:** se ejecuta sobre el código o el sistema sin cambios y se guarda la salida completa."),
  paso("**Triage:** cada hallazgo se revisa a mano y se clasifica como **verdadero positivo** (se corrige) o **falso positivo** (se justifica con evidencia y se documenta en el propio código o en la configuración de la herramienta, nunca se oculta sin explicación)."),
  paso("**Corrección:** se cambia el código o la configuración y se comprueba que las pruebas automáticas del proyecto siguen pasando."),
  paso("**Resultado:** se vuelve a ejecutar la misma herramienta con los mismos parámetros y se comparan los números."),
  p("Cada respuesta de las herramientas se guardó como captura de pantalla (la terminal con el comando, la fecha, el usuario y la salida) junto con el archivo de texto completo, para que cualquier resultado pueda contrastarse. Las capturas las genera el script `docs/analisis-seguridad/herramientas/captura.py`, que ejecuta el comando y dibuja su salida real. La carpeta local donde se instalaron las herramientas aparece reemplazada por el marcador `<carpeta-herramientas>`, porque no aporta información al análisis; los valores de posibles secretos se muestran ocultos (`REDACTED`) por la propia herramienta."),
  salto(),
];

// ---------------------------------------------------------------- 2. análisis estático
const estatico = [
  h1("2. Análisis estático"),
  p("El análisis estático (SAST, *Static Application Security Testing*, más el análisis de composición de software, SCA) revisa el proyecto sin ejecutarlo. Se buscaron cuatro tipos de problemas: patrones inseguros en el código propio, configuraciones peligrosas de la infraestructura, dependencias con vulnerabilidades conocidas y secretos expuestos en el historial de git."),
  h2("2.1 Herramientas elegidas y por qué"),
  ...tabla("Herramientas del análisis estático", ["Herramienta", "Versión", "Qué analiza en SIGET", "Por qué se eligió"], [
    ["Bandit", "1.9.4", "Backend Python/Django (4 491 líneas)", "Es la herramienta de referencia de la PyCQA para seguridad en Python: entiende el árbol sintáctico de Python y clasifica cada hallazgo por severidad, confianza y CWE. Es gratuita y no envía el código a terceros."],
    ["Semgrep (Community)", "1.184.0", "Python, JavaScript/React, nginx, bash y JSON (181 archivos)", "Cubre todos los lenguajes del proyecto con un solo motor, incluido el `nginx.conf` que ninguna otra herramienta revisa. Se usaron los conjuntos públicos OWASP Top 10, Django, Python, JavaScript, React y secretos (271 reglas aplicables)."],
    ["pip-audit", "2.10.1", "Dependencias del backend (`requirements*.txt`)", "Herramienta oficial de la Python Packaging Authority; consulta la base de vulnerabilidades de PyPI/OSV para las versiones exactas fijadas."],
    ["npm audit", "npm 11 (Node 24.15)", "Dependencias del frontend (`package-lock.json`)", "Viene con Node, consulta la GitHub Advisory Database y analiza también las dependencias transitivas del árbol completo."],
    ["Gitleaks", "8.30.1", "Todo el historial de git (81 commits)", "Detecta contraseñas, tokens y claves con reglas y entropía, incluso en commits viejos que ya no se ven en el código actual. Se descargó la versión oficial y se verificó su suma SHA-256."],
  ], [1500, 1100, 2560, 4200]),
  p("Las cinco herramientas son de código abierto, se ejecutan localmente y se complementan: Bandit es más profundo en Python, Semgrep es más amplio en lenguajes, pip-audit y npm audit miran el código de terceros y Gitleaks mira la historia del repositorio."),

  h2("2.2 Etapa inicial"),
  h3("2.2.1 Bandit sobre el backend"),
  p("Se analizaron las aplicaciones de Django y la configuración, excluyendo las pruebas unitarias y el entorno virtual:"),
  comando("bandit -r backend/apps backend/config backend/manage.py -x backend/tests,backend/.venv"),
  ...figura("antes/01_bandit_version.png", "Versión de Bandit utilizada."),
  ...figura("antes/02_bandit_backend_01.png", "Bandit, etapa inicial: primeros hallazgos (uso de assert y contraseñas escritas en el código)."),
  ...figura("antes/02_bandit_backend_05.png", "Bandit, etapa inicial: resumen con 20 hallazgos (19 de severidad baja y 1 media) en 4 491 líneas."),
  ...figura("antes/03_bandit_reporte_html.png", "Reporte HTML de Bandit de la etapa inicial."),
  ...tabla("Hallazgos iniciales de Bandit y su clasificación", ["Regla (CWE)", "Dónde", "Cant.", "Clasificación"], [
    ["B108 Directorio temporal predecible (CWE-377) — media", "`config/settings.py:110` caché en `/tmp/siget-cache`", "1", "Verdadero positivo: ruta fija y compartida que otro usuario podría crear antes o reemplazar por un enlace."],
    ["B101 Uso de assert (CWE-703) — baja", "`sembrar_demo.py` líneas 119, 124 y 128", "3", "Verdadero positivo: Python elimina los assert al ejecutarse con `-O`, y la validación desaparecería."],
    ["B106 Contraseña fija como argumento (CWE-259) — baja", "`verificar_*.py`: cuentas de prueba con `password_hash=\"x\"`", "7", "Verdadero positivo de calidad: no es explotable, pero un valor fijo como hash es frágil y confuso."],
    ["B105 Cadena de contraseña fija (CWE-259) — baja", "`verificar_autenticacion.py` y `verificar_plataforma.py`", "9", "Falso positivo: son contraseñas inválidas a propósito que se envían para comprobar que la API las rechaza."],
  ], [2700, 2900, 700, 3060]),

  h3("2.2.2 Semgrep sobre todo el código"),
  comando("semgrep scan --metrics=off --config p/owasp-top-ten --config p/django --config p/python --config p/javascript --config p/react --config p/secrets backend frontend/src infra demo database"),
  ...figura("antes/04_semgrep_version.png", "Versión de Semgrep utilizada."),
  ...figura("antes/05_semgrep_codigo.png", "Semgrep, etapa inicial: 2 hallazgos bloqueantes en nginx.conf (uso de la cabecera Host del cliente)."),
  p("Semgrep marcó dos líneas de `infra/podman/vm1-app-backend/nginx.conf`: la redirección `return 301 https://$host:8443$request_uri;` y `proxy_set_header Host $host;`. La variable `$host` viene de la cabecera `Host` que envía el cliente, así que un atacante puede poner cualquier dominio. Se clasificó como **verdadero positivo** y se confirmó después en el análisis dinámico (sección 3.2.4): permite una **redirección abierta** (CWE-601)."),

  h3("2.2.3 Dependencias: pip-audit y npm audit"),
  comando("pip-audit -r backend/requirements.txt -r backend/requirements-dev.txt --desc on"),
  ...figura("antes/06_pip_audit.png", "pip-audit, etapa inicial: las dependencias de Python no tienen vulnerabilidades conocidas."),
  comando("npm audit        (en frontend/)"),
  ...figura("antes/07_npm_audit.png", "npm audit, etapa inicial: 7 vulnerabilidades (2 críticas, 1 alta, 2 moderadas y 2 bajas)."),
  ...tabla("Vulnerabilidades iniciales en las dependencias del frontend", ["Paquete", "Severidad", "Aviso", "Problema"], [
    ["tinypool ≤ 2.1.1 (vía vitest)", "Crítica", "GHSA-5gmw-xhrv-c9v3, GHSA-85c8-ppgw-ccpr", "Contaminación de prototipos que lleva a ejecución remota de código"],
    ["@vitest/mocker ≤ 4.1.11", "Moderada", "GHSA-82fw-gwwq-j7x9, GHSA-qxg6-89mg-rqv8", "Lectura arbitraria de archivos e inyección de código en el servidor de pruebas"],
    ["esbuild ≤ 0.24.2 (vía vite 5.4.11)", "Moderada", "GHSA-67mh-4wv8-2f99", "Cualquier sitio puede leer respuestas del servidor de desarrollo"],
    ["@eslint/plugin-kit < 0.3.4 (vía eslint 9.17)", "Baja", "GHSA-xffm-g5w8-qvg7", "Denegación de servicio por expresión regular"],
  ], [2600, 1100, 2700, 2960]),
  p("Todas están en **herramientas de desarrollo y pruebas**: no forman parte de la interfaz compilada que sirve nginx. Aun así son explotables en la máquina de cualquier integrante que corra el servidor de desarrollo o las pruebas, por eso se corrigieron."),

  h3("2.2.4 Gitleaks sobre el historial de git"),
  comando("gitleaks git . --redact -v --report-format json --report-path gitleaks.json"),
  ...figura("antes/08_gitleaks_version.png", "Versión de Gitleaks utilizada."),
  ...figura("antes/09_gitleaks_historial.png", "Gitleaks, etapa inicial: 3 posibles secretos en demo/ensayo.py en 81 commits (valores ocultos con --redact)."),
  p("Los tres hallazgos son contraseñas de prueba escritas en `demo/ensayo.py`. Se comprobó que **no coinciden con ninguna credencial real** del archivo de cuentas sembradas (que está fuera de git): sirven para pedir un registro sin datos personales o un restablecimiento con un código falso, y el servidor los rechaza antes de guardar nada. Aun así, una contraseña escrita en el código es mala práctica, así que se corrigió."),

  h2("2.3 Correcciones realizadas"),
  ...tabla("Correcciones del análisis estático", ["Hallazgo", "Corrección", "Archivos / commit"], [
    ["npm audit: 7 vulnerabilidades", "Actualización a vite 7.3.7, vitest 4.1.12, @vitejs/plugin-react 5 y eslint 9.39 (sin vulnerabilidades conocidas).", "`frontend/package.json`, `package-lock.json` · `caa5ae1`"],
    ["Bandit B108", "La caché usa un directorio propio del usuario (`siget-cache-<uid>`), se crea con permisos 700, se rechaza si es un enlace simbólico o si pertenece a otro usuario.", "`backend/config/settings.py` · `9158f45`"],
    ["Bandit B101", "Los `assert` se reemplazaron por una validación explícita que lanza `CommandError` y no desaparece con `-O`.", "`sembrar_demo.py` · `9158f45`"],
    ["Bandit B106", "Nueva función `contrasenas.inutilizable()` (hash que ninguna contraseña verifica) para las cuentas de prueba en lugar de `\"x\"`.", "`contrasenas.py`, `verificar_*.py` · `9158f45`"],
    ["Bandit B105 (falso positivo)", "Se marcaron las 9 líneas con `# nosec B105` y un comentario en cada archivo que explica que son pruebas negativas.", "`verificar_autenticacion.py`, `verificar_plataforma.py`"],
    ["Semgrep request-host-used", "Un `map` de nginx acepta solo los nombres de la plataforma (los mismos de `SIGET_ALLOWED_HOSTS`); cualquier otro Host recibe 421 y nunca se usa en redirecciones ni se reenvía al backend.", "`infra/.../nginx.conf` · `a91c0ea`"],
    ["Gitleaks (3)", "El ensayo genera su contraseña de prueba al ejecutarse con `secrets.token_urlsafe`; los tres hallazgos históricos revisados quedan en `.gitleaksignore` con su justificación.", "`demo/ensayo.py`, `.gitleaksignore` · `73c39e7`"],
    ["Gitleaks fuera de git (informativo)", "La herramienta también encontró una contraseña real en un archivo de configuración local del checkpoint, que está excluido de git por `.gitignore` y nunca se publicó. Se recomienda rotarla y retirar ese archivo junto con el checkpoint.", "copia local, fuera del repositorio"],
  ], [2100, 4700, 2560]),
  p("Durante las correcciones se ejecutaron las pruebas automáticas del proyecto para asegurar que ningún cambio rompiera la funcionalidad. Las pruebas del frontend mostraron, **antes de tocar nada**, una prueba fallando en el simulador de políticas: el escenario «cuenta bloqueada» no enviaba el campo `audiencia` que se agregó en la última versión. Se corrigió el escenario y su caso de ejemplo."),
  ...figura("correcciones/01_frontend_pruebas_antes_08.png", "Pruebas del frontend antes de las correcciones: 190 de 191 pasan (falla el escenario del simulador)."),
  ...figura("correcciones/02_npm_actualizar.png", "Corrección: actualización de las dependencias del frontend; npm informa 0 vulnerabilidades."),
  ...figura("correcciones/03_frontend_pruebas_despues.png", "Pruebas del frontend después de las correcciones: 191 de 191 pasan con vitest 4.1.12."),
  ...figura("correcciones/04_frontend_lint.png", "ESLint del frontend con la versión actualizada: sin errores."),
  ...figura("correcciones/05_backend_pruebas_antes.png", "Pruebas unitarias del backend antes de las correcciones: 463 pasan."),
  ...figura("correcciones/06_backend_pruebas_despues.png", "Pruebas unitarias del backend después de las correcciones: 463 pasan."),
  p("Las correcciones del frontend afectan solo a herramientas de desarrollo y pruebas, por lo que no cambian la interfaz que sirve nginx. Las del backend y la de nginx se desplegaron en producción (sección 3.3): se reconstruyó la imagen del backend a partir del commit corregido, conservando la anterior como respaldo, y se comprobó con las suites de verificación contra la base real."),

  h2("2.4 Resultado después de las correcciones"),
  p("Se volvieron a ejecutar las cinco herramientas con los mismos parámetros sobre el código corregido."),
  ...figura("despues/02_bandit_backend_02.png", "Bandit después de las correcciones: 0 hallazgos; 9 líneas omitidas por nosec justificado."),
  ...figura("despues/03_bandit_reporte_html.png", "Reporte HTML de Bandit después de las correcciones."),
  ...figura("despues/05_semgrep_codigo.png", "Semgrep después de las correcciones: 0 hallazgos."),
  ...figura("despues/06_pip_audit.png", "pip-audit después: sin vulnerabilidades conocidas."),
  ...figura("despues/07_npm_audit.png", "npm audit después: 0 vulnerabilidades."),
  ...figura("despues/09_gitleaks_historial.png", "Gitleaks después: no se encuentran secretos (los históricos revisados quedan en .gitleaksignore)."),
  ...tabla("Comparación del análisis estático antes y después", ["Herramienta", "Antes", "Después"], [
    ["Bandit", "20 hallazgos (1 media, 19 bajas)", "0 hallazgos (9 falsos positivos justificados con nosec)"],
    ["Semgrep", "2 hallazgos bloqueantes", "0 hallazgos"],
    ["pip-audit", "0 vulnerabilidades", "0 vulnerabilidades"],
    ["npm audit", "7 vulnerabilidades (2 críticas, 1 alta)", "0 vulnerabilidades"],
    ["Gitleaks", "3 posibles secretos", "0 (los 3 revisados documentados)"],
    ["Pruebas del frontend", "190 / 191", "191 / 191"],
    ["Pruebas del backend", "463 / 463", "463 / 463"],
  ], [2400, 3300, 3660]),
  salto(),
];

// ---------------------------------------------------------------- 3. análisis dinámico
const zapDespues = existe("despues/11_zap_escaneo.txt");
const ensayoTxt = leer("despues/16_ensayo_demo.txt");
const ensayoRes = ((ensayoTxt.match(/ENSAYO: ([^\n]+)/) || [])[1] || "").trim();
const ensayoPngs = existe("despues") ? fs.readdirSync(path.join(EV, "despues")).filter((f) => /^16_ensayo_demo(_\d+)?\.png$/.test(f)).sort() : [];

const dinamico = [
  h1("3. Análisis dinámico"),
  p("El análisis dinámico (DAST, *Dynamic Application Security Testing*) prueba la plataforma **mientras está funcionando**, desde afuera y como lo haría un atacante, sin mirar el código. Encuentra problemas que el análisis estático no ve: configuración del servidor, cabeceras, cifrado, métodos HTTP habilitados y el comportamiento real ante entradas maliciosas. Todas las pruebas se hicieron contra la plataforma desplegada en VM1, sin credenciales, desde la red del laboratorio."),
  h2("3.1 Herramientas elegidas y por qué"),
  ...tabla("Herramientas del análisis dinámico", ["Herramienta", "Versión", "Uso", "Por qué se eligió"], [
    ["OWASP ZAP", "2.17.0", "Exploración y escaneo activo de la interfaz y la API", "Es el escáner DAST de código abierto más usado y el proyecto insignia de OWASP. Su Automation Framework permite describir el escaneo en un archivo (`zap-plan.yaml`) y repetirlo idéntico antes y después. Prueba inyección SQL, XSS, recorrido de rutas, cabeceras y más."],
    ["Nmap", "7.99", "Puertos, versiones de servicios, cifrados TLS, cabeceras y métodos HTTP", "Estándar para reconocer la superficie de ataque de un servidor. Sus scripts `ssl-enum-ciphers`, `http-security-headers` y `http-methods` califican el TLS y detectan métodos peligrosos."],
    ["curl", "8.21", "Pruebas manuales dirigidas (cabecera Host, método TRACE)", "Permite fabricar exactamente la petición que se quiere probar y ver la respuesta completa; se usó para confirmar o descartar lo que reportan las herramientas automáticas."],
    ["Script de verificación (Python)", "propio", "Repetir los pares de peticiones de la alerta de inyección SQL de ZAP", "Para no aceptar un hallazgo de riesgo alto sin comprobarlo: reproduce las mismas condiciones con pausas para aislar el efecto del límite de tasa."],
    ["Ensayo de la demostración (`demo/ensayo.py`)", "propio", "Recorrido funcional y de seguridad con cuentas de prueba", "Ya formaba parte del proyecto: verifica de punta a punta login con segundo factor, permisos, aislamiento entre instituciones y control dual contra producción. Sirve como prueba de regresión después de desplegar."],
  ], [1700, 900, 2560, 4200]),
  h2("3.2 Etapa inicial"),
  h3("3.2.1 Reconocimiento con Nmap"),
  comando("nmap -Pn -sV -p 22,80,443,5432,8080,8443,9090 --script ssl-enum-ciphers,http-security-headers,http-methods 192.168.159.137"),
  ...figura("antes/10_nmap_puertos_tls_01.png", "Nmap, etapa inicial: servicios expuestos; Apache en el puerto 80 muestra su versión exacta y permite TRACE."),
  ...figura("antes/10_nmap_puertos_tls_02.png", "Nmap, etapa inicial: nginx en 8443 solo acepta TLS 1.3 con calificación A; PostgreSQL (5432) y Cockpit (9090) están filtrados."),
  p("Resultados: nginx tiene las cabeceras de seguridad completas (HSTS, CSP, X-Frame-Options y X-Content-Type-Options) y **solo TLS 1.3 con cifrados de calificación A**; la base de datos y la consola Cockpit no son alcanzables. Pero el **Apache del puerto 80** (que aloja el checkpoint PHP anterior) anuncia su versión completa (`Apache/2.4.62 (Rocky Linux) mod_wsgi/4.7.1 Python/3.9`) y acepta el método **TRACE**."),
  h3("3.2.2 Escaneo con OWASP ZAP"),
  p("El plan de ZAP siembra la interfaz y los endpoints públicos documentados en `docs/api.md`, explora los enlaces, espera el análisis pasivo y lanza el escaneo activo con 2 hilos y una pausa de 60 ms entre peticiones:"),
  comando("java -jar zap-2.17.0.jar -cmd -port 8099 -autorun zap-plan.yaml"),
  ...figura("antes/11_zap_escaneo_02.png", "OWASP ZAP, etapa inicial: el plan termina con éxito (42 URL exploradas, escaneo activo de 3 min 53 s)."),
  ...figura("antes/11b_zap_reporte_html.png", "Reporte de OWASP ZAP de la etapa inicial: 1 alerta de riesgo alto (SQL Injection) y 5 informativas."),
  ...tabla("Alertas iniciales de OWASP ZAP", ["Alerta", "Riesgo (confianza)", "Dónde", "Clasificación"], [
    ["SQL Injection (40018, CWE-89)", "Alto (media)", "POST `/auth/login/`, `/auth/registro/`, `/auth/restablecer/` (parámetros password y username)", "A verificar (sección 3.2.3)"],
    ["Authentication Request Identified", "Informativa", "Los mismos tres endpoints", "Correcto: ZAP solo reconoce que son formularios de autenticación"],
    ["Suspicious Comments", "Informativa", "`/assets/index-*.js`", "Falso positivo: la palabra «select» dentro del código minificado de React"],
    ["Modern Web Application", "Informativa", "`/`", "Correcto: es una SPA de React"],
    ["Re-examine Cache-control", "Informativa", "`/`, `/index.html`", "Aceptado: `no-cache` es intencional para que la interfaz siempre se actualice"],
    ["User Agent Fuzzer", "Informativa", "`/auth/restablecer/`", "Sin diferencia de comportamiento según el User-Agent"],
  ], [2200, 1400, 3060, 2700]),
  h3("3.2.3 Verificación manual de la alerta de inyección SQL"),
  p("Un hallazgo de riesgo alto no se acepta ni se descarta sin comprobarlo. ZAP afirma que las respuestas cambian entre una condición verdadera (`OR 1=1 --`) y una falsa (`AND 1=1 --`). Se repitieron exactamente esos pares de peticiones con un script que deja 4 segundos entre una y otra:"),
  comando("python docs/analisis-seguridad/herramientas/verificar_sqli.py"),
  ...figura("antes/12_verificacion_sqli.png", "Verificación manual: login responde idéntico (401) a las tres variantes; registro y restablecimiento devuelven 429 porque el escaneo de ZAP agotó el límite por IP."),
  p("Conclusión: **es un falso positivo**. En `/auth/login/` las tres variantes dan exactamente la misma respuesta. En registro y restablecimiento todas las respuestas son 429: el escaneo de ZAP disparó el límite de peticiones por IP (que funciona correctamente) y fue ese cambio de 400 a 429 el que ZAP interpretó como inyección. Además, en el código la contraseña nunca llega a una consulta SQL (se compara con Argon2) y las pocas consultas escritas a mano usan parámetros (`cursor.execute(sql, [valores])`), lo que impide la inyección."),
  h3("3.2.4 Prueba de la cabecera Host (confirma el hallazgo de Semgrep)"),
  comando("curl -i -H \"Host: sitio-malicioso.example\" http://192.168.159.137:8080/tramites/"),
  ...figura("antes/13_host_header_8080.png", "Etapa inicial: nginx redirige a https://sitio-malicioso.example:8443/… (redirección abierta)."),
  comando("curl -i -k -H \"Host: sitio-malicioso.example\" https://192.168.159.137:8443/salud/"),
  ...figura("antes/14_host_header_8443.png", "Etapa inicial: por HTTPS la petición con Host falso llega hasta Django, que la rechaza con 400 (ALLOWED_HOSTS)."),
  p("Se confirma el hallazgo estático: en el puerto 8080 cualquiera puede construir un enlace a la IP real de SIGET que **redirige a un dominio controlado por el atacante** (útil para phishing y para envenenar cachés). En el 8443 la segunda barrera (la lista `ALLOWED_HOSTS` de Django) detiene la petición, pero esta ya atravesó nginx y llegó al backend: la validación debe ocurrir en la puerta de entrada."),
  h3("3.2.5 Prueba del método TRACE en Apache"),
  comando("curl -i -X TRACE http://192.168.159.137/"),
  ...figura("antes/15_apache_trace.png", "Etapa inicial: Apache responde 200 a TRACE, devuelve la petición y anuncia su versión exacta."),
  p("TRACE devuelve al cliente la petición recibida, cabeceras incluidas; combinado con un fallo en el navegador permite el ataque Cross-Site Tracing (XST) para leer cabeceras protegidas. Y anunciar la versión exacta facilita buscar vulnerabilidades conocidas de esa versión (OWASP WSTG-CONF-06 y WSTG-INFO-02)."),

  h2("3.3 Correcciones realizadas"),
  h3("3.3.1 nginx: solo se aceptan los nombres de la plataforma"),
  p("La corrección del `nginx.conf` (sección 2.3) se desplegó en producción con respaldo previo y vuelta atrás automática. Primero se validó la sintaxis en un contenedor desechable con la misma imagen y los mismos certificados; luego se instaló y se reinició solo el contenedor de nginx:"),
  ...figura("correcciones/07_nginx_validar_sintaxis.png", "Validación del nginx.conf corregido con nginx -t antes de instalarlo."),
  ...figura("correcciones/08_nginx_desplegar.png", "Despliegue en VM1: respaldo de la configuración anterior, instalación y los tres servicios activos."),
  p("Fragmento de la configuración corregida:"),
  comando("map $host $host_permitido { default \"\"; 192.168.159.137 192.168.159.137; ... }"),
  comando("if ($host_permitido = \"\") { return 421; }      return 301 https://$host_permitido:8443$request_uri;"),
  h3("3.3.2 Falso positivo de inyección SQL"),
  p("No requiere cambio de código. Se documentó en el plan de ZAP del «después» (`zap-plan-despues.yaml`) con un filtro que marca la regla 40018 en `/auth/*` como falso positivo, citando la verificación manual. Se mantiene el límite de peticiones, que es justamente el control que protegió los formularios durante el escaneo."),
  h3("3.3.3 Apache y PHP del puerto 80"),
  p("Se creó `/etc/httpd/conf.d/endurecimiento.conf` con tres directivas y se aplicó solo si `apachectl configtest` daba «Syntax OK» (si fallaba, el archivo se quitaba automáticamente):"),
  comando("TraceEnable Off        # el método TRACE responde 405"),
  comando("ServerTokens Prod      # la cabecera Server dice solo «Apache»"),
  comando("ServerSignature Off    # las páginas de error no muestran la versión"),
  ...figura("correcciones/09_apache_endurecer.png", "Endurecimiento de Apache: configuración nueva, Syntax OK y recarga del servicio."),
  p("Al comprobar que el checkpoint PHP seguía funcionando apareció un hallazgo del mismo tipo: la cabecera `X-Powered-By: PHP/8.3.33` anunciaba la versión de PHP. Se corrigió con `expose_php = Off` en `/etc/php.d/99-siget-endurecimiento.ini`, validando la configuración de php-fpm antes de reiniciarlo:"),
  ...figura("correcciones/10_php_ocultar_version.png", "PHP deja de anunciar su versión (expose_php = Off) tras validar php-fpm."),
  p("La misma prueba mostró que la cookie de sesión del checkpoint (`PHPSESSID`) se enviaba sin los atributos `HttpOnly` ni `SameSite`: un script inyectado podría leerla (robo de sesión) y el navegador la mandaría también en peticiones iniciadas desde otros sitios (CSRF)."),
  ...figura("antes/16_php_cookie_sesion.png", "Etapa inicial: la cookie PHPSESSID solo trae path=/, sin HttpOnly ni SameSite."),
  p("Se agregaron al mismo archivo `session.cookie_httponly = 1`, `session.cookie_samesite = Strict` y `session.use_strict_mode = 1` (este último rechaza identificadores de sesión inventados por el cliente), con respaldo y validación de php-fpm antes de reiniciar. El atributo `Secure` no aplica mientras el checkpoint siga en HTTP; la medida definitiva es retirarlo y cerrar el puerto 80 (paso PT-13 del plan del proyecto)."),
  ...figura("correcciones/11_php_cookie_sesion.png", "Corrección de la cookie de sesión del checkpoint y reinicio de php-fpm."),
  h3("3.3.4 Backend con las correcciones del análisis estático"),
  p("Se empaquetó el backend del commit corregido, se reconstruyó la imagen `siget-backend:dev` en VM1 (la anterior quedó etiquetada como `respaldo-2026-11-08`) y se reinició solo el contenedor del backend, con vuelta atrás automática si el servicio no quedaba activo o `/salud/` no respondía 200:"),
  ...figura("correcciones/12_backend_reconstruir.png", "Reconstrucción y reinicio del backend en VM1: los tres servicios activos y /salud/ en 200."),

  h2("3.4 Resultado después de las correcciones"),
  ...figura("despues/13_host_header_8080.png", "Después: un Host falso en el puerto 8080 recibe 421 Misdirected Request; ya no hay redirección."),
  ...figura("despues/14_host_header_8443.png", "Después: un Host falso en el puerto 8443 se detiene en nginx con 421, sin llegar al backend."),
  ...figura("despues/13b_host_legitimo_8080.png", "Control: con el nombre legítimo la redirección a HTTPS sigue funcionando."),
  ...figura("despues/14b_host_legitimo_8443.png", "Control: con el nombre legítimo y la CA del proyecto, la API responde 200."),
  ...figura("despues/15_apache_trace.png", "Después: Apache responde 405 Method Not Allowed a TRACE y la cabecera Server dice solo «Apache»."),
  ...figura("despues/15b_apache_control.png", "Control: el checkpoint PHP sigue respondiendo y ya no anuncia la versión de PHP."),
  ...figura("despues/16_php_cookie_sesion.png", "Después: la cookie PHPSESSID lleva HttpOnly y SameSite=Strict."),
  ...figura("despues/10_nmap_puertos_tls_01.png", "Nmap después: Apache ya no muestra su versión ni ofrece TRACE; nginx sigue con TLS 1.3."),
  ...figura("despues/17_backend_cache_privada.png", "Backend en producción: la caché vive en un directorio propio del usuario del contenedor con permisos 700 (corrección B108)."),
  p("Las suites de verificación del proyecto se ejecutaron con la imagen nueva contra la base de datos real; cada una corre en una transacción que se revierte, así que no deja datos:"),
  ...figura("despues/18_verificar_autenticacion_03.png", "verificar_autenticacion en producción: 84 de 84 pasos correctos."),
  ...figura("despues/18_verificar_plataforma_03.png", "verificar_plataforma en producción: 79 de 79 pasos correctos."),
  ...(zapDespues ? [
    ...figura("despues/11_zap_escaneo_02.png", "OWASP ZAP después de las correcciones: el plan termina con éxito."),
    ...figura("despues/11b_zap_reporte_html.png", "Reporte de OWASP ZAP después: sin alertas de riesgo alto; la regla 40018 queda como falso positivo documentado."),
  ] : [p("[El escaneo de ZAP del «después» se agrega en la sección 3.4 al completarse.]")]),
  ...(ensayoPngs.length ? [
    p(`El ensayo de la demostración recorre la plataforma con las cuentas de prueba (login con segundo factor, permisos por rol, aislamiento entre instituciones, control dual y recuperación de contraseña). Se ejecutó después del despliegue para comprobar que la corrección de nginx no rompió nada: **${ensayoRes || "ver captura"}**.`),
    ...figura("despues/" + ensayoPngs[0], "Ensayo de la demostración contra producción después del despliegue (primeras comprobaciones)."),
    ...(ensayoPngs.length > 1 ? figura("despues/" + ensayoPngs[ensayoPngs.length - 1], "Ensayo de la demostración: resumen final.") : []),
  ] : []),
  ...tabla("Comparación del análisis dinámico antes y después", ["Prueba", "Antes", "Después"], [
    ["Host falso en http://…:8080", "301 a https://sitio-malicioso.example (redirección abierta)", "421 Misdirected Request"],
    ["Host falso en https://…:8443", "Llega a Django, que responde 400", "421 en nginx, no llega al backend"],
    ["Host legítimo (control)", "301 y 200", "301 y 200 (sin cambios)"],
    ["ZAP: SQL Injection en /auth/*", "Riesgo alto", "Falso positivo verificado y documentado"],
    ["TLS de nginx (Nmap)", "Solo TLS 1.3, calificación A", "Solo TLS 1.3, calificación A"],
    ["Apache :80: método TRACE", "200 (devuelve la petición)", "405 Method Not Allowed"],
    ["Apache :80: cabecera Server", "Apache/2.4.62 (Rocky Linux) mod_wsgi/4.7.1 Python/3.9", "Apache"],
    ["PHP: cabecera X-Powered-By", "PHP/8.3.33", "No se envía"],
    ["PHP: cookie de sesión", "PHPSESSID; path=/", "PHPSESSID; path=/; HttpOnly; SameSite=Strict"],
    ["Caché del backend (B108)", "/tmp/siget-cache (ruta fija)", "/tmp/siget-cache-1001 con permisos 700"],
    ["verificar_autenticacion / verificar_plataforma", "—", "84/84 y 79/79 con la imagen nueva"],
    ...(ensayoRes ? [["Ensayo funcional (regresión)", "—", ensayoRes]] : []),
  ], [2700, 3300, 3360]),
  salto(),
];

// ---------------------------------------------------------------- 4. conclusiones
const conclusiones = [
  h1("4. Conclusiones"),
  p("Cada integrante redacta su conclusión en su apartado (se recomienda entre 100 y 200 palabras: qué aprendió, qué hallazgo le pareció más relevante y qué haría distinto)."),
  ...INTEGRANTES.flatMap((n) => [
    h2(n),
    new Paragraph({ spacing: { after: 240 }, children: [t("[Escribe aquí tu conclusión.]", { italics: true, color: "808080" })] }),
  ]),
  salto(),
];

// ---------------------------------------------------------------- 5. bibliografía
const refs = [
  "Django Software Foundation. (2026). *Security in Django: Host header validation*. Django 5.2 documentation. https://docs.djangoproject.com/en/5.2/topics/security/#host-headers-virtual-hosting",
  "Fielding, R., Nottingham, M., & Reschke, J. (2022). *HTTP Semantics* (RFC 9110). Internet Engineering Task Force. https://www.rfc-editor.org/rfc/rfc9110",
  "GitHub. (2026). *GitHub Advisory Database*. https://github.com/advisories",
  "Gitleaks. (2026). *Gitleaks: Find secrets with Gitleaks* (versión 8.30.1) [Software]. https://github.com/gitleaks/gitleaks",
  "Lyon, G. F. (2009). *Nmap network scanning: The official Nmap project guide to network discovery and security scanning*. Insecure.Com LLC. https://nmap.org/book/",
  "MITRE Corporation. (2026). *Common Weakness Enumeration* (CWE-89, CWE-259, CWE-377, CWE-601 y CWE-703). https://cwe.mitre.org/",
  "npm, Inc. (2026). *npm-audit*. npm Docs. https://docs.npmjs.com/cli/commands/npm-audit",
  "OWASP Foundation. (2021). *OWASP Top 10:2021*. https://owasp.org/Top10/",
  "OWASP Foundation. (2020). *OWASP Web Security Testing Guide* (versión 4.2). https://owasp.org/www-project-web-security-testing-guide/",
  "PyCQA. (2026). *Bandit documentation* (versión 1.9). https://bandit.readthedocs.io/",
  "Python Packaging Authority. (2026). *pip-audit* (versión 2.10) [Software]. https://github.com/pypa/pip-audit",
  "Scarfone, K., Souppaya, M., Cody, A., & Orebaugh, A. (2008). *Technical guide to information security testing and assessment* (NIST SP 800-115). National Institute of Standards and Technology. https://doi.org/10.6028/NIST.SP.800-115",
  "Semgrep, Inc. (2026). *Semgrep documentation*. https://semgrep.dev/docs/",
  "Souppaya, M., Scarfone, K., & Dodson, D. (2022). *Secure Software Development Framework (SSDF) version 1.1* (NIST SP 800-218). National Institute of Standards and Technology. https://doi.org/10.6028/NIST.SP.800-218",
  "ZAP Dev Team. (2026). *ZAP Automation Framework*. ZAP Documentation. https://www.zaproxy.org/docs/automate/automation-framework/",
];
const bibliografia = [
  h1("5. Bibliografía"),
  ...refs.map((r) => new Paragraph({
    indent: { left: 720, hanging: 720 }, spacing: { after: 120, line: 276 },
    children: r.split(/(\*[^*]+\*)/g).filter(Boolean).map((s) => s.startsWith("*") ? t(s.slice(1, -1), { italics: true }) : t(s)),
  })),
];

// ---------------------------------------------------------------- documento
const doc = new Document({
  creator: "Grupo Ciber5", title: "Análisis estático y dinámico del código de SIGET", features: { updateFields: true },
  styles: {
    default: { document: { run: { font: FUENTE, size: 22 } } },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { font: FUENTE, size: 32, bold: true, color: "1F3864" }, paragraph: { spacing: { before: 240, after: 160 }, keepNext: true, outlineLevel: 0 } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { font: FUENTE, size: 26, bold: true, color: "2E5597" }, paragraph: { spacing: { before: 220, after: 120 }, keepNext: true, outlineLevel: 1 } },
      { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { font: FUENTE, size: 23, bold: true, color: "404040" }, paragraph: { spacing: { before: 180, after: 100 }, keepNext: true, outlineLevel: 2 } },
    ],
  },
  numbering: { config: [
    { reference: "vinetas", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
    { reference: "pasos", levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
  ] },
  sections: [{
    properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
    footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.RIGHT,
      children: [t("SIGET — Análisis estático y dinámico · ", { size: 18, color: "808080" }), new TextRun({ children: [PageNumber.CURRENT], size: 18, color: "808080", font: FUENTE })] })] }) },
    children: [...portada, ...indice, ...intro, ...estatico, ...dinamico, ...conclusiones, ...bibliografia],
  }],
});

Packer.toBuffer(doc).then((buf) => { fs.writeFileSync(SALIDA, buf); console.log("OK", SALIDA, `${nFig} figuras, ${nTab} tablas`); });
