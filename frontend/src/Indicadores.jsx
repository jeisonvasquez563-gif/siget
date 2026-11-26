import { useCallback, useEffect, useState } from 'react'
import { api } from './api.js'
import { ESTADOS, fecha, mensajeDe } from './comun.jsx'
import { Alerta, BloquesEsqueleto, Icono, Vacio } from './ui.jsx'

// Indicadores de la institución, para su supervisión y su coordinación. Son solo agregados (conteos y tiempos): la coordinación no ve trámites, pero sí
// estas cifras. El servidor decide quién las ve (PDP) y la base lo vuelve a comprobar; aquí solo se dibujan. Las cifras van siempre como texto: el
// gráfico de barras es un apoyo visual (SVG sin librerías, con atributos y no con estilos en línea porque la CSP de nginx no los admite).

const ORDEN = ['Pendiente', 'En Tramitacion', 'En Subsanacion', 'Aprobado', 'Rechazado']
const nombreDeEstado = (e) => ESTADOS[e]?.texto || e
const claseDeEstado = (e) => ESTADOS[e]?.clase || 'e-pendiente'

// Los estados conocidos primero y en su orden de siempre; cualquier otro que traiga el servidor (p. ej. «Desistido») al final
function ordenar(porEstado) {
  const otros = Object.keys(porEstado).filter((e) => !ORDEN.includes(e)).sort()
  return [...ORDEN, ...otros].filter((e) => e in porEstado).map((e) => [e, porEstado[e]])
}

const dias = (n) => (n === null || n === undefined ? 'Sin datos' : `${String(n).replace('.', ',')} ${n === 1 ? 'día' : 'días'}`)

function Cifra({ valor, texto, ayuda, clase = '' }) {
  return (
    <div className={`indicador ${clase}`}>
      <strong>{valor}</strong>
      <span>{texto}</span>
      {ayuda && <small className="indicador-ayuda">{ayuda}</small>}
    </div>
  )
}

function Barras({ porEstado }) {
  const filas = ordenar(porEstado)
  const total = filas.reduce((suma, [, n]) => suma + n, 0)
  const maximo = Math.max(1, ...filas.map(([, n]) => n))
  if (total === 0) return <p className="suave">Todavía no hay trámites en esta institución.</p>
  return (
    <ul className="barras" aria-label="Trámites por estado">
      {filas.map(([estado, n]) => (
        <li key={estado} className="barras-fila">
          <span className="barras-etiqueta">{nombreDeEstado(estado)}</span>
          <svg className="barras-grafico" viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true" focusable="false">
            <rect className="barras-pista" x="0" y="0" width="100" height="10" rx="2" />
            <rect className={`barras-relleno ${claseDeEstado(estado)}`} x="0" y="0" width={(n / maximo) * 100} height="10" rx="2" />
          </svg>
          <span className="barras-valor"><strong>{n}</strong> <span className="suave">({Math.round((n / total) * 100)} %)</span></span>
        </li>
      ))}
    </ul>
  )
}

