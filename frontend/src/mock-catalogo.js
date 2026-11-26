// Simulador (solo desarrollo y pruebas) de la gestión del catálogo por la coordinación de cada institución (migración 020), con estado en memoria.
// Respeta las reglas del servidor real: solo la coordinación de ESA institución, con segundo factor reciente (si no, 403 con
// `reautenticacion_sugerida`); el nombre no se repite en la institución; el formulario se limpia y se valida como `apps/catalogo/gestion.py`
// (errores por campo con las claves `nombre`, `sla_dias`, `formulario.<i>.<atributo>`); un tipo ajeno es 404; nada se borra; y cada alta o cambio
// deja una fila en el historial (inalterable) con solo lo que cambió.

const AUDIENCIAS = ['ciudadania', 'institucion', 'ambas']
const TIPOS_CAMPO = ['texto', 'texto_largo', 'numero', 'fecha', 'seleccion']
const MAXIMO_POR_TIPO = { texto: 500, texto_largo: 5000, numero: 1e9 }
const ATRIBUTOS = ['id', 'etiqueta', 'tipo', 'obligatorio', 'max', 'opciones', 'ayuda', 'entero']
const ID_VALIDO = /^[a-z][a-z0-9_]{0,39}$/
const NOMBRE_REPETIDO = 'Ya existe un trámite con ese nombre en esta institución.'

const esEntero = (v) => Number.isInteger(v) && typeof v === 'number'
const largo = (texto) => [...texto].length
// Controles, separadores de línea y caracteres bidireccionales o invisibles de formato: no se admiten en un texto de una línea
const prohibido = (texto) => [...texto].some((c) => {
  const n = c.codePointAt(0)
  return n < 32 || n === 127 || n === 0x2028 || n === 0x2029 || n === 0xfeff || (n >= 0x202a && n <= 0x202e) || (n >= 0x2066 && n <= 0x2069)
})

// Un texto de una línea, sin caracteres de control, de `min` a `max` caracteres
function textoCorto(valor, min, max) {
  if (typeof valor !== 'string') return { error: 'Debe ser un texto.' }
  const limpio = valor.normalize('NFC').trim()
  if (prohibido(limpio)) return { error: 'Contiene caracteres no permitidos (ni saltos de línea).' }
  if (largo(limpio) > max) return { error: `No puede superar los ${max} caracteres.` }
  if (largo(limpio) < min || !/[\p{L}\p{N}]/u.test(limpio)) return { error: limpio ? 'Debe tener al menos una letra o un número.' : `Debe tener al menos ${min} caracteres.` }
  return { texto: limpio }
}

