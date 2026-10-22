import { useState } from 'react'
import { api, ApiError } from './api.js'

export const ROLES_PLATAFORMA = {
  ninguno: 'Sin rol de plataforma',
  operador_infraestructura: 'Operador de infraestructura',
  operador_identidades: 'Operador de identidades',
  operador_catalogo: 'Operador de catálogo',
  operador_seguridad: 'Operador de seguridad',
  custodio_secretos: 'Custodio de secretos',
  auditor: 'Auditor',
}

export const ROLES_INSTITUCION = {
  ciudadano: 'Ciudadano',
  funcionario: 'Funcionario',
  supervisor: 'Supervisor',
  coordinador_institucional: 'Coordinador institucional',
}

export const ESTADOS = {
  Pendiente: { texto: 'Pendiente', clase: 'e-pendiente' },
  'En Tramitacion': { texto: 'En tramitación', clase: 'e-tramitacion' },
  'En Subsanacion': { texto: 'En subsanación', clase: 'e-subsanacion' },
  Aprobado: { texto: 'Aprobado', clase: 'e-aprobado' },
  Rechazado: { texto: 'Rechazado', clase: 'e-rechazado' },
}

// Solo una ayuda para mostrar los botones: la transición válida la decide el servidor (y la base de datos).
export const SIGUIENTES = {
  Pendiente: ['En Tramitacion'],
  'En Tramitacion': ['En Subsanacion', 'Aprobado', 'Rechazado'],
  'En Subsanacion': ['En Tramitacion'],
  Aprobado: [],
  Rechazado: [],
}

export const ACCIONES_EVENTO = {
  creacion: 'Trámite creado',
  cambio_estado: 'Cambio de estado',
  reasignacion: 'Reasignación',
}

export function Estado({ valor }) {
  const e = ESTADOS[valor] || { texto: valor, clase: '' }
  return <span className={`chip ${e.clase}`}>{e.texto}</span>
}

export function fecha(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('es-PA', { dateStyle: 'medium', timeStyle: 'short' })
}

export function diasRestantes(iso, vencido) {
  if (!iso) return ''
  const dias = Math.ceil((new Date(iso) - new Date()) / 86400000)
  if (vencido) return `vencido hace ${Math.abs(dias)} d`
  return dias <= 0 ? 'vence hoy' : `${dias} d restantes`
}

export function Cargando({ texto = 'Cargando…' }) {
  return <p className="cargando" role="status">{texto}</p>
}

export function Alerta({ tipo = 'error', children }) {
  if (!children) return null
  return <div className={`alerta alerta-${tipo}`} role={tipo === 'error' ? 'alert' : 'status'}>{children}</div>
}

export function mensajeDe(error) {
  if (error instanceof ApiError) {
    if (error.estado === 403) return 'No tienes autorización para esta operación. El servidor la negó y quedó registrada.'
    if (error.estado === 404) return 'No existe o no tienes acceso a este recurso.'
    if (error.estado === 429) return 'Demasiadas peticiones. Espera un momento.'
    return error.message
  }
  return 'No se pudo conectar con el servidor.'
}

// Reautenticación escalonada: las acciones sensibles piden un código reciente del segundo factor.
export function useReautenticacion() {
  const [pendiente, setPendiente] = useState(null)

  async function ejecutar(accion) {
    try {
      return await accion()
    } catch (e) {
      if (e instanceof ApiError && e.pideReautenticar) {
        setPendiente(() => accion)
        return undefined
      }
      throw e
    }
  }

  const modal = pendiente ? (
    <ModalCodigo
      alCancelar={() => setPendiente(null)}
      alVerificar={async () => {
        const accion = pendiente
        setPendiente(null)
        await accion()
      }}
    />
  ) : null

  return { ejecutar, modal }
}

function ModalCodigo({ alCancelar, alVerificar }) {
  const [codigo, setCodigo] = useState('')
  const [error, setError] = useState('')
  const [trabajando, setTrabajando] = useState(false)

  async function enviar(ev) {
    ev.preventDefault()
    setError('')
    setTrabajando(true)
    try {
      await api('/auth/mfa/verificar/', { metodo: 'POST', cuerpo: { codigo } })
      await alVerificar()
    } catch (e) {
      setError(e instanceof ApiError && e.estado === 400 ? 'Código inválido o ya usado. Espera al siguiente código.' : mensajeDe(e))
      setTrabajando(false)
    }
  }

  return (
    <div className="fondo-modal">
      <form className="modal" onSubmit={enviar} role="dialog" aria-modal="true" aria-labelledby="titulo-reauth">
        <h2 id="titulo-reauth">Confirma tu identidad</h2>
        <p>Esta acción modifica un trámite y exige un código reciente de tu aplicación de autenticación.</p>
        <Alerta>{error}</Alerta>
        <label>
          Código de 6 dígitos
          <input value={codigo} onChange={(e) => setCodigo(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" autoFocus />
        </label>
        <div className="fila-botones">
          <button type="button" className="secundario" onClick={alCancelar}>Cancelar</button>
          <button type="submit" disabled={codigo.length !== 6 || trabajando}>Verificar y continuar</button>
        </div>
      </form>
    </div>
  )
}
