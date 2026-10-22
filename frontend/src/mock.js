// Servidor de mentira SOLO para desarrollo (`npm run dev`): permite ver y probar cada pantalla por rol sin VM ni credenciales.
// No se incluye en el build de producción (main.jsx lo importa solo si `import.meta.env.DEV`).
// Uso: http://localhost:5173/?mock            -> pantalla de acceso; entra con cualquier usuario de la lista y cualquier clave
//      http://localhost:5173/?mock=fabio.mop  -> ya con la sesión iniciada como esa persona
//      http://localhost:5173/?mock=enrolar    -> alta del segundo factor
// Usuarios: ana.ciudadana beto.ciudadano fabio.mop flor.mop saul.mop carla.mop felix.minsa ines.infra ivan.identidades
//           cata.catalogo sergio.seguridad silvia.secretos aldo.auditor

import matrizEjemplo from './mock-datos/matriz.json'
import bdEjemplo from './mock-datos/base-de-datos.json'
import simuladorEjemplo from './mock-datos/simulador.json'

const DIA = 86400000
const hace = (ms) => new Date(Date.now() - ms).toISOString()

const mem = (id, nombre, rol) => ({ institucion_id: id, institucion: nombre, rol })
const MOP = (rol) => mem(3, 'MOP', rol)

const USUARIOS = {
  'ana.ciudadana': { id: 101, plataforma: 'ninguno', membresias: [] },
  'beto.ciudadano': { id: 102, plataforma: 'ninguno', membresias: [] },
  'fabio.mop': { id: 201, plataforma: 'ninguno', membresias: [MOP('funcionario')] },
  'flor.mop': { id: 202, plataforma: 'ninguno', membresias: [MOP('funcionario')] },
  'saul.mop': { id: 203, plataforma: 'ninguno', membresias: [MOP('supervisor')] },
  'carla.mop': { id: 204, plataforma: 'ninguno', membresias: [MOP('coordinador_institucional')] },
  'felix.minsa': { id: 205, plataforma: 'ninguno', membresias: [mem(2, 'MINSA', 'funcionario')] },
  'ines.infra': { id: 301, plataforma: 'operador_infraestructura', membresias: [] },
  'ivan.identidades': { id: 302, plataforma: 'operador_identidades', membresias: [] },
  'cata.catalogo': { id: 303, plataforma: 'operador_catalogo', membresias: [] },
  'sergio.seguridad': { id: 304, plataforma: 'operador_seguridad', membresias: [] },
  'silvia.secretos': { id: 305, plataforma: 'custodio_secretos', membresias: [] },
  'aldo.auditor': { id: 306, plataforma: 'auditor', membresias: [] },
}
const NOMBRES = Object.fromEntries(Object.entries(USUARIOS).map(([n, u]) => [u.id, n]))

const MODULOS = {
  mis_tramites: ['Mis trámites', 'Consulta el estado y el historial de los trámites que iniciaste.', 'disponible'],
  nuevo_tramite: ['Iniciar un trámite', 'Elige una institución y un trámite del catálogo.', 'disponible'],
  bandeja: ['Bandeja de la institución', 'Trámites de tu institución: revisarlos y cambiar su estado.', 'disponible'],
  supervision: ['Supervisión', 'Reasigna trámites y atiende los escalados de tu institución.', 'disponible'],
  equipo: ['Equipo de la institución', 'Personal y roles de tu institución.', 'disponible'],
  seguridad: ['Mi seguridad', 'Tu rol, tus instituciones, tu segundo factor y lo que Zero Trust te permite.', 'disponible'],
  mfa: ['Segundo factor (MFA)', 'Cómo se protege tu cuenta con un código que cambia cada 30 segundos, y tu actividad reciente.', 'disponible'],
  roles_permisos: ['Roles y permisos', 'Quién puede qué en la plataforma, calculado por el propio motor de decisiones, y los permisos de la base de datos.', 'disponible'],
  prueba_acceso: ['Acceso a trámites', 'Comprueba en vivo que tu rol de plataforma no puede ver trámites.', 'disponible'],
  consola_infraestructura: ['Infraestructura', 'Estado de los servidores y contenedores.', 'proximamente'],
  consola_identidades: ['Identidades', 'Alta de coordinadores y restablecimiento del segundo factor (control dual).', 'proximamente'],
  consola_catalogo: ['Catálogo', 'Alta de instituciones y de trámites (control dual).', 'proximamente'],
  consola_seguridad: ['Respuesta a incidentes', 'Bloqueo de cuentas y revocación de sesiones.', 'proximamente'],
  consola_secretos: ['Custodia de secretos', 'Rotación de claves y certificados.', 'proximamente'],
  auditoria: ['Auditoría', 'Consulta del registro inalterable de eventos y de decisiones de acceso.', 'disponible'],
}
const POR_PLATAFORMA = {
  operador_infraestructura: 'consola_infraestructura', operador_identidades: 'consola_identidades', operador_catalogo: 'consola_catalogo',
  operador_seguridad: 'consola_seguridad', custodio_secretos: 'consola_secretos', auditor: 'auditoria',
}

