import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from './api.js'
import { fecha, hace, mensajeDe, useReautenticacion } from './comun.jsx'
import { Alerta, BloquesEsqueleto, Icono, Insignia, Vacio, useUI } from './ui.jsx'

// Consolas de los operadores de plataforma. Ninguna muestra datos de trámites ni datos personales: una persona es su usuario,
// su estado y su rol. El servidor decide quién puede cada acción; aquí solo se dibuja y se explica lo que responde.

function mensaje(e) {
  if (e instanceof ApiError) {
    const d = e.datos || {}
    if (Array.isArray(d.errores) && d.errores.length) return `${d.errores.join('. ')}.`
    if ((e.estado === 400 || e.estado === 409) && d.detalle) return d.detalle
  }
  return mensajeDe(e)
}

function useCarga(ruta) {
  const [datos, setDatos] = useState(null)
  const [error, setError] = useState('')
  const recargar = useCallback(() => api(ruta).then((d) => { setDatos(d); setError('') }).catch((e) => setError(mensaje(e))), [ruta])
  useEffect(() => { recargar() }, [recargar])
  return { datos, error, recargar }
}

function Encabezado({ titulo, texto }) {
  return <div className="encabezado-vista"><div><h2>{titulo}</h2><p>{texto}</p></div></div>
}

// Ejecuta una acción sensible: si falta el segundo factor reciente pide el código y reintenta; muestra el resultado o el motivo
function useAccion(alTerminar) {
  const { ejecutar, modal } = useReautenticacion()
  const { avisar } = useUI()
  const [error, setError] = useState('')
  const correr = (fn, exito) => ejecutar(async () => {
    setError('')
    try {
      const r = await fn()
      if (exito) avisar(typeof exito === 'function' ? exito(r) : exito)
      await alTerminar?.()
      return r
    } catch (e) {
      if (e instanceof ApiError && e.pideReautenticar) throw e
      setError(mensaje(e))
      return undefined
    }
  })
  return { correr, modal, error, limpiar: () => setError('') }
}

const ESTADO_CUENTA = { activa: ['e-aprobado', 'Activa'], bloqueada: ['e-rechazado', 'Bloqueada'], suspendida: ['e-pendiente', 'Suspendida'] }
const ETIQUETA_ROL = {
  ninguno: 'Persona', operador_infraestructura: 'Op. infraestructura', operador_identidades: 'Op. identidades', operador_catalogo: 'Op. catálogo',
  operador_seguridad: 'Op. seguridad', custodio_secretos: 'Custodio de secretos', auditor: 'Auditor',
}

