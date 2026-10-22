import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { api, ApiError, confirmarMfa, iniciarSesion, registrar } from './api.js'
import { Alerta } from './comun.jsx'

export function Login({ alEntrar }) {
  const [modo, setModo] = useState('entrar')
  const [usuario, setUsuario] = useState('')
  const [clave, setClave] = useState('')
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
        setAviso('Cuenta creada. Ahora inicia sesión: te pediremos activar el segundo factor.')
        setModo('entrar')
        setClave('')
      } else {
        await iniciarSesion(usuario, clave, codigo)
        await alEntrar()
      }
    } catch (e) {
      if (e instanceof ApiError && e.codigo === 'mfa_requerido') setError('Falta el código de 6 dígitos de tu aplicación de autenticación.')
      else if (e instanceof ApiError && e.datos.errores) setError(e.datos.errores.join('. ') + '.')
      else if (e instanceof ApiError && e.estado === 401) setError('Credenciales inválidas o cuenta bloqueada temporalmente.')
      else if (e instanceof ApiError && e.estado === 409) setError('No se pudo crear la cuenta con esos datos.')
      else if (e instanceof ApiError && e.estado === 429) setError('Demasiados intentos. Espera un minuto.')
      else setError('No se pudo conectar con el servidor.')
    } finally {
      setTrabajando(false)
    }
  }

  return (
    <main className="acceso">
      <section className="tarjeta-acceso">
        <div className="marca">
          <span className="logo" aria-hidden="true">S</span>
          <div>
            <h1>SIGET</h1>
            <p>Sistema de Gestión y Trazabilidad de Trámites</p>
          </div>
        </div>
        <div className="pestanas" role="tablist">
          <button role="tab" aria-selected={modo === 'entrar'} className={modo === 'entrar' ? 'activa' : ''} onClick={() => setModo('entrar')} type="button">Iniciar sesión</button>
          <button role="tab" aria-selected={modo === 'registro'} className={modo === 'registro' ? 'activa' : ''} onClick={() => setModo('registro')} type="button">Crear cuenta</button>
        </div>
        <form onSubmit={enviar} autoComplete="on">
          <Alerta>{error}</Alerta>
          <Alerta tipo="ok">{aviso}</Alerta>
          <label>
            Usuario
            <input value={usuario} onChange={(e) => setUsuario(e.target.value)} autoComplete="username" autoCapitalize="none" required autoFocus />
          </label>
          <label>
            Contraseña
            <input type="password" value={clave} onChange={(e) => setClave(e.target.value)} autoComplete={modo === 'registro' ? 'new-password' : 'current-password'} required />
          </label>
          {modo === 'entrar' && (
            <label>
              Código del autenticador (6 dígitos)
              <input value={codigo} onChange={(e) => setCodigo(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" placeholder="Déjalo vacío si aún no activaste el segundo factor" />
            </label>
          )}
          <button type="submit" disabled={trabajando}>{modo === 'registro' ? 'Crear cuenta' : 'Entrar'}</button>
        </form>
        <p className="nota">Conexión protegida con TLS 1.3. El acceso exige segundo factor (TOTP) y cada petición se autoriza de nuevo: nunca confiar, siempre verificar.</p>
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
    api('/auth/mfa/enrolar/', { metodo: 'POST', cuerpo: {} }).then(setDatos).catch((e) => setError(e instanceof ApiError && e.estado === 409 ? 'El segundo factor ya está activo.' : 'No se pudo iniciar el enrolamiento.'))
  }, [])

  useEffect(() => {
    if (datos && lienzo.current) QRCode.toCanvas(lienzo.current, datos.uri, { width: 220, margin: 1 })
  }, [datos])

  async function confirmar(ev) {
    ev.preventDefault()
    setError('')
    try {
      await confirmarMfa(codigo)
      await alTerminar()
    } catch (e) {
      setError(e instanceof ApiError && e.estado === 400 ? 'Código inválido o ya usado. Prueba con el siguiente.' : 'No se pudo confirmar.')
    }
  }

  return (
    <main className="acceso">
      <section className="tarjeta-acceso">
        <h1>Activa tu segundo factor</h1>
        <p>Hola, <strong>{usuario}</strong>. Tu rol exige verificación en dos pasos antes de usar la plataforma.</p>
        <ol className="pasos">
          <li>Abre tu aplicación de autenticación (Google Authenticator, Microsoft Authenticator, Aegis…).</li>
          <li>Escanea este código QR (o escribe la clave a mano).</li>
          <li>Escribe el código de 6 dígitos que muestra la aplicación.</li>
        </ol>
        <Alerta>{error}</Alerta>
        {datos ? (
          <div className="qr">
            <canvas ref={lienzo} width="220" height="220" aria-label="Código QR para la aplicación de autenticación" />
            <p className="clave">Clave manual: <code>{datos.secreto}</code></p>
          </div>
        ) : !error && <p className="cargando">Generando tu secreto…</p>}
        <form onSubmit={confirmar}>
          <label>
            Código de 6 dígitos
            <input value={codigo} onChange={(e) => setCodigo(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" autoFocus />
          </label>
          <div className="fila-botones">
            <button type="button" className="secundario" onClick={alSalir}>Salir</button>
            <button type="submit" disabled={codigo.length !== 6 || !datos}>Activar</button>
          </div>
        </form>
        <p className="nota">El secreto se muestra una sola vez; después solo existe cifrado en la base de datos.</p>
      </section>
    </main>
  )
}
