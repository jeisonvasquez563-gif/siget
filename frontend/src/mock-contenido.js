// Contenido del trámite en el servidor de ejemplo: los formularios del catálogo (copiados de database/migraciones/017-contenido-tramite.sql)
// y la validación esencial que hace el servidor real (apps/tramites/formulario.py): obligatorios, largos, números, fechas y listas.
// Es solo para desarrollo y pruebas: el servidor de verdad es quien decide.

export const FORMULARIO_CONSTRUCCION = [
  { id: 'direccion_terreno', etiqueta: 'Dirección del terreno', tipo: 'texto', obligatorio: true, max: 200 },
  { id: 'numero_finca', etiqueta: 'Número de finca', tipo: 'texto', obligatorio: true, max: 40, ayuda: 'Figura en la certificación del Registro Público.' },
  { id: 'tipo_obra', etiqueta: 'Tipo de obra', tipo: 'seleccion', obligatorio: true, opciones: ['Obra nueva', 'Ampliación', 'Remodelación', 'Demolición'] },
  { id: 'area_m2', etiqueta: 'Área de la obra (m²)', tipo: 'numero', obligatorio: true, max: 100000 },
  { id: 'descripcion', etiqueta: 'Descripción de la obra', tipo: 'texto_largo', obligatorio: false, max: 2000 },
]

export const FORMULARIO_DENUNCIA = [
  { id: 'asunto', etiqueta: 'Asunto', tipo: 'texto', obligatorio: true, max: 150 },
  { id: 'descripcion', etiqueta: 'Descripción de los hechos', tipo: 'texto_largo', obligatorio: true, max: 3000 },
  { id: 'lugar_hechos', etiqueta: 'Lugar de los hechos', tipo: 'texto', obligatorio: false, max: 200 },
  { id: 'fecha_hechos', etiqueta: 'Fecha de los hechos', tipo: 'fecha', obligatorio: false, ayuda: 'No puede ser una fecha futura.' },
]

export const FORMULARIO_EMPRESA = [
  { id: 'nombre_comercial', etiqueta: 'Nombre comercial', tipo: 'texto', obligatorio: true, max: 150 },
  { id: 'actividad_economica', etiqueta: 'Actividad económica', tipo: 'texto', obligatorio: true, max: 200 },
  { id: 'direccion_negocio', etiqueta: 'Dirección del negocio', tipo: 'texto', obligatorio: true, max: 200 },
  { id: 'numero_empleados', etiqueta: 'Número de empleados', tipo: 'numero', obligatorio: true, max: 10000, entero: true },
]

export const FORMULARIO_INTERINSTITUCIONAL = [
  { id: 'informacion_solicitada', etiqueta: 'Información solicitada', tipo: 'texto_largo', obligatorio: true, max: 3000 },
  { id: 'fundamento_legal', etiqueta: 'Fundamento legal', tipo: 'texto', obligatorio: false, max: 300 },
]

export const FORMULARIO_DEMOSTRACION = [
  { id: 'asunto', etiqueta: 'Asunto', tipo: 'texto', obligatorio: true, max: 150 },
  { id: 'descripcion', etiqueta: 'Descripción', tipo: 'texto_largo', obligatorio: false, max: 2000 },
]

const vacio = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '')
const FECHA = /^\d{4}-\d{2}-\d{2}$/

function validarCampo(c, valor) {
  if (c.tipo === 'texto' || c.tipo === 'texto_largo') {
    if (typeof valor !== 'string') return 'Debe ser un texto.'
    const max = c.max || (c.tipo === 'texto' ? 200 : 2000)
    const v = valor.trim()
    if (v.length > max) return `No puede superar los ${max} caracteres.`
    if (c.tipo === 'texto' && /[\r\n]/.test(v)) return 'Contiene caracteres no permitidos (ni saltos de línea).'
    return null
  }
  if (c.tipo === 'numero') {
    if (typeof valor !== 'number' || !Number.isFinite(valor)) return 'Debe ser un número.'
    const max = c.max || 1e9
    if (valor < 0 || valor > max) return `Debe estar entre 0 y ${max}.`
    if (c.entero && !Number.isInteger(valor)) return 'Debe ser un número entero.'
    return null
  }
  if (c.tipo === 'fecha') {
    if (typeof valor !== 'string' || !FECHA.test(valor.trim())) return 'Debe ser una fecha con el formato AAAA-MM-DD.'
    const [a, m, d] = valor.trim().split('-').map(Number)
    const f = new Date(Date.UTC(a, m - 1, d))
    if (a < 1900 || f.getUTCFullYear() !== a || f.getUTCMonth() !== m - 1 || f.getUTCDate() !== d) return 'No es una fecha válida.'
    if (f.getTime() > Date.now() + 86400000) return 'No puede ser una fecha futura.'
    return null
  }
  return typeof valor === 'string' && c.opciones.includes(valor.trim()) ? null : 'Elige una de las opciones de la lista.'
}