function validarCampo(i, crudo, errores, vistos) {
  const k = `formulario.${i}`
  if (!crudo || typeof crudo !== 'object' || Array.isArray(crudo)) { errores[k] = 'Cada campo debe ser un objeto.'; return null }
  if (Object.keys(crudo).some((a) => !ATRIBUTOS.includes(a))) errores[k] = 'El campo tiene atributos que no se admiten.'
  const limpio = {}
  if (typeof crudo.id !== 'string' || !ID_VALIDO.test(crudo.id)) errores[`${k}.id`] = 'Usa minúsculas, números y guion bajo, empezando con una letra (hasta 40 caracteres).'
  else if (vistos.has(crudo.id)) errores[`${k}.id`] = 'Otro campo ya usa este id.'
  else vistos.add(crudo.id)
  limpio.id = crudo.id
  const etiqueta = textoCorto(crudo.etiqueta, 1, 120)
  if (etiqueta.error) errores[`${k}.etiqueta`] = (typeof crudo.etiqueta === 'string' && !crudo.etiqueta.trim()) || crudo.etiqueta == null ? 'Escribe la etiqueta del campo.' : etiqueta.error
  limpio.etiqueta = etiqueta.texto
  if (!TIPOS_CAMPO.includes(crudo.tipo)) { errores[`${k}.tipo`] = 'Elige un tipo de campo.'; return limpio }
  limpio.tipo = crudo.tipo
  const obligatorio = crudo.obligatorio ?? false
  if (typeof obligatorio !== 'boolean') errores[`${k}.obligatorio`] = 'Debe ser verdadero o falso.'
  limpio.obligatorio = obligatorio === true
  if (crudo.tipo in MAXIMO_POR_TIPO) {
    const m = crudo.max
    if (typeof m !== 'number' || !(m > 0) || (crudo.tipo !== 'numero' && !esEntero(m))) errores[`${k}.max`] = crudo.tipo === 'numero' ? 'Indica un número mayor que cero.' : 'Indica un número entero mayor que cero.'
    else if (m > MAXIMO_POR_TIPO[crudo.tipo]) errores[`${k}.max`] = `No puede ser mayor que ${MAXIMO_POR_TIPO[crudo.tipo]}.`
    else limpio.max = m
  }
  if (crudo.tipo === 'seleccion') {
    const ops = crudo.opciones
    if (!Array.isArray(ops) || ops.length === 0) errores[`${k}.opciones`] = 'Agrega al menos una opción.'
    else if (ops.length > 30) errores[`${k}.opciones`] = 'Hasta 30 opciones.'
    else {
      const rs = ops.map((o) => textoCorto(o, 1, 120))
      if (rs.some((r) => r.error)) errores[`${k}.opciones`] = 'Cada opción debe ser un texto de 1 a 120 caracteres.'
      else if (new Set(rs.map((r) => r.texto)).size !== rs.length) errores[`${k}.opciones`] = 'Hay opciones repetidas.'
      else limpio.opciones = rs.map((r) => r.texto)
    }
  }
  if (crudo.ayuda != null) {
    if (typeof crudo.ayuda !== 'string') errores[`${k}.ayuda`] = 'Debe ser un texto.'
    else if (crudo.ayuda.trim()) {
      const a = textoCorto(crudo.ayuda, 1, 300)
      if (a.error) errores[`${k}.ayuda`] = a.error
      else limpio.ayuda = a.texto
    }
  }
  if (crudo.entero != null && typeof crudo.entero !== 'boolean') errores[`${k}.entero`] = 'Debe ser verdadero o falso.'
  else if (crudo.tipo === 'numero' && crudo.entero === true) limpio.entero = true
  return limpio
}

function validarFormulario(crudo) {
  if (!Array.isArray(crudo)) return { errores: { formulario: 'Debe ser una lista de campos.' } }
  if (crudo.length > 30) return { errores: { formulario: 'Un trámite admite hasta 30 campos.' } }
  const errores = {}
  const vistos = new Set()
  const limpio = crudo.map((c, i) => validarCampo(i, c, errores, vistos)).filter(Boolean)
  return Object.keys(errores).length ? { errores } : { limpio }
}

// Igual que `gestion.validar`: `parcial` es el PATCH (al menos un dato) y no el alta (nombre y plazo obligatorios)
function validar(cuerpo, parcial) {
  if (!cuerpo || typeof cuerpo !== 'object' || Array.isArray(cuerpo)) return { errores: { datos: 'El cuerpo debe ser un objeto.' } }
  const editables = ['nombre', 'sla_dias', 'audiencia', 'formulario', 'activo']
  const errores = {}
  if (Object.keys(cuerpo).some((k) => !editables.includes(k))) errores.datos = 'Hay campos que no se pueden indicar ni cambiar: solo el nombre, el plazo, para quién es, el formulario y si está activo.'
  if (parcial && !Object.keys(cuerpo).some((k) => editables.includes(k))) errores.datos = 'Indica al menos un dato para cambiar.'
  const limpio = {}
  if ('nombre' in cuerpo || !parcial) {
    if (cuerpo.nombre == null) errores.nombre = 'Este campo es obligatorio.'
    else { const r = textoCorto(cuerpo.nombre, 3, 150); if (r.error) errores.nombre = r.error; else limpio.nombre = r.texto }
  }
  if ('sla_dias' in cuerpo || !parcial) {
    if (cuerpo.sla_dias == null) errores.sla_dias = 'Este campo es obligatorio.'
    else if (!esEntero(cuerpo.sla_dias) || cuerpo.sla_dias < 1 || cuerpo.sla_dias > 365) errores.sla_dias = 'Debe ser un número entero de 1 a 365 días hábiles.'
    else limpio.sla_dias = cuerpo.sla_dias
  }
  if ('audiencia' in cuerpo || !parcial) {
    const a = cuerpo.audiencia ?? 'ciudadania'
    if (!AUDIENCIAS.includes(a)) errores.audiencia = 'Debe ser «ciudadania», «institucion» o «ambas».'
    else limpio.audiencia = a
  }
  if ('formulario' in cuerpo || !parcial) {
    const r = validarFormulario(cuerpo.formulario ?? [])
    if (r.errores) Object.assign(errores, r.errores)
    else limpio.formulario = r.limpio
  }
  if ('activo' in cuerpo || !parcial) {
    const a = cuerpo.activo ?? true
    if (typeof a !== 'boolean') errores.activo = 'Debe ser verdadero o falso.'
    else limpio.activo = a
  }
  return Object.keys(errores).length ? { errores } : { limpio }
}