function modulosDe(u) {
  let ids
  if (u.plataforma !== 'ninguno') ids = [POR_PLATAFORMA[u.plataforma], 'prueba_acceso', 'seguridad', 'mfa', 'roles_permisos']
  else {
    const roles = u.membresias.map((m) => m.rol)
    ids = ['mis_tramites', 'nuevo_tramite']
    if (roles.some((r) => r === 'funcionario' || r === 'supervisor')) ids.push('bandeja')
    if (roles.includes('supervisor')) ids.push('supervision')
    if (roles.some((r) => r === 'supervisor' || r === 'coordinador_institucional')) ids.push('equipo')
    ids.push('seguridad', 'mfa', 'roles_permisos')
  }
  return ids.map((id) => ({ id, nombre: MODULOS[id][0], descripcion: MODULOS[id][1], estado: MODULOS[id][2] }))
}

const INSTITUCIONES = [
  { id: 1, nombre: 'Alcaldía (Municipio de Panamá)', tipo: 'real' }, { id: 2, nombre: 'MINSA', tipo: 'demostracion' },
  { id: 3, nombre: 'MOP', tipo: 'demostracion' }, { id: 4, nombre: 'MiAmbiente', tipo: 'demostracion' },
  { id: 5, nombre: 'Ministerio Público / 311', tipo: 'real' }, { id: 6, nombre: 'AMPYME', tipo: 'real' },
]
const TIPOS = [
  { id: 1, nombre: 'Permiso de construcción', sla_dias: 15, institucion: { id: 1, nombre: 'Alcaldía (Municipio de Panamá)' } },
  { id: 2, nombre: 'Certificado de salud ocupacional', sla_dias: 10, institucion: { id: 2, nombre: 'MINSA' } },
  { id: 3, nombre: 'Permiso de uso de vía pública', sla_dias: 10, institucion: { id: 3, nombre: 'MOP' } },
  { id: 4, nombre: 'Estudio de impacto ambiental', sla_dias: 10, institucion: { id: 4, nombre: 'MiAmbiente' } },
  { id: 5, nombre: 'Denuncia ciudadana 311', sla_dias: 5, institucion: { id: 5, nombre: 'Ministerio Público / 311' } },
  { id: 6, nombre: 'Registro de microempresa', sla_dias: 10, institucion: { id: 6, nombre: 'AMPYME' } },
]