// Como el servidor: devuelve {limpios, errores}; los errores van por campo y los generales bajo `datos`
export function validarDatos(formulario, datos) {
  if (datos === null || typeof datos !== 'object' || Array.isArray(datos)) return { limpios: null, errores: { datos: 'Los datos deben ser un objeto.' } }
  const errores = {}
  const limpios = {}
  if (Object.keys(datos).some((k) => !formulario.some((c) => c.id === k))) errores.datos = 'Hay campos que este trámite no tiene.'
  for (const c of formulario) {
    const valor = datos[c.id]
    if (vacio(valor)) {
      if (c.obligatorio) errores[c.id] = 'Este campo es obligatorio.'
      continue
    }
    const error = validarCampo(c, valor)
    if (error) errores[c.id] = error
    else limpios[c.id] = typeof valor === 'string' ? valor.trim() : valor
  }
  return Object.keys(errores).length ? { limpios: null, errores } : { limpios, errores: {} }
}

// Un texto suelto (motivo o respuesta): de `minimo` a `maximo` caracteres
export function validarTextoLibre(valor, minimo, maximo) {
  if (typeof valor !== 'string') return 'Debe ser un texto.'
  const v = valor.trim()
  if (v.length < minimo) return `Debe tener al menos ${minimo} caracteres.`
  if (v.length > maximo) return `No puede superar los ${maximo} caracteres.`
  if (!/[\p{L}\p{N}]/u.test(v)) return 'Debe tener al menos una letra o un número.'
  return null
}

// Qué motivo ve la persona que pidió el trámite (el personal los ve todos): solo los de rechazar, pedir una subsanación, cerrarla
// (su propia respuesta o el cierre del personal) y desistir (son sus palabras). Los demás son comentarios internos.
export function motivoParaLaPersona(evento) {
  if (evento.accion !== 'cambio_estado') return null
  const paraElla = evento.estado_nuevo === 'Rechazado' || evento.estado_nuevo === 'En Subsanacion' || evento.estado_nuevo === 'Desistido'  // el último, sus propias palabras
  const cierre = evento.estado_anterior === 'En Subsanacion' && evento.estado_nuevo === 'En Tramitacion'
  return paraElla || cierre ? evento.motivo : null
}

// Los requisitos de los tipos de ejemplo (migración 021): qué es el trámite, qué documentos hacen falta y qué pasa después
export const REQUISITOS_CONSTRUCCION = {
  descripcion: 'Autorización de la Alcaldía para construir, ampliar, remodelar o demoler una obra dentro del municipio. La obra no debe empezar antes de que el permiso esté aprobado.',
  documentos: ['Certificación del Registro Público de la finca, vigente', 'Planos de la obra firmados por un profesional idóneo', 'Paz y salvo municipal del inmueble'],
  despues: 'Un funcionario de la Alcaldía revisa la solicitud y los planos. Si falta algo, te pedirá una subsanación y verás el motivo aquí.',
}
export const REQUISITOS_DEMOSTRACION = {
  descripcion: 'Trámite de prueba para conocer cómo funciona la plataforma. No tiene ningún efecto legal.',
  documentos: ['Un archivo de prueba (PDF, PNG o JPEG) de hasta 5 MB, si quieres probar la carga de documentos'],
  despues: 'Un funcionario de demostración lo revisa y lo resuelve. Lo que ocurra aquí no tiene consecuencias fuera de la plataforma.',
}
export const REQUISITOS_DENUNCIA = {
  descripcion: 'Presenta una solicitud, queja o denuncia para que la institución la reciba, la registre y le dé seguimiento.',
  documentos: [],
  despues: 'Tu solicitud queda registrada con un número de seguimiento y un funcionario la revisa. Puede pedirte más información.',
}
export const REQUISITOS_EMPRESA = {
  descripcion: 'Registro simplificado de un pequeño negocio ante AMPYME.',
  documentos: ['Copia de la cédula de la persona que registra el negocio', 'Comprobante de la dirección del negocio'],
  despues: '',
}
export const REQUISITOS_INTERINSTITUCIONAL = {
  descripcion: 'Solicitud formal de información que una institución dirige a otra, en el marco de sus funciones.',
  documentos: ['Nota o resolución que respalde la solicitud, si la hay'],
  despues: 'La institución destinataria revisa la solicitud y responde dentro del plazo.',
}

export const respuestaDatosInvalidos = (errores) => ({ codigo: 'datos_invalidos', detalle: 'Hay datos que corregir.', errores })
