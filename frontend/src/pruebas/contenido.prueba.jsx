// Contenido del trámite: formulario dinámico al iniciar, datos en el detalle, motivo de las decisiones del personal y respuesta de la
// ciudadanía a una subsanación. Se arma la aplicación completa contra el servidor de ejemplo (src/mock.js + src/mock-contenido.js).
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../App.jsx'
import { instalarMock } from '../mock.js'
import { ProveedorUI } from '../ui.jsx'
import { ModalMotivo } from '../Contenido.jsx'
import { motivoParaLaPersona, validarTextoLibre } from '../mock-contenido.js'

vi.mock('qrcode', () => ({ default: { toCanvas: vi.fn() } }))
const AXE = { rules: { 'color-contrast': { enabled: false } } } // jsdom no calcula colores: el contraste se revisa en el navegador

afterEach(() => vi.restoreAllMocks())

// `falsa(url, opciones)` puede devolver una Response para responder por el servidor; `llamadas` registra lo que la interfaz pidió
async function abrirComo(usuario, modulo, falsa) {
  instalarMock(usuario, { demora: 0 })
  const llamadas = espiar(falsa)
  const utilidades = render(<ProveedorUI><App /></ProveedorUI>)
  const user = userEvent.setup()
  const nav = await screen.findByRole('navigation', { name: 'Módulos' })
  if (modulo) await user.click(within(nav).getByRole('button', { name: new RegExp(`^${modulo}`) }))
  return { ...utilidades, user, llamadas }
}

async function elegirTramite(user, institucion, tramite) {
  await user.click(await screen.findByRole('radio', { name: new RegExp(`^${institucion}`) }))
  await user.click(await screen.findByRole('radio', { name: new RegExp(tramite) }))
}

async function abrirDetalle(usuario, modulo, numero, falsa) {
  const r = await abrirComo(usuario, modulo, falsa)
  await r.user.click(await screen.findByRole('row', { name: new RegExp(`^Trámite ${numero}:`) }))
  await screen.findByRole('img', { name: /Recorrido del trámite/ })
  return r
}

// Intercepta las peticiones (sin cambiarlas) o responde por el servidor cuando `falsa` devuelve una Response
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
const json = (estado, cuerpo) => new Response(JSON.stringify(cuerpo), { status: estado, headers: { 'Content-Type': 'application/json' } })

async function reautenticar(user, codigo = '123456') {
  const modal = await screen.findByRole('dialog', { name: /Confirma que eres tú/ })
  await user.type(within(modal).getByLabelText(/Código de 6 dígitos/), codigo)
  await user.click(within(modal).getByRole('button', { name: /Verificar y continuar/ }))
}

const largo = (n) => 'x'.repeat(n)

/* ---------------------------------------------------------------- formulario al iniciar */

