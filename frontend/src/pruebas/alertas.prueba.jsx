// Alertas ante patrones sospechosos (PT-10): el panel de la consola de respuesta a incidentes (operador de seguridad) y la lectura del
// auditor. Se arma la aplicación completa contra el servidor de ejemplo (src/mock.js + src/mock-plataforma.js), que imita docs/api.md.
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../App.jsx'
import { instalarMock } from '../mock.js'
import { ProveedorUI } from '../ui.jsx'

vi.mock('qrcode', () => ({ default: { toCanvas: vi.fn() } }))
const AXE = { rules: { 'color-contrast': { enabled: false } } }

afterEach(() => vi.restoreAllMocks())

async function abrirComo(usuario, modulo) {
  instalarMock(usuario, { demora: 0 })
  const utilidades = render(<ProveedorUI><App /></ProveedorUI>)
  const user = userEvent.setup()
  const nav = await screen.findByRole('navigation', { name: 'Módulos' })
  await user.click(within(nav).getByRole('button', { name: new RegExp(`^${modulo}`) }))
  return { ...utilidades, user }
}

const panel = () => screen.getByRole('heading', { name: 'Alertas de seguridad' }).closest('section')
const tabla = () => within(panel()).getByRole('table', { name: 'Alertas de seguridad' })
const filaDe = (texto) => within(tabla()).getByRole('row', { name: texto })

async function reautenticar(user, codigo = '123456') {
  const modal = await screen.findByRole('dialog', { name: /Confirma que eres tú/ })
  await user.type(within(modal).getByLabelText(/Código de 6 dígitos/), codigo)
  await user.click(within(modal).getByRole('button', { name: /Verificar y continuar/ }))
}

// Ver las alertas exige segundo factor reciente: el panel ofrece verificarlo y se recarga solo
async function abrirConsola(usuario = 'sergio.seguridad') {
  const o = await abrirComo(usuario, 'Respuesta a incidentes')
  await screen.findByRole('heading', { name: 'Alertas de seguridad' })
  await o.user.click(await within(panel()).findByRole('button', { name: 'Verificar segundo factor' }))
  await reautenticar(o.user)
  await within(panel()).findByRole('table', { name: 'Alertas de seguridad' })
  return o
}