function Panel({ institucion }) {
  const [datos, setDatos] = useState(null)
  const [error, setError] = useState('')
  const [cargando, setCargando] = useState(false)

  const cargar = useCallback(async () => {
    setCargando(true)
    try {
      setDatos(await api(`/equipo/${institucion.id}/indicadores/`))
      setError('')
    } catch (e) {
      setError(mensajeDe(e))
    } finally {
      setCargando(false)
    }
  }, [institucion.id])
  useEffect(() => { setDatos(null); cargar() }, [cargar])

  if (datos === null) return error ? <Alerta>{error}</Alerta> : <BloquesEsqueleto n={3} />
  const total = Object.values(datos.por_estado).reduce((suma, n) => suma + n, 0)
  return (
    <>
      <Alerta>{error}</Alerta>
      <div className="indicadores-pie">
        <span className="suave">Cifras de {institucion.nombre} al {fecha(datos.generado_en)}.</span>
        <button type="button" className="btn btn-sec btn-s" onClick={cargar} disabled={cargando}><Icono nombre="reloj" />{cargando ? 'Actualizando…' : 'Actualizar'}</button>
      </div>
      <div className="indicadores" role="group" aria-label="Cifras de la institución">
        <Cifra valor={datos.abiertos} texto="Trámites abiertos" ayuda={`${total} en total`} />
        <Cifra valor={datos.vencidos} texto="Con el plazo vencido" clase={datos.vencidos ? 'alerta-ind' : 'ok-ind'} ayuda="Abiertos que pasaron su fecha límite" />
        <Cifra valor={datos.escalados_abiertos} texto="Escalados abiertos" clase={datos.escalados_abiertos ? 'alerta-ind' : ''} ayuda="Pasaron a supervisión por plazo vencido" />
        <Cifra valor={datos.sin_asignar} texto="Sin asignar" ayuda="En cola, sin funcionario" />
        <Cifra valor={datos.resueltos_90_dias} texto="Resueltos (90 días)" ayuda="Aprobados o rechazados en los últimos 90 días" />
        <Cifra valor={dias(datos.dias_promedio_resolucion)} texto="Tiempo promedio de resolución" ayuda="De su inicio a la resolución, en esos 90 días" />
      </div>

      <section className="panel" aria-labelledby="titulo-por-estado">
        <div className="panel-cabecera"><h3 id="titulo-por-estado">Trámites por estado</h3><span className="suave">{total} {total === 1 ? 'trámite' : 'trámites'}</span></div>
        <Barras porEstado={datos.por_estado} />
      </section>

      <section className="panel" aria-labelledby="titulo-carga">
        <div className="panel-cabecera"><h3 id="titulo-carga">Carga por funcionario</h3><span className="suave">Trámites abiertos asignados</span></div>
        {datos.por_funcionario.length === 0 ? (
          <Vacio titulo="Nadie tiene trámites abiertos asignados" texto="Cuando la supervisión asigne trámites al personal, la carga de cada persona aparecerá aquí." />
        ) : (
          <div className="tabla-caja">
            <table className="tabla">
              <caption className="solo-lector">Trámites abiertos asignados a cada persona del personal</caption>
              <thead><tr><th scope="col">Funcionario</th><th scope="col" className="num">Trámites abiertos</th></tr></thead>
              <tbody>
                {datos.por_funcionario.map((f) => <tr key={f.usuario_id}><th scope="row" className="titulo-fila">{f.usuario}</th><td className="num">{f.abiertos}</td></tr>)}
              </tbody>
            </table>
          </div>
        )}
        {datos.sin_asignar > 0 && <p className="nota">Además, {datos.sin_asignar} {datos.sin_asignar === 1 ? 'trámite abierto está' : 'trámites abiertos están'} sin asignar.</p>}
      </section>
    </>
  )
}

export function Indicadores({ yo }) {
  // Las instituciones donde la persona supervisa o coordina (sin repetir). El servidor vuelve a decidirlo en cada petición.
  const instituciones = []
  for (const m of yo.membresias) {
    if (['supervisor', 'coordinador_institucional'].includes(m.rol) && !instituciones.some((i) => i.id === m.institucion_id)) instituciones.push({ id: m.institucion_id, nombre: m.institucion })
  }
  const [elegida, setElegida] = useState(instituciones[0]?.id)
  const actual = instituciones.find((i) => i.id === elegida) || instituciones[0]
  return (
    <>
      <div className="encabezado-vista">
        <div><h2>Indicadores</h2><p>Cómo va tu institución: trámites por estado, vencidos, escalados, tiempo de resolución y carga del personal. Son cifras agregadas, sin datos de las personas que hicieron los trámites.</p></div>
      </div>
      {!actual ? <Vacio titulo="No supervisas ni coordinas ninguna institución" texto="Los indicadores son para la supervisión y la coordinación de cada institución." /> : (
        <>
          {instituciones.length > 1 && (
            <label className="campo campo-institucion"><span>Institución</span>
              <select className="entrada" value={actual.id} onChange={(e) => setElegida(Number(e.target.value))}>
                {instituciones.map((i) => <option key={i.id} value={i.id}>{i.nombre}</option>)}
              </select>
            </label>
          )}
          <Panel institucion={actual} />
        </>
      )}
    </>
  )
}
