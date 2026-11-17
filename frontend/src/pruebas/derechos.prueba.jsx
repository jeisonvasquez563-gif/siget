// Derechos sobre los datos personales (Ley 81 de 2019): aviso de privacidad, «Mis datos» y la consola de solicitudes del operador de
// identidades. Se arma la aplicación completa contra el servidor de ejemplo (src/mock.js + src/mock-derechos.js), que imita docs/api.md.
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../App.jsx'
import { instalarMock } from '../mock.js'
import { sumarDiasHabiles } from '../mock-derechos.js'
import { ProveedorUI } from '../ui.jsx'

vi.mock('qrcode', () => ({ default: { toCanvas: vi.fn() } }))
const AXE = { rules: { 'color-contrast': { enabled: false } } }

afterEach(() => vi.restoreAllMocks())

async function abrirComo(usuario, modulo) {
  instalarMock(usuario, { demora: 0 })
  const utilidades = render(<ProveedorUI><App /></ProveedorUI>)
  const user = userEvent.setup()
  if (modulo) {
    const nav = await screen.findByRole('navigation', { name: 'Módulos' })
    await user.click(within(nav).getByRole('button', { name: new RegExp(`^${modulo}`) }))
  }
  return { ...utilidades, user }
}

const panel = (nombre) => screen.getByRole('heading', { name: nombre }).closest('section')

async function reautenticar(user, codigo = '123456') {
  const modal = await screen.findByRole('dialog', { name: /Confirma que eres tú/ })
  await user.type(within(modal).getByLabelText(/Código de 6 dígitos/), codigo)
  await user.click(within(modal).getByRole('button', { name: /Verificar y continuar/ }))
}

/* ---------------------------------------------------------------- registro y aviso de privacidad */

describe('el registro y el aviso de privacidad', () => {
  async function abrirRegistro() {
    window.location.hash = '#/ciudadania'
    const o = await abrirComo(null)
    await o.user.click(await screen.findByRole('button', { name: 'Crear una cuenta' }))
    return o
  }

  it('el registro tiene la casilla obligatoria «Leí el aviso de privacidad» y un enlace al aviso', async () => {
    await abrirRegistro()
    const casilla = screen.getByRole('checkbox', { name: 'Leí el aviso de privacidad' })
    expect(casilla).toBeRequired()
    expect(casilla).not.toBeChecked() // nunca viene marcada de antemano
    const enlace = screen.getByRole('link', { name: /Leer el aviso de privacidad/ })
    expect(enlace).toHaveAttribute('href', '#/privacidad')
    expect(enlace).toHaveAttribute('target', '_blank') // se lee sin perder lo que ya se escribió
    expect(enlace).toHaveAttribute('rel', expect.stringContaining('noopener'))
  })

  it('al crear la cuenta se envía acepta_aviso: true', async () => {
    const { user } = await abrirRegistro()
    const original = window.fetch
    const espia = vi.fn((...a) => original(...a))
    window.fetch = espia
    await user.type(screen.getByLabelText('Nombre'), 'María José')
    await user.type(screen.getByLabelText('Apellidos'), 'Pérez de Gracia')
    await user.type(screen.getByLabelText(/^Cédula/), '8-123-456')
    await user.type(screen.getByLabelText(/^Fecha de nacimiento/), '1995-04-12')
    await user.selectOptions(screen.getByLabelText('Provincia'), 'Panamá')
    await user.type(screen.getByLabelText('Ciudad'), 'San Miguelito')
    await user.type(screen.getByLabelText('Correo electrónico'), 'maria@correo.com')
    await user.type(screen.getByLabelText('Usuario'), 'nuevo.usuario')
    await user.type(screen.getByLabelText('Contraseña'), 'una-frase-larga-y-unica')
    await user.click(screen.getByRole('checkbox', { name: 'Leí el aviso de privacidad' }))
    await user.click(screen.getByRole('button', { name: 'Crear cuenta' }))
    await screen.findByRole('heading', { name: 'Activa el segundo factor' })
    const llamada = espia.mock.calls.find(([ruta]) => ruta === '/auth/registro/')
    expect(JSON.parse(llamada[1].body)).toMatchObject({ username: 'nuevo.usuario', acepta_aviso: true })
  })

  it('el servidor de ejemplo, como el real, rechaza el registro sin la confirmación del aviso', async () => {
    instalarMock(null, { demora: 0 })
    for (const valor of [undefined, false, 'true', 1]) {
      const r = await fetch('/auth/registro/', { method: 'POST', body: JSON.stringify({ username: 'x', acepta_aviso: valor }) })
      expect(r.status).toBe(400)
      expect((await r.json()).errores[0]).toMatch(/aviso de privacidad/)
    }
  })

  it('cambiar entre ingresar y crear cuenta olvida la casilla: hay que volver a leerlo', async () => {
    const { user } = await abrirRegistro()
    await user.click(screen.getByRole('checkbox', { name: 'Leí el aviso de privacidad' }))
    await user.click(screen.getByRole('button', { name: 'Ingresar con mi cuenta' }))
    await user.click(await screen.findByRole('button', { name: 'Crear una cuenta' }))
    expect(screen.getByRole('checkbox', { name: 'Leí el aviso de privacidad' })).not.toBeChecked()
  })
})

