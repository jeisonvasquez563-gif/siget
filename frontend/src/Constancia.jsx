import { useEffect, useState } from 'react'
import { api } from './api.js'
import { Estado, fecha, fechaCorta, mensajeDe } from './comun.jsx'
import { valorLegible } from './Contenido.jsx'
import { Alerta, BloquesEsqueleto, Esqueleto, Icono, Logo } from './ui.jsx'

// Constancia de presentación de un trámite: la página que la persona imprime o guarda como PDF desde el navegador (no hay librerías de PDF:
// `window.print()` y una hoja de estilo para impresión que deja solo la constancia, sin menú ni botones). La arma el servidor, solo para quien
// presentó el trámite, con las etiquetas de la COPIA del formulario con el que se presentó. Todo texto del servidor se dibuja como texto de
// React (nunca como HTML) y nada de esto se guarda en el navegador ni viaja en la URL.

export function Constancia({ id, volver }) {
  const [c, setC] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let vigente = true
    api(`/tramites/${id}/constancia/`)
      .then((d) => { if (vigente) setC(d) })
      .catch((e) => { if (vigente) { setError(mensajeDe(e)); setC(false) } })
    return () => { vigente = false }
  }, [id])

  if (c === null) return <><BloquesEsqueleto n={1} /><Esqueleto filas={3} /></>
  if (c === false) return <><button className="migas" onClick={volver}><Icono nombre="izquierda" />Volver al trámite</button><Alerta>{error}</Alerta></>

  return (
    <>
      <div className="constancia-barra no-imprimir">
        <button className="migas" onClick={volver}><Icono nombre="izquierda" />Volver al trámite</button>
        <button type="button" className="btn" onClick={() => window.print()}><Icono nombre="documento" />Imprimir o guardar como PDF</button>
      </div>
      <article className="constancia" aria-labelledby="titulo-constancia">
        <header className="constancia-cabecera">
          <Logo className="constancia-logo" />
          <div>
            <p className="constancia-sistema">SIGET · Gestión y trazabilidad de trámites</p>
            <h2 id="titulo-constancia">Constancia de presentación</h2>
          </div>
        </header>
        <dl className="datos constancia-datos">
          <dt>N.º de trámite</dt><dd className="num">#{c.numero}</dd>
          <dt>Trámite</dt><dd>{c.tipo_tramite.nombre}</dd>
          <dt>Institución</dt><dd>{c.institucion.nombre}</dd>
          <dt>Presentado el</dt><dd>{fecha(c.presentado_en)}</dd>
          <dt>Fecha límite de atención</dt><dd>{fechaCorta(c.fecha_limite)}</dd>
          <dt>Estado actual</dt><dd><Estado valor={c.estado} /></dd>
        </dl>

        <section aria-labelledby="constancia-datos">
          <h3 id="constancia-datos">Datos enviados</h3>
          {c.datos.length === 0 ? <p className="suave">Este trámite no tiene datos de formulario.</p> : (
            <dl className="datos datos-solicitud constancia-enviados">
              {c.datos.map((d) => (
                <div key={d.id} className="dato-fila"><dt>{d.etiqueta}</dt><dd className={d.tipo === 'texto_largo' ? 'texto-largo' : ''}>{valorLegible({ tipo: d.tipo }, d.valor)}</dd></div>
              ))}
            </dl>
          )}
        </section>

        <section aria-labelledby="constancia-documentos">
          <h3 id="constancia-documentos">Documentos adjuntos</h3>
          {c.documentos.length === 0 ? <p className="suave">No se adjuntó ningún documento.</p> : <ul className="lista-requisitos">{c.documentos.map((d) => <li key={d.id}>{d.nombre}</li>)}</ul>}
        </section>

        <footer className="constancia-pie">
          <p>Constancia emitida el {fecha(c.emitida_en)} a nombre de quien presentó el trámite. Acredita que se presentó con los datos y documentos indicados en la fecha y hora
            señaladas; no es una resolución ni asegura que se apruebe. El estado puede haber cambiado desde entonces: consúltalo siempre en SIGET.</p>
          <p>Contiene los datos que enviaste: guárdala en un lugar seguro.</p>
        </footer>
      </article>
    </>
  )
}
