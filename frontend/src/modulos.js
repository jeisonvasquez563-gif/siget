// Cómo se agrupan y dibujan los módulos que devuelve el servidor (/auth/yo/). Es solo presentación: el servidor decide qué módulos hay.
export const ICONO_MODULO = {
  mis_tramites: 'documento', nuevo_tramite: 'mas', bandeja: 'bandeja', supervision: 'supervision', equipo: 'equipo',
  seguridad: 'escudo', prueba_acceso: 'candado', auditoria: 'auditoria',
}

export const iconoDe = (id) => ICONO_MODULO[id] || 'consola'

export const GRUPOS = [
  { titulo: 'Mi espacio', ids: ['mis_tramites', 'nuevo_tramite'] },
  { titulo: 'Mi institución', ids: ['bandeja', 'supervision', 'equipo'] },
  { titulo: 'Plataforma', ids: [], resto: true },
  { titulo: 'Cuenta', ids: ['seguridad'] },
]

// Reparte los módulos recibidos en los grupos del menú; lo que no está en un grupo fijo va a «Plataforma».
export function agrupar(modulos) {
  const fijos = new Set(GRUPOS.flatMap((g) => g.ids))
  return GRUPOS.map((g) => ({
    titulo: g.titulo,
    modulos: g.resto ? modulos.filter((m) => !fijos.has(m.id)) : g.ids.map((id) => modulos.find((m) => m.id === id)).filter(Boolean),
  })).filter((g) => g.modulos.length)
}
