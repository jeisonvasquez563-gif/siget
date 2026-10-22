import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { api, ApiError, confirmarMfa, iniciarSesion, instituciones, registrar, restablecerContrasena } from './api.js'
import { Alerta, Icono, Logo } from './ui.jsx'

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
      <ul className="garantias">
        <li><Icono nombre="llave" />Segundo factor obligatorio</li>
        <li><Icono nombre="auditoria" />Historial inalterable</li>
        <li><Icono nombre="escudo" />Cada petición se verifica</li>
      </ul>
    </section>
  )
}

// Provincias y comarcas de Panamá. El servidor valida contra su propia lista: esta solo arma el selector.
const PROVINCIAS = [
  'Bocas del Toro', 'Chiriquí', 'Coclé', 'Colón', 'Darién', 'Herrera', 'Los Santos', 'Panamá', 'Panamá Oeste', 'Veraguas',
  'Comarca Guna Yala', 'Comarca Emberá-Wounaan', 'Comarca Ngäbe-Buglé',
]
const PERSONALES_VACIOS = { nombre: '', apellidos: '', cedula: '', fecha_nacimiento: '', provincia: '', ciudad: '', correo: '' }

// Fecha más reciente en la que alguien ya cumplió 18 años (el servidor lo vuelve a comprobar)
function fechaMaximaDeNacimiento() {
  const d = new Date()
  d.setFullYear(d.getFullYear() - 18)
  return d.toISOString().slice(0, 10)
}

const MOTIVOS = {
  inactividad: 'Cerramos tu sesión por inactividad, para proteger tu cuenta. Ingresa de nuevo para continuar.',
  vencida: 'Tu sesión venció o se cerró desde el servidor. Ingresa de nuevo para continuar.',
}

// ---------------------------------------------------------------- las tres puertas

// La puerta vive en la dirección (#/ciudadania, #/institucion/3, #/plataforma): se puede compartir el enlace de cada institución y
// no llega al servidor. No da permisos; el servidor comprueba que la cuenta corresponda a la puerta y decide todo lo demás.
export function puertaDeHash(hash) {
  const h = (hash || '').replace(/^#\/?/, '')
  if (h === 'ciudadania') return { canal: 'ciudadania' }
  if (h === 'plataforma') return { canal: 'plataforma' }
  const m = h.match(/^institucion(?:\/(\d+))?$/)
  if (m) return m[1] ? { canal: 'institucion', institucion_id: Number(m[1]) } : { canal: 'institucion' }
  return null
}

const irA = (hash) => { window.location.hash = hash }

const TEXTOS_FARO = {
  ciudadania: ['Cada trámite, de la entrada a la resolución.', 'Sigue tus gestiones ante el Estado: en qué etapa están, quién las atiende y cuándo vence cada plazo.'],
  institucion: ['Atiende cada trámite de tu institución.', 'Tu bandeja, tus plazos y el historial de cada gestión, con el segundo factor que protege a la ciudadanía y a ti.'],
  plataforma: ['Opera la plataforma sin ver un solo trámite.', 'Cada operador tiene su área, nadie reúne todos los poderes y todo lo que haces queda registrado.'],
}

function Portal({ motivo }) {
  return (
    <main className="acceso">
      <Faro titulo={TEXTOS_FARO.ciudadania[0]} lema={TEXTOS_FARO.ciudadania[1]} />
      <section className="acceso-formulario">
        <div className="tarjeta-acceso ancha">
          <h2>¿Cómo quieres ingresar?</h2>
          <p className="subtitulo">Cada persona entra por su puerta. Así se sabe quién eres y a qué institución perteneces.</p>
          <Alerta tipo="info">{MOTIVOS[motivo]}</Alerta>
          <div className="puertas">
            <button type="button" className="puerta" onClick={() => irA('#/ciudadania')}>
              <Icono nombre="usuario" /><strong>Soy ciudadano o ciudadana</strong>
              <span>Inicia trámites y sigue su estado. Aquí puedes crear tu cuenta.</span>
            </button>
            <button type="button" className="puerta" onClick={() => irA('#/institucion')}>
              <Icono nombre="equipo" /><strong>Soy personal de una institución</strong>
              <span>Funcionarios, supervisión y coordinación: elige tu institución.</span>
            </button>
            <button type="button" className="puerta" onClick={() => irA('#/plataforma')}>
              <Icono nombre="escudo" /><strong>Plataforma y auditoría</strong>
              <span>Operadores de plataforma y personal de auditoría.</span>
            </button>
          </div>
          <div className="pie-acceso"><Icono nombre="escudo" /><span>Conexión cifrada con TLS 1.3. Todas las puertas exigen segundo factor.</span></div>
        </div>
      </section>
    </main>
  )
}

function ElegirInstitucion({ motivo }) {
  const [lista, setLista] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => { instituciones().then(setLista).catch(() => setError('No se pudo cargar la lista de instituciones. Revisa tu conexión.')) }, [])
  return (
    <main className="acceso">
      <Faro titulo={TEXTOS_FARO.institucion[0]} lema={TEXTOS_FARO.institucion[1]} />
      <section className="acceso-formulario">
        <div className="tarjeta-acceso ancha">
          <button type="button" className="enlace-sutil volver-puerta" onClick={() => irA('')}>← Elegir otro acceso</button>
          <h2>¿En qué institución trabajas?</h2>
          <p className="subtitulo">Entrarás con tu usuario de SIGET. Si no tienes acceso, pídelo a la coordinación de tu institución: aquí nadie se registra por su cuenta.</p>
          <Alerta tipo="info">{MOTIVOS[motivo]}</Alerta>
          <Alerta>{error}</Alerta>
          {!lista && !error ? <p className="suave" role="status">Cargando instituciones…</p> : (
            <ul className="lista-instituciones">
              {(lista || []).map((i) => <li key={i.id}><button type="button" className="puerta chica" onClick={() => irA(`#/institucion/${i.id}`)}><Icono nombre="equipo" /><strong>{i.nombre}</strong></button></li>)}
            </ul>
          )}
        </div>
      </section>
    </main>
  )
}

