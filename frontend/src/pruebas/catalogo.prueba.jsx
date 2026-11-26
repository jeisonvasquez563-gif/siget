// Catálogo de la institución: la coordinación crea, edita, activa y desactiva los trámites de su institución, con un editor visual del
// formulario, vista previa con el componente real de campos, errores del servidor por campo e historial de cambios.
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'
import { describe, expect, it, vi } from 'vitest'
import App from '../App.jsx'
import { api, iniciarSesion } from '../api.js'
import { describirCambio } from '../Catalogo.jsx'
import {
  borradorDesde, borradorVacio, campoAServidor, campoVacio, camposDeVista, cuerpoDe, encabezadoDeError, idDesde, resumenDeErrores, validarBorrador,
} from '../catalogo-reglas.js'
import { instalarMock } from '../mock.js'
import { ProveedorUI } from '../ui.jsx'

vi.mock('qrcode', () => ({ default: { toCanvas: vi.fn() } }))
const AXE = { rules: { 'color-contrast': { enabled: false } } }
const TRAMITE = 'Permiso de uso de vía pública'

// La coordinación entra sin un segundo factor reciente: el servidor pide el código y la pantalla lo pide antes de mostrar nada
async function verificar(user) {
  const modal = await screen.findByRole('dialog', { name: /Confirma que eres tú/ })
  await user.type(within(modal).getByLabelText(/Código de 6 dígitos/), '123456')
  await user.click(within(modal).getByRole('button', { name: /Verificar y continuar/ }))
}

async function abrir(usuario = 'carla.mop') {
  instalarMock(usuario, { demora: 0 })
  const utilidades = render(<ProveedorUI><App /></ProveedorUI>)
  const nav = await screen.findByRole('navigation', { name: 'Módulos' })
  const user = userEvent.setup()
  await user.click(within(nav).getByRole('button', { name: /^Catálogo de la institución/ }))
  await verificar(user)
  await screen.findByRole('table', { name: 'Trámites de la institución' })
  return { ...utilidades, user }
}

const fila = (nombre) => screen.getByRole('row', { name: new RegExp(nombre) })
const tarjeta = (n) => screen.getByRole('group', { name: new RegExp(`^Campo ${n}\\b`) })
const principal = () => within(screen.getByRole('main'))

async function nuevoTramite(user, nombre, plazo = '7') {
  await user.click(screen.getByRole('button', { name: /Nuevo trámite/ }))
  await screen.findByRole('form', { name: 'Nuevo trámite' })
  await user.type(screen.getByLabelText(/^Nombre del trámite/), nombre)
  await user.clear(screen.getByLabelText(/^Plazo/))
  await user.type(screen.getByLabelText(/^Plazo/), plazo)
}

async function agregarCampo(user, etiqueta) {
  await user.click(screen.getByRole('button', { name: /Agregar campo/ }))
  const n = screen.getAllByRole('group', { name: /^Campo \d+\b/ }).length
  if (etiqueta) await user.type(within(tarjeta(n)).getByLabelText(/^Etiqueta/), etiqueta)
  return n
}

describe('quién ve el módulo', () => {
  it('solo la coordinación tiene «Catálogo de la institución» en su menú', async () => {
    for (const [usuario, ve] of [['carla.mop', true], ['saul.mop', false], ['fabio.mop', false], ['ana.ciudadana', false], ['cata.catalogo', false]]) {
      instalarMock(usuario, { demora: 0 })
      const { unmount } = render(<ProveedorUI><App /></ProveedorUI>)
      const nav = await screen.findByRole('navigation', { name: 'Módulos' })
      expect(within(nav).queryByRole('button', { name: /^Catálogo de la institución/ }) !== null, usuario).toBe(ve)
      unmount()
    }
  })

  it('al abrirlo pide el segundo factor reciente y después muestra el catálogo de SU institución, con los desactivados', async () => {
    await abrir()
    expect(screen.getByRole('heading', { level: 2, name: 'Catálogo de la institución' })).toBeInTheDocument()
    expect(fila(TRAMITE)).toHaveTextContent(/10 días hábiles/)
    expect(fila(TRAMITE)).toHaveTextContent(/Ciudadanía/)
    expect(fila(TRAMITE)).toHaveTextContent(/Activo/)
    expect(fila('Solicitud interinstitucional de información')).toHaveTextContent(/Otras instituciones/)
    expect(principal().queryByText('Certificado de salud ocupacional')).not.toBeInTheDocument() // es del MINSA
  })

  it('la lista no tiene problemas de accesibilidad', async () => {
    const { container } = await abrir()
    expect(await axe(container, AXE)).toHaveNoViolations()
  })
})