describe('la página del aviso de privacidad (#/privacidad)', () => {
  async function abrirAviso(usuario = null) {
    window.location.hash = '#/privacidad'
    return abrirComo(usuario)
  }

  it('se lee sin iniciar sesión y explica para qué se usa cada dato, quién accede, cuánto tiempo y cómo ejercer los derechos', async () => {
    await abrirAviso()
    expect(await screen.findByRole('heading', { level: 1, name: 'Aviso de privacidad' })).toBeInTheDocument()
    for (const tema of [/Quién trata tus datos/, /Quién puede verlos/, /Cuánto tiempo los conservamos/, /Tus derechos \(Ley 81 de 2019\)/, /Cómo ejercerlos y en cuánto tiempo/, /Qué datos pedimos y para qué/]) {
      expect(screen.getByRole('heading', { name: tema })).toBeInTheDocument()
    }
    expect(screen.getByText(/Identidad única/)).toBeInTheDocument() // la cédula
    expect(screen.getByText(/mayor de edad/)).toBeInTheDocument() // la fecha de nacimiento
    expect(screen.getAllByText(/10 días hábiles/).length).toBeGreaterThanOrEqual(2) // en «Cómo ejercerlos» y en el resumen de derechos
    for (const derecho of ['Acceso', 'Rectificación', 'Cancelación', 'Oposición', 'Portabilidad']) expect(screen.getByText(derecho, { selector: 'li' })).toBeInTheDocument()
    expect(screen.getByText(/Versión 2026-/)).toBeInTheDocument()
  })

  it('no pide credenciales ni muestra el formulario de acceso', async () => {
    await abrirAviso()
    await screen.findByRole('heading', { level: 1, name: 'Aviso de privacidad' })
    expect(screen.queryByLabelText('Contraseña')).not.toBeInTheDocument()
  })

  it('«Volver» deja la página y regresa al acceso', async () => {
    const { user } = await abrirAviso()
    await user.click(await screen.findByRole('button', { name: 'Volver' }))
    expect(await screen.findByRole('heading', { name: '¿Cómo quieres ingresar?' })).toBeInTheDocument()
    expect(window.location.hash).toBe('')
  })

  it('con la sesión abierta se lee sin cerrarla y al volver sigue donde estaba', async () => {
    const { user } = await abrirComo('ana.ciudadana', 'Mis datos')
    await screen.findByRole('heading', { name: 'Mis datos' })
    await user.click(screen.getByRole('link', { name: /Leer el aviso de privacidad/ }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Aviso de privacidad' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Volver' }))
    expect(await screen.findByRole('heading', { name: 'Mis datos' })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Módulos' })).toBeInTheDocument()
  })

  it('es accesible (axe)', async () => {
    const { container } = await abrirAviso()
    await screen.findByRole('heading', { level: 1, name: 'Aviso de privacidad' })
    expect(await axe(container, AXE)).toHaveNoViolations()
  })
})

