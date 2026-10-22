import { useCallback, useEffect, useState } from 'react'
import { api } from './api.js'
import { ACCIONES_EVENTO, Alerta, Cargando, ESTADOS, fecha, mensajeDe, useReautenticacion } from './comun.jsx'

const PESTANAS = [
  ['resumen', 'Resumen'],
  ['decisiones', 'Decisiones de acceso'],
  ['seguridad', 'Eventos de seguridad'],
  ['tramites', 'Actuaciones en trámites'],
]

const NOMBRES_EVENTO = {
  registro: 'Cuenta creada', login_ok: 'Inicio de sesión', login_fallido: 'Inicio de sesión fallido',
  login_rechazado_bloqueada: 'Intento con cuenta bloqueada', login_cuenta_no_activa: 'Intento con cuenta no activa',
  cuenta_bloqueada: 'Cuenta bloqueada', mfa_enrolamiento_iniciado: 'Alta del segundo factor iniciada',
  mfa_activado: 'Segundo factor activado', mfa_verificado: 'Segundo factor verificado',
  mfa_confirmacion_fallida: 'Alta del segundo factor fallida', mfa_verificacion_fallida: 'Verificación del segundo factor fallida',
  refresh_ok: 'Sesión renovada', refresh_invalido: 'Renovación inválida', refresh_reuso: 'Reuso de token de sesión (posible robo)',
  logout: 'Cierre de sesión',
}

const quien = (actor) => (actor ? actor.usuario : 'Sistema / anónimo')

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
      <div className="filtros" role="tablist" aria-label="Secciones de auditoría">
        {PESTANAS.map(([k, n]) => (
          <button key={k} role="tab" aria-selected={pestana === k} className={pestana === k ? 'activa' : 'secundario'} onClick={() => setPestana(k)}>{n}</button>
        ))}
      </div>
      {pestana === 'resumen' && <Resumen alAbrirDecisiones={() => setPestana('decisiones')} />}
      {pestana === 'decisiones' && <Decisiones />}
      {pestana === 'seguridad' && <Listado ruta="/auditoria/seguridad/" columnas={COLUMNAS_SEGURIDAD} filtros={[['evento', 'Evento (p. ej. login_fallido)']]} />}
      {pestana === 'tramites' && <Listado ruta="/auditoria/tramites/" columnas={COLUMNAS_TRAMITES} filtros={[['accion', 'Acción (p. ej. cambio_estado)']]} />}
      <p className="nota">Quién audita al auditor: cada consulta que haces pasa por el punto de decisión de acceso y queda registrada como una decisión más.</p>
    </>
  )
}

