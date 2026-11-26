import { Icono } from './ui.jsx'

// Seguimiento de un trámite: tres pasos en línea y una frase en lenguaje llano que dice qué está pasando y qué sigue.
// Reemplaza a las «esclusas», que bonitas pero no se entendían. Es solo presentación: el estado lo decide el servidor.

export const ETIQUETA = { Pendiente: 'Recepción', 'En Tramitacion': 'En tramitación', 'En Subsanacion': 'En subsanación', Aprobado: 'Aprobado', Rechazado: 'Rechazado' }

export const FRASES = {
  Pendiente: ['bandeja', 'normal', 'Recibimos el trámite. Está en la fila, esperando a que un funcionario lo tome.'],
  'En Tramitacion': ['supervision', 'normal', 'Un funcionario lo está revisando. Si falta algo, aquí te avisaremos.'],
  'En Subsanacion': ['alerta', 'alerta', 'Falta información o hay algo por corregir. El trámite sigue su curso en cuanto se complete.'],
  Aprobado: ['check', 'bien', 'Trámite resuelto: fue aprobado.'],
  Rechazado: ['x', 'mal', 'Trámite resuelto: fue rechazado.'],
}

/** Los tres pasos con su situación según el estado: hecho, actual, futuro, alerta (subsanación), aprobado o rechazado. */
export function pasosDe(estado) {
  const final = estado === 'Aprobado' || estado === 'Rechazado'
  return [
    { id: 'recepcion', etiqueta: 'Recepción', icono: 'bandeja', situacion: estado === 'Pendiente' ? 'actual' : 'hecho',
      detalle: estado === 'Pendiente' ? 'En la fila' : 'Recibido' },
    { id: 'tramitacion', etiqueta: 'Tramitación', icono: estado === 'En Subsanacion' ? 'alerta' : 'supervision',
      situacion: estado === 'Pendiente' ? 'futuro' : estado === 'En Tramitacion' ? 'actual' : estado === 'En Subsanacion' ? 'alerta' : 'hecho',
      detalle: estado === 'Pendiente' ? 'Por empezar' : estado === 'En Tramitacion' ? 'En revisión' : estado === 'En Subsanacion' ? 'Falta información' : 'Revisado' },
    { id: 'resolucion', etiqueta: final ? ETIQUETA[estado] : 'Resolución', icono: estado === 'Rechazado' ? 'x' : final ? 'check' : 'auditoria',
      situacion: estado === 'Aprobado' ? 'aprobado' : estado === 'Rechazado' ? 'rechazado' : 'futuro',
      detalle: final ? 'Trámite resuelto' : 'Aprobado o rechazado' },
  ]
}

export function Seguimiento({ estado }) {
  const [icono, tono, frase] = FRASES[estado] || FRASES.Pendiente
  return (
    <div className="seguimiento">
      <div role="img" aria-label={`Recorrido del trámite: ${ETIQUETA[estado] || estado}`}>
        <ol className="seg-pasos" aria-hidden="true">
          {pasosDe(estado).map((p) => (
            <li key={p.id} className={`seg-paso ${p.situacion}`}>
              <span className="seg-nodo"><Icono nombre={p.situacion === 'hecho' ? 'check' : p.icono} /></span>
              <strong>{p.etiqueta}</strong>
              <small>{p.detalle}</small>
            </li>
          ))}
        </ol>
      </div>
      <p className={`seguimiento-frase tono-${tono}`}><Icono nombre={icono} /><span>{frase}</span></p>
    </div>
  )
}
