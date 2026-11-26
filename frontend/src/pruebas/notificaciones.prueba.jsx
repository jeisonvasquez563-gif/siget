// Campana de notificaciones (PT-9): la insignia con las no leídas, el panel, marcar como leída y abrir el trámite, la consulta periódica
// (solo con sesión y con la pestaña visible) y la accesibilidad. Se arma la aplicación completa contra el servidor de ejemplo (src/mock.js),
// que imita /notificaciones/ de docs/api.md: cada persona ve solo las suyas y las genera el cambio del trámite.
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App.jsx'
import { api, olvidarToken } from '../api.js'
import { instalarMock } from '../mock.js'
import { notificacionesMock } from '../mock-notificaciones.js'
import { CADA_MS, TEXTOS, textoDe } from '../Notificaciones.jsx'
import { ProveedorUI } from '../ui.jsx'

vi.mock('qrcode', () => ({ default: { toCanvas: vi.fn() } }))
const AXE = { rules: { 'color-contrast': { enabled: false } } }

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

async function abrir(usuario = 'ana.ciudadana') {
  instalarMock(usuario, { demora: 0 })
  const utilidades = render(<ProveedorUI><App /></ProveedorUI>)
  const user = userEvent.setup()
  await screen.findByRole('navigation', { name: 'Módulos' })
  return { ...utilidades, user }
}

const campana = () => screen.getByRole('button', { name: /^Notificaciones/ })
const esperarCuenta = (texto) => screen.findByRole('button', { name: texto })
const panel = () => screen.queryByRole('dialog', { name: 'Notificaciones' })

/** Cuenta las veces que se pidió una ruta (`metodo` GET por defecto), sin cambiar lo que responde el servidor de ejemplo. */
function espiar(ruta = '/notificaciones/') {
  const original = window.fetch
  const espia = vi.fn((...a) => original(...a))
  window.fetch = espia
  return (filtro = ruta) => espia.mock.calls.filter(([r]) => String(r).startsWith(filtro)).length
}

