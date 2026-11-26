import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from './api.js'
import { Paginacion, fecha, fechaCorta, hace, mensajeDe, useModal, useReautenticacion } from './comun.jsx'
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
  const [pideCodigo, setPideCodigo] = useState(false)
  const recargar = useCallback(() => api(ruta).then((d) => { setDatos(d); setError(''); setPideCodigo(false) })
    .catch((e) => { setPideCodigo(e instanceof ApiError && e.pideReautenticar); setError(mensaje(e)) }), [ruta])
  useEffect(() => { recargar() }, [recargar])
  return { datos, error, recargar, pideCodigo }
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

function CodigoEmitido({ datos, alCerrar, titulo = 'Código de restablecimiento', texto }) {
  const [copiado, setCopiado] = useState(false)
  async function copiar() {
    try { await navigator.clipboard.writeText(datos.codigo); setCopiado(true) } catch { /* sin portapapeles: se lee en pantalla */ }
  }
  return (
    <div className="fondo-modal">
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="titulo-codigo">
        <h2 id="titulo-codigo"><span className="icono-grande"><Icono nombre="llave" /></span>{titulo}</h2>
        <p className="suave">{texto || <>Entrégaselo a <strong>{datos.usuario}</strong> por un canal seguro (en persona o por teléfono). Sirve una sola vez y vence en 15 minutos.</>} <strong>No se vuelve a mostrar.</strong></p>
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

/* ---------------------------------------------------------------- solicitudes sobre datos personales (Ley 81) */

const TIPO_SOLICITUD = { rectificacion: 'Rectificación', cancelacion: 'Cancelación', oposicion: 'Oposición' }
const ESTADO_SOLICITUD = { recibida: ['e-pendiente', 'Recibida'], atendida: ['e-aprobado', 'Atendida'], rechazada: ['e-rechazado', 'Rechazada'] }

function ModalRespuesta({ solicitud, error, alCancelar, alEnviar }) {
  useModal(alCancelar)
  const [estado, setEstado] = useState('atendida')
  const [respuesta, setRespuesta] = useState('')
  const [enviando, setEnviando] = useState(false)
  async function enviar(e) {
    e.preventDefault()
    setEnviando(true)
    try { await alEnviar(estado, respuesta.trim()) } finally { setEnviando(false) } // el modal sigue abierto (con el texto) hasta que el servidor responda 2xx
  }
  return (
    <div className="fondo-modal">
      <form className="modal" role="dialog" aria-modal="true" aria-labelledby="titulo-respuesta" onSubmit={enviar}>
        <h2 id="titulo-respuesta"><span className="icono-grande"><Icono nombre="documento" /></span>Responder a {solicitud.persona.usuario}</h2>
        <p className="suave"><strong>{TIPO_SOLICITUD[solicitud.tipo] ?? solicitud.tipo}:</strong> {solicitud.detalle}</p>
        <p className="suave">Esta respuesta <strong>no borra ni cambia nada</strong>: solo queda registrada. Explica con claridad qué se puede hacer y qué no (los trámites son expediente público con conservación obligatoria). Quien la pidió la verá tal cual.</p>
        <Alerta>{error}</Alerta>
        <fieldset className="campo opciones">
          <legend>Resultado</legend>
          <label className="casilla"><input type="radio" name="resultado" value="atendida" checked={estado === 'atendida'} onChange={() => setEstado('atendida')} /><span>Atendida</span></label>
          <label className="casilla"><input type="radio" name="resultado" value="rechazada" checked={estado === 'rechazada'} onChange={() => setEstado('rechazada')} /><span>Rechazada</span></label>
        </fieldset>
        <label className="campo"><span>Respuesta para la persona</span>
          <textarea className="entrada" value={respuesta} onChange={(e) => setRespuesta(e.target.value)} rows={5} minLength={10} maxLength={2000} required autoFocus />
          <small>Entre 10 y 2000 caracteres ({respuesta.trim().length}/2000).</small>
        </label>
        <div className="fila-botones">
          <button type="button" className="btn btn-sec" onClick={alCancelar}>Cancelar</button>
          <button type="submit" className="btn" disabled={respuesta.trim().length < 10 || enviando}>Enviar respuesta</button>
        </div>
      </form>
    </div>
  )
}

function SolicitudesDatos({ yo }) {
  const [filtro, setFiltro] = useState('')
  const ruta = `/plataforma/solicitudes-datos/${filtro ? `?estado=${filtro}` : ''}`
  const { datos, error, recargar, pideCodigo } = useCarga(ruta)
  const { correr, modal, error: errorAccion, limpiar } = useAccion(recargar)
  const [objetivo, setObjetivo] = useState(null)

  return (
    <section className="panel">
      {objetivo && <ModalRespuesta solicitud={objetivo} error={errorAccion} alCancelar={() => { limpiar(); setObjetivo(null) }}
        alEnviar={(estado, respuesta) => correr(async () => {
          const r = await api(`/plataforma/solicitudes-datos/${objetivo.id}/responder/`, { metodo: 'POST', cuerpo: { estado, respuesta } })
          setObjetivo(null) // solo se cierra con un 2xx: si falla, el texto escrito sigue ahí
          return r
        }, `Respuesta enviada a ${objetivo.persona.usuario}.`)} />}
      {modal}
      <div className="panel-cabecera">
        <h3>Solicitudes sobre datos personales</h3>
        <label className="campo filtro-estado"><span className="solo-lector">Filtrar por estado</span>
          <select className="entrada" value={filtro} onChange={(e) => setFiltro(e.target.value)}>
            <option value="">Todas</option><option value="recibida">Recibidas</option><option value="atendida">Atendidas</option><option value="rechazada">Rechazadas</option>
          </select>
        </label>
      </div>
      <p className="suave">Rectificación, cancelación y oposición que piden las personas (Ley 81 de 2019). Hay que responder en no más de 10 días hábiles. <strong>Cancelar no borra nada automáticamente:</strong> los trámites son expediente público con conservación obligatoria, así que tu respuesta explica qué se puede eliminar y qué no. Solo ves quién pide por su usuario, nunca sus datos ni sus trámites.</p>
      {!pideCodigo && <Alerta>{error}</Alerta>}
      {!objetivo && <Alerta>{errorAccion}</Alerta>}
      {pideCodigo ? (
        <Alerta tipo="info">
          Estas solicitudes piden que hayas verificado tu segundo factor hace poco.{' '}
          <button className="btn btn-sec" type="button" onClick={() => correr(() => api(ruta))}>Verificar segundo factor</button>
        </Alerta>
      ) : !datos ? <BloquesEsqueleto n={2} /> : (
        <>
          <p className="resumen-solicitudes" role="status">{datos.resumen.recibidas} {datos.resumen.recibidas === 1 ? 'abierta' : 'abiertas'}{datos.resumen.vencidas > 0 && <> · <strong className="vencidas">{datos.resumen.vencidas} {datos.resumen.vencidas === 1 ? 'vencida' : 'vencidas'}</strong></>}</p>
          {datos.solicitudes.length === 0 ? <Vacio titulo="Sin solicitudes" texto="Cuando alguien pida algo sobre sus datos personales aparecerá aquí." /> : (
            <ul className="lista-solicitudes">
              {datos.solicitudes.map((s) => {
                const [clase, texto] = ESTADO_SOLICITUD[s.estado] ?? ['', s.estado]
                const propia = s.persona.id === yo.id
                return (
                  <li key={s.id}>
                    <div className="cabecera-solicitud">
                      <strong>{s.persona.usuario}{propia && ' (eres tú)'}</strong>
                      <span className="suave">{TIPO_SOLICITUD[s.tipo] ?? s.tipo}</span>
                      <Insignia clase={clase}>{texto}</Insignia>
                      {s.vencida && <Insignia clase="e-rechazado">Vencida</Insignia>}
                    </div>
                    <p className="detalle-solicitud">{s.detalle}</p>
                    <small>Recibida {hace(s.creada_en)} · {s.estado === 'recibida' ? `vence el ${fechaCorta(s.vence_en)}` : `respondida ${hace(s.respondida_en)} por ${s.respondida_por?.usuario}`}</small>
                    {s.respuesta && <blockquote className="respuesta-solicitud"><strong>Respuesta</strong><p>{s.respuesta}</p></blockquote>}
                    {s.estado === 'recibida' && (propia
                      ? <span className="suave">No puedes responder tu propia solicitud: lo debe hacer otra persona.</span>
                      : <div className="acciones-fila"><button className="btn" onClick={() => setObjetivo(s)}>Responder</button></div>)}
                  </li>
                )
              })}
            </ul>
          )}
        </>
      )}
    </section>
  )
}

const MODO_REGISTRO = {
  abierto: 'Abierto: cualquiera puede crear su cuenta. Las invitaciones no son necesarias.',
  invitacion: 'Por invitación: solo se crean cuentas con un código que emites aquí.',
  cerrado: 'Cerrado: nadie puede crear cuentas desde la web.',
}

function PanelInvitaciones({ correr }) {
  const { datos, recargar } = useCarga('/plataforma/invitaciones/')
  const [nota, setNota] = useState('')
  const [emitida, setEmitida] = useState(null)
  return (
    <section className="panel" aria-labelledby="titulo-invitaciones">
      {emitida && <CodigoEmitido datos={emitida} alCerrar={() => setEmitida(null)} titulo="Invitación para crear cuenta"
        texto={<>Entrégala por un canal seguro{emitida.nota ? <> ({emitida.nota})</> : null}. Sirve para crear <strong>una</strong> cuenta y vence el {new Date(emitida.vence_en).toLocaleDateString('es-PA')}.</>} />}
      <div className="panel-cabecera"><h3 id="titulo-invitaciones">Invitaciones para crear cuenta</h3></div>
      {datos && <p className="suave">Registro hoy: {MODO_REGISTRO[datos.modo_registro] || datos.modo_registro}</p>}
      <form className="formulario-fila" onSubmit={async (e) => {
        e.preventDefault()
        const r = await correr(() => api('/plataforma/invitaciones/', { metodo: 'POST', cuerpo: { nota } }))
        if (r) { setEmitida({ codigo: r.codigo_invitacion, vence_en: r.vence_en, nota }); setNota(''); recargar() }
      }}>
        <label className="campo"><span>Para quién (sin datos personales)</span>
          <input className="entrada" value={nota} onChange={(e) => setNota(e.target.value)} maxLength={120} placeholder="Ej.: prueba con el grupo B" />
        </label>
        <button className="btn" type="submit">Emitir invitación</button>
      </form>
      {datos && datos.invitaciones.length > 0 && (
        <div className="tabla-caja">
          <table className="tabla">
            <thead><tr><th>N.º</th><th>Nota</th><th>Emitida</th><th>Vence</th><th>Estado</th></tr></thead>
            <tbody>
              {datos.invitaciones.map((i) => (
                <tr key={i.id}>
                  <td className="num">#{i.id}</td>
                  <td>{i.nota || '—'}</td>
                  <td>{new Date(i.creado_en).toLocaleDateString('es-PA')}</td>
                  <td>{new Date(i.vence_en).toLocaleDateString('es-PA')}</td>
                  <td>{{ vigente: 'Vigente', usada: 'Usada', vencida: 'Vencida' }[i.estado]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="nota">El código solo se muestra al emitirlo: en la base queda una huella irreversible. Una invitación usada o vencida no vuelve a servir.</p>
    </section>
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
      <Encabezado titulo="Identidades" texto="Ayuda a recuperar una cuenta, da de alta a las coordinadoras de las instituciones con control dual y responde las solicitudes sobre datos personales. No ves trámites ni datos personales de nadie." />
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
      <PanelInvitaciones correr={correr} />
      <PanelAprobaciones yo={yo} titulo="Altas de coordinadoras" nuevo="Proponer el alta de una coordinadora"
        resumen={(o) => `Alta de ${o.usuario} como coordinadora (institución n.º ${o.institucion_id})`}
        formulario={(props) => <FormularioAltaCoordinador {...props} />} />
      <SolicitudesDatos yo={yo} />
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

/* ---------------------------------------------------------------- alertas de seguridad (PT-10) */

// Lo que significa cada regla, en lenguaje llano. El detector (base de datos) cuenta eventos; aquí solo se explica lo que respondió.
const REGLA_ALERTA = {
  rafaga_login_fallido_ip: ['Ráfaga de inicios de sesión fallidos', 'Muchos intentos fallidos de entrar o de cambiar la contraseña desde una misma dirección.'],
  denegaciones_persona: ['Muchas denegaciones de acceso a una persona', 'El sistema negó varias veces el acceso a la misma persona en pocos minutos.'],
  reuso_token_refresco: ['Reuso de un token de sesión', 'Alguien volvió a usar un token de sesión ya gastado: puede ser un robo de sesión.'],
  bloqueos_repetidos: ['Cuenta bloqueada varias veces', 'La misma cuenta se bloqueó por intentos fallidos más de una vez en un día.'],
}
const SEVERIDAD_ALERTA = { alta: ['e-rechazado', 'Alta'], media: ['e-pendiente', 'Media'] }
const ESTADO_ALERTA = { abierta: ['e-pendiente', 'Abierta'], revisada: ['e-aprobado', 'Revisada'], descartada: ['', 'Descartada'] }
const TAM_ALERTAS = 10

function ventanaDe(minutos) {
  if (minutos % 1440 === 0) return minutos === 1440 ? '24 horas' : `${minutos / 1440} días`
  return `${minutos} minutos`
}

function ModalRevision({ alerta, error, alCancelar, alEnviar }) {
  const [estado, setEstado] = useState('revisada')
  const [nota, setNota] = useState('')
  const [enviando, setEnviando] = useState(false)
  const cancelar = () => { if (!enviando) alCancelar() } // con el POST en curso no se cierra: se perdería el resultado y la nota
  useModal(cancelar)
  async function enviar(e) {
    e.preventDefault()
    setEnviando(true)
    try { await alEnviar(estado, nota.trim()) } finally { setEnviando(false) } // el modal sigue abierto (con la nota) hasta que el servidor responda 2xx
  }
  const [titulo] = REGLA_ALERTA[alerta.regla] ?? [alerta.regla]
  return (
    <div className="fondo-modal">
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="titulo-revision">
        <form onSubmit={enviar}>
        <h2 id="titulo-revision"><span className="icono-grande"><Icono nombre="escudo" /></span>Revisar la alerta</h2>
        <p className="suave"><strong>{titulo}.</strong> {alerta.persona ? `Persona: ${alerta.persona.usuario}. ` : ''}{alerta.ip ? `Dirección: ${alerta.ip}. ` : ''}{alerta.conteo} {alerta.conteo === 1 ? 'evento' : 'eventos'}.</p>
        <p className="suave">La revisión queda registrada a tu nombre y <strong>no se puede cambiar después</strong>. Escribe qué comprobaste y qué hiciste (por ejemplo, bloquear la cuenta o descartar un falso positivo).</p>
        <Alerta>{error}</Alerta>
        <fieldset className="campo opciones">
          <legend>Resultado</legend>
          <label className="casilla"><input type="radio" name="resultado-alerta" value="revisada" checked={estado === 'revisada'} onChange={() => setEstado('revisada')} /><span>Revisada: era real o merecía atención</span></label>
          <label className="casilla"><input type="radio" name="resultado-alerta" value="descartada" checked={estado === 'descartada'} onChange={() => setEstado('descartada')} /><span>Descartada: falso positivo</span></label>
        </fieldset>
        <label className="campo"><span>Nota</span>
          <textarea className="entrada" value={nota} onChange={(e) => setNota(e.target.value)} rows={4} minLength={3} maxLength={1000} required autoFocus />
          <small>Entre 3 y 1000 caracteres ({nota.trim().length}/1000). No escribas contraseñas ni datos personales.</small>
        </label>
        <div className="fila-botones">
          <button type="button" className="btn btn-sec" onClick={cancelar} disabled={enviando}>Cancelar</button>
          <button type="submit" className="btn" disabled={nota.trim().length < 3 || enviando}>Guardar revisión</button>
        </div>
        </form>
      </div>
    </div>
  )
}

// `soloLectura`: el auditor ve las alertas pero no las revisa (el servidor tampoco se lo permitiría)
export function PanelAlertas({ soloLectura = false }) {
  const [filtro, setFiltro] = useState('abierta')
  const [pagina, setPagina] = useState(0)
  const ruta = `/plataforma/alertas/?limite=${TAM_ALERTAS}&desplazamiento=${pagina * TAM_ALERTAS}${filtro ? `&estado=${filtro}` : ''}`
  const { datos, error, recargar, pideCodigo } = useCarga(ruta)
  const { correr, modal, error: errorAccion, limpiar } = useAccion(recargar)
  const [objetivo, setObjetivo] = useState(null)

  // Si al revisar se vació la última página, se vuelve a la anterior
  useEffect(() => { if (datos && datos.resultados.length === 0 && pagina > 0) setPagina(pagina - 1) }, [datos, pagina])

  return (
    <section className="panel" aria-labelledby="titulo-alertas">
      {objetivo && <ModalRevision alerta={objetivo} error={errorAccion} alCancelar={() => { limpiar(); setObjetivo(null) }}
        alEnviar={(estado, nota) => correr(async () => {
          const r = await api(`/plataforma/alertas/${objetivo.id}/revisar/`, { metodo: 'POST', cuerpo: { estado, nota } })
          setObjetivo(null) // solo se cierra con un 2xx: si falla, la nota escrita sigue ahí
          return r
        }, estado === 'revisada' ? 'Alerta revisada.' : 'Alerta descartada.')} />}
      {modal}
      <div className="panel-cabecera">
        <h3 id="titulo-alertas">Alertas de seguridad</h3>
        <label className="campo filtro-estado"><span className="solo-lector">Filtrar alertas por estado</span>
          <select className="entrada" value={filtro} onChange={(e) => { setFiltro(e.target.value); setPagina(0) }}>
            <option value="abierta">Abiertas</option><option value="revisada">Revisadas</option><option value="descartada">Descartadas</option><option value="">Todas</option>
          </select>
        </label>
      </div>
      <p className="suave">Cada 5 minutos el sistema busca patrones sospechosos en los eventos de seguridad y deja una alerta. Solo muestra contadores y nombres de eventos: nunca contraseñas ni datos personales.{soloLectura && ' Aquí solo puedes leerlas: las revisa el operador de seguridad.'}</p>
      {!pideCodigo && <Alerta>{error}</Alerta>}
      {!objetivo && <Alerta>{errorAccion}</Alerta>}
      {pideCodigo ? (
        <Alerta tipo="info">
          Las alertas piden que hayas verificado tu segundo factor hace poco.{' '}
          <button className="btn btn-sec" type="button" onClick={() => correr(() => api(ruta))}>Verificar segundo factor</button>
        </Alerta>
      ) : !datos ? <BloquesEsqueleto n={2} /> : (
        <>
          <p className="resumen-solicitudes" role="status">{datos.abiertas} {datos.abiertas === 1 ? 'alerta abierta' : 'alertas abiertas'}</p>
          {datos.resultados.length === 0 ? <Vacio titulo="Sin alertas" texto={filtro === 'abierta' ? 'No hay alertas abiertas. Si aparece un patrón sospechoso, lo verás aquí.' : 'Ninguna alerta coincide con ese estado.'} /> : (
            <>
              <div className="tabla-caja">
                <table className="tabla apilada">
                  <caption className="solo-lector">Alertas de seguridad</caption>
                  <thead><tr><th scope="col">Alerta</th><th scope="col">Persona o dirección</th><th scope="col">Eventos</th><th scope="col">Primera vez</th><th scope="col">Última vez</th><th scope="col">Estado</th>{!soloLectura && <th scope="col">Acciones</th>}</tr></thead>
                  <tbody>
                    {datos.resultados.map((a) => {
                      const [titulo, explicacion] = REGLA_ALERTA[a.regla] ?? [a.regla, '']
                      const [claseSeveridad, textoSeveridad] = SEVERIDAD_ALERTA[a.severidad] ?? ['', a.severidad]
                      const [claseEstado, textoEstado] = ESTADO_ALERTA[a.estado] ?? ['', a.estado]
                      const porNombre = Object.entries(a.detalle?.por_nombre ?? {})
                      return (
                        <tr key={a.id}>
                          <th scope="row">{titulo}<Insignia clase={claseSeveridad} punto={false}>{textoSeveridad}</Insignia><small>{explicacion}</small>
                            {a.detalle?.umbral && <small>Se avisa con {a.detalle.umbral} o más en {ventanaDe(a.detalle.ventana_minutos)}{porNombre.length > 0 && <>: {porNombre.map(([nombre, n]) => `${nombre} ×${n}`).join(', ')}</>}.</small>}
                          </th>
                          <td data-etiqueta="Persona o dirección">{a.persona ? a.persona.usuario : null}{a.persona && a.ip ? ' · ' : null}{a.ip ? <code>{a.ip}</code> : null}{!a.persona && !a.ip ? '—' : null}</td>
                          <td data-etiqueta="Eventos">{a.conteo}</td>
                          <td data-etiqueta="Primera vez" title={fecha(a.primera_vez)}>{hace(a.primera_vez)}</td>
                          <td data-etiqueta="Última vez" title={fecha(a.ultima_vez)}>{hace(a.ultima_vez)}</td>
                          <td data-etiqueta="Estado"><Insignia clase={claseEstado}>{textoEstado}</Insignia>
                            {a.revisada_por && <small>Por {a.revisada_por.usuario} · {hace(a.revisada_en)}</small>}
                            {a.nota && <small>Nota: {a.nota}</small>}
                          </td>
                          {!soloLectura && <td data-etiqueta="Acciones"><div className="acciones-fila">{a.estado === 'abierta' ? <button className="btn btn-sec" onClick={() => setObjetivo(a)}>Revisar</button> : <span className="suave">—</span>}</div></td>}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <Paginacion total={datos.total} tamano={TAM_ALERTAS} pagina={pagina} cambiar={setPagina} unidad="alertas" />
            </>
          )}
        </>
      )}
    </section>
  )
}

/* ---------------------------------------------------------------- seguridad */

function ModalMotivo({ persona, alCancelar, alEnviar }) {
  useModal(alCancelar)
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
      <Encabezado titulo="Respuesta a incidentes" texto="Bloquea cuentas, cierra sesiones, revisa las alertas y mira los eventos de seguridad recientes. No puedes ver trámites ni cambiar contraseñas." />
      {modal}
      {objetivo && <ModalMotivo persona={objetivo.p} alCancelar={() => setObjetivo(null)}
        alEnviar={async (motivo) => { const { p, recargar } = objetivo; setObjetivo(null); await hacer(p, 'bloquear', { motivo }, `${p.usuario} quedó bloqueada.`, recargar) }} />}
      <Alerta>{error}</Alerta>
      <PanelAlertas />
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