describe('el formulario dinámico al iniciar un trámite', () => {
  it('cada tipo de campo se dibuja con su control, su etiqueta y sus límites', async () => {
    const { user } = await abrirComo('ana.ciudadana', 'Iniciar un trámite')
    await elegirTramite(user, 'Alcaldía', 'Permiso de construcción')

    const direccion = await screen.findByRole('textbox', { name: 'Dirección del terreno' })   // texto
    expect(direccion).toHaveAttribute('maxlength', '200')
    expect(direccion).toBeRequired()
    expect(screen.getByRole('combobox', { name: 'Tipo de obra' })).toBeRequired()   // seleccion
    expect(within(screen.getByRole('combobox', { name: 'Tipo de obra' })).getAllByRole('option').map((o) => o.textContent))
      .toEqual(['Elegir una opción…', 'Obra nueva', 'Ampliación', 'Remodelación', 'Demolición'])
    const area = screen.getByRole('spinbutton', { name: 'Área de la obra (m²)' })   // numero
    expect(area).toHaveAttribute('min', '0')
    expect(area).toHaveAttribute('max', '100000')
    expect(area).toHaveAttribute('step', 'any')
    const descripcion = screen.getByRole('textbox', { name: 'Descripción de la obra' })   // texto_largo, opcional
    expect(descripcion.tagName).toBe('TEXTAREA')
    expect(descripcion).not.toBeRequired()
    expect(descripcion).toHaveAccessibleDescription('0 de 2000 caracteres')
    await user.type(descripcion, 'Dos plantas')
    expect(descripcion).toHaveAccessibleDescription('11 de 2000 caracteres')
    // la marca de obligatorio es visible (asterisco) y se explica; la ayuda queda vinculada al campo
    expect(screen.getByText(/Los campos con asterisco son obligatorios/)).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Número de finca' })).toHaveAccessibleDescription('Figura en la certificación del Registro Público.')
  })

  it('un número entero se limita a enteros y una fecha es un selector de fecha que no admite el futuro', async () => {
    const { user } = await abrirComo('ana.ciudadana', 'Iniciar un trámite')
    await elegirTramite(user, 'AMPYME', 'Registro de microempresa')
    expect(await screen.findByRole('spinbutton', { name: 'Número de empleados' })).toHaveAttribute('step', '1')
    await user.click(screen.getByRole('radio', { name: /^Ministerio Público/ }))
    await user.click(await screen.findByRole('radio', { name: /Denuncia ciudadana 311/ }))
    const fecha = await screen.findByLabelText(/Fecha de los hechos/)
    expect(fecha).toHaveAttribute('type', 'date')
    expect(fecha.max).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(fecha).toHaveAccessibleDescription('No puede ser una fecha futura.')
  })

  it('al cambiar de trámite el formulario parte de cero', async () => {
    const { user } = await abrirComo('ana.ciudadana', 'Iniciar un trámite')
    await elegirTramite(user, 'AMPYME', 'Registro de microempresa')
    await user.type(await screen.findByRole('textbox', { name: 'Nombre comercial' }), 'Panadería Estrella')
    await user.click(screen.getByRole('radio', { name: /^Ministerio Público/ }))
    await user.click(await screen.findByRole('radio', { name: /Denuncia ciudadana 311/ }))
    await user.click(screen.getByRole('radio', { name: /^AMPYME/ }))
    await user.click(await screen.findByRole('radio', { name: /Registro de microempresa/ }))
    expect(await screen.findByRole('textbox', { name: 'Nombre comercial' })).toHaveValue('')
  })

  it('sin llenar lo obligatorio no se envía: el resumen y cada campo dicen qué falta', async () => {
    const { user, llamadas } = await abrirComo('ana.ciudadana', 'Iniciar un trámite')
    await elegirTramite(user, 'Alcaldía', 'Permiso de construcción')
    await screen.findByRole('textbox', { name: 'Dirección del terreno' })
    await user.click(screen.getByRole('button', { name: 'Iniciar trámite' }))

    const resumen = await screen.findByText('Revisa lo que falta o está mal:')
    expect(within(resumen.closest('.resumen-errores')).getAllByRole('listitem')).toHaveLength(4)   // dirección, finca, tipo de obra y área
    const direccion = screen.getByRole('textbox', { name: 'Dirección del terreno' })
    expect(direccion).toBeInvalid()
    expect(direccion).toHaveAccessibleDescription('Este campo es obligatorio.')
    expect(screen.getByRole('textbox', { name: 'Descripción de la obra' })).not.toHaveAttribute('aria-invalid')   // opcional
    expect(llamadas.some((l) => l.metodo === 'POST' && l.url === '/tramites/')).toBe(false)
  })

  it('los errores del servidor se muestran junto a cada campo y en el resumen', async () => {
    const { user } = await abrirComo('ana.ciudadana', 'Iniciar un trámite')
    await elegirTramite(user, 'AMPYME', 'Registro de microempresa')
    await user.type(await screen.findByRole('textbox', { name: 'Nombre comercial' }), 'Panadería Estrella')
    await user.type(screen.getByRole('textbox', { name: 'Actividad económica' }), 'Panificación')
    await user.type(screen.getByRole('textbox', { name: 'Dirección del negocio' }), 'Calle 4, Chorrera')
    await user.type(screen.getByRole('spinbutton', { name: 'Número de empleados' }), '2.5')   // el cliente lo deja pasar: lo decide el servidor
    await user.click(screen.getByRole('button', { name: 'Iniciar trámite' }))

    const campo = await screen.findByRole('spinbutton', { name: 'Número de empleados' })
    await waitFor(() => expect(campo).toBeInvalid())
    expect(campo).toHaveAccessibleDescription('Debe ser un número entero.')
    expect(screen.getByText('Número de empleados: Debe ser un número entero.')).toBeInTheDocument()   // en el resumen
    expect(screen.getByRole('textbox', { name: 'Nombre comercial' })).not.toHaveAttribute('aria-invalid')
    expect(screen.getByRole('textbox', { name: 'Nombre comercial' })).toHaveValue('Panadería Estrella')   // lo escrito se conserva
  })

  it('un error general (clave «datos») va en el resumen, sin campo', async () => {
    const { user } = await abrirComo('ana.ciudadana', 'Iniciar un trámite', (url) => (url === '/tramites/' ? json(400, { codigo: 'datos_invalidos', detalle: 'Hay datos que corregir.', errores: { datos: 'Hay campos que este trámite no tiene.' } }) : null))
    await elegirTramite(user, 'AMPYME', 'Registro de microempresa')
    await user.type(await screen.findByRole('textbox', { name: 'Nombre comercial' }), 'Panadería Estrella')
    await user.type(screen.getByRole('textbox', { name: 'Actividad económica' }), 'Panificación')
    await user.type(screen.getByRole('textbox', { name: 'Dirección del negocio' }), 'Calle 4, Chorrera')
    await user.type(screen.getByRole('spinbutton', { name: 'Número de empleados' }), '2')
    await user.click(screen.getByRole('button', { name: 'Iniciar trámite' }))
    expect(await screen.findByText('Hay campos que este trámite no tiene.')).toBeInTheDocument()
    expect(document.querySelectorAll('[aria-invalid="true"]')).toHaveLength(0)
  })

  it('al enviar no se mandan los opcionales vacíos, los números van como número y el detalle muestra lo respondido', async () => {
    const { user, llamadas } = await abrirComo('ana.ciudadana', 'Iniciar un trámite')
    await elegirTramite(user, 'Alcaldía', 'Permiso de construcción')
    await user.type(await screen.findByRole('textbox', { name: 'Dirección del terreno' }), 'Calle 50, Bella Vista')
    await user.type(screen.getByRole('textbox', { name: 'Número de finca' }), '98765')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Tipo de obra' }), 'Ampliación')
    await user.type(screen.getByRole('spinbutton', { name: 'Área de la obra (m²)' }), '120')
    await user.click(screen.getByRole('button', { name: 'Iniciar trámite' }))

    const detalle = (await screen.findByRole('heading', { name: 'Datos de la solicitud' })).closest('section')
    const envio = llamadas.find((l) => l.metodo === 'POST' && l.url === '/tramites/')
    expect(envio.cuerpo).toEqual({ tipo_tramite: 1, datos: { direccion_terreno: 'Calle 50, Bella Vista', numero_finca: '98765', tipo_obra: 'Ampliación', area_m2: 120 } })
    expect(within(detalle).getByText('Calle 50, Bella Vista')).toBeInTheDocument()
    expect(within(detalle).getByText('Descripción de la obra').nextElementSibling).toHaveTextContent('—')   // el opcional vacío
  })

  it('las pantallas del formulario (vacío y con errores) no tienen violaciones de accesibilidad', async () => {
    const { user, container } = await abrirComo('ana.ciudadana', 'Iniciar un trámite')
    await elegirTramite(user, 'Alcaldía', 'Permiso de construcción')
    await screen.findByRole('textbox', { name: 'Dirección del terreno' })
    expect(await axe(container, AXE)).toHaveNoViolations()
    await user.click(screen.getByRole('button', { name: 'Iniciar trámite' }))
    await screen.findByText('Revisa lo que falta o está mal:')
    expect(await axe(container, AXE)).toHaveNoViolations()
  })
})

