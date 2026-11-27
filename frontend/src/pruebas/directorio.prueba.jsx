// Directorio de instituciones (migración 023): lista con buscador, fichas de los trámites activos con sus requisitos y paso a «Iniciar un trámite»
// con la institución y el trámite ya elegidos. Se arma la aplicación completa contra el servidor de ejemplo (src/mock.js).
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../App.jsx'
import { agrupar } from '../modulos.js'
import { instalarMock } from '../mock.js'
import { ProveedorUI } from '../ui.jsx'

vi.mock('qrcode', () => ({ default: { toCanvas: vi.fn() } }))
const AXE = { rules: { 'color-contrast': { enabled: false } } }

afterEach(() => vi.restoreAllMocks())

function espiar(falsa = () => null) {
  const real = window.fetch
  const llamadas = []
  window.fetch = vi.fn(async (ruta, opciones = {}) => {
    llamadas.push({ url: String(ruta), metodo: (opciones.method || 'GET').toUpperCase() })
    return falsa(String(ruta), opciones) || real(ruta, opciones)
  })
  return llamadas
}

async function abrirComo(usuario, modulo, falsa) {
  instalarMock(usuario, { demora: 0 })
  const llamadas = espiar(falsa)
  const utilidades = render(<ProveedorUI><App /></ProveedorUI>)
  const user = userEvent.setup()
  const nav = await screen.findByRole('navigation', { name: 'Módulos' })
  if (modulo) await user.click(within(nav).getByRole('button', { name: new RegExp(`^${modulo}`) }))
  return { ...utilidades, user, llamadas, nav }
}

const lista = () => screen.getByRole('list', { name: 'Instituciones' })
const ficha = async (nombre) => (await screen.findByRole('article', { name: nombre }))

describe('«Directorio» en el menú', () => {
  it('queda en «Mi espacio», entre «Iniciar un trámite» y «Mis datos», para la ciudadanía y para el personal', async () => {
    const { nav } = await abrirComo('ana.ciudadana')
    const miEspacio = within(nav).getByRole('heading', { name: 'Mi espacio' }).parentElement
    expect(within(miEspacio).getAllByRole('button').map((b) => b.textContent)).toEqual(['Mis trámites', 'Iniciar un trámite', 'Directorio', 'Mis datos'])
    expect(agrupar([{ id: 'directorio' }, { id: 'auditoria' }]).map((g) => [g.titulo, g.modulos.map((m) => m.id)])).toEqual([['Mi espacio', ['directorio']], ['Plataforma', ['auditoria']]])
  })

  it('no lo ve una cuenta de plataforma', async () => {
    const { nav } = await abrirComo('ines.infra')
    expect(within(nav).queryByRole('button', { name: /^Directorio/ })).not.toBeInTheDocument()
  })
})

describe('lista y buscador', () => {
  it('lista las instituciones del catálogo con cuántos trámites ofrecen, sin etiquetas de demostración', async () => {
    const { container } = await abrirComo('ana.ciudadana', 'Directorio')
    await screen.findByRole('heading', { name: 'Directorio' })
    const items = await within(await screen.findByRole('list', { name: 'Instituciones' })).findAllByRole('listitem')
    expect(items).toHaveLength(6)
    expect(within(items[0]).getByRole('button', { name: /Alcaldía \(Municipio de Panamá\)\s*1 trámite$/ })).toBeInTheDocument()
    expect(container).not.toHaveTextContent(/Demostración/i)
    expect(screen.getByText('Elige una institución de la lista para ver sus trámites.')).toBeInTheDocument()
  })

  it('busca por el nombre de la institución o por el de un trámite', async () => {
    const { user } = await abrirComo('ana.ciudadana', 'Directorio')
    const buscador = await screen.findByRole('searchbox', { name: 'Buscar una institución o un trámite' })
    await user.type(buscador, 'alcaldía')
    expect(within(lista()).getAllByRole('listitem')).toHaveLength(1)
    await user.clear(buscador)
    await user.type(buscador, 'microempresa')
    const items = within(lista()).getAllByRole('listitem')
    expect(items).toHaveLength(1)
    expect(items[0]).toHaveTextContent('AMPYME')
    await user.clear(buscador)
    await user.type(buscador, 'nada que coincida')
    expect(screen.getByText('Ninguna institución ni trámite coincide con tu búsqueda.')).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Instituciones' })).not.toBeInTheDocument()
  })
})

