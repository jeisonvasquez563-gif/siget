// Duración de la sesión: cierre por inactividad con aviso previo, y recargar la página saca de un trámite abierto.
// Solo se falsean el reloj y el intervalo; setTimeout queda real porque el servidor de ejemplo lo usa para responder.
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App.jsx'
import { instalarMock } from '../mock.js'
import { ProveedorUI } from '../ui.jsx'

vi.mock('qrcode', () => ({ default: { toCanvas: vi.fn() } }))

const MINUTOS = 3 // límite de inactividad de estas pruebas: el aviso aparece a los 2 min y el cierre a los 3

async function abrir(usuario = 'ana.ciudadana') {
  instalarMock(usuario, { demora: 0, inactividad: MINUTOS })
  const utilidades = render(<ProveedorUI><App /></ProveedorUI>)
  await screen.findByRole('navigation', { name: 'Módulos' })
  return utilidades
}
const pasar = async (segundos) => { await act(async () => { await vi.advanceTimersByTimeAsync(segundos * 1000) }) }
const aviso = () => screen.queryByRole('alertdialog', { name: /¿Sigues ahí\?/ })

describe('cierre de sesión por inactividad', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] }) })
  afterEach(() => { vi.useRealTimers() })

  it('no avisa mientras hay tiempo, avisa un minuto antes y cierra la sesión al agotarse', async () => {
    await abrir()
    await pasar(100)
    expect(aviso()).not.toBeInTheDocument()
    await pasar(25) // 125 s: quedan menos de 60 s
    expect(aviso()).toBeInTheDocument()
    expect(within(aviso()).getByText(/segundos/)).toBeInTheDocument()
    await pasar(60) // se agotó
    expect(await screen.findByText(/Cerramos tu sesión por inactividad/)).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Módulos' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Ingresar|Entrar/ })).toBeInTheDocument()
  })

  it('«Seguir conectado» reinicia la cuenta', async () => {
    await abrir()
    await pasar(125)
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) })
    await user.click(within(aviso()).getByRole('button', { name: 'Seguir conectado' }))
    expect(aviso()).not.toBeInTheDocument()
    await pasar(100)
    expect(aviso()).not.toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Módulos' })).toBeInTheDocument()
  })

  it('la actividad (teclado o clic) reinicia la cuenta antes del aviso', async () => {
    await abrir()
    await pasar(100)
    fireEvent.keyDown(window, { key: 'a' })
    await pasar(100)
    expect(aviso()).not.toBeInTheDocument()
    fireEvent.pointerDown(window)
    await pasar(100)
    expect(aviso()).not.toBeInTheDocument()
  })

  it('durante el aviso, mover el ratón NO cancela el cierre: hay que decir que se sigue ahí', async () => {
    await abrir()
    await pasar(125)
    expect(aviso()).toBeInTheDocument()
    fireEvent.pointerMove(window)
    fireEvent.keyDown(window, { key: 'a' })
    await pasar(60)
    expect(await screen.findByText(/Cerramos tu sesión por inactividad/)).toBeInTheDocument()
  })

  it('el cierre revoca la sesión en el servidor (no solo oculta la pantalla)', async () => {
    await abrir()
    const llamadas = []
    const original = window.fetch
    window.fetch = (ruta, op) => { llamadas.push(`${(op?.method || 'GET')} ${ruta}`); return original(ruta, op) }
    await pasar(181)
    await screen.findByText(/Cerramos tu sesión por inactividad/)
    expect(llamadas).toContain('POST /auth/logout/')
  })
})

describe('recargar la página', () => {
  it('saca de un trámite abierto y devuelve al Inicio', async () => {
    instalarMock('fabio.mop', { demora: 0 })
    const primera = render(<ProveedorUI><App /></ProveedorUI>)
    const menu = await screen.findByRole('navigation', { name: 'Módulos' })
    const user = userEvent.setup()
    await user.click(within(menu).getByRole('button', { name: /^Bandeja de la institución/ }))
    await user.click(await screen.findByRole('row', { name: /Trámite 42:/ }))
    expect(await screen.findByRole('img', { name: /Recorrido del trámite/ })).toBeInTheDocument()
    expect(screen.getAllByText(/Trámite #42/).length).toBeGreaterThan(0)

    // «Recargar»: se descarta toda la aplicación en memoria y se vuelve a montar; la sesión sigue por la cookie de refresco
    primera.unmount()
    render(<ProveedorUI><App /></ProveedorUI>)
    const menu2 = await screen.findByRole('navigation', { name: 'Módulos' })
    expect(within(menu2).getByRole('button', { name: 'Inicio' })).toHaveAttribute('aria-current', 'page')
    expect(screen.queryByText(/Trámite #42/)).not.toBeInTheDocument()
    expect(screen.queryByRole('img', { name: /Recorrido del trámite/ })).not.toBeInTheDocument()
  })
})
