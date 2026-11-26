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
const EV_ANALISIS = path.join(RAIZ, "docs/analisis-seguridad");
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
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 600 }, children: [t("Análisis estático y dinámico, correcciones en producción, nueve funcionalidades nuevas, ciclo de vida de desarrollo seguro (8 etapas) y mantenimiento de las máquinas virtuales", { size: 23, italics: true })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 120 }, children: [t("Integrantes", { bold: true, size: 24 })] }),
  ...INTEGRANTES.map((n) => new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 40 }, children: [t(n, { size: 23 })] })),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 500, after: 60 }, children: [t("Profesor: ", { bold: true }), t("[nombre del profesor]")] }),
  new Paragraph({ alignment: AlignmentType.CENTER, children: [t("26 de noviembre de 2026")] }),
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
  p("Este informe reúne **todo el trabajo de la última etapa del proyecto, hasta el 26 de noviembre de 2026,** y deja escrito **quién hizo cada parte y quién la revisó**. Cubre cinco frentes:"),
  vineta("**Análisis estático y dinámico** de la plataforma y la corrección de lo encontrado."),
  vineta("**Correcciones aplicadas en producción**, siempre con respaldo previo y vuelta atrás."),
  vineta("**Nueve funcionalidades nuevas** desplegadas: plazos con feriados y escalamiento automático (PT-3), registro por invitación (PT-2), documentos adjuntos cifrados (PT-8), derechos sobre los datos personales y aviso de privacidad (PT-15), contenido del trámite, cambio de contraseña con pantalla de error y paginación, notificaciones (PT-9), alertas ante patrones sospechosos (PT-10) y gestión del catálogo por cada institución, con el procedimiento común con el que se desplegó cada una."),
  vineta("**Las ocho etapas del ciclo de vida de desarrollo seguro** de Red Hat implementadas sobre SIGET, una por integrante."),
  vineta("**Mantenimiento de las máquinas virtuales**: actualización a Rocky Linux 9.9, cortafuegos, repositorios y limpieza de instantáneas."),
  p("Todo lo que se afirma aquí tiene evidencia (salida completa en texto y captura) en el repositorio, en `docs/analisis-seguridad/` y `docs/sdlc/evidencia/`, y cada cambio quedó registrado en el `CHANGELOG.md`, el runbook y los pull requests de GitHub."),
  salto(),
];

