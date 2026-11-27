// Reglas del editor del catálogo de la institución (migración 020). Son solo una ayuda para no viajar al servidor con errores evidentes:
// el servidor (apps/catalogo/gestion.py) y la base las vuelven a validar, y sus mensajes por campo son los que mandan.

export const TIPOS_CAMPO = [
  ['texto', 'Texto corto'], ['texto_largo', 'Texto largo'], ['numero', 'Número'], ['fecha', 'Fecha'], ['seleccion', 'Selección de una lista'],
]
export const AUDIENCIAS = [
  ['ciudadania', 'Ciudadanía'], ['institucion', 'Otras instituciones'], ['ambas', 'Ciudadanía y otras instituciones'],
]
export const NOMBRE_AUDIENCIA = Object.fromEntries(AUDIENCIAS)
export const NOMBRE_TIPO_CAMPO = Object.fromEntries(TIPOS_CAMPO)

export const NOMBRE_MIN = 3
export const NOMBRE_MAX = 150
export const SLA_MIN = 1
export const SLA_MAX = 365
export const MAX_CAMPOS = 30
export const ETIQUETA_MAX = 120
export const OPCIONES_MAX = 30
export const AYUDA_MAX = 300
// Requisitos antes de iniciar (migración 021): qué es el trámite, qué documentos hacen falta y qué pasa después
export const DESCRIPCION_MAX = 1000
export const DESPUES_MAX = 1000
export const DOCUMENTOS_MAX = 15
export const DOCUMENTO_MAX = 200
export const ID_VALIDO = /^[a-z][a-z0-9_]{0,39}$/

// Largo (o valor) máximo con el que arranca cada tipo de campo al elegirlo
export const MAX_POR_DEFECTO = { texto: '200', texto_largo: '2000', numero: '100000' }
export const usaMaximo = (tipo) => tipo in MAX_POR_DEFECTO

/* ---------------------------------------------------------------- el id de un campo, generado de su etiqueta */

