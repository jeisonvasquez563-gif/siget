// Simulador de «qué pasaría si…». Las respuestas del servidor de ejemplo son capturas REALES del PDP de producción
// (src/mock-datos/simulador.json), así que estas pruebas fijan lo que el motor de decisiones responde de verdad.
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'
import { describe, expect, it, vi } from 'vitest'
import App from '../App.jsx'
import escenarios from '../escenarios.json'
import { instalarMock } from '../mock.js'
import simulado from '../mock-datos/simulador.json'
import { ProveedorUI } from '../ui.jsx'

vi.mock('qrcode', () => ({ default: { toCanvas: vi.fn() } }))
const AXE = { rules: { 'color-contrast': { enabled: false } } }

async function abrirSimulador() {
  instalarMock('saul.mop', { demora: 0 })
  const utilidades = render(<ProveedorUI><App /></ProveedorUI>)
  const nav = await screen.findByRole('navigation', { name: 'Módulos' })
  const user = userEvent.setup()
  await user.click(within(nav).getByRole('button', { name: /^Roles y permisos/ }))
  await user.click(await screen.findByRole('tab', { name: '¿Qué pasaría si…?' }))
  await screen.findByRole('heading', { name: '1. Arma la situación' })
  return { ...utilidades, user }
}
const escenario = (titulo) => screen.getByRole('button', { name: new RegExp(`^${titulo}`) })
const veredicto = () => document.querySelector('.veredicto')

describe('datos reales del simulador', () => {
  it('hay un escenario capturado de producción por cada escenario de la interfaz', () => {
    expect(simulado.casos).toHaveLength(escenarios.length)
    for (const e of escenarios) {
      const caso = simulado.casos.find((c) => JSON.stringify(Object.entries(c.entrada).sort()) === JSON.stringify(Object.entries(e.entrada).sort()))
      expect(caso, e.id).toBeTruthy()
      expect(caso.respuesta.hipotetico).toBe(true)
    }
  })

  it('solo el escenario normal se permite: los otros once muestran cada protección', () => {
    const permitidos = simulado.casos.filter((c) => c.respuesta.decision.permitido)
    expect(permitidos).toHaveLength(1)
    expect(permitidos[0].respuesta.decision.politica).toBe('funcionario_cambia_estado')
    const politicas = new Set(simulado.casos.map((c) => c.respuesta.decision.politica))
    for (const p of ['conflicto_de_interes', 'plataforma_sin_acceso_a_tramites', 'cuenta_no_activa', 'control_dual', 'sin_regla_que_permita']) expect(politicas.has(p), p).toBe(true)
  })

  it('cada traza termina con la decisión del PDP', () => {
    for (const { respuesta: r } of simulado.casos) {
      const ultimo = r.traza[r.traza.length - 1]
      expect(ultimo.politica).toBe(r.decision.politica)
      expect(ultimo.resultado === 'permite').toBe(r.decision.permitido)
    }
  })
})

