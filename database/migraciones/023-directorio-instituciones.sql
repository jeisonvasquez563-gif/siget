-- ============================================================================
-- Migracion 023: directorio de instituciones (instituciones panamenas y sus tramites en el catalogo)
-- ============================================================================
-- Se ejecuta como siget_owner (duenio de los objetos), en UNA transaccion, DESPUES de la 021 (usa tipo_tramite.requisitos).
-- Es solo datos: el motor es generico, agregar una institucion o un tramite es insertar filas, no escribir codigo.
--
-- AVISO SOBRE EL CONTENIDO: los nombres de las instituciones y de los tramites son reales y publicos, pero lo que dicen las fichas
-- (descripcion, documentos, que pasa despues), los formularios y los plazos son ILUSTRATIVOS: requisitos y plazos genericos y razonables,
-- NO la normativa vigente ni un compromiso de la institucion. Los plazos (sla_dias, en dias habiles) son parametros de diseno, no plazos
-- legales. Cada institucion debe validar el contenido de sus tramites con su coordinacion (que lo ajusta desde «Catalogo de la
-- institucion») antes de darlo por oficial.
--
-- * MINSA, MOP y MiAmbiente pasan a tipo 'real': desaparece la etiqueta «Demostracion» de «Iniciar un tramite». El valor 'demostracion'
--   SE CONSERVA en el CHECK de institucion.tipo: el codigo (modelo, alta de instituciones) y las pruebas anteriores de la base y de la API
--   (013, 018, 020, 021 y verificar_*) crean instituciones de ese tipo como datos de prueba, y quitarlo rompe esas pruebas sin ganar nada
--   (el CHECK solo dice que valores se admiten, no que existan). Ninguna institucion del catalogo real queda con ese tipo: lo comprueba
--   database/pruebas-directorio.sql.
-- * Los tres «Tramite de demostracion (X)» se DESACTIVAN (activo = false), no se renombran ni se borran: los tramites que ya existen de
--   esos tipos guardan su copia del formulario y siguen su curso (disparador de la 020); lo nuevo ya no se admite (tramite_valida_tipo_activo)
--   y el catalogo publico no los muestra. Efecto visible: suben a la version siguiente y catalogo_cambio guarda «desactivado» con actor
--   nulo (queda como evidencia). En su lugar, MINSA, MOP y MiAmbiente reciben un tramite real para la ciudadania.
-- * Seis instituciones nuevas con 1 o 2 tramites para la ciudadania, y cada una con su «Solicitud interinstitucional de informacion»
--   (audiencia 'institucion', como la 012 y con el mismo formulario y requisitos de la 017 y la 021).
-- * Ningun formulario pide cedula, nombre ni correo (ya estan en el perfil: minimizacion de datos, Ley 81). En Panama el numero de licencia de
--   conducir es el de la cedula: por eso la renovacion y el duplicado de la ATTT no lo piden (la ATTT lo obtiene del perfil). Formularios y requisitos
--   cumplen lo que valida la base (formulario_invalido de la 020 y requisitos_invalido de la 021: el disparador tipo_tramite_valida los
--   revisa al insertar) y la API (apps.tramites.formulario y apps.catalogo.gestion; lo verifica una prueba unitaria sobre este archivo).
-- * El tramite del MOP lleva `asunto` y `descripcion` como primeros campos (igual que el tramite de demostracion que reemplaza): las
--   verificaciones y el ensayo de la plataforma crean tramites del MOP con esos dos datos. Los demas campos de ese formulario son opcionales.
-- * Es idempotente: se puede repetir sin duplicar (ON CONFLICT y UPDATE con la misma condicion).
-- ============================================================================
BEGIN;
SET LOCAL ROLE siget_owner;

-- ---------------------------------------------------------------------------
-- 1. MINSA, MOP y MiAmbiente dejan de ser de demostracion
-- ---------------------------------------------------------------------------
UPDATE siget.institucion SET tipo = 'real' WHERE nombre IN ('MINSA', 'MOP', 'MiAmbiente') AND tipo <> 'real';

-- ---------------------------------------------------------------------------
-- 2. Los «Tramite de demostracion» se desactivan (no se renombran ni se borran)
-- ---------------------------------------------------------------------------
UPDATE siget.tipo_tramite SET activo = false
 WHERE nombre IN ('Trámite de demostración (MINSA)', 'Trámite de demostración (MOP)', 'Trámite de demostración (MiAmbiente)')
   AND institucion_id IN (SELECT id FROM siget.institucion WHERE nombre IN ('MINSA', 'MOP', 'MiAmbiente'))
   AND activo;

