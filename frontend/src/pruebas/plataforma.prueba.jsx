// Consolas de los operadores de plataforma: cada rol ve la suya, el control dual se explica y se respeta en pantalla,
// y la recuperación de contraseña funciona de punta a punta contra el servidor de ejemplo (src/mock.js).
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'
import { describe, expect, it, vi } from 'vitest'
import App from '../App.jsx'
import { instalarMock } from '../mock.js'
import { ProveedorUI } from '../ui.jsx'

vi.mock('qrcode', () => ({ default: { toCanvas: vi.fn() } }))
const AXE = { rules: { 'color-contrast': { enabled: false } } }

async function abrirConsola(usuario, modulo) {
  instalarMock(usuario, { demora: 0 })
  const utilidades = render(<ProveedorUI><App /></ProveedorUI>)
  const nav = await screen.findByRole('navigation', { name: 'Módulos' })
  const user = userEvent.setup()
  await user.click(within(nav).getByRole('button', { name: new RegExp(`^${modulo}`) }))
  return { ...utilidades, user, nav }
}

const filaDe = (usuario) => screen.getByRole('row', { name: new RegExp(`^${usuario}`) })

describe('cada rol de plataforma tiene su consola', () => {
  const casos = [
    ['ines.infra', 'Infraestructura', /Estado de la base de datos y del servicio/],
    ['ivan.identidades', 'Identidades', /Ayuda a recuperar una cuenta/],
    ['cata.catalogo', 'Catálogo', /Propón y aprueba, entre dos personas/],
    ['sergio.seguridad', 'Respuesta a incidentes', /Bloquea cuentas, cierra sesiones/],
    ['silvia.secretos', 'Custodia de secretos', /nunca hay valores/],
  ]
  for (const [usuario, modulo, texto] of casos) {
    it(`${usuario} abre «${modulo}» y ya no es «pronto»`, async () => {
      const { nav } = await abrirConsola(usuario, modulo)
      expect(within(nav).getByRole('button', { name: new RegExp(`^${modulo}`) })).not.toHaveTextContent('pronto')
      expect(await screen.findByText(texto)).toBeInTheDocument()
    })
  }
})

