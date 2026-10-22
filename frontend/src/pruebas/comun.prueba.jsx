import { describe, expect, it } from 'vitest'
import { ApiError } from '../api.js'
import { ESTADOS, FINALES, ROLES_PLATAFORMA, SIGUIENTES, etiquetaDeRol, hace, mensajeDe, plazoDe } from '../comun.jsx'
import { agrupar, iconoDe } from '../modulos.js'

const DIA = 86400000
const tramite = (creadoHaceDias, plazoDias, estado = 'Pendiente', vencido = false) => ({
  estado, vencido,
  creado_en: new Date(Date.now() - creadoHaceDias * DIA).toISOString(),
  fecha_limite: new Date(Date.now() - creadoHaceDias * DIA + plazoDias * DIA).toISOString(),
})

describe('plazos', () => {
  it('un trámite recién iniciado tiene el plazo casi intacto', () => {
    const p = plazoDe(tramite(0.1, 10))
    expect(p.clase).toBe('')
    expect(p.valor).toBeLessThan(0.1)
    expect(p.texto).toMatch(/días para el límite/)
  })

  it('pide atención cuando ya pasó el 75 % del plazo', () => {
    expect(plazoDe(tramite(8, 10)).clase).toBe('atencion')
  })

  it('marca como vencido lo que el servidor declara vencido', () => {
    const p = plazoDe(tramite(12, 10, 'En Tramitacion', true))
    expect(p.clase).toBe('vencido')
    expect(p.texto).toMatch(/Venció hace 2 días/)
    expect(p.valor).toBe(1)
  })

  it('un trámite resuelto ya no corre contra el reloj', () => {
    for (const estado of FINALES) expect(plazoDe(tramite(30, 10, estado, true))).toMatchObject({ texto: 'Resuelto', clase: '' })
  })

  it('el progreso nunca sale del rango 0 a 1', () => {
    expect(plazoDe(tramite(-5, 10)).valor).toBe(0)
    expect(plazoDe(tramite(50, 10)).valor).toBeLessThanOrEqual(1)
  })
})

describe('estados', () => {
  it('cada estado tiene texto y clase propios', () => {
    for (const e of Object.keys(SIGUIENTES)) expect(ESTADOS[e].texto && ESTADOS[e].clase).toBeTruthy()
  })

  it('las transiciones de ayuda coinciden con el contrato del servidor (docs/api.md)', () => {
    expect(SIGUIENTES).toEqual({
      Pendiente: ['En Tramitacion'],
      'En Tramitacion': ['En Subsanacion', 'Aprobado', 'Rechazado'],
      'En Subsanacion': ['En Tramitacion'],
      Aprobado: [],
      Rechazado: [],
    })
  })

  it('los estados finales no tienen salida', () => {
    for (const f of FINALES) expect(SIGUIENTES[f]).toEqual([])
  })
})

describe('textos', () => {
  it('hace() habla en lenguaje natural', () => {
    expect(hace(new Date().toISOString())).toBe('ahora mismo')
    expect(hace(new Date(Date.now() - 5 * 60000).toISOString())).toBe('hace 5 min')
    expect(hace(new Date(Date.now() - 3 * 3600000).toISOString())).toBe('hace 3 h')
    expect(hace(new Date(Date.now() - 2 * DIA).toISOString())).toBe('hace 2 d')
    expect(hace(null)).toBe('')
  })

  it('el error 403 explica que quedó registrado y el 404 no distingue entre inexistente y ajeno', () => {
    expect(mensajeDe(new ApiError(403, {}))).toMatch(/quedó registrada/)
    expect(mensajeDe(new ApiError(404, {}))).toMatch(/No existe o no tienes acceso/)
    expect(mensajeDe(new TypeError('red'))).toMatch(/No se pudo conectar/)
  })

  it('etiquetaDeRol resume el rol de plataforma o los roles en instituciones', () => {
    expect(etiquetaDeRol({ rol_plataforma: 'auditor', membresias: [] })).toBe(ROLES_PLATAFORMA.auditor)
    expect(etiquetaDeRol({ rol_plataforma: 'ninguno', membresias: [] })).toBe('Ciudadanía')
    expect(etiquetaDeRol({ rol_plataforma: 'ninguno', membresias: [{ rol: 'supervisor' }, { rol: 'supervisor' }] })).toBe('Supervisor')
  })
})

describe('módulos del menú', () => {
  const modulos = (...ids) => ids.map((id) => ({ id, nombre: id, estado: 'disponible' }))

  it('agrupa en espacio personal, institución, plataforma y cuenta, y descarta los grupos vacíos', () => {
    const grupos = agrupar(modulos('mis_tramites', 'bandeja', 'auditoria', 'seguridad'))
    expect(grupos.map((g) => g.titulo)).toEqual(['Mi espacio', 'Mi institución', 'Plataforma', 'Seguridad y permisos'])
    expect(agrupar(modulos('mis_tramites')).map((g) => g.titulo)).toEqual(['Mi espacio'])
  })

  it('un módulo desconocido va a Plataforma en vez de perderse', () => {
    const grupos = agrupar(modulos('consola_nueva'))
    expect(grupos).toHaveLength(1)
    expect(grupos[0].titulo).toBe('Plataforma')
    expect(iconoDe('consola_nueva')).toBe('consola')
  })
})
