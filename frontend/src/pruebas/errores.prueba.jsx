// Pantalla de error (ErrorBoundary): un componente que falla al dibujarse muestra un mensaje llano, sin traza ni datos, con foco en el título
// y dos salidas («Volver al inicio» y «Reintentar»). Un fallo en una pantalla no tira el menú.
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App.jsx'
import { LimiteDeError } from '../ErrorBoundary.jsx'
import { instalarMock } from '../mock.js'
import { ProveedorUI } from '../ui.jsx'

vi.mock('qrcode', () => ({ default: { toCanvas: vi.fn() } }))
const AXE = { rules: { 'color-contrast': { enabled: false } } }
const SECRETO = 'cedula-8-123-456-de-Maria-Perez' // lo que un error podría arrastrar: no debe verse jamás

let consola
beforeEach(() => { consola = vi.spyOn(console, 'error').mockImplementation(() => {}) }) // React también registra los errores atrapados
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs() })

// React reintenta una vez, en el acto, el dibujo que falló: por eso el fallo se enciende y se apaga con un interruptor y no contando intentos
function Falla() {
  Falla.intentos += 1
  if (Falla.roto) throw new Error(`No se pudo dibujar ${SECRETO}`)
  return <p>Todo bien por aquí</p>
}
beforeEach(() => { Falla.intentos = 0; Falla.roto = true })

describe('el límite de error', () => {
  it('sin fallos deja pasar a los hijos', () => {
    render(<LimiteDeError nivel="pantalla"><p>contenido normal</p></LimiteDeError>)
    expect(screen.getByText('contenido normal')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('un componente que lanza muestra la pantalla de error, con role=alert y el foco en el título', () => {
    render(<LimiteDeError nivel="pantalla"><Falla /></LimiteDeError>)
    const alerta = screen.getByRole('alert')
    const titulo = within(alerta).getByRole('heading', { name: 'No pudimos mostrar esta pantalla' })
    expect(titulo).toHaveFocus()
    expect(within(alerta).getByRole('button', { name: 'Volver al inicio' })).toBeInTheDocument()
    expect(within(alerta).getByRole('button', { name: 'Reintentar' })).toBeInTheDocument()
  })

  it('no muestra la traza, el mensaje del error ni datos de la persona', () => {
    const { container } = render(<LimiteDeError nivel="aplicacion"><Falla /></LimiteDeError>)
    expect(container.textContent).not.toContain(SECRETO)
    expect(container.textContent).not.toMatch(/Error:|at Falla|\.jsx|componentStack/)
    expect(screen.getByRole('heading', { name: 'Algo salió mal' })).toHaveFocus()
  })

  it('«Reintentar» vuelve a montar el componente: si ya no falla, se ve el contenido', async () => {
    const user = userEvent.setup()
    render(<LimiteDeError nivel="pantalla"><Falla /></LimiteDeError>)
    expect(screen.getByRole('alert')).toBeInTheDocument()
    Falla.roto = false
    await user.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(screen.getByText('Todo bien por aquí')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('«Reintentar» con un fallo que persiste vuelve a mostrar la pantalla de error (sin ciclos)', async () => {
    const user = userEvent.setup()
    render(<LimiteDeError nivel="pantalla"><Falla /></LimiteDeError>)
    const antes = Falla.intentos
    await user.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(Falla.intentos).toBeGreaterThan(antes)
    expect(screen.getByRole('heading', { name: 'No pudimos mostrar esta pantalla' })).toHaveFocus()
  })

  it('«Volver al inicio» en una pantalla avisa a la aplicación y descarta el error', async () => {
    const user = userEvent.setup()
    const alInicio = vi.fn()
    render(<LimiteDeError nivel="pantalla" alVolverAlInicio={alInicio}><Falla /></LimiteDeError>)
    Falla.roto = false
    await user.click(screen.getByRole('button', { name: 'Volver al inicio' }))
    expect(alInicio).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('«Volver al inicio» en la aplicación completa limpia la dirección', async () => {
    const user = userEvent.setup()
    window.location.hash = '#/privacidad'
    render(<LimiteDeError nivel="aplicacion"><Falla /></LimiteDeError>)
    Falla.roto = false
    await user.click(screen.getByRole('button', { name: 'Volver al inicio' }))
    expect(window.location.hash).toBe('')
  })

  it('registra el error en la consola solo en desarrollo', () => {
    const delLimite = () => consola.mock.calls.filter(([m]) => typeof m === 'string' && m.startsWith('[SIGET]'))
    render(<LimiteDeError nivel="pantalla"><Falla /></LimiteDeError>)
    expect(delLimite()).toHaveLength(1)
    consola.mockClear()
    vi.stubEnv('DEV', false)
    render(<LimiteDeError nivel="pantalla"><Falla /></LimiteDeError>)
    expect(delLimite()).toHaveLength(0)
  })

  it('la pantalla de error es accesible (axe), en la aplicación y en una pantalla', async () => {
    const a = render(<LimiteDeError nivel="aplicacion"><Falla /></LimiteDeError>)
    expect(await axe(a.container, AXE)).toHaveNoViolations()
    a.unmount()
    const b = render(<LimiteDeError nivel="pantalla"><Falla /></LimiteDeError>)
    expect(await axe(b.container, AXE)).toHaveNoViolations()
  })
})

describe('un error en una pantalla de la aplicación', () => {
  const MALOS = { total: 1, limite: 100, desplazamiento: 0, resultados: [{ id: 1, estado: 'Pendiente' }] } // sin `tipo_tramite`: «Mis trámites» no puede dibujar la fila

  async function abrirConRespuestaRota() {
    instalarMock('ana.ciudadana', { demora: 0 })
    const original = window.fetch
    let rota = true
    window.fetch = vi.fn((ruta, ...resto) => (rota && String(ruta).startsWith('/tramites/?')
      ? Promise.resolve(new Response(JSON.stringify(MALOS), { status: 200 }))
      : original(ruta, ...resto)))
    render(<ProveedorUI><LimiteDeError nivel="aplicacion"><App /></LimiteDeError></ProveedorUI>)
    const user = userEvent.setup()
    const nav = await screen.findByRole('navigation', { name: 'Módulos' })
    await user.click(within(nav).getByRole('button', { name: /^Mis trámites/ }))
    return { user, nav, arreglar: () => { rota = false } }
  }

  it('no tira el menú: la barra lateral sigue, la pantalla muestra el error y se puede ir a otra', async () => {
    const { user, nav } = await abrirConRespuestaRota()
    const alerta = await screen.findByRole('alert')
    expect(within(alerta).getByRole('heading', { name: 'No pudimos mostrar esta pantalla' })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Módulos' })).toBe(nav)
    await user.click(within(nav).getByRole('button', { name: /^Mi seguridad/ }))
    expect(await screen.findByRole('heading', { name: 'Mi seguridad' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'No pudimos mostrar esta pantalla' })).not.toBeInTheDocument()
  })

  it('«Reintentar» vuelve a pedir la pantalla y, si el servidor ya responde bien, la muestra', async () => {
    const { user, arreglar } = await abrirConRespuestaRota()
    await screen.findByRole('alert')
    arreglar()
    await user.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByRole('heading', { name: 'Mis trámites' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('«Volver al inicio» lleva al Inicio de la aplicación', async () => {
    const { user } = await abrirConRespuestaRota()
    await screen.findByRole('alert')
    await user.click(screen.getByRole('button', { name: 'Volver al inicio' }))
    expect(await screen.findByText(/Tus módulos/)).toBeInTheDocument()
  })
})
