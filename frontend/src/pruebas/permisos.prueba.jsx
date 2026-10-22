// Roles y permisos, base de datos y segundo factor. Los datos de la matriz y de la base son una captura REAL de producción
// (src/mock-datos/*.json, generados con demo-local/capturar_fixtures.py), así que estas pruebas fijan lo que el sistema dice de verdad.
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'
import { describe, expect, it, vi } from 'vitest'
import App from '../App.jsx'
import { instalarMock } from '../mock.js'
import matriz from '../mock-datos/matriz.json'
import bd from '../mock-datos/base-de-datos.json'
import { rolDeMatriz } from '../Permisos.jsx'
import { ProveedorUI } from '../ui.jsx'

vi.mock('qrcode', () => ({ default: { toCanvas: vi.fn() } }))
const AXE = { rules: { 'color-contrast': { enabled: false } } }

async function abrirComo(usuario, modulo) {
  instalarMock(usuario, { demora: 0 })
  const utilidades = render(<ProveedorUI><App /></ProveedorUI>)
  const nav = await screen.findByRole('navigation', { name: 'Módulos' })
  const user = userEvent.setup()
  await user.click(within(nav).getByRole('button', { name: new RegExp(`^${modulo}`) }))
  return { ...utilidades, user }
}

describe('datos reales: lo que dice la política', () => {
  it('ningún rol puede las 18 acciones (no hay superusuario)', () => {
    expect(matriz.ningun_rol_puede_todo).toBe(true)
    expect(matriz.roles).toHaveLength(10)
    for (const r of matriz.roles) expect(r.acciones_permitidas).toBeLessThan(r.acciones_totales)
  })

  it('ningún rol de la base de datos es superusuario ni omite la seguridad por filas', () => {
    expect(bd.ningun_rol_de_aplicacion_es_superusuario).toBe(true)
    for (const r of bd.roles) expect(r.superusuario || r.omite_rls).toBe(false)
  })

  it('el registro es de solo inserción para los roles que se conectan', () => {
    for (const rol of ['app_role', 'auditor_role', 'checkpoint_app', 'pgadmin_lectura']) {
      for (const tabla of ['decision_pdp', 'evento_auditoria', 'evento_seguridad']) {
        expect(bd.privilegios[rol][tabla].UPDATE, `${rol} ${tabla}`).toBe('no')
        expect(bd.privilegios[rol][tabla].DELETE, `${rol} ${tabla}`).toBe('no')
      }
    }
  })

  it('rolDeMatriz elige el rol que corresponde a cada persona', () => {
    expect(rolDeMatriz({ rol_plataforma: 'auditor', membresias: [] })).toBe('auditor')
    expect(rolDeMatriz({ rol_plataforma: 'ninguno', membresias: [] })).toBe('ciudadano')
    expect(rolDeMatriz({ rol_plataforma: 'ninguno', membresias: [{ rol: 'ciudadano' }] })).toBe('ciudadano') // ciudadanía con membresía en una institución
    expect(rolDeMatriz({ rol_plataforma: 'ninguno', membresias: [{ rol: 'funcionario' }, { rol: 'supervisor' }] })).toBe('supervisor')
    expect(rolDeMatriz({ rol_plataforma: 'ninguno', membresias: [{ rol: 'coordinador_institucional' }] })).toBe('coordinador_institucional')
  })
})

describe('roles y módulos', () => {
  it('muestra los 10 roles, el aviso de que no hay superusuario y marca «tu rol»', async () => {
    await abrirComo('fabio.mop', 'Roles y permisos')
    expect(await screen.findByText(/No existe un superusuario/)).toBeInTheDocument()
    expect(screen.getAllByRole('article')).toHaveLength(10)
    const tuya = screen.getByRole('article', { name: 'Funcionario' })
    expect(within(tuya).getByText('Tu rol')).toBeInTheDocument()
    expect(within(screen.getByRole('article', { name: 'Auditor' })).queryByText('Tu rol')).not.toBeInTheDocument()
  })

  it('cada rol lista sus módulos y cuántas acciones puede', async () => {
    await abrirComo('ana.ciudadana', 'Roles y permisos')
    const auditor = await screen.findByRole('article', { name: 'Auditor' })
    expect(within(auditor).getByText('Auditoría')).toBeInTheDocument()
    expect(within(auditor).queryByText('Mis trámites')).not.toBeInTheDocument()
    expect(within(auditor).getByRole('progressbar', { name: /2 de 18/ })).toBeInTheDocument()
    expect(within(screen.getByRole('article', { name: 'Supervisor' })).getByRole('progressbar', { name: /6 de 18/ })).toBeInTheDocument()
  })
})