// ---------------------------------------------------------------- 2. quién hizo qué
const quien = [
  h1("2. Quién hizo qué"),
  p("El reparto sigue la organización que el grupo presentó el 12 de noviembre (`SIGET_Organizacion_SDLC_Seguro.docx`): cada integrante es responsable de un frente, con un entregable verificable y otra persona que lo revisa. La tabla suma lo hecho hasta el 26 de noviembre, incluidas las seis funcionalidades nuevas de la sección 4."),
  ...tabla("Trabajo realizado por cada integrante", ["Integrante", "Responsabilidad", "Trabajo realizado", "Revisó"], [
    ["**Jeison Vásquez**", "Coordinación, infraestructura y etapa 7 (implementación)", "Coordinación del equipo; despliegue en producción de las correcciones y de PT-3, PT-2 y PT-8 con respaldo y vuelta atrás; revisión del entorno de VM1 y VM2; actualización a Rocky 9.9; corrección de los hallazgos del entorno; retiro del checkpoint PHP y de pgAdmin web. Del 24 al 26 de noviembre, el despliegue de PT-15, el contenido del trámite, el cambio de contraseña, las notificaciones, las alertas (rol `detector_role`, `pg_hba.conf`, temporizador) y el catálogo, cada uno con respaldo verificado, ensayo de la migración e imagen verificada antes de reiniciar; la corrección de nginx", "Andy Martínez"],
    ["**Simna De Gracia**", "Etapa 1: planificación", "Registro de 27 riesgos con probabilidad, impacto, control y estado: R22 (alertas) mitigado y tres riesgos nuevos (datos personales en texto libre, derechos sobre los datos, cambios al catálogo); 13 pendientes priorizados", "Jeison Vásquez"],
    ["**Gabriel González**", "Etapa 2: análisis de requisitos", "Matriz de 26 requisitos de seguridad (24 cumplen) y 11 artículos de las leyes 81 de 2019, 83 de 2012 y 6 de 2002; los requisitos y el texto legal de PT-15 (aviso de privacidad y derechos ARCO)", "Simna De Gracia"],
    ["**Joel Medina**", "Etapa 3: diseño", "Modelo de amenazas STRIDE con diagrama de flujo de datos: 62 amenazas en 10 componentes; diseño de seguridad de los documentos cifrados (PT-8), de las notificaciones y del catálogo (separación de funciones y copia inmutable del formulario)", "Andy Martínez"],
    ["**Andy Martínez**", "Etapa 4: desarrollo", "Análisis estático (Bandit, Semgrep, pip-audit, npm audit, Gitleaks) y corrección del código; desarrollo de PT-3, PT-2 y PT-8 y, del 24 al 26 de noviembre, de PT-15, el contenido del trámite, el cambio de contraseña, las notificaciones, las alertas y el catálogo; CI de seguridad automático y Dependabot; 19 reglas de codificación segura", "Jeison Vásquez"],
    ["**Jorge Medina**", "Etapa 5: documentación", "`SECURITY.md`, inventario de 57 controles, CHANGELOG y runbook de cada cambio, con el registro de la aplicación de las secciones 39 a 44", "Gabriel González"],
    ["**Bradley Morales**", "Etapa 6: pruebas", "Análisis dinámico (Nmap, OWASP ZAP, verificación manual de la alerta de inyección SQL, pruebas con curl); plan de pruebas; verificaciones contra la base real; ensayo que creció de 101 a 119 comprobaciones; pruebas de la base con `ROLLBACK` (escalamiento, notificaciones, alertas y catálogo); lista de revisión de 12 puntos aplicada a los PR #10 y #12", "Joel Medina"],
    ["**Anyurie Sánchez**", "Etapa 8: supervisión", "Bitácora semanal de supervisión y procedimiento ante intrusiones; la consola de alertas como herramienta de supervisión (cuatro reglas, revisión con nota) y las dos primeras alertas del detector", "Walter Sanjur"],
    ["**Walter Sanjur**", "Etapa 8: parches y dependencias", "Bitácora de parches con línea base y seguimiento; calendario de fin de soporte; deshabilitación de los repositorios con firma inválida y retiro de las instantáneas; seguimiento de las dependencias (excepción de picomatch y falso positivo de Gitleaks)", "Jeison Vásquez"],
  ], [1700, 1900, 4260, 1500]),
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
  p("Son **nueve** funcionalidades. Las tres primeras (PT-3, PT-2 y PT-8) se desplegaron el 12 de noviembre y las seis siguientes entre el 24 y el 26 de noviembre. Todas siguieron el mismo procedimiento (sección 4.10): respaldo verificado de la base, ensayo de la migración con `ROLLBACK`, migración real, imagen verificada contra la base real antes de reiniciar y ensayo completo contra producción. Al cerrar la primera tanda, `verificar_tramites` dio 77/77, `verificar_plataforma` 91/91, `verificar_autenticacion` 84/84 y el ensayo 101/101, con 555 pruebas del backend y 206 del frontend. Al cerrar la última (el catálogo, el 26 de noviembre), el ensayo dio **119/119** y las ocho verificaciones dieron todo en verde."),
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
  h2("4.4 Derechos sobre los datos personales y aviso de privacidad (PT-15, Ley 81 de 2019)"),
  autoria("Andy Martínez (desarrollo), Gabriel González (requisitos y Ley 81) y Jeison Vásquez (despliegue)", "Joel Medina"),
  p("**Qué hace.** Al registrarse, la persona lee un aviso de privacidad en lenguaje claro (quién trata sus datos, para qué sirve cada uno, quién accede, cuánto se conservan y cómo ejercer sus derechos) y debe marcar que lo leyó; la plataforma guarda qué versión aceptó y cuándo. «Mis datos» le muestra su perfil, con la cédula enmascarada, le deja corregir el correo, la provincia y la ciudad, y pedir la rectificación, cancelación u oposición del resto. El operador de identidades responde en 10 días hábiles de Panamá y la consola marca las solicitudes vencidas."),
  p("**Cómo se protege.** La corrección directa exige segundo factor reciente y la base solo deja actualizar esas tres columnas: nombre, apellidos, cédula, fecha de nacimiento y la constancia del aviso no se pueden tocar desde la aplicación. Las solicitudes no se borran ni cambian su detalle, y el auditor, pgAdmin, el checkpoint y el escalador no las leen. La cancelación no borra el expediente de los trámites, que tiene conservación obligatoria, y la respuesta lo explica. Los perfiles anteriores quedan sin constancia del aviso: no se inventa. **Resultado:** migración 016 con 7/7 comprobaciones de la base, `verificar_autenticacion` 169/169 y ensayo 101/101; los requisitos RS-09 y RS-22 pasaron a «Cumple»."),
  ...figS("14_pt15_migracion.png", "PT-15: migración 016 aplicada y sus 7 comprobaciones de la base"),
  ...figS("14_pt15_ensayo.png", "PT-15: ensayo completo contra producción, 101 de 101"),
  h2("4.5 Contenido del trámite: formulario, motivo y respuesta a la subsanación"),
  autoria("Andy Martínez (desarrollo) y Jeison Vásquez (despliegue)", "Bradley Morales"),
  p("**Qué hace.** Un trámite deja de ser solo «un tipo y un estado»: lleva los datos que pide el formulario de su tipo (por ejemplo, la dirección y el número de finca de un permiso), cada rechazo o petición de subsanación lleva un **motivo** que la persona ve en su historial, y la persona **responde la subsanación** ella misma, con su respuesta y, si quiere, los datos corregidos. Ningún formulario pide cédula, nombre ni correo, para pedir solo lo necesario."),
  p("**Cómo se protege.** La base exige el motivo (de 10 a 2000 caracteres, con al menos una letra o un número) aunque alguien se salte la API, y lo limpia al terminar cada actualización para que no se arrastre a otro cambio. Los datos del formulario solo cambian cuando quien responde la subsanación es la persona solicitante, aunque después reciba membresía en la institución, así el personal no puede reescribir lo que ella declaró. El formulario se valida en una función pura (tipos, largos, rangos, fechas, opciones y campos desconocidos) y el motivo se dibuja siempre como texto. **Resultado:** ensayo de la migración 017 con 8/8 comprobaciones (incluida la base rechazando un rechazo sin motivo), `verificar_tramites` 152/152 y ensayo 112/112."),
  ...figS("15_contenido_respaldo_y_ensayo.png", "Contenido del trámite: respaldo verificado y ensayo de la migración 017 con ROLLBACK"),
  ...figS("15_contenido_ensayo.png", "Contenido del trámite: ensayo completo contra producción, 112 de 112"),
  h2("4.6 Cambio de contraseña, pantalla de error y paginación"),
  autoria("Andy Martínez (desarrollo) y Jeison Vásquez (despliegue)", "Bradley Morales"),
  p("**Qué hace.** Desde «Mi seguridad» la persona cambia su contraseña escribiendo la actual y la nueva. Al cambiarla se cierran todas sus sesiones y se abre una nueva, así que la sesión sigue sin volver a entrar. Una pantalla de error propia reemplaza a la pantalla en blanco cuando algo falla al dibujar: mensaje claro, «Volver al inicio» y «Reintentar». Las listas de trámites se muestran de a 20, con «Anterior» y «Siguiente» y «Mostrando a–b de N»."),
  p("**Cómo se protege.** El cambio exige segundo factor reciente y verifica la contraseña actual con la misma función del inicio de sesión: un error cuenta como intento fallido del bloqueo progresivo y la respuesta es genérica. La nueva pasa por la política del registro (de 12 a 128 caracteres, sin el usuario y no común) y no puede ser igual a la actual; hay un límite de 5 cambios por hora y un tope de 128 caracteres antes de calcular ningún hash. La pantalla de error no muestra la traza, el mensaje del error ni datos de la persona. **Resultado:** sin migración; las ocho verificaciones en verde a la primera (`verificar_autenticacion` 200/200, `verificar_tramites` 155/155) y ensayo 112/112."),
  ...figS("16_pulido_verificaciones_y_despliegue.png", "Cambio de contraseña, pantalla de error y paginación: las ocho verificaciones antes de reiniciar"),
  ...figS("16_pulido_ensayo.png", "Cambio de contraseña, pantalla de error y paginación: ensayo completo, 112 de 112"),
  h2("4.7 Notificaciones dentro de la plataforma (PT-9)"),
  autoria("Andy Martínez (desarrollo), Joel Medina (diseño de seguridad) y Jeison Vásquez (despliegue)", "Bradley Morales"),
  p("**Qué hace.** Una campana en la barra superior avisa a la persona de lo que le importa: a quien pidió el trámite cuando pasa a atención, a subsanación, a aprobado o a rechazado; al funcionario asignado cuando la persona responde una subsanación; y a la supervisión de la institución cuando un trámite se escala por vencimiento. El texto es llano, se marcan como leídas una por una o todas, y un clic abre el trámite."),
  p("**Cómo se protege.** La tabla no tiene texto libre ni datos personales: solo el tipo del aviso (una lista cerrada de seis), el trámite y las fechas; el motivo se lee en el detalle del trámite con sus controles de siempre. Los avisos los genera la base con un disparador, en la misma transacción del cambio y nunca para quien hizo el cambio; la aplicación no puede insertarlos. Cada persona solo ve y marca los suyos (seguridad por filas más un filtro en la API) y la consulta de fondo de la campana no renueva una sesión vencida ni deja decisiones «permitidas» en el registro. **Resultado:** 36/36 pruebas de la base, `verificar_tramites` 214/214 y ensayo 113/113."),
  p("**Lo que se aprendió.** Desde afuera `/notificaciones/` respondía 404 aunque el ensayo diera 112/112: nginx solo pasa al backend una lista fija de rutas y esa no estaba. Se corrigió en producción con respaldo, escribiendo sobre el mismo archivo, validando con `nginx -t` y recargando sin cortar conexiones; el ensayo ahora incluye una comprobación que atraviesa nginx con sesión real."),
  ...figS("17_notificaciones_nginx.png", "Notificaciones: nginx deja pasar /notificaciones/ al backend, con respaldo y recarga sin cortes"),
  ...figS("17_notificaciones_ensayo.png", "Notificaciones: ensayo completo con la campana atravesando nginx, 113 de 113"),
  h2("4.8 Alertas ante patrones sospechosos (PT-10)"),
  autoria("Andy Martínez (desarrollo), Anyurie Sánchez (supervisión: reglas y revisión de alertas) y Jeison Vásquez (despliegue)", "Walter Sanjur"),
  p("**Qué hace.** Cada 5 minutos un detector revisa los registros de seguridad y abre una alerta cuando ve uno de cuatro patrones: 10 inicios de sesión o cambios de contraseña fallidos desde una misma IP en 10 minutos, 5 denegaciones del decisor de acceso a una misma persona en 10 minutos, cualquier reuso de un token de refresco y 2 bloqueos de una misma cuenta en 24 horas. El operador de seguridad revisa cada alerta en la consola de respuesta a incidentes y la marca como revisada o descartada con una nota obligatoria; el auditor las lee. La plataforma **no bloquea por su cuenta**: la decisión es de una persona."),
  p("**Cómo se protege.** El detector usa un rol propio, `detector_role`, que solo puede ejecutar esa función, y su contenedor se niega a arrancar si le llegan las claves de la aplicación. Hay una sola alerta abierta por regla, persona e IP, y el detalle lleva solo contadores y nombres, nunca cédula, correo ni credenciales. La aplicación no puede insertar, borrar ni cambiar el conteo de una alerta; la revisión se hace una sola vez, con nota, por un operador de seguridad, y la hora la fija la base. La contraseña del rol se generó en la base y pasó directo a un secreto de Podman sin mostrarse ni guardarse. **Resultado:** 57/57 pruebas de la base a la primera, escalamiento (10/10) y notificaciones (36/36) sin romperse, `verificar_plataforma` 147/147 y ensayo 116/116. Después del ensayo, el detector abrió las dos alertas que el ensayo provoca a propósito (`fabio.mop` con 6 denegaciones e `ivan.identidades` con 5); quedaron abiertas para mostrar su revisión. El requisito RS-24 pasó a «Cumple»."),
  ...figS("18_alertas_migracion.png", "Alertas: migración 019 aplicada y sus 57 comprobaciones de la base"),
  ...figS("18_alertas_verificaciones_despliegue_y_temporizador.png", "Alertas: las verificaciones antes de reiniciar, el despliegue y el temporizador del detector"),
  h2("4.9 Gestión del catálogo por cada institución"),
  autoria("Andy Martínez (desarrollo), Joel Medina (diseño de seguridad: separación de funciones y copia del formulario) y Jeison Vásquez (despliegue)", "Bradley Morales"),
  p("**Qué hace.** La coordinación de cada institución crea, edita y desactiva los trámites que ofrece: nombre, plazo (de 1 a 365 días hábiles), para quién es y su formulario, con un editor visual y una vista previa del formulario real. Un trámite desactivado deja de aceptar solicitudes nuevas, pero los que ya existen siguen su curso; nunca se borra. Cada cambio queda en un historial."),
  p("**Cómo se protege.** Solo la coordinación de esa institución, con segundo factor reciente, puede gestionarlo, y la base lo vuelve a exigir con un disparador; la credencial de la aplicación sin contexto de usuario es rechazada. La estructura del formulario se valida en la API y en la base. **Cada trámite guarda una copia inmutable del formulario con el que nació**, que pone la base: cambiar el catálogo no altera ni hace perder lo ya iniciado (la migración completó la copia en los 103 trámites existentes). El historial es inalterable, con quién, cuándo y solo lo que cambió, y si dos personas editan a la vez la segunda recibe un aviso de versión (409). **Resultado:** 82/82 pruebas de la base a la primera, las ocho verificaciones a la primera (`verificar_equipo` 133/133) y ensayo 119/119."),
  ...figS("19_catalogo_respaldo_y_ensayo_02.png", "Catálogo: ensayo de la migración 020 con sus 82 pruebas de la base, revertido sin dejar rastro"),
  ...figS("19_catalogo_ensayo.png", "Catálogo: ensayo completo contra producción, 119 de 119"),
  h2("4.10 Cómo se desplegó cada cambio"),
  autoria("Jeison Vásquez (despliegue e infraestructura) y Bradley Morales (ensayo y verificaciones)", "Andy Martínez"),
  p("Los seis cambios del 24 y el 26 de noviembre se desplegaron con el mismo procedimiento, escrito en el runbook (secciones 39 a 44) con su registro de la aplicación:"),
  vineta("**Respaldo verificado** de la base en VM2, restaurado de prueba y comparado con la base viva, y una copia con sello `pre-0NN` que la rotación de 14 días no borra."),
  vineta("**Ensayo de la migración con sus pruebas** de la base en una sola transacción que termina en `ROLLBACK`, y comprobación de que no quedó nada."),
  vineta("**Migración real** y las mismas pruebas sobre la base migrada, más las pruebas de las migraciones anteriores como regresión."),
  vineta("**Imagen verificada antes de reiniciar:** se guarda la imagen en uso, se construye la nueva con otra etiqueta y se corren las ocho verificaciones contra la base real (todas se revierten). Si algo falla, producción no se tocó."),
  vineta("**Despliegue con respaldo** de la imagen anterior y de la interfaz, y la forma de volver atrás escrita."),
  vineta("**Ensayo completo** contra producción por nginx, que creció de 101 a 119 comprobaciones."),
  ...tabla("Resultado de cada despliegue", ["Cambio", "Fecha", "Migración y pruebas de la base", "Verificación de la imagen (resultado destacado)", "Ensayo"], [
    ["PT-15, derechos y aviso de privacidad", "24-nov", "016: 7/7", "`verificar_autenticacion` 169/169, `verificar_tramites` 77/77", "101/101"],
    ["Contenido del trámite", "24-nov", "017: 8/8", "`verificar_tramites` 152/152", "112/112"],
    ["Contraseña, pantalla de error y paginación", "24-nov", "sin migración", "`verificar_autenticacion` 200/200, `verificar_tramites` 155/155", "112/112"],
    ["Notificaciones", "24-nov", "018: 36/36", "`verificar_tramites` 214/214", "113/113"],
    ["Alertas (PT-10)", "26-nov", "019: 57/57", "`verificar_plataforma` 147/147", "116/116"],
    ["Catálogo por institución", "26-nov", "020: 82/82", "`verificar_equipo` 133/133, `verificar_plataforma` 154/154, `verificar_tramites` 214/214, `verificar_autenticacion` 200/200", "119/119"],
  ], [2100, 800, 1500, 3760, 1200]),
  p("**Dos lecciones quedaron documentadas.** La primera, en el contenido del trámite: un reemplazo de texto hecho al aplicar las correcciones de una revisión había cambiado `func2_mop` por `super_mop` en seis pasos de `verificar_tramites`, y la cuenta de prueba se creaba dos veces. Ninguna prueba unitaria lo notó, porque las verificaciones solo corren contra la base real; se atrapó al verificar la imagen **antes de reiniciar**, se restauraron esas líneas y producción no se tocó. De ahí salió la regla de que las verificaciones solo agregan pasos. La segunda, en las notificaciones: la ruta `/notificaciones/` que nginx no dejaba pasar, que ninguna prueba veía y se notó al comprobar desde afuera; de ahí salieron la regla de agregar toda ruta nueva a nginx y al proxy de desarrollo y la comprobación del ensayo que atraviesa nginx."),
  salto(),
];

