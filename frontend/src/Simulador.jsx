import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from './api.js'
import { mensajeDe } from './comun.jsx'
import escenarios from './escenarios.json'
import { Alerta, Icono, Insignia } from './ui.jsx'

const FASE = { denegacion: 'Regla que anula', permiso: 'Regla que permite', final: 'Resultado por defecto' }
const RESULTADO = {
  no_aplica: { texto: 'No aplica', icono: 'x', clase: 'neutro' },
  niega: { texto: 'Niega', icono: 'x', clase: 'niega' },
  permite: { texto: 'Permite', icono: 'check', clase: 'permite' },
  no_permite: { texto: 'No permite', icono: 'x', clase: 'neutro' },
}

// Construye una entrada con los valores por defecto de las variables que importan a esa acción. Solo conserva lo que la persona
// eligió a propósito (`tocadas`): lo que venía por defecto del rol anterior no debe arrastrarse al rol nuevo.
function armarEntrada(meta, rol, accion, previa = {}, tocadas = new Set()) {
  const entrada = { rol, accion }
  for (const v of meta.variables[accion] || []) {
    const validos = meta.valores[v].map((o) => o.valor)
    let defecto = meta.defectos[v]
    if (v === 'solicitante' && rol === 'ciudadano') defecto = 'yo'
    if (v === 'nivel' && rol === 'auditor') defecto = 3
    entrada[v] = tocadas.has(v) && validos.includes(previa[v]) ? previa[v] : defecto
  }
  return entrada
}

