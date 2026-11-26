// Trámites de la ciudadanía (migración 021): «Antes de empezar», constancia de presentación, desistir y búsqueda y filtros de «Mis trámites».
// Se arma la aplicación completa contra el servidor de ejemplo (src/mock.js), que imita el contrato de docs/api.md.
import { readFileSync } from 'node:fs'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../App.jsx'
import { ESTADOS, Estado, FINALES, SIGUIENTES, plazoDe } from '../comun.jsx'
import { instalarMock } from '../mock.js'
import { ETIQUETA, FRASES, Seguimiento, pasosDe } from '../Seguimiento.jsx'
import { AntesDeEmpezar, coincideMio } from '../Tramites.jsx'
import { ProveedorUI } from '../ui.jsx'

vi.mock('qrcode', () => ({ default: { toCanvas: vi.fn() } }))
const AXE = { rules: { 'color-contrast': { enabled: false } } }

afterEach(() => vi.restoreAllMocks())

const json = (estado, cuerpo) => new Response(JSON.stringify(cuerpo), { status: estado, headers: { 'Content-Type': 'application/json' } })

function espiar(falsa = () => null) {
  const real = window.fetch
  const llamadas = []
  window.fetch = vi.fn(async (ruta, opciones = {}) => {
    const url = String(ruta)
    llamadas.push({ url, metodo: (opciones.method || 'GET').toUpperCase(), cuerpo: typeof opciones.body === 'string' ? JSON.parse(opciones.body) : undefined })
    return falsa(url, opciones) || real(ruta, opciones)
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
  return { ...utilidades, user, llamadas }
}

async function abrirDetalle(usuario, modulo, numero, falsa) {
  const r = await abrirComo(usuario, modulo, falsa)
  await r.user.click(await screen.findByRole('row', { name: new RegExp(`^Trámite ${numero}:`) }))
  await screen.findByRole('img', { name: /Recorrido del trámite/ })
  return r
}

async function elegir(user, institucion, tramite) {
  await user.click(await screen.findByRole('radio', { name: new RegExp(`^${institucion}`) }))
  await user.click(await screen.findByRole('radio', { name: new RegExp(tramite) }))
}

const filas = () => screen.getAllByRole('row').slice(1)
const paginador = () => screen.getByRole('navigation', { name: 'Paginación' })

/* ---------------------------------------------------------------- antes de empezar */

describe('«Antes de empezar»', () => {
  it('al elegir el trámite se lee primero la tarjeta y el formulario aparece al pulsar «Empezar»', async () => {
    const { user } = await abrirComo('ana.ciudadana', 'Iniciar un trámite')
    await elegir(user, 'Alcaldía', 'Permiso de construcción')
    const tarjeta = (await screen.findByRole('heading', { name: 'Antes de empezar' })).closest('section')
    expect(within(tarjeta).getByText(/Autorización de la Alcaldía para construir/)).toBeInTheDocument()
    expect(within(tarjeta).getByText('15 días hábiles')).toBeInTheDocument()
    expect(within(tarjeta).getByRole('heading', { name: 'Documentos que vas a necesitar' })).toBeInTheDocument()
    expect(within(tarjeta).getAllByRole('listitem').map((l) => l.textContent)).toContain('Paz y salvo municipal del inmueble')
    expect(within(tarjeta).getByRole('heading', { name: 'Qué pasa después' })).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Dirección del terreno' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Iniciar trámite' })).not.toBeInTheDocument()
    await user.click(within(tarjeta).getByRole('button', { name: 'Empezar' }))
    const primero = await screen.findByRole('textbox', { name: 'Dirección del terreno' })
    expect(primero).toHaveFocus()
    expect(screen.getByRole('button', { name: 'Iniciar trámite' })).toBeInTheDocument()
    expect(within(tarjeta).queryByRole('button', { name: 'Empezar' })).not.toBeInTheDocument()
  })

  it('un trámite sin documentos ni «después» lo dice con palabras llanas', async () => {
    const { user } = await abrirComo('ana.ciudadana', 'Iniciar un trámite')
    await elegir(user, 'Ministerio Público', 'Denuncia ciudadana 311')
    expect(await screen.findByText('La institución no pide documentos para este trámite.')).toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: /^AMPYME/ }))
    await user.click(await screen.findByRole('radio', { name: /Registro de microempresa/ }))
    expect(await screen.findByText(/Recibirás un número de seguimiento/)).toBeInTheDocument()
  })

  it('al cambiar de trámite vuelve la tarjeta y se esconde el formulario', async () => {
    const { user } = await abrirComo('ana.ciudadana', 'Iniciar un trámite')
    await elegir(user, 'Alcaldía', 'Permiso de construcción')
    await user.click(await screen.findByRole('button', { name: 'Empezar' }))
    await screen.findByRole('textbox', { name: 'Dirección del terreno' })
    await user.click(screen.getByRole('radio', { name: /^AMPYME/ }))
    await user.click(await screen.findByRole('radio', { name: /Registro de microempresa/ }))
    expect(await screen.findByRole('button', { name: 'Empezar' })).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Nombre comercial' })).not.toBeInTheDocument()
  })

  it('el texto del catálogo se dibuja como texto, nunca como HTML', () => {
    const { container } = render(<AntesDeEmpezar empezado tipo={{ sla_dias: 1, requisitos: { descripcion: '<img src=x onerror=alert(1)>', documentos: ['<b>negrita</b>'], despues: '<script>x</script>' } }} />)
    expect(container.querySelector('img, b, script')).toBeNull()
    expect(container).toHaveTextContent('<img src=x onerror=alert(1)>')
    expect(screen.getByText('1 día hábil')).toBeInTheDocument()
  })

  it('la pantalla con la tarjeta no tiene violaciones de accesibilidad', async () => {
    const { user, container } = await abrirComo('ana.ciudadana', 'Iniciar un trámite')
    await elegir(user, 'Alcaldía', 'Permiso de construcción')
    await screen.findByRole('heading', { name: 'Antes de empezar' })
    expect(await axe(container, AXE)).toHaveNoViolations()
  })
})

