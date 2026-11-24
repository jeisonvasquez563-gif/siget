// Cambiar la contraseña desde «Mi seguridad»: formulario, política, modal de segundo factor, errores del servidor y accesibilidad.
// Se arma la aplicación completa contra el servidor de ejemplo (src/mock.js), que imita POST /auth/contrasena/ de docs/api.md.
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../App.jsx'
import { api } from '../api.js'
import { CLAVE_DE_EJEMPLO, instalarMock } from '../mock.js'
import { ProveedorUI } from '../ui.jsx'

vi.mock('qrcode', () => ({ default: { toCanvas: vi.fn() } }))
const AXE = { rules: { 'color-contrast': { enabled: false } } }
const NUEVA = 'otra-frase-larga-y-poco-comun-5528'

afterEach(() => vi.restoreAllMocks())

async function abrir(usuario = 'ana.ciudadana') {
  instalarMock(usuario, { demora: 0 })
  const utilidades = render(<ProveedorUI><App /></ProveedorUI>)
  const user = userEvent.setup()
  const nav = await screen.findByRole('navigation', { name: 'Módulos' })
  await user.click(within(nav).getByRole('button', { name: /^Mi seguridad/ }))
  const formulario = await screen.findByRole('form', { name: 'Cambiar la contraseña' })
  return { ...utilidades, user, formulario }
}

async function llenar(user, formulario, { actual = CLAVE_DE_EJEMPLO, nueva = NUEVA, repetida = nueva } = {}) {
  if (actual) await user.type(within(formulario).getByLabelText('Contraseña actual'), actual)
  if (nueva) await user.type(within(formulario).getByLabelText('Contraseña nueva'), nueva)
  if (repetida) await user.type(within(formulario).getByLabelText('Repite la contraseña nueva'), repetida)
}

const enviar = (user, formulario) => user.click(within(formulario).getByRole('button', { name: 'Cambiar la contraseña' }))

async function reautenticar(user, codigo = '123456') {
  const modal = await screen.findByRole('dialog', { name: /Confirma que eres tú/ })
  await user.type(within(modal).getByLabelText(/Código de 6 dígitos/), codigo)
  await user.click(within(modal).getByRole('button', { name: /Verificar y continuar/ }))
}

function espiar() {
  const original = window.fetch
  const espia = vi.fn((...a) => original(...a))
  window.fetch = espia
  return () => espia.mock.calls.filter(([ruta]) => ruta === '/auth/contrasena/')
}

