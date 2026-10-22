import { MAPA } from './mapa-panama.js'

// Mapa de Panamá con el recorrido de un trámite: de la recepción (David) a la resolución (Ciudad de Panamá), con la boya en la
// tramitación. La silueta es geografía real (Natural Earth, ver docs/identidad/generar_mapa.py) y el trazo azul claro es el Canal.
// Es solo ilustración: va con los colores de la plataforma (azul petróleo y naranja boya).
export function MapaPanama() {
  const { david, penonome, panama } = MAPA.nodos
  return (
    <figure className="mapa">
      <svg viewBox={`0 0 ${MAPA.ancho} ${MAPA.alto}`} role="img" aria-label="Mapa de Panamá con el recorrido de un trámite, de la recepción a la resolución">
        <path className="mapa-halo h3" d={MAPA.pais} />
        <path className="mapa-halo h2" d={MAPA.pais} />
        <path className="mapa-halo h1" d={MAPA.pais} />
        <path className="mapa-pais" d={MAPA.pais} />
        <path className="mapa-canal" d={MAPA.canal} />
        <text className="mapa-nota" x={MAPA.nodos.panama[0] - 52} y={MAPA.nodos.panama[1] - 46} textAnchor="end">Canal</text>

        <path className="mapa-ruta-pendiente" d={MAPA.ruta_pendiente} />
        <path className="mapa-ruta" pathLength="1" d={MAPA.ruta_hecha} />

        <g className="mapa-nodo hecho" transform={`translate(${david[0]} ${david[1]})`}><circle r="7" /><text className="mapa-etiqueta" y="26" textAnchor="middle">Recepción</text></g>
        <g className="mapa-nodo" transform={`translate(${panama[0]} ${panama[1]})`}><circle r="7" /><text className="mapa-etiqueta" x="14" y="4">Resolución</text></g>
        <g className="mapa-boya" transform={`translate(${penonome[0]} ${penonome[1]})`}>
          <circle className="aro" r="9" /><circle className="punto" r="8" />
          <text className="mapa-etiqueta" y="28" textAnchor="middle">Tramitación</text>
        </g>
      </svg>
      <figcaption>Cada trámite, trazado de punta a punta</figcaption>
    </figure>
  )
}