/* ---------------------------------------------------------------- constancia */

describe('la constancia de presentación', () => {
  it('el detalle de la persona tiene el botón «Constancia» y abre la página con todo lo presentado', async () => {
    window.print = vi.fn()
    const { user, llamadas } = await abrirDetalle('ana.ciudadana', 'Mis trámites', 39)
    await user.click(screen.getByRole('button', { name: 'Constancia' }))
    expect(await screen.findByRole('heading', { name: 'Constancia de presentación' })).toBeInTheDocument()
    expect(llamadas.some((l) => l.url === '/tramites/39/constancia/' && l.metodo === 'GET')).toBe(true)
    const c = screen.getByRole('article')
    expect(within(c).getByText('#39')).toBeInTheDocument()
    expect(within(c).getByText('Alcaldía (Municipio de Panamá)')).toBeInTheDocument()
    expect(within(c).getByText('Dirección del terreno').nextElementSibling).toHaveTextContent('Calle 50, edificio Bella Vista, Panamá')
    expect(within(c).getByText('Estado actual')).toBeInTheDocument()
    expect(within(c).getByText('No se adjuntó ningún documento.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Imprimir o guardar como PDF' }))
    expect(window.print).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: /Volver al trámite/ }))
    expect(await screen.findByRole('img', { name: /Recorrido del trámite/ })).toBeInTheDocument()
  })

  it('al terminar de iniciar un trámite el detalle ofrece la constancia', async () => {
    const { user } = await abrirComo('ana.ciudadana', 'Iniciar un trámite')
    await elegir(user, 'AMPYME', 'Registro de microempresa')
    await user.click(await screen.findByRole('button', { name: 'Empezar' }))
    await user.type(await screen.findByRole('textbox', { name: 'Nombre comercial' }), 'Panadería Estrella')
    await user.type(screen.getByRole('textbox', { name: 'Actividad económica' }), 'Panificación')
    await user.type(screen.getByRole('textbox', { name: 'Dirección del negocio' }), 'Calle 4, Chorrera')
    await user.type(screen.getByRole('spinbutton', { name: 'Número de empleados' }), '2')
    await user.click(screen.getByRole('button', { name: 'Iniciar trámite' }))
    await user.click(await screen.findByRole('button', { name: 'Ver mi constancia' }))
    expect(await screen.findByRole('heading', { name: 'Constancia de presentación' })).toBeInTheDocument()
    expect(screen.getByText('Nombre comercial').nextElementSibling).toHaveTextContent('Panadería Estrella')
  })

  it('el personal no ve el botón y, si el servidor la niega, se muestra el error', async () => {
    await abrirDetalle('felix.minsa', 'Bandeja de la institución', 36)
    expect(screen.queryByRole('button', { name: 'Constancia' })).not.toBeInTheDocument()
  })

  it('un error del servidor se muestra y se puede volver', async () => {
    const { user } = await abrirDetalle('ana.ciudadana', 'Mis trámites', 39, (url) => (url.endsWith('/constancia/') ? json(403, { codigo: 'acceso_denegado' }) : null))
    await user.click(screen.getByRole('button', { name: 'Constancia' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/No tienes autorización/)
    await user.click(screen.getByRole('button', { name: /Volver al trámite/ }))
    expect(await screen.findByRole('img', { name: /Recorrido del trámite/ })).toBeInTheDocument()
  })

  it('la hoja de impresión deja solo la constancia: sin menú, barra ni botones', async () => {
    const css = readFileSync('src/estilos/ciudadania.css', 'utf8')  // vitest corre desde frontend/
    const impresion = css.slice(css.indexOf('@media print'))
    for (const clase of ['.lateral', '.barra-superior', '.no-imprimir']) expect(impresion).toContain(clase)
    expect(impresion).toMatch(/display:\s*none\s*!important/)
  })

  it('la página es accesible', async () => {
    const { user, container } = await abrirDetalle('ana.ciudadana', 'Mis trámites', 39)
    await user.click(screen.getByRole('button', { name: 'Constancia' }))
    await screen.findByRole('heading', { name: 'Constancia de presentación' })
    expect(await axe(container, AXE)).toHaveNoViolations()
  })
})

