import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from './api.js'
import { EVENTOS_ALERTA, NOMBRES_EVENTO } from './Auditoria.jsx'
import { fecha, hace, mensajeDe } from './comun.jsx'
import { VentanaMfa } from './Otras.jsx'
import { Alerta, Icono, Insignia } from './ui.jsx'

const pasos = (ventana) => [
  ['Alta', 'El sistema genera un secreto aleatorio y te lo muestra una sola vez, como código QR. Después solo existe cifrado en la base de datos.'],
  ['El código', 'Tu aplicación calcula, con ese secreto y la hora, un código de 6 dígitos que cambia cada 30 segundos (TOTP, RFC 6238). Nunca viaja el secreto, solo el código.'],
  ['Verificación', 'El servidor calcula lo mismo y compara. Tolera un paso de diferencia de reloj, no más.'],
  ['Anti-repetición', 'Un código ya usado no se acepta otra vez, aunque siga vigente: quien lo espíe no puede reutilizarlo.'],
  ['Bloqueo', 'Tres códigos incorrectos en 5 minutos bloquean la cuenta y cierran todas sus sesiones.'],
  ['Reautenticación escalonada', `Las acciones que cambian trámites piden un código de los últimos ${ventana} minutos, aunque ya hayas iniciado sesión.`],
]

const QUIEN_EXIGE = [
  ['Personal de las instituciones', 'Siempre'],
  ['Roles de plataforma y auditoría', 'Siempre'],
  ['Ciudadanía', 'Obligatorio (configuración actual)'],
]

