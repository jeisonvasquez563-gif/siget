import { useState } from 'react'
import { api, ApiError } from './api.js'
import { Alerta, Icono, Insignia } from './ui.jsx'

export { Alerta }

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
  ciudadano: 'Ciudadanía',
  funcionario: 'Funcionario',
  supervisor: 'Supervisor',
  coordinador_institucional: 'Coordinación',
}

export const ESTADOS = {
  Pendiente: { texto: 'Pendiente', clase: 'e-pendiente' },
  'En Tramitacion': { texto: 'En tramitación', clase: 'e-tramitacion' },
  'En Subsanacion': { texto: 'En subsanación', clase: 'e-subsanacion' },
  Aprobado: { texto: 'Aprobado', clase: 'e-aprobado' },
  Rechazado: { texto: 'Rechazado', clase: 'e-rechazado' },
}
export function etiquetaDeRol(yo) {
  if (yo.rol_plataforma !== 'ninguno') return ROLES_PLATAFORMA[yo.rol_plataforma]
  const roles = [...new Set(yo.membresias.map((m) => ROLES_INSTITUCION[m.rol]))]
  return roles.length ? roles.join(' · ') : 'Ciudadanía'
}

export const FINALES = ['Aprobado', 'Rechazado']

// Solo una ayuda para mostrar los botones: la transición válida la decide el servidor (y la base de datos).
export const SIGUIENTES = {
  Pendiente: ['En Tramitacion'],
  'En Tramitacion': ['En Subsanacion', 'Aprobado', 'Rechazado'],
  'En Subsanacion': ['En Tramitacion'],
  Aprobado: [],
  Rechazado: [],
}

export const ACCIONES_EVENTO = {
  creacion: 'Trámite iniciado',
  cambio_estado: 'Cambio de estado',
  reasignacion: 'Reasignación',
}

export function Estado({ valor }) {
  const e = ESTADOS[valor] || { texto: valor, clase: '' }
  return <Insignia clase={e.clase}>{e.texto}</Insignia>
}

export function fecha(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('es-PA', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export function fechaCorta(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('es-PA', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function hace(iso) {
  if (!iso) return ''
  const min = Math.round((Date.now() - new Date(iso)) / 60000)
  if (min < 1) return 'ahora mismo'
  if (min < 60) return `hace ${min} min`
  const h = Math.round(min / 60)
  if (h < 24) return `hace ${h} h`
  return `hace ${Math.round(h / 24)} d`
}

// Cuánto del plazo ya pasó y cómo decirlo. Un trámite resuelto ya no corre contra el reloj.
export function plazoDe(t) {
  if (FINALES.includes(t.estado)) return { texto: 'Resuelto', clase: '', valor: 1 }
  const inicio = new Date(t.creado_en).getTime()
  const fin = new Date(t.fecha_limite).getTime()
  const dias = Math.ceil((fin - Date.now()) / 86400000)
  const valor = Math.min(1, Math.max(0, (Date.now() - inicio) / Math.max(1, fin - inicio)))
  if (t.vencido) return { texto: `Venció hace ${Math.max(1, Math.abs(dias))} ${Math.abs(dias) === 1 ? 'día' : 'días'}`, clase: 'vencido', valor: 1 }
  if (dias <= 0) return { texto: 'Vence hoy', clase: 'atencion', valor }
  return { texto: `${dias} ${dias === 1 ? 'día' : 'días'} para el límite`, clase: valor >= 0.75 ? 'atencion' : '', valor }
}

export function Plazo({ tramite }) {
  const p = plazoDe(tramite)
  return (
    <div>
      <progress className={`plazo ${p.clase}`} max="100" value={Math.round(p.valor * 100)} aria-label="Tiempo transcurrido del plazo" />
      <span className={`plazo-texto ${p.clase}`}>{p.texto}</span>
    </div>
  )
}

export function mensajeDe(error) {
  if (error instanceof ApiError) {
    if (error.estado === 403) return 'No tienes autorización para esta operación. El servidor la negó y quedó registrada.'
    if (error.estado === 404) return 'No existe o no tienes acceso a este recurso.'
    if (error.estado === 409) return 'El trámite cambió mientras lo editabas. Recarga y vuelve a intentarlo.'
    if (error.estado === 429) return 'Demasiadas peticiones. Espera un momento.'
    return error.message
  }
  return 'No se pudo conectar con el servidor. Revisa tu conexión.'
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
      setError(e instanceof ApiError && e.estado === 400 ? 'Ese código no sirve: es incorrecto o ya se usó. Espera al siguiente e inténtalo otra vez.' : mensajeDe(e))
      setTrabajando(false)
    }
  }

  return (
    <div className="fondo-modal">
      <form className="modal" onSubmit={enviar} role="dialog" aria-modal="true" aria-labelledby="titulo-reauth">
        <h2 id="titulo-reauth"><span className="icono-grande"><Icono nombre="llave" /></span>Confirma que eres tú</h2>
        <p className="suave">Esta acción es sensible y exige una verificación reciente. Escribe el código de 6 dígitos que muestra tu aplicación de autenticación.</p>
        <Alerta>{error}</Alerta>
        <label className="campo">
          <span>Código de 6 dígitos</span>
          <input className="entrada entrada-codigo" value={codigo} onChange={(e) => setCodigo(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" placeholder="000000" autoFocus />
        </label>
        <div className="fila-botones">
          <button type="button" className="btn btn-sec" onClick={alCancelar}>Cancelar</button>
          <button type="submit" className="btn" disabled={codigo.length !== 6 || trabajando}>Verificar y continuar</button>
        </div>
      </form>
    </div>
  )
}
