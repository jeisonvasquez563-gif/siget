import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, ApiError } from './api.js'
import { ACCIONES_EVENTO, Alerta, Cargando, ESTADOS, Estado, SIGUIENTES, diasRestantes, fecha, mensajeDe, useReautenticacion } from './comun.jsx'

function useTramites() {
  const [filas, setFilas] = useState(null)
  const [error, setError] = useState('')
  const cargar = useCallback(async () => {
    setError('')
    try {
      const d = await api('/tramites/?limite=100')
      setFilas(d.resultados)
    } catch (e) {
      setError(mensajeDe(e))
      setFilas([])
    }
  }, [])
  useEffect(() => { cargar() }, [cargar])
  return { filas, error, cargar }
}

function Tabla({ filas, yo, alAbrir, vacio }) {
  if (!filas.length) return <p className="vacio">{vacio}</p>
  return (
    <div className="tabla-envoltura">
      <table>
        <thead>
          <tr><th>N.º</th><th>Trámite</th><th>Institución</th><th>Estado</th><th>Plazo</th><th>Asignación</th></tr>
        </thead>
        <tbody>
          {filas.map((t) => (
            <tr key={t.id} onClick={() => alAbrir(t.id)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && alAbrir(t.id)}>
              <td>#{t.id}</td>
              <td>{t.tipo_tramite.nombre}</td>
              <td>{t.institucion.nombre}</td>
              <td><Estado valor={t.estado} /></td>
              <td className={t.vencido ? 'vencido' : ''}>{diasRestantes(t.fecha_limite, t.vencido)}</td>
              <td>{asignacion(t, yo)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function asignacion(t, yo) {
  if ('asignado' in t) return t.asignado ? 'En atención' : 'En cola'
  if (!t.funcionario_asignado_id) return 'Sin asignar'
  return t.funcionario_asignado_id === yo.id ? 'Asignado a mí' : `Funcionario #${t.funcionario_asignado_id}`
}

// El personal también puede ser solicitante: "Mis trámites" son los que él pidió; el resto es de la bandeja.
const esMio = (t, yo) => !('solicitante_id' in t) || t.solicitante_id === yo.id

export function MisTramites({ yo, abrir, nuevo }) {
  const { filas, error } = useTramites()
  const mios = useMemo(() => (filas || []).filter((t) => esMio(t, yo)), [filas, yo])
  return (
    <>
      <div className="encabezado-vista">
        <div><h2>Mis trámites</h2><p>Lo que iniciaste y en qué etapa va cada trámite.</p></div>
        <button onClick={nuevo}>＋ Iniciar un trámite</button>
      </div>
      <Alerta>{error}</Alerta>
      {filas === null ? <Cargando /> : <Tabla filas={mios} yo={yo} alAbrir={abrir} vacio="Aún no iniciaste ningún trámite." />}
    </>
  )
}

export function NuevoTramite({ abrir }) {
  const [instituciones, setInstituciones] = useState(null)
  const [tipos, setTipos] = useState([])
  const [institucion, setInstitucion] = useState('')
  const [tipo, setTipo] = useState('')
  const [error, setError] = useState('')
  const [trabajando, setTrabajando] = useState(false)

  useEffect(() => { api('/catalogo/instituciones/').then(setInstituciones).catch((e) => setError(mensajeDe(e))) }, [])
  useEffect(() => {
    setTipo('')
    if (!institucion) { setTipos([]); return }
    api(`/catalogo/tipos-tramite/?institucion=${institucion}`).then(setTipos).catch((e) => setError(mensajeDe(e)))
  }, [institucion])

  async function crear(ev) {
    ev.preventDefault()
    setError('')
    setTrabajando(true)
    try {
      const t = await api('/tramites/', { metodo: 'POST', cuerpo: { tipo_tramite: Number(tipo) } })
      abrir(t.id)
    } catch (e) {
      setError(mensajeDe(e))
      setTrabajando(false)
    }
  }

  const elegido = tipos.find((t) => String(t.id) === tipo)
  return (
    <>
      <div className="encabezado-vista"><div><h2>Iniciar un trámite</h2><p>Elige la institución y el trámite del catálogo.</p></div></div>
      <Alerta>{error}</Alerta>
      {instituciones === null ? <Cargando /> : (
        <form className="formulario" onSubmit={crear}>
          <label>
            Institución
            <select value={institucion} onChange={(e) => setInstitucion(e.target.value)} required>
              <option value="">Selecciona…</option>
              {instituciones.map((i) => <option key={i.id} value={i.id}>{i.nombre}{i.tipo === 'demostracion' ? ' (demostración)' : ''}</option>)}
            </select>
          </label>
          <label>
            Trámite
            <select value={tipo} onChange={(e) => setTipo(e.target.value)} required disabled={!tipos.length}>
              <option value="">Selecciona…</option>
              {tipos.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
            </select>
          </label>
          {elegido && <p className="nota">Plazo de atención: <strong>{elegido.sla_dias} días</strong>. Recibirás el seguimiento de cada paso, con quién lo hizo y cuándo.</p>}
          <button type="submit" disabled={!tipo || trabajando}>Iniciar trámite</button>
        </form>
      )}
    </>
  )
}

export function Bandeja({ yo, abrir, modo }) {
  const { filas, error } = useTramites()
  const [filtro, setFiltro] = useState('abiertos')
  const supervision = modo === 'supervision'
  const ajenos = useMemo(() => (filas || []).filter((t) => !esMio(t, yo)), [filas, yo])
  const visibles = useMemo(() => ajenos.filter((t) => {
    const abierto = t.estado !== 'Aprobado' && t.estado !== 'Rechazado'
    if (filtro === 'abiertos') return abierto
    if (filtro === 'sin_asignar') return abierto && !t.funcionario_asignado_id
    if (filtro === 'vencidos') return t.vencido
    if (filtro === 'mios') return t.funcionario_asignado_id === yo.id
    return true
  }), [ajenos, filtro, yo])
  const cuenta = (f) => ajenos.filter(f).length
  const filtros = supervision
    ? [['abiertos', 'Abiertos'], ['sin_asignar', 'Sin asignar'], ['vencidos', 'Vencidos'], ['todos', 'Todos']]
    : [['abiertos', 'Abiertos'], ['mios', 'Asignados a mí'], ['vencidos', 'Vencidos'], ['todos', 'Todos']]
  return (
    <>
      <div className="encabezado-vista">
        <div>
          <h2>{supervision ? 'Supervisión' : 'Bandeja de la institución'}</h2>
          <p>{supervision ? 'Tramites de tu institución: detecta los vencidos y reasígnalos.' : 'Trámites de las instituciones donde trabajas. La base de datos solo te devuelve los de tu institución.'}</p>
        </div>
      </div>
      <div className="resumen">
        <div><strong>{cuenta((t) => t.estado === 'Pendiente')}</strong><span>Pendientes</span></div>
        <div><strong>{cuenta((t) => t.estado === 'En Tramitacion')}</strong><span>En tramitación</span></div>
        <div><strong>{cuenta((t) => t.estado === 'En Subsanacion')}</strong><span>En subsanación</span></div>
        <div className={cuenta((t) => t.vencido) ? 'alerta-num' : ''}><strong>{cuenta((t) => t.vencido)}</strong><span>Vencidos</span></div>
      </div>
      <div className="filtros" role="group" aria-label="Filtrar">
        {filtros.map(([k, n]) => <button key={k} className={filtro === k ? 'activa' : 'secundario'} onClick={() => setFiltro(k)}>{n}</button>)}
      </div>
      <Alerta>{error}</Alerta>
      {filas === null ? <Cargando /> : <Tabla filas={visibles} yo={yo} alAbrir={abrir} vacio="No hay trámites en esta vista." />}
    </>
  )
}

export function Detalle({ id, yo, volver }) {
  const [tramite, setTramite] = useState(null)
  const [eventos, setEventos] = useState([])
  const [personal, setPersonal] = useState([])
  const [error, setError] = useState('')
  const [ok, setOk] = useState('')
  const { ejecutar, modal } = useReautenticacion()

  const cargar = useCallback(async () => {
    try {
      const [t, h] = await Promise.all([api(`/tramites/${id}/`), api(`/tramites/${id}/historial/`)])
      setTramite(t)
      setEventos(h.eventos)
      setError('')
    } catch (e) {
      setError(mensajeDe(e))
      setTramite(false)
    }
  }, [id])
  useEffect(() => { cargar() }, [cargar])

  const esPersonal = tramite && 'solicitante_id' in tramite
  const esSupervisor = esPersonal && yo.membresias.some((m) => m.institucion_id === tramite.institucion.id && m.rol === 'supervisor')
  const esPropio = esPersonal && tramite.solicitante_id === yo.id

  useEffect(() => {
    if (!esSupervisor) return
    api('/equipo/').then((d) => {
      const eq = d.equipos.find((e) => e.institucion.id === tramite.institucion.id)
      setPersonal((eq ? eq.personal : []).filter((p) => p.rol === 'funcionario' || p.rol === 'supervisor'))
    }).catch(() => setPersonal([]))
  }, [esSupervisor, tramite])

  async function accion(f, mensaje) {
    setError('')
    setOk('')
    // Se ejecuta de nuevo tras la reautenticación, así que maneja sus propios errores (salvo el que pide reautenticar)
    await ejecutar(async () => {
      try {
        await f()
        await cargar()
        setOk(mensaje)
      } catch (e) {
        if (e instanceof ApiError && e.pideReautenticar) throw e
        setError(mensajeDe(e))
      }
    })
  }

  const cambiar = (estado) => accion(() => api(`/tramites/${id}/estado/`, { metodo: 'POST', cuerpo: { estado } }), `Estado actualizado a «${ESTADOS[estado].texto}».`)
  const reasignar = (funcionario) => accion(() => api(`/tramites/${id}/reasignar/`, { metodo: 'POST', cuerpo: { funcionario_id: funcionario ? Number(funcionario) : null } }), 'Trámite reasignado.')

  if (tramite === null) return <Cargando />
  if (tramite === false) return <><button className="secundario" onClick={volver}>← Volver</button><Alerta>{error}</Alerta></>

  const nombreDe = (uid) => personal.find((p) => p.usuario_id === uid)?.usuario
  return (
    <>
      <button className="secundario" onClick={volver}>← Volver</button>
      <div className="encabezado-vista">
        <div><h2>Trámite #{tramite.id} · {tramite.tipo_tramite.nombre}</h2><p>{tramite.institucion.nombre}</p></div>
        <Estado valor={tramite.estado} />
      </div>
      <Alerta>{error}</Alerta>
      <Alerta tipo="ok">{ok}</Alerta>
      <div className="rejilla-detalle">
        <section className="panel">
          <h3>Datos</h3>
          <dl>
            <dt>Creado</dt><dd>{fecha(tramite.creado_en)}</dd>
            <dt>Fecha límite</dt><dd className={tramite.vencido ? 'vencido' : ''}>{fecha(tramite.fecha_limite)} · {diasRestantes(tramite.fecha_limite, tramite.vencido)}</dd>
            {esPersonal ? (
              <>
                <dt>Solicitante</dt><dd>Persona #{tramite.solicitante_id}{esPropio ? ' (tú)' : ''}</dd>
                <dt>Atiende</dt><dd>{tramite.funcionario_asignado_id ? (nombreDe(tramite.funcionario_asignado_id) || `Funcionario #${tramite.funcionario_asignado_id}`) : 'Sin asignar'}</dd>
                <dt>Sensibilidad</dt><dd>Nivel {tramite.sensibilidad}</dd>
              </>
            ) : (
              <><dt>Atención</dt><dd>{tramite.asignado ? 'Un funcionario lo está atendiendo' : 'En cola de la institución'}</dd></>
            )}
          </dl>
          {esPersonal && !esPropio && (
            <>
              <h3>Acciones</h3>
              {SIGUIENTES[tramite.estado].length === 0 ? <p className="nota">Estado final: no admite más cambios.</p> : (
                <div className="fila-botones inicio">
                  {SIGUIENTES[tramite.estado].map((s) => <button key={s} className={s === 'Rechazado' ? 'peligro' : ''} onClick={() => cambiar(s)}>Pasar a «{ESTADOS[s].texto}»</button>)}
                </div>
              )}
              {esSupervisor && (
                <label className="reasignar">
                  Reasignar a
                  <select value="" onChange={(e) => reasignar(e.target.value)}>
                    <option value="">Elegir persona…</option>
                    {personal.map((p) => <option key={p.usuario_id} value={p.usuario_id}>{p.usuario} ({p.rol})</option>)}
                  </select>
                </label>
              )}
              <p className="nota">Los botones son una ayuda: el servidor decide cada cambio (segundo factor reciente, conflicto de interés, asignación) y la base de datos valida la transición.</p>
            </>
          )}
          {esPropio && <p className="nota">Este trámite lo pediste tú: por conflicto de interés no puedes gestionarlo como funcionario.</p>}
        </section>
        <section className="panel">
          <h3>Historial</h3>
          <ol className="linea-tiempo">
            {eventos.map((e) => (
              <li key={e.id}>
                <strong>{ACCIONES_EVENTO[e.accion] || e.accion}</strong>
                {e.estado_nuevo && e.estado_anterior !== e.estado_nuevo && <span> · {e.estado_anterior ? `${ESTADOS[e.estado_anterior]?.texto} → ` : ''}{ESTADOS[e.estado_nuevo]?.texto}</span>}
                <time>{fecha(e.creado_en)}</time>
                {'actor_id' in e && <small>Por persona #{e.actor_id}{e.accion === 'reasignacion' && e.atributos ? ` · a #${e.atributos.a ?? '—'}` : ''}</small>}
              </li>
            ))}
          </ol>
          {!esPersonal && <p className="nota">El historial es inalterable; por privacidad no muestra qué funcionario actuó.</p>}
        </section>
      </div>
      {modal}
    </>
  )
}
