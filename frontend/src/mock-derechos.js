// Simulador (solo desarrollo y pruebas) de los derechos sobre los datos personales (docs/api.md, «Derechos sobre los datos personales»),
// con estado en memoria. Respeta las reglas del servidor real: todo es sobre la propia cuenta, corregir exige segundo factor reciente y solo
// admite correo, provincia y ciudad, un correo repetido responde igual que en el registro, hay un tope de solicitudes abiertas y el
// operador de identidades (nunca otro rol) responde una sola vez y no responde la suya. El aviso es el que genera el backend real.
import aviso from './mock-datos/aviso-privacidad.json'

const DIA = 86400000
const HABILES = 10
const MAX_ABIERTAS = 3
const CORREGIBLES = ['correo', 'provincia', 'ciudad']
const PROVINCIAS = [
  'Bocas del Toro', 'Chiriquí', 'Coclé', 'Colón', 'Darién', 'Herrera', 'Los Santos', 'Panamá', 'Panamá Oeste', 'Veraguas',
  'Comarca Guna Yala', 'Comarca Emberá-Wounaan', 'Comarca Ngäbe-Buglé',
]
const CORREO = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/
export const MENSAJE_ACEPTA_AVISO = 'debes leer el aviso de privacidad y confirmarlo (acepta_aviso: true)'

// 10 días hábiles de lunes a viernes (igual que el servidor, sin calendario de feriados)
export function sumarDiasHabiles(desde, dias) {
  const d = new Date(desde)
  let faltan = dias
  while (faltan > 0) {
    d.setDate(d.getDate() + 1)
    if (d.getDay() !== 0 && d.getDay() !== 6) faltan -= 1
  }
  return d
}

const PERFILES_FIJOS = {
  'ana.ciudadana': { nombre: 'Ana', apellidos: 'Rodríguez Pérez', cedula: '8-765-4321', fecha_nacimiento: '1992-03-14', provincia: 'Panamá', ciudad: 'San Miguelito', correo: 'ana.rodriguez@ejemplo.com' },
  'beto.ciudadano': { nombre: 'Beto', apellidos: 'Castillo Mora', cedula: '4-321-9876', fecha_nacimiento: '1985-11-02', provincia: 'Chiriquí', ciudad: 'David', correo: 'beto.castillo@ejemplo.com' },
}

// Igual que el servidor: solo quedan visibles los últimos 3 caracteres alfanuméricos y se respetan los guiones
export function enmascarar(cedula) {
  let restantes = [...cedula].filter((c) => /[A-Za-z0-9]/.test(c)).length
  return [...cedula].map((c) => (/[A-Za-z0-9]/.test(c) ? (--restantes < 3 ? c : '*') : c)).join('')
}

