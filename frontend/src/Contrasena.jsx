import { useState } from 'react'
import { api, ApiError } from './api.js'
import { mensajeDe, useReautenticacion } from './comun.jsx'
import { Alerta, Insignia } from './ui.jsx'

// «Cambiar la contraseña» dentro de «Mi seguridad». La contraseña nunca se guarda en el navegador: vive en el estado del formulario
// y se borra al terminar. El servidor es quien decide: exige un segundo factor reciente (el modal de siempre lo pide) y la contraseña
// actual; al cambiarla cierra las demás sesiones de la cuenta y esta sigue abierta.

const MINIMO = 12
const MAXIMO = 128

function mensaje(e) {
  if (e instanceof ApiError) {
    const d = e.datos || {}
    if (e.estado === 400 && Array.isArray(d.errores) && d.errores.length) return `La contraseña nueva ${d.errores.join(', ')}.`
    // Respuesta genérica a propósito: no distingue una contraseña actual incorrecta de una cuenta bloqueada
    if (e.estado === 400 && d.codigo === 'credenciales_invalidas') return 'La contraseña actual no es correcta, o tu cuenta está bloqueada unos minutos por demasiados intentos. Inténtalo de nuevo más tarde.'
    if (e.estado === 429) return 'Hiciste demasiados intentos de cambio en la última hora. Espera un rato antes de intentarlo otra vez.'
  }
  return mensajeDe(e)
}

function validar({ actual, nueva, repetida }, usuario) {
  const errores = {}
  if (!actual) errores.actual = 'Escribe tu contraseña actual.'
  if (nueva.length < MINIMO) errores.nueva = `Debe tener al menos ${MINIMO} caracteres.`
  else if (nueva.length > MAXIMO) errores.nueva = `Debe tener como máximo ${MAXIMO} caracteres.`
  else if (usuario && nueva.toLowerCase().includes(usuario.toLowerCase())) errores.nueva = 'No puede contener tu nombre de usuario.'
  else if (actual && nueva === actual) errores.nueva = 'Debe ser distinta de la actual.'
  if (!errores.nueva && repetida !== nueva) errores.repetida = 'No coincide con la contraseña nueva.'
  return errores
}

export function CambiarContrasena({ yo }) {
  const { ejecutar, modal } = useReautenticacion()
  const [form, setForm] = useState({ actual: '', nueva: '', repetida: '' })
  const [errores, setErrores] = useState({})
  const [error, setError] = useState('')
  const [hecho, setHecho] = useState(null)
  const [trabajando, setTrabajando] = useState(false)
  const poner = (campo) => (e) => setForm((f) => ({ ...f, [campo]: e.target.value }))

  async function enviar(ev) {
    ev.preventDefault()
    setError('')
    setHecho(null)
    const locales = validar(form, yo.usuario)
    setErrores(locales)
    if (Object.keys(locales).length) return
    const cuerpo = { actual: form.actual, nueva: form.nueva }
    setTrabajando(true)
    try {
      await ejecutar(async () => {
        try {
          const r = await api('/auth/contrasena/', { metodo: 'POST', cuerpo })
          setHecho({ cerradas: r.sesiones_cerradas ?? 0 })
          setForm({ actual: '', nueva: '', repetida: '' }) // ninguna contraseña queda en pantalla
        } catch (e) {
          if (e instanceof ApiError && e.pideReautenticar) throw e // el modal pide el código y repite este mismo cambio
          setError(mensaje(e))
        }
      })
    } finally {
      setTrabajando(false)
    }
  }

  const campo = (id, etiqueta, autocompletar, ayuda) => (
    <label className={`campo ${errores[id] ? 'con-error' : ''}`}>
      <span>{etiqueta}</span>
      <input className="entrada" type="password" value={form[id]} onChange={poner(id)} autoComplete={autocompletar} required
        aria-invalid={errores[id] ? 'true' : undefined} aria-describedby={[ayuda, errores[id] && `${id}-error`].filter(Boolean).join(' ') || undefined} />
      {errores[id] && <small id={`${id}-error`} className="error-campo">{errores[id]}</small>}
    </label>
  )

  return (
    <section className="panel" aria-labelledby="titulo-cambiar-clave">
      {modal}
      <div className="panel-cabecera"><h3 id="titulo-cambiar-clave">Cambiar la contraseña</h3><Insignia clase="insignia-rol" punto={false}>Pide tu segundo factor</Insignia></div>
      <p id="ayuda-cambiar-clave" className="suave">
        Al menos {MINIMO} caracteres (hasta {MAXIMO}). No puede contener tu nombre de usuario, ser una contraseña común ni una secuencia previsible, y debe ser distinta de la actual.
      </p>
      <form onSubmit={enviar} aria-label="Cambiar la contraseña" noValidate>
        <Alerta>{error}</Alerta>
        {campo('actual', 'Contraseña actual', 'current-password')}
        {campo('nueva', 'Contraseña nueva', 'new-password', 'ayuda-cambiar-clave')}
        {campo('repetida', 'Repite la contraseña nueva', 'new-password')}
        <button type="submit" className="btn" disabled={trabajando}>{trabajando ? 'Cambiando…' : 'Cambiar la contraseña'}</button>
      </form>
      {hecho && (
        <div className="separado">
          <Alerta tipo="ok">
            Tu contraseña se cambió.{' '}
            {hecho.cerradas > 0
              ? `Cerramos ${hecho.cerradas === 1 ? 'la otra sesión abierta' : `las otras ${hecho.cerradas} sesiones abiertas`} de tu cuenta; esta sigue abierta.`
              : 'No había otras sesiones abiertas; esta sigue abierta.'}
          </Alerta>
        </div>
      )}
    </section>
  )
}