// Decide qué se ve antes de iniciar sesión según la puerta de la dirección
export function Acceso({ alEntrar, motivo = '' }) {
  const [hash, setHash] = useState(window.location.hash)
  const [lista, setLista] = useState(null)
  useEffect(() => {
    const f = () => setHash(window.location.hash)
    window.addEventListener('hashchange', f)
    return () => window.removeEventListener('hashchange', f)
  }, [])
  const puerta = puertaDeHash(hash)
  const necesitaLista = puerta?.canal === 'institucion' && puerta.institucion_id
  useEffect(() => {
    if (necesitaLista) instituciones().then(setLista).catch(() => setLista([]))
  }, [necesitaLista])

  if (!puerta) return <Portal motivo={motivo} />
  if (puerta.canal === 'institucion' && !puerta.institucion_id) return <ElegirInstitucion motivo={motivo} />
  if (puerta.canal === 'institucion') {
    if (!lista) return <main className="acceso"><section className="acceso-formulario" role="status" aria-label="Cargando la institución"><Logo className="marca-logo" /></section></main>
    const institucion = lista.find((i) => i.id === puerta.institucion_id)
    if (!institucion) return <ElegirInstitucion motivo={motivo} />  // el enlace apunta a una institución que no existe
    return <Login alEntrar={alEntrar} motivo={motivo} puerta={{ ...puerta, institucion }} />
  }
  return <Login alEntrar={alEntrar} motivo={motivo} puerta={puerta} />
}

