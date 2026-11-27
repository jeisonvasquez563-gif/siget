// Mis documentos, Indicadores de la institución y Ayuda: quién los ve, qué muestran y que se puedan usar (teclado, lector de pantalla)
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App.jsx'
import { Ayuda } from '../Ayuda.jsx'
import { Indicadores } from '../Indicadores.jsx'
import { instalarMock } from '../mock.js'
import { ProveedorUI } from '../ui.jsx'

vi.mock('qrcode', () => ({ default: { toCanvas: vi.fn() } }))
const AXE = { rules: { 'color-contrast': { enabled: false } } } // jsdom no calcula colores: el contraste se revisa en el navegador

async function abrir(usuario, modulo) {
  instalarMock(usuario, { demora: 0 })
  const utilidades = render(<ProveedorUI><App /></ProveedorUI>)
  const nav = await screen.findByRole('navigation', { name: 'Módulos' })
  const user = userEvent.setup()
  await user.click(within(nav).getByRole('button', { name: new RegExp(`^${modulo}`) }))
  return { ...utilidades, user, nav }
}

const entrada = (nav, nombre) => within(nav).queryByRole('button', { name: new RegExp(`^${nombre}`) })

describe('el menú', () => {
  it('«Mis documentos» es de las cuentas sin rol de plataforma y «Ayuda» es de todas', async () => {
    for (const [usuario, mis, ayuda] of [['ana.ciudadana', true, true], ['fabio.mop', true, true], ['carla.mop', true, true], ['ines.infra', false, true], ['aldo.auditor', false, true]]) {
      instalarMock(usuario, { demora: 0 })
      const { unmount } = render(<ProveedorUI><App /></ProveedorUI>)
      const nav = await screen.findByRole('navigation', { name: 'Módulos' })
      expect(!!entrada(nav, 'Mis documentos'), `${usuario} · Mis documentos`).toBe(mis)
      expect(!!entrada(nav, 'Ayuda'), `${usuario} · Ayuda`).toBe(ayuda)
      unmount()
    }
  })

  it('«Indicadores» es de la supervisión y de la coordinación, y de nadie más', async () => {
    for (const [usuario, ve] of [['saul.mop', true], ['carla.mop', true], ['fabio.mop', false], ['ana.ciudadana', false], ['felix.minsa', false], ['ines.infra', false], ['aldo.auditor', false]]) {
      instalarMock(usuario, { demora: 0 })
      const { unmount } = render(<ProveedorUI><App /></ProveedorUI>)
      const nav = await screen.findByRole('navigation', { name: 'Módulos' })
      expect(!!entrada(nav, 'Indicadores'), usuario).toBe(ve)
      unmount()
    }
  })

  it('«Mis documentos» queda en «Mi espacio», «Indicadores» en «Mi institución» y «Ayuda» en su propia sección', async () => {
    instalarMock('saul.mop', { demora: 0 })
    render(<ProveedorUI><App /></ProveedorUI>)
    const nav = await screen.findByRole('navigation', { name: 'Módulos' })
    const grupo = (titulo) => within(within(nav).getByRole('heading', { name: titulo }).closest('.nav-grupo'))
    expect(grupo('Mi espacio').getByRole('button', { name: /^Mis documentos/ })).toBeInTheDocument()
    expect(grupo('Mi institución').getByRole('button', { name: /^Indicadores/ })).toBeInTheDocument()
    expect(grupo('Ayuda').getByRole('button', { name: /^Ayuda/ })).toBeInTheDocument()
  })
})