describe('módulos por rol', () => {
  it('la tabla cruza los 15 módulos con los 10 roles y cuadra con la vista por rol', async () => {
    const { user } = await abrirComo('ana.ciudadana', 'Roles y permisos')
    await user.click(await screen.findByRole('tab', { name: 'Módulos por rol' }))
    const tabla = await screen.findByRole('table', { name: /Módulos por rol/ })
    expect(within(tabla).getAllByRole('columnheader')).toHaveLength(12)
    expect(within(tabla).getAllByRole('row')).toHaveLength(1 + matriz.modulos.length + 1)
    const supervision = within(tabla).getByRole('row', { name: /^Supervisión/ })
    expect(within(supervision).getByRole('img', { name: 'Supervisor · Supervisión: ve el módulo' })).toBeInTheDocument()
    expect(within(supervision).getByRole('img', { name: 'Funcionario · Supervisión: no lo ve' })).toBeInTheDocument()
    for (const m of matriz.modulos) expect(m.roles.length).toBeGreaterThan(0)
  })
})

describe('matriz de permisos', () => {
  async function abrirMatriz(usuario = 'fabio.mop') {
    const o = await abrirComo(usuario, 'Roles y permisos')
    await o.user.click(await screen.findByRole('tab', { name: 'Matriz de permisos' }))
    return o
  }
  const celda = (rol, accion) => screen.getByRole('button', { name: new RegExp(`^${rol} · ${accion}:`) })

  it('la ciudadanía no puede cambiar el estado y un rol de plataforma no ve trámites', async () => {
    await abrirMatriz()
    expect(celda('Ciudadanía', 'Cambiar el estado de un trámite')).toHaveAccessibleName(/negado/)
    expect(celda('Operador de seguridad', 'Ver un trámite')).toHaveAccessibleName(/plataforma_sin_acceso_a_tramites/)
    expect(celda('Funcionario', 'Cambiar el estado de un trámite')).toHaveAccessibleName(/permitido, exige segundo factor reciente/)
  })

  it('al elegir una celda explica qué política decidió y por qué', async () => {
    const { user } = await abrirMatriz()
    await user.click(celda('Coordinación', 'Ver un trámite'))
    const panel = screen.getByRole('heading', { name: /Coordinación · Ver un trámite/ }).closest('section')
    expect(within(panel).getByText('Negado')).toBeInTheDocument()
    expect(within(panel).getByText(/sin_regla_que_permita/)).toBeInTheDocument()
    expect(within(panel).getByText(/denegar por defecto/)).toBeInTheDocument()

    await user.click(celda('Supervisor', 'Reasignar un trámite'))
    const reasignar = screen.getByRole('heading', { name: /Supervisor · Reasignar un trámite/ }).closest('section')
    expect(within(reasignar).getByText('Permitido')).toBeInTheDocument()
    expect(within(reasignar).getByText(/Exige un código verificado en los últimos 15 minutos/)).toBeInTheDocument()
  })

  it('«Fuera de su ámbito» muestra que el funcionario no ve trámites de otra institución', async () => {
    const { user } = await abrirMatriz()
    expect(celda('Funcionario', 'Ver un trámite')).toHaveAccessibleName(/: permitido/)
    await user.click(screen.getByRole('button', { name: 'Fuera de su ámbito' }))
    expect(celda('Funcionario', 'Ver un trámite')).toHaveAccessibleName(/: negado/)
    expect(screen.getByText('De otra institución o de otra persona')).toBeInTheDocument()
  })

  it('el control dual: nadie aprueba un alta que él mismo propuso', async () => {
    const { user } = await abrirMatriz()
    await user.click(screen.getByRole('button', { name: 'Fuera de su ámbito' }))
    await user.click(celda('Operador de identidades', 'Aprobar un alta'))
    const panel = screen.getByRole('heading', { name: /Operador de identidades · Aprobar un alta/ }).closest('section')
    expect(within(panel).getByText(/control_dual/)).toBeInTheDocument()
    expect(within(panel).getByText(/Quien propone un alta no puede aprobarla/)).toBeInTheDocument()
  })

  it('resalta la columna del rol de quien mira', async () => {
    await abrirMatriz('aldo.auditor')
    const encabezado = screen.getByRole('columnheader', { name: /^Auditor\s*tú$/ })
    expect(encabezado).toHaveClass('col-tuya')
    expect(within(encabezado).getByText('tú')).toBeInTheDocument()
  })

  it('es accesible (axe)', async () => {
    const { container } = await abrirMatriz()
    expect(await axe(container, AXE)).toHaveNoViolations()
  })
})