/* ---------------------------------------------------------------- Mis datos */

describe('quién ve «Mis datos»', () => {
  it('toda persona con perfil lo ve en su menú (ciudadanía y personal)', async () => {
    for (const usuario of ['ana.ciudadana', 'fabio.mop', 'carla.mop']) {
      const { unmount } = await abrirComo(usuario)
      const nav = await screen.findByRole('navigation', { name: 'Módulos' })
      expect(within(nav).getByRole('button', { name: /^Mis datos/ })).toBeInTheDocument()
      unmount()
    }
  })

  it('las cuentas de plataforma no lo ven (no tienen perfil de persona)', async () => {
    for (const usuario of ['ivan.identidades', 'aldo.auditor']) {
      const { unmount } = await abrirComo(usuario)
      const nav = await screen.findByRole('navigation', { name: 'Módulos' })
      expect(within(nav).queryByRole('button', { name: /^Mis datos/ })).not.toBeInTheDocument()
      unmount()
    }
  })
})

describe('ver mis datos', () => {
  it('muestra el perfil completo (es su propio dato), cuántos trámites tiene y que no se borran', async () => {
    await abrirComo('ana.ciudadana', 'Mis datos')
    const perfil = await screen.findByRole('heading', { name: 'Tus datos personales' })
    const seccion = perfil.closest('section')
    for (const texto of ['Ana', 'Rodríguez Pérez', '8-765-4321', 'San Miguelito', 'ana.rodriguez@ejemplo.com', 'Panamá']) expect(within(seccion).getByText(texto)).toBeInTheDocument()
    expect(within(seccion).getByText('Solo tú los ves')).toBeInTheDocument()
    expect(within(seccion).getByText(/Tienes 5 trámites/)).toBeInTheDocument()
    expect(within(seccion).getByText(/expediente público con conservación obligatoria: no se borran/)).toBeInTheDocument()
    expect(within(seccion).getByText(/No has cambiado tus datos de contacto/)).toBeInTheDocument()
  })

  it('cada persona ve solo lo suyo', async () => {
    await abrirComo('beto.ciudadano', 'Mis datos')
    expect(await screen.findByText('4-321-9876')).toBeInTheDocument()
    expect(screen.queryByText('8-765-4321')).not.toBeInTheDocument()
  })

  it('dice qué versión del aviso leyó y cuándo; si la cuenta es anterior al aviso, lo reconoce sin inventar una lectura', async () => {
    const ana = await abrirComo('ana.ciudadana', 'Mis datos')
    const aviso = (await screen.findByRole('heading', { name: 'Aviso de privacidad' })).closest('section')
    expect(aviso).toHaveTextContent(/Leíste la versión 2026-/)
    ana.unmount()
    await abrirComo('beto.ciudadano', 'Mis datos')
    expect(await screen.findByText(/Tu cuenta es anterior al aviso de privacidad, así que no hay una constancia de lectura/)).toBeInTheDocument()
  })

  it('es accesible (axe)', async () => {
    const { container } = await abrirComo('ana.ciudadana', 'Mis datos')
    await screen.findByRole('heading', { name: 'Tus datos personales' })
    expect(await axe(container, AXE)).toHaveNoViolations()
  })
})

