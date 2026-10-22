import { useCallback, useEffect, useState } from 'react'
import { api } from './api.js'
import { ACCIONES_EVENTO, ESTADOS, fecha, hace, mensajeDe, useReautenticacion } from './comun.jsx'
import { Alerta, Avatar, BloquesEsqueleto, Esqueleto, Icono, Insignia, Vacio } from './ui.jsx'

const PESTANAS = [
  ['resumen', 'Resumen'],
  ['decisiones', 'Decisiones de acceso'],
  ['seguridad', 'Eventos de seguridad'],
  ['tramites', 'Actuaciones en trámites'],
]

export const NOMBRES_EVENTO = {
  registro: 'Cuenta creada', login_ok: 'Inicio de sesión', login_fallido: 'Inicio de sesión fallido',
  login_rechazado_bloqueada: 'Intento con cuenta bloqueada', login_cuenta_no_activa: 'Intento con cuenta no activa',
  cuenta_bloqueada: 'Cuenta bloqueada', mfa_enrolamiento_iniciado: 'Alta del segundo factor iniciada',
  mfa_activado: 'Segundo factor activado', mfa_verificado: 'Segundo factor verificado',
  mfa_confirmacion_fallida: 'Alta del segundo factor fallida', mfa_verificacion_fallida: 'Verificación del segundo factor fallida',
  refresh_ok: 'Sesión renovada', refresh_invalido: 'Renovación inválida', refresh_reuso: 'Reuso de token de sesión (posible robo)',
  logout: 'Cierre de sesión',
}
export const EVENTOS_ALERTA = ['login_fallido', 'cuenta_bloqueada', 'refresh_reuso', 'login_rechazado_bloqueada', 'mfa_verificacion_fallida', 'mfa_confirmacion_fallida', 'refresh_invalido']

const Quien = ({ actor }) => (actor
  ? <span className="quien-fila"><Avatar nombre={actor.usuario} /><span>{actor.usuario}</span></span>
  : <span className="tenue">Sistema / anónimo</span>)

export function Auditoria() {
  const [pestana, setPestana] = useState('resumen')
  return (
    <>
      <div className="encabezado-vista">
        <div>
          <h2>Auditoría</h2>
          <p>Registro inalterable de lo que pasa en la plataforma. Lees por una conexión de solo lectura: desde aquí no se puede escribir ni borrar nada.</p>
        </div>
      </div>
      <div className="pestanas" role="tablist" aria-label="Secciones de auditoría">
        {PESTANAS.map(([k, n]) => <button key={k} role="tab" aria-selected={pestana === k} onClick={() => setPestana(k)}>{n}</button>)}
      </div>
      {pestana === 'resumen' && <Resumen alAbrirDecisiones={() => setPestana('decisiones')} />}
      {pestana === 'decisiones' && <Decisiones />}
      {pestana === 'seguridad' && <Listado ruta="/auditoria/seguridad/" columnas={COLUMNAS_SEGURIDAD} filtro={['evento', 'Evento', 'p. ej. login_fallido']} vacio="No hay eventos de seguridad con ese filtro." />}
      {pestana === 'tramites' && <Listado ruta="/auditoria/tramites/" columnas={COLUMNAS_TRAMITES} filtro={['accion', 'Acción', 'p. ej. cambio_estado']} vacio="No hay actuaciones con ese filtro." />}
      <p className="nota"><Icono nombre="escudo" className="en-linea" /> Quién audita al auditor: cada consulta que haces pasa por el punto de decisión de acceso y queda registrada como una decisión más.</p>
    </>
  )
}

function useConsulta(ruta, parametros) {
  const [datos, setDatos] = useState(null)
  const [error, setError] = useState('')
  const { ejecutar, modal } = useReautenticacion()
  const clave = `${ruta}?${new URLSearchParams(parametros).toString()}`

  const cargar = useCallback(async () => {
    setError('')
    try {
      await ejecutar(async () => { setDatos(await api(clave)) })
    } catch (e) {
      setError(mensajeDe(e))
      setDatos(false)
    }
  }, [clave]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { cargar() }, [cargar])
  return { datos, error, modal }
}

/* ---------------------------------------------------------------- resumen */