// ---------------------------------------------------------------- 5. SDLC seguro
const etapa = (titulo, hizo, reviso, parrafos, extras = []) => [h2(titulo), autoria(hizo, reviso), ...parrafos.map((x) => p(x)), ...extras];
const sdlc = [
  h1("5. Ciclo de vida de desarrollo seguro: las 8 etapas"),
  p("Se tomó como marco la guía de Red Hat «Seguridad en el ciclo de vida de desarrollo del software»: aplicar la seguridad desde el inicio y en cada etapa (shift left) con responsabilidad compartida entre desarrollo, operaciones y seguridad (DevSecOps). Cada etapa tiene su entregable en `docs/sdlc/` y su responsable. La primera versión es del 16 de noviembre; el 26 de noviembre todas se actualizaron con lo hecho desde el 17 (PT-15, contenido del trámite, cambio de contraseña, notificaciones, alertas y catálogo)."),
  ...tabla("Resultado de cada etapa al 26 de noviembre de 2026", ["Etapa", "Responsable", "Resultado"], [
    ["1. Planificación", "Simna De Gracia", "27 riesgos evaluados; 13 con algo pendiente (5 de nivel Alto y 8 de nivel Medio), priorizados. Mitigados: R5, R8, R22 y R24; nuevos: R25, R26 y R27"],
    ["2. Requisitos", "Gabriel González", "26 requisitos (24 cumplen, 1 parcial, 1 no cumple) y 11 artículos de leyes panameñas (7 cumplen, 3 parciales, 1 no cumple)"],
    ["3. Diseño", "Joel Medina", "62 amenazas STRIDE en 10 componentes: 42 mitigadas, 19 parciales, 1 abierta"],
    ["4. Desarrollo", "Andy Martínez", "19 reglas de codificación segura (5 nuevas desde el 24-nov); CI de seguridad con 5 controles en verde y Dependabot"],
    ["5. Documentación", "Jorge Medina", "57 controles inventariados (14 nuevos) y `SECURITY.md` completa"],
    ["6. Pruebas", "Bradley Morales", "Backend 1399 y frontend 424 pruebas en el último PR; ocho verificaciones contra la base real en verde (`verificar_tramites` 214/214, `verificar_autenticacion` 200/200, `verificar_plataforma` 154/154, `verificar_equipo` 133/133, `verificar_politicas` 41/41, `verificar_auditoria` 34/34, `verificar_integracion` 15/15 y `verificar_esquema` OK); pruebas de la base con ROLLBACK (escalamiento 10, notificaciones 36, alertas 57, catálogo 82); ensayo 119/119; lista de revisión de 12 puntos"],
    ["7. Implementación", "Jeison Vásquez", "Revisión de VM1 y VM2: 5 hallazgos, los 5 corregidos; seis cambios del 24 al 26-nov aplicados con respaldo, ensayo e imagen verificada antes de reiniciar"],
    ["8. Mantenimiento", "Anyurie Sánchez y Walter Sanjur", "Supervisión semanal con consola de alertas (4 reglas, revisión con nota); parches: de 2 críticos por VM a 0 críticos y 0 pendientes el 16-nov, sin nueva medición después del 17-nov"],
  ], [2000, 2100, 5260]),
  ...etapa("5.1 Etapa 1 — Planificación", "Simna De Gracia", "Jeison Vásquez", [
    "Se armó el **registro de riesgos** de SIGET (`01-registro-de-riesgos.md`): 27 riesgos, cada uno con qué puede pasar, a qué afecta (datos de la ciudadanía, trámites, disponibilidad), probabilidad, impacto, nivel y el control que lo reduce. Quedan 13 con algo pendiente, ordenados por prioridad (5 de nivel Alto y 8 de nivel Medio). Se mitigaron durante el trabajo R5 (parches del sistema sin aplicar, el 16 de noviembre), R8 (checkpoint PHP en HTTP) y R24 (repositorios con firma inválida, el 17) y R22 (sin alertas automáticas, el 26 de noviembre con PT-10, que bajó de Alto a Medio). Con las funciones nuevas aparecieron R25 (derechos sobre los datos personales), R26 (datos personales en texto libre) y R27 (cambios indebidos al catálogo). Al recontar se corrigió un error del conteo anterior, que decía 12 pendientes cuando la tabla listaba 11.",
  ]),
  ...etapa("5.2 Etapa 2 — Análisis de requisitos", "Gabriel González", "Simna De Gracia", [
    "Se definieron 26 **requisitos de seguridad** (`02-requisitos-de-seguridad.md`) y se cruzaron con 11 artículos de la Ley 81 de 2019 (protección de datos personales), la Ley 83 de 2012 (gobierno electrónico) y la Ley 6 de 2002 (transparencia). Resultado: 24 se cumplen, 1 parcialmente (RS-17, falta la copia de los respaldos fuera de VM2) y 1 no se cumple (RS-26, verificar la identidad de quien se registra, que depende del Registro Civil y de un servidor de correo, y se declara como límite del laboratorio). Los que al principio no se cumplían se cerraron: RS-13 al retirar el checkpoint PHP (17 de noviembre), RS-09 y RS-22 con los derechos sobre los datos personales y el aviso de privacidad (24 de noviembre, PT-15) y RS-24 con las alertas (26 de noviembre, PT-10). De las 11 filas normativas, 7 se cumplen, 3 son parciales y 1 no se cumple: la política de conservación de datos de la Ley 81, art. 2, num. 2.",
  ]),
  ...etapa("5.3 Etapa 3 — Diseño", "Joel Medina", "Andy Martínez", [
    "Se hizo el **modelo de amenazas STRIDE** (`03-modelo-de-amenazas.md`) sobre el diagrama de flujo de datos de SIGET: 62 amenazas en 10 componentes (navegador e interfaz, nginx, backend Django, base de datos PostgreSQL, temporizador de escalamiento, archivos de documentos y, desde el 24 de noviembre, el contenido del trámite, las notificaciones, las alertas de seguridad y el catálogo de la institución). Para cada una se anotó el control que la frena; por ejemplo, la seguridad por filas frena la divulgación de trámites entre instituciones, la auditoría inalterable frena el repudio y la copia inmutable del formulario frena que un cambio del catálogo altere trámites ya iniciados. Quedan 42 mitigadas, 19 parciales y 1 abierta (una sola persona con sudo en VM2).",
  ]),
  ...etapa("5.4 Etapa 4 — Desarrollo", "Andy Martínez", "Jeison Vásquez", [
    "Se escribieron **19 reglas de codificación segura** (`04-codificacion-segura.md`): las 14 primeras a partir de los hallazgos reales del análisis estático y las 5 últimas, del 24 al 26 de noviembre, de lo aprendido al desplegar (la base valida además de la aplicación, toda escritura lleva contexto de usuario, toda ruta nueva va también en nginx y en el proxy, las verificaciones solo agregan pasos, y los textos libres se validan por contenido). La seguridad se automatizó en el CI (`.github/workflows/security-scan.yml`): Bandit, Semgrep, pip-audit, npm audit y Gitleaks corren en cada pull request, en cada push a `develop` y `main` y una vez por semana. Gitleaks se descarga verificando su suma SHA-256 oficial. Dependabot propone las actualizaciones de dependencias por PR y `CODEOWNERS` exige revisión en lo sensible. El PR #16 quedó con los 5 controles en verde.",
  ]),
  ...etapa("5.5 Etapa 5 — Documentación", "Jorge Medina", "Gabriel González", [
    "Se completó la **política de seguridad** (`SECURITY.md`: cómo reportar una vulnerabilidad, versiones con soporte, qué pasa después del reporte y alcance) y el **inventario de 57 controles** (`05-inventario-de-controles.md`), cada uno con lo que protege, dónde está documentado, cómo se verifica y quién responde por él; 14 se agregaron del 24 al 26 de noviembre con las funciones nuevas. Cada cambio del proyecto quedó en el `CHANGELOG.md` y en el runbook, que desde la sección 39 trae el registro de la aplicación de cada migración.",
  ]),
  ...etapa("5.6 Etapa 6 — Pruebas", "Bradley Morales", "Joel Medina", [
    "Se escribió el **plan de pruebas de seguridad** (`06-plan-de-pruebas.md`), que junta las pruebas automáticas (1399 del backend y 424 del frontend en el último PR), las ocho verificaciones contra la base real, las pruebas de la base con `ROLLBACK` (`database/pruebas-*.sql`: escalamiento 10, notificaciones 36, alertas 57 y catálogo 82), el ensayo de 119 comprobaciones contra producción y el análisis dinámico. Se armó una **lista de revisión de código**, de 10 puntos al aplicarla a los PR #10 y #12 y de 12 hoy (rutas nuevas en nginx y verificaciones que solo agregan pasos), y se documentaron las correcciones de dos revisiones de seguridad por cada función nueva.",
  ]),
  ...etapa("5.7 Etapa 7 — Implementación", "Jeison Vásquez", "Andy Martínez", [
    "Se revisó el **entorno de despliegue** de VM1 y VM2 solo con comandos de lectura (`07-revision-del-entorno.md`): SELinux en Enforcing, SSH solo con clave, cortafuegos, TLS 1.3 con calificación A, cabeceras de seguridad y contenedores sin root. Salieron 5 hallazgos y se corrigieron los 5: una regla sobrante del puerto 5432 en VM2, los avisos críticos sin aplicar, la versión de Rocky sin soporte, los repositorios con firma inválida y el puerto 80 del checkpoint PHP (sección 6.4). Después, la etapa documentó los cambios del entorno del 24 al 26 de noviembre: el rol `detector_role` y su línea en `pg_hba.conf`, la corrección de nginx (ambos archivos editados sobre el mismo archivo, con respaldo) y el procedimiento de despliegue de la sección 4.10. La revisión de solo lectura completa no se repitió después del 17 de noviembre.",
  ], [...figS("07_vm1_revision.png", "Revisión del entorno de VM1 (solo lectura)"), ...figS("07_tls_cabeceras.png", "TLS 1.3 y cabeceras de seguridad de la plataforma")]),
  ...etapa("5.8 Etapa 8 — Mantenimiento: supervisión", "Anyurie Sánchez", "Walter Sanjur", [
    "Se abrió la **bitácora semanal de supervisión** (`08-bitacora-supervision.md`): eventos de seguridad, cuentas bloqueadas, accesos denegados, estado de los temporizadores y del respaldo diario. Se escribió además el **procedimiento ante una intrusión**: a quién avisar, cómo contener (bloquear la cuenta, cerrar sesiones) y qué evidencia guardar. Desde el 26 de noviembre la revisión empieza por la **consola de alertas**: cuatro reglas que el detector evalúa cada 5 minutos, con una revisión que exige nota y que se hace una sola vez. Las dos primeras alertas, abiertas por el ensayo a propósito, quedaron para mostrar cómo se revisan.",
  ], figS("08_supervision_semana.png", "Primera revisión semanal de supervisión")),
  ...etapa("5.9 Etapa 8 — Mantenimiento: parches y dependencias", "Walter Sanjur", "Jeison Vásquez", [
    "Se tomó la **línea base de parches** el 16 de noviembre: 2 avisos críticos en cada VM (203 avisos de seguridad en VM1 y 192 en VM2), con lo que se incumplía la regla de 7 días para los críticos. Esa misma noche se actualizó todo (sección 6) y la bitácora (`08-bitacora-parches.md`) registra el después: 0 críticos y 0 pendientes. No se midió de nuevo después del 17 de noviembre y por eso la bitácora no inventa una cifra. También se armó el calendario de fin de soporte (por ejemplo, Python 3.12 vence en abril de 2027 y PostgreSQL 16 en noviembre de 2028), con aviso un mes antes de cada fecha, y se sigue la excepción conocida de una dependencia de desarrollo sin versión corregida.",
  ], [...figS("08_parches_linea_base.png", "Línea base: avisos pendientes antes de actualizar"), ...figS("10_parches_despues.png", "Después de actualizar: 0 avisos críticos y 0 pendientes")]),
  salto(),
];

