// Documentos adjuntos (PT-8): quién adjunta, quién descarga y qué se rechaza antes de subir
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import App from '../App.jsx'
import { instalarMock } from '../mock.js'
import { ProveedorUI } from '../ui.jsx'

async function abrirTramite(usuario, modulo, numero) {
  instalarMock(usuario, { demora: 0 })
  render(<ProveedorUI><App /></ProveedorUI>)
  const user = userEvent.setup({ applyAccept: false })
  const nav = await screen.findByRole('navigation', { name: 'Módulos' })
  await user.click(within(nav).getByRole('button', { name: new RegExp(`^${modulo}`) }))
  await user.click(await screen.findByRole('row', { name: new RegExp(`^Trámite ${numero}:`) }))
  const panel = (await screen.findByRole('heading', { name: 'Documentos' })).closest('section')
  return { user, panel }
}

describe('documentos de un trámite', () => {
  it('la persona que pidió el trámite ve sus documentos y adjunta uno nuevo', async () => {
    const { user, panel } = await abrirTramite('ana.ciudadana', 'Mis trámites', 36)
    expect(await within(panel).findByText('plano-del-local.pdf')).toBeInTheDocument()
    const archivo = new File(['%PDF-1.7 prueba'], 'permiso.pdf', { type: 'application/pdf' })
    await user.upload(within(panel).getByLabelText('Elegir el documento a adjuntar'), archivo)
    expect(await within(panel).findByText('«permiso.pdf» se adjuntó al trámite.')).toBeInTheDocument()
    expect(within(panel).getByText('permiso.pdf')).toBeInTheDocument()
    expect(await screen.findByText('Documento adjuntado')).toBeInTheDocument()   // queda en el historial
  })

  it('un archivo de más de 5 MB se rechaza antes de enviarlo', async () => {
    const { user, panel } = await abrirTramite('ana.ciudadana', 'Mis trámites', 36)
    const grande = new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'enorme.pdf', { type: 'application/pdf' })
    await user.upload(within(panel).getByLabelText('Elegir el documento a adjuntar'), grande)
    expect(await within(panel).findByText('El archivo supera los 5 MB.')).toBeInTheDocument()
  })

  it('un tipo no permitido muestra el motivo que da el servidor', async () => {
    const { user, panel } = await abrirTramite('ana.ciudadana', 'Mis trámites', 36)
    await user.upload(within(panel).getByLabelText('Elegir el documento a adjuntar'), new File(['<svg/>'], 'dibujo.svg', { type: 'image/svg+xml' }))
    expect(await within(panel).findByText(/Solo se aceptan PDF, PNG o JPEG/)).toBeInTheDocument()
  })

  it('el personal ve y descarga los documentos, pero no adjunta en nombre de la persona', async () => {
    const { panel } = await abrirTramite('felix.minsa', 'Bandeja de la institución', 36)   // #36 es del MINSA
    expect(await within(panel).findByText('plano-del-local.pdf')).toBeInTheDocument()
    expect(within(panel).getByRole('button', { name: 'Descargar plano-del-local.pdf' })).toBeInTheDocument()
    expect(within(panel).queryByRole('button', { name: /Adjuntar documento/ })).not.toBeInTheDocument()
  })

  it('un trámite con resolución final no admite documentos nuevos', async () => {
    const { panel } = await abrirTramite('ana.ciudadana', 'Mis trámites', 35)   // #35 está aprobado
    await within(panel).findByText(/no tiene documentos adjuntos/)
    expect(within(panel).queryByRole('button', { name: /Adjuntar documento/ })).not.toBeInTheDocument()
  })
})