describe('ficha de una institución', () => {
  it('muestra cada trámite activo con su descripción, plazo en días hábiles, documentos y qué pasa después', async () => {
    const { user } = await abrirComo('ana.ciudadana', 'Directorio')
    await user.click(await screen.findByRole('button', { name: /^Alcaldía/ }))
    const f = await ficha('Permiso de construcción')
    expect(within(f).getByText(/Autorización de la Alcaldía para construir/)).toBeInTheDocument()
    expect(within(f).getByText('15 días hábiles')).toBeInTheDocument()
    expect(within(f).getByRole('heading', { name: 'Documentos necesarios' })).toBeInTheDocument()
    expect(within(f).getAllByRole('listitem').map((l) => l.textContent)).toContain('Paz y salvo municipal del inmueble')
    expect(within(f).getByRole('heading', { name: 'Qué pasa después' })).toBeInTheDocument()
    expect(within(f).getByText(/Un funcionario de la Alcaldía revisa la solicitud/)).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 3, name: 'Alcaldía (Municipio de Panamá)' })).toBeInTheDocument()
  })

  it('un trámite sin documentos ni «después» lo dice con palabras llanas', async () => {
    const { user } = await abrirComo('ana.ciudadana', 'Directorio')
    await user.click(await screen.findByRole('button', { name: /^Ministerio Público/ }))
    const f = await ficha('Denuncia ciudadana 311')
    expect(within(f).getByText('La institución no pide documentos para este trámite.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^AMPYME/ }))
    expect(await screen.findByText(/Recibirás un número de seguimiento/)).toBeInTheDocument()
  })

  it('la ciudadanía no ve las solicitudes interinstitucionales ni los trámites que no puede iniciar', async () => {
    const { user } = await abrirComo('ana.ciudadana', 'Directorio')
    await user.click(await screen.findByRole('button', { name: /^MOP/ }))
    await ficha('Permiso de uso de vía pública')
    expect(screen.queryByRole('article', { name: /interinstitucional/i })).not.toBeInTheDocument()
  })

  it('el texto del catálogo se dibuja como texto, nunca como HTML', async () => {
    const falsa = (url) => url.endsWith('/catalogo/tipos-tramite/') ? new Response(JSON.stringify([{
      id: 90, nombre: 'Trámite de <b>prueba</b>', sla_dias: 1, audiencia: 'ciudadania', formulario: [], institucion: { id: 1, nombre: 'Alcaldía (Municipio de Panamá)' },
      requisitos: { descripcion: '<img src=x onerror=alert(1)>', documentos: ['<script>x</script>'], despues: '<i>luego</i>' },
    }]), { status: 200, headers: { 'Content-Type': 'application/json' } }) : null
    const { user, container } = await abrirComo('ana.ciudadana', 'Directorio', falsa)
    await user.click(await screen.findByRole('button', { name: /^Alcaldía/ }))
    await ficha('Trámite de <b>prueba</b>')
    expect(container.querySelector('article img, article b, article script, article i')).toBeNull()
    expect(container).toHaveTextContent('<img src=x onerror=alert(1)>')
    expect(screen.getByText('1 día hábil')).toBeInTheDocument()
  })
})

