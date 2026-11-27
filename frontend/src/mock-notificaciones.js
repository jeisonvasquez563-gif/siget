// Simulador (solo desarrollo y pruebas) de las notificaciones, con estado en memoria. Respeta las reglas del servidor real (migración 018):
// cada persona ve y marca solo las suyas (lo ajeno es 404), una ya leída no se vuelve a marcar y las genera el cambio del trámite:
//  - al solicitante: Pendiente -> En Tramitacion, -> En Subsanacion, -> Aprobado y -> Rechazado;
//  - al funcionario asignado, cuando QUIEN ACTUALIZA ES EL SOLICITANTE y cierra la subsanación (si cierra el personal, no) o desiste del trámite (migración 021);
//  - a la supervisión, cuando se escala un trámite (aquí, las de partida: el temporizador no corre en el simulador).
// Nunca se notifica al propio actor. No lleva texto: la interfaz lo arma según el tipo.

// Las de partida, coherentes con los trámites de ejemplo de mock.js: [id, persona, tipo, trámite, hace (horas), leída]
const BASE = [
  [1, 101, 'tramite_aprobado', 35, 2, false],
  [2, 101, 'tramite_en_atencion', 36, 72, false],
  [3, 101, 'tramite_en_atencion', 44, 96, true],
  [4, 102, 'subsanacion_pedida', 37, 8, false],
  [5, 102, 'tramite_rechazado', 43, 240, true],
  [6, 201, 'subsanacion_respondida', 41, 5, false],
  [7, 203, 'tramite_escalado', 41, 47, false],
]
const HORA = 3600000

export function notificacionesMock({ tramites, visibles, resp, paginar, paginacionValida }) {
  const filas = BASE.map(([id, usuario, tipo, tramite, horas, leida]) => ({
    id, usuario_id: usuario, tipo, tramite_id: tramite, creada_en: new Date(Date.now() - horas * HORA).toISOString(),
    leida_en: leida ? new Date(Date.now() - (horas - 1) * HORA).toISOString() : null,
  }))
  let siguiente = 100

  const agregar = (usuarioId, tipo, tramiteId) => {
    filas.push({ id: siguiente++, usuario_id: usuarioId, tipo, tramite_id: tramiteId, creada_en: new Date().toISOString(), leida_en: null })
  }
  const propias = (u) => filas.filter((n) => n.usuario_id === u.id).sort((a, b) => (a.creada_en < b.creada_en ? 1 : a.creada_en > b.creada_en ? -1 : b.id - a.id))
  const noLeidas = (u) => propias(u).filter((n) => n.leida_en === null).length
  // Solo lo que la persona ya ve del trámite (lo decide la «base»: aquí, `visibles`); si no lo ve, `tramite` es null
  const dto = (u, n) => {
    const t = tramites().find((x) => x.id === n.tramite_id)
    return {
      id: n.id, tipo: n.tipo, tramite_id: n.tramite_id,
      tramite: t && visibles(u, t) ? { tipo_tramite: t.tipo_tramite.nombre, institucion: t.institucion.nombre } : null,
      creada_en: n.creada_en, leida: n.leida_en !== null,
    }
  }

  return {
    // Lo que hace el disparador de la base al cambiar un trámite. `antes` es el estado anterior y `actorId` quien lo cambia.
    avisar(t, antes, actorId) {
      const tipo = antes === 'Pendiente' && t.estado === 'En Tramitacion' ? 'tramite_en_atencion'
        : t.estado === 'En Subsanacion' ? 'subsanacion_pedida'
          : t.estado === 'Aprobado' ? 'tramite_aprobado'
            : t.estado === 'Rechazado' ? 'tramite_rechazado' : null
      if (tipo && t.solicitante_id !== actorId) agregar(t.solicitante_id, tipo, t.id)
      if (antes === 'En Subsanacion' && t.estado === 'En Tramitacion' && actorId === t.solicitante_id
          && t.funcionario_asignado_id !== null && t.funcionario_asignado_id !== actorId) agregar(t.funcionario_asignado_id, 'subsanacion_respondida', t.id)
      // Al desistir la persona solicitante se avisa a quien atendía el trámite (a ella no: es quien actúa)
      if (t.estado === 'Desistido' && actorId === t.solicitante_id && t.funcionario_asignado_id !== null && t.funcionario_asignado_id !== actorId) agregar(t.funcionario_asignado_id, 'tramite_desistido', t.id)
    },
    manejar(u, camino, metodo, p) {
      if (camino === '/notificaciones/' && metodo === 'GET') {
        if (!paginacionValida(p)) return resp(400, { codigo: 'paginacion_invalida', detalle: 'limite (1 a 100) y desplazamiento deben ser enteros válidos.' })
        const solo = p.get('solo_no_leidas')
        if (solo !== null && solo !== '1') return resp(400, { codigo: 'filtro_invalido', detalle: '`solo_no_leidas` solo admite el valor 1.' })
        const lista = propias(u).filter((n) => solo === null || n.leida_en === null).map((n) => dto(u, n))
        return resp(200, { ...paginar(lista, p), no_leidas: noLeidas(u) })
      }
      if (camino === '/notificaciones/leer-todas/' && metodo === 'POST') {
        const pendientes = propias(u).filter((n) => n.leida_en === null)
        pendientes.forEach((n) => { n.leida_en = new Date().toISOString() })
        return resp(200, { marcadas: pendientes.length, no_leidas: 0 })
      }
      const una = camino.match(/^\/notificaciones\/(\d+)\/leida\/$/)
      if (una && metodo === 'POST') {
        const n = propias(u).find((x) => x.id === Number(una[1]))
        if (!n) return resp(404, { detalle: 'No encontrado.' })
        if (n.leida_en === null) n.leida_en = new Date().toISOString()
        return resp(200, { id: n.id, leida: true, no_leidas: noLeidas(u) })
      }
      return null
    },
  }
}
