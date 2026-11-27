import { useEffect, useMemo, useState } from 'react'
import { api } from './api.js'
import { mensajeDe } from './comun.jsx'
import { AVISO_ORIENTATIVO, Buscador, diasHabiles } from './Tramites.jsx'
import { Alerta, BloquesEsqueleto, Vacio } from './ui.jsx'

// Directorio de instituciones: qué trámites ofrece cada una, con su plazo, los documentos que hacen falta y qué pasa después. Es información
// pública del catálogo (la misma de «Iniciar un trámite»): no hay nada de nadie. Los textos vienen de la coordinación de cada institución y se
// dibujan siempre como texto de React (nunca como HTML). Hasta que cada institución los valide, son orientativos.

const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`

function FichaTramite({ tipo, institucion, esPropia, iniciar }) {
  const r = tipo.requisitos || {}
  const documentos = Array.isArray(r.documentos) ? r.documentos : []
  return (
    <article className="ficha-tramite" aria-labelledby={`tramite-${tipo.id}`}>
      <h4 id={`tramite-${tipo.id}`}>{tipo.nombre}</h4>
      <p className="nota" role="note">{AVISO_ORIENTATIVO}</p>
      {r.descripcion ? <p className="texto-largo">{r.descripcion}</p> : <p className="suave">La institución todavía no describió este trámite.</p>}
      <dl className="datos">
        <dt>Plazo de atención</dt><dd>{diasHabiles(tipo.sla_dias)}</dd>
      </dl>
      <h5>Documentos necesarios</h5>
      {documentos.length ? <ul className="lista-requisitos">{documentos.map((d, i) => <li key={i}>{d}</li>)}</ul> : <p className="suave">La institución no pide documentos para este trámite.</p>}
      <h5>Qué pasa después</h5>
      <p className="texto-largo">{r.despues || 'Recibirás un número de seguimiento y verás cada paso del trámite en la plataforma.'}</p>
      {esPropia
        ? <p className="nota">Es tu institución: el personal no inicia trámites en la propia.</p>
        : <div className="fila-botones inicio"><button type="button" className="btn" onClick={() => iniciar(institucion.id, tipo.id)}>Iniciar este trámite<span className="solo-lector"> «{tipo.nombre}»</span></button></div>}
    </article>
  )
}

export function Directorio({ yo, iniciar }) {
  const [datos, setDatos] = useState(null) // { instituciones, tipos }
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const [abierta, setAbierta] = useState(null) // id de la institución que se está leyendo
  // Igual que «Iniciar un trámite»: la ciudadanía ve lo que puede iniciar; el personal, las solicitudes hacia otras instituciones
  const esPersonal = yo.membresias.length > 0
  const propias = useMemo(() => new Set(yo.membresias.map((m) => m.institucion_id)), [yo.membresias])

  useEffect(() => {
    let vigente = true
    Promise.all([api('/catalogo/instituciones/'), api('/catalogo/tipos-tramite/')])
      .then(([instituciones, tipos]) => { if (vigente) setDatos({ instituciones, tipos }) })
      .catch((e) => { if (vigente) { setError(mensajeDe(e)); setDatos({ instituciones: [], tipos: [] }) } })
    return () => { vigente = false }
  }, [])

  const porInstitucion = useMemo(() => {
    const mapa = new Map()
    for (const t of datos?.tipos || []) {
      if (!(t.audiencia === 'ambas' || t.audiencia === (esPersonal ? 'institucion' : 'ciudadania'))) continue
      mapa.set(t.institucion.id, [...(mapa.get(t.institucion.id) || []), t])
    }
    return mapa
  }, [datos, esPersonal])

  const visibles = useMemo(() => {
    const palabras = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
    return (datos?.instituciones || []).filter((i) => {
      const texto = `${i.nombre} ${(porInstitucion.get(i.id) || []).map((t) => t.nombre).join(' ')}`.toLowerCase()
      return palabras.every((p) => texto.includes(p))
    })
  }, [datos, q, porInstitucion])

  const institucion = datos?.instituciones.find((i) => i.id === abierta) || null
  const tramites = institucion ? porInstitucion.get(institucion.id) || [] : []

  return (
    <>
      <div className="encabezado-vista"><div><h2>Directorio</h2><p>Instituciones y los trámites que ofrecen. Abre una para ver el plazo, los documentos que necesitas y qué pasa después.</p></div></div>
      <Alerta>{error}</Alerta>
      {datos === null ? <BloquesEsqueleto n={3} /> : (
        <div className="directorio">
          <section className="panel" aria-labelledby="directorio-lista">
            <div className="panel-cabecera"><h3 id="directorio-lista">Instituciones</h3></div>
            <Buscador valor={q} cambiar={setQ} etiqueta="Buscar una institución o un trámite" />
            {visibles.length === 0 ? <Vacio titulo="Sin resultados" texto={q ? 'Ninguna institución ni trámite coincide con tu búsqueda.' : 'Todavía no hay instituciones en el directorio.'} /> : (
              <ul className="lista-directorio" aria-label="Instituciones">
                {visibles.map((i) => {
                  const n = (porInstitucion.get(i.id) || []).length
                  return (
                    <li key={i.id}>
                      <button type="button" className="opcion" aria-pressed={abierta === i.id} onClick={() => setAbierta(i.id)}>
                        <span className="cuerpo-opcion"><strong>{i.nombre}</strong><small>{n ? plural(n, 'trámite', 'trámites') : 'Sin trámites para ti'}</small></span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
          <section className="panel detalle-directorio" aria-live="polite" aria-labelledby={institucion ? 'directorio-institucion' : undefined}>
            {institucion ? (
              <>
                <div className="panel-cabecera"><h3 id="directorio-institucion">{institucion.nombre}</h3></div>
                {tramites.length === 0
                  ? <p className="suave">Esta institución no tiene trámites publicados para ti.</p>
                  : tramites.map((t) => <FichaTramite key={t.id} tipo={t} institucion={institucion} esPropia={propias.has(institucion.id)} iniciar={iniciar} />)}
                <p className="nota">La información la publica cada institución y puede cambiar: el plazo se cuenta en días hábiles desde que se presenta el trámite.</p>
              </>
            ) : <p className="suave">Elige una institución de la lista para ver sus trámites.</p>}
          </section>
        </div>
      )}
    </>
  )
}
