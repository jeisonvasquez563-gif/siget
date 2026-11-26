import { useEffect, useId, useRef, useState } from 'react'
import { api, ApiError } from './api.js'
import { fechaCalendario, mensajeDe, useModal } from './comun.jsx'
import { Alerta, Icono, useUI } from './ui.jsx'

// Contenido del trámite: el formulario que pide cada tipo, lo que la persona respondió, el motivo de las decisiones del personal y
// la respuesta a una subsanación. Todo texto que llega del servidor se dibuja como texto de React (nunca como HTML) y nada de esto
// se guarda en el navegador ni viaja en la URL. El servidor valida de nuevo todo: lo de aquí solo ahorra viajes.

export const MOTIVO_MIN = 10
export const MOTIVO_MAX = 2000

// «Este trámite no tiene datos…»: los anteriores a la función tienen `datos` vacíos
export const sinDatos = (datos) => !datos || Object.keys(datos).length === 0

/* ---------------------------------------------------------------- de formulario a datos y de vuelta */

// Los campos del formulario se editan como texto (un input siempre da texto); al enviar, los números vuelven a ser números.
export function valoresIniciales(campos, datos = {}) {
  return Object.fromEntries(campos.map((c) => [c.id, datos?.[c.id] === undefined || datos?.[c.id] === null ? '' : String(datos[c.id])]))
}

// Un campo opcional vacío no se envía: el servidor tampoco lo guarda
export function armarDatos(campos, valores) {
  const datos = {}
  for (const c of campos) {
    const v = (valores[c.id] ?? '').trim()
    if (v === '') continue
    datos[c.id] = c.tipo === 'numero' ? Number(v) : v
  }
  return datos
}

// Lo mínimo que se revisa antes de enviar (obligatorios y números); el resto lo dice el servidor, campo por campo
export function validarCliente(campos, valores) {
  const errores = {}
  for (const c of campos) {
    const v = (valores[c.id] ?? '').trim()
    if (v === '') { if (c.obligatorio) errores[c.id] = 'Este campo es obligatorio.' } else if (c.tipo === 'numero' && !Number.isFinite(Number(v))) errores[c.id] = 'Debe ser un número.'
  }
  return errores
}

// Los errores de un 400: `errores` es {campo: mensaje} (los generales, bajo `datos`); cualquier otra forma se muestra como mensaje general
export function erroresDe(e) {
  const crudos = e instanceof ApiError ? e.datos?.errores : null
  if (!crudos || typeof crudos !== 'object' || Array.isArray(crudos)) return null
  return Object.fromEntries(Object.entries(crudos).map(([k, v]) => [k, Array.isArray(v) ? v.join(' ') : String(v)]))
}

const hoyLocal = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/* ---------------------------------------------------------------- piezas */

export function Contador({ id, valor, max, min = 0 }) {
  const n = valor.length
  return <small id={id} className="contador">{n} de {max} caracteres{min ? ` (mínimo ${min})` : ''}</small>
}

// Un textarea con su etiqueta, contador y error, para los textos sueltos (motivo, respuesta)
export function CampoTexto({ etiqueta, valor, cambiar, min = MOTIVO_MIN, max = MOTIVO_MAX, error, ayuda, autoFocus, filas = 4 }) {
  const id = useId()
  const describe = [ayuda && `${id}-ayuda`, `${id}-n`, error && `${id}-error`].filter(Boolean).join(' ')
  return (
    <div className={`campo ${error ? 'con-error' : ''}`}>
      <label className="campo-etiqueta" htmlFor={id}>{etiqueta}<span className="marca-requerido" aria-hidden="true"> *</span></label>
      {ayuda && <small id={`${id}-ayuda`}>{ayuda}</small>}
      <textarea id={id} className="entrada" rows={filas} value={valor} onChange={(e) => cambiar(e.target.value)} maxLength={max} required aria-required="true"
        aria-invalid={error ? 'true' : undefined} aria-describedby={describe} autoFocus={autoFocus} />
      <Contador id={`${id}-n`} valor={valor} max={max} min={min} />
      {error && <small id={`${id}-error`} className="error-campo">{error}</small>}
    </div>
  )
}

