import { useEffect, useRef, useState } from 'react'
import { api, ApiError } from './api.js'
import { Alerta, Icono, Insignia } from './ui.jsx'

export { Alerta }

// Provincias y comarcas de Panamá. El servidor valida contra su propia lista: esta solo arma los selectores (registro y «Mis datos»).
export const PROVINCIAS = [
  'Bocas del Toro', 'Chiriquí', 'Coclé', 'Colón', 'Darién', 'Herrera', 'Los Santos', 'Panamá', 'Panamá Oeste', 'Veraguas',
  'Comarca Guna Yala', 'Comarca Emberá-Wounaan', 'Comarca Ngäbe-Buglé',
]

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
  escalamiento: 'Escalado a supervisión',

  documento_adjuntado: 'Documento adjuntado',
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

// «1992-03-14» es una fecha sin hora: se arma en la zona local para que no se corra un día (new Date('1992-03-14') es medianoche UTC)
export function fechaCalendario(iso) {
  const [a, m, d] = String(iso).split('-').map(Number)
  if (!a || !m || !d) return String(iso)
  return new Date(a, m - 1, d).toLocaleDateString('es-PA', { day: 'numeric', month: 'long', year: 'numeric' })
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
      {tramite.escalado && !FINALES.includes(tramite.estado) && <span className="etiqueta-escalado">Escalado a supervisión</span>}
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

// Modales: Escape cierra el de más arriba (si hay dos abiertos, solo ese) y al cerrarse el foco vuelve al botón que lo abrió.
// El botón se anota al dibujar el modal por primera vez (el `autoFocus` del campo interno mueve el foco después).
const MODALES_ABIERTOS = []

export function useModal(alCerrar) {
  const [abridor] = useState(() => (document.activeElement && document.activeElement !== document.body ? document.activeElement : null))
  const cerrar = useRef(alCerrar)
  useEffect(() => { cerrar.current = alCerrar })
  useEffect(() => {
    const yo = {}
    MODALES_ABIERTOS.push(yo)
    const tecla = (e) => {
      if (e.key === 'Escape' && MODALES_ABIERTOS[MODALES_ABIERTOS.length - 1] === yo) cerrar.current()
    }
    document.addEventListener('keydown', tecla)
    return () => {
      document.removeEventListener('keydown', tecla)
      MODALES_ABIERTOS.splice(MODALES_ABIERTOS.indexOf(yo), 1)
      if (abridor?.isConnected && !abridor.disabled) abridor.focus()
    }
  }, [abridor])
}

// Paginación: 20 por página en los listados de trámites. `Paginacion` solo se dibuja si hay más de una página; el texto «Mostrando a–b de N» y
// «Página X de Y» es una región viva (role=status) para que los lectores de pantalla anuncien cada cambio de página.
export const TAM_PAGINA = 20

export function Paginacion({ total, tamano = TAM_PAGINA, pagina, cambiar, unidad = 'registros' }) {
  const paginas = Math.max(1, Math.ceil(total / tamano))
  if (total <= tamano) return null
  const desde = pagina * tamano + 1
  const hasta = Math.min(total, (pagina + 1) * tamano)
  return (
    <nav className="paginador" aria-label="Paginación">
      <span role="status" aria-live="polite" aria-atomic="true">Mostrando {desde} a {hasta} de {total} {unidad} · Página {pagina + 1} de {paginas}</span>
      <div className="fila-botones">
        <button type="button" className="btn btn-sec btn-s" disabled={pagina === 0} onClick={() => cambiar(pagina - 1)}><Icono nombre="izquierda" />Anterior</button>
        <button type="button" className="btn btn-sec btn-s" disabled={pagina + 1 >= paginas} onClick={() => cambiar(pagina + 1)}>Siguiente<Icono nombre="derecha" /></button>
      </div>
    </nav>
  )
}

// Reparte una lista ya filtrada en páginas. `reinicio` es una clave de los filtros: al cambiarla se vuelve a la primera página, y si la lista
// se acorta (p. ej. un trámite que ya no cumple el filtro) la página se ajusta a la última que exista.
export function usePagina(filas, tamano = TAM_PAGINA, reinicio = '') {
  const [pagina, setPagina] = useState(0)
  useEffect(() => { setPagina(0) }, [reinicio])
  const paginas = Math.max(1, Math.ceil(filas.length / tamano))
  const actual = Math.min(pagina, paginas - 1)
  return { pagina: actual, setPagina, total: filas.length, visibles: filas.slice(actual * tamano, (actual + 1) * tamano) }
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
  useModal(alCancelar)
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
      const incorrecto = e instanceof ApiError && e.estado === 400
      setError(incorrecto ? 'Ese código no sirve: es incorrecto o ya se usó. Espera al siguiente e inténtalo otra vez.' : mensajeDe(e))
      if (incorrecto) setCodigo('') // un código ya rechazado no se reintenta: se escribe el siguiente
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