// ---------------------------------------------------------------- 6. mantenimiento de las VMs
const vms = [
  h1("6. Mantenimiento de las máquinas virtuales"),
  autoria("Jeison Vásquez y Walter Sanjur (6.1 a 6.3); Jeison Vásquez (6.4 y 6.5)", "Andy Martínez"),
  h2("6.1 Actualización a Rocky Linux 9.9 (16 de noviembre)"),
  p("Las dos VMs pasaron de Rocky 9.7, sin soporte desde mayo, a **9.9**, con todos los avisos de seguridad aplicados. Se hizo con cinco cuidados: respaldo verificado de la base, una instantánea de VMware de cada VM, una máquina por vez (primero VM2 y, verificada, VM1), reinicio para cargar el kernel nuevo y verificaciones completas contra la base real (77/77, 91/91, 84/84 y ensayo 101/101). En VM2 se quitó además la regla del cortafuegos del puerto 5432, que no se usaba."),
  ...figS("09_vm1_actualizacion.png", "Actualización de VM1 a Rocky Linux 9.9"),
  h2("6.2 Repositorios con firma inválida (17 de noviembre)"),
  p("Tras el reinicio apareció que los seis repositorios externos de PostgreSQL en VM1 (`pgdg-common` y `pgdg14` a `pgdg18`), que habían quedado de la instalación de pgAdmin, fallaban la verificación de firma GPG. Un repositorio así no se debe usar: no se puede confirmar que los paquetes sean legítimos. Se respaldó su archivo y se deshabilitaron los seis; `dnf` volvió a funcionar sin errores y siguen 0 avisos pendientes."),
  ...figS("11_vm1_repos_pgdg.png", "Repositorios pgdg deshabilitados y dnf sin errores"),
  h2("6.3 Retiro de las instantáneas (17 de noviembre)"),
  p("Confirmado que todo seguía funcionando, se borraron las instantáneas «antes-de-rocky-9.8-2026-11-16» de las dos VMs. Una instantánea vieja ocupa disco y hace más lento el acceso a los discos virtuales. VMware dejó los discos marcados para consolidar porque la consola los tenía abiertos; se completa con «Manage > Clean Up Disks» con las VMs apagadas, y mientras tanto las VMs funcionan igual."),
  ...figS("12_instantaneas_borradas.png", "Las dos VMs sin instantáneas"),
  h2("6.4 Retiro del checkpoint PHP y cierre del puerto 80 (17 de noviembre)"),
  p("El checkpoint PHP fue una entrega intermedia del semestre y seguía sirviendo su inicio de sesión por HTTP, sin cifrar, en el puerto 80 de VM1. Al revisarlo apareció que ese mismo Apache servía también **pgAdmin web**, un primer intento de checkpoint que quedó instalado, abierto a toda la red y también sin cifrar. SIGET no usa ninguno de los dos y el registro de accesos estaba vacío desde el 16 de noviembre."),
  p("Con respaldo previo (código del checkpoint, configuración de Apache, PHP y pgAdmin, y la regla del cortafuegos, en una carpeta solo de root) se detuvieron y deshabilitaron Apache y php-fpm, se quitó el servicio `http` del cortafuegos y el rol `checkpoint_app` de la base quedó sin inicio de sesión, así que la contraseña que guardaba su configuración ya no sirve. Después: el puerto 80 no responde, la plataforma sí, `verificar_tramites` 77/77, `verificar_plataforma` 91/91, `verificar_autenticacion` 84/84 y ensayo 101/101. Con esto el requisito RS-13 (todo el tráfico por TLS 1.3) pasa a cumplirse."),
  ...figS("13_puerto80_despues.png", "Puerto 80 cerrado y plataforma verificada"),
  h2("6.5 Copia de la clave de los documentos fuera de VM1 (17 de noviembre)"),
  p("La clave que cifra los documentos adjuntos existía solo en VM1: si la máquina se dañaba, los archivos quedaban ilegibles para siempre (riesgo R6, la amenaza abierta más grave). Se copió directamente de VM1 a una carpeta del equipo anfitrión con permisos solo para el administrador, sin que el valor apareciera en pantalla ni en ningún documento, y se comprobó que la copia es idéntica comparando su huella SHA-256. Queda llevar una segunda copia fuera del PC anfitrión, porque las dos VMs corren en ese mismo equipo."),
  salto(),
];