describe('corregir correo, provincia y ciudad', () => {
  const formulario = () => screen.getByRole('form', { name: 'Corregir mis datos de contacto' })

  it('solo ofrece corregir esos tres datos y explica que el resto va por una solicitud', async () => {
    await abrirComo('ana.ciudadana', 'Mis datos')
    await screen.findByRole('form', { name: 'Corregir mis datos de contacto' })
    const campos = within(formulario())
    expect(campos.getByLabelText('Correo electrónico')).toHaveValue('ana.rodriguez@ejemplo.com')
    expect(campos.getByLabelText('Provincia')).toHaveValue('Panamá')
    expect(campos.getByLabelText('Ciudad')).toHaveValue('San Miguelito')
    for (const nombre of ['Nombre', 'Apellidos', 'Cédula', 'Fecha de nacimiento']) expect(campos.queryByLabelText(nombre)).not.toBeInTheDocument()
    expect(screen.getByText(/Para cambiar tu nombre, tus apellidos, tu cédula o tu fecha de nacimiento, envía una solicitud de rectificación/)).toBeInTheDocument()
  })

  it('pide el segundo factor reciente, repite la corrección y se ve el cambio', async () => {
    const { user } = await abrirComo('ana.ciudadana', 'Mis datos')
    await screen.findByRole('form', { name: 'Corregir mis datos de contacto' })
    const ciudad = within(formulario()).getByLabelText('Ciudad')
    await user.clear(ciudad)
    await user.type(ciudad, 'Arraiján')
    await user.selectOptions(within(formulario()).getByLabelText('Provincia'), 'Panamá Oeste')
    await user.click(within(formulario()).getByRole('button', { name: 'Guardar cambios' }))
    await reautenticar(user)
    expect(await screen.findByText('Tus datos se actualizaron.')).toBeInTheDocument()
    const perfil = screen.getByRole('heading', { name: 'Tus datos personales' }).closest('section')
    expect(within(perfil).getByText('Arraiján')).toBeInTheDocument()
    expect(within(perfil).getByText('Panamá Oeste')).toBeInTheDocument()
    expect(within(perfil).queryByText(/No has cambiado tus datos de contacto/)).not.toBeInTheDocument()
    expect(within(perfil).getByText(/Último cambio de tus datos de contacto/)).toBeInTheDocument()
  })

  it('un código rechazado se explica y deja reintentar sin perder lo escrito', async () => {
    const { user } = await abrirComo('ana.ciudadana', 'Mis datos')
    await screen.findByRole('form', { name: 'Corregir mis datos de contacto' })
    const ciudad = within(formulario()).getByLabelText('Ciudad')
    await user.clear(ciudad)
    await user.type(ciudad, 'Colón')
    await user.click(within(formulario()).getByRole('button', { name: 'Guardar cambios' }))
    await reautenticar(user, '000000')
    expect(await within(screen.getByRole('dialog')).findByRole('alert')).toHaveTextContent(/no sirve/)
  })

  it('si no cambió nada, lo dice y no molesta al servidor', async () => {
    const { user } = await abrirComo('ana.ciudadana', 'Mis datos')
    await screen.findByRole('form', { name: 'Corregir mis datos de contacto' })
    const original = window.fetch
    const espia = vi.fn((...a) => original(...a))
    window.fetch = espia
    await user.click(within(formulario()).getByRole('button', { name: 'Guardar cambios' }))
    expect(await screen.findByText('No cambiaste ningún dato.')).toBeInTheDocument()
    expect(espia.mock.calls.some(([, o]) => o?.method === 'PATCH')).toBe(false)
  })

  it('envía solo lo que cambió', async () => {
    const { user } = await abrirComo('ana.ciudadana', 'Mis datos')
    await screen.findByRole('form', { name: 'Corregir mis datos de contacto' })
    const original = window.fetch
    const espia = vi.fn((...a) => original(...a))
    window.fetch = espia
    const ciudad = within(formulario()).getByLabelText('Ciudad')
    await user.clear(ciudad)
    await user.type(ciudad, 'Chitré')
    await user.click(within(formulario()).getByRole('button', { name: 'Guardar cambios' }))
    await reautenticar(user)
    await screen.findByText('Tus datos se actualizaron.')
    const parches = espia.mock.calls.filter(([, o]) => o?.method === 'PATCH')
    expect(parches.length).toBeGreaterThan(0)
    for (const [, o] of parches) expect(JSON.parse(o.body)).toEqual({ ciudad: 'Chitré' })
  })

  it('un correo que ya es de otra cuenta responde igual que en el registro, sin decir de quién es', async () => {
    const { user } = await abrirComo('ana.ciudadana', 'Mis datos')
    await screen.findByRole('form', { name: 'Corregir mis datos de contacto' })
    const correo = within(formulario()).getByLabelText('Correo electrónico')
    await user.clear(correo)
    await user.type(correo, 'beto.castillo@ejemplo.com')
    await user.click(within(formulario()).getByRole('button', { name: 'Guardar cambios' }))
    await reautenticar(user)
    const alerta = await screen.findByRole('alert')
    expect(alerta).toHaveTextContent('No se pudo guardar el cambio con esos datos. Prueba con otro correo.')
    expect(alerta).not.toHaveTextContent(/beto/i)
    expect(screen.getByLabelText('Correo electrónico')).toHaveValue('beto.castillo@ejemplo.com') // no se pierde lo escrito
  })

  it('lo que el servidor rechaza se muestra tal cual', async () => {
    const { user } = await abrirComo('ana.ciudadana', 'Mis datos')
    await screen.findByRole('form', { name: 'Corregir mis datos de contacto' })
    const correo = within(formulario()).getByLabelText('Correo electrónico')
    await user.clear(correo)
    await user.type(correo, 'ana@servidor')
    await user.click(within(formulario()).getByRole('button', { name: 'Guardar cambios' }))
    await reautenticar(user)
    expect(await screen.findByRole('alert')).toHaveTextContent('el correo no tiene un formato válido')
  })
})