export function catalogoMock({ usuarios, actual, hace, mfaFresco, tipos, resp, negado, pideCodigo }) {
  const cambios = []
  const dto = (t) => ({ id: t.id, institucion_id: t.institucion.id, nombre: t.nombre, sla_dias: t.sla_dias, audiencia: t.audiencia, formulario: t.formulario, activo: t.activo !== false, version: t.version ?? 1 })
  const registrar = (t, accion, antes, despues, actor, cuando = new Date().toISOString()) => {
    cambios.push({ id: cambios.length + 1, institucion_id: t.institucion.id, accion, creado_en: cuando, tipo_tramite: { id: t.id, nombre: t.nombre }, actor: { id: actor.id, usuario: actor.usuario }, antes, despues })
  }

  // Historial de ejemplo del MOP: el alta de «Permiso de uso de vía pública», veinte ajustes de plazo y una desactivación con su reactivación
  const ejemplo = tipos().find((t) => t.institucion.id === 3)
  const carla = { id: usuarios['carla.mop'].id, usuario: 'carla.mop' }
  if (ejemplo) {
    const cuando = (n) => hace((24 - n) * 6 * 3600000)
    registrar(ejemplo, 'alta', null, { nombre: ejemplo.nombre, sla_dias: ejemplo.sla_dias, audiencia: ejemplo.audiencia, formulario: ejemplo.formulario, activo: true }, carla, cuando(0))
    for (let i = 1; i <= 20; i++) registrar(ejemplo, 'cambio', { sla_dias: i % 2 ? 10 : 12 }, { sla_dias: i % 2 ? 12 : 10 }, carla, cuando(i))
    registrar(ejemplo, 'desactivado', { activo: true }, { activo: false }, carla, cuando(21))
    registrar(ejemplo, 'activado', { activo: false }, { activo: true }, carla, cuando(22))
  }

  const coordina = (u, institucionId) => u.membresias.some((m) => m.institucion_id === institucionId && m.rol === 'coordinador_institucional')

  return {
    manejar(camino, metodo, cuerpo, p) {
      const ruta = camino.match(/^\/catalogo\/institucion\/(\d+)\/(tipos|cambios)\/(?:(\d+)\/)?$/)
      if (!ruta) return null
      const institucionId = Number(ruta[1])
      const nombre = actual()
      const u = usuarios[nombre]
      // El PDP va primero: coordinación de ESA institución y segundo factor reciente. Cualquier otra persona, 403
      if (!coordina(u, institucionId)) return negado()
      if (!mfaFresco()) return pideCodigo()
      const actor = { id: u.id, usuario: nombre }
      const institucion = u.membresias.find((m) => m.institucion_id === institucionId).institucion

      if (ruta[2] === 'cambios') {
        if (metodo !== 'GET') return resp(405, { codigo: 'metodo_no_permitido' })
        const valido = ['limite', 'desplazamiento'].every((k) => {
          const v = p.get(k)
          return v === null || (/^\d+$/.test(v) && (k === 'desplazamiento' || (Number(v) >= 1 && Number(v) <= 100)))
        })
        if (!valido) return resp(400, { codigo: 'paginacion_invalida', detalle: 'limite (1 a 100) y desplazamiento deben ser enteros válidos.' })
        const limite = Number(p.get('limite') || 20)
        const desde = Number(p.get('desplazamiento') || 0)
        const lista = cambios.filter((c) => c.institucion_id === institucionId).sort((a, b) => b.id - a.id)
        return resp(200, { resultados: lista.slice(desde, desde + limite).map(({ institucion_id: _i, ...c }) => c), total: lista.length, limite, desplazamiento: desde })
      }

      if (!ruta[3]) {
        if (metodo === 'GET') {
          const lista = tipos().filter((t) => t.institucion.id === institucionId).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es') || a.id - b.id)
          return resp(200, { institucion: { id: institucionId, nombre: institucion }, tipos: lista.map(dto) })
        }
        if (metodo !== 'POST') return resp(405, { codigo: 'metodo_no_permitido' })
        const { limpio, errores } = validar(cuerpo, false)
        const repetido = (n) => tipos().some((t) => t.institucion.id === institucionId && t.nombre.toLowerCase() === n.toLowerCase())
        if (errores) return resp(400, { codigo: 'datos_invalidos', detalle: 'Los datos del trámite no cumplen las reglas del catálogo.', errores })
        if (repetido(limpio.nombre)) return resp(400, { codigo: 'datos_invalidos', detalle: NOMBRE_REPETIDO, errores: { nombre: NOMBRE_REPETIDO } })
        const nuevo = { id: Math.max(0, ...tipos().map((t) => t.id)) + 1, institucion: { id: institucionId, nombre: institucion }, ...limpio, version: 1 }
        tipos().push(nuevo)
        registrar(nuevo, 'alta', null, { nombre: nuevo.nombre, sla_dias: nuevo.sla_dias, audiencia: nuevo.audiencia, formulario: nuevo.formulario, activo: nuevo.activo }, actor)
        return resp(201, dto(nuevo))
      }

      if (metodo !== 'PATCH') return resp(405, { codigo: 'metodo_no_permitido' })
      const tipo = tipos().find((t) => t.id === Number(ruta[3]) && t.institucion.id === institucionId) // lo de otra institución, para quien pregunta, no existe
      if (!tipo) return resp(404, { detail: 'No encontrado.' })
      // Igual que el servidor: la versión que la persona editaba es obligatoria (entero positivo) y aparte de lo editable
      const { version, ...editado } = cuerpo && typeof cuerpo === 'object' && !Array.isArray(cuerpo) ? cuerpo : {}
      const { limpio, errores } = validar(cuerpo && typeof cuerpo === 'object' && !Array.isArray(cuerpo) ? editado : cuerpo, true)
      const versionValida = Number.isInteger(version) && version > 0 && version <= 2147483647
      const todos = versionValida ? errores : { ...(errores || {}), version: 'Indica la versión del trámite que estás editando (un número entero).' }
      if (todos) return resp(400, { codigo: 'datos_invalidos', detalle: 'Los datos del trámite no cumplen las reglas del catálogo.', errores: todos })
      // Otra persona lo cambió entre tanto: no se pisa
      if (version !== (tipo.version ?? 1)) return resp(409, { codigo: 'version_desactualizada', detalle: 'Otra persona cambió este trámite mientras lo editabas. Recarga para ver la versión actual y vuelve a aplicar tu cambio.' })
      if ('nombre' in limpio && tipos().some((t) => t.id !== tipo.id && t.institucion.id === institucionId && t.nombre.toLowerCase() === limpio.nombre.toLowerCase())) {
        return resp(400, { codigo: 'datos_invalidos', detalle: NOMBRE_REPETIDO, errores: { nombre: NOMBRE_REPETIDO } })
      }
      const antes = {}
      const despues = {}
      for (const [k, v] of Object.entries(limpio)) {
        if (JSON.stringify(tipo[k]) !== JSON.stringify(v)) { antes[k] = k === 'activo' ? tipo.activo !== false : tipo[k]; despues[k] = v }
      }
      if (Object.keys(despues).length) {
        Object.assign(tipo, limpio)
        tipo.version = (tipo.version ?? 1) + 1
        const soloActivo = Object.keys(despues).length === 1 && 'activo' in despues
        registrar(tipo, soloActivo ? (despues.activo ? 'activado' : 'desactivado') : 'cambio', antes, despues, actor)
      }
      return resp(200, dto(tipo))
    },
  }
}