export function Simulador({ matriz, explicar }) {
  const [meta, setMeta] = useState(null)
  const [entrada, setEntrada] = useState(null)
  const [tocadas, setTocadas] = useState(() => new Set())
  const [resultado, setResultado] = useState(null)
  const [error, setError] = useState('')
  const [cargando, setCargando] = useState(false)
  const pedido = useRef(0)

  useEffect(() => {
    api('/politicas/simular/').then((m) => {
      setMeta(m)
      setEntrada(armarEntrada(m, 'funcionario', 'cambiar_estado'))
    }).catch((e) => setError(mensajeDe(e)))
  }, [])

  // Cada cambio vuelve a preguntar al PDP real (con una pequeña espera para no saturar si se cambia rápido)
  useEffect(() => {
    if (!entrada) return undefined
    const numero = ++pedido.current
    setCargando(true)
    const espera = setTimeout(() => {
      api('/politicas/simular/', { metodo: 'POST', cuerpo: entrada })
        .then((r) => { if (numero === pedido.current) { setResultado(r); setError('') } })
        .catch((e) => { if (numero === pedido.current) setError(mensajeDe(e)) })
        .finally(() => { if (numero === pedido.current) setCargando(false) })
    }, 180)
    return () => clearTimeout(espera)
  }, [entrada])

  const acciones = useMemo(() => {
    const grupos = []
    for (const a of matriz.acciones) {
      let g = grupos.find((x) => x.titulo === a.grupo)
      if (!g) { g = { titulo: a.grupo, items: [] }; grupos.push(g) }
      g.items.push(a)
    }
    return grupos
  }, [matriz])

  if (!meta || !entrada) return <><Alerta>{error}</Alerta><p className="suave" role="status">Preparando el simulador…</p></>

  const cambiarRol = (rol) => setEntrada(armarEntrada(meta, rol, entrada.accion, entrada, tocadas))
  const cambiarAccion = (accion) => setEntrada(armarEntrada(meta, entrada.rol, accion, entrada, tocadas))
  const cambiarVariable = (variable, valor) => {
    setTocadas(new Set([...tocadas, variable]))
    setEntrada({ ...entrada, [variable]: typeof meta.valores[variable][0].valor === 'number' ? Number(valor) : valor })
  }
  const cargarEscenario = (e) => {
    setTocadas(new Set(Object.keys(e.entrada)))
    setEntrada(armarEntrada(meta, e.entrada.rol, e.entrada.accion, e.entrada, new Set(Object.keys(e.entrada))))
  }
  const activo = (e) => JSON.stringify(Object.entries(e.entrada).sort()) === JSON.stringify(Object.entries(entrada).sort())
  const rolNombre = matriz.roles.find((r) => r.id === entrada.rol)?.nombre
  const accionNombre = matriz.acciones.find((a) => a.id === entrada.accion)?.nombre

  const d = resultado?.decision
  const alternativas = resultado?.alternativas || []

  return (
    <>
      <p className="suave">Arma una situación y el motor de decisiones real te dice qué pasaría, <strong>por qué</strong> y <strong>qué la cambiaría</strong>. Es hipotético: no se registra ni toca ningún dato.</p>
      <Alerta>{error}</Alerta>
      <div className="simulador">
        <section className="panel" aria-labelledby="sim-situacion">
          <h3 id="sim-situacion">1. Arma la situación</h3>
          <label className="campo">
            <span>Quién actúa</span>
            <select className="seleccion" value={entrada.rol} onChange={(e) => cambiarRol(e.target.value)}>
              {matriz.roles.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
            </select>
          </label>
          <label className="campo">
            <span>Qué intenta hacer</span>
            <select className="seleccion" value={entrada.accion} onChange={(e) => cambiarAccion(e.target.value)}>
              {acciones.map((g) => <optgroup key={g.titulo} label={g.titulo}>{g.items.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}</optgroup>)}
            </select>
          </label>
          <h4 className="separado">En qué circunstancias</h4>
          {(meta.variables[entrada.accion] || []).map((v) => (
            <label className="campo" key={v}>
              <span>{meta.etiquetas[v]}</span>
              <select className="seleccion" value={String(entrada[v])} onChange={(e) => cambiarVariable(v, e.target.value)}>
                {meta.valores[v].map((o) => <option key={String(o.valor)} value={String(o.valor)}>{o.etiqueta}</option>)}
              </select>
            </label>
          ))}
        </section>

        <div>
          <section className={`veredicto ${d ? (d.permitido ? 'permitido' : 'negado') : ''}`} aria-live="polite" aria-busy={cargando}>
            {!d ? <p className="suave">Consultando al motor de decisiones…</p> : (
              <>
                <div className="veredicto-cabecera">
                  <span className={`sello ${d.permitido ? 'sello-aprobado' : 'sello-rechazado'}`}>{d.permitido ? 'Permitido' : 'Negado'}</span>
                  <p><strong>{rolNombre}</strong> intenta <strong>{accionNombre.toLowerCase()}</strong>.</p>
                </div>
                <dl className="datos">
                  <dt>Política que decidió</dt><dd><code>{d.politica}</code></dd>
                  <dt>Por qué</dt><dd className="normal">{explicar(d.politica) || 'Ninguna política lo permite explícitamente: se niega por defecto.'}</dd>
                </dl>
                {resultado.ejemplo && <Alerta tipo="info">Modo de ejemplo: solo responde a los escenarios predefinidos. En la plataforma real responde a cualquier combinación.</Alerta>}
              </>
            )}
          </section>

          {resultado && (
            <>
              <section className="panel" aria-labelledby="sim-traza">
                <h3 id="sim-traza">2. Cómo se evaluó</h3>
                <p className="suave">Primero las reglas que anulan todo; después las que permiten. Se detiene en la primera que decide.</p>
                <ol className="traza">
                  {resultado.traza.map((p, i) => {
                    const r = RESULTADO[p.resultado]
                    return (
                      <li key={i} className={r.clase}>
                        <span className="traza-icono"><Icono nombre={r.icono} /></span>
                        <div>
                          <span className="traza-fase">{FASE[p.fase]}</span>
                          <strong>{p.regla}</strong>
                          {p.politica && <code>{p.politica}</code>}
                        </div>
                        <Insignia clase={r.clase === 'niega' ? 'e-rechazado' : r.clase === 'permite' ? 'e-aprobado' : ''} punto={false}>{r.texto}</Insignia>
                      </li>
                    )
                  })}
                </ol>
              </section>

              <section className="panel" aria-labelledby="sim-cambio">
                <h3 id="sim-cambio">3. Qué lo cambiaría</h3>
                <p className="suave">{d.permitido ? 'Estos cambios, de uno en uno, harían que se negara:' : 'Estos cambios, de uno en uno, harían que se permitiera:'}</p>
                {alternativas.length === 0 ? (
                  <p className="suave">{d.permitido ? 'Ninguna variable por sí sola lo niega.' : 'Ningún cambio de una sola variable lo permitiría: haría falta otro rol u otra acción.'}</p>
                ) : (
                  <ul className="alternativas">
                    {alternativas.map((a) => (
                      <li key={`${a.variable}-${a.valor}`}>
                        <span><strong>{a.etiqueta_variable}:</strong> {a.etiqueta_valor}</span>
                        <Insignia clase={a.permitido ? 'e-aprobado' : 'e-rechazado'} punto={false}>{a.permitido ? 'Permitido' : 'Negado'}</Insignia>
                        <code>{a.politica}</code>
                        <button className="btn btn-sec btn-s" onClick={() => cambiarVariable(a.variable, a.valor)} aria-label={`Probar: ${a.etiqueta_variable}, ${a.etiqueta_valor}`}>Probarlo</button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          )}
        </div>
      </div>

      <section className="panel" aria-labelledby="sim-escenarios">
        <h3 id="sim-escenarios">Escenarios para probar</h3>
        <p className="suave">Situaciones típicas que muestran cada protección. Pulsa una y mira la traza.</p>
        <div className="escenarios">
          {escenarios.map((e) => (
            <button key={e.id} className={`escenario ${activo(e) ? 'activo' : ''}`} aria-pressed={activo(e)} onClick={() => cargarEscenario(e)}>
              <strong>{e.titulo}</strong>
              <span>{e.leccion}</span>
            </button>
          ))}
        </div>
      </section>
    </>
  )
}