describe('crear un trámite con su formulario', () => {
  it('el id se genera de la etiqueta, se puede editar y la vista previa usa el componente real de campos', async () => {
    const { user } = await abrir()
    await nuevoTramite(user, 'Licencia de rotulación')
    await agregarCampo(user, 'Número de finca')
    expect(within(tarjeta(1)).getByLabelText(/^Id/)).toHaveValue('numero_de_finca')
    await user.clear(within(tarjeta(1)).getByLabelText(/^Id/))
    await user.type(within(tarjeta(1)).getByLabelText(/^Id/), 'finca')
    await user.type(within(tarjeta(1)).getByLabelText(/^Etiqueta/), ' registrada') // con el id ya editado a mano, deja de seguir a la etiqueta
    expect(within(tarjeta(1)).getByLabelText(/^Id/)).toHaveValue('finca')

    await user.click(within(tarjeta(1)).getByLabelText('Obligatorio'))
    await user.type(within(tarjeta(1)).getByLabelText(/^Ayuda/), 'Figura en la certificación.')
    const vista = screen.getByRole('form', { name: 'Vista previa del formulario' })
    const entrada = within(vista).getByLabelText(/^Número de finca registrada/)
    expect(entrada).toBeRequired()
    expect(within(vista).getByText('Figura en la certificación.')).toBeInTheDocument()
    await user.type(entrada, 'prueba')
    expect(entrada).toHaveValue('prueba') // se puede probar el campo; no se envía nada
  })

  it('un campo de selección toma sus opciones de una por línea y la vista previa las ofrece', async () => {
    const { user } = await abrir()
    await nuevoTramite(user, 'Permiso especial')
    await agregarCampo(user, 'Motivo')
    await user.selectOptions(within(tarjeta(1)).getByLabelText('Tipo de campo'), 'seleccion')
    await user.type(within(tarjeta(1)).getByLabelText(/^Opciones/), 'Uno{Enter}Dos{Enter}{Enter}Tres')
    const vista = screen.getByRole('form', { name: 'Vista previa del formulario' })
    const lista = within(vista).getByRole('combobox', { name: /^Motivo/ })
    expect(within(lista).getAllByRole('option').map((o) => o.textContent)).toEqual(['Elegir una opción…', 'Uno', 'Dos', 'Tres'])
    expect(within(tarjeta(1)).queryByLabelText(/^Largo máximo/)).not.toBeInTheDocument() // el largo solo aplica a los textos
  })

  it('los campos numéricos piden su valor máximo y pueden ser solo enteros', async () => {
    const { user } = await abrir()
    await nuevoTramite(user, 'Inventario')
    await agregarCampo(user, 'Cantidad')
    await user.selectOptions(within(tarjeta(1)).getByLabelText('Tipo de campo'), 'numero')
    expect(within(tarjeta(1)).getByLabelText(/^Valor máximo/)).toHaveValue('100000')
    await user.click(within(tarjeta(1)).getByLabelText('Solo números enteros'))
    const vista = screen.getByRole('form', { name: 'Vista previa del formulario' })
    expect(within(vista).getByLabelText(/^Cantidad/)).toHaveAttribute('step', '1')
  })

  it('agregar, quitar y reordenar los campos', async () => {
    const { user } = await abrir()
    await nuevoTramite(user, 'Con varios campos')
    await agregarCampo(user, 'Primero')
    await agregarCampo(user, 'Segundo')
    await agregarCampo(user, 'Tercero')
    expect(within(tarjeta(1)).getByLabelText(/^Etiqueta/)).toHaveValue('Primero')
    expect(screen.getByRole('button', { name: 'Subir el campo 1' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Bajar el campo 3' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Bajar el campo 1' }))
    expect(within(tarjeta(1)).getByLabelText(/^Etiqueta/)).toHaveValue('Segundo')
    expect(within(tarjeta(2)).getByLabelText(/^Etiqueta/)).toHaveValue('Primero')
    await user.click(screen.getByRole('button', { name: 'Subir el campo 3' }))
    expect(within(tarjeta(2)).getByLabelText(/^Etiqueta/)).toHaveValue('Tercero')

    await user.click(screen.getByRole('button', { name: 'Quitar el campo 2' }))
    expect(screen.getAllByRole('group', { name: /^Campo \d+\b/ })).toHaveLength(2)
    expect(within(tarjeta(1)).getByLabelText(/^Etiqueta/)).toHaveValue('Segundo')
    expect(within(tarjeta(2)).getByLabelText(/^Etiqueta/)).toHaveValue('Primero')
    const vista = screen.getByRole('form', { name: 'Vista previa del formulario' })
    expect(within(vista).getAllByRole('textbox').map((t) => t.getAttribute('id') && t.closest('.campo').querySelector('label').textContent)).toEqual(['Segundo', 'Primero'])
  })

  it('el editor con campos no tiene problemas de accesibilidad', async () => {
    const { user, container } = await abrir()
    await nuevoTramite(user, 'Accesible')
    await agregarCampo(user, 'Motivo')
    await user.selectOptions(within(tarjeta(1)).getByLabelText('Tipo de campo'), 'seleccion')
    await user.type(within(tarjeta(1)).getByLabelText(/^Opciones/), 'Uno{Enter}Dos')
    expect(await axe(container, AXE)).toHaveNoViolations()
  })

  it('guarda el trámite nuevo y aparece en la lista con sus campos, activo', async () => {
    const { user } = await abrir()
    await nuevoTramite(user, 'Licencia de rotulación', '12')
    await agregarCampo(user, 'Dirección del local')
    await user.selectOptions(screen.getByLabelText('Para quién es'), 'ambas')
    await user.click(screen.getByRole('button', { name: 'Crear el trámite' }))
    expect(await screen.findByText(/«Licencia de rotulación» se agregó al catálogo/)).toBeInTheDocument()
    const nueva = await screen.findByRole('row', { name: /Licencia de rotulación/ })
    expect(nueva).toHaveTextContent(/12 días hábiles/)
    expect(nueva).toHaveTextContent(/Ciudadanía y otras instituciones/)
    expect(nueva).toHaveTextContent(/Activo/)
    // y la ciudadanía ya lo puede iniciar: el catálogo público lo ofrece
    const publico = await api('/catalogo/tipos-tramite/?institucion=3')
    expect(publico.some((t) => t.nombre === 'Licencia de rotulación' && t.formulario[0].id === 'direccion_del_local')).toBe(true)
  })

  it('un nombre con etiquetas HTML se dibuja como texto, nunca como HTML', async () => {
    const { user } = await abrir()
    await nuevoTramite(user, '<img src=x onerror=alert(1)> trámite')
    await user.click(screen.getByRole('button', { name: 'Crear el trámite' }))
    const celda = await screen.findByRole('rowheader', { name: '<img src=x onerror=alert(1)> trámite' })
    expect(celda.querySelector('img')).toBeNull()
    expect(principal().queryByRole('img')).not.toBeInTheDocument()
  })
})