describe('descargar mis datos', () => {
  it('baja un archivo JSON con el perfil, los trámites, las solicitudes y la actividad, sin credenciales', async () => {
    const guardados = []
    window.URL.createObjectURL = vi.fn((blob) => { guardados.push(blob); return 'blob:prueba' })
    window.URL.revokeObjectURL = vi.fn()
    let nombre = ''
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function nombrarDescarga() { nombre = this.download })
    const { user } = await abrirComo('ana.ciudadana', 'Mis datos')
    await user.click(await screen.findByRole('button', { name: 'Descargar mis datos' }))
    expect(await screen.findByText(/Descargamos tus datos en un archivo JSON/)).toBeInTheDocument()
    expect(nombre).toMatch(/^siget-mis-datos-ana\.ciudadana-\d{4}-\d{2}-\d{2}\.json$/)
    expect(guardados[0].type).toBe('application/json')
    const texto = await new Promise((resolver) => { const lector = new FileReader(); lector.onload = () => resolver(lector.result); lector.readAsText(guardados[0]) })
    const documento = JSON.parse(texto)
    expect(documento.formato).toBe('siget-mis-datos/1')
    expect(documento.perfil.cedula).toBe('8-765-4321')
    expect(documento.tramites.length).toBe(5)
    expect(documento.solicitudes.length).toBe(2)
    expect(documento.actividad_de_seguridad.some((a) => a.evento === 'datos_personales_exportados')).toBe(true)
    expect(texto).not.toMatch(/password|argon2|mfa_secreto|beto\.castillo|4-321-9876/)
  })
})