// ---------------------------------------------------------------- 7. pendientes
const pendientes = [
  h1("7. Lo que queda pendiente"),
  p("Lo que sigue pendiente al 26 de noviembre de 2026, con su responsable. Los tres primeros y el sexto dependen de infraestructura que el laboratorio no tiene (otro equipo, otro lugar donde guardar copias, un servidor de correo) y por eso se declaran como límites en vez de aparentar que están resueltos."),
  ...tabla("Trabajo pendiente", ["Pendiente", "Por qué importa", "Responsable"], [
    ["Copia de los respaldos de la base fuera de VM2 (R7, RS-17)", "Los respaldos están en la misma VM2: si se pierde VM2 o el PC que la aloja, se pierden la base y sus respaldos a la vez", "Jeison Vásquez"],
    ["Segunda persona con sudo en VM2 (R9)", "Una sola persona puede restaurar, parchar y migrar: si no está, nadie más puede", "Jeison Vásquez"],
    ["Segunda copia de la clave de los documentos fuera del PC anfitrión (USB o gestor de contraseñas) (R6)", "La copia del 17-nov está fuera de VM1 pero en el mismo PC que aloja las VMs; sin la clave, los archivos cifrados no se pueden leer", "Jeison Vásquez"],
    ["Exportación firmada de la auditoría (parte pendiente de ZT-8 y R22)", "Las alertas ya están, pero los registros viven en la misma VM y no hay una copia firmada fuera de ella", "Anyurie Sánchez y Andy Martínez"],
    ["Pruebas de punta a punta de la interfaz con Playwright", "Hoy el ensayo recorre la API por nginx pero ninguna prueba maneja el navegador de punta a punta", "Bradley Morales"],
    ["RS-26: verificar la identidad de quien se registra (límite declarado)", "Depende de contrastar con el Registro Civil y de un servidor de correo que el laboratorio no tiene; es el único requisito que no se cumple", "Gabriel González"],
    ["Política de conservación de datos personales (Ley 81, art. 2, num. 2) (R25, R26)", "No hay una regla de cuánto tiempo se guardan los perfiles, las notificaciones y el texto libre; la base no permite borrar perfiles", "Gabriel González y Andy Martínez"],
    ["Volver la inactividad de la sesión a 10 minutos después de la demostración (R21)", "La unidad del backend de VM1 conserva los 2 minutos de la demostración, que no coinciden con el repositorio", "Jeison Vásquez"],
    ["Aviso automático si un temporizador falla (escalamiento o detector) (R12)", "Las alertas miran eventos de seguridad, no el estado de los temporizadores", "Andy Martínez"],
    ["Consolidar los discos de las VMs", "Terminar la limpieza de las instantáneas del 17-nov", "Jeison Vásquez"],
    ["Plan para Python 3.12", "Pierde soporte en abril de 2027", "Walter Sanjur"],
    ["Revisiones semanales de supervisión y parches", "La etapa 8 es continua; la última medición de parches es la del 17-nov", "Anyurie Sánchez y Walter Sanjur"],
  ], [3400, 4060, 1900]),
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