describe('errores', () => {
  it('lo evidente se corrige sin viajar al servidor, con el error junto a cada campo y un resumen', async () => {
    const { user } = await abrir()
    await user.click(screen.getByRole('button', { name: /Nuevo trámite/ }))
    await user.clear(screen.getByLabelText(/^Plazo/))
    await user.type(screen.getByLabelText(/^Plazo/), '400')
    await agregarCampo(user, 'Asunto')
    await agregarCampo(user, 'Detalle')
    await user.clear(within(tarjeta(2)).getByLabelText(/^Id/))
    await user.type(within(tarjeta(2)).getByLabelText(/^Id/), 'asunto') // el mismo id que el primero
    await user.selectOptions(within(tarjeta(2)).getByLabelText('Tipo de campo'), 'seleccion')
    await user.click(screen.getByRole('button', { name: 'Crear el trámite' }))

    const resumen = await screen.findByText('Revisa lo que falta o está mal:')
    const caja = resumen.closest('.resumen-errores')
    expect(within(caja).getByText(/Nombre: Escribe un nombre/)).toBeInTheDocument()
    expect(within(caja).getByText(/Plazo: Indica un número entero de 1 a 365/)).toBeInTheDocument()
    expect(within(caja).getByText(/Campo 2 · id: Otro campo ya usa este id/)).toBeInTheDocument()
    expect(within(caja).getByText(/Campo 2 · opciones: Agrega al menos una opción/)).toBeInTheDocument()
    expect(within(tarjeta(2)).getByLabelText(/^Id/)).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText(/^Nombre del trámite/)).toHaveAccessibleDescription(/Escribe un nombre de al menos 3 caracteres/)
    expect(await axe(screen.getByRole('main'), AXE)).toHaveNoViolations()
    // corregir un campo quita su error
    await user.type(screen.getByLabelText(/^Nombre del trámite/), 'Trámite de prueba')
    expect(screen.getByLabelText(/^Nombre del trámite/)).not.toHaveAttribute('aria-invalid')
  })

  it('lo que solo sabe el servidor llega por campo: un largo fuera de límite', async () => {
    const { user } = await abrir()
    await nuevoTramite(user, 'Con un largo excesivo')
    await agregarCampo(user, 'Detalle')
    await user.clear(within(tarjeta(1)).getByLabelText(/^Largo máximo/))
    await user.type(within(tarjeta(1)).getByLabelText(/^Largo máximo/), '501')
    await user.click(screen.getByRole('button', { name: 'Crear el trámite' }))

    const caja = (await screen.findByText('Revisa lo que falta o está mal:')).closest('.resumen-errores')
    expect(within(caja).getByText(/Campo 1 · máximo: No puede ser mayor que 500/)).toBeInTheDocument()
    expect(within(tarjeta(1)).getByLabelText(/^Largo máximo/)).toHaveAccessibleDescription(/No puede ser mayor que 500/)
    expect(screen.getByRole('form', { name: 'Nuevo trámite' })).toBeInTheDocument() // el editor sigue abierto con lo escrito
    expect(screen.getByLabelText(/^Nombre del trámite/)).toHaveValue('Con un largo excesivo')
    // al corregirlo se guarda
    await user.clear(within(tarjeta(1)).getByLabelText(/^Largo máximo/))
    await user.type(within(tarjeta(1)).getByLabelText(/^Largo máximo/), '500')
    await user.click(screen.getByRole('button', { name: 'Crear el trámite' }))
    expect(await screen.findByText(/«Con un largo excesivo» se agregó al catálogo/)).toBeInTheDocument()
  })

  it('un nombre repetido en la institución lo rechaza el servidor, junto al campo, sin importar mayúsculas', async () => {
    const { user } = await abrir()
    await nuevoTramite(user, TRAMITE.toUpperCase())
    await user.click(screen.getByRole('button', { name: 'Crear el trámite' }))
    const caja = (await screen.findByText('Revisa lo que falta o está mal:')).closest('.resumen-errores')
    expect(within(caja).getByText(/Nombre: Ya existe un trámite con ese nombre en esta institución/)).toBeInTheDocument()
    expect(screen.getByLabelText(/^Nombre del trámite/)).toHaveAccessibleDescription(/Ya existe un trámite con ese nombre/)
    expect(screen.getByRole('form', { name: 'Nuevo trámite' })).toBeInTheDocument()
  })
})