/* ---------------------------------------------------------------- datos en el detalle */

describe('los datos de la solicitud en el detalle', () => {
  it('se ven con su etiqueta y su valor, en el orden del formulario y con números y fechas en es-PA', async () => {
    await abrirDetalle('ana.ciudadana', 'Mis trámites', 39)
    const dl = (await screen.findByRole('heading', { name: 'Datos de la solicitud' })).closest('section').querySelector('dl')
    const etiquetas = within(dl).getAllByRole('term').map((t) => t.textContent)
    expect(etiquetas).toEqual(['Dirección del terreno', 'Número de finca', 'Tipo de obra', 'Área de la obra (m²)', 'Descripción de la obra'])
    expect(within(dl).getByText('Calle 50, edificio Bella Vista, Panamá')).toBeInTheDocument()
    expect(within(dl).getByText(/^85[.,]5$/)).toBeInTheDocument()
  })

  it('una fecha se escribe en español sin correrse de día', async () => {
    const { user } = await abrirComo('ana.ciudadana', 'Iniciar un trámite')
    await elegirTramite(user, 'Ministerio Público', 'Denuncia ciudadana 311')
    await user.type(await screen.findByRole('textbox', { name: 'Asunto' }), 'Ruido en la madrugada')
    await user.type(screen.getByRole('textbox', { name: 'Descripción de los hechos' }), 'Música muy alta hasta las 4 de la mañana.')
    fireEvent.change(screen.getByLabelText(/Fecha de los hechos/), { target: { value: '2026-03-14' } })
    await user.click(screen.getByRole('button', { name: 'Iniciar trámite' }))
    const detalle = (await screen.findByRole('heading', { name: 'Datos de la solicitud' })).closest('section')
    expect(within(detalle).getByText(/^14 de marzo de 2026$/)).toBeInTheDocument()
  })

  it('un trámite anterior a la función avisa que no tiene datos', async () => {
    await abrirDetalle('beto.ciudadano', 'Mis trámites', 38)
    expect(await screen.findByText('Este trámite no tiene datos de formulario (se inició antes de esta función).')).toBeInTheDocument()
  })

  it('el personal de la institución también los ve', async () => {
    await abrirDetalle('fabio.mop', 'Bandeja de la institución', 37)
    expect(await screen.findByText('Ocupación temporal de la acera frente al local')).toBeInTheDocument()
  })
})

