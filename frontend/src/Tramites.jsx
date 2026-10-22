import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, ApiError } from './api.js'
import { ACCIONES_EVENTO, ESTADOS, Estado, FINALES, Plazo, SIGUIENTES, fecha, fechaCorta, hace, mensajeDe, useReautenticacion } from './comun.jsx'
import { Seguimiento } from './Seguimiento.jsx'
import { Alerta, Esqueleto, Icono, Insignia, BloquesEsqueleto, Vacio, useUI } from './ui.jsx'

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

// El personal también puede ser solicitante: «Mis trámites» son los que él pidió; el resto es de la bandeja.
export const esMio = (t, yo) => !('solicitante_id' in t) || t.solicitante_id === yo.id
const esAbierto = (t) => !FINALES.includes(t.estado)

function coincide(t, q) {
  if (!q) return true
  const texto = `${t.id} ${t.tipo_tramite.nombre} ${t.institucion.nombre} ${ESTADOS[t.estado]?.texto || ''}`.toLowerCase()
  return q.toLowerCase().split(/\s+/).every((p) => texto.includes(p))
}

function Buscador({ valor, cambiar, etiqueta = 'Buscar por número, trámite o institución' }) {
  return (
    <div className="buscador">
      <Icono nombre="buscar" />
      <input className="entrada entrada-buscar" type="search" value={valor} onChange={(e) => cambiar(e.target.value)} placeholder={etiqueta} aria-label={etiqueta} />
    </div>
  )
}

function atiende(t, yo, nombres = {}) {
  if ('asignado' in t) return t.asignado ? 'En atención' : 'En cola'
  if (!t.funcionario_asignado_id) return <span className="tenue">Sin asignar</span>
  if (t.funcionario_asignado_id === yo.id) return <strong>Tú</strong>
  return nombres[t.funcionario_asignado_id] || `Persona #${t.funcionario_asignado_id}`
}