describe('identidades', () => {
  it('lista personas sin datos personales y emite un código que se muestra una sola vez', async () => {
    const { user } = await abrirConsola('ivan.identidades', 'Identidades')
    const fila = await screen.findByRole('row', { name: /^ana\.ciudadana/ })
    expect(fila).toHaveTextContent('Activa')
    expect(screen.queryByText(/cédula|correo/i)).not.toBeInTheDocument()
    await user.click(within(fila).getByRole('button', { name: 'Código de contraseña' }))
    const modal = await screen.findByRole('dialog', { name: /Código de restablecimiento/ })
    expect(within(modal).getByText('K7MQ-2XWD-9PRT')).toBeInTheDocument()
    expect(modal).toHaveTextContent(/No se vuelve a mostrar/)
    await user.click(within(modal).getByRole('button', { name: /ya se lo entregué/ }))
    expect(screen.queryByRole('dialog', { name: /Código de restablecimiento/ })).not.toBeInTheDocument()
  })

  it('nadie actúa sobre su propia cuenta: en su fila no hay botones', async () => {
    await abrirConsola('ivan.identidades', 'Identidades')
    const propia = await screen.findByRole('row', { name: /^ivan\.identidades/ })
    expect(within(propia).queryByRole('button')).not.toBeInTheDocument()
    expect(propia).toHaveTextContent('Eres tú')
  })

  it('restablecer el segundo factor pide confirmar y explica las consecuencias', async () => {
    const { user } = await abrirConsola('ivan.identidades', 'Identidades')
    await user.click(within(await screen.findByRole('row', { name: /^beto\.ciudadano/ })).getByRole('button', { name: /Restablecer 2\.º factor/ }))
    const dialogo = await screen.findByRole('alertdialog')
    expect(dialogo).toHaveTextContent(/dejará de servir/)
    await user.click(within(dialogo).getByRole('button', { name: 'Restablecer' }))
    expect(await screen.findByText(/Segundo factor de beto.ciudadano restablecido/)).toBeInTheDocument()
    expect(within(filaDe('beto.ciudadano')).queryByRole('button', { name: /Restablecer 2\.º factor/ })).not.toBeInTheDocument() // ya no está activo
  })

  it('control dual: quien NO propuso aprueba y el alta queda resuelta a su nombre', async () => {
    const { user } = await abrirConsola('ivan.identidades', 'Identidades')
    const item = (await screen.findByText(/Alta de flor\.mop como coordinadora/)).closest('li')
    expect(item).toHaveTextContent('Propuesta por irene.identidades')
    await user.click(within(item).getByRole('button', { name: 'Aprobar' }))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Aprobar' }))
    expect(await screen.findByText(/Propuesta aprobada y aplicada/)).toBeInTheDocument()
    expect(item).toHaveTextContent('Aprobada')
    expect(item).toHaveTextContent('resuelta por ti')
  })

  it('control dual: quien propuso no ve el botón de aprobar y se le explica por qué', async () => {
    await abrirConsola('irene.identidades', 'Identidades')
    const item = (await screen.findByText(/Alta de flor\.mop como coordinadora/)).closest('li')
    expect(within(item).queryByRole('button', { name: 'Aprobar' })).not.toBeInTheDocument()
    expect(item).toHaveTextContent('La debe resolver otra persona')
    expect(item).toHaveTextContent('Propuesta por ti')
  })

  it('proponer un alta de coordinadora la deja pendiente', async () => {
    const { user } = await abrirConsola('ivan.identidades', 'Identidades')
    await user.type(await screen.findByLabelText('Usuario de la persona'), 'saul.mop')
    await user.selectOptions(screen.getByLabelText('Institución que coordinará'), 'MOP')
    await user.click(screen.getByRole('button', { name: 'Proponer alta' }))
    expect(await screen.findByText(/Propuesta enviada: falta que otra persona la apruebe/)).toBeInTheDocument()
    const item = (await screen.findByText(/Alta de saul\.mop como coordinadora/)).closest('li')
    expect(item).toHaveTextContent('Pendiente')
    expect(item).toHaveTextContent('La debe resolver otra persona')
  })

  it('una propuesta inválida muestra lo que dijo el servidor', async () => {
    const { user } = await abrirConsola('ivan.identidades', 'Identidades')
    await user.type(await screen.findByLabelText('Usuario de la persona'), 'nadie.existe')
    await user.selectOptions(screen.getByLabelText('Institución que coordinará'), 'MOP')
    await user.click(screen.getByRole('button', { name: 'Proponer alta' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/no existe esa persona/)
  })

  it('es accesible (axe)', async () => {
    const { container } = await abrirConsola('ivan.identidades', 'Identidades')
    await screen.findByRole('row', { name: /^ana\.ciudadana/ })
    expect(await axe(container, AXE)).toHaveNoViolations()
  })
})

describe('catálogo', () => {
  it('la institución propuesta por otra persona se aprueba; la propia no', async () => {
    const { user } = await abrirConsola('cata.catalogo', 'Catálogo')
    const item = (await screen.findByText(/Autoridad de Turismo/, { selector: 'strong' })).closest('li')
    await user.click(within(item).getByRole('button', { name: 'Aprobar' }))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Aprobar' }))
    expect(await screen.findByText(/Propuesta aprobada y aplicada/)).toBeInTheDocument()
  })

  it('proponer una institución nueva exige nombre válido', async () => {
    const { user } = await abrirConsola('cata.catalogo', 'Catálogo')
    await user.type(await screen.findByLabelText('Nombre de la institución'), 'Instituto de Pruebas')
    await user.click(screen.getByRole('button', { name: 'Proponer institución' }))
    expect(await screen.findByText(/Propuesta enviada/)).toBeInTheDocument()
    const propia = (await screen.findByText(/Instituto de Pruebas/, { selector: 'strong' })).closest('li')
    expect(within(propia).queryByRole('button', { name: 'Aprobar' })).not.toBeInTheDocument()
  })
})

describe('seguridad', () => {
  it('bloquear pide un motivo, deja la cuenta bloqueada y se puede desbloquear', async () => {
    const { user } = await abrirConsola('sergio.seguridad', 'Respuesta a incidentes')
    await user.click(within(await screen.findByRole('row', { name: /^beto\.ciudadano/ })).getByRole('button', { name: 'Bloquear' }))
    const modal = await screen.findByRole('dialog', { name: /Bloquear a beto.ciudadano/ })
    await user.type(within(modal).getByLabelText('Motivo'), 'Actividad sospechosa en la cuenta')
    await user.click(within(modal).getByRole('button', { name: 'Bloquear cuenta' }))
    expect(await screen.findByText(/beto.ciudadano quedó bloqueada/)).toBeInTheDocument()
    const fila = filaDe('beto.ciudadano')
    expect(fila).toHaveTextContent('Bloqueada')
    await user.click(within(fila).getByRole('button', { name: 'Desbloquear' }))
    expect(await screen.findByText(/beto.ciudadano se desbloqueó/)).toBeInTheDocument()
    expect(filaDe('beto.ciudadano')).toHaveTextContent('Activa')
  })

  it('cerrar sesiones pide confirmar', async () => {
    const { user } = await abrirConsola('sergio.seguridad', 'Respuesta a incidentes')
    await user.click(within(await screen.findByRole('row', { name: /^fabio\.mop/ })).getByRole('button', { name: 'Cerrar sesiones' }))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Cerrar sesiones' }))
    expect(await screen.findByText('Sesiones cerradas.')).toBeInTheDocument()
  })

  it('muestra los eventos de seguridad recientes', async () => {
    await abrirConsola('sergio.seguridad', 'Respuesta a incidentes')
    expect(await screen.findByRole('table', { name: /Últimos eventos de seguridad/ })).toBeInTheDocument()
    expect(screen.getAllByText('login_ok').length).toBeGreaterThan(0)
  })
})

describe('secretos e infraestructura', () => {
  it('los 8 secretos empiezan sin registro y al registrar una rotación quedan al día, sin mostrar valores', async () => {
    const { user } = await abrirConsola('silvia.secretos', 'Custodia de secretos')
    const tabla = await screen.findByRole('table', { name: /Secretos, última rotación y estado/ })
    expect(within(tabla).getAllByText('Sin registro')).toHaveLength(8)
    await user.selectOptions(screen.getByLabelText('Secreto'), 'jwt')
    await user.type(screen.getByLabelText(/Nota/), 'Rotación del trimestre')
    await user.click(screen.getByRole('button', { name: 'Registrar rotación' }))
    expect(await screen.findByText('Rotación registrada.')).toBeInTheDocument()
    expect(await within(await screen.findByRole('row', { name: /Clave de firma de los tokens/ })).findByText('Al día')).toBeInTheDocument()
  })

  it('infraestructura muestra la base, el cifrado de la conexión y el certificado', async () => {
    await abrirConsola('ines.infra', 'Infraestructura')
    expect(await screen.findByText('Responde')).toBeInTheDocument()
    expect(screen.getByText('TLSv1.3')).toBeInTheDocument()
    expect(screen.getByText('363')).toBeInTheDocument()
  })
})

describe('recuperar la contraseña', () => {
  async function irARecuperar() {
    instalarMock(null, { demora: 0 })
    render(<ProveedorUI><App /></ProveedorUI>)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: '¿Olvidaste tu contraseña?' }))
    return user
  }

  it('con un código válido fija la contraseña nueva y vuelve a ingresar', async () => {
    const user = await irARecuperar()
    expect(screen.getByRole('heading', { name: 'Recupera tu contraseña' })).toBeInTheDocument()
    await user.type(screen.getByLabelText('Usuario'), 'ana.ciudadana')
    await user.type(screen.getByLabelText(/Código de restablecimiento/), 'k7mq2xwd9prt')
    await user.type(screen.getByLabelText('Contraseña nueva'), 'una-frase-larga-y-unica')
    await user.click(screen.getByRole('button', { name: 'Restablecer contraseña' }))
    expect(await screen.findByText(/Contraseña restablecida/)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Ingresa a tu cuenta' })).toBeInTheDocument()
  })

  it('un código inválido, ya usado o vencido se explica sin revelar la causa', async () => {
    const user = await irARecuperar()
    await user.type(screen.getByLabelText('Usuario'), 'ana.ciudadana')
    await user.type(screen.getByLabelText(/Código de restablecimiento/), 'AAAABBBBCCCC')
    await user.type(screen.getByLabelText('Contraseña nueva'), 'una-frase-larga-y-unica')
    await user.click(screen.getByRole('button', { name: 'Restablecer contraseña' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/no es válido, ya se usó o venció/)
  })

  it('«Volver a ingresar» regresa al acceso', async () => {
    const user = await irARecuperar()
    await user.click(screen.getByRole('button', { name: 'Volver a ingresar' }))
    expect(await screen.findByRole('heading', { name: 'Ingresa a tu cuenta' })).toBeInTheDocument()
  })
})