function Resumen({ alAbrirDecisiones }) {
  const { datos, error, modal } = useConsulta('/auditoria/resumen/', {})
  // El modal de reautenticación debe pintarse también mientras se espera: si no, el esqueleto quedaría para siempre
  if (datos === null) return <><BloquesEsqueleto n={4} />{modal}</>
  if (datos === false) return <><Alerta>{error}</Alerta>{modal}</>
  const d = datos.decisiones
  const pct = d.total ? Math.round((d.negadas / d.total) * 100) : 0
  return (
    <>
      <div className="indicadores">
        <div className="indicador"><strong>{d.total}</strong><span>Decisiones de acceso</span></div>
        <div className="indicador ok-ind"><strong>{d.permitidas}</strong><span>Permitidas</span></div>
        <div className={`indicador ${d.negadas ? 'alerta-ind' : ''}`}><strong>{d.negadas}</strong><span>Negadas ({pct} %)</span></div>
        <div className="indicador"><strong>{d.ultimas_24h}</strong><span>En las últimas 24 horas</span></div>
      </div>
      <div className="rejilla-detalle">
        <section className="panel">
          <div className="panel-cabecera"><h3>Qué políticas deciden</h3><button className="btn btn-sec btn-s" onClick={alAbrirDecisiones}>Ver decisiones</button></div>
          <p className="suave">Cada decisión indica la regla que la motivó. Las políticas que más niegan, primero.</p>
          <div className="leyenda-grafico"><span><i className="l-ok" />Permitidas</span><span><i className="l-no" />Negadas</span></div>
          <GraficoPoliticas filas={datos.por_politica} />
        </section>
        <div>
          <section className="panel">
            <h3>Personas con más denegaciones</h3>
            {datos.denegaciones_por_persona.length === 0 ? <p className="suave">Sin denegaciones registradas.</p> : (
              <ul className="lista-simple">
                {datos.denegaciones_por_persona.map((p) => <li key={p.id}><Quien actor={p} /><Insignia clase="e-rechazado" punto={false}>{p.total} negadas</Insignia></li>)}
              </ul>
            )}
          </section>
          <section className="panel">
            <h3>Eventos de seguridad</h3>
            <ul className="lista-simple">
              {datos.seguridad.map((s) => <li key={s.evento}><span>{NOMBRES_EVENTO[s.evento] || s.evento}</span><Insignia clase={EVENTOS_ALERTA.includes(s.evento) ? 'insignia-boya' : ''} punto={false}>{s.total}</Insignia></li>)}
            </ul>
          </section>
          <section className="panel">
            <h3>Actuaciones en trámites</h3>
            <ul className="lista-simple">
              {datos.tramites.map((t) => <li key={t.accion}><span>{ACCIONES_EVENTO[t.accion] || t.accion}</span><Insignia punto={false}>{t.total}</Insignia></li>)}
            </ul>
          </section>
        </div>
      </div>
      {modal}
    </>
  )
}

function GraficoPoliticas({ filas }) {
  if (!filas.length) return <p className="suave">Aún no hay decisiones.</p>
  const maximo = Math.max(...filas.map((f) => f.permitidas + f.negadas), 1)
  const alto = 30
  const inicio = 236
  const util = 280
  return (
    <svg className="grafico" viewBox={`0 0 ${inicio + util + 34} ${filas.length * alto + 4}`} role="img" aria-label="Decisiones por política, permitidas y negadas">
      {filas.map((f, i) => {
        const y = i * alto + 2
        const wOk = (f.permitidas / maximo) * util
        const wNo = (f.negadas / maximo) * util
        return (
          <g key={f.politica || 'sin'}>
            <text className="grafico-texto" x="0" y={y + 17}>{(f.politica || '(sin política)').slice(0, 36)}</text>
            <rect x={inicio} y={y + 4} width={wOk} height="18" className="barra-ok" rx="3" />
            <rect x={inicio + wOk} y={y + 4} width={wNo} height="18" className="barra-no" rx="3" />
            <text className="grafico-cifra" x={inicio + wOk + wNo + 8} y={y + 17}>{f.permitidas + f.negadas}</text>
          </g>
        )
      })}
    </svg>
  )
}

/* ---------------------------------------------------------------- listados */

const TAM = 15