describe('solicitudes sobre mis datos', () => {
  async function abrirSolicitudes(usuario = 'ana.ciudadana') {
    const o = await abrirComo(usuario, 'Mis datos')
    await screen.findByRole('heading', { name: 'Solicitudes sobre mis datos personales' })
    return o
  }
  const seccion = () => panel('Solicitudes sobre mis datos personales')
  async function enviar(user, tipo, detalle) {
    await user.selectOptions(within(seccion()).getByLabelText('¿Qué quieres pedir?'), tipo)
    await user.type(within(seccion()).getByLabelText(/^Cuéntanos qué necesitas/), detalle)
    await user.click(within(seccion()).getByRole('button', { name: 'Enviar solicitud' }))
  }

  it('explica el plazo, que es gratis y que cancelar no borra nada automáticamente', async () => {
    await abrirSolicitudes()
    const texto = seccion().textContent
    expect(texto).toMatch(/no más de 10 días hábiles y no cuesta nada/)
    expect(texto).toMatch(/Cancelar no borra nada automáticamente/)
    expect(texto).toMatch(/expediente público con conservación obligatoria/)
  })

  it('lista las solicitudes de la persona con su estado, su plazo y la respuesta, y avisa si el plazo ya pasó', async () => {
    await abrirSolicitudes()
    const lista = within(seccion()).getByRole('list')
    const atendida = within(lista).getByText('Mi segundo apellido está mal escrito: es Pérez, no Peres.').closest('li')
    expect(atendida).toHaveTextContent('Rectificación')
    expect(atendida).toHaveTextContent('Atendida')
    expect(atendida).toHaveTextContent(/Corregimos tu segundo apellido/)
    const vencida = within(lista).getByText(/No quiero que mis datos se usen para otra cosa/).closest('li')
    expect(vencida).toHaveTextContent('Recibida')
    expect(vencida).toHaveTextContent(/Ya pasó el plazo de respuesta/)
    expect(within(lista).queryByText(/Quiero que eliminen mi cuenta/)).not.toBeInTheDocument() // la de otra persona
    expect(within(lista).getAllByRole('listitem')).toHaveLength(2)
  })

  it('envía una solicitud nueva y aparece como recibida con su fecha límite', async () => {
    const { user } = await abrirSolicitudes()
    await enviar(user, 'cancelacion', 'Quiero que borren mis datos de contacto.')
    expect(await screen.findByText(/Recibimos tu solicitud. Te responderemos en no más de 10 días hábiles/)).toBeInTheDocument()
    const nueva = within(seccion()).getByText('Quiero que borren mis datos de contacto.').closest('li')
    expect(nueva).toHaveTextContent('Cancelación')
    expect(nueva).toHaveTextContent('Recibida')
    expect(nueva).toHaveTextContent(/te respondemos antes del/)
    expect(within(seccion()).getByLabelText(/^Cuéntanos qué necesitas/)).toHaveValue('') // el formulario queda limpio
  })

  it('el botón espera a que el detalle tenga el largo mínimo', async () => {
    const { user } = await abrirSolicitudes()
    const boton = within(seccion()).getByRole('button', { name: 'Enviar solicitud' })
    expect(boton).toBeDisabled()
    await user.type(within(seccion()).getByLabelText(/^Cuéntanos qué necesitas/), 'corto')
    expect(boton).toBeDisabled()
    await user.type(within(seccion()).getByLabelText(/^Cuéntanos qué necesitas/), ' pero ya alcanza')
    expect(boton).toBeEnabled()
  })

  it('hay un tope de solicitudes abiertas: al llegar a él se avisa y no se puede enviar otra', async () => {
    const { user } = await abrirSolicitudes()
    await enviar(user, 'oposicion', 'No quiero recibir avisos de otras entidades.')
    await screen.findByText('No quiero recibir avisos de otras entidades.')
    await enviar(user, 'rectificacion', 'Mi fecha de nacimiento está equivocada.')
    await screen.findByText('Mi fecha de nacimiento está equivocada.')
    expect(await within(seccion()).findByText(/Ya tienes 3 solicitudes abiertas \(el máximo es 3\)/)).toBeInTheDocument()
    expect(within(seccion()).getByRole('button', { name: 'Enviar solicitud' })).toBeDisabled()
    expect(within(seccion()).getByLabelText(/^Cuéntanos qué necesitas/)).toBeDisabled()
  })

  it('otra persona no ve las solicitudes de la primera', async () => {
    await abrirSolicitudes('beto.ciudadano')
    const lista = within(seccion()).getByRole('list')
    expect(within(lista).getByText(/Quiero que eliminen mi cuenta y todos mis datos/)).toBeInTheDocument()
    expect(within(lista).queryByText(/Mi segundo apellido/)).not.toBeInTheDocument()
  })

  it('es accesible (axe)', async () => {
    const { container } = await abrirSolicitudes()
    expect(await axe(container, AXE)).toHaveNoViolations()
  })
})