describe('Mis documentos', () => {
  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => 'blob:prueba')
    URL.revokeObjectURL = vi.fn()
    HTMLAnchorElement.prototype.click = vi.fn()
  })

  it('lista los documentos propios con su trámite, su tipo y su tamaño', async () => {
    await abrir('ana.ciudadana', 'Mis documentos')
    const tabla = await screen.findByRole('table', { name: 'Documentos que adjuntaste' })
    expect(within(tabla).getByText('plano-del-local.pdf')).toBeInTheDocument()
    expect(within(tabla).getByText('escritura-del-terreno.pdf')).toBeInTheDocument()
    expect(within(tabla).getByText('foto-del-lote.jpg')).toBeInTheDocument()
    expect(within(tabla).getByText(/PDF · 471 KB/)).toBeInTheDocument()
    expect(within(tabla).queryByText('croquis-de-la-acera.png')).not.toBeInTheDocument() // es de Beto
    expect(screen.getByText('3 documentos en total.')).toBeInTheDocument()
  })

  it('cada persona ve solo los suyos', async () => {
    await abrir('beto.ciudadano', 'Mis documentos')
    const tabla = await screen.findByRole('table', { name: 'Documentos que adjuntaste' })
    expect(within(tabla).getByText('croquis-de-la-acera.png')).toBeInTheDocument()
    expect(within(tabla).queryByText('plano-del-local.pdf')).not.toBeInTheDocument()
    expect(screen.getByText('1 documento en total.')).toBeInTheDocument()
  })

  it('el personal ve solo lo que adjuntó él, no lo de los trámites que atiende', async () => {
    await abrir('felix.minsa', 'Mis documentos') // el trámite 36 con su documento es del MINSA, pero lo inició Ana
    expect(await screen.findByText('Todavía no adjuntaste ningún documento')).toBeInTheDocument()
    expect(screen.queryByText('plano-del-local.pdf')).not.toBeInTheDocument()
  })

  it('busca por nombre y por número de trámite, y avisa cuántos coinciden', async () => {
    const { user } = await abrir('ana.ciudadana', 'Mis documentos')
    await screen.findByRole('table', { name: 'Documentos que adjuntaste' })
    const campo = screen.getByRole('searchbox', { name: /Buscar por nombre del documento o por trámite/ })
    await user.type(campo, 'escritura')
    await user.click(screen.getByRole('button', { name: 'Buscar' }))
    expect(await screen.findByText('1 documento coincide con «escritura».')).toBeInTheDocument()
    expect(screen.queryByText('plano-del-local.pdf')).not.toBeInTheDocument()
    await user.clear(campo)
    await user.type(campo, '#36{Enter}') // Enter envía el formulario de búsqueda
    expect(await screen.findByText('plano-del-local.pdf')).toBeInTheDocument()
    expect(screen.queryByText('escritura-del-terreno.pdf')).not.toBeInTheDocument()
  })

  it('sin coincidencias explica qué probar y permite quitar la búsqueda', async () => {
    const { user } = await abrir('ana.ciudadana', 'Mis documentos')
    await screen.findByRole('table', { name: 'Documentos que adjuntaste' })
    await user.type(screen.getByRole('searchbox', { name: /Buscar por nombre/ }), 'no-existe-este-nombre')
    await user.click(screen.getByRole('button', { name: 'Buscar' }))
    expect(await screen.findByText('Nada coincide con tu búsqueda')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Quitar la búsqueda' }))
    expect(await screen.findByText('plano-del-local.pdf')).toBeInTheDocument()
  })

  it('descarga por la ruta del trámite', async () => {
    const { user } = await abrir('ana.ciudadana', 'Mis documentos')
    await screen.findByRole('table', { name: 'Documentos que adjuntaste' })
    await user.click(screen.getByRole('button', { name: 'Descargar plano-del-local.pdf' }))
    await vi.waitFor(() => expect(URL.createObjectURL).toHaveBeenCalledTimes(1))
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(1)
  })

  it('el enlace lleva al trámite y desde ahí se vuelve a «Mis documentos»', async () => {
    const { user } = await abrir('ana.ciudadana', 'Mis documentos')
    await screen.findByRole('table', { name: 'Documentos que adjuntaste' })
    await user.click(screen.getByRole('button', { name: /^Trámite #36:/ }))
    expect(await screen.findByRole('heading', { name: 'Documentos' })).toBeInTheDocument()
    expect(screen.getAllByText('Trámite #36').length).toBeGreaterThan(0)
  })

  it('no tiene problemas de accesibilidad, con datos y vacía', async () => {
    const lleno = await abrir('ana.ciudadana', 'Mis documentos')
    await screen.findByRole('table', { name: 'Documentos que adjuntaste' })
    expect(await axe(lleno.container, AXE)).toHaveNoViolations()
    lleno.unmount()
    const vacio = await abrir('felix.minsa', 'Mis documentos')
    await screen.findByText('Todavía no adjuntaste ningún documento')
    expect(await axe(vacio.container, AXE)).toHaveNoViolations()
  })
})

describe('Indicadores', () => {
  const tarjeta = (texto) => within(screen.getByText(texto, { selector: 'span' }).closest('.indicador'))

  it('la supervisión ve las cifras de su institución como texto', async () => {
    await abrir('saul.mop', 'Indicadores')
    await screen.findByRole('group', { name: 'Cifras de la institución' })
    expect(tarjeta('Trámites abiertos').getByText('5')).toBeInTheDocument()
    expect(tarjeta('Con el plazo vencido').getByText('1')).toBeInTheDocument()
    expect(tarjeta('Escalados abiertos').getByText('1')).toBeInTheDocument()
    expect(tarjeta('Sin asignar').getByText('2')).toBeInTheDocument()
    expect(tarjeta('Resueltos (90 días)').getByText('36')).toBeInTheDocument()
    expect(tarjeta('Tiempo promedio de resolución').getByText(/^\d+(,\d)? días?$/)).toBeInTheDocument()
  })

  it('la coordinación, que no ve trámites, recibe las mismas cifras', async () => {
    await abrir('carla.mop', 'Indicadores')
    await screen.findByRole('group', { name: 'Cifras de la institución' })
    expect(tarjeta('Trámites abiertos').getByText('5')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Bandeja/ })).not.toBeInTheDocument()
  })

  it('el gráfico de barras tiene cada cifra como texto y el dibujo queda oculto a los lectores de pantalla', async () => {
    await abrir('saul.mop', 'Indicadores')
    const lista = await screen.findByRole('list', { name: 'Trámites por estado' })
    const filas = within(lista).getAllByRole('listitem')
    expect(filas.map((f) => f.querySelector('.barras-etiqueta').textContent)).toEqual(['Pendiente', 'En tramitación', 'En subsanación', 'Aprobado', 'Rechazado'])
    expect(filas.map((f) => f.querySelector('strong').textContent)).toEqual(['2', '2', '1', '24', '12'])
    expect(within(filas[3]).getByText('(59 %)')).toBeInTheDocument()
    for (const f of filas) expect(f.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    // Sin estilos en línea (la CSP no los admite): el largo de la barra es un atributo del SVG
    expect(lista.querySelectorAll('[style]')).toHaveLength(0)
    expect(filas[3].querySelector('.barras-relleno')).toHaveAttribute('width', '100')
    expect(Number(filas[2].querySelector('.barras-relleno').getAttribute('width'))).toBeCloseTo((1 / 24) * 100, 5)
  })

  it('la carga por funcionario nombra solo al personal, de mayor a menor', async () => {
    await abrir('saul.mop', 'Indicadores')
    const tabla = await screen.findByRole('table', { name: /Trámites abiertos asignados a cada persona/ })
    const filas = within(tabla).getAllByRole('row').slice(1).map((f) => [within(f).getByRole('rowheader').textContent, within(f).getAllByRole('cell')[0].textContent])
    expect(filas).toEqual([['flor.mop', '2'], ['fabio.mop', '1']])
    expect(screen.queryByText(/ana.ciudadana|beto.ciudadano/)).not.toBeInTheDocument()
  })

  it('«Actualizar» vuelve a pedir las cifras', async () => {
    const { user } = await abrir('saul.mop', 'Indicadores')
    await screen.findByRole('group', { name: 'Cifras de la institución' })
    const pedir = vi.spyOn(window, 'fetch')
    await user.click(screen.getByRole('button', { name: /Actualizar/ }))
    await vi.waitFor(() => expect(pedir.mock.calls.some(([ruta]) => String(ruta).includes('/equipo/3/indicadores/'))).toBe(true))
  })

  it('si el servidor lo niega (otra institución), lo dice y no muestra ninguna cifra', async () => {
    instalarMock('saul.mop', { demora: 0 })
    const yo = { membresias: [{ institucion_id: 4, institucion: 'MiAmbiente', rol: 'supervisor' }] } // la interfaz cree que supervisa MiAmbiente; el servidor lo vuelve a decidir
    render(<ProveedorUI><Indicadores yo={yo} /></ProveedorUI>)
    expect(await screen.findByRole('alert')).toHaveTextContent('No tienes autorización')
    expect(screen.queryByRole('group', { name: 'Cifras de la institución' })).not.toBeInTheDocument()
  })

  it('quien no supervisa ni coordina ninguna institución ve un aviso claro', () => {
    render(<ProveedorUI><Indicadores yo={{ membresias: [{ institucion_id: 3, institucion: 'MOP', rol: 'funcionario' }] }} /></ProveedorUI>)
    expect(screen.getByText('No supervisas ni coordinas ninguna institución')).toBeInTheDocument()
  })

  it('con varias instituciones se elige cuál ver', async () => {
    instalarMock('saul.mop', { demora: 0 })
    const yo = { membresias: [{ institucion_id: 3, institucion: 'MOP', rol: 'supervisor' }, { institucion_id: 3, institucion: 'MOP', rol: 'coordinador_institucional' }] }
    render(<ProveedorUI><Indicadores yo={yo} /></ProveedorUI>)
    await screen.findByRole('group', { name: 'Cifras de la institución' })
    expect(screen.queryByRole('combobox', { name: 'Institución' })).not.toBeInTheDocument() // la misma institución con dos roles no se repite
  })

  it('no tiene problemas de accesibilidad', async () => {
    const { container } = await abrir('saul.mop', 'Indicadores')
    await screen.findByRole('group', { name: 'Cifras de la institución' })
    expect(await axe(container, AXE)).toHaveNoViolations()
  })
})

describe('Ayuda', () => {
  const yoDe = (rol_plataforma, roles = []) => ({ rol_plataforma, membresias: roles.map((rol) => ({ institucion_id: 3, institucion: 'MOP', rol })) })
  const preguntas = (contenedor) => [...contenedor.querySelectorAll('details')]

  it('el acordeón se abre y se cierra con el teclado y la respuesta aparece', async () => {
    const user = userEvent.setup()
    render(<Ayuda yo={yoDe('ninguno')} />)
    const resumen = screen.getByText('¿Cómo inicio un trámite?')
    expect(resumen.tagName).toBe('SUMMARY') // el elemento nativo se abre con Enter y espacio, y los lectores de pantalla anuncian su estado
    expect(resumen.closest('details')).not.toHaveAttribute('open')
    await user.click(resumen)
    expect(resumen.closest('details')).toHaveAttribute('open')
    expect(within(resumen.closest('details')).getByText(/Entra a «Iniciar un trámite»/)).toBeInTheDocument()
    await user.click(resumen)
    expect(resumen.closest('details')).not.toHaveAttribute('open')
  })

  it('explica cada estado, incluido «Desistido»', () => {
    render(<Ayuda yo={yoDe('ninguno')} />)
    const respuesta = screen.getByText('¿Qué significa cada estado de mi trámite?').closest('details')
    for (const estado of ['Pendiente', 'En tramitación', 'En subsanación', 'Aprobado', 'Rechazado', 'Desistido']) {
      expect(within(respuesta).getByText(estado, { selector: 'dt' })).toBeInTheDocument()
    }
    expect(within(respuesta).getByText(/Retiraste tu trámite/)).toBeInTheDocument()
  })

  it('cubre subsanación, segundo factor, teléfono perdido, derechos de la Ley 81, notificaciones y privacidad', () => {
    render(<Ayuda yo={yoDe('ninguno')} />)
    for (const p of ['¿Qué es una subsanación y cómo la respondo?', '¿Qué es el segundo factor y para qué sirve?', 'Perdí o cambié mi teléfono: ¿qué hago?',
      '¿Cómo ejerzo mis derechos sobre mis datos personales?', '¿Cómo funcionan las notificaciones?', '¿Qué hace SIGET con mis datos? ¿Dónde está el aviso de privacidad?']) {
      expect(screen.getByText(p)).toBeInTheDocument()
    }
    expect(screen.getByText(/recuperación es asistida/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'aviso de privacidad' })).toHaveAttribute('href', '#/privacidad')
    expect(screen.getByText(/La Ley 81/)).toBeInTheDocument()
  })

  it('se adapta al rol: la ciudadanía no ve la atención de trámites; el personal, sí', () => {
    const { unmount } = render(<Ayuda yo={yoDe('ninguno')} />)
    expect(screen.queryByRole('heading', { name: 'Atención de trámites' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Supervisión' })).not.toBeInTheDocument()
    unmount()
    const funcionario = render(<Ayuda yo={yoDe('ninguno', ['funcionario'])} />)
    expect(screen.getByRole('heading', { name: 'Atención de trámites' })).toBeInTheDocument()
    expect(screen.getByText('¿Por qué me pide un motivo obligatorio?')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Supervisión' })).not.toBeInTheDocument()
    funcionario.unmount()
    render(<Ayuda yo={yoDe('ninguno', ['supervisor'])} />)
    expect(screen.getByRole('heading', { name: 'Supervisión' })).toBeInTheDocument()
    expect(screen.getByText('¿Cómo reasigno trámites y qué veo en los indicadores?')).toBeInTheDocument()
  })

  it('la coordinación ve lo suyo y se le aclara que no ve trámites; las cuentas de plataforma ven solo su sección', () => {
    const coordinacion = render(<Ayuda yo={yoDe('ninguno', ['coordinador_institucional'])} />)
    expect(screen.getByText(/no ve los trámites: ni su contenido ni sus documentos/)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Atención de trámites' })).not.toBeInTheDocument()
    coordinacion.unmount()
    render(<Ayuda yo={yoDe('auditor')} />)
    expect(screen.getByRole('heading', { name: 'Cuentas de la plataforma' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Mi cuenta y mi seguridad' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Mis trámites' })).not.toBeInTheDocument()
    expect(screen.queryByText('¿Cómo inicio un trámite?')).not.toBeInTheDocument()
  })

  it('el buscador filtra sin importar mayúsculas ni tildes, abre lo que coincide y avisa cuántas hay', async () => {
    const user = userEvent.setup()
    const { container } = render(<Ayuda yo={yoDe('ninguno')} />)
    const total = preguntas(container).length
    await user.type(screen.getByRole('searchbox', { name: 'Buscar en la ayuda' }), 'SEGUNDO factor')
    const quedan = preguntas(container)
    expect(quedan.length).toBeGreaterThan(0)
    expect(quedan.length).toBeLessThan(total)
    expect(screen.getByText(`${quedan.length} ${quedan.length === 1 ? 'pregunta coincide' : 'preguntas coinciden'} con tu búsqueda.`)).toHaveAttribute('role', 'status')
    expect(quedan.every((d) => d.hasAttribute('open'))).toBe(true)
    expect(screen.getByText('¿Qué es el segundo factor y para qué sirve?')).toBeInTheDocument()
    expect(screen.queryByText('¿Cómo inicio un trámite?')).not.toBeInTheDocument()
    await user.clear(screen.getByRole('searchbox'))
    await user.type(screen.getByRole('searchbox'), 'telefono') // sin tilde: encuentra «teléfono»
    expect(screen.getByText('Perdí o cambié mi teléfono: ¿qué hago?')).toBeInTheDocument()
  })

  it('sin coincidencias lo dice y sugiere palabras', async () => {
    const user = userEvent.setup()
    render(<Ayuda yo={yoDe('ninguno')} />)
    await user.type(screen.getByRole('searchbox'), 'xyzzy')
    expect(screen.getByText('No hay preguntas que coincidan.')).toHaveAttribute('role', 'status')
    expect(screen.getByText('Nada coincide con tu búsqueda')).toBeInTheDocument()
  })

  it('no llama al servidor', () => {
    const pedir = vi.spyOn(window, 'fetch')
    pedir.mockClear()
    render(<Ayuda yo={yoDe('ninguno', ['supervisor'])} />)
    expect(pedir).not.toHaveBeenCalled()
  })

  it('no tiene problemas de accesibilidad para ningún rol', async () => {
    for (const yo of [yoDe('ninguno'), yoDe('ninguno', ['funcionario']), yoDe('ninguno', ['supervisor', 'coordinador_institucional']), yoDe('auditor')]) {
      const { container, unmount } = render(<Ayuda yo={yo} />)
      expect(await axe(container, AXE)).toHaveNoViolations()
      unmount()
    }
  })

  it('desde la aplicación: el módulo abre la ayuda del rol de quien la abre', async () => {
    await abrir('fabio.mop', 'Ayuda')
    expect(await screen.findByRole('heading', { name: 'Atención de trámites' })).toBeInTheDocument()
  })
})