describe('panel de alertas del operador de seguridad', () => {
  it('sin segundo factor reciente no muestra nada y ofrece verificarlo', async () => {
    await abrirComo('sergio.seguridad', 'Respuesta a incidentes')
    const seccion = await screen.findByRole('heading', { name: 'Alertas de seguridad' }).then((h) => h.closest('section'))
    expect(await within(seccion).findByText(/piden que hayas verificado tu segundo factor/)).toBeInTheDocument()
    expect(within(seccion).queryByRole('table')).not.toBeInTheDocument()
  })

  it('lista las abiertas con la regla en lenguaje llano, la severidad, la persona o la dirección y los contadores', async () => {
    await abrirConsola()
    expect(within(panel()).getByRole('status')).toHaveTextContent('4 alertas abiertas')
    expect(within(tabla()).getAllByRole('row')).toHaveLength(5) // la cabecera y 4 alertas
    const porDireccion = filaDe(/^Ráfaga de inicios de sesión fallidos/)
    expect(porDireccion).toHaveTextContent('Media')
    expect(porDireccion).toHaveTextContent('198.51.100.23')
    expect(porDireccion).toHaveTextContent('login_fallido ×11, cambio_contrasena_fallido ×3')
    expect(within(porDireccion).getByText('14')).toBeInTheDocument()
    const reuso = filaDe(/^Reuso de un token de sesión/)
    expect(reuso).toHaveTextContent('Alta')
    expect(reuso).toHaveTextContent('ana.ciudadana')
    expect(reuso).toHaveTextContent('Abierta')
    expect(filaDe(/^Cuenta bloqueada varias veces/)).toHaveTextContent('fabio.mop')
    expect(filaDe(/^Muchas denegaciones de acceso/)).toHaveTextContent('beto.ciudadano')
    expect(tabla()).not.toHaveTextContent(/cédula|correo|contraseña:/i)
  })

  it('el filtro por estado muestra las revisadas y las descartadas con quién, cuándo y la nota', async () => {
    const { user } = await abrirConsola()
    await user.selectOptions(within(panel()).getByLabelText('Filtrar alertas por estado'), 'revisada')
    const revisada = await within(await within(panel()).findByRole('table', { name: 'Alertas de seguridad' })).findByRole('row', { name: /203\.0\.113\.9/ })
    expect(revisada).toHaveTextContent('Revisada')
    expect(revisada).toHaveTextContent('Por sergio.seguridad')
    expect(revisada).toHaveTextContent('Nota: Eran las pruebas de carga del equipo de calidad.')
    expect(within(revisada).queryByRole('button', { name: 'Revisar' })).not.toBeInTheDocument()
    expect(within(tabla()).getAllByRole('row')).toHaveLength(2)
    await user.selectOptions(within(panel()).getByLabelText('Filtrar alertas por estado'), 'descartada')
    expect(await within(tabla()).findByText(/Falso positivo: probaba un trámite de otra institución/)).toBeInTheDocument()
    await user.selectOptions(within(panel()).getByLabelText('Filtrar alertas por estado'), '')
    await waitFor(() => expect(within(tabla()).getAllByRole('row')).toHaveLength(7))
    expect(within(panel()).getByRole('status')).toHaveTextContent('4 alertas abiertas') // las abiertas no dependen del filtro
  })

  it('revisar exige una nota, guarda la revisión y la alerta sale de las abiertas', async () => {
    const { user } = await abrirConsola()
    await user.click(within(filaDe(/^Reuso de un token de sesión/)).getByRole('button', { name: 'Revisar' }))
    const modal = await screen.findByRole('dialog', { name: /Revisar la alerta/ })
    expect(modal).toHaveTextContent(/no se puede cambiar después/)
    const guardar = within(modal).getByRole('button', { name: 'Guardar revisión' })
    expect(guardar).toBeDisabled() // sin nota no se envía
    await user.type(within(modal).getByLabelText(/^Nota/), 'Hablé con Ana: cerró sesión en un teléfono que ya no usa.')
    expect(guardar).toBeEnabled()
    await user.click(guardar)
    expect(await screen.findByText('Alerta revisada.')).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: /Revisar la alerta/ })).not.toBeInTheDocument()
    await waitFor(() => expect(within(panel()).getByRole('status')).toHaveTextContent('3 alertas abiertas'))
    expect(within(tabla()).queryByRole('row', { name: /^Reuso de un token de sesión/ })).not.toBeInTheDocument()
  })

  it('se puede descartar como falso positivo', async () => {
    const { user } = await abrirConsola()
    await user.click(within(filaDe(/^Muchas denegaciones de acceso/)).getByRole('button', { name: 'Revisar' }))
    const modal = await screen.findByRole('dialog', { name: /Revisar la alerta/ })
    await user.click(within(modal).getByRole('radio', { name: /Descartada/ }))
    await user.type(within(modal).getByLabelText(/^Nota/), 'Probaba permisos con la cuenta de prueba.')
    await user.click(within(modal).getByRole('button', { name: 'Guardar revisión' }))
    expect(await screen.findByText('Alerta descartada.')).toBeInTheDocument()
    await user.selectOptions(within(panel()).getByLabelText('Filtrar alertas por estado'), 'descartada')
    expect(await within(tabla()).findByText(/Nota: Probaba permisos con la cuenta de prueba\./)).toBeInTheDocument()
  })

  it('el modal no se cierra mientras el servidor no responda bien: la nota escrita sigue ahí y se explica el motivo', async () => {
    const { user } = await abrirConsola()
    const original = window.fetch
    window.fetch = async (ruta, opciones) => (String(ruta).includes('/revisar/')
      ? new Response(JSON.stringify({ codigo: 'ya_revisada', detalle: 'Esta alerta ya fue revisada o descartada.' }), { status: 409, headers: { 'Content-Type': 'application/json' } })
      : original(ruta, opciones))
    await user.click(within(filaDe(/^Cuenta bloqueada varias veces/)).getByRole('button', { name: 'Revisar' }))
    const modal = await screen.findByRole('dialog', { name: /Revisar la alerta/ })
    await user.type(within(modal).getByLabelText(/^Nota/), 'Otra persona ya la había atendido.')
    await user.click(within(modal).getByRole('button', { name: 'Guardar revisión' }))
    expect(await within(modal).findByText('Esta alerta ya fue revisada o descartada.')).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: /Revisar la alerta/ })).toBeInTheDocument()
    expect(within(modal).getByLabelText(/^Nota/)).toHaveValue('Otra persona ya la había atendido.')
  })

  it('Escape cierra el modal sin guardar y el foco vuelve al botón «Revisar»', async () => {
    const { user } = await abrirConsola()
    const boton = within(filaDe(/^Cuenta bloqueada varias veces/)).getByRole('button', { name: 'Revisar' })
    await user.click(boton)
    const modal = await screen.findByRole('dialog', { name: /Revisar la alerta/ })
    expect(within(modal).getByLabelText(/^Nota/)).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: /Revisar la alerta/ })).not.toBeInTheDocument()
    expect(boton).toHaveFocus()
    expect(within(panel()).getByRole('status')).toHaveTextContent('4 alertas abiertas')
  })

  it('con el envío en curso, Escape y «Cancelar» no cierran el modal', async () => {
    const { user } = await abrirConsola()
    const original = window.fetch
    let responder
    window.fetch = (ruta, opciones) => (String(ruta).includes('/revisar/')
      ? new Promise((resolver) => { responder = () => resolver(new Response(JSON.stringify({ codigo: 'ya_revisada', detalle: 'Esta alerta ya fue revisada o descartada.' }), { status: 409, headers: { 'Content-Type': 'application/json' } })) })
      : original(ruta, opciones))
    await user.click(within(filaDe(/^Cuenta bloqueada varias veces/)).getByRole('button', { name: 'Revisar' }))
    const modal = await screen.findByRole('dialog', { name: /Revisar la alerta/ })
    await user.type(within(modal).getByLabelText(/^Nota/), 'Reviso mientras el servidor responde.')
    await user.click(within(modal).getByRole('button', { name: 'Guardar revisión' }))
    await waitFor(() => expect(within(modal).getByRole('button', { name: 'Cancelar' })).toBeDisabled())
    await user.keyboard('{Escape}')
    await user.click(within(modal).getByRole('button', { name: 'Cancelar' }))
    expect(screen.getByRole('dialog', { name: /Revisar la alerta/ })).toBeInTheDocument()
    expect(within(modal).getByLabelText(/^Nota/)).toHaveValue('Reviso mientras el servidor responde.')
    responder()
    expect(await within(modal).findByText('Esta alerta ya fue revisada o descartada.')).toBeInTheDocument()
    expect(within(modal).getByRole('button', { name: 'Cancelar' })).toBeEnabled() // terminó: vuelve a poder cerrarse
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: /Revisar la alerta/ })).not.toBeInTheDocument()
  })

  it('es accesible (axe)', async () => {
    const { container, user } = await abrirConsola()
    expect(await axe(container, AXE)).toHaveNoViolations()
    await user.click(within(filaDe(/^Reuso de un token de sesión/)).getByRole('button', { name: 'Revisar' }))
    await screen.findByRole('dialog', { name: /Revisar la alerta/ })
    expect(await axe(container, AXE)).toHaveNoViolations()
  })
})

