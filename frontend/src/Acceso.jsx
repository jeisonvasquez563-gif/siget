import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { api, ApiError, confirmarMfa, iniciarSesion, registrar } from './api.js'
import { Alerta, Esclusas, Icono, Logo } from './ui.jsx'

function Faro({ titulo, lema, ilustracion = true }) {
  return (
    <section className="acceso-faro">
      <div className="marca">
        <Logo />
        <div><strong>SIGET</strong><small>Sistema de Gestión y Trazabilidad</small></div>
      </div>
      <div>
        <span className="eyebrow">Trámites del Estado · Panamá</span>
        <h1>{titulo}</h1>
        <p className="lema">{lema}</p>
      </div>
      {ilustracion && <div className="acceso-ilustracion"><Esclusas estado="En Tramitacion" decorativo /></div>}
      <ul className="garantias">
        <li><Icono nombre="llave" />Segundo factor obligatorio</li>
        <li><Icono nombre="auditoria" />Historial inalterable</li>
        <li><Icono nombre="escudo" />Cada petición se verifica</li>
      </ul>
    </section>
  )
}

const MOTIVOS = {
  inactividad: 'Cerramos tu sesión por inactividad, para proteger tu cuenta. Ingresa de nuevo para continuar.',
  vencida: 'Tu sesión venció o se cerró desde el servidor. Ingresa de nuevo para continuar.',
}