function Decisiones() {
  const [resultado, setResultado] = useState('')
  const [politica, setPolitica] = useState('')
  const [pagina, setPagina] = useState(0)
  const parametros = { limite: TAM, desplazamiento: pagina * TAM }
  if (resultado) parametros.resultado = resultado
  if (politica) parametros.politica = politica
  const { datos, error, modal } = useConsulta('/auditoria/decisiones/', parametros)

  return (
    <>
      <div className="barra-filtros">
        <label className="campo">
          <span>Resultado</span>
          <select className="seleccion" value={resultado} onChange={(e) => { setResultado(e.target.value); setPagina(0) }}>
            <option value="">Todas</option><option value="negadas">Solo negadas</option><option value="permitidas">Solo permitidas</option>
          </select>
        </label>
        <label className="campo">
          <span>Política</span>
          <input className="entrada" value={politica} onChange={(e) => { setPolitica(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '')); setPagina(0) }} placeholder="p. ej. conflicto_de_interes" maxLength={64} />
        </label>
      </div>
      <Alerta>{error}</Alerta>
      {datos === null ? <Esqueleto filas={5} /> : datos && (datos.resultados.length === 0 ? <Vacio titulo="Ninguna decisión coincide" texto="Quita un filtro para ver más resultados." /> : (
        <>
          <div className="tabla-caja">
            <table className="tabla">
              <thead><tr><th>Cuándo</th><th>Persona</th><th>Acción</th><th>Resultado</th><th>Política</th></tr></thead>
              <tbody>
                {datos.resultados.map((d) => (
                  <tr key={d.id} title={d.motivo || ''}>
                    <td className="num" title={fecha(d.creado_en)}>{hace(d.creado_en)}</td>
                    <td><Quien actor={d.actor} /></td>
                    <td><span className="mono">{d.accion}</span>{d.recurso ? <small className="tenue"> · {d.recurso}</small> : null}</td>
                    <td><Insignia clase={d.permitido ? 'e-aprobado' : 'e-rechazado'}>{d.permitido ? 'Permitida' : 'Negada'}</Insignia></td>
                    <td><code>{d.politica || '—'}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Paginador datos={datos} pagina={pagina} cambiar={setPagina} />
        </>
      ))}
      {modal}
    </>
  )
}

const COLUMNAS_SEGURIDAD = [
  ['Cuándo', (e) => <span className="num" title={fecha(e.creado_en)}>{hace(e.creado_en)}</span>],
  ['Persona', (e) => <Quien actor={e.actor} />],
  ['Evento', (e) => <Insignia clase={EVENTOS_ALERTA.includes(e.evento) ? 'insignia-boya' : ''} punto={false}>{NOMBRES_EVENTO[e.evento] || e.evento}</Insignia>],
  ['Dirección', (e) => <span className="mono">{e.ip || '—'}</span>],
]
const COLUMNAS_TRAMITES = [
  ['Cuándo', (e) => <span className="num" title={fecha(e.creado_en)}>{hace(e.creado_en)}</span>],
  ['Persona', (e) => <Quien actor={e.actor} />],
  ['Trámite', (e) => <span className="mono">#{e.tramite_id}</span>],
  ['Acción', (e) => ACCIONES_EVENTO[e.accion] || e.accion],
  ['Cambio', (e) => (e.estado_nuevo && e.estado_anterior !== e.estado_nuevo ? `${e.estado_anterior ? `${ESTADOS[e.estado_anterior]?.texto} → ` : ''}${ESTADOS[e.estado_nuevo]?.texto}` : '—')],
]

function Listado({ ruta, columnas, filtro: [clave, etiqueta, ejemplo], vacio }) {
  const [valor, setValor] = useState('')
  const [pagina, setPagina] = useState(0)
  const parametros = { limite: TAM, desplazamiento: pagina * TAM }
  if (valor) parametros[clave] = valor
  const { datos, error, modal } = useConsulta(ruta, parametros)
  return (
    <>
      <div className="barra-filtros">
        <label className="campo">
          <span>{etiqueta}</span>
          <input className="entrada" value={valor} onChange={(e) => { setValor(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '')); setPagina(0) }} placeholder={ejemplo} maxLength={64} />
        </label>
      </div>
      <Alerta>{error}</Alerta>
      {datos === null ? <Esqueleto filas={5} /> : datos && (datos.resultados.length === 0 ? <Vacio titulo={vacio} texto="Quita el filtro para ver todos los registros." /> : (
        <>
          <div className="tabla-caja">
            <table className="tabla">
              <thead><tr>{columnas.map(([n]) => <th key={n}>{n}</th>)}</tr></thead>
              <tbody>{datos.resultados.map((e) => <tr key={e.id}>{columnas.map(([n, f]) => <td key={n}>{f(e)}</td>)}</tr>)}</tbody>
            </table>
          </div>
          <Paginador datos={datos} pagina={pagina} cambiar={setPagina} />
        </>
      ))}
      {modal}
    </>
  )
}

function Paginador({ datos, pagina, cambiar }) {
  const paginas = Math.max(1, Math.ceil(datos.total / datos.limite))
  return (
    <div className="paginador">
      <span>{datos.total} registros · página {pagina + 1} de {paginas}</span>
      <div className="fila-botones">
        <button className="btn btn-sec btn-s" disabled={pagina === 0} onClick={() => cambiar(pagina - 1)}><Icono nombre="izquierda" />Anterior</button>
        <button className="btn btn-sec btn-s" disabled={pagina + 1 >= paginas} onClick={() => cambiar(pagina + 1)}>Siguiente<Icono nombre="derecha" /></button>
      </div>
    </div>
  )
}
