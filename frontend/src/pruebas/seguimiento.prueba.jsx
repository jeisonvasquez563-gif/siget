import { render, screen, within } from '@testing-library/react'
import { axe } from 'jest-axe'
import { describe, expect, it } from 'vitest'
import { ETIQUETA, FRASES, Seguimiento, pasosDe } from '../Seguimiento.jsx'

const situaciones = (estado) => pasosDe(estado).map((p) => p.situacion)

describe('pasos según el estado del trámite', () => {
  it('cada estado deja los tres pasos en su situación', () => {
    expect(situaciones('Pendiente')).toEqual(['actual', 'futuro', 'futuro'])
    expect(situaciones('En Tramitacion')).toEqual(['hecho', 'actual', 'futuro'])
    expect(situaciones('En Subsanacion')).toEqual(['hecho', 'alerta', 'futuro'])
    expect(situaciones('Aprobado')).toEqual(['hecho', 'hecho', 'aprobado'])
    expect(situaciones('Rechazado')).toEqual(['hecho', 'hecho', 'rechazado'])
  })

  it('el último paso cambia de nombre al resolverse y dice cómo terminó', () => {
    expect(pasosDe('Pendiente')[2].etiqueta).toBe('Resolución')
    expect(pasosDe('Aprobado')[2].etiqueta).toBe('Aprobado')
    expect(pasosDe('Rechazado')[2].etiqueta).toBe('Rechazado')
    expect(pasosDe('Aprobado')[2].detalle).toBe('Trámite resuelto')
  })

  it('la subsanación se ve como una alerta en Tramitación, no como un paso nuevo', () => {
    const pasos = pasosDe('En Subsanacion')
    expect(pasos).toHaveLength(3)
    expect(pasos[1]).toMatchObject({ situacion: 'alerta', icono: 'alerta', detalle: 'Falta información' })
  })

  it('todos los estados tienen etiqueta y una frase en lenguaje llano', () => {
    for (const estado of ['Pendiente', 'En Tramitacion', 'En Subsanacion', 'Aprobado', 'Rechazado']) {
      expect(ETIQUETA[estado]).toBeTruthy()
      expect(FRASES[estado][2].length).toBeGreaterThan(20)
    }
  })
})

describe('el componente', () => {
  const casos = { Pendiente: 'Recepción', 'En Tramitacion': 'En tramitación', 'En Subsanacion': 'En subsanación', Aprobado: 'Aprobado', Rechazado: 'Rechazado' }
  for (const [estado, texto] of Object.entries(casos)) {
    it(`describe «${estado}» a los lectores de pantalla y explica qué pasa`, () => {
      render(<Seguimiento estado={estado} />)
      expect(screen.getByRole('img')).toHaveAttribute('aria-label', `Recorrido del trámite: ${texto}`)
      expect(screen.getByText(FRASES[estado][2])).toBeInTheDocument()
    })
  }

  it('los pasos hechos muestran una marca de verificación y el actual no', () => {
    const { container } = render(<Seguimiento estado="En Tramitacion" />)
    const pasos = container.querySelectorAll('.seg-paso')
    expect(pasos[0]).toHaveClass('hecho')
    expect(pasos[1]).toHaveClass('actual')
    expect(pasos[2]).toHaveClass('futuro')
    expect(within(pasos[1]).getByText('En revisión')).toBeInTheDocument()
  })

  it('un trámite resuelto marca el último paso con su color: aprobado y rechazado son distintos', () => {
    const { container, rerender } = render(<Seguimiento estado="Aprobado" />)
    expect(container.querySelector('.seg-paso.aprobado')).toBeInTheDocument()
    expect(container.querySelector('.seguimiento-frase')).toHaveClass('tono-bien')
    rerender(<Seguimiento estado="Rechazado" />)
    expect(container.querySelector('.seg-paso.rechazado')).toBeInTheDocument()
    expect(container.querySelector('.seguimiento-frase')).toHaveClass('tono-mal')
  })

  it('la frase de subsanación usa el tono de alerta', () => {
    const { container } = render(<Seguimiento estado="En Subsanacion" />)
    expect(container.querySelector('.seguimiento-frase')).toHaveClass('tono-alerta')
  })

  it('no tiene violaciones de accesibilidad', async () => {
    for (const estado of ['Pendiente', 'En Subsanacion', 'Aprobado']) {
      const { container, unmount } = render(<Seguimiento estado={estado} />)
      expect(await axe(container)).toHaveNoViolations()
      unmount()
    }
  })
})