export function derechosMock({ usuarios, actual, resp, hace, mfaFresco, tramitesDe }) {
  const perfiles = {}
  for (const [nombre, u] of Object.entries(usuarios)) {
    if (u.plataforma !== 'ninguno') continue // las cuentas de plataforma no tienen perfil de persona
    perfiles[nombre] = {
      ...(PERFILES_FIJOS[nombre] || { nombre: nombre.split('.')[0].replace(/^./, (c) => c.toUpperCase()), apellidos: 'Demostración', cedula: `8-${u.id}-1000`, fecha_nacimiento: '1990-05-20', provincia: 'Panamá', ciudad: 'Ciudad de Panamá', correo: `${nombre}@ejemplo.com` }),
      creado_en: hace(40 * DIA), actualizado_en: null, aviso_version: aviso.version, aviso_leido_en: hace(40 * DIA),
    }
  }
  // Una cuenta anterior al aviso: no hay constancia de lectura (queda en NULL, no se inventa)
  if (perfiles['beto.ciudadano']) { perfiles['beto.ciudadano'].aviso_version = null; perfiles['beto.ciudadano'].aviso_leido_en = null }
  const correosAjenos = new Set(Object.values(perfiles).map((p) => p.correo.toLowerCase()))
  const eventos = [] // actividad de seguridad propia (para la exportación)

  const ahora = Date.now()
  const solicitudes = [
    { id: 1, usuario: 'ana.ciudadana', tipo: 'rectificacion', detalle: 'Mi segundo apellido está mal escrito: es Pérez, no Peres.', estado: 'atendida', creada_en: hace(9 * DIA),
      vence_en: sumarDiasHabiles(ahora - 9 * DIA, HABILES).toISOString(), respondida_en: hace(6 * DIA), respondida_por: 'irene.identidades',
      respuesta: 'Corregimos tu segundo apellido. Puedes verlo en «Mis datos».' },
    { id: 2, usuario: 'beto.ciudadano', tipo: 'cancelacion', detalle: 'Quiero que eliminen mi cuenta y todos mis datos.', estado: 'recibida', creada_en: hace(2 * DIA),
      vence_en: sumarDiasHabiles(ahora - 2 * DIA, HABILES).toISOString(), respondida_en: null, respondida_por: null, respuesta: null },
    { id: 3, usuario: 'ana.ciudadana', tipo: 'oposicion', detalle: 'No quiero que mis datos se usen para otra cosa que mis trámites.', estado: 'recibida', creada_en: hace(16 * DIA),
      vence_en: sumarDiasHabiles(ahora - 16 * DIA, HABILES).toISOString(), respondida_en: null, respondida_por: null, respuesta: null },
  ]
  let siguiente = 4

  const vencida = (s) => s.estado === 'recibida' && new Date(s.vence_en).getTime() < Date.now()
  const paraPersona = (s) => ({ id: s.id, tipo: s.tipo, detalle: s.detalle, estado: s.estado, creada_en: s.creada_en, vence_en: s.vence_en, vencida: vencida(s), respondida_en: s.respondida_en, respuesta: s.respuesta })
  const paraOperador = (s) => ({ ...paraPersona(s), persona: { id: usuarios[s.usuario].id, usuario: s.usuario }, respondida_por: s.respondida_por ? { id: usuarios[s.respondida_por].id, usuario: s.respondida_por } : null })
  const constancia = (p) => (p.aviso_version ? { version: p.aviso_version, leido_en: p.aviso_leido_en, vigente: p.aviso_version === aviso.version } : null)
  const perfilCompleto = ({ aviso_version: _v, aviso_leido_en: _l, ...resto }) => resto
  const perfilVisible = (p) => ({ ...perfilCompleto(p), cedula: enmascarar(p.cedula) }) // al ver, la cédula sale enmascarada

  const pideCodigo = () => resp(403, { codigo: 'acceso_denegado', detalle: 'No tienes autorización para esta operación.', reautenticacion_sugerida: true })
  const negado = () => resp(403, { codigo: 'acceso_denegado', detalle: 'No tienes autorización para esta operación.', reautenticacion_sugerida: false })

  function misDatos(camino, metodo, cuerpo) {
    const nombre = actual()
    const u = usuarios[nombre]
    const perfil = perfiles[nombre] || null
    if (u.plataforma !== 'ninguno') return negado() // el PDP: las cuentas de plataforma no ejercen estos derechos
    const propias = solicitudes.filter((s) => s.usuario === nombre).sort((a, b) => b.id - a.id)
    const cuenta = { id: u.id, usuario: nombre, estado_cuenta: 'activa', rol_plataforma: u.plataforma, mfa_activo: true, nivel_aseguramiento: 2, creada_en: hace(40 * DIA), membresias: u.membresias.map((m) => ({ institucion: m.institucion, rol: m.rol })) }

    if (camino === '/auth/mis-datos/' && metodo === 'GET') {
      return resp(200, {
        cuenta, perfil: perfil ? perfilVisible(perfil) : null, campos_editables: CORREGIBLES, tramites: { total: u.plataforma === 'ninguno' ? tramitesDe(u).length : 0 },
        aviso_aceptado: perfil ? constancia(perfil) : null, aviso_vigente: aviso, solicitudes: propias.map(paraPersona),
        solicitudes_abiertas_maximo: MAX_ABIERTAS, plazo_respuesta_dias_habiles: HABILES,
      })
    }
    if (camino === '/auth/mis-datos/' && metodo === 'PATCH') {
      if (!perfil) return resp(404, { codigo: 'sin_perfil', detalle: 'Esta cuenta no tiene datos personales que corregir.' })
      if (!mfaFresco()) return pideCodigo()
      const claves = Object.keys(cuerpo || {})
      const errores = []
      if (claves.length === 0) errores.push('indica al menos un dato a corregir: correo, provincia o ciudad')
      const ajenos = claves.filter((k) => !CORREGIBLES.includes(k)).sort()
      if (ajenos.length) errores.push(`estos datos no se corrigen aquí (pide una rectificación): ${ajenos.join(', ')}`)
      const nuevos = {}
      if ('correo' in cuerpo) {
        const correo = String(cuerpo.correo).trim().toLowerCase()
        if (!CORREO.test(correo) || correo.length > 254) errores.push('el correo no tiene un formato válido'); else nuevos.correo = correo
      }
      if ('provincia' in cuerpo) { if (!PROVINCIAS.includes(String(cuerpo.provincia).trim())) errores.push('la provincia no es una de las de Panamá'); else nuevos.provincia = String(cuerpo.provincia).trim() }
      if ('ciudad' in cuerpo) {
        const ciudad = String(cuerpo.ciudad).trim()
        if (!ciudad || ciudad.length > 60 || !/^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9 .'-]+$/.test(ciudad)) errores.push('la ciudad solo admite letras, números, espacios y signos simples (hasta 60 caracteres)'); else nuevos.ciudad = ciudad
      }
      if (errores.length) return resp(400, { codigo: 'datos_invalidos', errores })
      // Un correo de otra cuenta responde igual que en el registro: no se dice de quién es
      if (nuevos.correo && nuevos.correo !== perfil.correo.toLowerCase() && correosAjenos.has(nuevos.correo)) return resp(409, { codigo: 'usuario_existente', detalle: 'No se pudo guardar el cambio con esos datos.' })
      const cambiados = CORREGIBLES.filter((c) => c in nuevos && nuevos[c] !== (c === 'correo' ? perfil.correo.toLowerCase() : perfil[c]))
      if (cambiados.length) {
        for (const c of cambiados) perfil[c] = nuevos[c]
        if (cambiados.includes('correo')) correosAjenos.add(perfil.correo.toLowerCase())
        perfil.actualizado_en = new Date().toISOString()
        eventos.unshift({ evento: 'datos_personales_corregidos', creado_en: perfil.actualizado_en, ip: '192.168.100.10' }) // solo los nombres de los campos, nunca los valores
      }
      return resp(200, { codigo: cambiados.length ? 'datos_corregidos' : 'sin_cambios', campos_cambiados: cambiados.sort(), perfil: perfilVisible(perfil) })
    }
    if (camino === '/auth/mis-datos/exportar/' && metodo === 'GET') {
      if (!mfaFresco()) return pideCodigo() // la exportación lleva la cédula completa: pide segundo factor reciente
      eventos.unshift({ evento: 'datos_personales_exportados', creado_en: new Date().toISOString(), ip: '192.168.100.10' })
      return resp(200, {
        formato: 'siget-mis-datos/1', generado_en: new Date().toISOString(), aviso_privacidad: perfil ? constancia(perfil) : null, cuenta,
        perfil: perfil ? perfilCompleto(perfil) : null, tramites: u.plataforma === 'ninguno' ? tramitesDe(u).map((t) => ({ ...t, historial: [] })) : [],
        solicitudes: propias.map(paraPersona), actividad_de_seguridad: [...eventos, { evento: 'login_ok', creado_en: hace(9 * 60000), ip: '192.168.100.10' }],
      })
    }
    if (camino === '/auth/mis-datos/solicitudes/' && metodo === 'GET') {
      return resp(200, { solicitudes: propias.map(paraPersona), plazo_respuesta_dias_habiles: HABILES, abiertas_maximo: MAX_ABIERTAS })
    }
    if (camino === '/auth/mis-datos/solicitudes/' && metodo === 'POST') {
      const errores = []
      const detalle = typeof cuerpo.detalle === 'string' ? cuerpo.detalle.trim() : ''
      if (!['rectificacion', 'cancelacion', 'oposicion'].includes(cuerpo.tipo)) errores.push('el tipo debe ser «rectificacion», «cancelacion» u «oposicion»')
      if (detalle.length < 10 || detalle.length > 1000) errores.push('el detalle debe tener de 10 a 1000 caracteres')
      if (errores.length) return resp(400, { codigo: 'datos_invalidos', errores })
      const abiertas = propias.filter((s) => s.estado === 'recibida').length
      if (abiertas >= MAX_ABIERTAS) return resp(409, { codigo: 'demasiadas_abiertas', detalle: `Ya tienes ${abiertas} solicitudes abiertas (el máximo es ${MAX_ABIERTAS}). Espera su respuesta antes de enviar otra.` })
      const s = { id: siguiente++, usuario: nombre, tipo: cuerpo.tipo, detalle, estado: 'recibida', creada_en: new Date().toISOString(), vence_en: sumarDiasHabiles(Date.now(), HABILES).toISOString(), respondida_en: null, respondida_por: null, respuesta: null }
      solicitudes.push(s)
      eventos.unshift({ evento: 'solicitud_derecho_creada', creado_en: s.creada_en, ip: '192.168.100.10' })
      return resp(201, paraPersona(s))
    }
    return null
  }

  function consola(camino, metodo, cuerpo, parametros) {
    const nombre = actual()
    const u = usuarios[nombre]
    if (u.plataforma !== 'operador_identidades') return negado() // solo identidades ve y responde
    if (camino === '/plataforma/solicitudes-datos/' && metodo === 'GET') {
      if (!mfaFresco()) return pideCodigo() // ver las solicitudes también exige segundo factor reciente
      const estado = parametros.get('estado') || ''
      if (estado && !['recibida', 'atendida', 'rechazada'].includes(estado)) return resp(400, { codigo: 'datos_invalidos', errores: ['el estado debe ser «recibida», «atendida» o «rechazada»'] })
      const filtradas = solicitudes.filter((s) => !estado || s.estado === estado)
      const abiertas = filtradas.filter((s) => s.estado === 'recibida').sort((a, b) => new Date(a.vence_en) - new Date(b.vence_en))
      const cerradas = filtradas.filter((s) => s.estado !== 'recibida').sort((a, b) => new Date(b.respondida_en) - new Date(a.respondida_en))
      const todasAbiertas = solicitudes.filter((s) => s.estado === 'recibida')
      return resp(200, { solicitudes: [...abiertas, ...cerradas].map(paraOperador), resumen: { recibidas: todasAbiertas.length, vencidas: todasAbiertas.filter(vencida).length } })
    }
    const responder = camino.match(/^\/plataforma\/solicitudes-datos\/(\d+)\/responder\/$/)
    if (responder && metodo === 'POST') {
      if (!mfaFresco()) return pideCodigo() // responder exige segundo factor reciente
      const s = solicitudes.find((x) => x.id === Number(responder[1]))
      if (!s) return resp(404, { detalle: 'No encontrado.' })
      const respuesta = typeof cuerpo.respuesta === 'string' ? cuerpo.respuesta.trim() : ''
      const errores = []
      if (!['atendida', 'rechazada'].includes(cuerpo.estado)) errores.push('el estado debe ser «atendida» o «rechazada»')
      if (respuesta.length < 10 || respuesta.length > 2000) errores.push('la respuesta debe tener de 10 a 2000 caracteres')
      if (s.usuario === nombre) return resp(409, { codigo: 'no_a_si_mismo', detalle: 'No puedes hacer esto sobre tu propia cuenta.' })
      if (s.estado !== 'recibida') return resp(409, { codigo: 'ya_resuelta', detalle: 'Esta propuesta o solicitud ya fue resuelta.' })
      if (errores.length) return resp(400, { codigo: 'datos_invalidos', errores })
      Object.assign(s, { estado: cuerpo.estado, respuesta, respondida_en: new Date().toISOString(), respondida_por: nombre })
      return resp(200, { codigo: `solicitud_${cuerpo.estado}` })
    }
    return null
  }

  return {
    aviso: () => resp(200, aviso),
    manejar(camino, metodo, cuerpo, parametros) {
      if (camino.startsWith('/auth/mis-datos/')) return misDatos(camino, metodo, cuerpo)
      if (camino.startsWith('/plataforma/solicitudes-datos/')) return consola(camino, metodo, cuerpo, parametros)
      return null
    },
  }
}