describe('permisos de la base de datos', () => {
  async function abrirBd() {
    const o = await abrirComo('saul.mop', 'Roles y permisos')
    await o.user.click(await screen.findByRole('tab', { name: 'Base de datos' }))
    await screen.findByText(/Ningún rol de la aplicación es superusuario/)
    return o
  }
  const fila = (tabla) => screen.getByRole('row', { name: new RegExp(`^${tabla}`) })

  it('app_role solo inserta decisiones y no borra nada; el registro es de solo inserción', async () => {
    await abrirBd()
    expect(screen.getByText(/Superusuario:/).closest('li')).toHaveTextContent('no')
    const decisiones = within(fila('decision_pdp')).getAllByRole('cell')
    expect(decisiones.map((c) => c.textContent).slice(0, 4)).toEqual(['sí', 'sí', '—', '—']) // leer, insertar, no modificar, no borrar
    expect(within(fila('usuario')).getAllByRole('cell')[2]).toHaveTextContent('cols.') // modificar solo algunas columnas
  })

  it('auditor_role solo lee: ninguna fila le permite insertar, modificar ni borrar', async () => {
    const { user } = await abrirBd()
    await user.click(screen.getByRole('button', { name: 'auditor_role' }))
    const filas = screen.getAllByRole('row').slice(1)
    for (const f of filas) {
      const celdas = within(f).getAllByRole('cell').slice(1, 4).map((c) => c.textContent)
      expect(celdas, f.textContent).toEqual(['—', '—', '—'].map((x, i) => (f.textContent.startsWith('usuario') && i === 0 ? x : x)).slice(0, 3))
    }
    expect(within(fila('decision_pdp')).getAllByRole('cell')[0]).toHaveTextContent('sí')
    expect(within(fila('tramite')).getAllByRole('cell')[0]).toHaveTextContent('—') // no lee trámites
    expect(within(fila('usuario')).getAllByRole('cell')[0]).toHaveTextContent('cols.') // solo algunas columnas de las personas
  })

  it('el dueño de las tablas explica por qué tiene permisos y aun así no altera el registro', async () => {
    const { user } = await abrirBd()
    await user.click(screen.getByRole('button', { name: 'siget_owner' }))
    expect(screen.getByText(/no puede iniciar sesión, y los disparadores/)).toBeInTheDocument()
    expect(screen.getByText(/Puede iniciar sesión:/).closest('li')).toHaveTextContent('no')
  })

  it('muestra la seguridad por filas y los disparadores de cada tabla', async () => {
    await abrirBd()
    expect(within(fila('tramite')).getByText(/políticas/)).toBeInTheDocument()
    expect(within(fila('evento_auditoria')).getByText(/políticas/)).toBeInTheDocument()
  })

  it('es accesible (axe)', async () => {
    const { container } = await abrirBd()
    expect(await axe(container, AXE)).toHaveNoViolations()
  })
})