export function SegundoFactor({ yo, refrescar }) {
  const ventana = yo.mfa_ventana_minutos ?? 15
  const [codigo, setCodigo] = useState('')
  const [ultimoOk, setUltimoOk] = useState(null)
  const [resultado, setResultado] = useState(null)
  const [reuso, setReuso] = useState(null)
  const [trabajando, setTrabajando] = useState(false)
  const [actividad, setActividad] = useState(null)
  const [errorActividad, setErrorActividad] = useState('')

  const cargarActividad = useCallback(() => {
    api('/auth/actividad/').then((d) => setActividad(d.eventos)).catch((e) => { setErrorActividad(mensajeDe(e)); setActividad([]) })
  }, [])
  useEffect(() => { cargarActividad() }, [cargarActividad])

  async function verificar(ev) {
    ev.preventDefault()
    setTrabajando(true)
    setReuso(null)
    try {
      await api('/auth/mfa/verificar/', { metodo: 'POST', cuerpo: { codigo } })
      setUltimoOk(codigo)
      setResultado({ tipo: 'ok', texto: `Código verificado: tu ventana de ${ventana} minutos se renovó.` })
      setCodigo('')
      await refrescar()
    } catch (e) {
      setUltimoOk(null)
      setResultado({ tipo: 'error', texto: e instanceof ApiError && e.estado === 400 ? 'Ese código no sirve: es incorrecto o ya se usó. Espera al siguiente de tu aplicación.' : mensajeDe(e) })
    } finally {
      setTrabajando(false)
      cargarActividad()
    }
  }

  async function reusar() {
    setTrabajando(true)
    try {
      await api('/auth/mfa/verificar/', { metodo: 'POST', cuerpo: { codigo: ultimoOk } })
      setReuso({ tipo: 'error', texto: 'El servidor aceptó el mismo código otra vez. Esto no debería pasar.' })
    } catch (e) {
      setReuso(e instanceof ApiError && e.estado === 400
        ? { tipo: 'ok', texto: 'Rechazado, como debe ser: un código solo sirve una vez, aunque siga vigente. Así no se puede repetir un código espiado.' }
        : { tipo: 'error', texto: mensajeDe(e) })
    } finally {
      setTrabajando(false)
      cargarActividad()
    }
  }

  return (
    <>
      <div className="encabezado-vista">
        <div>
          <h2>Segundo factor (MFA)</h2>
          <p>Además de tu contraseña, un código que cambia cada 30 segundos. Aquí ves cómo funciona y puedes probarlo con tu propia cuenta.</p>
        </div>
      </div>
      <div className="rejilla-seguridad">
        <div>
          <section className="panel">
            <div className="panel-cabecera"><h3>Tu estado</h3><Insignia clase={yo.mfa_activo ? 'e-aprobado' : 'e-rechazado'}>{yo.mfa_activo ? 'Activo' : 'No activo'}</Insignia></div>
            <VentanaMfa verificadoEn={yo.mfa_verificado_en} ventana={ventana} />
            <dl className="datos separado">
              <dt>Último código verificado</dt><dd>{yo.mfa_verificado_en ? `${hace(yo.mfa_verificado_en)} · ${fecha(yo.mfa_verificado_en)}` : '—'}</dd>
              <dt>¿Es obligatorio para ti?</dt><dd>{yo.mfa_obligatorio ? 'Sí' : 'No'}</dd>
            </dl>
          </section>

          <section className="panel">
            <h3>Pruébalo ahora</h3>
            <p className="suave">Escribe el código actual de tu aplicación. Se verifica de verdad contra el servidor.</p>
            <Alerta tipo="info">Cuidado: tres códigos incorrectos seguidos bloquean tu cuenta 5 minutos. No pruebes a ciegas.</Alerta>
            <form onSubmit={verificar}>
              <label className="campo">
                <span>Código de 6 dígitos</span>
                <input className="entrada entrada-codigo" value={codigo} onChange={(e) => setCodigo(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" placeholder="000000" />
              </label>
              <button type="submit" className="btn" disabled={codigo.length !== 6 || trabajando}>Verificar mi código</button>
            </form>
            {resultado && <div className="separado"><Alerta tipo={resultado.tipo}>{resultado.texto}</Alerta></div>}
            {ultimoOk && (
              <div className="separado">
                <p className="suave">Ahora comprueba la protección contra repetición: se envía <strong>el mismo código</strong> otra vez.</p>
                <button className="btn btn-sec" onClick={reusar} disabled={trabajando}>Enviar el mismo código de nuevo</button>
                {reuso && <div className="separado"><Alerta tipo={reuso.tipo}>{reuso.texto}</Alerta></div>}
              </div>
            )}
          </section>
        </div>

        <div>
          <section className="panel">
            <h3>Cómo funciona</h3>
            <ol className="capas compacta">
              {pasos(ventana).map(([titulo, texto], i) => (
                <li key={titulo}>
                  <span className="capa-num" aria-hidden="true">{i + 1}</span>
                  <div className="capa-cuerpo"><h3>{titulo}</h3><p>{texto}</p></div>
                </li>
              ))}
            </ol>
          </section>

          <section className="panel">
            <h3>Quién lo necesita</h3>
            <ul className="lista-simple">
              {QUIEN_EXIGE.map(([quien, cuando]) => <li key={quien}><span>{quien}</span><Insignia clase="insignia-rol" punto={false}>{cuando}</Insignia></li>)}
            </ul>
          </section>

          <section className="panel">
            <div className="panel-cabecera"><h3>Tu actividad de seguridad</h3><button className="btn btn-sec btn-s" onClick={cargarActividad}>Actualizar</button></div>
            <p className="suave">Lo que se hizo con tu cuenta: si ves algo que no reconoces, avisa de inmediato.</p>
            <Alerta>{errorActividad}</Alerta>
            {actividad === null ? <p className="suave">Cargando…</p> : actividad.length === 0 ? <p className="suave">Todavía no hay actividad registrada.</p> : (
              <ul className="actividad">
                {actividad.map((e) => (
                  <li key={e.id} className={EVENTOS_ALERTA.includes(e.evento) ? 'alerta' : ''}>
                    <Icono nombre={EVENTOS_ALERTA.includes(e.evento) ? 'alerta' : e.evento.startsWith('mfa') ? 'llave' : 'usuario'} />
                    <span className="que">{NOMBRES_EVENTO[e.evento] || e.evento}</span>
                    <span className="cuando" title={fecha(e.creado_en)}>{hace(e.creado_en)}</span>
                    <span className="donde mono">{e.ip || '—'}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </>
  )
}
