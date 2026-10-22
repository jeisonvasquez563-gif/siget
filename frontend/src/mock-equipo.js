// Simulador (solo desarrollo y pruebas) de la gestión del equipo de una institución, con estado en memoria. Respeta las reglas del
// servidor real: solo la coordinación de esa institución gestiona, nadie cambia su propio acceso, no se gestionan coordinaciones y no
// se quita a quien tiene trámites abiertos asignados.
const PERSONAL = ['funcionario', 'supervisor', 'coordinador_institucional']
const GESTIONABLES = ['funcionario', 'supervisor']
const FINALES = ['Aprobado', 'Rechazado']

export function equipoMock({ usuarios, actual, resp, negado, tramites }) {
  const altas = []
  const bajas = []

  const miembrosDe = (institucionId) => {
    const lista = []
    for (const [usuario, u] of Object.entries(usuarios)) {
      for (const m of u.membresias) {
        const baja = bajas.some((b) => b.usuario_id === u.id && b.institucion_id === institucionId && b.rol === m.rol)
        if (m.institucion_id === institucionId && PERSONAL.includes(m.rol) && !baja) lista.push({ usuario_id: u.id, usuario, rol: m.rol })
      }
    }
    for (const a of altas) if (a.institucion_id === institucionId) lista.push({ usuario_id: a.usuario_id, usuario: a.usuario, rol: a.rol })
    return lista
  }
  // Retirar a alguien: si se agregó en esta sesión se descarta el alta; si viene de la base de ejemplo, se anota la baja
  const retirar = (usuarioId, institucionId, rol) => {
    const i = altas.findIndex((a) => a.usuario_id === usuarioId && a.institucion_id === institucionId && a.rol === rol)
    if (i >= 0) altas.splice(i, 1)
    else bajas.push({ usuario_id: usuarioId, institucion_id: institucionId, rol })
  }
  const coordina = (u, institucionId) => u.membresias.some((m) => m.institucion_id === institucionId && m.rol === 'coordinador_institucional')

  return {
    listar(u) {
      const mias = u.membresias.filter((m) => ['supervisor', 'coordinador_institucional'].includes(m.rol))
      if (!mias.length) return negado()
      const vistas = new Set()
      return resp(200, {
        equipos: mias.filter((m) => !vistas.has(m.institucion_id) && vistas.add(m.institucion_id)).map((m) => {
          const puede = coordina(u, m.institucion_id)
          return {
            institucion: { id: m.institucion_id, nombre: m.institucion }, puede_gestionar: puede,
            personal: miembrosDe(m.institucion_id).map((p) => ({ ...p, gestionable: puede && GESTIONABLES.includes(p.rol) && p.usuario_id !== u.id })),
          }
        }),
      })
    },

    manejar(camino, metodo, cuerpo) {
      const ruta = camino.match(/^\/equipo\/(\d+)\/miembros\/(?:(\d+)\/(cambiar-rol|quitar)\/)?$/)
      if (!ruta || metodo !== 'POST') return null
      const institucionId = Number(ruta[1])
      const u = usuarios[actual()]
      if (!coordina(u, institucionId)) return negado()
      const conflicto = (codigo, detalle, extra = {}) => resp(409, { codigo, detalle, ...extra })

      if (!ruta[2]) { // agregar
        const nombre = (cuerpo.usuario || '').trim().toLowerCase()
        const persona = usuarios[nombre]
        const errores = []
        if (!GESTIONABLES.includes(cuerpo.rol)) errores.push('el rol debe ser «funcionario» o «supervisor»')
        else if (!persona) errores.push('no existe esa persona')
        else if (persona.id === u.id) return conflicto('no_a_si_mismo', 'No puedes cambiar tu propio acceso.')
        else if (persona.plataforma !== 'ninguno') errores.push('una cuenta de plataforma no puede ser personal de una institución')
        else if (miembrosDe(institucionId).some((p) => p.usuario_id === persona.id && p.rol === cuerpo.rol)) errores.push(`ya es ${cuerpo.rol} de esta institución`)
        if (errores.length) return resp(400, { codigo: 'datos_invalidos', errores })
        altas.push({ usuario_id: persona.id, usuario: nombre, institucion_id: institucionId, rol: cuerpo.rol })
        return resp(201, { codigo: 'miembro_agregado' })
      }

      const personaId = Number(ruta[2])
      if (personaId === u.id) return conflicto('no_a_si_mismo', 'No puedes cambiar tu propio acceso.')
      const suyos = miembrosDe(institucionId).filter((p) => p.usuario_id === personaId && GESTIONABLES.includes(p.rol))
      if (ruta[3] === 'cambiar-rol') {
        if (!GESTIONABLES.includes(cuerpo.rol)) return resp(400, { codigo: 'datos_invalidos', errores: ['el rol debe ser «funcionario» o «supervisor»'] })
        const viejo = suyos.find((p) => p.rol !== cuerpo.rol)
        if (!viejo) return conflicto('no_corresponde', 'Esa persona no es personal de esta institución con ese rol.')
        retirar(personaId, institucionId, viejo.rol)
        altas.push({ usuario_id: personaId, usuario: viejo.usuario, institucion_id: institucionId, rol: cuerpo.rol })
        return resp(200, { codigo: 'rol_cambiado' })
      }
      if (!suyos.length) return conflicto('no_corresponde', 'Esa persona no es personal de esta institución con ese rol.')
      const abiertos = tramites().filter((t) => t.funcionario_asignado_id === personaId && t.institucion.id === institucionId && !FINALES.includes(t.estado)).length
      if (abiertos) return conflicto('tiene_tramites_abiertos', 'Esa persona aún tiene trámites abiertos asignados. Pídele a supervisión que los reasigne y vuelve a intentarlo.', { tramites_abiertos: abiertos })
      suyos.forEach((p) => retirar(personaId, institucionId, p.rol))
      return resp(200, { codigo: 'miembro_quitado' })
    },
  }
}
