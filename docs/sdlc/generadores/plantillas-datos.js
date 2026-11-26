// Contenido de las plantillas del SDLC seguro: se usa para generar los .md del repositorio y el .docx para repartir.
const VACIO = "[completar]";
module.exports = [
  {
    archivo: "01-registro-de-riesgos.md", etapa: "Etapa 1: Planificación", titulo: "Registro de riesgos de SIGET", responsable: "Simna De Gracia", revisa: "Jeison Vásquez",
    objetivo: "Evaluar los riesgos y el panorama de amenazas de SIGET y el impacto que tendría un incidente de seguridad.",
    instrucciones: [
      "Leé `docs/antecedentes.md` (incidentes reales en Panamá) y la sección «Riesgos» de `docs/superpowers/specs/2026-10-21-pendientes-design.md`.",
      "Las primeras 5 filas son ejemplos resueltos: usalas como modelo y no las borres.",
      "Agregá al menos 10 riesgos más (en total, 15 o más).",
      "Probabilidad e impacto: **Baja / Media / Alta**. Nivel = el mayor de los dos (si alguno es Alta, el nivel es Alto).",
      "En «Control en SIGET» poné qué lo reduce y dónde se ve (archivo, prueba o documento). Si no hay control, escribí **pendiente**.",
      "Ideas para buscar riesgos: robo de contraseñas, acceso de una institución a trámites de otra, pérdida de la base, caída de una VM, documentos con malware, un funcionario que altera un trámite, una clave filtrada, un parche que no se aplicó.",
    ],
    secciones: [
      { titulo: "Matriz de riesgos", tabla: {
        cab: ["#", "Riesgo (qué puede pasar)", "Afecta a", "Probabilidad", "Impacto", "Nivel", "Control en SIGET (dónde se ve)"],
        filas: [
          ["R1", "Alguien adivina o roba la contraseña de un funcionario", "Trámites de su institución", "Media", "Alta", "Alto", "Segundo factor obligatorio para el personal; bloqueo progresivo tras 3 fallos (`verificar_autenticacion`)"],
          ["R2", "Un funcionario del MOP intenta ver un trámite del MINSA", "Confidencialidad entre instituciones", "Media", "Alta", "Alto", "Seguridad por filas en PostgreSQL y PDP (`verificar_tramites`, «quién ve qué»)"],
          ["R3", "Se pierde la base de datos (falla del disco, error humano)", "Todos los trámites y la auditoría", "Baja", "Alta", "Alto", "Respaldo diario con restauración probada (runbook 32)"],
          ["R4", "Un ciudadano sube un ejecutable disfrazado de PDF", "Funcionarios que lo descarguen", "Media", "Media", "Medio", "Validación por contenido y descarga siempre como adjunto (PT-8)"],
          ["R5", "No se aplican los parches de seguridad del sistema", "Las dos VMs", "Alta", "Alta", "Alto", "**pendiente**: 170 y 177 avisos sin aplicar (informe de mantenimiento)"],
          ["R6", VACIO, "", "", "", "", ""], ["R7", VACIO, "", "", "", "", ""], ["R8", VACIO, "", "", "", "", ""],
          ["R9", VACIO, "", "", "", "", ""], ["R10", VACIO, "", "", "", "", ""], ["R11", VACIO, "", "", "", "", ""],
          ["R12", VACIO, "", "", "", "", ""], ["R13", VACIO, "", "", "", "", ""], ["R14", VACIO, "", "", "", "", ""], ["R15", VACIO, "", "", "", "", ""],
        ] } },
      { titulo: "Riesgos pendientes para Jeison", texto: "Copiá aquí los riesgos marcados como «pendiente», ordenados del nivel más alto al más bajo." },
    ],
  },
  {
    archivo: "02-requisitos-de-seguridad.md", etapa: "Etapa 2: Análisis de requisitos", titulo: "Requisitos de seguridad y cumplimiento", responsable: "Gabriel González", revisa: "Simna De Gracia",
    objetivo: "Incluir los requisitos de seguridad desde el principio y entender los requisitos de cumplimiento normativo.",
    instrucciones: [
      "Las filas de **Autenticación** están resueltas como ejemplo.",
      "Completá las otras áreas: autorización, protección de datos personales, auditoría, cifrado, disponibilidad y registro de cuentas (al menos 3 requisitos por área).",
      "En «Evidencia en SIGET» poné el archivo, la prueba o la sección del documento que lo demuestra. Buscá en `docs/api.md`, `docs/modulos.md`, `docs/runbook.md` y `CHANGELOG.md`.",
      "Estado: **Cumple / Parcial / No cumple**.",
      "Para la sección legal, buscá en Legispan (Asamblea Nacional) la ley panameña de protección de datos personales. **Copiá el número de ley y del artículo tal como aparecen**: no los escribas de memoria.",
    ],
    secciones: [
      { titulo: "Matriz de requisitos", tabla: {
        cab: ["ID", "Área", "Requisito", "Evidencia en SIGET", "Estado"],
        filas: [
          ["RS-01", "Autenticación", "Las contraseñas se guardan con un algoritmo resistente (nunca en texto plano)", "Argon2 (`backend/config/settings.py`, `PASSWORD_HASHERS`)", "Cumple"],
          ["RS-02", "Autenticación", "El personal y los operadores usan segundo factor", "TOTP obligatorio (`apps/autenticacion/mfa.py`, `verificar_autenticacion`)", "Cumple"],
          ["RS-03", "Autenticación", "Los intentos fallidos bloquean la cuenta de forma progresiva", "5, 15 y 60 minutos (CHANGELOG, «bloqueo progresivo»)", "Cumple"],
          ["RS-04", "Autorización", VACIO, "", ""], ["RS-05", "Autorización", VACIO, "", ""], ["RS-06", "Autorización", VACIO, "", ""],
          ["RS-07", "Datos personales", VACIO, "", ""], ["RS-08", "Datos personales", VACIO, "", ""], ["RS-09", "Datos personales", VACIO, "", ""],
          ["RS-10", "Auditoría", VACIO, "", ""], ["RS-11", "Auditoría", VACIO, "", ""], ["RS-12", "Auditoría", VACIO, "", ""],
          ["RS-13", "Cifrado", VACIO, "", ""], ["RS-14", "Cifrado", VACIO, "", ""], ["RS-15", "Cifrado", VACIO, "", ""],
          ["RS-16", "Disponibilidad", VACIO, "", ""], ["RS-17", "Disponibilidad", VACIO, "", ""], ["RS-18", "Disponibilidad", VACIO, "", ""],
          ["RS-19", "Registro de cuentas", VACIO, "", ""], ["RS-20", "Registro de cuentas", VACIO, "", ""], ["RS-21", "Registro de cuentas", VACIO, "", ""],
        ] } },
      { titulo: "Cumplimiento normativo", tabla: {
        cab: ["Norma (número exacto)", "Artículo", "Qué exige (en tus palabras)", "Cómo lo cumple SIGET", "Estado"],
        filas: [
          ["Ley 83 de 2012 (gobierno electrónico)", "Art. 4, num. 8", "Que la persona sepa en qué fase está su trámite y qué unidad lo atiende", "Seguimiento del trámite y su historial (`docs/api.md`, «Trámites»)", "Cumple"],
          [VACIO, "", "", "", ""], [VACIO, "", "", "", ""], [VACIO, "", "", "", ""],
        ] } },
    ],
  },
  {
    archivo: "03-modelo-de-amenazas.md", etapa: "Etapa 3: Diseño", titulo: "Modelo de amenazas STRIDE", responsable: "Joel Medina", revisa: "Andy Martínez",
    objetivo: "Elaborar el modelo de amenazas e incluir la seguridad como parte integral de la arquitectura.",
    instrucciones: [
      "STRIDE son seis tipos de amenaza. Para cada pieza de SIGET preguntate si puede pasar cada una:",
      "**S**uplantación (alguien se hace pasar por otro) · **T**ampering, alteración (alguien modifica datos) · **R**epudio (alguien niega haber hecho algo) · **I**nformación divulgada (alguien ve lo que no debe) · **D**enegación de servicio (alguien tumba el sistema) · **E**levación de privilegios (alguien obtiene más permisos de los que tiene).",
      "La tabla del **backend** está resuelta como ejemplo.",
      "Completá las demás piezas: navegador e interfaz, nginx, base de datos, temporizador de escalamiento y archivos de documentos.",
      "Leé `docs/superpowers/specs/2026-10-08-arquitectura-zero-trust-design.md` para encontrar los controles.",
      "Si una amenaza no tiene control, escribí **abierta**. Las que no tengas claras, revisalas con Andy.",
    ],
    secciones: [
      { titulo: "Componentes de SIGET", texto: "Navegador (interfaz React) → nginx (TLS 1.3, VM1) → backend Django (VM1) → PostgreSQL (VM2). Además: temporizador de escalamiento (VM1) y volumen de documentos cifrados (VM1)." },
      { titulo: "Ejemplo resuelto: backend Django", tabla: {
        cab: ["STRIDE", "Amenaza", "Control en SIGET", "Estado"],
        filas: [
          ["S", "Alguien usa un token robado de otra persona", "Token de acceso de 10 minutos, sesiones revocables, segundo factor reciente para acciones sensibles", "Mitigada"],
          ["T", "Alguien cambia el estado de un trámite saltándose las reglas", "La base valida las transiciones con un trigger; el PDP decide antes", "Mitigada"],
          ["R", "Un funcionario niega haber aprobado un trámite", "Auditoría inalterable (`evento_auditoria`, sin UPDATE ni DELETE)", "Mitigada"],
          ["I", "Un error muestra datos de otra institución", "Seguridad por filas en la base además del PDP: dos barreras independientes", "Mitigada"],
          ["D", "Una ráfaga de peticiones satura el inicio de sesión", "Límites de tasa en nginx y en Django", "Mitigada"],
          ["E", "Un ciudadano intenta actuar como funcionario", "El PDP niega por defecto; ningún rol puede todo (matriz de permisos)", "Mitigada"],
        ] } },
      ...["Navegador e interfaz", "nginx", "Base de datos PostgreSQL", "Temporizador de escalamiento", "Archivos de documentos"].map((c) => ({
        titulo: c, tabla: { cab: ["STRIDE", "Amenaza", "Control en SIGET", "Estado"], filas: ["S", "T", "R", "I", "D", "E"].map((x) => [x, VACIO, "", ""]) } })),
    ],
  },
  {
    archivo: "04-codificacion-segura.md", etapa: "Etapa 4: Desarrollo", titulo: "Guía de codificación segura de SIGET", responsable: "Andy Martínez", revisa: "Jeison Vásquez",
    objetivo: "Capacitar en prácticas de codificación segura, incorporar herramientas de prueba de seguridad al desarrollo y evaluar las dependencias.",
    instrucciones: [
      "Escribí entre 10 y 15 reglas, cada una con un ejemplo real de SIGET (el archivo donde se aplica). La primera está resuelta.",
      "Explicá cómo leer un fallo de `security-scan.yml` y cuándo un `# nosec` o un `nosemgrep` está justificado (siempre con el motivo escrito al lado).",
      "Prepará la charla de 20 minutos con esta guía.",
    ],
    secciones: [
      { titulo: "Reglas", tabla: {
        cab: ["#", "Regla", "Ejemplo en SIGET"],
        filas: [
          ["1", "Las consultas SQL siempre con parámetros, nunca armando el texto con datos del usuario", "`cursor.execute(sql, [valores])` en `apps/identidad/equipo.py`"],
          ["2", VACIO, ""], ["3", VACIO, ""], ["4", VACIO, ""], ["5", VACIO, ""], ["6", VACIO, ""], ["7", VACIO, ""], ["8", VACIO, ""], ["9", VACIO, ""], ["10", VACIO, ""],
        ] } },
      { titulo: "Herramientas del CI de seguridad", tabla: {
        cab: ["Herramienta", "Qué revisa", "Qué hacer si falla"],
        filas: [["Bandit", "Código Python del backend", VACIO], ["Semgrep", "Todo el código (OWASP Top 10)", VACIO], ["pip-audit", "Dependencias de Python", VACIO], ["npm audit", "Dependencias del frontend", VACIO], ["Gitleaks", "Secretos en el historial", VACIO]] } },
    ],
  },
  {
    archivo: "05-inventario-de-controles.md", etapa: "Etapa 5: Documentación", titulo: "Inventario de controles de seguridad", responsable: "Jorge Medina", revisa: "Gabriel González",
    objetivo: "Documentar los procesos y controles de seguridad y reunir la información para auditorías y revisiones.",
    instrucciones: [
      "La primera fila está resuelta. Agregá un control por fila (al menos 15).",
      "Ideas: segundo factor, bloqueo progresivo, seguridad por filas, PDP, auditoría inalterable, control dual, cifrado de documentos, TLS 1.3, cabeceras de seguridad, respaldos, límites de tasa, invitaciones de registro, escalamiento automático, CI de seguridad.",
      "«Cómo se verifica» = la prueba o el comando que demuestra que funciona. Si no tiene documento, escribí **falta documentar**.",
      "Revisá también `SECURITY.md` en la raíz del repositorio: completá los datos de contacto.",
    ],
    secciones: [
      { titulo: "Controles", tabla: {
        cab: ["Control", "Qué protege", "Dónde está documentado", "Cómo se verifica", "Responsable"],
        filas: [
          ["Auditoría inalterable", "Que nadie borre ni cambie lo que pasó con un trámite", "`docs/api.md` (Historial); migración en `database/`", "`verificar_integracion` (UPDATE y DELETE fallan)", "Jeison Vásquez"],
          ...Array.from({ length: 14 }, () => [VACIO, "", "", "", ""]),
        ] } },
    ],
  },
  {
    archivo: "06-plan-de-pruebas.md", etapa: "Etapa 6: Pruebas", titulo: "Plan de pruebas de seguridad y revisión de código", responsable: "Bradley Morales", revisa: "Joel Medina",
    objetivo: "Implementar procesos de revisión de código y realizar pruebas estáticas y dinámicas de seguridad.",
    instrucciones: [
      "La tabla de pruebas ya lista lo que existe: corré las dos primeras en tu computadora y pegá la captura del resultado.",
      "Backend: en la carpeta `backend/`, crear un entorno con `python -m venv .venv`, instalar `pip install -r requirements-dev.txt` y correr `python -m pytest -q`.",
      "Frontend: en la carpeta `frontend/`, `npm ci` y después `npm test`.",
      "Completá la lista de revisión de código y usala en al menos 2 PR abiertos (dejá los comentarios en GitHub).",
    ],
    secciones: [
      { titulo: "Pruebas existentes", tabla: {
        cab: ["Prueba", "Qué cubre", "Dónde corre", "Resultado (fecha y captura)"],
        filas: [
          ["Backend (pytest)", "PDP, autenticación, plazos, documentos, registro", "Tu computadora y CI", VACIO],
          ["Frontend (Vitest)", "Pantallas por rol, accesibilidad, seguridad del código", "Tu computadora y CI", VACIO],
          ["`verificar_*`", "Contra la base real: seguridad por filas, permisos, auditoría", "VM1 (Jeison)", "77/77, 91/91, 84/84 (12-nov-2026)"],
          ["Ensayo de la demostración", "Recorrido completo contra producción", "Jeison", "101/101 (12-nov-2026)"],
          ["CI de seguridad", "Bandit, Semgrep, pip-audit, npm audit, Gitleaks", "GitHub Actions", VACIO],
          ["Análisis dinámico", "OWASP ZAP, Nmap, pruebas manuales", "Informe de noviembre", "0 alertas altas, medias ni bajas"],
        ] } },
      { titulo: "Lista de revisión de código (completar)", tabla: {
        cab: ["#", "Qué revisar en cada PR", "Por qué"],
        filas: [
          ["1", "¿Toda ruta nueva pasa por el PDP y exige permisos?", "Denegar por defecto: una ruta sin control queda abierta"],
          ["2", VACIO, ""], ["3", VACIO, ""], ["4", VACIO, ""], ["5", VACIO, ""], ["6", VACIO, ""], ["7", VACIO, ""], ["8", VACIO, ""],
        ] } },
      { titulo: "PR revisados", tabla: { cab: ["PR", "Fecha", "Comentarios hechos"], filas: [[VACIO, "", ""], [VACIO, "", ""]] } },
    ],
  },
  {
    archivo: "07-revision-del-entorno.md", etapa: "Etapa 7: Implementación", titulo: "Revisión de la seguridad del entorno de despliegue", responsable: "Jeison Vásquez", revisa: "Andy Martínez",
    objetivo: "Evaluar la seguridad del entorno de despliegue y revisar las configuraciones de seguridad.",
    instrucciones: [
      "Todas las comprobaciones son de solo lectura. Anotá el resultado y la fecha de cada una.",
      "Si algo no da lo esperado, abrí un hallazgo y no cambies nada sin respaldo y ventana acordada.",
    ],
    secciones: [
      { titulo: "Comprobaciones", tabla: {
        cab: ["Comprobación", "Comando", "Esperado", "VM1", "VM2"],
        filas: [
          ["SELinux", "`getenforce`", "Enforcing", VACIO, VACIO],
          ["Cortafuegos", "`sudo firewall-cmd --list-all`", "Solo los puertos necesarios", VACIO, VACIO],
          ["SSH sin contraseña", "`sudo sshd -T | grep passwordauthentication`", "no", VACIO, VACIO],
          ["Puertos abiertos", "`sudo ss -tlnp`", "Solo los servicios de SIGET", VACIO, VACIO],
          ["Versión del sistema", "`cat /etc/rocky-release`", "La última versión menor (9.8)", VACIO, VACIO],
          ["Avisos críticos", "`sudo dnf updateinfo list --security`", "Ninguno crítico", VACIO, VACIO],
          ["TLS y cabeceras", "`nmap --script ssl-enum-ciphers,http-security-headers -p 8443`", "TLS 1.3, calificación A, HSTS y CSP", VACIO, "—"],
          ["Contenedores sin root", "`podman exec siget-backend id -u`", "1001", VACIO, "—"],
        ] } },
      { titulo: "Registro de la actualización a Rocky 9.8", texto: "Fecha, respaldo previo, resultado de `dnf update`, reinicio, verificaciones (`verificar_*`) y ensayo después de actualizar." },
    ],
  },
  {
    archivo: "08-bitacora-supervision.md", etapa: "Etapa 8: Mantenimiento (supervisión)", titulo: "Bitácora semanal de supervisión de seguridad", responsable: "Anyurie Sánchez", revisa: "Walter Sanjur",
    objetivo: "Supervisar el sistema para detectar amenazas y estar preparados para responder a una intrusión.",
    instrucciones: [
      "Una vez por semana, entrá a la consola de auditoría con la cuenta de auditoría que te da Jeison (solo lectura).",
      "Revisá los eventos de seguridad: inicios de sesión fallidos, cuentas bloqueadas, accesos denegados, `documento_alterado` y escalamientos.",
      "Anotá una fila por semana. La primera es un ejemplo.",
      "Si ves algo raro (muchos fallos desde una misma IP, un acceso denegado repetido, un documento alterado), avisá a Jeison el mismo día.",
    ],
    secciones: [
      { titulo: "Bitácora", tabla: {
        cab: ["Semana", "Fallos de inicio de sesión", "Cuentas bloqueadas", "Accesos denegados", "Algo raro", "Aviso a"],
        filas: [["Ejemplo: 16-nov-2026", "12", "1", "4", "Ninguno: los fallos son de cuentas de prueba", "—"], [VACIO, "", "", "", "", ""], [VACIO, "", "", "", "", ""], [VACIO, "", "", "", "", ""]] } },
      { titulo: "Procedimiento ante una intrusión (escribir con Walter)", tabla: {
        cab: ["Paso", "Qué hacer", "Quién"],
        filas: [["1", "No borrar nada ni reiniciar: la evidencia se pierde", "Quien lo detecta"], ["2", "Avisar a Jeison de inmediato", "Quien lo detecta"], ["3", VACIO, ""], ["4", VACIO, ""], ["5", VACIO, ""]] } },
    ],
  },
  {
    archivo: "08-bitacora-parches.md", etapa: "Etapa 8: Mantenimiento (parches y dependencias)", titulo: "Bitácora de parches y calendario de fin de soporte", responsable: "Walter Sanjur", revisa: "Jeison Vásquez",
    objetivo: "Eliminar los puntos vulnerables que se descubran y mantener el sistema actualizado.",
    instrucciones: [
      "Cada lunes revisá en GitHub los PR de Dependabot y el resultado del CI de seguridad.",
      "Pedile a Jeison la salida de `sudo dnf updateinfo summary` de las dos VMs y anotá los números.",
      "Regla: ningún aviso **crítico** puede quedar más de 7 días sin aplicar.",
      "Revisá el calendario de fin de soporte y avisá con un mes de anticipación.",
    ],
    secciones: [
      { titulo: "Bitácora semanal", tabla: {
        cab: ["Semana", "Avisos críticos VM1 / VM2", "Importantes VM1 / VM2", "PR de Dependabot", "CI de seguridad", "Acción"],
        filas: [["Línea base: 12-nov-2026", "2 / 2", "93 / 96", "—", "—", "Plan de actualización a 9.8"], [VACIO, "", "", "", "", ""], [VACIO, "", "", "", "", ""], [VACIO, "", "", "", "", ""]] } },
      { titulo: "Calendario de fin de soporte (del informe de mantenimiento)", tabla: {
        cab: ["Componente", "Fin de soporte", "Avisar el", "Estado"],
        filas: [
          ["Python 3.12 (Application Stream de RHEL 9)", "Abril de 2027", "Marzo de 2027", "Pendiente"],
          ["Rocky Linux 9: soporte activo", "31-may-2027", "Abril de 2027", "Pendiente"],
          ["Django 5.2", "Abril de 2028", "Marzo de 2028", "Pendiente"],
          ["nginx 1.26", "Mayo de 2028", "Abril de 2028", "Pendiente"],
          ["PostgreSQL 16", "9-nov-2028", "Octubre de 2028", "Pendiente"],
          ["Rocky Linux 9: soporte de seguridad", "31-may-2032", "Migrar antes", "Pendiente"],
        ] } },
    ],
  },
];
