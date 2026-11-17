// Registro configurable (abierto / invitación / cerrado), aviso de demostración e invitaciones en la consola de identidades
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import App from '../App.jsx'
import { instalarMock } from '../mock.js'
import { ProveedorUI } from '../ui.jsx'

vi.mock('qrcode', () => ({ default: { toCanvas: vi.fn() } }))  // jsdom no dibuja en canvas

async function abrirAcceso(ajustes = {}) {
  window.location.hash = '#/ciudadania'
  instalarMock(null, { demora: 0, ...ajustes })
  render(<ProveedorUI><App /></ProveedorUI>)
  const user = userEvent.setup()
  await screen.findByRole('heading', { name: 'Ingresa a tu cuenta' })
  return { user }
}

async function llenarDatos(user) {
  await user.type(screen.getByLabelText('Nombre'), 'María José')
  await user.type(screen.getByLabelText('Apellidos'), 'Pérez de Gracia')
  await user.type(screen.getByLabelText(/^Cédula/), '8-123-456')
  await user.type(screen.getByLabelText(/^Fecha de nacimiento/), '1995-04-12')
  await user.selectOptions(screen.getByLabelText('Provincia'), 'Panamá')
  await user.type(screen.getByLabelText('Ciudad'), 'San Miguelito')
  await user.type(screen.getByLabelText('Correo electrónico'), 'maria@correo.com')
  await user.type(screen.getByLabelText('Usuario'), 'nuevo.usuario')
  await user.type(screen.getByLabelText('Contraseña'), 'una-frase-larga-y-unica')
}

describe('registro configurable', () => {
  it('abierto: se crea la cuenta sin pedir invitación (como siempre)', async () => {
    const { user } = await abrirAcceso()
    await user.click(await screen.findByRole('button', { name: 'Crear una cuenta' }))
    expect(screen.queryByLabelText(/Código de invitación/)).not.toBeInTheDocument()
  })

  it('cerrado: no se ofrece crear cuenta y se explica por qué', async () => {
    await abrirAcceso({ registro: 'cerrado' })
    expect(await screen.findByText(/La creación de cuentas está cerrada/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Crear una cuenta' })).not.toBeInTheDocument()
  })

  it('por invitación: el código es obligatorio y uno inválido se explica sin crear la cuenta', async () => {
    const { user } = await abrirAcceso({ registro: 'invitacion' })
    await user.click(await screen.findByRole('button', { name: 'Crear una cuenta' }))
    const campo = screen.getByLabelText(/^Código de invitación/)
    expect(campo).toBeRequired()
    await llenarDatos(user)
    await user.type(campo, 'AAAA-BBBB-CCCC')
    await user.click(screen.getByRole('button', { name: 'Crear cuenta' }))
    expect(await screen.findByText(/La invitación no es válida, ya se usó o venció/)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Crea tu cuenta' })).toBeInTheDocument()
  })

  it('por invitación: con un código válido se crea la cuenta y sigue al segundo factor', async () => {
    const { user } = await abrirAcceso({ registro: 'invitacion' })
    await user.click(await screen.findByRole('button', { name: 'Crear una cuenta' }))
    await llenarDatos(user)
    await user.type(screen.getByLabelText(/^Código de invitación/), 'k7mq-2xwd-9prt')   // se pasa a mayúsculas
    await user.click(screen.getByRole('button', { name: 'Crear cuenta' }))
    expect(await screen.findByRole('heading', { name: 'Activa el segundo factor' })).toBeInTheDocument()
  })
})

describe('aviso de demostración académica', () => {
  it('no aparece si la plataforma no lo activa', async () => {
    await abrirAcceso()
    expect(screen.queryByRole('note')).not.toBeInTheDocument()
  })

  it('aparece en la pantalla de acceso cuando la plataforma lo activa', async () => {
    await abrirAcceso({ aviso: true })
    expect(await screen.findByRole('note')).toHaveTextContent(/Demostración académica.*No ingreses datos reales/)
  })
})

describe('invitaciones en la consola de identidades', () => {
  it('emite una invitación que se muestra una sola vez y lista las anteriores sin el código', async () => {
    instalarMock('ivan.identidades', { demora: 0 })
    render(<ProveedorUI><App /></ProveedorUI>)
    const user = userEvent.setup()
    const nav = await screen.findByRole('navigation', { name: 'Módulos' })
    await user.click(within(nav).getByRole('button', { name: /^Identidades/ }))
    const panel = (await screen.findByRole('heading', { name: 'Invitaciones para crear cuenta' })).closest('section')
    expect(await within(panel).findByText('Prueba de usabilidad (grupo B)')).toBeInTheDocument()
    expect(panel).toHaveTextContent(/Por invitación/)
    expect(panel).not.toHaveTextContent('K7MQ-2XWD-9PRT')
    await user.type(within(panel).getByLabelText(/Para quién/), 'grupo C')
    await user.click(within(panel).getByRole('button', { name: 'Emitir invitación' }))
    const modal = await screen.findByRole('dialog', { name: /Invitación para crear cuenta/ })
    expect(within(modal).getByText('K7MQ-2XWD-9PRT')).toBeInTheDocument()
    expect(modal).toHaveTextContent(/No se vuelve a mostrar/)
    await user.click(within(modal).getByRole('button', { name: /ya se lo entregué/ }))
    expect(await within(panel).findByText('grupo C')).toBeInTheDocument()
  })
})