describe('editar', () => {
  it('trae lo guardado, guarda el cambio y queda en el historial a nombre de quien lo hizo', async () => {
    const { user } = await abrir()
    await user.click(screen.getByRole('button', { name: `Editar ${TRAMITE}` }))
    await screen.findByRole('form', { name: 'Editar el trámite' })
    expect(screen.getByLabelText(/^Nombre del trámite/)).toHaveValue(TRAMITE)
    expect(screen.getByLabelText(/^Plazo/)).toHaveValue('10')
    expect(within(tarjeta(1)).getByLabelText(/^Etiqueta/)).toHaveValue('Asunto')
    expect(within(tarjeta(1)).getByLabelText(/^Id/)).toHaveValue('asunto') // el id guardado no se regenera
    await user.type(within(tarjeta(1)).getByLabelText(/^Etiqueta/), ' del permiso')
    expect(within(tarjeta(1)).getByLabelText(/^Id/)).toHaveValue('asunto')

    await user.clear(screen.getByLabelText(/^Plazo/))
    await user.type(screen.getByLabelText(/^Plazo/), '15')
    await user.click(screen.getByRole('button', { name: 'Guardar los cambios' }))
    expect(await screen.findByText(/Guardaste los cambios de/)).toBeInTheDocument()
    expect(await screen.findByRole('row', { name: new RegExp(TRAMITE) })).toHaveTextContent(/15 días hábiles/)

    await user.click(screen.getByRole('tab', { name: 'Historial de cambios' }))
    const primera = (await screen.findAllByRole('row'))[1]
    expect(primera).toHaveTextContent('carla.mop')
    expect(primera).toHaveTextContent(`Cambió el plazo de «${TRAMITE}»: 10 → 15 días hábiles.`)
    expect(primera).toHaveTextContent(/Cambió el formulario de/)
  })

  it('cancelar vuelve a la lista sin guardar nada', async () => {
    const { user } = await abrir()
    await user.click(screen.getByRole('button', { name: `Editar ${TRAMITE}` }))
    await user.clear(screen.getByLabelText(/^Nombre del trámite/))
    await user.type(screen.getByLabelText(/^Nombre del trámite/), 'Otro nombre')
    await user.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(await screen.findByRole('row', { name: new RegExp(TRAMITE) })).toBeInTheDocument()
    expect(principal().queryByText('Otro nombre')).not.toBeInTheDocument()
  })
})

