// Gestión del equipo de una institución: la coordinación asigna, cambia de rol y quita; la supervisión solo ve.
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'
import { describe, expect, it, vi } from 'vitest'
import App from '../App.jsx'
import { instalarMock } from '../mock.js'
import { ProveedorUI } from '../ui.jsx'

vi.mock('qrcode', () => ({ default: { toCanvas: vi.fn() } }))
const AXE = { rules: { 'color-contrast': { enabled: false } } }

async function abrirEquipo(usuario) {
  instalarMock(usuario, { demora: 0 })
  const utilidades = render(<ProveedorUI><App /></ProveedorUI>)
  const nav = await screen.findByRole('navigation', { name: 'Módulos' })
  const user = userEvent.setup()
  await user.click(within(nav).getByRole('button', { name: /^Equipo de la institución/ }))
  await screen.findByRole('heading', { name: 'MOP' })
  return { ...utilidades, user }
}

const tarjeta = (usuario) => within(screen.getByRole('main')).getByText(usuario, { selector: 'strong' }).closest('.persona')

describe('quién puede gestionar', () => {
  it('la coordinadora ve el formulario y los botones de cada persona del personal, pero no de las coordinaciones ni de sí misma', async () => {
    await abrirEquipo('carla.mop')
    expect(screen.getByRole('form', { name: /Agregar personal a MOP/ })).toBeInTheDocument()
    expect(within(tarjeta('saul.mop')).getByRole('button', { name: /Quitar a saul.mop/ })).toBeInTheDocument()
    expect(within(tarjeta('fabio.mop')).getByRole('button', { name: /Hacer supervisor a fabio.mop/ })).toBeInTheDocument()
    expect(within(tarjeta('saul.mop')).getByRole('button', { name: /Hacer funcionario a saul.mop/ })).toBeInTheDocument()
    expect(within(tarjeta('carla.mop')).queryByRole('button')).not.toBeInTheDocument() // ni a sí misma ni a una coordinación
  })

  it('la supervisión ve el equipo pero sin formulario ni botones, y se le explica por qué', async () => {
    await abrirEquipo('saul.mop')
    expect(screen.queryByRole('form', { name: /Agregar personal/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Quitar a/ })).not.toBeInTheDocument()
    expect(screen.getByText(/Solo la coordinación de la institución puede agregar/)).toBeInTheDocument()
  })
})

describe('asignar, cambiar de rol y quitar', () => {
  it('agrega a una persona como funcionaria y aparece en el equipo', async () => {
    const { user } = await abrirEquipo('carla.mop')
    await user.type(screen.getByLabelText('Usuario de la persona'), 'ana.ciudadana')
    await user.click(screen.getByRole('button', { name: 'Agregar al equipo' }))
    expect(await screen.findByText(/ana.ciudadana se agregó como funcionario/)).toBeInTheDocument()
    expect(within(tarjeta('ana.ciudadana')).getByText('Funcionario')).toBeInTheDocument()
  })

  it('una persona que no existe, o que ya es del equipo, se rechaza explicando por qué', async () => {
    const { user } = await abrirEquipo('carla.mop')
    await user.type(screen.getByLabelText('Usuario de la persona'), 'nadie.existe')
    await user.click(screen.getByRole('button', { name: 'Agregar al equipo' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/no existe esa persona/)
    await user.clear(screen.getByLabelText('Usuario de la persona'))
    await user.type(screen.getByLabelText('Usuario de la persona'), 'flor.mop')
    await user.click(screen.getByRole('button', { name: 'Agregar al equipo' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/ya es funcionario de esta institución/)
  })

  it('una cuenta de plataforma no puede ser personal de una institución', async () => {
    const { user } = await abrirEquipo('carla.mop')
    await user.type(screen.getByLabelText('Usuario de la persona'), 'ivan.identidades')
    await user.click(screen.getByRole('button', { name: 'Agregar al equipo' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/cuenta de plataforma/)
  })

  it('cambia a alguien de funcionario a supervisor', async () => {
    const { user } = await abrirEquipo('carla.mop')
    await user.click(within(tarjeta('flor.mop')).getByRole('button', { name: /Hacer supervisor a flor.mop/ }))
    expect(await screen.findByText(/flor.mop ahora es supervisor/)).toBeInTheDocument()
    expect(within(tarjeta('flor.mop')).getByText('Supervisor')).toBeInTheDocument()
  })

  it('quitar pide confirmar y explica las consecuencias; al confirmar, la persona sale del equipo', async () => {
    const { user } = await abrirEquipo('carla.mop')
    await user.click(within(tarjeta('flor.mop')).getByRole('button', { name: /Quitar a flor.mop/ }))
    // flor.mop tiene el trámite 44 (en tramitación) asignado en el simulador: no se puede quitar todavía
    const dialogo = await screen.findByRole('alertdialog')
    expect(dialogo).toHaveTextContent(/Dejará de ver la bandeja de MOP/)
    await user.click(within(dialogo).getByRole('button', { name: 'Quitar acceso' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/aún tiene \d+ trámite\(s\) abierto\(s\) asignado\(s\)/)
    expect(tarjeta('flor.mop')).toBeInTheDocument()
  })

  it('quita a alguien sin trámites abiertos', async () => {
    const { user } = await abrirEquipo('carla.mop')
    await user.type(screen.getByLabelText('Usuario de la persona'), 'beto.ciudadano')
    await user.click(screen.getByRole('button', { name: 'Agregar al equipo' }))
    await screen.findByText(/beto.ciudadano se agregó como funcionario/)
    await user.click(within(tarjeta('beto.ciudadano')).getByRole('button', { name: /Quitar a beto.ciudadano/ }))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Quitar acceso' }))
    expect(await screen.findByText(/beto.ciudadano ya no es parte del equipo/)).toBeInTheDocument()
    expect(within(screen.getByRole('main')).queryByText('beto.ciudadano', { selector: 'strong' })).not.toBeInTheDocument()
  })

  it('es accesible (axe)', async () => {
    const { container } = await abrirEquipo('carla.mop')
    expect(await axe(container, AXE)).toHaveNoViolations()
  })
})
