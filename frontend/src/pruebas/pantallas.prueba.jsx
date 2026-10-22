// Pruebas de integración de la interfaz: se arma la aplicación completa contra el servidor de ejemplo (src/mock.js),
// que imita el contrato de docs/api.md. Lo que se prueba es qué ve y qué puede hacer cada rol en pantalla.
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'
import { describe, expect, it, vi } from 'vitest'
import App from '../App.jsx'
import { instalarMock } from '../mock.js'
import { ProveedorUI } from '../ui.jsx'

vi.mock('qrcode', () => ({ default: { toCanvas: vi.fn() } }))

const AXE = { rules: { 'color-contrast': { enabled: false } } } // jsdom no calcula colores: el contraste se revisa en el navegador

async function abrirComo(usuario) {
  instalarMock(usuario, { demora: 0 })
  const utilidades = render(<ProveedorUI><App /></ProveedorUI>)
  // «enrolar» y la ausencia de usuario muestran la pantalla de acceso, que no tiene menú
  if (usuario && usuario !== 'enrolar') await screen.findByRole('navigation', { name: 'Módulos' })
  return { ...utilidades, user: userEvent.setup() }
}

const menu = () => within(screen.getByRole('navigation', { name: 'Módulos' }))
const entradaMenu = (nombre) => menu().queryByRole('button', { name: new RegExp(`^${nombre}`) })
const irA = async (user, nombre) => user.click(entradaMenu(nombre))

describe('el menú cambia según el rol', () => {
  const casos = [
    ['ana.ciudadana', ['Mis trámites', 'Iniciar un trámite', 'Mi seguridad', 'Segundo factor', 'Roles y permisos'], ['Bandeja de la institución', 'Supervisión', 'Equipo de la institución', 'Auditoría', 'Acceso a trámites', 'Infraestructura']],
    ['fabio.mop', ['Mis trámites', 'Bandeja de la institución', 'Mi seguridad'], ['Supervisión', 'Equipo de la institución', 'Auditoría']],
    ['saul.mop', ['Bandeja de la institución', 'Supervisión', 'Equipo de la institución'], ['Auditoría', 'Acceso a trámites']],
    ['carla.mop', ['Equipo de la institución', 'Mis trámites'], ['Bandeja de la institución', 'Supervisión', 'Auditoría']],
    ['felix.minsa', ['Bandeja de la institución'], ['Supervisión', 'Equipo de la institución']],
    ['ines.infra', ['Infraestructura', 'Acceso a trámites', 'Mi seguridad'], ['Mis trámites', 'Iniciar un trámite', 'Bandeja de la institución', 'Auditoría']],
    ['ivan.identidades', ['Identidades', 'Acceso a trámites'], ['Mis trámites', 'Bandeja de la institución', 'Infraestructura']],
    ['aldo.auditor', ['Auditoría', 'Acceso a trámites', 'Mi seguridad'], ['Mis trámites', 'Bandeja de la institución', 'Equipo de la institución']],
  ]
  for (const [usuario, ve, noVe] of casos) {
    it(`${usuario}: ve ${ve.join(', ')}`, async () => {
      await abrirComo(usuario)
      for (const m of ve) expect(entradaMenu(m), `debía ver «${m}»`).toBeInTheDocument()
      for (const m of noVe) expect(entradaMenu(m), `NO debía ver «${m}»`).not.toBeInTheDocument()
    })
  }

  it('los módulos aún sin construir se marcan como «pronto» y explican por qué', async () => {
    const { user } = await abrirComo('ines.infra')
    expect(entradaMenu('Infraestructura')).toHaveTextContent('pronto')
    await irA(user, 'Infraestructura')
    expect(await screen.findByText(/se construye en la siguiente fase/i)).toBeInTheDocument()
  })
})