let siguiente = 40
const T = (id, tipo, estado, solicitante, asignado, creadoDias, sla, extra = {}) => {
  const t = TIPOS[tipo - 1]
  const creado = Date.now() - creadoDias * DIA
  const limite = creado + sla * DIA
  return { id, tipo_tramite: { id: t.id, nombre: t.nombre }, institucion: t.institucion, estado, fecha_limite: new Date(limite).toISOString(),
    vencido: !['Aprobado', 'Rechazado'].includes(estado) && limite < Date.now(), creado_en: new Date(creado).toISOString(),
    solicitante_id: solicitante, funcionario_asignado_id: asignado, sensibilidad: 2, ...extra }
}
const TRAMITES_BASE = [
  T(35, 3, 'Aprobado', 101, 201, 9, 10), T(36, 2, 'En Tramitacion', 101, 205, 3, 10), T(37, 3, 'En Subsanacion', 102, 202, 8, 10),
  T(38, 3, 'Pendiente', 102, null, 1, 10), T(39, 1, 'Pendiente', 101, null, 2, 15), T(41, 3, 'En Tramitacion', 102, 201, 12, 10),
  T(42, 3, 'Pendiente', 101, null, 7, 10), T(43, 3, 'Rechazado', 102, 203, 14, 10), T(44, 3, 'En Tramitacion', 101, 202, 4, 10),
]
const EVENTOS_BASE = {}
const ev = (id, tramite, accion, de, a, actor, hacia) => ({ id, accion, estado_anterior: de, estado_nuevo: a, institucion_id: 3, creado_en: hace(hacia), actor_id: actor, atributos: {} })
TRAMITES_BASE.forEach((t, i) => {
  const lista = [ev(i * 10 + 1, t.id, 'creacion', null, 'Pendiente', t.solicitante_id, (i + 6) * 3600000 * 5)]
  if (t.estado !== 'Pendiente') lista.push(ev(i * 10 + 2, t.id, 'cambio_estado', 'Pendiente', 'En Tramitacion', t.funcionario_asignado_id || 201, (i + 3) * 3600000 * 4))
  if (t.estado === 'En Subsanacion') lista.push(ev(i * 10 + 3, t.id, 'cambio_estado', 'En Tramitacion', 'En Subsanacion', 202, 3600000 * 9))
  if (t.estado === 'Aprobado' || t.estado === 'Rechazado') lista.push(ev(i * 10 + 3, t.id, 'cambio_estado', 'En Tramitacion', t.estado, 203, 3600000 * 6))
  EVENTOS_BASE[t.id] = lista
})

const visibles = (u, t) => t.solicitante_id === u.id || u.membresias.some((m) => m.institucion_id === t.institucion.id && ['funcionario', 'supervisor'].includes(m.rol))
const esPersonal = (u, t) => u.membresias.some((m) => m.institucion_id === t.institucion.id && ['funcionario', 'supervisor'].includes(m.rol))
const paraCiudadania = (t) => { const { solicitante_id: _s, funcionario_asignado_id, sensibilidad: _n, ...resto } = t; return { ...resto, asignado: funcionario_asignado_id !== null } }
const dto = (u, t) => (esPersonal(u, t) ? t : paraCiudadania(t))

// ---- auditoría
const POLITICAS = [['ciudadano_sobre_lo_propio', true, 14], ['personal_ve_su_institucion', true, 22], ['funcionario_cambia_estado', true, 9], ['supervisor_reasigna_o_atiende_escalados', true, 4],
  ['conflicto_de_interes', false, 5], ['plataforma_sin_acceso_a_tramites', false, 11], ['sin_regla_que_permita', false, 7], ['ciudadano_crea_su_tramite', true, 6], ['auditor_consulta', true, 8]]
const ACCIONES = ['ver_tramite', 'crear_tramite', 'cambiar_estado', 'reasignar_tramite', 'consultar_decisiones']
const DECISIONES = []
{
  let id = 1
  for (const [politica, permitido, n] of POLITICAS) for (let i = 0; i < n; i++) {
    const nombres = Object.keys(USUARIOS)
    const nombre = nombres[(id * 7) % nombres.length]
    DECISIONES.push({ id: id++, creado_en: hace(((id * 53) % 1400) * 60000), actor: { id: USUARIOS[nombre].id, usuario: nombre }, accion: ACCIONES[id % ACCIONES.length],
      recurso: politica === 'auditor_consulta' ? 'auditoria' : 'tramite', permitido, politica, motivo: permitido ? null : 'ninguna política permite la acción', institucion_id: 3 })
  }
  DECISIONES.sort((a, b) => b.id - a.id)
}
const SEGURIDAD = Array.from({ length: 34 }, (_, i) => {
  const eventos = ['login_ok', 'login_ok', 'refresh_ok', 'login_fallido', 'mfa_verificado', 'logout', 'refresh_ok', 'cuenta_bloqueada']
  const nombre = Object.keys(USUARIOS)[(i * 5) % 13]
  return { id: 34 - i, creado_en: hace(i * 47 * 60000), evento: eventos[i % eventos.length], ip: `192.168.100.${10 + (i % 6)}`, actor: i % 7 === 3 ? null : { id: USUARIOS[nombre].id, usuario: nombre }, detalle: {} }
})
const ACTUACIONES = Object.values(EVENTOS_BASE).flat().sort((a, b) => b.id - a.id).map((e) => ({ ...e, tramite_id: Object.keys(EVENTOS_BASE).find((k) => EVENTOS_BASE[k].includes(e)) * 1, actor: e.actor_id ? { id: e.actor_id, usuario: NOMBRES[e.actor_id] } : null }))