describe('el auditor lee las alertas pero no las revisa', () => {
  it('las ve en su consola de auditoría, en solo lectura, sin botones de revisión', async () => {
    const { user } = await abrirComo('aldo.auditor', 'Auditoría')
    await reautenticar(user) // el resumen ya lo pide; la verificación sirve para las alertas
    await screen.findByText('Qué políticas deciden')
    await user.click(screen.getByRole('tab', { name: 'Alertas de seguridad' }))
    expect(await within(panel()).findByRole('table', { name: 'Alertas de seguridad' })).toBeInTheDocument()
    expect(within(tabla()).getAllByRole('row')).toHaveLength(5)
    expect(within(panel()).queryByRole('button', { name: 'Revisar' })).not.toBeInTheDocument()
    expect(within(tabla()).queryByRole('columnheader', { name: 'Acciones' })).not.toBeInTheDocument()
    expect(panel()).toHaveTextContent(/solo puedes leerlas/)
  })
})

describe('contrato del servidor de ejemplo (igual que el real)', () => {
  const llamar = (ruta, opciones) => window.fetch(ruta, opciones)
  const revisar = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ estado: 'revisada', nota: 'Una nota válida' }) }

  it('solo el operador de seguridad y el auditor las leen; los demás reciben 403', async () => {
    for (const [usuario, esperado] of [['sergio.seguridad', 200], ['aldo.auditor', 200], ['ivan.identidades', 403], ['ines.infra', 403], ['ana.ciudadana', 403], ['fabio.mop', 403]]) {
      instalarMock(usuario, { demora: 0 })
      await llamar('/auth/mfa/verificar/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ codigo: '123456' }) })
      expect((await llamar('/plataforma/alertas/')).status, usuario).toBe(esperado)
    }
  })

  it('solo el operador de seguridad revisa: el auditor y los demás reciben 403 y no se cambia nada', async () => {
    for (const usuario of ['aldo.auditor', 'ivan.identidades', 'ana.ciudadana']) {
      instalarMock(usuario, { demora: 0 })
      await llamar('/auth/mfa/verificar/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ codigo: '123456' }) })
      expect((await llamar('/plataforma/alertas/4/revisar/', revisar)).status, usuario).toBe(403)
    }
    instalarMock('sergio.seguridad', { demora: 0 })
    await llamar('/auth/mfa/verificar/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ codigo: '123456' }) })
    expect((await (await llamar('/plataforma/alertas/?estado=abierta')).json()).total).toBe(4)
  })

  it('la revisión exige nota y estado válidos, una alerta que existe y que siga abierta', async () => {
    instalarMock('sergio.seguridad', { demora: 0 })
    await llamar('/auth/mfa/verificar/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ codigo: '123456' }) })
    const con = (cuerpo) => ({ ...revisar, body: JSON.stringify(cuerpo) })
    expect((await llamar('/plataforma/alertas/4/revisar/', con({ estado: 'revisada' }))).status).toBe(400)
    expect((await llamar('/plataforma/alertas/4/revisar/', con({ estado: 'revisada', nota: '  ' }))).status).toBe(400)
    expect((await llamar('/plataforma/alertas/4/revisar/', con({ estado: 'abierta', nota: 'Reabrir no se puede' }))).status).toBe(400)
    expect((await llamar('/plataforma/alertas/999/revisar/', revisar)).status).toBe(404)
    expect((await llamar('/plataforma/alertas/4/revisar/', revisar)).status).toBe(200)
    expect((await llamar('/plataforma/alertas/4/revisar/', revisar)).status).toBe(409) // ya no está abierta
    expect((await llamar('/plataforma/alertas/?limite=0')).status).toBe(400)
    expect((await llamar('/plataforma/alertas/?estado=cerrada')).status).toBe(400)
  })
})