describe('qué datos ve cada persona', () => {
  it('la ciudadana ve solo sus trámites y no sabe qué funcionario los atiende', async () => {
    const { user } = await abrirComo('ana.ciudadana')
    await irA(user, 'Mis trámites')
    expect(await screen.findByRole('row', { name: /Trámite 35/ })).toBeInTheDocument()
    expect(screen.getByRole('row', { name: /Trámite 36/ })).toBeInTheDocument()
    expect(screen.queryByRole('row', { name: /Trámite 37/ })).not.toBeInTheDocument() // es de otra ciudadana
    expect(screen.queryByText(/Persona #/)).not.toBeInTheDocument()
  })

  it('el funcionario ve la bandeja de su institución y nunca trámites de otra', async () => {
    const { user } = await abrirComo('fabio.mop')
    await irA(user, 'Bandeja de la institución')
    expect(await screen.findByRole('row', { name: /Trámite 42/ })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Todos' }))
    expect(screen.getByRole('row', { name: /Trámite 43/ })).toBeInTheDocument()
    expect(screen.queryByRole('row', { name: /Trámite 36/ })).not.toBeInTheDocument() // MINSA
    expect(screen.queryByRole('row', { name: /Trámite 39/ })).not.toBeInTheDocument() // Alcaldía
  })

  it('el funcionario del MINSA ve solo la bandeja del MINSA', async () => {
    const { user } = await abrirComo('felix.minsa')
    await irA(user, 'Bandeja de la institución')
    expect(await screen.findByRole('row', { name: /Trámite 36/ })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Todos' }))
    expect(screen.queryByRole('row', { name: /Trámite 42/ })).not.toBeInTheDocument()
  })

  it('la coordinadora ve al equipo pero no tiene trámites de la institución (gestionar personas no da acceso a datos)', async () => {
    const { user } = await abrirComo('carla.mop')
    await irA(user, 'Equipo de la institución')
    expect(await screen.findByText('fabio.mop')).toBeInTheDocument()
    expect(screen.getByText('saul.mop')).toBeInTheDocument()
    await irA(user, 'Mis trámites')
    expect(await screen.findByText(/Todavía no iniciaste ningún trámite/)).toBeInTheDocument()
  })

  it('el supervisor ve al equipo con nombres en la supervisión', async () => {
    const { user } = await abrirComo('saul.mop')
    await irA(user, 'Supervisión')
    await user.click(await screen.findByRole('button', { name: 'Todos' }))
    expect(await screen.findAllByText('flor.mop')).not.toHaveLength(0)
  })
})

describe('acciones sobre un trámite', () => {
  async function abrirTramite(user, numero) {
    await irA(user, 'Bandeja de la institución')
    await user.click(await screen.findByRole('row', { name: new RegExp(`Trámite ${numero}:`) }))
    await screen.findByRole('img', { name: /Recorrido del trámite/ })
  }

  it('cambiar el estado pide un código reciente del segundo factor y luego se aplica', async () => {
    const { user } = await abrirComo('fabio.mop')
    await abrirTramite(user, 42)
    await user.click(screen.getByRole('button', { name: 'Pasar a tramitación' }))

    const modal = await screen.findByRole('dialog', { name: /Confirma que eres tú/ })
    await user.type(within(modal).getByLabelText(/Código de 6 dígitos/), '123456')
    await user.click(within(modal).getByRole('button', { name: /Verificar y continuar/ }))

    expect(await screen.findByText(/El trámite pasó a «En tramitación»/)).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /En tramitación/ })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('un código rechazado se explica y deja reintentar', async () => {
    const { user } = await abrirComo('fabio.mop')
    await abrirTramite(user, 42)
    await user.click(screen.getByRole('button', { name: 'Pasar a tramitación' }))
    const modal = await screen.findByRole('dialog')
    await user.type(within(modal).getByLabelText(/Código de 6 dígitos/), '000000')
    await user.click(within(modal).getByRole('button', { name: /Verificar y continuar/ }))
    expect(await within(modal).findByRole('alert')).toHaveTextContent(/no sirve/)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('cancelar la reautenticación no cambia nada', async () => {
    const { user } = await abrirComo('fabio.mop')
    await abrirTramite(user, 42)
    await user.click(screen.getByRole('button', { name: 'Pasar a tramitación' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancelar' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('img', { name: /Recepción/ })).toBeInTheDocument()
  })

  it('los estados finales piden confirmación explícita antes de aplicarse', async () => {
    const { user } = await abrirComo('fabio.mop')
    await abrirTramite(user, 44)
    await user.click(screen.getByRole('button', { name: 'Rechazar' }))
    const pregunta = await screen.findByRole('alertdialog', { name: /Rechazar este trámite/ })
    expect(pregunta).toHaveTextContent(/estado final/)
    await user.click(within(pregunta).getByRole('button', { name: 'Cancelar' }))
    expect(screen.getByRole('img', { name: /En tramitación/ })).toBeInTheDocument() // no cambió
  })

  it('aprobar muestra el sello, avisa y deja el trámite sin más acciones', async () => {
    const { user } = await abrirComo('fabio.mop')
    await abrirTramite(user, 44)
    await user.click(screen.getByRole('button', { name: 'Aprobar' }))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Aprobar trámite' }))
    const reauth = await screen.findByRole('dialog', { name: /Confirma que eres tú/ })
    await user.type(within(reauth).getByLabelText(/Código de 6 dígitos/), '123456')
    await user.click(within(reauth).getByRole('button', { name: /Verificar y continuar/ }))
    expect(await screen.findByText(/pasó a «Aprobado»/)).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Recorrido del trámite: Aprobado' })).toBeInTheDocument()
    expect(screen.getByText(/ya tiene una resolución final/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Rechazar' })).not.toBeInTheDocument()
  })

  it('un trámite que el propio funcionario inició no se puede gestionar (conflicto de interés)', async () => {
    const { user } = await abrirComo('fabio.mop')
    await irA(user, 'Iniciar un trámite')
    await user.click(await screen.findByRole('radio', { name: /^MOP/ }))
    await user.click(await screen.findByRole('radio', { name: /Permiso de uso de vía pública/ }))
    await user.click(screen.getByRole('button', { name: 'Iniciar trámite' }))
    expect(await screen.findByText(/por conflicto de interés no puedes gestionarlo/)).toBeInTheDocument()
    // Un trámite «Pendiente» solo tiene la acción «Pasar a tramitación»: debe faltar (no vale mirar «Aprobar», que no aparece en ese estado)
    expect(screen.queryByRole('button', { name: 'Pasar a tramitación' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Acciones' })).not.toBeInTheDocument()
  })

  it('solo el supervisor ve el selector para reasignar', async () => {
    const { user, unmount } = await abrirComo('fabio.mop')
    await abrirTramite(user, 42)
    expect(screen.queryByLabelText('Reasignar a')).not.toBeInTheDocument()
    unmount()

    const otro = await abrirComo('saul.mop')
    await irA(otro.user, 'Supervisión')
    await otro.user.click(await screen.findByRole('row', { name: /Trámite 42:/ }))
    const selector = await screen.findByLabelText('Reasignar a')
    await otro.user.selectOptions(selector, 'flor.mop')
    const reauth = await screen.findByRole('dialog', { name: /Confirma que eres tú/ })
    await otro.user.type(within(reauth).getByLabelText(/Código de 6 dígitos/), '123456')
    await otro.user.click(within(reauth).getByRole('button', { name: /Verificar y continuar/ }))
    expect(await screen.findByText(/reasignado a flor.mop/)).toBeInTheDocument()
  })
})

describe('un rol de plataforma no ve trámites', () => {
  it('la prueba de acceso muestra el 403 real que devuelve el servidor', async () => {
    const { user } = await abrirComo('ines.infra')
    await irA(user, 'Acceso a trámites')
    await user.click(await screen.findByRole('button', { name: 'Intentar ver los trámites' }))
    expect(await screen.findByText('Acceso negado, como debe ser.')).toBeInTheDocument()
    expect(screen.getByText(/403 Forbidden/)).toBeInTheDocument()
    expect(screen.getByText(/acceso_denegado/)).toBeInTheDocument()
  })
})

describe('auditoría', () => {
  it('pide reautenticación y luego muestra el resumen de decisiones', async () => {
    const { user } = await abrirComo('aldo.auditor')
    await irA(user, 'Auditoría')
    const modal = await screen.findByRole('dialog', { name: /Confirma que eres tú/ })
    await user.type(within(modal).getByLabelText(/Código de 6 dígitos/), '123456')
    await user.click(within(modal).getByRole('button', { name: /Verificar y continuar/ }))
    expect(await screen.findByText('Qué políticas deciden')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /Decisiones por política/ })).toBeInTheDocument()
    expect(screen.getByText(/quién audita al auditor/i)).toBeInTheDocument()
  })
})

describe('acceso y sesión', () => {
  it('muestra el formulario cuando no hay sesión', async () => {
    await abrirComo(null)
    expect(await screen.findByRole('heading', { name: 'Ingresa a tu cuenta' })).toBeInTheDocument()
    expect(screen.getByLabelText('Usuario')).toBeInTheDocument()
  })

  it('al principio NO se pide el código: solo usuario y contraseña', async () => {
    await abrirComo(null)
    expect(await screen.findByLabelText('Usuario')).toBeInTheDocument()
    expect(screen.getByLabelText('Contraseña')).toBeInTheDocument()
    expect(screen.queryByLabelText(/Código del autenticador/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Crear una cuenta' })).toBeInTheDocument()
  })

  it('un usuario inexistente recibe un mensaje genérico (no revela si existe ni si tiene segundo factor)', async () => {
    const { user } = await abrirComo(null)
    await user.type(await screen.findByLabelText('Usuario'), 'nadie')
    await user.type(screen.getByLabelText('Contraseña'), 'x')
    await user.click(screen.getByRole('button', { name: 'Continuar' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/Usuario o contraseña incorrectos/)
    expect(screen.queryByLabelText(/Código del autenticador/)).not.toBeInTheDocument()
  })

  it('solo después de que el servidor acepta la contraseña aparece el segundo paso, con el código', async () => {
    const { user } = await abrirComo(null)
    await user.type(await screen.findByLabelText('Usuario'), 'fabio.mop')
    await user.type(screen.getByLabelText('Contraseña'), 'clave')
    await user.click(screen.getByRole('button', { name: 'Continuar' }))
    expect(await screen.findByRole('heading', { name: 'Verifica que eres tú' })).toBeInTheDocument()
    expect(screen.getByLabelText(/Código del autenticador/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Contraseña')).not.toBeInTheDocument() // ya no se muestra ni se pide otra vez
  })

  it('con el código correcto en el segundo paso entra a la plataforma', async () => {
    const { user } = await abrirComo(null)
    await user.type(await screen.findByLabelText('Usuario'), 'fabio.mop')
    await user.type(screen.getByLabelText('Contraseña'), 'clave')
    await user.click(screen.getByRole('button', { name: 'Continuar' }))
    await user.type(await screen.findByLabelText(/Código del autenticador/), '123456')
    await user.click(screen.getByRole('button', { name: 'Verificar' }))
    expect(await screen.findByRole('navigation', { name: 'Módulos' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(/fabio.mop/)
  })

  it('«Volver» regresa al primer paso y olvida la contraseña', async () => {
    const { user } = await abrirComo(null)
    await user.type(await screen.findByLabelText('Usuario'), 'fabio.mop')
    await user.type(screen.getByLabelText('Contraseña'), 'clave')
    await user.click(screen.getByRole('button', { name: 'Continuar' }))
    await user.click(await screen.findByRole('button', { name: 'Volver' }))
    expect(await screen.findByRole('heading', { name: 'Ingresa a tu cuenta' })).toBeInTheDocument()
    expect(screen.getByLabelText('Contraseña')).toHaveValue('')
    expect(screen.queryByLabelText(/Código del autenticador/)).not.toBeInTheDocument()
  })

  it('el código solo admite dígitos y máximo seis', async () => {
    const { user } = await abrirComo(null)
    await user.type(await screen.findByLabelText('Usuario'), 'fabio.mop')
    await user.type(screen.getByLabelText('Contraseña'), 'clave')
    await user.click(screen.getByRole('button', { name: 'Continuar' }))
    const campo = await screen.findByLabelText(/Código del autenticador/)
    await user.type(campo, '12ab34567890')
    expect(campo).toHaveValue('123456')
  })

  it('la contraseña se puede mostrar y ocultar', async () => {
    const { user } = await abrirComo(null)
    const campo = await screen.findByLabelText('Contraseña')
    expect(campo).toHaveAttribute('type', 'password')
    await user.click(screen.getByRole('button', { name: 'Mostrar contraseña' }))
    expect(campo).toHaveAttribute('type', 'text')
  })

  it('el formulario de crear cuenta pide todos los datos personales', async () => {
    const { user } = await abrirComo(null)
    await user.click(await screen.findByRole('button', { name: 'Crear una cuenta' }))
    for (const campo of ['Nombre', 'Apellidos', 'Cédula', 'Fecha de nacimiento', 'Provincia', 'Ciudad', 'Correo electrónico', 'Usuario', 'Contraseña']) {
      expect(screen.getByLabelText(new RegExp(`^${campo}`)), campo).toBeRequired()
    }
    const provincias = within(screen.getByLabelText('Provincia')).getAllByRole('option').map((o) => o.textContent)
    expect(provincias).toContain('Panamá Oeste')
    expect(provincias).toContain('Comarca Ngäbe-Buglé')
    expect(provincias).toHaveLength(14) // 13 + el texto «Elige una provincia»
    expect(screen.getByLabelText(/^Fecha de nacimiento/)).toHaveAttribute('max') // nadie menor de 18
  })

  it('crear una cuenta no pide código y lleva directo a activar el segundo factor', async () => {
    const { user } = await abrirComo(null)
    await user.click(await screen.findByRole('button', { name: 'Crear una cuenta' }))
    expect(screen.getByRole('heading', { name: 'Crea tu cuenta' })).toBeInTheDocument()
    expect(screen.queryByLabelText(/Código del autenticador/)).not.toBeInTheDocument()
    expect(screen.getByText(/Mínimo 12 caracteres/)).toBeInTheDocument()
    await user.type(screen.getByLabelText('Nombre'), 'María José')
    await user.type(screen.getByLabelText('Apellidos'), 'Pérez de Gracia')
    await user.type(screen.getByLabelText(/^Cédula/), '8-123-456')
    await user.type(screen.getByLabelText(/^Fecha de nacimiento/), '1995-04-12')
    await user.selectOptions(screen.getByLabelText('Provincia'), 'Panamá')
    await user.type(screen.getByLabelText('Ciudad'), 'San Miguelito')
    await user.type(screen.getByLabelText('Correo electrónico'), 'maria@correo.com')
    await user.type(screen.getByLabelText('Usuario'), 'nuevo.usuario')
    await user.type(screen.getByLabelText('Contraseña'), 'una-frase-larga-y-unica')
    await user.click(screen.getByRole('button', { name: 'Crear cuenta' }))
    expect(await screen.findByRole('heading', { name: 'Activa el segundo factor' })).toBeInTheDocument()
  })

  it('el aviso del bloqueo por intentos fallidos se ve al ingresar, no al crear cuenta', async () => {
    const { user } = await abrirComo(null)
    expect(await screen.findByText(/tras 3 intentos fallidos.*5 minutos la primera vez, 15 la segunda y 60/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Crear una cuenta' }))
    expect(screen.queryByText(/tras 3 intentos fallidos/)).not.toBeInTheDocument()
  })

  it('el alta del segundo factor muestra el QR y la clave, y al confirmar entra', async () => {
    const { user } = await abrirComo('enrolar')
    expect(await screen.findByRole('heading', { name: 'Activa el segundo factor' })).toBeInTheDocument()
    expect(await screen.findByText(/Clave manual/)).toBeInTheDocument()
    expect(screen.getByLabelText(/Código QR/)).toBeInTheDocument()
    const boton = screen.getByRole('button', { name: 'Activar y entrar' })
    expect(boton).toBeDisabled()
    await user.type(screen.getByLabelText(/Código de 6 dígitos/), '123456')
    expect(boton).toBeEnabled()
    await user.click(boton)
    expect(await screen.findByRole('navigation', { name: 'Módulos' })).toBeInTheDocument()
  })

  it('cerrar la sesión devuelve al formulario', async () => {
    const { user } = await abrirComo('ana.ciudadana')
    await user.click(screen.getByRole('button', { name: 'Cerrar sesión' }))
    expect(await screen.findByRole('heading', { name: 'Ingresa a tu cuenta' })).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('navigation', { name: 'Módulos' })).not.toBeInTheDocument())
  })
})

describe('accesibilidad (axe)', () => {
  it('acceso', async () => {
    const { container } = await abrirComo(null)
    await screen.findByRole('heading', { name: 'Ingresa a tu cuenta' })
    expect(await axe(container, AXE)).toHaveNoViolations()
  })

  it('inicio de una ciudadana', async () => {
    const { container } = await abrirComo('ana.ciudadana')
    await screen.findByRole('heading', { name: 'Requiere tu atención' })
    expect(await axe(container, AXE)).toHaveNoViolations()
  })

  it('bandeja en lista y en tablero', async () => {
    const { container, user } = await abrirComo('fabio.mop')
    await irA(user, 'Bandeja de la institución')
    await screen.findByRole('row', { name: /Trámite 42/ })
    expect(await axe(container, AXE)).toHaveNoViolations()
    await user.click(screen.getByRole('button', { name: /Tablero/ }))
    expect(await axe(container, AXE)).toHaveNoViolations()
  })

  it('detalle de un trámite', async () => {
    const { container, user } = await abrirComo('fabio.mop')
    await irA(user, 'Bandeja de la institución')
    await user.click(await screen.findByRole('row', { name: /Trámite 42:/ }))
    await screen.findByRole('img', { name: /Recorrido/ })
    expect(await axe(container, AXE)).toHaveNoViolations()
  })

  it('nuevo trámite', async () => {
    const { container, user } = await abrirComo('ana.ciudadana')
    await irA(user, 'Iniciar un trámite')
    await screen.findByRole('radiogroup', { name: 'Institución' })
    expect(await axe(container, AXE)).toHaveNoViolations()
  })

  it('mi seguridad', async () => {
    const { container, user } = await abrirComo('saul.mop')
    await irA(user, 'Mi seguridad')
    await screen.findByText(/Credencial SIGET/)
    expect(await axe(container, AXE)).toHaveNoViolations()
  })
})