describe('activar y desactivar', () => {
  it('desactivar pide confirmar y explica el efecto; el catálogo público deja de ofrecerlo y los trámites existentes no se tocan', async () => {
    const { user } = await abrir()
    await user.click(screen.getByRole('button', { name: `Desactivar ${TRAMITE}` }))
    const dialogo = await screen.findByRole('alertdialog', { name: `Desactivar «${TRAMITE}»` })
    expect(dialogo).toHaveTextContent(/Dejará de ofrecerse para iniciar trámites nuevos/)
    expect(dialogo).toHaveTextContent(/No se borra: los trámites que ya existen de este tipo siguen su curso/)
    await user.click(within(dialogo).getByRole('button', { name: 'Cancelar' }))
    expect(fila(TRAMITE)).toHaveTextContent(/Activo/)
    expect((await api('/catalogo/tipos-tramite/?institucion=3')).some((t) => t.nombre === TRAMITE)).toBe(true)

    await user.click(screen.getByRole('button', { name: `Desactivar ${TRAMITE}` }))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Desactivar' }))
    expect(await screen.findByText(/ya no se ofrece para trámites nuevos/)).toBeInTheDocument()
    expect(fila(TRAMITE)).toHaveTextContent(/Desactivado/)
    expect(screen.getByRole('button', { name: `Activar ${TRAMITE}` })).toBeInTheDocument()
    expect((await api('/catalogo/tipos-tramite/?institucion=3')).some((t) => t.nombre === TRAMITE)).toBe(false)
  })

  it('un trámite desactivado se puede volver a activar, y los dos cambios quedan en el historial', async () => {
    const { user } = await abrir()
    await user.click(screen.getByRole('button', { name: `Desactivar ${TRAMITE}` }))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Desactivar' }))
    await screen.findByRole('button', { name: `Activar ${TRAMITE}` })
    await user.click(screen.getByRole('button', { name: `Activar ${TRAMITE}` }))
    const dialogo = await screen.findByRole('alertdialog', { name: `Activar «${TRAMITE}»` })
    expect(dialogo).toHaveTextContent(/Volverá a ofrecerse para iniciar trámites nuevos/)
    await user.click(within(dialogo).getByRole('button', { name: 'Activar' }))
    expect(await screen.findByText(/vuelve a ofrecerse/)).toBeInTheDocument()
    expect(fila(TRAMITE)).toHaveTextContent(/Activo/)

    await user.click(screen.getByRole('tab', { name: 'Historial de cambios' }))
    const filas = await screen.findAllByRole('row')
    expect(filas[1]).toHaveTextContent(`Activó «${TRAMITE}»: vuelve a ofrecerse para trámites nuevos.`)
    expect(filas[2]).toHaveTextContent(`Desactivó «${TRAMITE}»: ya no se ofrece para trámites nuevos.`)
  })

  it('iniciar un trámite de un tipo desactivado responde 400 claro', async () => {
    const { user } = await abrir()
    await user.click(screen.getByRole('button', { name: `Desactivar ${TRAMITE}` }))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Desactivar' }))
    await screen.findByText(/ya no se ofrece para trámites nuevos/)
    const id = (await api('/catalogo/institucion/3/tipos/')).tipos.find((t) => t.nombre === TRAMITE).id
    await iniciarSesion('ana.ciudadana', 'una-clave-de-prueba', '123456') // la ciudadanía, que es quien inicia trámites
    await expect(api('/tramites/', { metodo: 'POST', cuerpo: { tipo_tramite: id, datos: {} } })).rejects.toMatchObject({ estado: 400, datos: { codigo: 'tipo_tramite_inactivo' } })
  })
})