describe('cambiar la contraseña en «Mi seguridad»', () => {
  it('muestra la sección con la política y tres campos de contraseña bien rotulados', async () => {
    const { formulario } = await abrir()
    expect(screen.getByRole('heading', { name: 'Cambiar la contraseña' })).toBeInTheDocument()
    expect(screen.getByText(/Al menos 12 caracteres/)).toBeInTheDocument()
    for (const nombre of ['Contraseña actual', 'Contraseña nueva', 'Repite la contraseña nueva']) {
      const campo = within(formulario).getByLabelText(nombre)
      expect(campo).toHaveAttribute('type', 'password')
      expect(campo).toBeRequired()
    }
    expect(within(formulario).getByLabelText('Contraseña actual')).toHaveAttribute('autocomplete', 'current-password')
    expect(within(formulario).getByLabelText('Contraseña nueva')).toHaveAttribute('autocomplete', 'new-password')
    expect(within(formulario).getByLabelText('Contraseña nueva')).toHaveAccessibleDescription(/Al menos 12 caracteres/)
  })

  it('es accesible (axe) también con los errores a la vista', async () => {
    const { container, user, formulario } = await abrir()
    expect(await axe(container, AXE)).toHaveNoViolations()
    await enviar(user, formulario)
    expect(await within(formulario).findByText('Escribe tu contraseña actual.')).toBeInTheDocument()
    expect(await axe(container, AXE)).toHaveNoViolations()
  })

  it('valida antes de enviar: no llama al servidor y marca el campo con su motivo', async () => {
    const { user, formulario } = await abrir()
    const pedidas = espiar()
    await llenar(user, formulario, { actual: CLAVE_DE_EJEMPLO, nueva: 'corta', repetida: 'otra' })
    await enviar(user, formulario)
    const nueva = within(formulario).getByLabelText(/^Contraseña nueva/)
    expect(nueva).toBeInvalid()
    expect(nueva).toHaveAccessibleDescription(/Debe tener al menos 12 caracteres/)
    expect(pedidas()).toHaveLength(0)
  })

  it.each([
    ['la confirmación no coincide', { nueva: NUEVA, repetida: NUEVA + 'x' }, /No coincide/],
    ['es igual a la actual', { nueva: CLAVE_DE_EJEMPLO, repetida: CLAVE_DE_EJEMPLO }, /distinta de la actual/],
    ['lleva el nombre de usuario', { nueva: 'xx-ana.ciudadana-xx-1', repetida: 'xx-ana.ciudadana-xx-1' }, /nombre de usuario/],
  ])('rechaza en el navegador si %s', async (_nombre, valores, mensaje) => {
    const { user, formulario } = await abrir()
    const pedidas = espiar()
    await llenar(user, formulario, valores)
    await enviar(user, formulario)
    expect(await within(formulario).findByText(mensaje)).toBeInTheDocument()
    expect(pedidas()).toHaveLength(0)
  })

  it('con el segundo factor vencido pide el código y, al verificarlo, repite el cambio y lo completa', async () => {
    const { user, formulario } = await abrir()
    const pedidas = espiar()
    await llenar(user, formulario)
    await enviar(user, formulario)
    await reautenticar(user)
    expect(await screen.findByText(/Tu contraseña se cambió/)).toBeInTheDocument()
    expect(pedidas()).toHaveLength(2) // el 403 y la repetición tras el código
    expect(JSON.parse(pedidas()[1][1].body)).toEqual({ actual: CLAVE_DE_EJEMPLO, nueva: NUEVA })
  })

  it('al cambiarla avisa que se cerraron las otras sesiones, que esta sigue abierta, y borra lo escrito', async () => {
    const { user, formulario } = await abrir()
    await llenar(user, formulario)
    await enviar(user, formulario)
    await reautenticar(user)
    const aviso = await screen.findByText(/Tu contraseña se cambió/)
    expect(aviso).toHaveTextContent('Cerramos las otras 2 sesiones abiertas de tu cuenta; esta sigue abierta.')
    expect(aviso.closest('[role="status"]')).not.toBeNull() // se anuncia a los lectores de pantalla
    for (const nombre of ['Contraseña actual', 'Contraseña nueva', 'Repite la contraseña nueva']) {
      expect(within(formulario).getByLabelText(nombre)).toHaveValue('')
    }
    expect(screen.getByRole('navigation', { name: 'Módulos' })).toBeInTheDocument() // la sesión sigue abierta
  })

  it('tras cambiarla la interfaz usa el acceso nuevo en la siguiente llamada, sin volver a entrar', async () => {
    const { user, formulario } = await abrir()
    await llenar(user, formulario)
    await enviar(user, formulario)
    await reautenticar(user)
    await screen.findByText(/Tu contraseña se cambió/)
    const espia = vi.fn((...a) => original(...a))
    const original = window.fetch
    window.fetch = espia
    await api('/auth/yo/')
    const [, opciones] = espia.mock.calls.find(([ruta]) => ruta === '/auth/yo/')
    expect(opciones.headers.Authorization).toBe('Bearer mock-sesion-2') // el que devolvió el cambio, no el del inicio de sesión
    expect(espia.mock.calls.some(([ruta]) => ruta === '/auth/refresh/')).toBe(false)
  })

  it('con una contraseña actual incorrecta muestra el mensaje genérico', async () => {
    const { user, formulario } = await abrir()
    await llenar(user, formulario, { actual: 'esta-no-es-la-clave' })
    await enviar(user, formulario)
    await reautenticar(user)
    const alerta = await screen.findByRole('alert')
    expect(alerta).toHaveTextContent(/La contraseña actual no es correcta, o tu cuenta está bloqueada/)
    expect(screen.queryByText(/Tu contraseña se cambió/)).not.toBeInTheDocument()
  })

  it('si el servidor rechaza la contraseña nueva por la política, dice por qué', async () => {
    const { user, formulario } = await abrir()
    const original = window.fetch
    window.fetch = vi.fn((ruta, ...resto) => (ruta === '/auth/contrasena/'
      ? Promise.resolve(new Response(JSON.stringify({ codigo: 'datos_invalidos', errores: ['es una contraseña demasiado común o una secuencia previsible'] }), { status: 400 }))
      : original(ruta, ...resto)))
    await llenar(user, formulario)
    await enviar(user, formulario)
    expect(await screen.findByRole('alert')).toHaveTextContent('La contraseña nueva es una contraseña demasiado común o una secuencia previsible.')
  })

  it('con el límite de intentos (429) explica que hay que esperar', async () => {
    const { user, formulario } = await abrir()
    const original = window.fetch
    window.fetch = vi.fn((ruta, ...resto) => (ruta === '/auth/contrasena/' ? Promise.resolve(new Response('{}', { status: 429 })) : original(ruta, ...resto)))
    await llenar(user, formulario)
    await enviar(user, formulario)
    expect(await screen.findByRole('alert')).toHaveTextContent(/demasiados intentos de cambio en la última hora/)
  })

  it('cancelar el modal del segundo factor no cambia nada', async () => {
    const { user, formulario } = await abrir()
    const pedidas = espiar()
    await llenar(user, formulario)
    await enviar(user, formulario)
    const modal = await screen.findByRole('dialog', { name: /Confirma que eres tú/ })
    await user.click(within(modal).getByRole('button', { name: 'Cancelar' }))
    expect(screen.queryByText(/Tu contraseña se cambió/)).not.toBeInTheDocument()
    expect(pedidas()).toHaveLength(1)
  })

  it('también está para las cuentas de plataforma (es su propia cuenta)', async () => {
    const { formulario } = await abrir('ines.infra')
    expect(within(formulario).getByLabelText('Contraseña actual')).toBeInTheDocument()
  })

  it('el servidor de ejemplo, como el real, bloquea tras 3 contraseñas actuales incorrectas', async () => {
    instalarMock('ana.ciudadana', { demora: 0 })
    await fetch('/auth/mfa/verificar/', { method: 'POST', body: JSON.stringify({ codigo: '111111' }) })
    const cambiar = (actual) => fetch('/auth/contrasena/', { method: 'POST', body: JSON.stringify({ actual, nueva: NUEVA }) })
    for (let i = 0; i < 3; i++) expect((await cambiar('mala')).status).toBe(400)
    const r = await cambiar(CLAVE_DE_EJEMPLO) // bloqueada: ni la correcta
    expect(r.status).toBe(400)
    expect((await r.json()).codigo).toBe('credenciales_invalidas')
  })
})