describe('el simulador en pantalla', () => {
  it('arranca con una situación normal y el motor responde «Permitido»', async () => {
    await abrirSimulador()
    expect(await screen.findByText('Permitido', { selector: '.veredicto .sello' })).toBeInTheDocument()
    expect(within(veredicto()).getByText('funcionario_cambia_estado')).toBeInTheDocument()
    expect(screen.getByLabelText('Quién actúa')).toHaveValue('funcionario')
    expect(screen.getByText(/Es hipotético: no se registra ni toca ningún dato/)).toBeInTheDocument()
  })

  it('ofrece los 12 escenarios y marca el que está activo', async () => {
    const { user } = await abrirSimulador()
    expect(screen.getAllByRole('button', { name: /./ }).filter((b) => b.classList.contains('escenario'))).toHaveLength(12)
    expect(escenario('Un funcionario aprueba un trámite')).toHaveAttribute('aria-pressed', 'true')
    await user.click(escenario('…y el trámite lo pidió él mismo'))
    expect(escenario('…y el trámite lo pidió él mismo')).toHaveAttribute('aria-pressed', 'true')
    expect(escenario('Un funcionario aprueba un trámite')).toHaveAttribute('aria-pressed', 'false')
  })

  it('el conflicto de interés se niega y la traza se detiene en la regla que anula', async () => {
    const { user } = await abrirSimulador()
    await user.click(escenario('…y el trámite lo pidió él mismo'))
    expect(await screen.findByText('Negado', { selector: '.veredicto .sello' })).toBeInTheDocument()
    expect(within(veredicto()).getByText('conflicto_de_interes')).toBeInTheDocument()
    expect(within(veredicto()).getByText(/Nadie gestiona un trámite que él mismo pidió/)).toBeInTheDocument()
    const traza = screen.getByRole('heading', { name: '2. Cómo se evaluó' }).closest('section')
    expect(within(traza).getAllByText('Regla que anula').length).toBeGreaterThan(0)
    expect(within(traza).queryByText('Regla que permite')).not.toBeInTheDocument() // se detuvo antes de las reglas que permiten
    expect(within(traza).getByText('Niega')).toBeInTheDocument()
  })

  it('el segundo factor vencido se niega y «qué lo cambiaría» permite probar el cambio', async () => {
    const { user } = await abrirSimulador()
    await user.click(escenario('El segundo factor venció'))
    expect(await screen.findByText('Negado', { selector: '.veredicto .sello' })).toBeInTheDocument()
    const cambio = screen.getByRole('heading', { name: '3. Qué lo cambiaría' }).closest('section')
    expect(within(cambio).getByText(/harían que se permitiera/)).toBeInTheDocument()
    await user.click(within(cambio).getByRole('button', { name: /Probar: Segundo factor, Verificado hace 1 minuto/ }))
    expect(await screen.findByText('Permitido', { selector: '.veredicto .sello' })).toBeInTheDocument()
    expect(screen.getByLabelText('Segundo factor')).toHaveValue('reciente')
  })

  it('si está permitido, las alternativas muestran lo que lo rompería', async () => {
    await abrirSimulador()
    const cambio = (await screen.findByRole('heading', { name: '3. Qué lo cambiaría' })).closest('section')
    expect(within(cambio).getByText(/harían que se negara/)).toBeInTheDocument()
    expect(within(cambio).getAllByText(/Estado de la cuenta:/).length).toBeGreaterThan(0)
    expect(within(cambio).getAllByText('cuenta_no_activa').length).toBeGreaterThan(0)
    expect(within(cambio).getAllByText('conflicto_de_interes').length).toBeGreaterThan(0)
  })

  it('un rol de plataforma que quiere ver un trámite recibe la política que lo prohíbe, explicada', async () => {
    const { user } = await abrirSimulador()
    await user.click(escenario('El operador de infraestructura quiere ver un trámite'))
    expect(await screen.findByText('Negado', { selector: '.veredicto .sello' })).toBeInTheDocument()
    expect(within(veredicto()).getByText('plataforma_sin_acceso_a_tramites')).toBeInTheDocument()
    expect(within(veredicto()).getByText(/Ningún rol de plataforma ve trámites/)).toBeInTheDocument()
  })

  it('el control dual se explica y una cuenta bloqueada no puede nada', async () => {
    const { user } = await abrirSimulador()
    await user.click(escenario('Un operador aprueba un alta que él propuso'))
    expect(await within(veredicto()).findByText('control_dual')).toBeInTheDocument()
    await user.click(escenario('Una cuenta bloqueada intenta iniciar un trámite'))
    expect(await within(veredicto()).findByText('cuenta_no_activa')).toBeInTheDocument()
  })

  it('el formulario solo muestra las variables que importan para la acción elegida', async () => {
    const { user } = await abrirSimulador()
    expect(screen.getByLabelText('Estado actual del trámite')).toBeInTheDocument()
    expect(screen.getByLabelText('Estado al que se quiere pasar')).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Qué intenta hacer'), 'ver_tramite')
    expect(screen.queryByLabelText('Estado actual del trámite')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Nivel de aseguramiento')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Institución del recurso')).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Qué intenta hacer'), 'consultar_auditoria')
    expect(screen.getByLabelText('Nivel de aseguramiento')).toBeInTheDocument()
    expect(screen.queryByLabelText('Institución del recurso')).not.toBeInTheDocument()
  })

  it('cambiar de rol conserva las circunstancias que siguen valiendo', async () => {
    const { user } = await abrirSimulador()
    await user.selectOptions(screen.getByLabelText('Segundo factor'), 'vencido')
    await user.selectOptions(screen.getByLabelText('Quién actúa'), 'supervisor')
    expect(screen.getByLabelText('Segundo factor')).toHaveValue('vencido')
  })

  it('el auditor parte de nivel 3 y la ciudadanía de «el trámite es suyo»', async () => {
    const { user } = await abrirSimulador()
    await user.selectOptions(screen.getByLabelText('Quién actúa'), 'ciudadano')
    await user.selectOptions(screen.getByLabelText('Qué intenta hacer'), 'ver_tramite')
    expect(screen.getByLabelText('Quién pidió el trámite')).toHaveValue('yo')
    await user.selectOptions(screen.getByLabelText('Quién actúa'), 'auditor')
    await user.selectOptions(screen.getByLabelText('Qué intenta hacer'), 'consultar_auditoria')
    expect(screen.getByLabelText('Nivel de aseguramiento')).toHaveValue('3')
  })

  it('en modo de ejemplo avisa cuando se sale de los escenarios capturados', async () => {
    const { user } = await abrirSimulador()
    await user.selectOptions(screen.getByLabelText('Estado actual del trámite'), 'Rechazado')
    expect(await screen.findByText(/Modo de ejemplo: solo responde a los escenarios predefinidos/)).toBeInTheDocument()
  })

  it('es accesible (axe)', async () => {
    const { container } = await abrirSimulador()
    await screen.findByText('Permitido', { selector: '.veredicto .sello' })
    await screen.findByRole('heading', { name: '3. Qué lo cambiaría' })
    expect(await axe(container, AXE)).toHaveNoViolations()
  })
})
