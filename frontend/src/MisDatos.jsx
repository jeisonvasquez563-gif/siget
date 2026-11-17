import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from './api.js'
import { PROVINCIAS, fecha, fechaCorta, hace, mensajeDe, useReautenticacion } from './comun.jsx'
import { Alerta, BloquesEsqueleto, Icono, Insignia, Vacio, useUI } from './ui.jsx'

// «Mis datos»: lo que la persona puede hacer con sus datos personales (Ley 81 de 2019): verlos, corregir los de contacto, descargarlos
// y pedir una rectificación, cancelación u oposición. Todo es sobre la propia cuenta; el servidor decide (y vuelve a decidir) cada cosa.
// Cancelar no borra nada automáticamente: los trámites son expediente público con conservación obligatoria.

const TIPOS = {
  rectificacion: ['Rectificación', 'Corregir un dato que no puedo cambiar yo (nombre, apellidos, cédula o fecha de nacimiento)'],
  cancelacion: ['Cancelación', 'Pedir que se eliminen mis datos'],
  oposicion: ['Oposición', 'Oponerme a un uso de mis datos'],
}
const ESTADOS = { recibida: ['e-pendiente', 'Recibida'], atendida: ['e-aprobado', 'Atendida'], rechazada: ['e-rechazado', 'Rechazada'] }
const CAMPOS = ['correo', 'provincia', 'ciudad']
const DETALLE_MIN = 10
const DETALLE_MAX = 1000

function mensaje(e) {
  if (e instanceof ApiError) {
    const d = e.datos || {}
    if (Array.isArray(d.errores) && d.errores.length) return `${d.errores.join('. ')}.`
    // Un correo repetido responde igual que en el registro: no se dice de quién es
    if (e.estado === 409 && d.codigo === 'usuario_existente') return 'No se pudo guardar el cambio con esos datos. Prueba con otro correo.'
    if ((e.estado === 400 || e.estado === 404 || e.estado === 409) && d.detalle) return d.detalle
  }
  return mensajeDe(e)
}

// «1992-03-14» es una fecha sin hora: se arma en la zona local para que no se corra un día (new Date('1992-03-14') es medianoche UTC)
function soloFecha(iso) {
  const [a, m, d] = String(iso).split('-').map(Number)
  return new Date(a, m - 1, d).toLocaleDateString('es-PA', { day: 'numeric', month: 'long', year: 'numeric' })
}

// Descarga el documento que ya trajo la API (con el token en memoria): no hay una dirección que se pueda compartir ni abrir sin sesión
function guardarComoArchivo(documento, nombre) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(documento, null, 2)], { type: 'application/json' }))
  const enlace = document.createElement('a')
  enlace.href = url
  enlace.download = nombre
  document.body.appendChild(enlace)
  enlace.click()
  enlace.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/* ---------------------------------------------------------------- tu perfil */

function Perfil({ perfil, tramites }) {
  if (!perfil) {
    return (
      <section className="panel">
        <div className="panel-cabecera"><h3>Tus datos personales</h3></div>
        <Vacio titulo="Esta cuenta no tiene datos personales guardados" texto="Las cuentas que no se crearon con el registro de la ciudadanía no tienen un perfil de persona." />
      </section>
    )
  }
  const filas = [
    ['Nombre', perfil.nombre], ['Apellidos', perfil.apellidos], ['Cédula', perfil.cedula], ['Fecha de nacimiento', soloFecha(perfil.fecha_nacimiento)],
    ['Provincia', perfil.provincia], ['Ciudad', perfil.ciudad], ['Correo electrónico', perfil.correo],
  ]
  return (
    <section className="panel">
      <div className="panel-cabecera"><h3>Tus datos personales</h3><Insignia clase="insignia-rol" punto={false}>Solo tú los ves</Insignia></div>
      <dl className="datos">
        {filas.map(([etiqueta, valor]) => <div key={etiqueta} className="dato-fila"><dt>{etiqueta}</dt><dd>{valor ?? '—'}</dd></div>)}
      </dl>
      <p className="nota">Cuenta creada el {fechaCorta(perfil.creado_en)}. {perfil.actualizado_en ? `Último cambio de tus datos de contacto: ${fecha(perfil.actualizado_en)}` : 'No has cambiado tus datos de contacto.'}</p>
      <p className="nota">Tienes {tramites.total} {tramites.total === 1 ? 'trámite' : 'trámites'}. Los trámites son expediente público con conservación obligatoria: no se borran, tampoco si pides cancelar tus datos.</p>
    </section>
  )
}

/* ---------------------------------------------------------------- corregir */