describe('la campana de la barra superior', () => {
  it('dice cuántas notificaciones hay sin leer, en la etiqueta y en la insignia', async () => {
    await abrir('ana.ciudadana')
    const boton = await esperarCuenta('Notificaciones, 2 sin leer')
    expect(within(boton).getByText('2')).toHaveAttribute('aria-hidden', 'true')
  })

  it('cada persona ve solo las suyas', async () => {
    await abrir('beto.ciudadano')
    expect(await esperarCuenta('Notificaciones, 1 sin leer')).toBeInTheDocument()
  })

  it('quien no tiene ninguna sin leer ve la campana sin insignia', async () => {
    await abrir('ines.infra')
    const boton = await esperarCuenta('Notificaciones, 0 sin leer')
    expect(boton.textContent).toBe('')
  })

  it('una cuenta de plataforma tiene la suya, vacía', async () => {
    const { user } = await abrir('ines.infra')
    await esperarCuenta('Notificaciones, 0 sin leer')
    await user.click(campana())
    expect(await screen.findByText('No tienes notificaciones.')).toBeInTheDocument()
  })

  it('con más de 99 muestra «99+» pero la etiqueta lleva la cifra exacta', async () => {
    instalarMock('ana.ciudadana', { demora: 0 })
    const original = window.fetch
    window.fetch = (ruta, ...resto) => (String(ruta).startsWith('/notificaciones/')
      ? Promise.resolve(new Response(JSON.stringify({ resultados: [], total: 0, limite: 10, desplazamiento: 0, no_leidas: 123 }), { status: 200 }))
      : original(ruta, ...resto))
    render(<ProveedorUI><App /></ProveedorUI>)
    const boton = await esperarCuenta('Notificaciones, 123 sin leer')
    expect(within(boton).getByText('99+')).toBeInTheDocument()
  })

  it('si el servidor no responde, la campana sigue ahí sin número y el resto de la aplicación funciona', async () => {
    instalarMock('ana.ciudadana', { demora: 0 })
    const original = window.fetch
    window.fetch = (ruta, ...resto) => (String(ruta).startsWith('/notificaciones/') ? Promise.resolve(new Response('{}', { status: 500 })) : original(ruta, ...resto))
    render(<ProveedorUI><App /></ProveedorUI>)
    await screen.findByRole('navigation', { name: 'Módulos' })
    expect(screen.getByRole('button', { name: 'Notificaciones' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /sin leer/ })).not.toBeInTheDocument()
    expect(screen.getAllByText('Inicio').length).toBeGreaterThan(0)
  })

  it('es accesible (axe), con el panel cerrado y abierto', async () => {
    const { container, user } = await abrir('ana.ciudadana')
    await esperarCuenta('Notificaciones, 2 sin leer')
    expect(await axe(container, AXE)).toHaveNoViolations()
    await user.click(campana())
    await within(await screen.findByRole('dialog', { name: 'Notificaciones' })).findByText(/Aprobaron tu trámite #35/)
    expect(await axe(container, AXE)).toHaveNoViolations()
  })
})

describe('el panel', () => {
  it('lista las últimas en lenguaje llano, con la fecha relativa y qué trámite es', async () => {
    const { user } = await abrir('ana.ciudadana')
    await esperarCuenta('Notificaciones, 2 sin leer')
    await user.click(campana())
    const ventana = await screen.findByRole('dialog', { name: 'Notificaciones' })
    const items = await within(ventana).findAllByRole('button', { name: /trámite #/ })
    expect(items).toHaveLength(3)
    expect(within(ventana).getByText('Aprobaron tu trámite #35')).toBeInTheDocument()
    expect(within(ventana).getByText('Ya están atendiendo tu trámite #36')).toBeInTheDocument()
    expect(within(ventana).getByText(/hace 2 h/)).toBeInTheDocument()
    expect(within(ventana).getAllByText(/· MOP|· MINSA/).length).toBeGreaterThan(0)
  })

  it('las no leídas se anuncian como «Sin leer» y las leídas no', async () => {
    const { user } = await abrir('ana.ciudadana')
    await esperarCuenta('Notificaciones, 2 sin leer')
    await user.click(campana())
    const ventana = await screen.findByRole('dialog', { name: 'Notificaciones' })
    const items = await within(ventana).findAllByRole('button', { name: /trámite #/ })
    expect(items.filter((i) => /^Sin leer\./.test(i.textContent.replace(/^\s+/, '')))).toHaveLength(2)
    expect(within(ventana).getByRole('button', { name: /^Sin leer\. Aprobaron tu trámite #35/ })).toBeInTheDocument()
  })

  it('al abrirlo el foco pasa al panel y Escape lo cierra devolviendo el foco a la campana', async () => {
    const { user } = await abrir('ana.ciudadana')
    await esperarCuenta('Notificaciones, 2 sin leer')
    await user.click(campana())
    const ventana = await screen.findByRole('dialog', { name: 'Notificaciones' })
    expect(ventana).toHaveFocus()
    expect(campana()).toHaveAttribute('aria-expanded', 'true')
    expect(campana()).toHaveAttribute('aria-controls', 'panel-notificaciones')
    await user.keyboard('{Escape}')
    expect(panel()).not.toBeInTheDocument()
    expect(campana()).toHaveFocus()
    expect(campana()).toHaveAttribute('aria-expanded', 'false')
  })

  it('Escape también funciona con el foco dentro de un elemento del panel', async () => {
    const { user } = await abrir('ana.ciudadana')
    await esperarCuenta('Notificaciones, 2 sin leer')
    await user.click(campana())
    await screen.findByRole('dialog', { name: 'Notificaciones' })
    await user.tab()
    await user.keyboard('{Escape}')
    expect(panel()).not.toBeInTheDocument()
    expect(campana()).toHaveFocus()
  })

  it('un clic fuera lo cierra, y la campana lo abre y lo cierra', async () => {
    const { user } = await abrir('ana.ciudadana')
    await esperarCuenta('Notificaciones, 2 sin leer')
    await user.click(campana())
    expect(await screen.findByRole('dialog', { name: 'Notificaciones' })).toBeInTheDocument()
    await user.click(screen.getByRole('main'))
    expect(panel()).not.toBeInTheDocument()
    await user.click(campana())
    expect(await screen.findByRole('dialog', { name: 'Notificaciones' })).toBeInTheDocument()
    await user.click(campana())
    expect(panel()).not.toBeInTheDocument()
  })

  it('al hacer clic en una la marca como leída y abre el trámite', async () => {
    const { user } = await abrir('ana.ciudadana')
    await esperarCuenta('Notificaciones, 2 sin leer')
    await user.click(campana())
    await user.click(await screen.findByRole('button', { name: /Aprobaron tu trámite #35/ }))
    expect(await screen.findByText('Trámite #35', { selector: 'strong' })).toBeInTheDocument()
    expect(panel()).not.toBeInTheDocument()
    expect(await esperarCuenta('Notificaciones, 1 sin leer')).toBeInTheDocument()
    // y en el servidor quedó leída: al volver a abrir el panel ya no figura como pendiente
    await user.click(campana())
    expect(await screen.findByRole('button', { name: /^Aprobaron tu trámite #35/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Sin leer\. Aprobaron tu trámite #35/ })).not.toBeInTheDocument()
  })

  it('«Marcar todas como leídas» deja la cuenta en cero y se desactiva', async () => {
    const { user } = await abrir('ana.ciudadana')
    await esperarCuenta('Notificaciones, 2 sin leer')
    await user.click(campana())
    const todas = await screen.findByRole('button', { name: 'Marcar todas como leídas' })
    expect(todas).toBeEnabled()
    await user.click(todas)
    expect(await esperarCuenta('Notificaciones, 0 sin leer')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Marcar todas como leídas' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: /^Sin leer\./ })).not.toBeInTheDocument()
    expect(screen.getByRole('status', { name: '' })).toHaveTextContent('Marcaste todas las notificaciones como leídas.')
  })

  it('el personal recibe lo que le corresponde (la respuesta a una subsanación) y la supervisión lo escalado', async () => {
    const { user, unmount } = await abrir('fabio.mop')
    await esperarCuenta('Notificaciones, 1 sin leer')
    await user.click(campana())
    expect(await screen.findByText('La persona respondió la corrección del trámite #41')).toBeInTheDocument()
    unmount()
    olvidarToken()
    const otra = await abrir('saul.mop')
    await esperarCuenta('Notificaciones, 1 sin leer')
    await otra.user.click(campana())
    expect(await screen.findByText('El trámite #41 pasó su plazo y quedó en supervisión')).toBeInTheDocument()
  })

  it('un cambio del trámite genera la notificación para quien corresponde y no para quien actúa', async () => {
    // Beto tiene el trámite 37 en subsanación: al responderlo, el funcionario asignado (flor, id 202) recibe el aviso y beto ninguno nuevo
    const { user } = await abrir('beto.ciudadano')
    await esperarCuenta('Notificaciones, 1 sin leer')
    await user.click(within(screen.getByRole('navigation', { name: 'Módulos' })).getByRole('button', { name: /^Mis trámites/ }))
    await user.click(await screen.findByRole('row', { name: /^Trámite 37:/ }))
    await user.type(await screen.findByRole('textbox', { name: 'Tu respuesta' }), 'Adjunto el croquis firmado de la zona.')
    await user.click(screen.getByRole('button', { name: 'Enviar mi respuesta' }))
    await screen.findByText(/Enviaste tu respuesta/)
    expect(await esperarCuenta('Notificaciones, 1 sin leer')).toBeInTheDocument()   // beto, que fue quien actuó, no recibió nada nuevo
    // El estado del servidor de ejemplo es de esta instalación: se cambia de persona con su propio acceso y se pregunta como ella
    await window.fetch('/auth/login/', { method: 'POST', body: JSON.stringify({ username: 'flor.mop', password: 'x', codigo: '123456' }) })
    const flor = await (await window.fetch('/notificaciones/')).json()
    expect(flor.resultados.filter((n) => n.tipo === 'subsanacion_respondida' && n.tramite_id === 37)).toHaveLength(1)
    expect(flor.no_leidas).toBe(1)
  })
})

describe('la consulta periódica', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] }) })

  const pasar = async (ms) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }
  const visibilidad = (valor) => Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => valor })
  afterEach(() => { delete document.visibilityState })

  it('pregunta cada 60 s mientras la pestaña se ve, y nada si está oculta', async () => {
    instalarMock('ana.ciudadana', { demora: 0 })
    const pedidas = espiar()
    render(<ProveedorUI><App /></ProveedorUI>)
    await screen.findByRole('navigation', { name: 'Módulos' })
    await esperarCuenta('Notificaciones, 2 sin leer')
    const inicial = pedidas()
    expect(inicial).toBeGreaterThanOrEqual(1)
    await pasar(CADA_MS)
    expect(pedidas()).toBe(inicial + 1)
    visibilidad('hidden')
    await pasar(CADA_MS * 3)
    expect(pedidas()).toBe(inicial + 1)
    visibilidad('visible')
    await pasar(CADA_MS)
    expect(pedidas()).toBe(inicial + 2)
  })

  it('al volver a la pestaña consulta enseguida', async () => {
    instalarMock('ana.ciudadana', { demora: 0 })
    const pedidas = espiar()
    render(<ProveedorUI><App /></ProveedorUI>)
    await esperarCuenta('Notificaciones, 2 sin leer')
    const antes = pedidas()
    visibilidad('visible')
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
    expect(pedidas()).toBe(antes + 1)
  })

  it('al navegar a otra pantalla se actualiza', async () => {
    instalarMock('ana.ciudadana', { demora: 0 })
    const pedidas = espiar()
    render(<ProveedorUI><App /></ProveedorUI>)
    const nav = await screen.findByRole('navigation', { name: 'Módulos' })
    await esperarCuenta('Notificaciones, 2 sin leer')
    const antes = pedidas()
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) })
    await user.click(within(nav).getByRole('button', { name: /^Mis trámites/ }))
    expect(pedidas()).toBeGreaterThan(antes)
  })

  it('la consulta de fondo no renueva un acceso vencido (no alarga una sesión inactiva)', async () => {
    instalarMock('ana.ciudadana', { demora: 0 })
    render(<ProveedorUI><App /></ProveedorUI>)
    await esperarCuenta('Notificaciones, 2 sin leer')
    const original = window.fetch
    const espia = vi.fn((ruta, ...resto) => (String(ruta).startsWith('/notificaciones/')
      ? Promise.resolve(new Response('{"codigo":"no_autenticado"}', { status: 401 })) : original(ruta, ...resto)))
    window.fetch = espia
    await pasar(CADA_MS)
    expect(espia.mock.calls.filter(([r]) => String(r).startsWith('/notificaciones/'))).toHaveLength(1)
    expect(espia.mock.calls.filter(([r]) => String(r) === '/auth/refresh/')).toHaveLength(0)
    // sigue mostrando lo último que supo y sigue en pie
    expect(screen.getByRole('button', { name: 'Notificaciones, 2 sin leer' })).toBeInTheDocument()
  })

  // El servidor «se queda pensando»: las consultas de la lista (GET /notificaciones/?...) quedan retenidas hasta que se suelten, con el
  // cuerpo que tenga `cuerpo` en ese momento. Lo demás (marcar como leída, etc.) pasa al servidor de ejemplo.
  function retener(cuerpo) {
    const original = window.fetch
    const pendientes = []
    const control = { cuerpo, retenidas: () => pendientes.length }
    control.soltar = async () => { pendientes.splice(0).forEach((soltar) => soltar()); await pasar(1) }
    window.fetch = (ruta, ...resto) => (String(ruta).startsWith('/notificaciones/?')
      ? new Promise((resolver) => { pendientes.push(() => resolver(new Response(JSON.stringify(control.cuerpo), { status: 200 }))) })
      : original(ruta, ...resto))
    return control
  }
  const sinLeer = (id) => ({ id, tipo: 'tramite_aprobado', tramite_id: 30 + id, tramite: { tipo_tramite: 'Permiso', institucion: 'MOP' }, creada_en: new Date().toISOString(), leida: false })
  const lista = (...items) => ({ resultados: items, total: items.length, limite: 10, desplazamiento: 0, no_leidas: items.filter((i) => !i.leida).length })
  const conUsuario = () => userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) })

  it('una consulta de fondo con el acceso vencido se salta en silencio: ni error ni anuncio, y se conserva lo último que se vio', async () => {
    instalarMock('ana.ciudadana', { demora: 0 })
    render(<ProveedorUI><App /></ProveedorUI>)
    await esperarCuenta('Notificaciones, 2 sin leer')
    const original = window.fetch
    let turnos = 0
    window.fetch = (ruta, ...resto) => {
      if (!String(ruta).startsWith('/notificaciones/?')) return original(ruta, ...resto)
      turnos += 1
      return turnos === 1 ? Promise.resolve(new Response('{"codigo":"no_autenticado"}', { status: 401 })) : new Promise(() => {}) // luego, sin respuesta
    }
    await pasar(CADA_MS)
    expect(turnos).toBe(1)
    await conUsuario().click(campana()) // al abrirlo se vuelve a pedir (queda sin respuesta): lo único que se ve es lo que dejó el turno saltado
    const ventana = await screen.findByRole('dialog', { name: 'Notificaciones' })
    expect(within(ventana).queryByRole('alert')).not.toBeInTheDocument()
    expect(within(ventana).getByText('Aprobaron tu trámite #35')).toBeInTheDocument()
    expect(screen.getByRole('status', { name: '' })).toHaveTextContent('')
  })

  it('en cambio un error del servidor en la consulta de fondo sí se avisa (con lo último que se vio)', async () => {
    instalarMock('ana.ciudadana', { demora: 0 })
    render(<ProveedorUI><App /></ProveedorUI>)
    await esperarCuenta('Notificaciones, 2 sin leer')
    const original = window.fetch
    let turnos = 0
    window.fetch = (ruta, ...resto) => {
      if (!String(ruta).startsWith('/notificaciones/?')) return original(ruta, ...resto)
      turnos += 1
      return turnos === 1 ? Promise.resolve(new Response('{}', { status: 500 })) : new Promise(() => {})
    }
    await pasar(CADA_MS)
    await conUsuario().click(campana())
    const ventana = await screen.findByRole('dialog', { name: 'Notificaciones' })
    expect(await within(ventana).findByRole('alert')).toHaveTextContent('No pudimos actualizar tus notificaciones')
    expect(within(ventana).getByText('Aprobaron tu trámite #35')).toBeInTheDocument()
  })

  it('una consulta lenta que salió antes de «Marcar todas como leídas» no vuelve a mostrar como no leído lo ya leído', async () => {
    instalarMock('ana.ciudadana', { demora: 0 })
    render(<ProveedorUI><App /></ProveedorUI>)
    await esperarCuenta('Notificaciones, 2 sin leer')
    const user = conUsuario()
    await user.click(campana())
    const ventana = await screen.findByRole('dialog', { name: 'Notificaciones' })
    await within(ventana).findByText('Aprobaron tu trámite #35')
    const servidor = retener(lista(sinLeer(1), sinLeer(2))) // lo que sabía el servidor ANTES de la escritura
    await pasar(CADA_MS)
    expect(servidor.retenidas()).toBe(1) // la consulta de fondo salió y todavía no vuelve
    await user.click(within(ventana).getByRole('button', { name: 'Marcar todas como leídas' }))
    expect(await esperarCuenta('Notificaciones, 0 sin leer')).toBeInTheDocument()
    await servidor.soltar() // ahora llega la respuesta vieja
    expect(screen.getByRole('button', { name: 'Notificaciones, 0 sin leer' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Sin leer\./ })).not.toBeInTheDocument()
    expect(screen.getByRole('status', { name: '' })).toHaveTextContent('Marcaste todas las notificaciones como leídas.') // y no anuncia «una nueva»
  })

  it('lo mismo al marcar una sola: la consulta que salió antes no la devuelve a «sin leer»', async () => {
    instalarMock('ana.ciudadana', { demora: 0 })
    render(<ProveedorUI><App /></ProveedorUI>)
    await esperarCuenta('Notificaciones, 2 sin leer')
    const user = conUsuario()
    await user.click(campana())
    const ventana = await screen.findByRole('dialog', { name: 'Notificaciones' })
    await within(ventana).findByText('Aprobaron tu trámite #35')
    const servidor = retener(lista(sinLeer(1), sinLeer(2)))
    await pasar(CADA_MS)
    expect(servidor.retenidas()).toBe(1)
    await user.click(within(ventana).getByRole('button', { name: /Aprobaron tu trámite #35/ }))
    expect(await esperarCuenta('Notificaciones, 1 sin leer')).toBeInTheDocument()
    await servidor.soltar()
    expect(screen.getByRole('button', { name: 'Notificaciones, 1 sin leer' })).toBeInTheDocument()
  })

  it('una consulta que sale DESPUÉS de la escritura sí se acepta', async () => {
    instalarMock('ana.ciudadana', { demora: 0 })
    render(<ProveedorUI><App /></ProveedorUI>)
    await esperarCuenta('Notificaciones, 2 sin leer')
    const user = conUsuario()
    await user.click(campana())
    const ventana = await screen.findByRole('dialog', { name: 'Notificaciones' })
    await user.click(await within(ventana).findByRole('button', { name: 'Marcar todas como leídas' }))
    expect(await esperarCuenta('Notificaciones, 0 sin leer')).toBeInTheDocument()
    const servidor = retener(lista(sinLeer(7))) // otra persona hizo algo después: llega una nueva
    await pasar(CADA_MS)
    expect(servidor.retenidas()).toBe(1)
    await servidor.soltar()
    expect(await esperarCuenta('Notificaciones, 1 sin leer')).toBeInTheDocument()
  })

  it('anuncia a los lectores de pantalla las que llegan después, no las de la carga inicial', async () => {
    instalarMock('flor.mop', { demora: 0 })
    render(<ProveedorUI><App /></ProveedorUI>)
    await esperarCuenta('Notificaciones, 0 sin leer')
    expect(screen.getByRole('status', { name: '' })).toHaveTextContent('')
    // llega una nueva: otra persona (la ciudadana) responde una subsanación del trámite que atiende flor
    const original = window.fetch
    window.fetch = (ruta, ...resto) => (String(ruta).startsWith('/notificaciones/')
      ? Promise.resolve(new Response(JSON.stringify({ resultados: [], total: 1, limite: 10, desplazamiento: 0, no_leidas: 1 }), { status: 200 }))
      : original(ruta, ...resto))
    await pasar(CADA_MS)
    expect(await esperarCuenta('Notificaciones, 1 sin leer')).toBeInTheDocument()
    expect(screen.getByRole('status', { name: '' })).toHaveTextContent('Tienes una notificación nueva.')
  })
})

describe('sin sesión', () => {
  it('no se pide ninguna notificación ni se dibuja la campana', async () => {
    instalarMock(null, { demora: 0 })
    const pedidas = espiar('/notificaciones')
    render(<ProveedorUI><App /></ProveedorUI>)
    expect(await screen.findByRole('heading', { name: '¿Cómo quieres ingresar?' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Notificaciones/ })).not.toBeInTheDocument()
    expect(pedidas()).toBe(0)
  })
})

describe('el texto de cada tipo', () => {
  it('cubre los siete tipos del servidor en lenguaje llano y con el número del trámite', () => {
    expect(Object.keys(TEXTOS).sort()).toEqual(['subsanacion_pedida', 'subsanacion_respondida', 'tramite_aprobado', 'tramite_desistido', 'tramite_en_atencion', 'tramite_escalado', 'tramite_rechazado'])
    expect(textoDe({ tipo: 'subsanacion_pedida', tramite_id: 7 })).toBe('Te pidieron corregir algo en el trámite #7')
    for (const tipo of Object.keys(TEXTOS)) expect(textoDe({ tipo, tramite_id: 12 })).toContain('#12')
  })

  it('un tipo que la interfaz no conoce cae en un texto general, nunca en el valor crudo', () => {
    expect(textoDe({ tipo: 'algo_nuevo', tramite_id: 3 })).toBe('Hay novedades en el trámite #3')
  })

  it('no interpreta como código lo que venga en el tipo', () => {
    expect(textoDe({ tipo: '<img src=x onerror=alert(1)>', tramite_id: 3 })).not.toContain('<')
  })
})

describe('el servidor de ejemplo', () => {
  const resp = (estado, cuerpo) => new Response(JSON.stringify(cuerpo), { status: estado })
  const paginar = (lista) => ({ resultados: lista, total: lista.length, limite: 20, desplazamiento: 0 })
  const crear = () => notificacionesMock({
    tramites: () => [{ id: 9, tipo_tramite: { nombre: 'Permiso' }, institucion: { nombre: 'MOP' } }],
    visibles: (u) => u.id !== 999, resp, paginar, paginacionValida: () => true,
  })
  const persona = (id) => ({ id })
  const estadoDe = (t) => ({ id: 9, estado: 'En Tramitacion', solicitante_id: 101, funcionario_asignado_id: 201, ...t })
  const pedir = async (mock, u, camino, metodo = 'GET', p = new URLSearchParams()) => {
    const r = mock.manejar(u, camino, metodo, p)
    return r && { estado: r.status, cuerpo: await r.json() }
  }

  it('avisa al solicitante en cada paso y no al propio actor', async () => {
    const m = crear()
    m.avisar(estadoDe({ estado: 'En Tramitacion' }), 'Pendiente', 201)
    m.avisar(estadoDe({ estado: 'Aprobado' }), 'En Tramitacion', 201)
    m.avisar(estadoDe({ estado: 'Rechazado' }), 'En Tramitacion', 101) // el propio solicitante: no se avisa a sí mismo
    const lista = (await pedir(m, persona(101), '/notificaciones/')).cuerpo
    expect(lista.resultados.slice(0, 2).map((n) => n.tipo)).toEqual(['tramite_aprobado', 'tramite_en_atencion'])
    expect(lista.resultados.filter((n) => n.tramite_id === 9 && n.tipo === 'tramite_rechazado')).toHaveLength(0)
  })

  it('al funcionario asignado solo le llega cuando responde quien pidió el trámite', async () => {
    const m = crear()
    m.avisar(estadoDe({ estado: 'En Tramitacion' }), 'En Subsanacion', 101) // responde la persona
    m.avisar(estadoDe({ estado: 'En Tramitacion', funcionario_asignado_id: 202 }), 'En Subsanacion', 201) // lo cierra el personal
    m.avisar(estadoDe({ estado: 'En Tramitacion', funcionario_asignado_id: null }), 'En Subsanacion', 101) // sin asignado
    const de201 = (await pedir(m, persona(201), '/notificaciones/')).cuerpo.resultados.filter((n) => n.tipo === 'subsanacion_respondida' && n.tramite_id === 9)
    const de202 = (await pedir(m, persona(202), '/notificaciones/')).cuerpo.resultados
    expect(de201).toHaveLength(1)
    expect(de202).toHaveLength(0)
  })

  it('lo ajeno es 404, una leída no cambia y no se aceptan filtros ni rutas inventadas', async () => {
    const m = crear()
    expect((await pedir(m, persona(102), '/notificaciones/1/leida/', 'POST')).estado).toBe(404) // la 1 es de la persona 101
    const una = await pedir(m, persona(101), '/notificaciones/1/leida/', 'POST')
    expect(una.estado).toBe(200)
    expect(una.cuerpo).toEqual({ id: 1, leida: true, no_leidas: 1 })
    expect((await pedir(m, persona(101), '/notificaciones/1/leida/', 'POST')).cuerpo.no_leidas).toBe(1)
    expect((await pedir(m, persona(101), '/notificaciones/', 'GET', new URLSearchParams('solo_no_leidas=0'))).estado).toBe(400)
    expect(await pedir(m, persona(101), '/notificaciones/leer-todas/', 'GET')).toBeNull()
  })

  it('el trámite que la persona no ve sale sin detalle', async () => {
    const m = crear()
    m.avisar(estadoDe({ estado: 'Aprobado', solicitante_id: 999 }), 'En Tramitacion', 201)
    const n = (await pedir(m, persona(999), '/notificaciones/')).cuerpo.resultados[0]
    expect(n.tramite).toBeNull()
    expect(n.tramite_id).toBe(9)
  })
})

describe('el cliente', () => {
  it('una consulta de fondo con el acceso vencido falla con 401 sin pedir renovarlo', async () => {
    const original = window.fetch
    const espia = vi.fn(async () => new Response('{}', { status: 401 }))
    window.fetch = espia
    try {
      await expect(api('/notificaciones/', { renovar: false })).rejects.toMatchObject({ estado: 401 })
      expect(espia).toHaveBeenCalledTimes(1)
    } finally {
      window.fetch = original
    }
  })
})