export function Login({ alEntrar, motivo = '' }) {
  const [modo, setModo] = useState('entrar')
  const [usuario, setUsuario] = useState('')
  const [clave, setClave] = useState('')
  const [verClave, setVerClave] = useState(false)
  const [codigo, setCodigo] = useState('')
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')
  const [trabajando, setTrabajando] = useState(false)

  async function enviar(ev) {
    ev.preventDefault()
    setError('')
    setAviso('')
    setTrabajando(true)
    try {
      if (modo === 'registro') {
        await registrar(usuario, clave)
        setAviso('Tu cuenta está lista. Ingresa con tu usuario y contraseña: te guiaremos para activar el segundo factor.')
        setModo('entrar')
        setClave('')
      } else {
        await iniciarSesion(usuario, clave, codigo)
        await alEntrar()
      }
    } catch (e) {
      if (e instanceof ApiError && e.codigo === 'mfa_requerido') setError('Escribe el código de 6 dígitos de tu aplicación de autenticación.')
      else if (e instanceof ApiError && e.datos.errores) setError(`${e.datos.errores.join('. ')}.`)
      else if (e instanceof ApiError && e.estado === 401) setError('Usuario, contraseña o código incorrectos, o la cuenta está bloqueada unos minutos.')
      else if (e instanceof ApiError && e.estado === 409) setError('No se pudo crear la cuenta con esos datos. Prueba con otro usuario.')
      else if (e instanceof ApiError && e.estado === 429) setError('Demasiados intentos. Espera un minuto e inténtalo de nuevo.')
      else setError('No se pudo conectar con el servidor. Revisa tu conexión.')
    } finally {
      setTrabajando(false)
    }
  }

  const registro = modo === 'registro'
  return (
    <main className="acceso">
      <Faro titulo="Cada trámite, de la entrada a la resolución." lema="Sigue tus gestiones ante el Estado: en qué etapa están, quién las atiende y cuándo vence cada plazo." />
      <section className="acceso-formulario">
        <div className="tarjeta-acceso">
          <h2>{registro ? 'Crea tu cuenta' : 'Ingresa a tu cuenta'}</h2>
          <p className="subtitulo">{registro ? 'Elige un usuario y una contraseña larga que solo tú conozcas.' : 'Usa tu usuario, tu contraseña y el código de tu aplicación de autenticación.'}</p>
          <form onSubmit={enviar} autoComplete="on">
            <Alerta tipo="info">{MOTIVOS[motivo]}</Alerta>
            <Alerta>{error}</Alerta>
            <Alerta tipo="ok">{aviso}</Alerta>
            <label className="campo">
              <span>Usuario</span>
              <input className="entrada" value={usuario} onChange={(e) => setUsuario(e.target.value)} autoComplete="username" autoCapitalize="none" spellCheck="false" required autoFocus />
            </label>
            <label className="campo">
              <span>Contraseña</span>
              <input className="entrada" type={verClave ? 'text' : 'password'} value={clave} onChange={(e) => setClave(e.target.value)} autoComplete={registro ? 'new-password' : 'current-password'} required />
              <small><button type="button" className="enlace-sutil" onClick={() => setVerClave(!verClave)}>{verClave ? 'Ocultar contraseña' : 'Mostrar contraseña'}</button></small>
            </label>
            {!registro && (
              <label className="campo">
                <span>Código del autenticador</span>
                <input className="entrada entrada-codigo" value={codigo} onChange={(e) => setCodigo(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" placeholder="000000" />
                <small>¿Aún no activas el segundo factor? Déjalo vacío: te guiaremos al entrar.</small>
              </label>
            )}
            <button type="submit" className="btn btn-ancho" disabled={trabajando}>{trabajando ? 'Verificando…' : registro ? 'Crear cuenta' : 'Ingresar'}</button>
          </form>
          <p className="cambio-modo">
            {registro ? '¿Ya tienes cuenta? ' : '¿Primera vez aquí? '}
            <button type="button" onClick={() => { setModo(registro ? 'entrar' : 'registro'); setError(''); setAviso('') }}>{registro ? 'Ingresa' : 'Crea tu cuenta'}</button>
          </p>
          <div className="pie-acceso"><Icono nombre="escudo" /><span>Conexión cifrada con TLS 1.3. Nunca guardamos tu contraseña: solo una huella irreversible.</span></div>
        </div>
      </section>
    </main>
  )
}

export function EnrolarMfa({ usuario, alTerminar, alSalir }) {
  const [datos, setDatos] = useState(null)
  const [codigo, setCodigo] = useState('')
  const [error, setError] = useState('')
  const lienzo = useRef(null)
  const pedido = useRef(false)

  useEffect(() => {
    if (pedido.current) return
    pedido.current = true
    api('/auth/mfa/enrolar/', { metodo: 'POST', cuerpo: {} }).then(setDatos).catch((e) => setError(e instanceof ApiError && e.estado === 409 ? 'El segundo factor ya está activo en tu cuenta.' : 'No se pudo iniciar el alta. Intenta de nuevo.'))
  }, [])

  useEffect(() => {
    if (datos && lienzo.current) QRCode.toCanvas(lienzo.current, datos.uri, { width: 200, margin: 1 })
  }, [datos])

  async function confirmar(ev) {
    ev.preventDefault()
    setError('')
    try {
      await confirmarMfa(codigo)
      await alTerminar()
    } catch (e) {
      setError(e instanceof ApiError && e.estado === 400 ? 'Ese código no sirve: es incorrecto o ya se usó. Espera al siguiente e inténtalo otra vez.' : 'No se pudo confirmar. Intenta de nuevo.')
    }
  }

  return (
    <main className="acceso">
      <Faro titulo="Un paso más para proteger tu cuenta." lema="Tu rol exige verificación en dos pasos: además de tu contraseña, un código que cambia cada 30 segundos." ilustracion={false} />
      <section className="acceso-formulario">
        <div className="tarjeta-acceso">
          <h2>Activa el segundo factor</h2>
          <p className="subtitulo">Hola, <strong>{usuario}</strong>. Solo se hace una vez.</p>
          <ol className="pasos">
            <li>Abre tu aplicación de autenticación (Google Authenticator, Microsoft Authenticator, Aegis…).</li>
            <li>Escanea el código QR, o escribe la clave a mano.</li>
            <li>Escribe aquí el código de 6 dígitos que muestra la aplicación.</li>
          </ol>
          <Alerta>{error}</Alerta>
          {datos ? (
            <div className="qr">
              <canvas ref={lienzo} width="200" height="200" aria-label="Código QR para tu aplicación de autenticación" />
              <p className="clave">Clave manual: <code>{datos.secreto}</code></p>
            </div>
          ) : !error && <p className="suave">Generando tu secreto…</p>}
          <form onSubmit={confirmar}>
            <label className="campo">
              <span>Código de 6 dígitos</span>
              <input className="entrada entrada-codigo" value={codigo} onChange={(e) => setCodigo(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" placeholder="000000" autoFocus />
            </label>
            <div className="fila-botones">
              <button type="button" className="btn btn-sec" onClick={alSalir}>Salir</button>
              <button type="submit" className="btn" disabled={codigo.length !== 6 || !datos}>Activar y entrar</button>
            </div>
          </form>
          <div className="pie-acceso"><Icono nombre="llave" /><span>El secreto se muestra una sola vez; después solo existe cifrado en la base de datos.</span></div>
        </div>
      </section>
    </main>
  )
}