function Corregir({ perfil, alCambiar }) {
  const { ejecutar, modal } = useReautenticacion()
  const { avisar } = useUI()
  const [form, setForm] = useState({ correo: perfil.correo, provincia: perfil.provincia, ciudad: perfil.ciudad })
  const [error, setError] = useState('')
  const [trabajando, setTrabajando] = useState(false)
  const poner = (campo) => (e) => setForm((f) => ({ ...f, [campo]: e.target.value }))

  async function guardar(ev) {
    ev.preventDefault()
    setError('')
    // Solo se envía lo que cambió: el servidor registra los NOMBRES de los campos corregidos
    const cambios = Object.fromEntries(CAMPOS.map((c) => [c, form[c].trim()]).filter(([c, v]) => v !== perfil[c]))
    if (Object.keys(cambios).length === 0) { setError('No cambiaste ningún dato.'); return }
    setTrabajando(true)
    try {
      await ejecutar(async () => {
        try {
          const r = await api('/auth/mis-datos/', { metodo: 'PATCH', cuerpo: cambios })
          avisar(r.campos_cambiados.length ? 'Tus datos se actualizaron.' : 'No había nada que cambiar.')
          await alCambiar()
        } catch (e) {
          if (e instanceof ApiError && e.pideReautenticar) throw e // el modal pide el código y repite esta misma acción
          setError(mensaje(e))
        }
      })
    } finally {
      setTrabajando(false)
    }
  }

  return (
    <section className="panel">
      {modal}
      <div className="panel-cabecera"><h3>Corregir mis datos de contacto</h3><Insignia clase="insignia-rol" punto={false}>Pide tu segundo factor</Insignia></div>
      <p className="suave">Puedes corregir tú mismo tu correo, tu provincia y tu ciudad. Para cambiar tu nombre, tus apellidos, tu cédula o tu fecha de nacimiento, envía una solicitud de rectificación (más abajo).</p>
      <form onSubmit={guardar} aria-label="Corregir mis datos de contacto">
        <Alerta>{error}</Alerta>
        <div className="datos-contacto">
          <label className="campo"><span>Correo electrónico</span>
            <input className="entrada" type="email" value={form.correo} onChange={poner('correo')} autoComplete="email" inputMode="email" spellCheck="false" maxLength={254} required />
          </label>
          <label className="campo"><span>Provincia</span>
            <select className="entrada" value={form.provincia} onChange={poner('provincia')} required>
              {PROVINCIAS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
          <label className="campo"><span>Ciudad</span>
            <input className="entrada" value={form.ciudad} onChange={poner('ciudad')} autoComplete="address-level2" maxLength={60} required />
          </label>
        </div>
        <button className="btn" type="submit" disabled={trabajando}>{trabajando ? 'Guardando…' : 'Guardar cambios'}</button>
      </form>
    </section>
  )
}

/* ---------------------------------------------------------------- descargar */

function Descargar({ usuario }) {
  const [trabajando, setTrabajando] = useState(false)
  const [error, setError] = useState('')
  const { avisar } = useUI()
  async function descargar() {
    setError('')
    setTrabajando(true)
    try {
      const documento = await api('/auth/mis-datos/exportar/')
      guardarComoArchivo(documento, `siget-mis-datos-${usuario}-${new Date().toISOString().slice(0, 10)}.json`)
      avisar('Descargamos tus datos en un archivo JSON.')
    } catch (e) {
      setError(mensaje(e))
    } finally {
      setTrabajando(false)
    }
  }
  return (
    <section className="panel">
      <div className="panel-cabecera"><h3>Descargar mis datos</h3></div>
      <p className="suave">Un solo archivo (JSON) con tu perfil, tus trámites con su historial, tus solicitudes y tu actividad de seguridad. Es tu derecho de portabilidad: puedes llevarlo a donde quieras. Guárdalo en un lugar seguro: trae tu cédula.</p>
      <Alerta>{error}</Alerta>
      <button className="btn btn-sec" type="button" onClick={descargar} disabled={trabajando}>{trabajando ? 'Preparando…' : 'Descargar mis datos'}</button>
    </section>
  )
}

/* ---------------------------------------------------------------- solicitudes */

function Solicitudes({ datos, alCambiar }) {
  const { avisar } = useUI()
  const [tipo, setTipo] = useState('rectificacion')
  const [detalle, setDetalle] = useState('')
  const [error, setError] = useState('')
  const [trabajando, setTrabajando] = useState(false)
  const abiertas = datos.solicitudes.filter((s) => s.estado === 'recibida').length
  const lleno = abiertas >= datos.solicitudes_abiertas_maximo
  const largo = detalle.trim().length

  async function enviar(ev) {
    ev.preventDefault()
    setError('')
    setTrabajando(true)
    try {
      await api('/auth/mis-datos/solicitudes/', { metodo: 'POST', cuerpo: { tipo, detalle: detalle.trim() } })
      setDetalle('')
      avisar(`Recibimos tu solicitud. Te responderemos en no más de ${datos.plazo_respuesta_dias_habiles} días hábiles.`)
      await alCambiar()
    } catch (e) {
      setError(mensaje(e))
    } finally {
      setTrabajando(false)
    }
  }

  return (
    <section className="panel">
      <div className="panel-cabecera"><h3>Solicitudes sobre mis datos personales</h3></div>
      <p className="suave">Pide una rectificación, una cancelación o una oposición. Te respondemos en no más de {datos.plazo_respuesta_dias_habiles} días hábiles y no cuesta nada. <strong>Cancelar no borra nada automáticamente:</strong> los trámites son expediente público con conservación obligatoria. En la respuesta te explicamos qué datos sí se pueden eliminar y cuáles no.</p>
      {lleno && <Alerta tipo="info">Ya tienes {abiertas} solicitudes abiertas (el máximo es {datos.solicitudes_abiertas_maximo}). Espera su respuesta antes de enviar otra.</Alerta>}
      <form onSubmit={enviar} aria-label="Nueva solicitud sobre mis datos">
        <Alerta>{error}</Alerta>
        <label className="campo"><span>¿Qué quieres pedir?</span>
          <select className="entrada" value={tipo} onChange={(e) => setTipo(e.target.value)} disabled={lleno}>
            {Object.entries(TIPOS).map(([id, [nombre, texto]]) => <option key={id} value={id}>{nombre}: {texto}</option>)}
          </select>
        </label>
        <label className="campo"><span>Cuéntanos qué necesitas</span>
          <textarea className="entrada" value={detalle} onChange={(e) => setDetalle(e.target.value)} rows={4} minLength={DETALLE_MIN} maxLength={DETALLE_MAX} required disabled={lleno} aria-describedby="ayuda-detalle" />
          <small id="ayuda-detalle">Entre {DETALLE_MIN} y {DETALLE_MAX} caracteres ({largo}/{DETALLE_MAX}). No escribas contraseñas ni códigos.</small>
        </label>
        <button className="btn" type="submit" disabled={trabajando || lleno || largo < DETALLE_MIN}>{trabajando ? 'Enviando…' : 'Enviar solicitud'}</button>
      </form>
      <h4 className="subtitulo-form">Tus solicitudes</h4>
      {datos.solicitudes.length === 0 ? <p className="suave">Todavía no enviaste ninguna solicitud.</p> : (
        <ul className="lista-solicitudes">
          {datos.solicitudes.map((s) => {
            const [clase, texto] = ESTADOS[s.estado]
            return (
              <li key={s.id}>
                <div className="cabecera-solicitud">
                  <strong>{TIPOS[s.tipo][0]}</strong>
                  <Insignia clase={clase}>{texto}</Insignia>
                </div>
                <p className="detalle-solicitud">{s.detalle}</p>
                <small>Enviada {hace(s.creada_en)} · {s.estado === 'recibida' ? `te respondemos antes del ${fechaCorta(s.vence_en)}` : `respondida ${hace(s.respondida_en)}`}</small>
                {s.vencida && <Alerta tipo="info">Ya pasó el plazo de respuesta. Ya deberíamos haberte respondido: sigue en la cola de la plataforma.</Alerta>}
                {s.respuesta && <blockquote className="respuesta-solicitud"><strong>Respuesta</strong><p>{s.respuesta}</p></blockquote>}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

/* ---------------------------------------------------------------- aviso */

function Aviso({ aceptado, vigente }) {
  return (
    <section className="panel">
      <div className="panel-cabecera"><h3>Aviso de privacidad</h3></div>
      {aceptado
        ? <p>Leíste la versión {aceptado.version} el {fecha(aceptado.leido_en)}.{!aceptado.vigente && <> Hay una versión nueva ({vigente.version}).</>}</p>
        : <p>Tu cuenta es anterior al aviso de privacidad, así que no hay una constancia de lectura. Puedes leerlo cuando quieras (versión {vigente.version}).</p>}
      <p><a className="enlace" href="#/privacidad"><Icono nombre="documento" className="en-linea" /> Leer el aviso de privacidad</a></p>
    </section>
  )
}

/* ---------------------------------------------------------------- pantalla */

export function MisDatos({ yo }) {
  const [datos, setDatos] = useState(null)
  const [error, setError] = useState('')
  const cargar = useCallback(() => api('/auth/mis-datos/').then((d) => { setDatos(d); setError('') }).catch((e) => setError(mensaje(e))), [])
  useEffect(() => { cargar() }, [cargar])

  return (
    <>
      <div className="encabezado-vista">
        <div>
          <h2>Mis datos</h2>
          <p>Tus datos personales son tuyos. Aquí puedes verlos, corregir los de contacto, descargarlos y pedir que se rectifiquen, cancelen o dejen de usarse (Ley 81 de 2019).</p>
        </div>
      </div>
      <Alerta>{error}</Alerta>
      {!datos && !error && <BloquesEsqueleto n={2} />}
      {datos && (
        <>
          <Perfil perfil={datos.perfil} tramites={datos.tramites} />
          {datos.perfil && <Corregir key={datos.perfil.actualizado_en || 'sin-cambios'} perfil={datos.perfil} alCambiar={cargar} />}
          <Descargar usuario={yo.usuario} />
          <Solicitudes datos={datos} alCambiar={cargar} />
          <Aviso aceptado={datos.aviso_aceptado} vigente={datos.aviso_vigente} />
        </>
      )}
    </>
  )
}