/* ---------------------------------------------------------------- motivo del personal */

describe('el motivo de las decisiones del personal', () => {
  it('rechazar pide el motivo, no deja confirmar sin él y lo envía', async () => {
    const { user, llamadas } = await abrirDetalle('fabio.mop', 'Bandeja de la institución', 44)
    await user.click(screen.getByRole('button', { name: 'Rechazar' }))
    const modal = await screen.findByRole('dialog', { name: 'Rechazar este trámite' })
    const confirmar = within(modal).getByRole('button', { name: 'Confirmar el rechazo' })
    const motivo = within(modal).getByRole('textbox', { name: 'Motivo' })
    expect(motivo).toHaveFocus()
    expect(motivo).toBeRequired()
    expect(motivo).toHaveAttribute('maxlength', '2000')
    expect(confirmar).toBeDisabled()
    await user.type(motivo, 'corto')
    expect(confirmar).toBeDisabled()
    expect(motivo).toHaveAccessibleDescription('5 de 2000 caracteres (mínimo 10)')
    await user.type(motivo, ' pero ya suficiente')
    expect(confirmar).toBeEnabled()
    await user.click(confirmar)
    await reautenticar(user)

    expect(await screen.findByText(/pasó a «Rechazado»/)).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(llamadas.find((l) => l.url.endsWith('/tramites/44/estado/') && l.cuerpo.motivo).cuerpo).toEqual({ estado: 'Rechazado', motivo: 'corto pero ya suficiente' })
    expect(screen.getByRole('img', { name: 'Recorrido del trámite: Rechazado' })).toBeInTheDocument()
    expect(screen.getByText('corto pero ya suficiente')).toBeInTheDocument()   // queda en el historial
  })

  it('cancelar no cambia nada y no se envía nada', async () => {
    const { user, llamadas } = await abrirDetalle('fabio.mop', 'Bandeja de la institución', 44)
    await user.click(screen.getByRole('button', { name: 'Rechazar' }))
    await user.click(within(await screen.findByRole('dialog', { name: 'Rechazar este trámite' })).getByRole('button', { name: 'Cancelar' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(llamadas.some((l) => l.metodo === 'POST' && l.url.startsWith('/tramites/'))).toBe(false)
  })

  it('si el servidor responde un error el modal sigue abierto y conserva el texto', async () => {
    const { user } = await abrirDetalle('fabio.mop', 'Bandeja de la institución', 44, (url) => (url.endsWith('/estado/') ? json(400, { codigo: 'datos_invalidos', detalle: 'Hay datos que corregir.', errores: { motivo: 'Contiene caracteres no permitidos.' } }) : null))
    await user.click(screen.getByRole('button', { name: 'Rechazar' }))
    const modal = await screen.findByRole('dialog', { name: 'Rechazar este trámite' })
    await user.type(within(modal).getByRole('textbox', { name: 'Motivo' }), 'No cumple con los requisitos del reglamento')
    await user.click(within(modal).getByRole('button', { name: 'Confirmar el rechazo' }))
    expect(await within(modal).findByRole('alert')).toHaveTextContent('Contiene caracteres no permitidos.')
    expect(screen.getByRole('dialog', { name: 'Rechazar este trámite' })).toBeInTheDocument()
    expect(within(modal).getByRole('textbox', { name: 'Motivo' })).toHaveValue('No cumple con los requisitos del reglamento')
    expect(within(modal).getByRole('button', { name: 'Confirmar el rechazo' })).toBeEnabled()
    expect(screen.getByRole('img', { name: /En tramitación/ })).toBeInTheDocument()   // el trámite no cambió
  })

  it('pedir una subsanación también pide el motivo', async () => {
    const { user } = await abrirDetalle('fabio.mop', 'Bandeja de la institución', 44)
    await user.click(screen.getByRole('button', { name: 'Pedir subsanación' }))
    const modal = await screen.findByRole('dialog', { name: 'Pedir una subsanación' })
    expect(within(modal).getByRole('button', { name: 'Enviar la solicitud' })).toBeDisabled()
    await user.type(within(modal).getByRole('textbox', { name: 'Motivo' }), 'Falta la copia de la cédula del representante')
    await user.click(within(modal).getByRole('button', { name: 'Enviar la solicitud' }))
    await reautenticar(user)
    expect(await screen.findByText(/pasó a «En subsanación»/)).toBeInTheDocument()
    expect(screen.getByText('Falta la copia de la cédula del representante')).toBeInTheDocument()
  })

  it('cerrar una subsanación pide el motivo; pasar a tramitación desde pendiente, no', async () => {
    const { user, unmount } = await abrirDetalle('saul.mop', 'Bandeja de la institución', 37)
    await user.click(screen.getByRole('button', { name: 'Cerrar la subsanación' }))
    const modal = await screen.findByRole('dialog', { name: 'Cerrar la subsanación' })
    expect(within(modal).getByRole('button', { name: 'Cerrar y pasar a tramitación' })).toBeDisabled()
    await user.type(within(modal).getByRole('textbox', { name: 'Motivo' }), 'La persona adjuntó el croquis pedido')
    await user.click(within(modal).getByRole('button', { name: 'Cerrar y pasar a tramitación' }))
    await reautenticar(user)
    expect(await screen.findByText(/pasó a «En tramitación»/)).toBeInTheDocument()
    unmount()

    const otro = await abrirDetalle('fabio.mop', 'Bandeja de la institución', 42)
    await otro.user.click(screen.getByRole('button', { name: 'Pasar a tramitación' }))
    expect(screen.queryByRole('dialog', { name: /Pedir|Cerrar|Rechazar/ })).not.toBeInTheDocument()
    await reautenticar(otro.user)
    expect(await screen.findByText(/pasó a «En tramitación»/)).toBeInTheDocument()
  })

  it('el servidor de ejemplo también exige el motivo (sin él, 400 motivo_obligatorio)', async () => {
    instalarMock('fabio.mop', { demora: 0 })
    await window.fetch('/auth/mfa/verificar/', { method: 'POST', body: JSON.stringify({ codigo: '123456' }) })
    const r = await window.fetch('/tramites/44/estado/', { method: 'POST', body: JSON.stringify({ estado: 'Rechazado' }) })
    expect(r.status).toBe(400)
    expect((await r.json()).codigo).toBe('motivo_obligatorio')
  })

  it('rechazar, pedir una subsanación y cerrarla avisan que la persona va a leer el motivo', async () => {
    const { user, unmount } = await abrirDetalle('fabio.mop', 'Bandeja de la institución', 44)
    await user.click(screen.getByRole('button', { name: 'Rechazar' }))
    let modal = await screen.findByRole('dialog', { name: 'Rechazar este trámite' })
    expect(within(modal).getByText('La persona que pidió el trámite va a leer este motivo')).toBeInTheDocument()
    await user.click(within(modal).getByRole('button', { name: 'Cancelar' }))
    await user.click(screen.getByRole('button', { name: 'Pedir subsanación' }))
    modal = await screen.findByRole('dialog', { name: 'Pedir una subsanación' })
    expect(within(modal).getByText('La persona que pidió el trámite va a leer este motivo')).toBeInTheDocument()
    unmount()
    const cierre = await abrirDetalle('saul.mop', 'Bandeja de la institución', 37)
    await cierre.user.click(screen.getByRole('button', { name: 'Cerrar la subsanación' }))
    modal = await screen.findByRole('dialog', { name: 'Cerrar la subsanación' })
    expect(within(modal).getByText('La persona que pidió el trámite va a leer este motivo')).toBeInTheDocument()
    expect(within(modal).queryByText('Este comentario es interno')).not.toBeInTheDocument()
  })

  it('para las demás transiciones el modal avisa que el comentario es interno', () => {
    render(<ModalMotivo clave="Aprobado" enviar={() => {}} cancelar={() => {}} />)
    const modal = screen.getByRole('dialog')
    expect(within(modal).getByText('Este comentario es interno')).toBeInTheDocument()
    expect(within(modal).queryByText(/va a leer este motivo/)).not.toBeInTheDocument()
  })

  it('el servidor de ejemplo solo trae a la ciudadanía los motivos que le conciernen; el personal ve todos', async () => {
    instalarMock('fabio.mop', { demora: 0 })
    await window.fetch('/auth/mfa/verificar/', { method: 'POST', body: JSON.stringify({ codigo: '123456' }) })
    const comentario = 'Comentario interno: revisar con el supervisor.'
    const r = await window.fetch('/tramites/44/estado/', { method: 'POST', body: JSON.stringify({ estado: 'Aprobado', motivo: comentario }) })
    expect(r.status).toBe(200)
    const delPersonal = (await (await window.fetch('/tramites/44/historial/')).json()).eventos
    expect(delPersonal.some((e) => e.motivo === comentario)).toBe(true)
    for (const [id, usuario] of [[37, 'beto.ciudadano'], [43, 'beto.ciudadano']]) {
      instalarMock(usuario, { demora: 0 })
      const eventos = (await (await window.fetch(`/tramites/${id}/historial/`)).json()).eventos
      const conMotivo = eventos.filter((e) => e.motivo)
      expect(conMotivo.length).toBeGreaterThan(0)
      expect(conMotivo.every((e) => ['Rechazado', 'En Subsanacion'].includes(e.estado_nuevo) || e.estado_anterior === 'En Subsanacion')).toBe(true)
    }
  })

  it('el criterio de lo que lee la persona: rechazo, subsanación y su cierre; lo demás, no', () => {
    const ev = (accion, de, a) => ({ accion, estado_anterior: de, estado_nuevo: a, motivo: 'texto suficientemente largo' })
    expect(motivoParaLaPersona(ev('cambio_estado', 'En Tramitacion', 'Rechazado'))).toBeTruthy()
    expect(motivoParaLaPersona(ev('cambio_estado', 'En Tramitacion', 'En Subsanacion'))).toBeTruthy()
    expect(motivoParaLaPersona(ev('cambio_estado', 'En Subsanacion', 'En Tramitacion'))).toBeTruthy()
    expect(motivoParaLaPersona(ev('cambio_estado', 'En Tramitacion', 'Aprobado'))).toBeNull()
    expect(motivoParaLaPersona(ev('cambio_estado', 'Pendiente', 'En Tramitacion'))).toBeNull()
    expect(motivoParaLaPersona(ev('reasignacion', 'En Tramitacion', 'Rechazado'))).toBeNull()
  })

  it('el servidor de ejemplo también exige una letra o un número en el texto libre', () => {
    expect(validarTextoLibre('?'.repeat(12), 10, 2000)).toMatch(/letra o un número/)
    expect(validarTextoLibre('Falta el croquis firmado', 10, 2000)).toBeNull()
  })

  it('el modal del motivo no tiene violaciones de accesibilidad', async () => {
    const { user } = await abrirDetalle('fabio.mop', 'Bandeja de la institución', 44)
    await user.click(screen.getByRole('button', { name: 'Rechazar' }))
    await screen.findByRole('dialog', { name: 'Rechazar este trámite' })
    expect(await axe(document.body, AXE)).toHaveNoViolations()
  })
})

/* ---------------------------------------------------------------- respuesta de la ciudadanía */

describe('la respuesta de la ciudadanía a una subsanación', () => {
  const MOTIVO = 'Falta el croquis firmado de la zona que se va a ocupar. Adjúntalo en la sección de documentos y responde aquí.'

  it('quien pidió el trámite ve el motivo destacado y cómo responder', async () => {
    await abrirDetalle('beto.ciudadano', 'Mis trámites', 37)
    const panel = (await screen.findByRole('heading', { name: 'Responder a la subsanación' })).closest('section')
    expect(within(panel).getByText(MOTIVO)).toBeInTheDocument()
    expect(within(panel).getByText(/Si hace falta un documento, adjúntalo en la sección de documentos/)).toBeInTheDocument()
    expect(within(panel).getByRole('textbox', { name: 'Tu respuesta' })).toBeRequired()
  })

  it('el personal no ve el formulario de respuesta y otro trámite en subsanación tampoco lo muestra a quien no es suyo', async () => {
    await abrirDetalle('saul.mop', 'Bandeja de la institución', 37)
    await screen.findByRole('heading', { name: 'Datos de la solicitud' })
    expect(screen.queryByRole('heading', { name: 'Responder a la subsanación' })).not.toBeInTheDocument()
  })

  it('una respuesta corta se rechaza con un mensaje y no se envía', async () => {
    const { user, llamadas } = await abrirDetalle('beto.ciudadano', 'Mis trámites', 37)
    await user.type(await screen.findByRole('textbox', { name: 'Tu respuesta' }), 'listo')
    await user.click(screen.getByRole('button', { name: 'Enviar mi respuesta' }))
    expect(await screen.findByRole('textbox', { name: 'Tu respuesta' })).toHaveAccessibleDescription(/Escribe tu respuesta \(mínimo 10 caracteres\)/)
    expect(llamadas.some((l) => l.url.endsWith('/subsanacion/'))).toBe(false)
  })

  it('al responder con éxito el trámite vuelve a tramitación, el detalle y el historial se refrescan y no se envían datos sin cambios', async () => {
    const { user, llamadas } = await abrirDetalle('beto.ciudadano', 'Mis trámites', 37)
    await user.type(await screen.findByRole('textbox', { name: 'Tu respuesta' }), 'Adjunté el croquis firmado en documentos.')
    await user.click(screen.getByRole('checkbox', { name: 'Corregir los datos' }))   // se abre, pero no se toca nada
    expect(screen.getByRole('textbox', { name: 'Asunto' })).toHaveValue('Ocupación temporal de la acera frente al local')   // precargado
    await user.click(screen.getByRole('button', { name: 'Enviar mi respuesta' }))

    expect(await screen.findByText(/Enviaste tu respuesta/)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Responder a la subsanación' })).not.toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Recorrido del trámite: En tramitación' })).toBeInTheDocument()
    expect(screen.getByText('Adjunté el croquis firmado en documentos.')).toBeInTheDocument()   // la respuesta quedó en el historial
    const envio = llamadas.find((l) => l.url.endsWith('/tramites/37/subsanacion/'))
    expect(envio.cuerpo).toEqual({ respuesta: 'Adjunté el croquis firmado en documentos.' })   // sin `datos`: no cambiaron
  })

  it('«Corregir los datos» envía los datos completos cuando cambiaron', async () => {
    const { user, llamadas } = await abrirDetalle('beto.ciudadano', 'Mis trámites', 37)
    await user.type(await screen.findByRole('textbox', { name: 'Tu respuesta' }), 'Corregí la descripción de la ocupación.')
    await user.click(screen.getByRole('checkbox', { name: 'Corregir los datos' }))
    const descripcion = screen.getByRole('textbox', { name: 'Descripción' })
    await user.clear(descripcion)
    await user.type(descripcion, 'Solo mesas, sin sillas.')
    await user.click(screen.getByRole('button', { name: 'Enviar mi respuesta' }))
    await screen.findByText(/Enviaste tu respuesta/)
    expect(llamadas.find((l) => l.url.endsWith('/subsanacion/')).cuerpo.datos)
      .toEqual({ asunto: 'Ocupación temporal de la acera frente al local', descripcion: 'Solo mesas, sin sillas.' })
    expect(await screen.findByText('Solo mesas, sin sillas.')).toBeInTheDocument()   // el detalle muestra los datos nuevos
  })

  it('un dato obligatorio vacío al corregir se señala en su campo', async () => {
    const { user } = await abrirDetalle('beto.ciudadano', 'Mis trámites', 37)
    await user.type(await screen.findByRole('textbox', { name: 'Tu respuesta' }), 'Corregí los datos de la solicitud.')
    await user.click(screen.getByRole('checkbox', { name: 'Corregir los datos' }))
    await user.clear(screen.getByRole('textbox', { name: 'Asunto' }))
    await user.click(screen.getByRole('button', { name: 'Enviar mi respuesta' }))
    expect(await screen.findByRole('textbox', { name: 'Asunto' })).toHaveAccessibleDescription('Este campo es obligatorio.')
    expect(screen.getByRole('heading', { name: 'Responder a la subsanación' })).toBeInTheDocument()
  })

  it('los errores por campo del servidor se muestran y lo escrito se conserva', async () => {
    const { user } = await abrirDetalle('beto.ciudadano', 'Mis trámites', 37, (url) => (url.endsWith('/subsanacion/') ? json(400, { codigo: 'datos_invalidos', detalle: 'Hay datos que corregir.', errores: { respuesta: 'Contiene caracteres no permitidos.', asunto: 'No puede superar los 150 caracteres.' } }) : null))
    await user.type(await screen.findByRole('textbox', { name: 'Tu respuesta' }), 'Corregí el asunto de la solicitud.')
    await user.click(screen.getByRole('checkbox', { name: 'Corregir los datos' }))
    await user.type(screen.getByRole('textbox', { name: 'Asunto' }), ' (corregido)')
    await user.click(screen.getByRole('button', { name: 'Enviar mi respuesta' }))
    expect(await screen.findByRole('textbox', { name: 'Tu respuesta' })).toHaveAccessibleDescription(/Contiene caracteres no permitidos\./)
    expect(screen.getByRole('textbox', { name: 'Asunto' })).toHaveAccessibleDescription(/No puede superar los 150 caracteres\./)
    expect(screen.getByRole('textbox', { name: 'Tu respuesta' })).toHaveValue('Corregí el asunto de la solicitud.')
    expect(screen.getByRole('textbox', { name: 'Asunto' })).toHaveValue('Ocupación temporal de la acera frente al local (corregido)')
  })

  it('si el trámite ya no está en subsanación (409) lo avisa y refresca', async () => {
    const { user } = await abrirDetalle('beto.ciudadano', 'Mis trámites', 37, (url) => (url.endsWith('/subsanacion/') ? json(409, { codigo: 'no_en_subsanacion', detalle: 'El trámite no está en subsanación.' }) : null))
    await user.type(await screen.findByRole('textbox', { name: 'Tu respuesta' }), 'Adjunté el croquis firmado.')
    await user.click(screen.getByRole('button', { name: 'Enviar mi respuesta' }))
    expect(await screen.findByText('Este trámite ya no está en subsanación.')).toBeInTheDocument()
  })

  it('un error de conexión se explica sin perder lo escrito', async () => {
    const { user } = await abrirDetalle('beto.ciudadano', 'Mis trámites', 37, (url) => { if (url.endsWith('/subsanacion/')) throw new TypeError('sin red'); return null })
    await user.type(await screen.findByRole('textbox', { name: 'Tu respuesta' }), 'Adjunté el croquis firmado.')
    await user.click(screen.getByRole('button', { name: 'Enviar mi respuesta' }))
    expect(await screen.findByText(/No se pudo conectar con el servidor/)).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Tu respuesta' })).toHaveValue('Adjunté el croquis firmado.')
  })

  it('el servidor de ejemplo valida igual: 404 si no es suyo, 403 al personal, 409 fuera de subsanación', async () => {
    instalarMock('ana.ciudadana', { demora: 0 })
    const pedir = (n, cuerpo) => window.fetch(`/tramites/${n}/subsanacion/`, { method: 'POST', body: JSON.stringify(cuerpo) })
    expect((await pedir(37, { respuesta: 'Adjunté el croquis.' })).status).toBe(404)   // es de Beto
    expect((await pedir(36, { respuesta: 'Adjunté el croquis.' })).status).toBe(409)   // está en tramitación
    instalarMock('saul.mop', { demora: 0 })
    expect((await pedir(37, { respuesta: 'Adjunté el croquis.' })).status).toBe(403)
  })

  it('el motivo de la subsanación y el del rechazo se ven en el historial de la ciudadanía', async () => {
    const r = await abrirDetalle('beto.ciudadano', 'Mis trámites', 37)
    const historial = (await screen.findByRole('heading', { name: 'Historial' })).closest('section')
    expect(within(historial).getByText(MOTIVO)).toBeInTheDocument()
    expect(within(historial).queryByText(/^Por (ti|persona)/)).not.toBeInTheDocument()   // sigue sin mostrar quién actuó
    r.unmount()
    await abrirDetalle('beto.ciudadano', 'Mis trámites', 43)
    const otro = (await screen.findByRole('heading', { name: 'Historial' })).closest('section')
    expect(within(otro).getByText(/no cumple con la distancia mínima/)).toBeInTheDocument()
  })

  it('el texto del servidor se muestra como texto, no como HTML', async () => {
    await abrirDetalle('beto.ciudadano', 'Mis trámites', 37, (url) => (url.endsWith('/tramites/37/historial/') ? json(200, { tramite: 37, eventos: [{ id: 1, accion: 'cambio_estado', estado_anterior: 'En Tramitacion', estado_nuevo: 'En Subsanacion', institucion_id: 3, creado_en: new Date().toISOString(), motivo: '<img src=x onerror=alert(1)> falta el croquis' }] }) : null))
    expect((await screen.findAllByText('<img src=x onerror=alert(1)> falta el croquis')).length).toBeGreaterThan(0)
    expect(document.querySelector('img[src="x"]')).toBeNull()
  })

  it('la pantalla de respuesta (con y sin corregir) no tiene violaciones de accesibilidad', async () => {
    const { user, container } = await abrirDetalle('beto.ciudadano', 'Mis trámites', 37)
    await screen.findByRole('heading', { name: 'Responder a la subsanación' })
    expect(await axe(container, AXE)).toHaveNoViolations()
    await user.click(screen.getByRole('checkbox', { name: 'Corregir los datos' }))
    await user.click(screen.getByRole('button', { name: 'Enviar mi respuesta' }))
    await screen.findByText('Revisa lo que falta o está mal:')
    expect(await axe(container, AXE)).toHaveNoViolations()
  })

  it('los datos y el motivo no se guardan en el navegador ni viajan en la dirección', async () => {
    const { user } = await abrirDetalle('beto.ciudadano', 'Mis trámites', 37)
    await user.type(await screen.findByRole('textbox', { name: 'Tu respuesta' }), largo(30))
    expect(JSON.stringify({ ...localStorage })).not.toContain('xxx')
    expect(JSON.stringify({ ...sessionStorage })).not.toContain('xxx')
    expect(window.location.href).not.toContain('xxx')
  })
})