// «Número de finca» -> «numero_de_finca». Sin tildes, en minúsculas, con guion bajo; empieza con letra; hasta 40 caracteres; sin repetir.
export function idDesde(etiqueta, usados = []) {
  let base = String(etiqueta ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  if (!base) base = 'campo'
  if (!/^[a-z]/.test(base)) base = `campo_${base}`
  base = base.slice(0, 40).replace(/_+$/, '') || 'campo'
  let id = base
  for (let n = 2; usados.includes(id); n++) {
    const sufijo = `_${n}`
    id = `${base.slice(0, 40 - sufijo.length).replace(/_+$/, '')}${sufijo}`
  }
  return id
}

/* ---------------------------------------------------------------- del servidor al editor y de vuelta */

// Un campo del editor: todo lo que se escribe es texto (un input siempre da texto). `clave` es solo la identidad de la tarjeta al reordenar.
let siguienteClave = 1
export const nuevaClave = () => siguienteClave++

export function campoVacio(usados = []) {
  return { clave: nuevaClave(), etiqueta: '', id: idDesde('', usados), idManual: false, tipo: 'texto', obligatorio: false, max: MAX_POR_DEFECTO.texto, entero: false, opciones: '', ayuda: '' }
}

export function campoDesdeServidor(c) {
  return {
    clave: nuevaClave(), etiqueta: c.etiqueta ?? '', id: c.id ?? '', idManual: true, tipo: c.tipo, obligatorio: Boolean(c.obligatorio),
    max: c.max === undefined || c.max === null ? '' : String(c.max), entero: Boolean(c.entero), opciones: Array.isArray(c.opciones) ? c.opciones.join('\n') : '', ayuda: c.ayuda ?? '',
  }
}

export const lineasDe = (texto) => String(texto ?? '').split('\n').map((l) => l.trim()).filter(Boolean)

// El campo tal como lo espera la API (solo lo que aplica a su tipo)
export function campoAServidor(c) {
  const salida = { id: c.id.trim(), etiqueta: c.etiqueta.trim(), tipo: c.tipo, obligatorio: c.obligatorio }
  if (usaMaximo(c.tipo)) salida.max = c.max.trim() === '' ? null : Number(c.max)
  if (c.tipo === 'seleccion') salida.opciones = lineasDe(c.opciones)
  if (c.ayuda.trim()) salida.ayuda = c.ayuda.trim()
  if (c.tipo === 'numero' && c.entero) salida.entero = true
  return salida
}

export const borradorVacio = () => ({ nombre: '', sla_dias: '10', audiencia: 'ciudadania', campos: [], descripcion: '', documentos: '', despues: '' })

// Los documentos se editan como texto, uno por línea
export const borradorDesde = (tipo) => ({
  nombre: tipo.nombre, sla_dias: String(tipo.sla_dias), audiencia: tipo.audiencia, campos: (tipo.formulario || []).map(campoDesdeServidor),
  descripcion: tipo.requisitos?.descripcion ?? '', documentos: (tipo.requisitos?.documentos ?? []).join('\n'), despues: tipo.requisitos?.despues ?? '',
})

// Los requisitos como los espera la API: lo que no se escribió no se manda
export function requisitosDe(b) {
  const r = {}
  if (b.descripcion.trim()) r.descripcion = b.descripcion.trim()
  const documentos = lineasDe(b.documentos)
  if (documentos.length) r.documentos = documentos
  if (b.despues.trim()) r.despues = b.despues.trim()
  return r
}

export const cuerpoDe = (b) => ({
  nombre: b.nombre.trim(), sla_dias: b.sla_dias.trim() === '' ? null : Number(b.sla_dias), audiencia: b.audiencia, formulario: b.campos.map(campoAServidor),
  requisitos: requisitosDe(b),
})

/* ---------------------------------------------------------------- validación del lado del cliente */

// Devuelve los errores con las MISMAS claves que usa el servidor: `nombre`, `sla_dias`, `formulario`, `formulario.<i>` y `formulario.<i>.<atributo>`
export function validarBorrador(b) {
  const e = {}
  const nombre = b.nombre.trim()
  if (nombre.length < NOMBRE_MIN) e.nombre = `Escribe un nombre de al menos ${NOMBRE_MIN} caracteres.`
  else if (nombre.length > NOMBRE_MAX) e.nombre = `El nombre no puede superar los ${NOMBRE_MAX} caracteres.`
  const sla = b.sla_dias.trim()
  if (!/^\d+$/.test(sla) || Number(sla) < SLA_MIN || Number(sla) > SLA_MAX) e.sla_dias = `Indica un número entero de ${SLA_MIN} a ${SLA_MAX} días hábiles.`
  if (b.campos.length > MAX_CAMPOS) e.formulario = `Un trámite admite hasta ${MAX_CAMPOS} campos.`
  if (b.descripcion.trim().length > DESCRIPCION_MAX) e['requisitos.descripcion'] = `La descripción no puede superar los ${DESCRIPCION_MAX} caracteres.`
  if (b.despues.trim().length > DESPUES_MAX) e['requisitos.despues'] = `Lo que pasa después no puede superar los ${DESPUES_MAX} caracteres.`
  const documentos = lineasDe(b.documentos)
  if (documentos.length > DOCUMENTOS_MAX) e['requisitos.documentos'] = `Hasta ${DOCUMENTOS_MAX} documentos.`
  else if (documentos.some((d) => d.length > DOCUMENTO_MAX)) e[`requisitos.documentos.${documentos.findIndex((d) => d.length > DOCUMENTO_MAX)}`] = `Cada documento admite hasta ${DOCUMENTO_MAX} caracteres.`
  else if (new Set(documentos).size !== documentos.length) e['requisitos.documentos'] = 'Hay documentos repetidos.'
  const vistos = new Set()
  b.campos.forEach((c, i) => {
    const k = `formulario.${i}`
    const etiqueta = c.etiqueta.trim()
    if (!etiqueta) e[`${k}.etiqueta`] = 'Escribe la etiqueta del campo.'
    else if (etiqueta.length > ETIQUETA_MAX) e[`${k}.etiqueta`] = `La etiqueta no puede superar los ${ETIQUETA_MAX} caracteres.`
    const id = c.id.trim()
    if (!ID_VALIDO.test(id)) e[`${k}.id`] = 'Usa minúsculas, números y guion bajo, empezando con una letra (hasta 40 caracteres).'
    else if (vistos.has(id)) e[`${k}.id`] = 'Otro campo ya usa este id.'
    vistos.add(id)
    if (usaMaximo(c.tipo)) {
      const maximo = c.max.trim()
      if (!/^\d+(\.\d+)?$/.test(maximo) || Number(maximo) <= 0 || (c.tipo !== 'numero' && !/^\d+$/.test(maximo))) e[`${k}.max`] = c.tipo === 'numero' ? 'Indica un número mayor que cero.' : 'Indica un número entero mayor que cero.'
    }
    if (c.tipo === 'seleccion') {
      const opciones = lineasDe(c.opciones)
      if (opciones.length === 0) e[`${k}.opciones`] = 'Agrega al menos una opción.'
      else if (opciones.length > OPCIONES_MAX) e[`${k}.opciones`] = `Hasta ${OPCIONES_MAX} opciones.`
      else if (new Set(opciones).size !== opciones.length) e[`${k}.opciones`] = 'Hay opciones repetidas.'
    }
    if (c.ayuda.trim().length > AYUDA_MAX) e[`${k}.ayuda`] = `La ayuda no puede superar los ${AYUDA_MAX} caracteres.`
  })
  return e
}

// Los campos para la vista previa: los mismos que dibuja el formulario real. Los ids se sustituyen por `vista_<i>` para que dos campos a
// medio escribir (sin id o con el mismo id) no choquen en la vista previa.
export function camposDeVista(campos) {
  return campos.map((c, i) => {
    const maximo = usaMaximo(c.tipo) && /^\d+(\.\d+)?$/.test(c.max.trim()) && Number(c.max) > 0 ? Number(c.max) : undefined
    return {
      id: `vista_${i}`, etiqueta: c.etiqueta.trim() || '(sin etiqueta)', tipo: c.tipo, obligatorio: c.obligatorio, max: maximo,
      opciones: lineasDe(c.opciones), ayuda: c.ayuda.trim() || undefined, entero: c.tipo === 'numero' && c.entero,
    }
  })
}

/* ---------------------------------------------------------------- errores del servidor */

// «formulario.2.max» -> «Campo 3 · largo máximo». El texto del servidor va después, siempre como texto plano.
const ATRIBUTOS = { id: 'id', etiqueta: 'etiqueta', tipo: 'tipo', obligatorio: 'obligatorio', max: 'máximo', opciones: 'opciones', ayuda: 'ayuda', entero: 'entero' }
const ENCABEZADOS = { nombre: 'Nombre', sla_dias: 'Plazo', audiencia: 'Para quién', formulario: 'Formulario', activo: 'Estado' }

export function encabezadoDeError(clave) {
  const partes = String(clave).split('.')
  if (partes[0] === 'formulario' && /^\d+$/.test(partes[1] ?? '')) {
    const campo = `Campo ${Number(partes[1]) + 1}`
    return partes[2] ? `${campo} · ${ATRIBUTOS[partes[2]] ?? partes[2]}` : campo
  }
  if (partes[0] === 'requisitos') {
    if (partes[1] === 'documentos' && /^\d+$/.test(partes[2] ?? '')) return `Documento ${Number(partes[2]) + 1}`
    return { descripcion: 'Descripción', documentos: 'Documentos', despues: 'Qué pasa después' }[partes[1]] ?? 'Requisitos'
  }
  return ENCABEZADOS[clave] ?? ''
}

// Un `errores` del servidor ({clave: mensaje}) como lista de líneas «Encabezado: mensaje» para el resumen
export const resumenDeErrores = (errores) => Object.entries(errores).map(([k, m]) => {
  const encabezado = encabezadoDeError(k)
  return encabezado ? `${encabezado}: ${m}` : String(m)
})