describe('historial de cambios', () => {
  it('muestra quién, cuándo y qué, del más reciente al más antiguo, y se pagina', async () => {
    const { user } = await abrir()
    await user.click(screen.getByRole('tab', { name: 'Historial de cambios' }))
    await screen.findByRole('table', { name: 'Cambios del catálogo' })
    const filas = screen.getAllByRole('row').slice(1)
    expect(filas).toHaveLength(20)
    expect(filas[0]).toHaveTextContent('carla.mop')
    expect(filas[0]).toHaveTextContent(`Activó «${TRAMITE}»`)
    expect(filas[1]).toHaveTextContent(`Desactivó «${TRAMITE}»`)
    expect(filas[2]).toHaveTextContent(/Cambió el plazo de .*: 12 → 10 días hábiles/)
    expect(screen.getByText(/Mostrando 1 a 20 de 23 cambios · Página 1 de 2/)).toBeInTheDocument()
    expect(screen.getByText(/Este registro no se puede modificar ni borrar/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Siguiente/ }))
    expect(await screen.findByText(/Mostrando 21 a 23 de 23 cambios · Página 2 de 2/)).toBeInTheDocument()
    const ultimas = screen.getAllByRole('row').slice(1)
    expect(ultimas).toHaveLength(3)
    expect(ultimas[2]).toHaveTextContent(`Creó «${TRAMITE}»: 10 días hábiles, para ciudadanía, 2 campos.`)
  })

  it('no tiene problemas de accesibilidad', async () => {
    const { user, container } = await abrir()
    await user.click(screen.getByRole('tab', { name: 'Historial de cambios' }))
    await screen.findByRole('table', { name: 'Cambios del catálogo' })
    expect(await axe(container, AXE)).toHaveNoViolations()
  })
})