function TablaPersonas({ yo, acciones }) {
  const [q, setQ] = useState('')
  const [buscado, setBuscado] = useState('')
  const { datos, error, recargar } = useCarga(`/plataforma/personas/?q=${encodeURIComponent(buscado)}`)
  return (
    <section className="panel">
      <div className="panel-cabecera">
        <h3>Personas</h3>
        <form className="buscador" role="search" onSubmit={(e) => { e.preventDefault(); setBuscado(q.trim()) }}>
          <input className="entrada" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por usuario" aria-label="Buscar por usuario" maxLength={40} />
          <button className="btn btn-sec" type="submit">Buscar</button>
        </form>
      </div>
      <Alerta>{error}</Alerta>
      {!datos ? <BloquesEsqueleto n={2} /> : datos.personas.length === 0 ? <Vacio titulo="Nadie coincide" texto="Prueba con otra parte del usuario." /> : (
        <div className="tabla-caja">
          <table className="tabla apilada">
            <caption className="solo-lector">Personas con su estado de cuenta</caption>
            <thead><tr><th scope="col">Usuario</th><th scope="col">Rol</th><th scope="col">Cuenta</th><th scope="col">2.º factor</th><th scope="col">Sesiones</th><th scope="col">Acciones</th></tr></thead>
            <tbody>
              {datos.personas.map((p) => {
                const [clase, texto] = ESTADO_CUENTA[p.estado_cuenta] || ['', p.estado_cuenta]
                return (
                  <tr key={p.id}>
                    <th scope="row">{p.usuario}{p.id === yo.id && <small>Eres tú</small>}</th>
                    <td data-etiqueta="Rol">{ETIQUETA_ROL[p.rol_plataforma] || p.rol_plataforma}</td>
                    <td data-etiqueta="Cuenta"><Insignia clase={clase}>{texto}</Insignia>{p.bloqueada_hasta && <small>Bloqueo temporal por intentos</small>}</td>
                    <td data-etiqueta="2.º factor">{p.mfa_activo ? 'Activo' : 'No activo'}</td>
                    <td data-etiqueta="Sesiones">{p.sesiones_activas}</td>
                    <td data-etiqueta="Acciones"><div className="acciones-fila">{p.id === yo.id ? <span className="suave">—</span> : acciones(p, recargar)}</div></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

/* ---------------------------------------------------------------- aprobaciones con control dual */

const ESTADO_APROBACION = { pendiente: ['e-pendiente', 'Pendiente'], aprobada: ['e-aprobado', 'Aprobada'], rechazada: ['e-rechazado', 'Rechazada'] }

function PanelAprobaciones({ yo, titulo, nuevo, resumen, formulario }) {
  const { datos, error, recargar } = useCarga('/plataforma/aprobaciones/')
  const { correr, modal, error: errorAccion } = useAccion(recargar)
  const { confirmar } = useUI()

  async function resolver(a, decision) {
    const aprobar = decision === 'aprobar'
    const si = await confirmar({
      titulo: aprobar ? 'Aprobar esta propuesta' : 'Rechazar esta propuesta',
      texto: aprobar ? `${resumen(a.objetivo)}. Al aprobarla, el cambio se aplica de inmediato y queda registrado a tu nombre.` : `${resumen(a.objetivo)}. No se aplicará ningún cambio.`,
      etiqueta: aprobar ? 'Aprobar' : 'Rechazar', peligro: !aprobar,
    })
    if (si) await correr(() => api(`/plataforma/aprobaciones/${a.id}/resolver/`, { metodo: 'POST', cuerpo: { decision } }), aprobar ? 'Propuesta aprobada y aplicada.' : 'Propuesta rechazada.')
  }

  return (
    <>
      {modal}
      <section className="panel">
        <div className="panel-cabecera"><h3>{nuevo}</h3><Insignia clase="insignia-rol" punto={false}>Control dual</Insignia></div>
        <p className="suave">Quien propone no puede aprobar: otra persona con tu mismo rol debe revisarla. La base de datos también lo impone.</p>
        {formulario({ correr, recargar })}
        <Alerta>{errorAccion}</Alerta>
      </section>
      <section className="panel">
        <div className="panel-cabecera"><h3>{titulo}</h3></div>
        <Alerta>{error}</Alerta>
        {!datos ? <BloquesEsqueleto n={2} /> : datos.aprobaciones.length === 0 ? <Vacio titulo="Sin propuestas" texto="Cuando alguien proponga un alta aparecerá aquí." /> : (
          <ul className="lista-aprobaciones">
            {datos.aprobaciones.map((a) => {
              const [clase, texto] = ESTADO_APROBACION[a.estado]
              const mia = a.propuesto_por.id === yo.id
              return (
                <li key={a.id}>
                  <div className="texto">
                    <strong>{resumen(a.objetivo)}</strong>
                    <small>Propuesta por {mia ? 'ti' : a.propuesto_por.usuario} · {hace(a.creado_en)}{a.resuelto_por && ` · resuelta por ${a.resuelto_por.id === yo.id ? 'ti' : a.resuelto_por.usuario}`}</small>
                  </div>
                  <Insignia clase={clase}>{texto}</Insignia>
                  {a.estado === 'pendiente' && (mia
                    ? <span className="suave">La debe resolver otra persona</span>
                    : <div className="acciones-fila">
                      <button className="btn" onClick={() => resolver(a, 'aprobar')}>Aprobar</button>
                      <button className="btn btn-sec" onClick={() => resolver(a, 'rechazar')}>Rechazar</button>
                    </div>)}
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </>
  )
}

/* ---------------------------------------------------------------- identidades */

function CodigoEmitido({ datos, alCerrar }) {
  const [copiado, setCopiado] = useState(false)
  async function copiar() {
    try { await navigator.clipboard.writeText(datos.codigo); setCopiado(true) } catch { /* sin portapapeles: se lee en pantalla */ }
  }
  return (
    <div className="fondo-modal">
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="titulo-codigo">
        <h2 id="titulo-codigo"><span className="icono-grande"><Icono nombre="llave" /></span>Código de restablecimiento</h2>
        <p className="suave">Entrégaselo a <strong>{datos.usuario}</strong> por un canal seguro (en persona o por teléfono). Sirve una sola vez y vence en 15 minutos. <strong>No se vuelve a mostrar.</strong></p>
        <p className="codigo-grande" aria-label={`Código ${datos.codigo.split('').join(' ')}`}>{datos.codigo}</p>
        <div className="fila-botones">
          <button className="btn btn-sec" onClick={copiar}>{copiado ? 'Copiado' : 'Copiar'}</button>
          <button className="btn" onClick={alCerrar}>Listo, ya se lo entregué</button>
        </div>
      </div>
    </div>
  )
}

function FormularioAltaCoordinador({ correr, recargar }) {
  const { datos: inst } = useCarga('/catalogo/instituciones/')
  const [usuario, setUsuario] = useState('')
  const [institucion, setInstitucion] = useState('')
  return (
    <form className="formulario-fila" onSubmit={async (e) => {
      e.preventDefault()
      const r = await correr(() => api('/plataforma/aprobaciones/', { metodo: 'POST', cuerpo: { usuario, institucion_id: Number(institucion) } }), 'Propuesta enviada: falta que otra persona la apruebe.')
      if (r) { setUsuario(''); recargar() }
    }}>
      <label className="campo"><span>Usuario de la persona</span>
        <input className="entrada" value={usuario} onChange={(e) => setUsuario(e.target.value)} required autoCapitalize="none" spellCheck="false" maxLength={32} />
      </label>
      <label className="campo"><span>Institución que coordinará</span>
        <select className="entrada" value={institucion} onChange={(e) => setInstitucion(e.target.value)} required>
          <option value="">Elige una institución</option>
          {(inst || []).map((i) => <option key={i.id} value={i.id}>{i.nombre}</option>)}
        </select>
      </label>
      <button className="btn" type="submit">Proponer alta</button>
    </form>
  )
}

export function ConsolaIdentidades({ yo }) {
  const [emitido, setEmitido] = useState(null)
  const { correr, modal, error } = useAccion()
  const { confirmar } = useUI()

  async function emitir(p, recargar) {
    const r = await correr(() => api(`/plataforma/personas/${p.id}/restablecer-contrasena/`, { metodo: 'POST', cuerpo: {} }))
    if (r) { setEmitido({ usuario: p.usuario, codigo: r.codigo_restablecimiento }); recargar() }
  }
  async function restablecerMfa(p, recargar) {
    const si = await confirmar({
      titulo: `Restablecer el segundo factor de ${p.usuario}`, peligro: true, etiqueta: 'Restablecer',
      texto: 'Su segundo factor actual dejará de servir, se cerrarán todas sus sesiones y tendrá que activarlo de nuevo con su teléfono. Hazlo solo si confirmaste su identidad por otro canal.',
    })
    if (si) await correr(() => api(`/plataforma/personas/${p.id}/restablecer-mfa/`, { metodo: 'POST', cuerpo: {} }), `Segundo factor de ${p.usuario} restablecido.`).then(recargar)
  }

  return (
    <>
      <Encabezado titulo="Identidades" texto="Ayuda a recuperar una cuenta y da de alta a las coordinadoras de las instituciones, siempre con control dual. No ves trámites ni datos personales." />
      {modal}
      {emitido && <CodigoEmitido datos={emitido} alCerrar={() => setEmitido(null)} />}
      <Alerta>{error}</Alerta>
      <TablaPersonas yo={yo} acciones={(p, recargar) => (
        <>
          <button className="btn btn-sec" onClick={() => emitir(p, recargar)}>Código de contraseña</button>
          {p.mfa_activo && <button className="btn btn-sec" onClick={() => restablecerMfa(p, recargar)}>Restablecer 2.º factor</button>}
        </>
      )} />
      <p className="nota">Separación de funciones: quien emite el código de contraseña de una cuenta no puede además restablecer su segundo factor en las siguientes 24 horas (y al revés): así nadie reúne lo necesario para adueñarse de una cuenta.</p>
      <PanelAprobaciones yo={yo} titulo="Altas de coordinadoras" nuevo="Proponer el alta de una coordinadora"
        resumen={(o) => `Alta de ${o.usuario} como coordinadora (institución n.º ${o.institucion_id})`}
        formulario={(props) => <FormularioAltaCoordinador {...props} />} />
    </>
  )
}

/* ---------------------------------------------------------------- catálogo */

function FormularioInstitucion({ correr, recargar }) {
  const [nombre, setNombre] = useState('')
  const [tipo, setTipo] = useState('real')
  return (
    <form className="formulario-fila" onSubmit={async (e) => {
      e.preventDefault()
      const r = await correr(() => api('/plataforma/aprobaciones/', { metodo: 'POST', cuerpo: { nombre, tipo } }), 'Propuesta enviada: falta que otra persona la apruebe.')
      if (r) { setNombre(''); recargar() }
    }}>
      <label className="campo"><span>Nombre de la institución</span>
        <input className="entrada" value={nombre} onChange={(e) => setNombre(e.target.value)} required minLength={3} maxLength={80} />
      </label>
      <label className="campo"><span>Tipo</span>
        <select className="entrada" value={tipo} onChange={(e) => setTipo(e.target.value)}>
          <option value="real">Real</option><option value="demostracion">Demostración</option>
        </select>
      </label>
      <button className="btn" type="submit">Proponer institución</button>
    </form>
  )
}

export function ConsolaCatalogo({ yo }) {
  const { datos } = useCarga('/catalogo/instituciones/')
  return (
    <>
      <Encabezado titulo="Catálogo" texto="Propón y aprueba, entre dos personas, las instituciones que aparecen en SIGET. Los trámites de cada institución los gestiona su coordinación." />
      <PanelAprobaciones yo={yo} titulo="Propuestas de instituciones" nuevo="Proponer una institución nueva"
        resumen={(o) => `Alta de la institución «${o.nombre}» (${o.tipo === 'real' ? 'real' : 'demostración'})`}
        formulario={(props) => <FormularioInstitucion {...props} />} />
      <section className="panel">
        <div className="panel-cabecera"><h3>Instituciones hoy</h3></div>
        {!datos ? <BloquesEsqueleto n={2} /> : (
          <ul className="chips">{datos.map((i) => <li key={i.id}>{i.nombre}{i.tipo === 'demostracion' ? ' · demostración' : ''}</li>)}</ul>
        )}
      </section>
    </>
  )
}

/* ---------------------------------------------------------------- seguridad */

function ModalMotivo({ persona, alCancelar, alEnviar }) {
  const [motivo, setMotivo] = useState('')
  return (
    <div className="fondo-modal">
      <form className="modal" role="dialog" aria-modal="true" aria-labelledby="titulo-bloqueo" onSubmit={(e) => { e.preventDefault(); alEnviar(motivo) }}>
        <h2 id="titulo-bloqueo"><span className="icono-grande peligro"><Icono nombre="alerta" /></span>Bloquear a {persona.usuario}</h2>
        <p className="suave">Se cerrarán sus sesiones y no podrá entrar hasta que alguien de seguridad la desbloquee. El motivo queda registrado.</p>
        <label className="campo"><span>Motivo</span>
          <textarea className="entrada" value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={3} minLength={5} maxLength={200} required autoFocus />
        </label>
        <div className="fila-botones">
          <button type="button" className="btn btn-sec" onClick={alCancelar}>Cancelar</button>
          <button type="submit" className="btn btn-peligro">Bloquear cuenta</button>
        </div>
      </form>
    </div>
  )
}

export function ConsolaSeguridad({ yo }) {
  const [objetivo, setObjetivo] = useState(null)
  const { correr, modal, error } = useAccion()
  const eventos = useCarga('/plataforma/eventos/')
  const { confirmar } = useUI()

  const hacer = (p, ruta, cuerpo, exito, recargar) => correr(() => api(`/plataforma/personas/${p.id}/${ruta}/`, { metodo: 'POST', cuerpo }), exito).then(() => { recargar(); eventos.recargar() })

  return (
    <>
      <Encabezado titulo="Respuesta a incidentes" texto="Bloquea cuentas, cierra sesiones y mira los eventos de seguridad recientes. No puedes ver trámites ni cambiar contraseñas." />
      {modal}
      {objetivo && <ModalMotivo persona={objetivo.p} alCancelar={() => setObjetivo(null)}
        alEnviar={async (motivo) => { const { p, recargar } = objetivo; setObjetivo(null); await hacer(p, 'bloquear', { motivo }, `${p.usuario} quedó bloqueada.`, recargar) }} />}
      <Alerta>{error}</Alerta>
      <TablaPersonas yo={yo} acciones={(p, recargar) => (
        <>
          {p.estado_cuenta === 'bloqueada'
            ? <button className="btn btn-sec" onClick={() => hacer(p, 'desbloquear', {}, `${p.usuario} se desbloqueó.`, recargar)}>Desbloquear</button>
            : p.estado_cuenta === 'activa' && <button className="btn btn-sec" onClick={() => setObjetivo({ p, recargar })}>Bloquear</button>}
          {p.sesiones_activas > 0 && <button className="btn btn-sec" onClick={async () => {
            if (await confirmar({ titulo: `Cerrar las sesiones de ${p.usuario}`, texto: `Se cerrarán ${p.sesiones_activas} sesión(es) abiertas. Tendrá que iniciar sesión otra vez.`, etiqueta: 'Cerrar sesiones', peligro: true })) {
              hacer(p, 'revocar-sesiones', {}, 'Sesiones cerradas.', recargar)
            }
          }}>Cerrar sesiones</button>}
        </>
      )} />
      <section className="panel">
        <div className="panel-cabecera"><h3>Eventos de seguridad recientes</h3></div>
        <Alerta>{eventos.error}</Alerta>
        {!eventos.datos ? <BloquesEsqueleto n={2} /> : (
          <div className="tabla-caja">
            <table className="tabla apilada">
              <caption className="solo-lector">Últimos eventos de seguridad</caption>
              <thead><tr><th scope="col">Cuándo</th><th scope="col">Evento</th><th scope="col">Persona</th><th scope="col">Dirección</th></tr></thead>
              <tbody>{eventos.datos.eventos.slice(0, 30).map((e) => (
                <tr key={e.id}><td data-etiqueta="Cuándo">{fecha(e.creado_en)}</td><td data-etiqueta="Evento"><code>{e.evento}</code></td><td data-etiqueta="Persona">{e.usuario || '—'}</td><td data-etiqueta="Dirección">{e.ip || '—'}</td></tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>
    </>
  )
}

/* ---------------------------------------------------------------- secretos */

const ESTADO_SECRETO = { al_dia: ['e-aprobado', 'Al día'], por_vencer: ['e-pendiente', 'Por vencer'], vencida: ['e-rechazado', 'Vencida'], sin_registro: ['e-pendiente', 'Sin registro'] }

export function ConsolaSecretos() {
  const { datos, error, recargar } = useCarga('/plataforma/secretos/')
  const { correr, modal, error: errorAccion } = useAccion(recargar)
  const [secreto, setSecreto] = useState('')
  const [nota, setNota] = useState('')
  return (
    <>
      <Encabezado titulo="Custodia de secretos" texto="Registra cuándo rotas cada secreto y mira cuáles ya tocan. Aquí nunca hay valores: solo nombres y fechas." />
      {modal}
      <Alerta>{error}</Alerta>
      <section className="panel">
        <div className="panel-cabecera"><h3>Estado de los secretos</h3></div>
        {!datos ? <BloquesEsqueleto n={3} /> : (
          <div className="tabla-caja">
            <table className="tabla apilada">
              <caption className="solo-lector">Secretos, última rotación y estado</caption>
              <thead><tr><th scope="col">Secreto</th><th scope="col">Dónde vive</th><th scope="col">Cada</th><th scope="col">Última rotación</th><th scope="col">Estado</th></tr></thead>
              <tbody>{datos.secretos.map((s) => {
                const [clase, texto] = ESTADO_SECRETO[s.estado]
                return (
                  <tr key={s.id}>
                    <th scope="row">{s.nombre}{s.nota && <small>{s.nota}</small>}</th>
                    <td data-etiqueta="Dónde vive">{s.donde}</td><td data-etiqueta="Cada">{s.frecuencia_dias} días</td>
                    <td data-etiqueta="Última rotación">{s.ultima_rotacion ? hace(s.ultima_rotacion) : '—'}</td>
                    <td data-etiqueta="Estado"><Insignia clase={clase}>{texto}</Insignia>{s.dias_restantes !== null && <small>{s.dias_restantes >= 0 ? `Faltan ${s.dias_restantes} días` : `Vencida hace ${-s.dias_restantes} días`}</small>}</td>
                  </tr>
                )
              })}</tbody>
            </table>
          </div>
        )}
      </section>
      <section className="panel">
        <div className="panel-cabecera"><h3>Registrar una rotación</h3></div>
        <p className="suave">Hazlo después de rotar el secreto de verdad (el procedimiento está en el runbook). Aquí solo queda constancia de quién y cuándo.</p>
        <form className="formulario-fila" onSubmit={async (e) => {
          e.preventDefault()
          const r = await correr(() => api('/plataforma/secretos/', { metodo: 'POST', cuerpo: { secreto, nota } }), 'Rotación registrada.')
          if (r) { setNota(''); setSecreto('') }
        }}>
          <label className="campo"><span>Secreto</span>
            <select className="entrada" value={secreto} onChange={(e) => setSecreto(e.target.value)} required>
              <option value="">Elige un secreto</option>
              {(datos?.secretos || []).map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
          </label>
          <label className="campo"><span>Nota (opcional)</span>
            <input className="entrada" value={nota} onChange={(e) => setNota(e.target.value)} maxLength={300} />
          </label>
          <button className="btn" type="submit">Registrar rotación</button>
        </form>
        <Alerta>{errorAccion}</Alerta>
      </section>
    </>
  )
}

/* ---------------------------------------------------------------- infraestructura */

function Dato({ etiqueta, valor, bien }) {
  return (
    <div className={`dato-sistema ${bien === false ? 'mal' : ''}`}>
      <small>{etiqueta}</small>
      <strong>{valor}</strong>
    </div>
  )
}

export function ConsolaInfraestructura() {
  const { datos, error, recargar } = useCarga('/plataforma/infraestructura/')
  return (
    <>
      <Encabezado titulo="Infraestructura" texto="Estado de la base de datos y del servicio, de solo lectura. No incluye datos de trámites." />
      <div className="barra-herramientas"><button className="btn btn-sec" onClick={recargar}>Actualizar</button></div>
      <Alerta>{error}</Alerta>
      {!datos ? <BloquesEsqueleto n={3} /> : (
        <>
          <section className="panel">
            <div className="panel-cabecera"><h3>Base de datos</h3><Insignia clase={datos.base.ok ? 'e-aprobado' : 'e-rechazado'}>{datos.base.ok ? 'Responde' : 'No responde'}</Insignia></div>
            {datos.base.ok ? (
              <div className="rejilla-datos">
                <Dato etiqueta="Tiempo de respuesta" valor={`${datos.base.latencia_ms} ms`} />
                <Dato etiqueta="Cifrado de la conexión" valor={datos.base.tls || 'Sin cifrar'} bien={datos.base.tls === 'TLSv1.3'} />
                <Dato etiqueta="Tamaño" valor={`${datos.base.tamano_mb} MB`} />
                <Dato etiqueta="Conexiones" valor={datos.base.conexiones} />
                <Dato etiqueta="Versión de PostgreSQL" valor={datos.base.version} />
              </div>
            ) : <p className="suave">{datos.base.error}</p>}
          </section>
          <section className="panel">
            <div className="panel-cabecera"><h3>Servicio</h3></div>
            <div className="rejilla-datos">
              <Dato etiqueta="Hora del servidor" valor={fecha(datos.hora_servidor)} />
              <Dato etiqueta="Activo hace" valor={`${datos.proceso.activo_minutos} min`} />
              <Dato etiqueta="Python" valor={datos.proceso.python} />
              <Dato etiqueta="Django" valor={datos.proceso.django} />
              <Dato etiqueta="Cierre por inactividad" valor={`${datos.configuracion.inactividad_minutos} min`} />
              <Dato etiqueta="Segundo factor reciente" valor={`${datos.configuracion.mfa_ventana_minutos} min`} />
              <Dato etiqueta="Vida del token de acceso" valor={`${Math.round(datos.configuracion.access_ttl_segundos / 60)} min`} />
            </div>
          </section>
          <section className="panel">
            <div className="panel-cabecera"><h3>Certificado TLS de la plataforma</h3></div>
            <div className="rejilla-datos">
              <Dato etiqueta="Vence" valor={datos.certificado.vence} />
              <Dato etiqueta="Días restantes" valor={datos.certificado.dias_restantes} bien={datos.certificado.dias_restantes > 30} />
            </div>
          </section>
        </>
      )}
    </>
  )
}