function paginar(lista, p) {
  const limite = Number(p.get('limite') || 20)
  const desde = Number(p.get('desplazamiento') || 0)
  return { total: lista.length, limite, desplazamiento: desde, resultados: lista.slice(desde, desde + limite) }
}

export function instalarMock(inicial, opciones = {}) {
  // Cada instalación parte del mismo estado: lo que se cambie en una sesión de ejemplo no contamina la siguiente
  const TRAMITES = structuredClone(TRAMITES_BASE)
  const EVENTOS = structuredClone(EVENTOS_BASE)
  let actual = USUARIOS[inicial] ? inicial : null
  let enrolando = inicial === 'enrolar'
  let mfaFresco = false
  let ultimoCodigo = null // un código ya usado no se acepta otra vez, como en el servidor
  const demora = (ms = opciones.demora ?? 140) => new Promise((r) => setTimeout(r, ms))
  const resp = (estado, cuerpo) => new Response(cuerpo === null ? null : JSON.stringify(cuerpo), { status: estado, headers: { 'Content-Type': 'application/json' } })
  const yo = () => {
    if (enrolando) return { id: 999, usuario: 'nuevo.usuario', scope: 'enrolar_mfa', rol_plataforma: 'ninguno', membresias: [], modulos: [], mfa_activo: false, mfa_obligatorio: true, mfa_verificado_en: null, nivel_aseguramiento: 1 }
    const u = USUARIOS[actual]
    return { id: u.id, usuario: actual, scope: 'completo', rol_plataforma: u.plataforma, membresias: u.membresias, modulos: modulosDe(u), mfa_activo: true, mfa_ventana_minutos: 15, mfa_obligatorio: true,
      mfa_verificado_en: hace(mfaFresco ? 2 * 60000 : 9 * 60000), nivel_aseguramiento: u.plataforma === 'auditor' ? 3 : 2 }
  }

  window.fetch = async (ruta, opciones = {}) => {
    const url = new URL(typeof ruta === 'string' ? ruta : ruta.url, location.origin)
    const p = url.searchParams
    const metodo = (opciones.method || 'GET').toUpperCase()
    const cuerpo = opciones.body ? JSON.parse(opciones.body) : {}
    const camino = url.pathname
    await demora()
    if (camino === '/auth/refresh/') return actual || enrolando ? resp(200, { access_token: 'mock', scope: enrolando ? 'enrolar_mfa' : 'completo' }) : resp(401, { codigo: 'sesion_invalida' })
    if (camino === '/auth/login/') {
      const nombre = (cuerpo.username || '').trim().toLowerCase()
      if (nombre === 'nuevo.usuario') { enrolando = true; return resp(200, { access_token: 'mock', scope: 'enrolar_mfa' }) }
      if (!USUARIOS[nombre]) return resp(401, { codigo: 'credenciales_invalidas' })
      if (!cuerpo.codigo) return resp(401, { codigo: 'mfa_requerido' })
      actual = nombre
      mfaFresco = true
      return resp(200, { access_token: 'mock', scope: 'completo' })
    }
    if (camino === '/auth/registro/') return resp(201, { detalle: 'Cuenta creada.' })
    if (camino === '/auth/logout/') { actual = null; enrolando = false; return resp(200, { detalle: 'Sesión cerrada.' }) }
    if (camino === '/auth/yo/') return resp(200, yo())
    if (camino === '/auth/mfa/enrolar/') return resp(201, { secreto: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP', uri: 'otpauth://totp/SIGET:nuevo.usuario?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=SIGET' })
    if (camino === '/auth/mfa/confirmar/') { enrolando = false; actual = 'ana.ciudadana'; mfaFresco = true; return resp(200, { access_token: 'mock', scope: 'completo' }) }
    if (camino === '/auth/mfa/verificar/') { if (cuerpo.codigo === '000000' || cuerpo.codigo === ultimoCodigo) return resp(400, { codigo: 'mfa_invalido' }); ultimoCodigo = cuerpo.codigo; mfaFresco = true; return resp(200, { detalle: 'Segundo factor verificado.' }) }
    if (!actual) return resp(401, { codigo: 'no_autenticado' })
    const u = USUARIOS[actual]
    const negado = () => resp(403, { codigo: 'acceso_denegado', detalle: 'No tienes autorización para esta operación.', reautenticacion_sugerida: false })
    const pideCodigo = () => resp(403, { codigo: 'acceso_denegado', detalle: 'No tienes autorización para esta operación.', reautenticacion_sugerida: true })

    if (camino === '/politicas/matriz/') return resp(200, matrizEjemplo)
    if (camino === '/politicas/base-de-datos/') return resp(200, bdEjemplo)
    if (camino === '/politicas/simular/') {
      if (metodo === 'GET') return resp(200, simuladorEjemplo.meta)
      // Solo responde a los escenarios capturados de la plataforma real; para lo demás avisa que es un ejemplo
      const clave = (e) => JSON.stringify(Object.entries(e).sort())
      const caso = simuladorEjemplo.casos.find((c) => clave(c.entrada) === clave(cuerpo))
      if (caso) return resp(200, caso.respuesta)
      return resp(200, { entrada: cuerpo, decision: { permitido: false, politica: 'sin_regla_que_permita', motivo: 'ejemplo' }, traza: [], alternativas: [], hipotetico: true, ejemplo: true })
    }
    if (camino === '/auth/actividad/') {
      const eventos = [['mfa_verificado', 9], ['login_ok', 9], ['refresh_ok', 40], ['login_fallido', 300], ['login_ok', 1500], ['logout', 1620]]
      return resp(200, { eventos: eventos.map(([evento, min], i) => ({ id: 100 - i, evento, creado_en: hace(min * 60000), ip: '192.168.100.10' })) })
    }
    if (camino === '/catalogo/instituciones/') return resp(200, INSTITUCIONES)
    if (camino === '/catalogo/tipos-tramite/') return resp(200, TIPOS.filter((t) => !p.get('institucion') || String(t.institucion.id) === p.get('institucion')))
    if (camino === '/equipo/') {
      const mias = u.membresias.filter((m) => ['supervisor', 'coordinador_institucional'].includes(m.rol))
      if (!mias.length) return negado()
      return resp(200, { equipos: mias.map((m) => ({ institucion: { id: m.institucion_id, nombre: m.institucion }, personal: Object.entries(USUARIOS).filter(([, x]) => x.membresias.some((y) => y.institucion_id === m.institucion_id)).map(([nombre, x]) => ({ usuario_id: x.id, usuario: nombre, rol: x.membresias.find((y) => y.institucion_id === m.institucion_id).rol })) })) })
    }
    if (camino === '/tramites/' && metodo === 'GET') {
      if (u.plataforma !== 'ninguno') return negado()
      return resp(200, { resultados: TRAMITES.filter((t) => visibles(u, t)).sort((a, b) => b.id - a.id).map((t) => dto(u, t)), limite: 100, desplazamiento: 0 })
    }
    if (camino === '/tramites/' && metodo === 'POST') {
      const tipo = TIPOS.find((t) => t.id === cuerpo.tipo_tramite)
      if (!tipo) return resp(404, { codigo: 'tipo_tramite_inexistente' })
      const t = T(siguiente++, tipo.id, 'Pendiente', u.id, null, 0, tipo.sla_dias)
      TRAMITES.push(t)
      EVENTOS[t.id] = [ev(Date.now(), t.id, 'creacion', null, 'Pendiente', u.id, 1000)]
      return resp(201, dto(u, t))
    }
    const m = camino.match(/^\/tramites\/(\d+)\/(estado\/|reasignar\/|historial\/)?$/)
    if (m) {
      const t = TRAMITES.find((x) => x.id === Number(m[1]))
      if (!t || !visibles(u, t)) return resp(404, { detalle: 'No encontrado.' })
      const sub = m[2]
      if (!sub) return resp(200, dto(u, t))
      if (sub === 'historial/') return resp(200, { tramite: t.id, eventos: EVENTOS[t.id].map((e) => (esPersonal(u, t) ? e : { id: e.id, accion: e.accion, estado_anterior: e.estado_anterior, estado_nuevo: e.estado_nuevo, institucion_id: e.institucion_id, creado_en: e.creado_en })) })
      if (!esPersonal(u, t) || t.solicitante_id === u.id) return negado()
      if (!mfaFresco) return pideCodigo()
      if (sub === 'estado/') {
        const antes = t.estado
        t.estado = cuerpo.estado
        t.vencido = false
        EVENTOS[t.id].push(ev(Date.now(), t.id, 'cambio_estado', antes, t.estado, u.id, 500))
        return resp(200, dto(u, t))
      }
      if (!u.membresias.some((x) => x.rol === 'supervisor')) return negado()
      const de = t.funcionario_asignado_id
      t.funcionario_asignado_id = cuerpo.funcionario_id
      EVENTOS[t.id].push({ ...ev(Date.now(), t.id, 'reasignacion', t.estado, t.estado, u.id, 400), atributos: { de, a: cuerpo.funcionario_id } })
      return resp(200, dto(u, t))
    }
    if (camino.startsWith('/auditoria/')) {
      if (u.plataforma !== 'auditor') return negado()
      if (!mfaFresco) return pideCodigo()
      if (camino === '/auditoria/resumen/') {
        const por = {}
        DECISIONES.forEach((d) => { const f = (por[d.politica] ||= { politica: d.politica, permitidas: 0, negadas: 0 }); f[d.permitido ? 'permitidas' : 'negadas'] += 1 })
        const negadas = DECISIONES.filter((d) => !d.permitido)
        const conteo = {}
        negadas.forEach((d) => { conteo[d.actor.usuario] = (conteo[d.actor.usuario] || 0) + 1 })
        return resp(200, {
          decisiones: { total: DECISIONES.length, permitidas: DECISIONES.length - negadas.length, negadas: negadas.length, ultimas_24h: DECISIONES.length, negadas_24h: negadas.length },
          por_politica: Object.values(por).sort((a, b) => b.negadas - a.negadas || (b.permitidas + b.negadas) - (a.permitidas + a.negadas)),
          denegaciones_por_persona: Object.entries(conteo).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([usuario, total]) => ({ id: USUARIOS[usuario].id, usuario, total })),
          seguridad: [['login_ok', 14], ['refresh_ok', 9], ['login_fallido', 5], ['mfa_verificado', 4], ['logout', 3], ['cuenta_bloqueada', 1]].map(([evento, total]) => ({ evento, total })),
          tramites: [{ accion: 'cambio_estado', total: 14 }, { accion: 'creacion', total: 9 }, { accion: 'reasignacion', total: 2 }],
        })
      }
      if (camino === '/auditoria/decisiones/') {
        let l = DECISIONES
        if (p.get('resultado')) l = l.filter((d) => d.permitido === (p.get('resultado') === 'permitidas'))
        if (p.get('politica')) l = l.filter((d) => d.politica === p.get('politica'))
        return resp(200, paginar(l, p))
      }
      if (camino === '/auditoria/seguridad/') return resp(200, paginar(p.get('evento') ? SEGURIDAD.filter((e) => e.evento === p.get('evento')) : SEGURIDAD, p))
      if (camino === '/auditoria/tramites/') return resp(200, paginar(p.get('accion') ? ACTUACIONES.filter((e) => e.accion === p.get('accion')) : ACTUACIONES, p))
    }
    return resp(404, { detalle: 'No encontrado.' })
  }
}
