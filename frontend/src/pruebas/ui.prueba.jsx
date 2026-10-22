import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'
import { describe, expect, it } from 'vitest'
import { Alerta, Avatar, Esclusas, Icono, Insignia, ProveedorUI, Vacio, useUI } from '../ui.jsx'

describe('Esclusas: el estado del trámite hecho imagen', () => {
  const etiquetas = {
    Pendiente: 'Recepción', 'En Tramitacion': 'En tramitación', 'En Subsanacion': 'En subsanación', Aprobado: 'Aprobado', Rechazado: 'Rechazado',
  }
  for (const [estado, texto] of Object.entries(etiquetas)) {
    it(`describe el estado «${estado}» a los lectores de pantalla`, () => {
      render(<Esclusas estado={estado} />)
      expect(screen.getByRole('img')).toHaveAttribute('aria-label', `Recorrido del trámite: ${texto}`)
    })
  }

  it('la boya aparece mientras el trámite está abierto y se reemplaza por el sello al resolverse', () => {
    const { container, rerender } = render(<Esclusas estado="En Tramitacion" />)
    expect(container.querySelector('.esc-boya-g.pos-1')).toBeInTheDocument()
    expect(container.textContent).not.toMatch(/APROBADO|RECHAZADO/)
    rerender(<Esclusas estado="Aprobado" />)
    expect(container.querySelector('.esc-boya-g')).not.toBeInTheDocument()
    expect(container.textContent).toContain('APROBADO')
    rerender(<Esclusas estado="Rechazado" />)
    expect(container.textContent).toContain('RECHAZADO')
  })

  it('la boya se ubica en la cámara que corresponde (y en el dique para la subsanación)', () => {
    const pos = (estado) => render(<Esclusas estado={estado} />).container.querySelector('.esc-boya-g').getAttribute('class')
    expect(pos('Pendiente')).toContain('pos-0')
    expect(pos('En Tramitacion')).toContain('pos-1')
    expect(pos('En Subsanacion')).toContain('pos-sub')
  })

  it('la versión decorativa se oculta a los lectores de pantalla', () => {
    const { container } = render(<Esclusas estado="Pendiente" decorativo />)
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
  })

  it('no tiene violaciones de accesibilidad', async () => {
    const { container } = render(<Esclusas estado="En Subsanacion" />)
    expect(await axe(container)).toHaveNoViolations()
  })
})

describe('piezas básicas', () => {
  it('Avatar saca las iniciales y es estable para el mismo nombre', () => {
    const { container, rerender } = render(<Avatar nombre="fabio.mop" />)
    expect(container.textContent).toBe('FM')
    const clase = container.firstChild.className
    rerender(<Avatar nombre="fabio.mop" />)
    expect(container.firstChild.className).toBe(clase)
    rerender(<Avatar nombre="" />)
    expect(container.textContent).toBe('?')
  })

  it('Alerta no pinta nada sin mensaje y usa role=alert solo para errores', () => {
    const { container, rerender } = render(<Alerta>{''}</Alerta>)
    expect(container).toBeEmptyDOMElement()
    rerender(<Alerta>Falló</Alerta>)
    expect(screen.getByRole('alert')).toHaveTextContent('Falló')
    rerender(<Alerta tipo="ok">Listo</Alerta>)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Listo')
  })

  it('los iconos son decorativos (aria-hidden)', () => {
    const { container } = render(<Icono nombre="escudo" />)
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
  })

  it('Vacio explica qué pasa y ofrece una acción', () => {
    render(<Vacio titulo="Sin trámites" texto="Inicia el primero." accion={<button>Iniciar</button>} />)
    expect(screen.getByRole('heading', { name: 'Sin trámites' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Iniciar' })).toBeInTheDocument()
  })

  it('Insignia admite no llevar punto', () => {
    const { container } = render(<Insignia punto={false}>Hola</Insignia>)
    expect(container.firstChild.className).toContain('sin-punto')
  })
})

function Probador({ alTerminar }) {
  const { avisar, confirmar, alternarTema, tema } = useUI()
  return (
    <div>
      <span data-testid="tema">{tema}</span>
      <button onClick={() => avisar('Guardado')}>avisar</button>
      <button onClick={() => alternarTema()}>tema</button>
      <button onClick={async () => alTerminar(await confirmar({ titulo: 'Rechazar este trámite', texto: 'Es final.', etiqueta: 'Rechazar trámite', peligro: true }))}>preguntar</button>
    </div>
  )
}

describe('avisos, confirmaciones y tema', () => {
  it('un aviso se muestra en una región accesible y se puede cerrar', async () => {
    const user = userEvent.setup()
    render(<ProveedorUI><Probador alTerminar={() => {}} /></ProveedorUI>)
    await user.click(screen.getByText('avisar'))
    expect(screen.getByText('Guardado')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cerrar aviso' }))
    expect(screen.queryByText('Guardado')).not.toBeInTheDocument()
  })

  it('confirmar() devuelve true al aceptar y false al cancelar o con Escape', async () => {
    const user = userEvent.setup()
    const resultados = []
    render(<ProveedorUI><Probador alTerminar={(v) => resultados.push(v)} /></ProveedorUI>)

    await user.click(screen.getByText('preguntar'))
    expect(screen.getByRole('alertdialog')).toHaveAccessibleName('Rechazar este trámite')
    await user.click(screen.getByRole('button', { name: 'Rechazar trámite' }))
    await user.click(screen.getByText('preguntar'))
    await user.click(screen.getByRole('button', { name: 'Cancelar' }))
    await user.click(screen.getByText('preguntar'))
    await user.keyboard('{Escape}')
    await waitFor(() => expect(resultados).toEqual([true, false, false]))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('el foco entra al botón de confirmar y el diálogo no tiene violaciones de accesibilidad', async () => {
    const user = userEvent.setup()
    const { container } = render(<ProveedorUI><Probador alTerminar={() => {}} /></ProveedorUI>)
    await user.click(screen.getByText('preguntar'))
    expect(screen.getByRole('button', { name: 'Rechazar trámite' })).toHaveFocus()
    expect(await axe(container)).toHaveNoViolations()
  })

  it('el tema se alterna, se aplica al documento y se recuerda', async () => {
    const user = userEvent.setup()
    render(<ProveedorUI><Probador alTerminar={() => {}} /></ProveedorUI>)
    const inicial = screen.getByTestId('tema').textContent
    await user.click(screen.getByText('tema'))
    const nuevo = inicial === 'oscuro' ? 'claro' : 'oscuro'
    expect(screen.getByTestId('tema')).toHaveTextContent(nuevo)
    expect(document.documentElement.dataset.tema).toBe(nuevo)
    expect(localStorage.getItem('siget-tema')).toBe(nuevo)
  })

  it('el tema funciona aunque no haya almacenamiento disponible', async () => {
    const original = Storage.prototype.setItem
    Storage.prototype.setItem = () => { throw new Error('bloqueado') }
    try {
      const user = userEvent.setup()
      render(<ProveedorUI><Probador alTerminar={() => {}} /></ProveedorUI>)
      await user.click(screen.getByText('tema'))
      expect(document.documentElement.dataset.tema).toBeTruthy()
    } finally {
      Storage.prototype.setItem = original
    }
  })
})