describe('las reglas del editor', () => {
  it('el id se genera de la etiqueta: sin tildes, en minúsculas, con guion bajo, empezando con letra y sin repetirse', () => {
    expect(idDesde('Número de finca')).toBe('numero_de_finca')
    expect(idDesde('  Área de la obra (m²)  ')).toBe('area_de_la_obra_m')
    expect(idDesde('2.º trámite')).toBe('campo_2_tramite')
    expect(idDesde('')).toBe('campo')
    expect(idDesde('???')).toBe('campo')
    expect(idDesde('x'.repeat(60))).toHaveLength(40)
    expect(idDesde('Asunto', ['asunto'])).toBe('asunto_2')
    expect(idDesde('Asunto', ['asunto', 'asunto_2'])).toBe('asunto_3')
    expect(idDesde('a'.repeat(40), ['a'.repeat(40)])).toHaveLength(40)
    expect(idDesde('a'.repeat(40), ['a'.repeat(40)])).toMatch(/_2$/)
  })

  it('un campo se arma como lo espera la API: solo lo que aplica a su tipo', () => {
    const base = { ...campoVacio(), etiqueta: ' Asunto ', id: 'asunto', max: '150', ayuda: ' Resumen ', opciones: 'x', entero: true }
    expect(campoAServidor(base)).toEqual({ id: 'asunto', etiqueta: 'Asunto', tipo: 'texto', obligatorio: false, max: 150, ayuda: 'Resumen' })
    expect(campoAServidor({ ...base, tipo: 'fecha' })).toEqual({ id: 'asunto', etiqueta: 'Asunto', tipo: 'fecha', obligatorio: false, ayuda: 'Resumen' })
    expect(campoAServidor({ ...base, tipo: 'seleccion', opciones: ' Uno \n\nDos\n' })).toMatchObject({ opciones: ['Uno', 'Dos'] })
    expect(campoAServidor({ ...base, tipo: 'numero', max: '10.5' })).toMatchObject({ max: 10.5, entero: true })
    expect(campoAServidor({ ...base, ayuda: '  ' })).not.toHaveProperty('ayuda')
  })

  it('del servidor al editor y de vuelta no cambia nada', () => {
    const formulario = [
      { id: 'a', etiqueta: 'A', tipo: 'texto', obligatorio: true, max: 100, ayuda: 'Uno' },
      { id: 'b', etiqueta: 'B', tipo: 'seleccion', obligatorio: false, opciones: ['x', 'y'] },
      { id: 'c', etiqueta: 'C', tipo: 'numero', obligatorio: false, max: 5, entero: true },
    ]
    const tipo = { nombre: 'Tipo', sla_dias: 7, audiencia: 'ambas', formulario }
    expect(cuerpoDe(borradorDesde(tipo))).toEqual({ nombre: 'Tipo', sla_dias: 7, audiencia: 'ambas', formulario })
    expect(validarBorrador(borradorDesde(tipo))).toEqual({})
  })

  it('valida lo evidente con las mismas claves de error que usa el servidor', () => {
    expect(Object.keys(validarBorrador(borradorVacio()))).toEqual(['nombre'])
    const b = { nombre: 'ab', sla_dias: '0', audiencia: 'ambas', campos: [
      { ...campoVacio(), etiqueta: '', id: 'Mal' }, { ...campoVacio(), etiqueta: 'x', id: 'dos', tipo: 'seleccion', opciones: 'a\na', max: '' },
      { ...campoVacio(), etiqueta: 'y', id: 'dos', max: 'abc' },
    ] }
    expect(Object.keys(validarBorrador(b)).sort()).toEqual([
      'formulario.0.etiqueta', 'formulario.0.id', 'formulario.1.opciones', 'formulario.2.id', 'formulario.2.max', 'nombre', 'sla_dias',
    ])
    expect(validarBorrador({ ...borradorVacio(), nombre: 'abc', campos: Array.from({ length: 31 }, (_, i) => ({ ...campoVacio(), etiqueta: `c${i}`, id: `c${i}` })) })).toHaveProperty('formulario')
  })

  it('la vista previa no se rompe con campos a medio escribir (sin id, repetidos o sin etiqueta)', () => {
    const vista = camposDeVista([{ ...campoVacio(), id: '' }, { ...campoVacio(), id: '' }, { ...campoVacio(), tipo: 'seleccion', opciones: 'a\nb', max: '' }])
    expect(new Set(vista.map((c) => c.id)).size).toBe(3)
    expect(vista[0].etiqueta).toBe('(sin etiqueta)')
    expect(vista[2].opciones).toEqual(['a', 'b'])
  })

  it('los errores del servidor se muestran con un encabezado legible', () => {
    expect(encabezadoDeError('formulario.2.max')).toBe('Campo 3 · máximo')
    expect(encabezadoDeError('formulario.0')).toBe('Campo 1')
    expect(encabezadoDeError('sla_dias')).toBe('Plazo')
    expect(encabezadoDeError('datos')).toBe('')
    expect(resumenDeErrores({ nombre: 'Mal.', datos: 'Otro.' })).toEqual(['Nombre: Mal.', 'Otro.'])
  })

  it('el historial describe cada tipo de cambio en lenguaje llano', () => {
    const c = (accion, antes, despues) => ({ accion, antes, despues, tipo_tramite: { id: 1, nombre: 'T' } })
    expect(describirCambio(c('alta', null, { nombre: 'T', sla_dias: 5, audiencia: 'ambas', formulario: [{}] }))).toEqual(['Creó «T»: 5 días hábiles, para ciudadanía y otras instituciones, 1 campo.'])
    expect(describirCambio(c('cambio', { nombre: 'A' }, { nombre: 'B' }))).toEqual(['Cambió el nombre: «A» → «B».'])
    expect(describirCambio(c('cambio', { audiencia: 'ciudadania' }, { audiencia: 'institucion' }))).toEqual(['Cambió para quién es «T»: Ciudadanía → Otras instituciones.'])
    expect(describirCambio(c('cambio', { formulario: [] }, { formulario: [{}, {}] }))).toEqual(['Cambió el formulario de «T»: 0 campos → 2 campos.'])
    expect(describirCambio(c('desactivado', { activo: true }, { activo: false }))[0]).toMatch(/^Desactivó «T»/)
    expect(describirCambio(c('cambio', {}, {}))).toEqual(['Cambió «T».'])
  })
})