-- ---------------------------------------------------------------------------
-- 3. Instituciones nuevas
-- ---------------------------------------------------------------------------
INSERT INTO siget.institucion (nombre, tipo) VALUES
  ('Registro Público de Panamá',                            'real'),
  ('Ministerio de Comercio e Industrias (Panamá Emprende)', 'real'),
  ('ATTT',                                                  'real'),
  ('MEDUCA',                                                'real'),
  ('IDAAN',                                                 'real'),
  ('Municipio de San Miguelito',                            'real')
ON CONFLICT (nombre) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4. Tramites para la ciudadania (nuevos y los que reemplazan a los de demostracion)
-- ---------------------------------------------------------------------------
INSERT INTO siget.tipo_tramite (institucion_id, nombre, sla_dias, audiencia, formulario, requisitos)
SELECT i.id, t.nombre, t.sla_dias, 'ciudadania', t.formulario::jsonb, t.requisitos::jsonb
FROM (VALUES

  -- MINSA ------------------------------------------------------------------
  ('MINSA', 'Permiso sanitario de operación', 15, $f$[
    {"id": "nombre_establecimiento", "etiqueta": "Nombre del establecimiento", "tipo": "texto", "obligatorio": true, "max": 150},
    {"id": "tipo_establecimiento", "etiqueta": "Tipo de establecimiento", "tipo": "seleccion", "obligatorio": true, "opciones": ["Restaurante o fonda", "Tienda o supermercado", "Fábrica o depósito de alimentos", "Salón de belleza o spa", "Otro"]},
    {"id": "direccion_establecimiento", "etiqueta": "Dirección del establecimiento", "tipo": "texto", "obligatorio": true, "max": 200},
    {"id": "provincia", "etiqueta": "Provincia", "tipo": "seleccion", "obligatorio": true, "opciones": ["Bocas del Toro", "Chiriquí", "Coclé", "Colón", "Darién", "Herrera", "Los Santos", "Panamá", "Panamá Oeste", "Veraguas"]},
    {"id": "numero_empleados", "etiqueta": "Número de empleados", "tipo": "numero", "obligatorio": true, "max": 10000, "entero": true},
    {"id": "descripcion_actividad", "etiqueta": "Descripción de la actividad", "tipo": "texto_largo", "obligatorio": false, "max": 1000}
  ]$f$, $r${
    "descripcion": "Autorización del Ministerio de Salud para que un establecimiento opere cumpliendo las condiciones sanitarias de su actividad. El establecimiento no debe abrir al público antes de contar con el permiso.",
    "documentos": [
      "Copia de la cédula de quien presenta la solicitud (o del representante legal)",
      "Aviso de operación o documento que acredite la actividad comercial",
      "Comprobante de la dirección del establecimiento (recibo de un servicio público o contrato de alquiler)",
      "Croquis o plano sencillo del local",
      "Carné de salud del personal que manipula alimentos, si aplica"
    ],
    "despues": "El personal del MINSA revisa la solicitud y puede programar una inspección del establecimiento. Si falta algo o hay algo por corregir, te pedirá una subsanación y verás el motivo aquí. Cuando se resuelva recibirás un aviso en la plataforma."
  }$r$),

  -- MOP --------------------------------------------------------------------
  ('MOP', 'Permiso de uso de servidumbre vial', 15, $f$[
    {"id": "asunto", "etiqueta": "Asunto de la solicitud", "tipo": "texto", "obligatorio": true, "max": 150, "ayuda": "Resume en una frase para qué necesitas usar la servidumbre vial."},
    {"id": "descripcion", "etiqueta": "Descripción", "tipo": "texto_largo", "obligatorio": false, "max": 2000},
    {"id": "ubicacion", "etiqueta": "Ubicación de la vía o del tramo", "tipo": "texto", "obligatorio": false, "max": 200},
    {"id": "tipo_uso", "etiqueta": "Tipo de uso", "tipo": "seleccion", "obligatorio": false, "opciones": ["Tendido de cables o tuberías", "Acceso vehicular a un predio", "Cierre o interrupción temporal de la vía", "Otro"]},
    {"id": "duracion_dias", "etiqueta": "Duración estimada (días)", "tipo": "numero", "obligatorio": false, "max": 365, "entero": true}
  ]$f$, $r${
    "descripcion": "Autorización del Ministerio de Obras Públicas para usar de forma temporal o permanente la servidumbre de una vía (por ejemplo, para un tendido, un acceso a un predio o la interrupción de una vía). No se debe intervenir la vía antes de contar con el permiso.",
    "documentos": [
      "Copia de la cédula de quien presenta la solicitud (o del representante legal)",
      "Croquis o plano de la zona y de la intervención propuesta",
      "Descripción del trabajo y del plan de señalización y seguridad vial",
      "Copia de la autorización del propietario del predio, si aplica"
    ],
    "despues": "El personal del MOP revisa la solicitud y puede inspeccionar el sitio. Si falta algo o hay algo por corregir, te pedirá una subsanación y verás el motivo aquí. Cuando se resuelva recibirás un aviso en la plataforma."
  }$r$),

  -- MiAmbiente -------------------------------------------------------------
  ('MiAmbiente', 'Evaluación de estudio de impacto ambiental categoría I', 30, $f$[
    {"id": "nombre_proyecto", "etiqueta": "Nombre del proyecto", "tipo": "texto", "obligatorio": true, "max": 150},
    {"id": "tipo_proyecto", "etiqueta": "Tipo de proyecto", "tipo": "seleccion", "obligatorio": true, "opciones": ["Construcción o urbanización", "Agropecuario", "Industrial", "Comercial o de servicios", "Otro"]},
    {"id": "ubicacion_proyecto", "etiqueta": "Ubicación del proyecto", "tipo": "texto", "obligatorio": true, "max": 200},
    {"id": "provincia", "etiqueta": "Provincia", "tipo": "seleccion", "obligatorio": true, "opciones": ["Bocas del Toro", "Chiriquí", "Coclé", "Colón", "Darién", "Herrera", "Los Santos", "Panamá", "Panamá Oeste", "Veraguas"]},
    {"id": "area_hectareas", "etiqueta": "Superficie del proyecto (hectáreas)", "tipo": "numero", "obligatorio": true, "max": 100000},
    {"id": "descripcion_proyecto", "etiqueta": "Descripción del proyecto", "tipo": "texto_largo", "obligatorio": false, "max": 2000}
  ]$f$, $r${
    "descripcion": "Presentación del estudio de impacto ambiental de un proyecto de bajo impacto (categoría I) para que el Ministerio de Ambiente lo evalúe. El proyecto no debe empezar antes de que el estudio sea aprobado.",
    "documentos": [
      "Copia de la cédula de quien presenta la solicitud (o del representante legal)",
      "Estudio de impacto ambiental elaborado por un consultor o una consultora habilitados",
      "Documento que acredite el derecho sobre el terreno (certificación del Registro Público o autorización del propietario)",
      "Plano o croquis de ubicación del proyecto",
      "Descripción del proyecto y de las medidas para reducir su impacto"
    ],
    "despues": "El personal de MiAmbiente revisa el estudio y puede pedirte aclaraciones o una inspección. Si falta algo te pedirá una subsanación y verás el motivo aquí. Cuando se resuelva recibirás un aviso en la plataforma."
  }$r$),

  -- Registro Público de Panamá ---------------------------------------------
  ('Registro Público de Panamá', 'Certificado de propiedad de un inmueble', 5, $f$[
    {"id": "tipo_inmueble", "etiqueta": "Tipo de inmueble", "tipo": "seleccion", "obligatorio": true, "opciones": ["Finca", "Propiedad horizontal"]},
    {"id": "numero_finca", "etiqueta": "Número de finca", "tipo": "texto", "obligatorio": true, "max": 40, "ayuda": "Figura en la escritura o en un certificado anterior."},
    {"id": "provincia", "etiqueta": "Provincia", "tipo": "seleccion", "obligatorio": true, "opciones": ["Bocas del Toro", "Chiriquí", "Coclé", "Colón", "Darién", "Herrera", "Los Santos", "Panamá", "Panamá Oeste", "Veraguas"]},
    {"id": "motivo", "etiqueta": "Para qué lo necesitas", "tipo": "seleccion", "obligatorio": true, "opciones": ["Trámite bancario", "Compraventa", "Trámite municipal o de construcción", "Otro"]},
    {"id": "observaciones", "etiqueta": "Observaciones", "tipo": "texto_largo", "obligatorio": false, "max": 500}
  ]$f$, $r${
    "descripcion": "Certificado que indica quién figura como titular de un inmueble inscrito y si tiene gravámenes anotados, según lo que consta en el Registro Público.",
    "documentos": [
      "Copia de la cédula de quien presenta la solicitud",
      "Copia de la escritura o de un certificado anterior del inmueble, si se tiene",
      "Poder o autorización, si el trámite lo presenta otra persona en nombre del titular"
    ],
    "despues": "El personal del Registro Público revisa que el inmueble esté identificado y prepara el certificado. Si falta algún dato te pedirá una subsanación y verás el motivo aquí. Cuando esté listo recibirás un aviso en la plataforma."
  }$r$),
  ('Registro Público de Panamá', 'Certificado de existencia de una sociedad', 5, $f$[
    {"id": "nombre_sociedad", "etiqueta": "Nombre de la sociedad", "tipo": "texto", "obligatorio": true, "max": 150},
    {"id": "numero_ficha", "etiqueta": "Número de ficha o folio de la sociedad", "tipo": "texto", "obligatorio": false, "max": 40, "ayuda": "Si no lo conoces, déjalo en blanco."},
    {"id": "motivo", "etiqueta": "Para qué lo necesitas", "tipo": "seleccion", "obligatorio": true, "opciones": ["Trámite bancario", "Licitación o contratación pública", "Trámite ante otra institución", "Otro"]},
    {"id": "observaciones", "etiqueta": "Observaciones", "tipo": "texto_largo", "obligatorio": false, "max": 500}
  ]$f$, $r${
    "descripcion": "Certificado que indica si una sociedad está inscrita y vigente, y quiénes figuran como sus directores y representantes, según lo que consta en el Registro Público.",
    "documentos": [
      "Copia de la cédula de quien presenta la solicitud",
      "Poder o autorización, si el trámite lo presenta otra persona en nombre de la sociedad"
    ],
    "despues": "El personal del Registro Público busca la sociedad y prepara el certificado. Si no la encuentra o falta un dato te pedirá una subsanación y verás el motivo aquí. Cuando esté listo recibirás un aviso en la plataforma."
  }$r$),

  -- Ministerio de Comercio e Industrias (Panamá Emprende) -------------------
  ('Ministerio de Comercio e Industrias (Panamá Emprende)', 'Aviso de operación', 3, $f$[
    {"id": "nombre_comercial", "etiqueta": "Nombre comercial", "tipo": "texto", "obligatorio": true, "max": 150},
    {"id": "tipo_persona", "etiqueta": "Tipo de persona que opera el negocio", "tipo": "seleccion", "obligatorio": true, "opciones": ["Persona natural", "Persona jurídica"]},
    {"id": "actividad_principal", "etiqueta": "Actividad principal", "tipo": "texto", "obligatorio": true, "max": 200},
    {"id": "direccion_establecimiento", "etiqueta": "Dirección del establecimiento", "tipo": "texto", "obligatorio": true, "max": 200},
    {"id": "provincia", "etiqueta": "Provincia", "tipo": "seleccion", "obligatorio": true, "opciones": ["Bocas del Toro", "Chiriquí", "Coclé", "Colón", "Darién", "Herrera", "Los Santos", "Panamá", "Panamá Oeste", "Veraguas"]},
    {"id": "capital_inicial", "etiqueta": "Capital inicial (B/.)", "tipo": "numero", "obligatorio": false, "max": 100000000},
    {"id": "numero_empleados", "etiqueta": "Número de empleados", "tipo": "numero", "obligatorio": false, "max": 10000, "entero": true}
  ]$f$, $r${
    "descripcion": "Declaración con la que una persona natural o jurídica informa que va a operar un negocio o actividad comercial, para que quede registrada ante el Ministerio de Comercio e Industrias.",
    "documentos": [
      "Copia de la cédula de la persona que declara (o del representante legal)",
      "Certificado de existencia de la sociedad, si el negocio lo opera una persona jurídica",
      "Comprobante de la dirección del establecimiento (recibo de un servicio público o contrato de alquiler)"
    ],
    "despues": "El personal revisa los datos de la declaración. Si falta algo te pedirá una subsanación y verás el motivo aquí. Cuando se registre recibirás un aviso en la plataforma."
  }$r$),
  ('Ministerio de Comercio e Industrias (Panamá Emprende)', 'Modificación o cese de un aviso de operación', 3, $f$[
    {"id": "numero_aviso", "etiqueta": "Número del aviso de operación", "tipo": "texto", "obligatorio": true, "max": 40},
    {"id": "tipo_cambio", "etiqueta": "Qué quieres hacer", "tipo": "seleccion", "obligatorio": true, "opciones": ["Cambio de actividad", "Cambio de dirección", "Cese de operaciones"]},
    {"id": "descripcion_cambio", "etiqueta": "Descripción del cambio", "tipo": "texto_largo", "obligatorio": true, "max": 1000}
  ]$f$, $r${
    "descripcion": "Solicitud para actualizar los datos de un aviso de operación ya registrado (actividad o dirección) o para informar que el negocio cesa sus operaciones.",
    "documentos": [
      "Copia de la cédula de la persona que declara (o del representante legal)",
      "Copia del aviso de operación que se modifica o se da de baja",
      "Comprobante de la nueva dirección, si cambia de dirección"
    ],
    "despues": "El personal revisa la solicitud y actualiza el aviso. Si falta algo te pedirá una subsanación y verás el motivo aquí. Cuando se registre el cambio recibirás un aviso en la plataforma."
  }$r$),

  -- ATTT ---------------------------------------------------------------------
  ('ATTT', 'Renovación de licencia de conducir', 10, $f$[
    {"id": "tipo_licencia", "etiqueta": "Tipo de licencia", "tipo": "seleccion", "obligatorio": true, "opciones": ["Particular", "Profesional", "Motocicleta"]},
    {"id": "situacion", "etiqueta": "Situación de la licencia", "tipo": "seleccion", "obligatorio": true, "opciones": ["Vigente (próxima a vencer)", "Vencida"]},
    {"id": "provincia_atencion", "etiqueta": "Provincia donde quieres retirarla", "tipo": "seleccion", "obligatorio": true, "opciones": ["Bocas del Toro", "Chiriquí", "Coclé", "Colón", "Darién", "Herrera", "Los Santos", "Panamá", "Panamá Oeste", "Veraguas"]}
  ]$f$, $r${
    "descripcion": "Renovación de una licencia de conducir próxima a vencer o ya vencida, para seguir conduciendo con la licencia al día.",
    "documentos": [
      "Copia de la cédula de quien solicita la renovación",
      "Copia de la licencia actual",
      "Certificado médico vigente y prueba de tipo de sangre, si aplica",
      "Comprobante de pago de la tasa de renovación"
    ],
    "despues": "El personal de la ATTT revisa que los documentos estén completos y que no haya impedimentos en el expediente. Si falta algo te pedirá una subsanación y verás el motivo aquí. Cuando se apruebe recibirás un aviso con las indicaciones para retirar la licencia."
  }$r$),
  ('ATTT', 'Duplicado de licencia de conducir', 5, $f$[
    {"id": "motivo_duplicado", "etiqueta": "Motivo", "tipo": "seleccion", "obligatorio": true, "opciones": ["Pérdida", "Robo", "Deterioro"]},
    {"id": "fecha_hechos", "etiqueta": "Fecha de la pérdida o del robo", "tipo": "fecha", "obligatorio": false, "ayuda": "No puede ser una fecha futura."},
    {"id": "observaciones", "etiqueta": "Observaciones", "tipo": "texto_largo", "obligatorio": false, "max": 500}
  ]$f$, $r${
    "descripcion": "Emisión de una nueva copia de la licencia de conducir cuando se perdió, la robaron o se deterioró.",
    "documentos": [
      "Copia de la cédula de quien solicita el duplicado",
      "Denuncia o constancia de la pérdida o del robo, si aplica",
      "Licencia deteriorada, si es el caso",
      "Comprobante de pago de la tasa del duplicado"
    ],
    "despues": "El personal de la ATTT verifica la licencia en su registro y prepara el duplicado. Si falta algo te pedirá una subsanación y verás el motivo aquí. Cuando esté listo recibirás un aviso en la plataforma."
  }$r$),

  -- MEDUCA -------------------------------------------------------------------
  ('MEDUCA', 'Autenticación de diploma o créditos', 15, $f$[
    {"id": "tipo_documento", "etiqueta": "Documento que se autentica", "tipo": "seleccion", "obligatorio": true, "opciones": ["Diploma de bachiller", "Créditos o notas de educación media", "Certificado de educación premedia"]},
    {"id": "anio_graduacion", "etiqueta": "Año de graduación", "tipo": "numero", "obligatorio": true, "max": 2100, "entero": true},
    {"id": "centro_educativo", "etiqueta": "Centro educativo", "tipo": "texto", "obligatorio": true, "max": 150},
    {"id": "destino", "etiqueta": "Para qué lo necesitas", "tipo": "seleccion", "obligatorio": true, "opciones": ["Trámite en el extranjero", "Universidad o institución en Panamá", "Empleo", "Otro"]},
    {"id": "observaciones", "etiqueta": "Observaciones", "tipo": "texto_largo", "obligatorio": false, "max": 500}
  ]$f$, $r${
    "descripcion": "Verificación y autenticación por el Ministerio de Educación de un diploma o de los créditos de estudios, para presentarlos ante otra institución o en el extranjero.",
    "documentos": [
      "Copia de la cédula de quien solicita la autenticación",
      "Copia del diploma o de los créditos que se van a autenticar",
      "Comprobante de pago de la tasa de autenticación"
    ],
    "despues": "El personal del MEDUCA verifica el documento con los registros del centro educativo, lo que puede tomar varios días. Si falta algo te pedirá una subsanación y verás el motivo aquí. Cuando esté listo recibirás un aviso en la plataforma."
  }$r$),

  -- IDAAN --------------------------------------------------------------------
  ('IDAAN', 'Solicitud de conexión de agua potable', 20, $f$[
    {"id": "direccion_inmueble", "etiqueta": "Dirección del inmueble", "tipo": "texto", "obligatorio": true, "max": 200},
    {"id": "tipo_uso", "etiqueta": "Uso del servicio", "tipo": "seleccion", "obligatorio": true, "opciones": ["Residencial", "Comercial", "Otro"]},
    {"id": "numero_finca", "etiqueta": "Número de finca", "tipo": "texto", "obligatorio": false, "max": 40},
    {"id": "descripcion", "etiqueta": "Información adicional", "tipo": "texto_largo", "obligatorio": false, "max": 500}
  ]$f$, $r${
    "descripcion": "Solicitud de una nueva conexión al servicio de agua potable para un inmueble que todavía no la tiene.",
    "documentos": [
      "Copia de la cédula de quien solicita la conexión",
      "Documento que acredite el derecho sobre el inmueble (certificación del Registro Público o contrato)",
      "Plano o croquis de ubicación del inmueble",
      "Autorización del propietario, si quien solicita no es el propietario"
    ],
    "despues": "El personal del IDAAN revisa la solicitud y puede hacer una inspección para verificar la factibilidad del servicio. Si falta algo te pedirá una subsanación y verás el motivo aquí. Cuando se resuelva recibirás un aviso en la plataforma."
  }$r$),
  ('IDAAN', 'Reclamo por facturación del servicio de agua', 10, $f$[
    {"id": "numero_cuenta", "etiqueta": "Número de cuenta o de cliente", "tipo": "texto", "obligatorio": true, "max": 30, "ayuda": "Figura en la factura."},
    {"id": "periodo_facturado", "etiqueta": "Período facturado", "tipo": "texto", "obligatorio": true, "max": 40, "ayuda": "Por ejemplo: octubre de 2026."},
    {"id": "motivo_reclamo", "etiqueta": "Motivo del reclamo", "tipo": "seleccion", "obligatorio": true, "opciones": ["Cobro excesivo", "Lectura incorrecta", "Cargo no reconocido", "Otro"]},
    {"id": "descripcion", "etiqueta": "Descripción del reclamo", "tipo": "texto_largo", "obligatorio": true, "max": 1000}
  ]$f$, $r${
    "descripcion": "Reclamo cuando la factura del servicio de agua no corresponde con el consumo o incluye un cargo que no se reconoce.",
    "documentos": [
      "Copia de la factura que se reclama",
      "Copia de la cédula de quien presenta el reclamo",
      "Fotografía del medidor, si el reclamo es por la lectura"
    ],
    "despues": "El personal del IDAAN revisa la factura y el historial de consumo, y puede programar una revisión del medidor. Si falta algo te pedirá una subsanación y verás el motivo aquí. Cuando se resuelva recibirás un aviso en la plataforma."
  }$r$),

  -- Municipio de San Miguelito ---------------------------------------------
  ('Municipio de San Miguelito', 'Paz y salvo municipal', 3, $f$[
    {"id": "concepto", "etiqueta": "Concepto", "tipo": "seleccion", "obligatorio": true, "opciones": ["Inmueble", "Establecimiento comercial", "Vehículo"]},
    {"id": "identificador_bien", "etiqueta": "Número de finca, de aviso de operación o placa", "tipo": "texto", "obligatorio": true, "max": 60, "ayuda": "Según el concepto elegido."},
    {"id": "motivo", "etiqueta": "Para qué lo necesitas", "tipo": "texto", "obligatorio": false, "max": 200}
  ]$f$, $r${
    "descripcion": "Constancia de que un inmueble, un establecimiento comercial o un vehículo no tiene deudas pendientes con el municipio.",
    "documentos": [
      "Copia de la cédula de quien presenta la solicitud",
      "Copia del documento del bien (escritura, aviso de operación o registro vehicular)",
      "Comprobante de pago de la tasa del paz y salvo, si aplica"
    ],
    "despues": "El personal del Municipio revisa que no haya saldos pendientes y emite el paz y salvo. Si hay deudas o falta algo te lo indicará mediante una subsanación y verás el motivo aquí. Cuando esté listo recibirás un aviso en la plataforma."
  }$r$),
  ('Municipio de San Miguelito', 'Permiso de ocupación', 15, $f$[
    {"id": "numero_finca", "etiqueta": "Número de finca", "tipo": "texto", "obligatorio": true, "max": 40},
    {"id": "direccion_obra", "etiqueta": "Dirección de la edificación", "tipo": "texto", "obligatorio": true, "max": 200},
    {"id": "tipo_edificacion", "etiqueta": "Tipo de edificación", "tipo": "seleccion", "obligatorio": true, "opciones": ["Vivienda unifamiliar", "Edificio de apartamentos", "Local comercial", "Otro"]},
    {"id": "area_m2", "etiqueta": "Área construida (m²)", "tipo": "numero", "obligatorio": true, "max": 100000},
    {"id": "descripcion", "etiqueta": "Información adicional", "tipo": "texto_largo", "obligatorio": false, "max": 1000}
  ]$f$, $r${
    "descripcion": "Autorización del municipio para ocupar o habitar una edificación terminada, que confirma que la obra se ejecutó según el permiso de construcción aprobado.",
    "documentos": [
      "Copia de la cédula de quien presenta la solicitud",
      "Copia del permiso de construcción aprobado",
      "Planos finales de la obra, firmados por un profesional idóneo",
      "Paz y salvo municipal del inmueble"
    ],
    "despues": "El personal del Municipio revisa los documentos y puede inspeccionar la edificación. Si falta algo o hay algo por corregir, te pedirá una subsanación y verás el motivo aquí. Cuando se resuelva recibirás un aviso en la plataforma."
  }$r$)

) AS t(institucion, nombre, sla_dias, formulario, requisitos)
JOIN siget.institucion i ON i.nombre = t.institucion
ON CONFLICT (institucion_id, nombre) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 5. «Solicitud interinstitucional de informacion» en cada institucion nueva (como la 012; formulario de la 017 y requisitos de la 021)
-- ---------------------------------------------------------------------------
INSERT INTO siget.tipo_tramite (institucion_id, nombre, sla_dias, audiencia, formulario, requisitos)
SELECT i.id, 'Solicitud interinstitucional de información', 5, 'institucion', $f$[
  {"id": "informacion_solicitada", "etiqueta": "Información solicitada", "tipo": "texto_largo", "obligatorio": true, "max": 3000},
  {"id": "fundamento_legal", "etiqueta": "Fundamento legal", "tipo": "texto", "obligatorio": false, "max": 300}
]$f$::jsonb, $r${
  "descripcion": "Solicitud formal de información que una institución dirige a otra, en el marco de sus funciones.",
  "documentos": [
    "Nota o resolución que respalde la solicitud, si la hay",
    "Cualquier documento que ayude a ubicar la información que se pide"
  ],
  "despues": "La institución destinataria revisa la solicitud y responde dentro del plazo. Si necesita una aclaración te la pedirá por este mismo trámite."
}$r$::jsonb
FROM siget.institucion i
WHERE i.nombre IN ('Registro Público de Panamá', 'Ministerio de Comercio e Industrias (Panamá Emprende)', 'ATTT', 'MEDUCA', 'IDAAN', 'Municipio de San Miguelito')
ON CONFLICT (institucion_id, nombre) DO NOTHING;

COMMIT;