function Campo({ campo, valor, cambiar, error, base }) {
  const id = `${base}-${campo.id}`
  const idAyuda = campo.ayuda ? `${id}-ayuda` : null
  const idError = error ? `${id}-error` : null
  const idContador = campo.tipo === 'texto_largo' ? `${id}-n` : null
  const describe = [idAyuda, idContador, idError].filter(Boolean).join(' ') || undefined
  const comun = {
    id, value: valor, required: campo.obligatorio, 'aria-required': campo.obligatorio ? 'true' : undefined,
    'aria-invalid': error ? 'true' : undefined, 'aria-describedby': describe, onChange: (e) => cambiar(campo.id, e.target.value),
  }
  let control
  if (campo.tipo === 'texto') control = <input className="entrada" type="text" maxLength={campo.max} {...comun} />
  else if (campo.tipo === 'texto_largo') control = <textarea className="entrada" rows={4} maxLength={campo.max} {...comun} />
  else if (campo.tipo === 'numero') control = <input className="entrada" type="number" min="0" max={campo.max} step={campo.entero ? 1 : 'any'} inputMode={campo.entero ? 'numeric' : 'decimal'} {...comun} />
  else if (campo.tipo === 'fecha') control = <input className="entrada" type="date" min="1900-01-01" max={hoyLocal()} {...comun} />
  else {
    control = (
      <select className="entrada" {...comun}>
        <option value="">Elegir una opción…</option>
        {(campo.opciones || []).map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    )
  }
  return (
    <div className={`campo ${error ? 'con-error' : ''}`}>
      <label className="campo-etiqueta" htmlFor={id}>{campo.etiqueta}{campo.obligatorio && <span className="marca-requerido" aria-hidden="true"> *</span>}</label>
      {campo.ayuda && <small id={idAyuda}>{campo.ayuda}</small>}
      {control}
      {idContador && <Contador id={idContador} valor={valor} max={campo.max} />}
      {error && <small id={idError} className="error-campo">{error}</small>}
    </div>
  )
}

// Los campos de un formulario. `errores` es {id_del_campo: mensaje}.
export function CamposFormulario({ campos, valores, cambiar, errores = {} }) {
  const base = useId()
  return (
    <>
      {campos.map((c) => <Campo key={c.id} campo={c} valor={valores[c.id] ?? ''} cambiar={cambiar} error={errores[c.id]} base={base} />)}
      {campos.some((c) => c.obligatorio) && <p className="nota"><span aria-hidden="true">* </span>Los campos con asterisco son obligatorios.</p>}
    </>
  )
}

// Resumen de lo que hay que corregir, arriba del formulario. Recibe el foco al aparecer para que se lea de inmediato.
export function ResumenErrores({ campos = [], errores, general }) {
  const caja = useRef(null)
  const hay = general || (errores && Object.keys(errores).length > 0)
  useEffect(() => { if (hay) caja.current?.focus() }, [hay, errores, general])
  if (!hay) return null
  const etiqueta = (k) => campos.find((c) => c.id === k)?.etiqueta
  return (
    <div ref={caja} tabIndex={-1} className="resumen-errores">
      <Alerta>
        <strong>Revisa lo que falta o está mal:</strong>
        <ul>
          {general && <li>{general}</li>}
          {Object.entries(errores || {}).map(([k, m]) => <li key={k}>{etiqueta(k) ? `${etiqueta(k)}: ` : ''}{m}</li>)}
        </ul>
      </Alerta>
    </div>
  )
}

/* ---------------------------------------------------------------- datos de la solicitud (detalle) */

export function valorLegible(c, v) {
  if (v === undefined || v === null || v === '') return '—'
  if (c.tipo === 'fecha') return fechaCalendario(v)
  if (c.tipo === 'numero') return Number(v).toLocaleString('es-PA')
  return String(v)
}

export function DatosSolicitud({ formulario = [], datos }) {
  return (
    <section className="panel" aria-labelledby="datos-solicitud">
      <h3 id="datos-solicitud">Datos de la solicitud</h3>
      {sinDatos(datos) ? <p className="suave">Este trámite no tiene datos de formulario (se inició antes de esta función).</p> : (
        <dl className="datos datos-solicitud">
          {formulario.map((c) => (
            <div key={c.id} className="dato-fila"><dt>{c.etiqueta}</dt><dd className={c.tipo === 'texto_largo' ? 'texto-largo' : ''}>{valorLegible(c, datos[c.id])}</dd></div>
          ))}
        </dl>
      )}
    </section>
  )
}

/* ---------------------------------------------------------------- motivo del personal */

const AVISO_LA_PERSONA_LO_LEE = 'La persona que pidió el trámite va a leer este motivo'
const TEXTOS_MOTIVO = {
  Rechazado: {
    titulo: 'Rechazar este trámite', peligro: true, etiqueta: 'Confirmar el rechazo',
    texto: 'Es un estado final: después no se puede cambiar. La decisión queda en el historial con tu nombre y la persona verá el motivo.',
    aviso: AVISO_LA_PERSONA_LO_LEE,
  },
  'En Subsanacion': {
    titulo: 'Pedir una subsanación', etiqueta: 'Enviar la solicitud',
    texto: 'Explica qué debe corregir o completar la persona. Lo verá en su trámite y podrá responder y adjuntar documentos.',
    aviso: AVISO_LA_PERSONA_LO_LEE,
  },
  cierre: {
    titulo: 'Cerrar la subsanación', etiqueta: 'Cerrar y pasar a tramitación',
    texto: 'El trámite vuelve a tramitación. Deja constancia de por qué la respuesta de la persona es suficiente.',
    aviso: AVISO_LA_PERSONA_LO_LEE,
  },
  // La persona que presentó el trámite desiste de él (migración 021): no se deshace
  desistir: {
    titulo: 'Desistir del trámite', peligro: true, etiqueta: 'Desistir del trámite',
    texto: 'Esta acción no se puede deshacer: el trámite se cierra, ya no se tramita y no podrás reabrirlo ni adjuntar más documentos. Si lo necesitas más adelante, tendrás que iniciar uno nuevo.',
    aviso: 'El motivo queda en el historial del trámite y lo puede leer el personal de la institución',
  },
  // Las demás transiciones (si se pidiera un motivo): el servidor no lo muestra a la ciudadanía
  interno: {
    titulo: 'Comentar esta decisión', etiqueta: 'Guardar el comentario',
    texto: 'Queda en el historial del trámite, visible solo para el personal de la institución.',
    aviso: 'Este comentario es interno',
  },
}

// El motivo de una decisión. No se cierra hasta que el servidor acepta (`error` lo pone quien llama): si falla, el texto se conserva.
export function ModalMotivo({ clave, error, enviar, cancelar }) {
  useModal(cancelar)
  const [motivo, setMotivo] = useState('')
  const [trabajando, setTrabajando] = useState(false)
  const t = TEXTOS_MOTIVO[clave] || TEXTOS_MOTIVO.interno
  const largo = motivo.trim().length
  async function alEnviar(ev) {
    ev.preventDefault()
    if (largo < MOTIVO_MIN || trabajando) return
    setTrabajando(true)
    try { await enviar(motivo.trim()) } finally { setTrabajando(false) }
  }
  return (
    <div className="fondo-modal">
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="titulo-motivo">
        <h2 id="titulo-motivo"><span className={`icono-grande ${t.peligro ? 'peligro' : ''}`}><Icono nombre={t.peligro ? 'alerta' : 'info'} /></span>{t.titulo}</h2>
        <p className="suave">{t.texto}</p>
        <Alerta tipo="info">{t.aviso}</Alerta>
        <Alerta>{error}</Alerta>
        <form onSubmit={alEnviar} noValidate>
          <CampoTexto etiqueta="Motivo" valor={motivo} cambiar={setMotivo} autoFocus />
          <div className="fila-botones">
            <button type="button" className="btn btn-sec" onClick={cancelar}>Cancelar</button>
            <button type="submit" className={`btn ${t.peligro ? 'btn-peligro' : ''}`} disabled={largo < MOTIVO_MIN || trabajando}>{trabajando ? 'Enviando…' : t.etiqueta}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- respuesta de la ciudadanía */

// Lo que pidió el personal en la última solicitud de subsanación (el servidor lo manda como `motivo` del evento)
export function ultimoMotivoDeSubsanacion(eventos) {
  for (let i = eventos.length - 1; i >= 0; i--) {
    const e = eventos[i]
    if (e.accion === 'cambio_estado' && e.estado_nuevo === 'En Subsanacion') return e.motivo || null
  }
  return null
}

export function ResponderSubsanacion({ tramite, motivo, alResponder }) {
  const { avisar } = useUI()
  const campos = tramite.formulario || []
  const [respuesta, setRespuesta] = useState('')
  const [corregir, setCorregir] = useState(false)
  const [valores, setValores] = useState(() => valoresIniciales(campos, tramite.datos))
  const [errores, setErrores] = useState({})
  const [general, setGeneral] = useState('')
  const [trabajando, setTrabajando] = useState(false)
  const idCorregir = useId()

  async function enviar(ev) {
    ev.preventDefault()
    setGeneral('')
    const nuevos = {}
    const largo = respuesta.trim().length
    if (largo < MOTIVO_MIN) nuevos.respuesta = `Escribe tu respuesta (mínimo ${MOTIVO_MIN} caracteres).`
    if (corregir) Object.assign(nuevos, validarCliente(campos, valores))
    setErrores(nuevos)
    if (Object.keys(nuevos).length) return
    const cuerpo = { respuesta: respuesta.trim() }
    // Los datos se envían completos y solo si cambiaron: así no se reescribe lo que la persona no tocó
    if (corregir) {
      const actuales = armarDatos(campos, valoresIniciales(campos, tramite.datos))
      const nuevosDatos = armarDatos(campos, valores)
      if (JSON.stringify(nuevosDatos) !== JSON.stringify(actuales)) cuerpo.datos = nuevosDatos
    }
    setTrabajando(true)
    try {
      await api(`/tramites/${tramite.id}/subsanacion/`, { metodo: 'POST', cuerpo })
      avisar('Enviaste tu respuesta: el trámite volvió a tramitación.')
      await alResponder()
    } catch (e) {
      const porCampo = erroresDe(e)
      if (porCampo) {
        setErrores(Object.fromEntries(Object.entries(porCampo).filter(([k]) => k === 'respuesta' || campos.some((c) => c.id === k))))
        const generales = Object.entries(porCampo).filter(([k]) => k !== 'respuesta' && !campos.some((c) => c.id === k)).map(([, m]) => m)
        setGeneral(generales.join(' '))
      } else if (e instanceof ApiError && e.estado === 409 && e.codigo === 'no_en_subsanacion') {
        setGeneral('Este trámite ya no está en subsanación.')
        alResponder()
      } else setGeneral(mensajeDe(e))
    } finally {
      setTrabajando(false)
    }
  }

  const cambiarCampo = (id, v) => setValores((x) => ({ ...x, [id]: v }))
  return (
    <section className="panel panel-subsanacion" aria-labelledby="titulo-subsanacion">
      <h3 id="titulo-subsanacion">Responder a la subsanación</h3>
      <div className="motivo-destacado">
        <strong>Lo que pidió la institución</strong>
        {motivo ? <blockquote className="cita-motivo">{motivo}</blockquote> : <p className="suave">La institución no dejó un motivo escrito.</p>}
      </div>
      <p className="nota">Si hace falta un documento, adjúntalo en la sección de documentos, más abajo, y luego envía tu respuesta.</p>
      <form onSubmit={enviar} noValidate aria-label="Responder a la subsanación">
        <ResumenErrores campos={campos} errores={errores} general={general} />
        <CampoTexto etiqueta="Tu respuesta" valor={respuesta} cambiar={setRespuesta} error={errores.respuesta} />
        {campos.length > 0 && (
          <>
            <label className="casilla" htmlFor={idCorregir}>
              <input id={idCorregir} type="checkbox" checked={corregir} onChange={(e) => setCorregir(e.target.checked)} />
              Corregir los datos
            </label>
            {corregir && (
              <fieldset className="datos-corregir">
                <legend>Datos de la solicitud</legend>
                <CamposFormulario campos={campos} valores={valores} cambiar={cambiarCampo} errores={errores} />
              </fieldset>
            )}
          </>
        )}
        <div className="fila-botones inicio">
          <button className="btn" type="submit" disabled={trabajando}>{trabajando ? 'Enviando…' : 'Enviar mi respuesta'}</button>
        </div>
      </form>
    </section>
  )
}