/* ---------------------------------------------------------------- desistir */

describe('desistir de un trámite', () => {
  async function pedirDesistir(user, motivo = 'Ya no necesito el certificado.') {
    await user.click(screen.getByRole('button', { name: 'Desistir del trámite' }))
    const modal = await screen.findByRole('dialog', { name: 'Desistir del trámite' })
    await user.type(within(modal).getByRole('textbox', { name: 'Motivo' }), motivo)
    return modal
  }

  it('avisa que no se puede deshacer, exige motivo, pide el segundo factor y deja el trámite cerrado', async () => {
    const { user, llamadas } = await abrirDetalle('ana.ciudadana', 'Mis trámites', 36)
    await user.click(screen.getByRole('button', { name: 'Desistir del trámite' }))
    const modal = await screen.findByRole('dialog', { name: 'Desistir del trámite' })
    expect(modal).toHaveTextContent(/no se puede deshacer/)
    const confirmar = within(modal).getByRole('button', { name: 'Desistir del trámite' })
    expect(confirmar).toBeDisabled()
    await user.type(within(modal).getByRole('textbox', { name: 'Motivo' }), 'Ya no necesito el certificado.')
    expect(confirmar).toBeEnabled()
    await user.click(confirmar)
    const reauth = await screen.findByRole('dialog', { name: /Confirma que eres tú/ })
    await user.type(within(reauth).getByLabelText(/Código de 6 dígitos/), '123456')
    await user.click(within(reauth).getByRole('button', { name: /Verificar y continuar/ }))
    expect(await screen.findByRole('img', { name: 'Recorrido del trámite: Desistido' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(llamadas.find((l) => l.metodo === 'POST' && l.url === '/tramites/36/desistir/').cuerpo).toEqual({ motivo: 'Ya no necesito el certificado.' })
    expect(screen.queryByRole('button', { name: 'Desistir del trámite' })).not.toBeInTheDocument()
    expect(screen.getByText('Ya no necesito el certificado.')).toBeInTheDocument()   // su motivo, en el historial
    expect(screen.getByText(FRASES.Desistido[2])).toBeInTheDocument()
  })

  it('cancelar no manda nada', async () => {
    const { user, llamadas } = await abrirDetalle('ana.ciudadana', 'Mis trámites', 36)
    const modal = await pedirDesistir(user)
    await user.click(within(modal).getByRole('button', { name: 'Cancelar' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(llamadas.some((l) => l.url.endsWith('/desistir/'))).toBe(false)
  })

  it('un trámite ya resuelto no ofrece desistir', async () => {
    await abrirDetalle('ana.ciudadana', 'Mis trámites', 35)
    expect(screen.queryByRole('button', { name: 'Desistir del trámite' })).not.toBeInTheDocument()
  })

  it('el personal no ve el botón de desistir', async () => {
    await abrirDetalle('felix.minsa', 'Bandeja de la institución', 36)
    expect(screen.queryByRole('button', { name: 'Desistir del trámite' })).not.toBeInTheDocument()
  })

  it('si el servidor dice que ya está resuelto, el mensaje queda en el modal y el motivo se conserva', async () => {
    const { user } = await abrirDetalle('ana.ciudadana', 'Mis trámites', 36, (url) => (url.endsWith('/desistir/')
      ? json(409, { codigo: 'tramite_resuelto', detalle: 'El trámite ya está resuelto: no se puede desistir de él.' }) : null))
    const modal = await pedirDesistir(user)
    await user.click(within(modal).getByRole('button', { name: 'Desistir del trámite' }))
    const reauth = screen.queryByRole('dialog', { name: /Confirma que eres tú/ })
    if (reauth) {
      await user.type(within(reauth).getByLabelText(/Código de 6 dígitos/), '123456')
      await user.click(within(reauth).getByRole('button', { name: /Verificar y continuar/ }))
    }
    expect(await within(await screen.findByRole('dialog', { name: 'Desistir del trámite' })).findByText(/ya está resuelto/)).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Motivo' })).toHaveValue('Ya no necesito el certificado.')
  })

  it('el modal es accesible', async () => {
    const { user, container } = await abrirDetalle('ana.ciudadana', 'Mis trámites', 36)
    await pedirDesistir(user)
    expect(await axe(container, AXE)).toHaveNoViolations()
  })

  it('Desistido es un estado final más, con su etiqueta, su recorrido y sin transiciones del personal', () => {
    expect(FINALES).toContain('Desistido')
    expect(SIGUIENTES.Desistido).toEqual([])
    expect(ESTADOS.Desistido).toEqual({ texto: 'Desistido', clase: 'e-desistido' })
    expect(ETIQUETA.Desistido).toBe('Desistido')
    expect(pasosDe('Desistido').map((p) => p.situacion)).toEqual(['hecho', 'omitido', 'desistido'])
    expect(pasosDe('Desistido')[2]).toMatchObject({ etiqueta: 'Desistido', detalle: 'Trámite cerrado' })
    expect(plazoDe({ estado: 'Desistido', creado_en: new Date().toISOString(), fecha_limite: new Date().toISOString(), vencido: false })).toMatchObject({ texto: 'Cerrado por desistimiento' })
  })

  it('el componente de seguimiento y la insignia describen el desistimiento', () => {
    const { container } = render(<><Seguimiento estado="Desistido" /><Estado valor="Desistido" /></>)
    expect(screen.getByRole('img')).toHaveAttribute('aria-label', 'Recorrido del trámite: Desistido')
    expect(container.querySelector('.seg-paso.desistido')).toBeInTheDocument()
    expect(container.querySelector('.seguimiento-frase')).toHaveClass('tono-neutro')
    expect(container.querySelector('.insignia.e-desistido')).toHaveTextContent('Desistido')
  })
})

/* ---------------------------------------------------------------- buscar y filtrar «Mis trámites» */

describe('buscar y filtrar «Mis trámites»', () => {
  it('se busca por número (con o sin #) o por el nombre del trámite, y no por la institución', () => {
    const t = { id: 36, tipo_tramite: { nombre: 'Certificado de salud ocupacional' }, institucion: { nombre: 'MINSA' } }
    expect(coincideMio(t, '36') && coincideMio(t, '#36') && coincideMio(t, 'salud ocupacional') && coincideMio(t, '')).toBe(true)
    expect(coincideMio(t, 'minsa')).toBe(false)
    expect(coincideMio(t, 'Aprobado')).toBe(false)
  })

  it('el filtro por estado ofrece los seis estados, incluido Desistido, y filtra sobre la lista completa', async () => {
    const { user } = await abrirComo('ana.ciudadana', 'Mis trámites')
    await screen.findByRole('row', { name: /Trámite 44:/ })
    const estado = screen.getByRole('combobox', { name: 'Estado' })
    expect(within(estado).getAllByRole('option').map((o) => o.textContent)).toEqual(['Todos los estados', 'Pendiente', 'En tramitación', 'En subsanación', 'Aprobado', 'Rechazado', 'Desistido'])
    await user.selectOptions(estado, 'Aprobado')
    expect(filas()).toHaveLength(13)
    expect(screen.queryByRole('navigation', { name: 'Paginación' })).not.toBeInTheDocument()
    expect(screen.getByText('13 de 28 trámites')).toBeInTheDocument()
    await user.selectOptions(estado, 'Desistido')
    expect(await screen.findByText('Nada coincide con tu búsqueda')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Ver todos mis trámites' }))
    expect(within(paginador()).getByRole('status')).toHaveTextContent('Mostrando 1 a 20 de 28 trámites · Página 1 de 2')
  })

  it('el filtro por institución lista solo las de sus trámites y el paginador cuenta lo filtrado', async () => {
    const { user } = await abrirComo('ana.ciudadana', 'Mis trámites')
    await screen.findByRole('row', { name: /Trámite 44:/ })
    const institucion = screen.getByRole('combobox', { name: 'Institución' })
    expect(within(institucion).getAllByRole('option').map((o) => o.textContent)).toEqual(['Todas las instituciones', 'Alcaldía (Municipio de Panamá)', 'MINSA', 'MOP'])
    await user.selectOptions(institucion, 'MINSA')
    expect(filas()).toHaveLength(1)
    await user.selectOptions(institucion, 'MOP')
    expect(within(paginador()).getByRole('status')).toHaveTextContent('Mostrando 1 a 20 de 26 trámites · Página 1 de 2')
    await user.click(within(paginador()).getByRole('button', { name: /Siguiente/ }))
    expect(filas()).toHaveLength(6)
  })

  it('búsqueda, estado e institución se combinan y «Quitar filtros» los limpia', async () => {
    const { user } = await abrirComo('ana.ciudadana', 'Mis trámites')
    await screen.findByRole('row', { name: /Trámite 44:/ })
    await user.selectOptions(screen.getByRole('combobox', { name: 'Institución' }), 'MOP')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Estado' }), 'Aprobado')
    expect(filas()).toHaveLength(13)
    await user.type(screen.getByRole('searchbox'), '#35')
    expect(filas()).toHaveLength(1)
    expect(screen.getByRole('row', { name: /Trámite 35:/ })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Quitar filtros' }))
    expect(screen.getByRole('searchbox')).toHaveValue('')
    expect(screen.getByRole('combobox', { name: 'Estado' })).toHaveValue('')
    expect(within(paginador()).getByRole('status')).toHaveTextContent('de 28 trámites')
  })

  it('los filtros se conservan al abrir un trámite y volver', async () => {
    const { user } = await abrirComo('ana.ciudadana', 'Mis trámites')
    await screen.findByRole('row', { name: /Trámite 44:/ })
    await user.selectOptions(screen.getByRole('combobox', { name: 'Institución' }), 'MINSA')
    await user.click(screen.getByRole('row', { name: /Trámite 36:/ }))
    await screen.findByRole('img', { name: /Recorrido del trámite/ })
    await user.click(screen.getByRole('button', { name: /Volver a Mis trámites/ }))
    await screen.findByRole('row', { name: /Trámite 36:/ })
    expect(screen.getByRole('combobox', { name: 'Institución' })).toHaveValue(String(2))
    expect(filas()).toHaveLength(1)
  })

  it('la barra de búsqueda y filtros es accesible', async () => {
    const { container } = await abrirComo('ana.ciudadana', 'Mis trámites')
    await screen.findByRole('row', { name: /Trámite 44:/ })
    expect(await axe(container, AXE)).toHaveNoViolations()
  })
})

/* ---------------------------------------------------------------- requisitos en el editor del catálogo */

describe('los requisitos en el catálogo de la coordinación', () => {
  async function abrirEditor() {
    const { user, llamadas } = await abrirComo('carla.mop', 'Catálogo de la institución')
    const modal = await screen.findByRole('dialog', { name: /Confirma que eres tú/ })
    await user.type(within(modal).getByLabelText(/Código de 6 dígitos/), '123456')
    await user.click(within(modal).getByRole('button', { name: /Verificar y continuar/ }))
    await screen.findByRole('table', { name: 'Trámites de la institución' })
    await user.click(screen.getByRole('button', { name: 'Editar Permiso de uso de vía pública' }))
    await screen.findByRole('form', { name: 'Editar el trámite' })
    return { user, llamadas }
  }

  it('el editor muestra lo que ya hay, lo guarda y la vista previa es la tarjeta real', async () => {
    const { user, llamadas } = await abrirEditor()
    expect(screen.getByLabelText('Para qué sirve el trámite').value).toContain('Trámite de prueba')
    expect(screen.getByLabelText('Documentos que hay que adjuntar').value.split('\n')).toHaveLength(1)
    const documentos = screen.getByLabelText('Documentos que hay que adjuntar')
    await user.clear(documentos)
    await user.type(documentos, 'Cédula{Enter}Croquis de la zona')
    expect(screen.getAllByRole('heading', { name: 'Antes de empezar' }).length).toBe(1)
    expect(screen.getByText('Croquis de la zona', { selector: 'li' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Guardar los cambios' }))
    await waitFor(() => expect(llamadas.some((l) => l.metodo === 'PATCH')).toBe(true))
    expect(llamadas.find((l) => l.metodo === 'PATCH').cuerpo.requisitos.documentos).toEqual(['Cédula', 'Croquis de la zona'])
  })

  it('un error del servidor sobre un documento se muestra con su encabezado y se quita al escribir', async () => {
    const { user } = await abrirEditor()
    const documentos = screen.getByLabelText('Documentos que hay que adjuntar')
    await user.clear(documentos)
    await user.type(documentos, 'x'.repeat(201))
    await user.click(screen.getByRole('button', { name: 'Guardar los cambios' }))
    expect((await screen.findAllByText(/Documento 1: Cada documento admite hasta 200 caracteres/)).length).toBeGreaterThan(0)
    await user.type(documentos, 'a')
    expect(screen.queryByText(/Cada documento admite hasta 200 caracteres/)).not.toBeInTheDocument()
  })
})