describe('lo técnico no es para la ciudadanía', () => {
  it('la ciudadanía no ve las pestañas «Matriz de permisos» ni «Base de datos», pero sí las demás', async () => {
    await abrirComo('ana.ciudadana', 'Roles y permisos')
    await screen.findByRole('tab', { name: 'Roles y módulos' })
    expect(screen.queryByRole('tab', { name: 'Matriz de permisos' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Base de datos' })).not.toBeInTheDocument()
    for (const n of ['Módulos por rol', '¿Qué pasaría si…?', 'Cómo se decide']) expect(screen.getByRole('tab', { name: n })).toBeInTheDocument()
  })

  it('el personal sí las ve', async () => {
    for (const usuario of ['fabio.mop', 'ines.infra', 'aldo.auditor']) {
      const { unmount } = await abrirComo(usuario, 'Roles y permisos')
      expect(await screen.findByRole('tab', { name: 'Matriz de permisos' })).toBeInTheDocument()
      expect(screen.getByRole('tab', { name: 'Base de datos' })).toBeInTheDocument()
      unmount()
    }
  })

  it('la ciudadanía ni siquiera pide los permisos de la base al servidor', async () => {
    const pedidos = []
    const original = window.fetch
    instalarMock('ana.ciudadana', { demora: 0 })
    const mock = window.fetch
    window.fetch = (ruta, op) => { pedidos.push(String(ruta)); return mock(ruta, op) }
    render(<ProveedorUI><App /></ProveedorUI>)
    const nav = await screen.findByRole('navigation', { name: 'Módulos' })
    await userEvent.setup().click(within(nav).getByRole('button', { name: /^Roles y permisos/ }))
    await screen.findByRole('tab', { name: 'Roles y módulos' })
    expect(pedidos.some((r) => r.includes('/politicas/matriz/'))).toBe(true)
    expect(pedidos.some((r) => r.includes('/politicas/base-de-datos/'))).toBe(false)
    window.fetch = original
  })
})

describe('cómo se decide', () => {
  it('explica las cinco capas y las reglas que anulan todo', async () => {
    const { user } = await abrirComo('ana.ciudadana', 'Roles y permisos')
    await user.click(await screen.findByRole('tab', { name: 'Cómo se decide' }))
    expect(screen.getAllByText(/Si esta capa fallara/)).toHaveLength(5)
    expect(await screen.findByText('conflicto_de_interes')).toBeInTheDocument()
    expect(screen.getByText(/Ningún rol de plataforma ve trámites/)).toBeInTheDocument()
  })
})

describe('segundo factor (MFA)', () => {
  it('explica cómo funciona y muestra el estado de la cuenta', async () => {
    await abrirComo('fabio.mop', 'Segundo factor')
    expect(await screen.findByRole('heading', { name: 'Segundo factor (MFA)' })).toBeInTheDocument()
    expect(screen.getByText('Activo')).toBeInTheDocument()
    for (const paso of ['Alta', 'El código', 'Verificación', 'Anti-repetición', 'Bloqueo', 'Reautenticación escalonada']) {
      expect(screen.getByRole('heading', { name: paso })).toBeInTheDocument()
    }
    expect(screen.getByText('Personal de las instituciones').closest('li')).toHaveTextContent('Siempre')
  })

  it('un código válido renueva la ventana y luego se demuestra que no se puede reutilizar', async () => {
    const { user } = await abrirComo('fabio.mop', 'Segundo factor')
    await user.type(await screen.findByLabelText(/Código de 6 dígitos/), '123456')
    await user.click(screen.getByRole('button', { name: 'Verificar mi código' }))
    expect(await screen.findByText(/Código verificado: tu ventana de 15 minutos se renovó/)).toBeInTheDocument()

    await user.click(await screen.findByRole('button', { name: 'Enviar el mismo código de nuevo' }))
    expect(await screen.findByText(/Rechazado, como debe ser/)).toBeInTheDocument()
  })

  it('un código incorrecto se explica y no ofrece la prueba de reuso', async () => {
    const { user } = await abrirComo('fabio.mop', 'Segundo factor')
    await user.type(await screen.findByLabelText(/Código de 6 dígitos/), '000000')
    await user.click(screen.getByRole('button', { name: 'Verificar mi código' }))
    expect(await screen.findByText(/Ese código no sirve/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Enviar el mismo código de nuevo' })).not.toBeInTheDocument()
  })

  it('advierte que tres códigos incorrectos bloquean la cuenta', async () => {
    await abrirComo('ana.ciudadana', 'Segundo factor')
    expect(await screen.findByText(/tres códigos incorrectos seguidos bloquean tu cuenta/i)).toBeInTheDocument()
  })

  it('muestra la actividad de seguridad propia y resalta lo sospechoso', async () => {
    await abrirComo('fabio.mop', 'Segundo factor')
    expect(await screen.findByText('Segundo factor verificado')).toBeInTheDocument()
    const fallido = screen.getByText('Inicio de sesión fallido').closest('li')
    expect(fallido).toHaveClass('alerta')
    expect(screen.getAllByText('Inicio de sesión')[0].closest('li')).not.toHaveClass('alerta')
  })

  it('es accesible (axe)', async () => {
    const { container } = await abrirComo('fabio.mop', 'Segundo factor')
    await screen.findByText('Segundo factor verificado')
    expect(await axe(container, AXE)).toHaveNoViolations()
  })
})

describe('la ventana del segundo factor viene del servidor', () => {
  it('el anillo y el texto usan la ventana configurada, no un número fijo', async () => {
    const { VentanaMfa } = await import('../Otras.jsx')
    const hace1 = new Date(Date.now() - 60000).toISOString()
    const { container, unmount } = render(<VentanaMfa verificadoEn={hace1} ventana={2} />)
    expect(container.querySelector('svg')).toHaveAttribute('aria-label', expect.stringMatching(/quedan 1 minutos/))
    expect(screen.getByText(/de los últimos 2 minutos/)).toBeInTheDocument()
    unmount()
    const vencido = render(<VentanaMfa verificadoEn={new Date(Date.now() - 5 * 60000).toISOString()} ventana={2} />)
    expect(vencido.container.querySelector('svg')).toHaveAttribute('aria-label', 'Segundo factor vencido')
  })

  it('la pantalla de MFA y la matriz hablan de la ventana que informa el servidor', async () => {
    await abrirComo('fabio.mop', 'Segundo factor')
    expect(await screen.findByText(/código de los últimos 15 minutos/)).toBeInTheDocument()
  })
})