export function Login({ alEntrar, motivo = '', puerta = { canal: 'ciudadania' } }) {
  const [modo, setModo] = useState('entrar')
  const [paso, setPaso] = useState('credenciales') // «codigo»: la contraseña ya la validó el servidor y falta el segundo factor
  const [usuario, setUsuario] = useState('')
  const [clave, setClave] = useState('')
  const [verClave, setVerClave] = useState(false)
  const [codigo, setCodigo] = useState('')
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')
  const [trabajando, setTrabajando] = useState(false)
  const [personales, setPersonales] = useState(PERSONALES_VACIOS)
  const [codigoReset, setCodigoReset] = useState('')
  const [equivocada, setEquivocada] = useState(null) // la cuenta es válida pero corresponde a otra puerta
  const poner = (campo) => (e) => setPersonales((p) => ({ ...p, [campo]: e.target.value }))

  function volver() {
    // Al retroceder se olvida la contraseña y el código: no deben quedar en pantalla ni en memoria más de lo necesario
    setPaso('credenciales'); setClave(''); setCodigo(''); setError(''); setAviso('')
  }

  async function enviar(ev) {
    ev.preventDefault()
    setError('')
    setAviso('')
    setEquivocada(null)
    setTrabajando(true)
    try {
      if (modo === 'recuperar') {
        await restablecerContrasena(usuario, codigoReset, clave)
        setAviso('Contraseña restablecida. Ingresa con tu nueva contraseña y el código de tu aplicación de autenticación.')
        setModo('entrar'); setClave(''); setCodigoReset('')
      } else if (modo === 'registro') {
        await registrar(usuario, clave, { ...personales, cedula: personales.cedula.trim().toUpperCase() })
        try {
          // Cuenta nueva: se entra de inmediato y el servidor guía al alta del segundo factor (QR), sin volver a escribir nada
          await iniciarSesion(usuario, clave, '', puerta)
          setClave(''); setPersonales(PERSONALES_VACIOS)
          await alEntrar()
        } catch {
          setAviso('Tu cuenta está lista. Ingresa con tu usuario y contraseña: te guiaremos para activar el segundo factor.')
          setModo('entrar'); setClave('')
        }
      } else {
        await iniciarSesion(usuario, clave, paso === 'codigo' ? codigo : '', puerta)
        setClave(''); setCodigo('')
        await alEntrar()
      }
    } catch (e) {
      if (e instanceof ApiError && e.codigo === 'mfa_requerido') { setPaso('codigo'); setCodigo('') }
      else if (e instanceof ApiError && e.codigo === 'canal_incorrecto') { setEquivocada(e.datos); setPaso('credenciales'); setClave(''); setCodigo('') }
      else if (e instanceof ApiError && e.datos.errores) setError(`${e.datos.errores.join('. ')}.`)
      else if (e instanceof ApiError && e.codigo === 'codigo_invalido') setError('El código no es válido, ya se usó o venció. Pide uno nuevo al equipo de identidades.')
      else if (e instanceof ApiError && e.estado === 401 && paso === 'codigo') setError('Ese código no sirve: es incorrecto o ya se usó. Espera al siguiente e inténtalo otra vez. Tras 3 fallos la cuenta se bloquea (5, 15 y luego 60 minutos).')
      else if (e instanceof ApiError && e.estado === 401) setError('Usuario o contraseña incorrectos, o la cuenta está bloqueada temporalmente.')
      else if (e instanceof ApiError && e.estado === 409) setError('No se pudo crear la cuenta con esos datos. Prueba con otro usuario.')
      else if (e instanceof ApiError && e.estado === 429) setError('Demasiados intentos. Espera un minuto e inténtalo de nuevo.')
      else setError('No se pudo conectar con el servidor. Revisa tu conexión.')
    } finally {
      setTrabajando(false)
    }
  }

  const registro = modo === 'registro'
  const recuperar = modo === 'recuperar'
  const pideCodigo = !registro && !recuperar && paso === 'codigo'
  const esCiudadania = puerta.canal === 'ciudadania'
  const nombreDePuerta = puerta.canal === 'institucion' ? `Personal de ${puerta.institucion.nombre}` : puerta.canal === 'plataforma' ? 'Acceso de plataforma' : 'Ingresa a tu cuenta'
  const titulo = recuperar ? 'Recupera tu contraseña' : registro ? 'Crea tu cuenta' : pideCodigo ? 'Verifica que eres tú' : nombreDePuerta
  const subtitulo = recuperar ? 'Pide un código de un solo uso al equipo de identidades de SIGET (por un canal seguro) y úsalo aquí para elegir una contraseña nueva. Tu segundo factor sigue siendo necesario.' : registro ? 'Elige un usuario y una contraseña larga que solo tú conozcas. Después activarás un segundo factor con tu teléfono.'
    : pideCodigo ? `Hola, ${usuario}. Abre tu aplicación de autenticación y escribe el código de 6 dígitos que muestra.`
    : puerta.canal === 'institucion' ? `Acceso para funcionarios, supervisión y coordinación de ${puerta.institucion.nombre}. Si tu cuenta tiene segundo factor, te pediremos el código en el siguiente paso.`
    : puerta.canal === 'plataforma' ? 'Solo para operadores de plataforma y personal de auditoría. Te pediremos el código de tu segundo factor en el siguiente paso.'
    : 'Usa tu usuario y tu contraseña. Si tu cuenta tiene segundo factor, te pediremos el código en el siguiente paso.'
  return (
    <main className="acceso">
      <Faro titulo={TEXTOS_FARO[puerta.canal][0]} lema={TEXTOS_FARO[puerta.canal][1]} />
      <section className="acceso-formulario">
        <div className={`tarjeta-acceso ${registro ? 'ancha' : ''}`}>
          {!registro && !recuperar && !pideCodigo && <button type="button" className="enlace-sutil volver-puerta" onClick={() => irA(puerta.canal === 'institucion' ? '#/institucion' : '')}>{puerta.canal === 'institucion' ? '← Elegir otra institución' : '← Elegir otro acceso'}</button>}
          <h2>{titulo}</h2>
          <p className="subtitulo">{subtitulo}</p>
          <form onSubmit={enviar} autoComplete="on">
            <Alerta tipo="info">{MOTIVOS[motivo]}</Alerta>
            {equivocada && (
              <Alerta>
                <strong>Tu cuenta es válida, pero no corresponde a este acceso.</strong>{' '}
                {equivocada.acceso_correcto === 'institucion' && <>Eres personal de {equivocada.instituciones.join(' y ')}: entra por «Personal de una institución».</>}
                {equivocada.acceso_correcto === 'plataforma' && <>Tu cuenta es de plataforma o auditoría: entra por «Plataforma y auditoría».</>}
                {equivocada.acceso_correcto === 'ciudadania' && <>Esta es una cuenta de ciudadanía: entra por «Soy ciudadano o ciudadana».</>}
                {' '}<button type="button" className="enlace-sutil" onClick={() => irA(equivocada.acceso_correcto === 'institucion' ? '#/institucion' : equivocada.acceso_correcto === 'plataforma' ? '#/plataforma' : '#/ciudadania')}>Ir a mi acceso</button>
              </Alerta>
            )}
            <Alerta>{error}</Alerta>
            <Alerta tipo="ok">{aviso}</Alerta>
            {recuperar && (
              <>
                <label className="campo"><span>Usuario</span>
                  <input className="entrada" value={usuario} onChange={(e) => setUsuario(e.target.value)} autoComplete="username" autoCapitalize="none" spellCheck="false" required autoFocus />
                </label>
                <label className="campo"><span>Código de restablecimiento</span>
                  <input className="entrada entrada-codigo" value={codigoReset} onChange={(e) => setCodigoReset(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 14))} placeholder="XXXX-XXXX-XXXX" autoComplete="off" spellCheck="false" required minLength={12} />
                  <small>Vale 15 minutos y una sola vez.</small>
                </label>
                <label className="campo"><span>Contraseña nueva</span>
                  <input className="entrada" type={verClave ? 'text' : 'password'} value={clave} onChange={(e) => setClave(e.target.value)} autoComplete="new-password" minLength={12} aria-describedby="ayuda-clave" required />
                  <small><button type="button" className="enlace-sutil" onClick={() => setVerClave(!verClave)}>{verClave ? 'Ocultar contraseña' : 'Mostrar contraseña'}</button></small>
                </label>
                <p id="ayuda-clave" className="suave ayuda-clave">Mínimo 12 caracteres; no uses tu nombre de usuario ni una contraseña común.</p>
              </>
            )}
            {registro && (
              <fieldset className="datos-personales">
                <legend>Tus datos</legend>
                <label className="campo"><span>Nombre</span>
                  <input className="entrada" value={personales.nombre} onChange={poner('nombre')} autoComplete="given-name" maxLength={60} required autoFocus />
                </label>
                <label className="campo"><span>Apellidos</span>
                  <input className="entrada" value={personales.apellidos} onChange={poner('apellidos')} autoComplete="family-name" maxLength={80} required />
                </label>
                <label className="campo"><span>Cédula</span>
                  <input className="entrada" value={personales.cedula} onChange={poner('cedula')} placeholder="8-123-456" inputMode="text" autoComplete="off" spellCheck="false" maxLength={20} required />
                  <small>Con guiones, por ejemplo 8-123-456 o PE-12-345. Se guarda cifrada.</small>
                </label>
                <label className="campo"><span>Fecha de nacimiento</span>
                  <input className="entrada" type="date" value={personales.fecha_nacimiento} onChange={poner('fecha_nacimiento')} autoComplete="bday" min="1900-01-01" max={fechaMaximaDeNacimiento()} required />
                  <small>Debes ser mayor de 18 años.</small>
                </label>
                <label className="campo"><span>Provincia</span>
                  <select className="entrada" value={personales.provincia} onChange={poner('provincia')} autoComplete="address-level1" required>
                    <option value="">Elige una provincia</option>
                    {PROVINCIAS.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </label>
                <label className="campo"><span>Ciudad</span>
                  <input className="entrada" value={personales.ciudad} onChange={poner('ciudad')} autoComplete="address-level2" maxLength={60} required />
                </label>
                <label className="campo ancho-completo"><span>Correo electrónico</span>
                  <input className="entrada" type="email" value={personales.correo} onChange={poner('correo')} autoComplete="email" inputMode="email" spellCheck="false" maxLength={254} required />
                </label>
              </fieldset>
            )}
            {registro && <h3 className="subtitulo-form">Tu acceso</h3>}
            {!pideCodigo && !recuperar && (
              <>
                <label className="campo">
                  <span>Usuario</span>
                  <input className="entrada" value={usuario} onChange={(e) => setUsuario(e.target.value)} autoComplete="username" autoCapitalize="none" spellCheck="false" required autoFocus={!registro} />
                </label>
                <label className="campo">
                  <span>Contraseña</span>
                  <input className="entrada" type={verClave ? 'text' : 'password'} value={clave} onChange={(e) => setClave(e.target.value)} autoComplete={registro ? 'new-password' : 'current-password'} minLength={registro ? 12 : undefined} aria-describedby={registro ? 'ayuda-clave' : undefined} required />
                  <small><button type="button" className="enlace-sutil" onClick={() => setVerClave(!verClave)}>{verClave ? 'Ocultar contraseña' : 'Mostrar contraseña'}</button></small>
                </label>
                {registro && <p id="ayuda-clave" className="suave ayuda-clave">Mínimo 12 caracteres; no uses tu nombre de usuario ni una contraseña común.</p>}
              </>
            )}
            {pideCodigo && (
              <label className="campo">
                <span>Código del autenticador</span>
                <input className="entrada entrada-codigo" value={codigo} onChange={(e) => setCodigo(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" placeholder="000000" required minLength={6} autoFocus />
                <small>El código cambia cada 30 segundos y solo sirve una vez.</small>
              </label>
            )}
            <button type="submit" className="btn btn-ancho" disabled={trabajando}>
              {trabajando ? 'Verificando…' : recuperar ? 'Restablecer contraseña' : registro ? 'Crear cuenta' : pideCodigo ? 'Verificar' : 'Continuar'}
            </button>
            {pideCodigo && <button type="button" className="btn btn-sec btn-ancho" onClick={volver}>Volver</button>}
          </form>
          {!registro && !pideCodigo && !recuperar && <p className="cambio-modo"><button type="button" onClick={() => { setModo('recuperar'); setError(''); setAviso(''); setClave('') }}>¿Olvidaste tu contraseña?</button></p>}
          {recuperar && <p className="cambio-modo"><button type="button" onClick={() => { setModo('entrar'); setError(''); setClave(''); setCodigoReset('') }}>Volver a ingresar</button></p>}
          {!pideCodigo && !recuperar && !esCiudadania && <p className="nota-sin-registro">¿No tienes acceso? Pídelo a la coordinación de tu institución: en esta puerta no se crean cuentas.</p>}
          {!pideCodigo && !recuperar && esCiudadania && (
            <div className="alta-cuenta">
              <span>{registro ? '¿Ya tienes cuenta?' : '¿Primera vez en SIGET?'}</span>
              <button type="button" className="btn btn-sec btn-ancho" onClick={() => { setModo(registro ? 'entrar' : 'registro'); setError(''); setAviso(''); setClave('') }}>
                {registro ? 'Ingresar con mi cuenta' : 'Crear una cuenta'}
              </button>
            </div>
          )}
          {!registro && !recuperar && <p className="aviso-bloqueo"><Icono nombre="llave" />Por tu seguridad, tras 3 intentos fallidos (contraseña o código) la cuenta se bloquea: 5 minutos la primera vez, 15 la segunda y 60 las siguientes. Un inicio de sesión correcto reinicia la cuenta.</p>}
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