describe('iniciar desde el directorio', () => {
  it('«Iniciar este trámite» lleva a «Iniciar un trámite» con la institución y el trámite elegidos y la tarjeta «Antes de empezar»', async () => {
    const { user } = await abrirComo('ana.ciudadana', 'Directorio')
    await user.click(await screen.findByRole('button', { name: /^Alcaldía/ }))
    const f = await ficha('Permiso de construcción')
    await user.click(within(f).getByRole('button', { name: /^Iniciar este trámite/ }))
    expect(await screen.findByRole('heading', { name: 'Iniciar un trámite' })).toBeInTheDocument()
    expect(await screen.findByRole('radio', { name: /^Alcaldía/, checked: true })).toBeInTheDocument()
    expect(await screen.findByRole('radio', { name: /Permiso de construcción/, checked: true })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Antes de empezar' })).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Dirección del terreno' })).not.toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: 'Resumen del trámite' })).toHaveTextContent('Permiso de construcción')
  })

  it('al entrar a «Iniciar un trámite» por el menú no hay nada preseleccionado', async () => {
    const { user, nav } = await abrirComo('ana.ciudadana', 'Directorio')
    await user.click(await screen.findByRole('button', { name: /^Alcaldía/ }))
    await user.click(within(await ficha('Permiso de construcción')).getByRole('button', { name: /^Iniciar este trámite/ }))
    await screen.findByRole('radio', { name: /^Alcaldía/, checked: true })
    await user.click(within(nav).getByRole('button', { name: /^Directorio/ }))
    await user.click(within(nav).getByRole('button', { name: /^Iniciar un trámite/ }))
    await screen.findByRole('radio', { name: /^Alcaldía/ })
    expect(screen.queryByRole('radio', { checked: true })).not.toBeInTheDocument()
  })

  it('el personal ve solo las solicitudes hacia otras instituciones y no puede iniciar nada en la suya', async () => {
    const { user } = await abrirComo('fabio.mop', 'Directorio')
    await user.click(await screen.findByRole('button', { name: /^MOP/ }))
    const propia = await ficha('Solicitud interinstitucional de información')
    expect(within(propia).getByText('Es tu institución: el personal no inicia trámites en la propia.')).toBeInTheDocument()
    expect(within(propia).queryByRole('button', { name: /Iniciar este trámite/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^Alcaldía/ }))
    const otra = await ficha('Solicitud interinstitucional de información')
    expect(screen.queryByRole('article', { name: 'Permiso de construcción' })).not.toBeInTheDocument()
    await user.click(within(otra).getByRole('button', { name: /^Iniciar este trámite/ }))
    expect(await screen.findByRole('radio', { name: /^Alcaldía/, checked: true })).toBeInTheDocument()
    expect(await screen.findByRole('radio', { name: /Solicitud interinstitucional/, checked: true })).toBeInTheDocument()
  })
})

describe('datos públicos y errores', () => {
  it('solo lee el catálogo público: dos GET y nada más', async () => {
    const { user, llamadas } = await abrirComo('ana.ciudadana', 'Directorio')
    await user.click(await screen.findByRole('button', { name: /^Alcaldía/ }))
    await ficha('Permiso de construcción')
    const delDirectorio = llamadas.filter((l) => l.url.includes('/catalogo/'))
    expect(delDirectorio.map((l) => `${l.metodo} ${l.url.replace(/^.*\/catalogo/, '/catalogo')}`).sort()).toEqual(['GET /catalogo/instituciones/', 'GET /catalogo/tipos-tramite/'])
    expect(llamadas.filter((l) => l.metodo !== 'GET' && !l.url.includes('/auth/'))).toEqual([])
  })

  it('si el catálogo no responde lo dice en un aviso y no deja la pantalla vacía sin explicación', async () => {
    const falsa = (url) => url.endsWith('/catalogo/instituciones/') ? new Response(JSON.stringify({ codigo: 'error', detalle: 'No pudimos cargar el catálogo.' }), { status: 500, headers: { 'Content-Type': 'application/json' } }) : null
    await abrirComo('ana.ciudadana', 'Directorio', falsa)
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(await screen.findByText('Todavía no hay instituciones en el directorio.')).toBeInTheDocument()
  })

  it('no tiene violaciones de accesibilidad (lista y ficha abiertas)', async () => {
    const { user, container } = await abrirComo('ana.ciudadana', 'Directorio')
    await user.click(await screen.findByRole('button', { name: /^Alcaldía/ }))
    await ficha('Permiso de construcción')
    await waitFor(() => expect(screen.getByRole('button', { name: /^Alcaldía/ })).toHaveAttribute('aria-pressed', 'true'))
    expect(await axe(container, AXE)).toHaveNoViolations()
  })
})