function Tabla({ filas, yo, abrir, nombres }) {
  return (
    <div className="tabla-caja">
      <table className="tabla">
        <thead><tr><th>N.º</th><th>Trámite</th><th>Estado</th><th>Plazo</th><th>Atiende</th></tr></thead>
        <tbody>
          {filas.map((t) => (
            <tr key={t.id} className="fila-enlace" tabIndex={0} onClick={() => abrir(t.id)} onKeyDown={(e) => e.key === 'Enter' && abrir(t.id)} aria-label={`Trámite ${t.id}: ${t.tipo_tramite.nombre}`}>
              <td className="num">#{t.id}</td>
              <td className="titulo-fila">{t.tipo_tramite.nombre}<small>{t.institucion.nombre}</small></td>
              <td><Estado valor={t.estado} /></td>
              <td><Plazo tramite={t} /></td>
              <td>{atiende(t, yo, nombres)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Indicador({ valor, texto, clase = '' }) {
  return <div className={`indicador ${clase}`}><strong>{valor}</strong><span>{texto}</span></div>
}

/* ---------------------------------------------------------------- mis trámites */

export function MisTramites({ yo, abrir, nuevo }) {
  const { filas, error } = useTramites()
  const [q, setQ] = useState('')
  const mios = useMemo(() => (filas || []).filter((t) => esMio(t, yo)), [filas, yo])
  const visibles = useMemo(() => mios.filter((t) => coincide(t, q)), [mios, q])
  const enCurso = mios.filter(esAbierto)
  const vencen = enCurso.filter((t) => t.vencido).length
  return (
    <>
      <div className="encabezado-vista">
        <div><h2>Mis trámites</h2><p>Lo que iniciaste y en qué etapa va cada uno.</p></div>
        <button className="btn" onClick={nuevo}><Icono nombre="mas" />Iniciar un trámite</button>
      </div>
      <Alerta>{error}</Alerta>
      {filas === null ? <><BloquesEsqueleto n={3} /><Esqueleto /></> : (
        <>
          <div className="indicadores">
            <Indicador valor={enCurso.length} texto="En curso" />
            <Indicador valor={mios.filter((t) => t.estado === 'Aprobado').length} texto="Aprobados" clase="ok-ind" />
            <Indicador valor={vencen} texto="Con el plazo vencido" clase={vencen ? 'alerta-ind' : ''} />
          </div>
          {mios.length === 0 ? (
            <Vacio titulo="Todavía no iniciaste ningún trámite" texto="Elige una institución y un trámite del catálogo. Podrás seguir cada etapa desde aquí." accion={<button className="btn" onClick={nuevo}><Icono nombre="mas" />Iniciar un trámite</button>} />
          ) : (
            <>
              <div className="barra-herramientas"><Buscador valor={q} cambiar={setQ} /></div>
              {visibles.length ? <Tabla filas={visibles} yo={yo} abrir={abrir} /> : <Vacio titulo="Nada coincide con tu búsqueda" texto="Prueba con otro número o con el nombre del trámite." />}
            </>
          )}
        </>
      )}
    </>
  )
}

/* ---------------------------------------------------------------- nuevo trámite */

export function NuevoTramite({ abrir }) {
  const [instituciones, setInstituciones] = useState(null)
  const [tipos, setTipos] = useState(null)
  const [institucion, setInstitucion] = useState(null)
  const [tipo, setTipo] = useState(null)
  const [error, setError] = useState('')
  const [trabajando, setTrabajando] = useState(false)
  const { avisar } = useUI()

  useEffect(() => { api('/catalogo/instituciones/').then(setInstituciones).catch((e) => setError(mensajeDe(e))) }, [])
  useEffect(() => {
    setTipo(null)
    setTipos(null)
    if (!institucion) return
    api(`/catalogo/tipos-tramite/?institucion=${institucion.id}`).then(setTipos).catch((e) => setError(mensajeDe(e)))
  }, [institucion])

  async function crear() {
    setError('')
    setTrabajando(true)
    try {
      const t = await api('/tramites/', { metodo: 'POST', cuerpo: { tipo_tramite: tipo.id } })
      avisar(`Tu trámite #${t.id} quedó registrado.`)
      abrir(t.id)
    } catch (e) {
      setError(mensajeDe(e))
      setTrabajando(false)
    }
  }

  return (
    <>
      <div className="encabezado-vista"><div><h2>Iniciar un trámite</h2><p>Dos pasos: la institución y el trámite. Verás el plazo antes de confirmar.</p></div></div>
      <Alerta>{error}</Alerta>
      <div className="nuevo">
        <div>
          <section className="panel">
            <div className="panel-cabecera"><h3>1. ¿Ante qué institución?</h3></div>
            {instituciones === null ? <BloquesEsqueleto n={2} /> : (
              <div className="opciones" role="radiogroup" aria-label="Institución">
                {instituciones.map((i) => (
                  <button key={i.id} className="opcion" role="radio" aria-checked={institucion?.id === i.id} onClick={() => setInstitucion(i)}>
                    <span className="marca-opcion">{institucion?.id === i.id && <Icono nombre="check" />}</span>
                    <span className="cuerpo-opcion"><strong>{i.nombre}</strong></span>
                    {i.tipo === 'demostracion' && <Insignia punto={false}>Demostración</Insignia>}
                  </button>
                ))}
              </div>
            )}
          </section>
          {institucion && (
            <section className="panel">
              <div className="panel-cabecera"><h3>2. ¿Qué trámite?</h3></div>
              {tipos === null ? <BloquesEsqueleto n={2} /> : tipos.length === 0 ? <p className="suave">Esta institución aún no publicó trámites.</p> : (
                <div className="opciones" role="radiogroup" aria-label="Trámite">
                  {tipos.map((t) => (
                    <button key={t.id} className="opcion" role="radio" aria-checked={tipo?.id === t.id} onClick={() => setTipo(t)}>
                      <span className="marca-opcion">{tipo?.id === t.id && <Icono nombre="check" />}</span>
                      <span className="cuerpo-opcion"><strong>{t.nombre}</strong><small>Plazo de atención: {t.sla_dias} días</small></span>
                    </button>
                  ))}
                </div>
              )}
            </section>
          )}
        </div>
        <aside className="panel resumen-nuevo" aria-label="Resumen del trámite">
          <h3>Resumen</h3>
          {tipo ? (
            <>
              <dl className="datos">
                <dt>Institución</dt><dd>{institucion.nombre}</dd>
                <dt>Trámite</dt><dd>{tipo.nombre}</dd>
                <dt>Plazo</dt><dd>{tipo.sla_dias} días</dd>
              </dl>
              <button className="btn btn-ancho" onClick={crear} disabled={trabajando}>{trabajando ? 'Iniciando…' : 'Iniciar trámite'}</button>
              <p className="nota">Quedará registrado a tu nombre y podrás seguir cada paso, con quién lo hizo y cuándo.</p>
            </>
          ) : <p className="suave">Elige una institución y un trámite para ver el resumen.</p>}
        </aside>
      </div>
    </>
  )
}

/* ---------------------------------------------------------------- bandeja y supervisión */

const COLUMNAS = [
  { clave: 'Pendiente', titulo: 'Pendientes', estados: ['Pendiente'] },
  { clave: 'En Tramitacion', titulo: 'En tramitación', estados: ['En Tramitacion'] },
  { clave: 'En Subsanacion', titulo: 'En subsanación', estados: ['En Subsanacion'] },
  { clave: 'Resueltos', titulo: 'Resueltos', estados: FINALES },
]

function Tablero({ filas, yo, abrir, nombres }) {
  return (
    <div className="tablero">
      {COLUMNAS.map((c) => {
        const items = filas.filter((t) => c.estados.includes(t.estado))
        return (
          <section key={c.clave} className="columna" aria-label={c.titulo}>
            <div className="columna-cabecera"><span>{c.titulo}</span><span className="cuenta">{items.length}</span></div>
            {items.length === 0 && <p className="columna-vacia">Sin trámites</p>}
            {items.map((t) => (
              <button key={t.id} className="ficha" onClick={() => abrir(t.id)}>
                <span className="num">#{t.id} · {t.institucion.nombre}</span>
                <span className="nombre">{t.tipo_tramite.nombre}</span>
                <Plazo tramite={t} />
                <span className="pie"><span>{atiende(t, yo, nombres)}</span>{c.clave === 'Resueltos' && <Estado valor={t.estado} />}</span>
              </button>
            ))}
          </section>
        )
      })}
    </div>
  )
}

export function Bandeja({ yo, abrir, modo }) {
  const { filas, error } = useTramites()
  const supervision = modo === 'supervision'
  const [filtro, setFiltro] = useState('abiertos')
  const [vista, setVista] = useState('lista')
  const [q, setQ] = useState('')
  const [nombres, setNombres] = useState({})
  // Quien supervisa o coordina conoce al equipo: se muestran nombres en vez de números
  useEffect(() => {
    if (!yo.membresias.some((m) => ['supervisor', 'coordinador_institucional'].includes(m.rol))) return
    api('/equipo/').then((d) => setNombres(Object.fromEntries(d.equipos.flatMap((e) => e.personal.map((p) => [p.usuario_id, p.usuario]))))).catch(() => {})
  }, [yo])
  const ajenos = useMemo(() => (filas || []).filter((t) => !esMio(t, yo)), [filas, yo])
  const visibles = useMemo(() => ajenos.filter((t) => {
    if (!coincide(t, q)) return false
    if (filtro === 'abiertos') return esAbierto(t)
    if (filtro === 'sin_asignar') return esAbierto(t) && !t.funcionario_asignado_id
    if (filtro === 'vencidos') return t.vencido
    if (filtro === 'mios') return t.funcionario_asignado_id === yo.id
    return true
  }), [ajenos, filtro, q, yo])
  const cuenta = (f) => ajenos.filter(f).length
  const filtros = supervision
    ? [['abiertos', 'Abiertos'], ['sin_asignar', 'Sin asignar'], ['vencidos', 'Vencidos'], ['todos', 'Todos']]
    : [['abiertos', 'Abiertos'], ['mios', 'Asignados a mí'], ['vencidos', 'Vencidos'], ['todos', 'Todos']]
  const vencidos = cuenta((t) => t.vencido)
  return (
    <>
      <div className="encabezado-vista">
        <div>
          <h2>{supervision ? 'Supervisión' : 'Bandeja de la institución'}</h2>
          <p>{supervision ? 'Detecta los trámites vencidos o sin atender y reasígnalos.' : 'Los trámites de las instituciones donde trabajas. Solo ves los de tu institución.'}</p>
        </div>
      </div>
      <Alerta>{error}</Alerta>
      {filas === null ? <><BloquesEsqueleto n={4} /><Esqueleto /></> : (
        <>
          <div className="indicadores">
            <Indicador valor={cuenta((t) => t.estado === 'Pendiente')} texto="Pendientes" />
            <Indicador valor={cuenta((t) => t.estado === 'En Tramitacion')} texto="En tramitación" />
            <Indicador valor={cuenta((t) => t.estado === 'En Subsanacion')} texto="En subsanación" />
            <Indicador valor={vencidos} texto="Con el plazo vencido" clase={vencidos ? 'alerta-ind' : ''} />
          </div>
          <div className="barra-herramientas">
            <Buscador valor={q} cambiar={setQ} />
            <div className="segmentos" role="group" aria-label="Filtro">
              {filtros.map(([k, n]) => <button key={k} aria-pressed={filtro === k} onClick={() => setFiltro(k)}>{n}</button>)}
            </div>
            <div className="segmentos espacio" role="group" aria-label="Vista">
              <button aria-pressed={vista === 'lista'} onClick={() => setVista('lista')}><Icono nombre="lista" />Lista</button>
              <button aria-pressed={vista === 'tablero'} onClick={() => setVista('tablero')}><Icono nombre="tablero" />Tablero</button>
            </div>
          </div>
          {visibles.length === 0
            ? <Vacio titulo={ajenos.length ? 'Nada coincide con este filtro' : 'No hay trámites en tu institución'} texto={ajenos.length ? 'Cambia el filtro o la búsqueda para ver más.' : 'Cuando la ciudadanía inicie trámites, aparecerán aquí.'} />
            : vista === 'lista' ? <Tabla filas={visibles} yo={yo} abrir={abrir} nombres={nombres} /> : <Tablero filas={visibles} yo={yo} abrir={abrir} nombres={nombres} />}
        </>
      )}
    </>
  )
}

/* ---------------------------------------------------------------- detalle */

const ICONO_EVENTO = { creacion: 'mas', cambio_estado: 'flujo', reasignacion: 'reasignar' }

export function Detalle({ id, yo, volver, volverA }) {
  const [tramite, setTramite] = useState(null)
  const [eventos, setEventos] = useState([])
  const [personal, setPersonal] = useState([])
  const [error, setError] = useState('')
  const { ejecutar, modal } = useReautenticacion()
  const { avisar, confirmar } = useUI()

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

  const esPersonal = !!tramite && 'solicitante_id' in tramite
  const esSupervisor = esPersonal && yo.membresias.some((m) => m.institucion_id === tramite.institucion.id && m.rol === 'supervisor')
  const esPropio = esPersonal && tramite.solicitante_id === yo.id
  const nombres = Object.fromEntries(personal.map((p) => [p.usuario_id, p.usuario]))

  useEffect(() => {
    if (!esSupervisor) return
    api('/equipo/').then((d) => {
      const eq = d.equipos.find((e) => e.institucion.id === tramite.institucion.id)
      setPersonal(eq ? eq.personal : [])
    }).catch(() => setPersonal([]))
  }, [esSupervisor, tramite])

  async function accion(f, mensaje) {
    setError('')
    // Se ejecuta de nuevo tras la reautenticación, así que maneja sus propios errores (salvo el que pide reautenticar)
    await ejecutar(async () => {
      try {
        await f()
        await cargar()
        avisar(mensaje)
      } catch (e) {
        if (e instanceof ApiError && e.pideReautenticar) throw e
        setError(mensajeDe(e))
      }
    })
  }

  async function cambiar(estado) {
    if (FINALES.includes(estado)) {
      const si = await confirmar({
        titulo: estado === 'Aprobado' ? 'Aprobar este trámite' : 'Rechazar este trámite',
        texto: 'Es un estado final: después no se puede cambiar. La decisión queda en el historial con tu nombre.',
        etiqueta: estado === 'Aprobado' ? 'Aprobar trámite' : 'Rechazar trámite', peligro: estado === 'Rechazado',
      })
      if (!si) return
    }
    await accion(() => api(`/tramites/${id}/estado/`, { metodo: 'POST', cuerpo: { estado } }), `El trámite pasó a «${ESTADOS[estado].texto}».`)
  }

  const reasignar = (valor) => {
    if (!valor) return undefined
    const destino = valor === 'cola' ? null : Number(valor)
    return accion(
      () => api(`/tramites/${id}/reasignar/`, { metodo: 'POST', cuerpo: { funcionario_id: destino } }),
      destino ? `Trámite reasignado a ${nombres[destino] || 'otra persona'}.` : 'El trámite volvió a la cola.',
    )
  }

  if (tramite === null) return <><BloquesEsqueleto n={1} /><Esqueleto filas={3} /></>
  if (tramite === false) {
    return <><button className="migas" onClick={volver}><Icono nombre="izquierda" />Volver</button><Alerta>{error}</Alerta></>
  }

  const quien = (uid) => (uid === yo.id ? 'ti' : nombres[uid] || `persona #${uid}`)
  return (
    <>
      <button className="migas" onClick={volver}><Icono nombre="izquierda" />Volver a {volverA}</button>
      <div className="detalle-cabecera">
        <div>
          <span className="num">TRÁMITE #{tramite.id}</span>
          <h2>{tramite.tipo_tramite.nombre}</h2>
          <p className="suave">{tramite.institucion.nombre}</p>
        </div>
        <div className="estado-grande"><Estado valor={tramite.estado} /></div>
      </div>
      <Alerta>{error}</Alerta>

      <section className="panel recorrido" aria-label="Recorrido del trámite">
        <Seguimiento estado={tramite.estado} />
        <div className="leyenda">
          <span>Iniciado el <strong>{fechaCorta(tramite.creado_en)}</strong></span>
          <span>Fecha límite <strong>{fechaCorta(tramite.fecha_limite)}</strong></span>
          <Plazo tramite={tramite} />
        </div>
      </section>

      <div className="rejilla-detalle">
        <section className="panel">
          <h3>Detalle</h3>
          <dl className="datos">
            {esPersonal ? (
              <>
                <dt>Solicitante</dt><dd>{esPropio ? 'Tú' : `Persona #${tramite.solicitante_id}`}</dd>
                <dt>Atiende</dt><dd>{tramite.funcionario_asignado_id ? quien(tramite.funcionario_asignado_id) : 'Sin asignar'}</dd>
                <dt>Sensibilidad</dt><dd>Nivel {tramite.sensibilidad}</dd>
              </>
            ) : (
              <><dt>Atención</dt><dd>{tramite.asignado ? 'Un funcionario lo está atendiendo' : 'En la cola de la institución'}</dd></>
            )}
          </dl>
          {esPersonal && !esPropio && (
            <div className="acciones">
              <h4>Acciones</h4>
              {SIGUIENTES[tramite.estado].length === 0 ? <p className="suave">Este trámite ya tiene una resolución final: no admite más cambios.</p> : (
                <div className="fila-botones inicio">
                  {SIGUIENTES[tramite.estado].map((s) => (
                    <button key={s} className={`btn ${s === 'Rechazado' ? 'btn-peligro' : s === 'En Subsanacion' ? 'btn-sec' : ''}`} onClick={() => cambiar(s)}>
                      {s === 'Aprobado' ? 'Aprobar' : s === 'Rechazado' ? 'Rechazar' : s === 'En Subsanacion' ? 'Pedir subsanación' : 'Pasar a tramitación'}
                    </button>
                  ))}
                </div>
              )}
              {esSupervisor && !FINALES.includes(tramite.estado) && (
                <label className="campo separado">
                  <span>Reasignar a</span>
                  <select className="seleccion" value="" onChange={(e) => reasignar(e.target.value)}>
                    <option value="">Elegir una persona…</option>
                    {tramite.funcionario_asignado_id && <option value="cola">Devolver a la cola</option>}
                    {personal.filter((p) => ['funcionario', 'supervisor'].includes(p.rol) && p.usuario_id !== tramite.funcionario_asignado_id).map((p) => <option key={p.usuario_id} value={p.usuario_id}>{p.usuario}</option>)}
                  </select>
                </label>
              )}
              <p className="nota">Los botones son una ayuda: el servidor decide cada cambio (segundo factor reciente, conflicto de interés, asignación) y la base de datos valida la transición.</p>
            </div>
          )}
          {esPropio && <Alerta tipo="info">Este trámite lo iniciaste tú: por conflicto de interés no puedes gestionarlo como funcionario.</Alerta>}
        </section>

        <section className="panel">
          <h3>Historial</h3>
          <ol className="linea-tiempo">
            {eventos.map((e, i) => (
              <li key={e.id} className={i === eventos.length - 1 ? 'ultimo' : ''}>
                <span className="punto"><Icono nombre={ICONO_EVENTO[e.accion] || 'flujo'} /></span>
                <div className="evento">
                  <strong>{ACCIONES_EVENTO[e.accion] || e.accion}</strong>
                  {e.accion === 'cambio_estado' && <span className="cambio"><Estado valor={e.estado_anterior} /><Icono nombre="derecha" className="tenue" /><Estado valor={e.estado_nuevo} /></span>}
                  {e.accion === 'reasignacion' && e.atributos && <span className="quien">{e.atributos.de ? `De ${quien(e.atributos.de)} a ` : 'Asignado a '}{e.atributos.a ? quien(e.atributos.a) : 'la cola'}</span>}
                  <time dateTime={e.creado_en} title={fecha(e.creado_en)}>{fecha(e.creado_en)} · {hace(e.creado_en)}</time>
                  {'actor_id' in e && <span className="quien">Por {quien(e.actor_id)}</span>}
                </div>
              </li>
            ))}
          </ol>
          {!esPersonal && <p className="nota">El historial es inalterable. Por privacidad no muestra qué funcionario actuó.</p>}
        </section>
      </div>
      {modal}
    </>
  )
}