function usarConsulta(ruta, parametros) {
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

// ---------------------------------------------------------------- resumen

function Resumen({ alAbrirDecisiones }) {
  const { datos, error, modal } = usarConsulta('/auditoria/resumen/', {})
  if (datos === null) return <Cargando texto="Consultando el registro…" />
  if (datos === false) return <><Alerta>{error}</Alerta>{modal}</>
  const d = datos.decisiones
  const pct = d.total ? Math.round((d.negadas / d.total) * 100) : 0
  return (
    <>
      <div className="resumen">
        <div><strong>{d.total}</strong><span>Decisiones de acceso</span></div>
        <div><strong className="num-ok">{d.permitidas}</strong><span>Permitidas</span></div>
        <div className={d.negadas ? 'alerta-num' : ''}><strong>{d.negadas}</strong><span>Negadas ({pct} %)</span></div>
        <div><strong>{d.ultimas_24h}</strong><span>Últimas 24 horas</span></div>
      </div>
      <div className="rejilla-detalle">
        <section className="panel">
          <h3>Qué políticas deciden</h3>
          <p className="nota">Cada decisión indica la regla que la motivó. En verde lo permitido; en rojo, lo negado.</p>
          <GraficoPoliticas filas={datos.por_politica} />
          <button className="secundario" onClick={alAbrirDecisiones}>Ver todas las decisiones</button>
        </section>
        <section className="panel">
          <h3>Personas con más denegaciones</h3>
          {datos.denegaciones_por_persona.length === 0 ? <p className="vacio">Sin denegaciones registradas.</p> : (
            <ul className="lista-equipo">
              {datos.denegaciones_por_persona.map((p) => <li key={p.id}><span>{p.usuario}</span><span className="chip e-rechazado">{p.total}</span></li>)}
            </ul>
          )}
          <h3 className="separado">Actuaciones en trámites</h3>
          <ul className="lista-equipo">
            {datos.tramites.map((t) => <li key={t.accion}><span>{ACCIONES_EVENTO[t.accion] || t.accion}</span><span className="chip">{t.total}</span></li>)}
          </ul>
          <h3 className="separado">Eventos de seguridad</h3>
          <ul className="lista-equipo">
            {datos.seguridad.map((s) => <li key={s.evento}><span>{NOMBRES_EVENTO[s.evento] || s.evento}</span><span className="chip">{s.total}</span></li>)}
          </ul>
        </section>
      </div>
      {modal}
    </>
  )
}

function GraficoPoliticas({ filas }) {
  if (!filas.length) return <p className="vacio">Aún no hay decisiones.</p>
  const maximo = Math.max(...filas.map((f) => f.permitidas + f.negadas), 1)
  const ancho = 420
  const alto = 26
  return (
    <svg className="grafico" viewBox={`0 0 ${ancho + 150} ${filas.length * alto + 4}`} role="img" aria-label="Decisiones por política, permitidas y negadas">
      {filas.map((f, i) => {
        const y = i * alto + 2
        const wOk = (f.permitidas / maximo) * (ancho - 50)
        const wNo = (f.negadas / maximo) * (ancho - 50)
        return (
          <g key={f.politica || 'sin'}>
            <text x="0" y={y + 14} className="grafico-texto">{(f.politica || '(sin política)').slice(0, 34)}</text>
            <rect x="215" y={y + 2} width={wOk} height="16" className="barra-ok" rx="3" />
            <rect x={215 + wOk} y={y + 2} width={wNo} height="16" className="barra-no" rx="3" />
            <text x={215 + wOk + wNo + 6} y={y + 14} className="grafico-cifra">{f.permitidas + f.negadas}</text>
          </g>
        )
      })}
    </svg>
  )
}

// ---------------------------------------------------------------- listados

function Decisiones() {
  const [resultado, setResultado] = useState('')
  const [politica, setPolitica] = useState('')
  const [pagina, setPagina] = useState(0)
  const parametros = { limite: 15, desplazamiento: pagina * 15 }
  if (resultado) parametros.resultado = resultado
  if (politica) parametros.politica = politica
  const { datos, error, modal } = usarConsulta('/auditoria/decisiones/', parametros)

  const aplicar = (f) => (e) => { f(e.target.value); setPagina(0) }
  return (
    <>
      <div className="barra-filtros">
        <label>Resultado
          <select value={resultado} onChange={aplicar(setResultado)}>
            <option value="">Todas</option><option value="negadas">Solo negadas</option><option value="permitidas">Solo permitidas</option>
          </select>
        </label>
        <label>Política
          <input value={politica} onChange={aplicar((v) => setPolitica(v.toLowerCase().replace(/[^a-z0-9_]/g, '')))} placeholder="p. ej. conflicto_de_interes" maxLength={64} />
        </label>
      </div>
      <Alerta>{error}</Alerta>
      {datos === null ? <Cargando /> : datos && (
        <>
          <div className="tabla-envoltura">
            <table>
              <thead><tr><th>Fecha</th><th>Persona</th><th>Acción</th><th>Resultado</th><th>Política</th></tr></thead>
              <tbody>
                {datos.resultados.map((d) => (
                  <tr key={d.id} className="sin-clic" title={d.motivo || ''}>
                    <td>{fecha(d.creado_en)}</td>
                    <td>{quien(d.actor)}</td>
                    <td>{d.accion}{d.recurso ? <small className="suave"> · {d.recurso}</small> : null}</td>
                    <td><span className={`chip ${d.permitido ? 'e-aprobado' : 'e-rechazado'}`}>{d.permitido ? 'Permitida' : 'Negada'}</span></td>
                    <td><code>{d.politica || '—'}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Paginador datos={datos} pagina={pagina} cambiar={setPagina} />
        </>
      )}
      {datos && datos.resultados.length === 0 && <p className="vacio">Ninguna decisión coincide con el filtro.</p>}
      {modal}
    </>
  )
}

const COLUMNAS_SEGURIDAD = [
  ['Fecha', (e) => fecha(e.creado_en)],
  ['Persona', (e) => quien(e.actor)],
  ['Evento', (e) => NOMBRES_EVENTO[e.evento] || e.evento],
  ['Dirección', (e) => e.ip || '—'],
]
const COLUMNAS_TRAMITES = [
  ['Fecha', (e) => fecha(e.creado_en)],
  ['Persona', (e) => quien(e.actor)],
  ['Trámite', (e) => `#${e.tramite_id}`],
  ['Acción', (e) => ACCIONES_EVENTO[e.accion] || e.accion],
  ['Cambio', (e) => (e.estado_nuevo && e.estado_anterior !== e.estado_nuevo ? `${e.estado_anterior ? `${ESTADOS[e.estado_anterior]?.texto} → ` : ''}${ESTADOS[e.estado_nuevo]?.texto}` : '—')],
]

function Listado({ ruta, columnas, filtros }) {
  const [valores, setValores] = useState({})
  const [pagina, setPagina] = useState(0)
  const parametros = { limite: 15, desplazamiento: pagina * 15 }
  filtros.forEach(([k]) => { if (valores[k]) parametros[k] = valores[k] })
  const { datos, error, modal } = usarConsulta(ruta, parametros)
  return (
    <>
      <div className="barra-filtros">
        {filtros.map(([k, etiqueta]) => (
          <label key={k}>{etiqueta}
            <input value={valores[k] || ''} onChange={(e) => { setValores({ ...valores, [k]: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') }); setPagina(0) }} maxLength={64} />
          </label>
        ))}
      </div>
      <Alerta>{error}</Alerta>
      {datos === null ? <Cargando /> : datos && (
        <>
          <div className="tabla-envoltura">
            <table>
              <thead><tr>{columnas.map(([n]) => <th key={n}>{n}</th>)}</tr></thead>
              <tbody>{datos.resultados.map((e) => <tr key={e.id} className="sin-clic">{columnas.map(([n, f]) => <td key={n}>{f(e)}</td>)}</tr>)}</tbody>
            </table>
          </div>
          {datos.resultados.length === 0 && <p className="vacio">Sin registros para este filtro.</p>}
          <Paginador datos={datos} pagina={pagina} cambiar={setPagina} />
        </>
      )}
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
        <button className="secundario" disabled={pagina === 0} onClick={() => cambiar(pagina - 1)}>← Anterior</button>
        <button className="secundario" disabled={pagina + 1 >= paginas} onClick={() => cambiar(pagina + 1)}>Siguiente →</button>
      </div>
    </div>
  )
}