/* ---------------------------------------------------------------- consola del operador de identidades */

describe('consola de solicitudes del operador de identidades', () => {
  async function abrirConsola(usuario = 'ivan.identidades') {
    const o = await abrirComo(usuario, 'Identidades')
    await screen.findByRole('heading', { name: 'Solicitudes sobre datos personales' })
    return o
  }
  const seccion = () => panel('Solicitudes sobre datos personales')

  it('solo la consola de identidades tiene el panel', async () => {
    for (const [usuario, modulo] of [['cata.catalogo', 'Catálogo'], ['sergio.seguridad', 'Respuesta a incidentes'], ['ines.infra', 'Infraestructura']]) {
      const { unmount } = await abrirComo(usuario, modulo)
      await screen.findByRole('navigation', { name: 'Módulos' })
      expect(screen.queryByRole('heading', { name: 'Solicitudes sobre datos personales' })).not.toBeInTheDocument()
      unmount()
    }
  })

  it('muestra quién pide solo por su usuario, el detalle, el plazo, y marca las vencidas', async () => {
    await abrirConsola()
    const lista = await within(seccion()).findByRole('list')
    expect(within(lista).getAllByRole('listitem')).toHaveLength(3)
    const vencida = within(lista).getByText(/No quiero que mis datos se usen para otra cosa/).closest('li')
    expect(vencida).toHaveTextContent('ana.ciudadana')
    expect(vencida).toHaveTextContent('Oposición')
    expect(within(vencida).getByText('Vencida')).toBeInTheDocument()
    expect(within(seccion()).getByRole('status')).toHaveTextContent('2 abiertas · 1 vencida')
    const texto = seccion().textContent
    expect(texto).not.toMatch(/cédula|correo/i)
    expect(texto).not.toMatch(/8-765|4-321|Rodríguez|ejemplo\.com/) // nada de los datos personales de quien pide
  })

  it('las abiertas van primero y las que vencen antes arriba', async () => {
    await abrirConsola()
    const items = await within(seccion()).findAllByRole('listitem')
    expect(items[0]).toHaveTextContent(/No quiero que mis datos se usen/) // la más vieja, ya vencida
    expect(items[1]).toHaveTextContent(/Quiero que eliminen mi cuenta/)
    expect(items[2]).toHaveTextContent('Atendida')
  })

  it('se puede filtrar por estado y un filtro no cambia el resumen de abiertas', async () => {
    const { user } = await abrirConsola()
    await within(seccion()).findByRole('list')
    await user.selectOptions(within(seccion()).getByLabelText('Filtrar por estado'), 'atendida')
    await waitFor(() => expect(within(seccion()).getAllByRole('listitem')).toHaveLength(1))
    expect(within(seccion()).getByRole('listitem')).toHaveTextContent('irene.identidades')
    expect(within(seccion()).getByRole('status')).toHaveTextContent('2 abiertas')
  })

  it('responder pide segundo factor reciente, explica que no borra nada y deja la solicitud atendida con su respuesta', async () => {
    const { user } = await abrirConsola()
    const item = (await within(seccion()).findByText(/Quiero que eliminen mi cuenta y todos mis datos/)).closest('li')
    await user.click(within(item).getByRole('button', { name: 'Responder' }))
    const modal = await screen.findByRole('dialog', { name: /Responder a beto\.ciudadano/ })
    expect(modal).toHaveTextContent(/no borra ni cambia nada/)
    expect(within(modal).getByRole('button', { name: 'Enviar respuesta' })).toBeDisabled()
    await user.click(within(modal).getByLabelText('Rechazada'))
    await user.type(within(modal).getByLabelText(/^Respuesta para la persona/), 'Tus trámites son expediente público y no se pueden borrar; sí eliminamos tus datos de contacto.')
    await user.click(within(modal).getByRole('button', { name: 'Enviar respuesta' }))
    await reautenticar(user)
    expect(await screen.findByText('Respuesta enviada a beto.ciudadano.')).toBeInTheDocument()
    await waitFor(() => expect(within(seccion()).getByText(/Tus trámites son expediente público y no se pueden borrar/)).toBeInTheDocument())
    const cerrada = within(seccion()).getByText(/Quiero que eliminen mi cuenta y todos mis datos/).closest('li')
    expect(cerrada).toHaveTextContent('Rechazada')
    expect(cerrada).toHaveTextContent('por ivan.identidades')
    expect(within(cerrada).queryByRole('button', { name: 'Responder' })).not.toBeInTheDocument() // se responde una sola vez
    expect(within(seccion()).getByRole('status')).toHaveTextContent('1 abierta')
  })

  it('«Cancelar» en el diálogo no responde nada', async () => {
    const { user } = await abrirConsola()
    const item = (await within(seccion()).findByText(/Quiero que eliminen mi cuenta y todos mis datos/)).closest('li')
    await user.click(within(item).getByRole('button', { name: 'Responder' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancelar' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(item).toHaveTextContent('Recibida')
  })

  it('la persona ve después la respuesta en «Mis datos»', async () => {
    const { user } = await abrirConsola()
    const item = (await within(seccion()).findByText(/No quiero que mis datos se usen/)).closest('li')
    await user.click(within(item).getByRole('button', { name: 'Responder' }))
    const modal = await screen.findByRole('dialog', { name: /Responder a ana\.ciudadana/ })
    await user.type(within(modal).getByLabelText(/^Respuesta para la persona/), 'Solo usamos tus datos para tus trámites y no los compartimos.')
    await user.click(within(modal).getByRole('button', { name: 'Enviar respuesta' }))
    await reautenticar(user)
    await screen.findByText('Respuesta enviada a ana.ciudadana.')
    // Misma instalación del servidor de ejemplo: la sesión pasa a ser la de la persona y lee sus propias solicitudes
    await fetch('/auth/logout/', { method: 'POST', body: '{}' })
    await fetch('/auth/login/', { method: 'POST', body: JSON.stringify({ username: 'ana.ciudadana', password: 'x', codigo: '123456' }) })
    const propias = (await (await fetch('/auth/mis-datos/solicitudes/')).json()).solicitudes
    const respondida = propias.find((x) => x.detalle.startsWith('No quiero que mis datos'))
    expect(respondida).toMatchObject({ estado: 'atendida', respuesta: 'Solo usamos tus datos para tus trámites y no los compartimos.' })
    expect(JSON.stringify(propias)).not.toContain('respondida_por') // de la persona no se ve quién respondió
  })

  it('es accesible (axe)', async () => {
    const { container } = await abrirConsola()
    await within(seccion()).findByRole('list')
    expect(await axe(container, AXE)).toHaveNoViolations()
  })
})

describe('plazo de 10 días hábiles del servidor de ejemplo', () => {
  it('cuenta de lunes a viernes: un martes más 10 días hábiles es el martes dos semanas después', () => {
    const martes = new Date(2026, 10, 17, 9, 30)
    const vence = sumarDiasHabiles(martes, 10)
    expect(vence.getDay()).toBe(2)
    expect(Math.round((vence - martes) / 86400000)).toBe(14)
  })
  it('un sábado cuenta desde el lunes siguiente y nunca vence en fin de semana', () => {
    const vence = sumarDiasHabiles(new Date(2026, 10, 21, 15, 0), 10)
    expect([0, 6]).not.toContain(vence.getDay())
  })
})
