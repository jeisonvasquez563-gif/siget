import { useMemo, useState } from 'react'
import { Alerta, Icono, Vacio } from './ui.jsx'

// Ayuda y preguntas frecuentes. Pantalla estática: no llama al servidor. El contenido se adapta al rol solo para mostrar lo que le toca a cada
// persona (quien no atiende trámites no ve la bandeja); nada de esto da ni quita permisos: eso lo decide el servidor en cada petición.

// Un párrafo es un texto; los enlaces se escriben [[texto|#/destino]]. Una lista es un arreglo de textos; una definición es { definiciones: [[término, texto], …] }.
const SECCIONES = [
  {
    id: 'tramites', titulo: 'Mis trámites', para: 'persona', preguntas: [
      {
        id: 'iniciar', pregunta: '¿Cómo inicio un trámite?', cuerpo: [
          'Entra a «Iniciar un trámite», elige la institución y el trámite del catálogo, completa el formulario y envíalo. Al terminar recibes un número de trámite.',
          'Con ese número sigues cada etapa desde «Mis trámites»: ahí ves el estado, la fecha límite y el historial de lo que se hizo.',
          'Si trabajas en una institución, no puedes iniciar trámites en la tuya; sí en otras, cuando el trámite está abierto a otras instituciones.',
        ],
      },
      {
        id: 'estados', pregunta: '¿Qué significa cada estado de mi trámite?', cuerpo: [
          { definiciones: [
            ['Pendiente', 'La institución recibió tu trámite y todavía nadie lo toma.'],
            ['En tramitación', 'Una persona de la institución lo está revisando.'],
            ['En subsanación', 'Falta algo: la institución te pidió corregir o completar información. El trámite espera tu respuesta.'],
            ['Aprobado', 'El trámite terminó con resultado favorable.'],
            ['Rechazado', 'El trámite terminó sin ser aprobado. En el historial queda el motivo.'],
            ['Desistido', 'Retiraste tu trámite: ya no sigue adelante.'],
          ] },
          'Aprobado, Rechazado y Desistido son estados finales: el trámite ya no cambia.',
        ],
      },
      {
        id: 'subsanacion', pregunta: '¿Qué es una subsanación y cómo la respondo?', cuerpo: [
          'Es un pedido de la institución para que corrijas o completes algo de tu trámite. Te llega un aviso en la campana y el trámite pasa a «En subsanación»; el motivo aparece en su historial.',
          'Para responder, abre el trámite, adjunta los documentos que falten si hace falta, corrige los datos si te lo piden y escribe tu respuesta (entre 10 y 2000 caracteres). Al enviarla, el trámite vuelve a «En tramitación».',
        ],
      },
      {
        id: 'documentos', pregunta: '¿Cómo adjunto un documento y dónde veo los que ya adjunté?', cuerpo: [
          'Se adjunta desde el trámite, mientras no tenga una resolución final. Se aceptan PDF, PNG y JPEG de hasta 5 MB, y cada trámite admite una cantidad limitada de documentos.',
          'Todos los documentos que adjuntaste, de todos tus trámites, están en «Mis documentos»: puedes buscarlos por nombre o por trámite, descargarlos y volver al trámite al que pertenecen.',
        ],
      },
      {
        id: 'notificaciones', pregunta: '¿Cómo funcionan las notificaciones?', cuerpo: [
          'La campana de la barra superior te avisa cuando tu trámite cambia: lo toman para atenderlo, te piden una subsanación, o se aprueba o se rechaza. El aviso solo dice qué pasó; el detalle lo ves al abrir el trámite.',
          'Puedes marcar cada aviso como leído o todos a la vez. Las notificaciones son solo dentro de la plataforma: no se envían por correo.',
        ],
      },
    ],
  },
  {
    id: 'cuenta', titulo: 'Mi cuenta y mi seguridad', para: 'todos', preguntas: [
      {
        id: 'mfa', pregunta: '¿Qué es el segundo factor y para qué sirve?', cuerpo: [
          'Es un código de 6 dígitos que cambia cada 30 segundos y que genera una aplicación de autenticación en tu teléfono. Se pide además de tu contraseña: aunque alguien la conozca, sin el código no entra a tu cuenta.',
          'Algunas acciones delicadas, como cambiar tu contraseña o gestionar a tu equipo, vuelven a pedirte un código reciente. Es normal: es una protección, no un error. Mira tu actividad reciente y el estado del segundo factor en «Segundo factor (MFA)».',
        ],
      },
      {
        id: 'telefono', pregunta: 'Perdí o cambié mi teléfono: ¿qué hago?', cuerpo: [
          'No podrás entrar solo con tu contraseña, y por seguridad el segundo factor no se recupera por cuenta propia. La recuperación es asistida: una persona operadora de identidades de la plataforma restablece tu segundo factor, y eso cierra tus sesiones abiertas.',
          'Después de que lo restablezca, entras con tu contraseña y configuras el segundo factor de nuevo con tu teléfono nuevo. Si además olvidaste la contraseña, pide un código de restablecimiento y usa «¿Olvidaste tu contraseña?» en la pantalla de acceso.',
          'Nadie del equipo de SIGET te pedirá nunca tu contraseña ni tu código por mensaje o por teléfono.',
        ],
      },
      {
        id: 'privacidad', pregunta: '¿Qué hace SIGET con mis datos? ¿Dónde está el aviso de privacidad?', cuerpo: [
          'SIGET guarda solo lo necesario para gestionar tus trámites y proteger tu cuenta. El detalle de qué datos se tratan, para qué y por cuánto tiempo está en el [[aviso de privacidad|#/privacidad]], que puedes leer en cualquier momento.',
        ],
      },
    ],
  },
  {
    id: 'datos', titulo: 'Mis datos personales (Ley 81)', para: 'persona', preguntas: [
      {
        id: 'derechos', pregunta: '¿Cómo ejerzo mis derechos sobre mis datos personales?', cuerpo: [
          'La Ley 81 de protección de datos personales te da derechos sobre tus datos. Todo se hace desde «Mis datos»:',
          ['Consultar los datos que SIGET tiene de ti.', 'Corregir tu correo, tu provincia y tu ciudad directamente.', 'Descargar una copia de tus datos.',
            'Enviar una solicitud de rectificación (por ejemplo, un error en tu nombre o tu cédula), de cancelación o de oposición.'],
          'Corregir y descargar piden un código reciente del segundo factor. Cada solicitud se responde en un máximo de 10 días hábiles y ves su estado en la misma pantalla.',
        ],
      },
    ],
  },
  {
    id: 'bandeja', titulo: 'Atención de trámites', para: 'atiende', preguntas: [
      {
        id: 'bandeja', pregunta: '¿Cómo trabajo la bandeja de mi institución?', cuerpo: [
          'En «Bandeja de la institución» ves los trámites de tu institución con su estado, su plazo y quién los atiende. Abre uno para revisar los datos y los documentos, y cambiar su estado a la siguiente etapa que corresponda.',
          'Cambiar el estado pide un segundo factor reciente, y solo puedes tomar trámites sin asignar o asignados a ti. No puedes gestionar un trámite que iniciaste tú.',
        ],
      },
      {
        id: 'motivo', pregunta: '¿Por qué me pide un motivo obligatorio?', cuerpo: [
          'Al rechazar un trámite, al pedir una subsanación y al cerrarla, debes escribir el motivo (entre 10 y 2000 caracteres). Queda en el historial del trámite, junto con quién decidió y cuándo.',
          'Escribe el motivo pensando en quien lo va a leer: la persona solicitante ve el motivo de los rechazos y de las subsanaciones. No pongas datos personales de terceros.',
        ],
      },
      {
        id: 'escalamiento', pregunta: '¿Qué es un trámite escalado?', cuerpo: [
          'Cuando un trámite abierto pasa de su fecha límite, la plataforma lo marca como escalado y avisa a la supervisión, que lo atiende con prioridad. Los plazos se cuentan en días hábiles de Panamá, sin fines de semana ni feriados.',
          'Para evitar el escalamiento, resuelve o pide la subsanación antes de que venza el plazo.',
        ],
      },
    ],
  },
  {
    id: 'supervision', titulo: 'Supervisión', para: 'supervisa', preguntas: [
      {
        id: 'reasignar', pregunta: '¿Cómo reasigno trámites y qué veo en los indicadores?', cuerpo: [
          'En «Supervisión» reasignas trámites al personal de tu institución (o los devuelves a la cola) y atiendes los escalados. Solo puedes asignar a personal vigente de tu institución que no sea quien pidió el trámite.',
          'En «Indicadores» ves cuántos trámites hay por estado, cuántos están vencidos o escalados, el tiempo promedio de resolución de los últimos 90 días y la carga de cada funcionario, para repartir mejor el trabajo.',
        ],
      },
    ],
  },
  {
    id: 'coordinacion', titulo: 'Coordinación de la institución', para: 'coordina', preguntas: [
      {
        id: 'coordinar', pregunta: '¿Qué puede hacer la coordinación?', cuerpo: [
          'La coordinación gestiona a las personas y el catálogo de su institución, pero no ve los trámites: ni su contenido ni sus documentos.',
          ['En «Equipo de la institución» agrega personal, cambia su rol o quita su acceso (no se puede quitar a quien aún tiene trámites abiertos asignados).', 'En «Catálogo de la institución» crea, edita, activa o desactiva los trámites que ofrece la institución.',
            'En «Indicadores» consulta las cifras agregadas de la institución, sin datos de personas.'],
        ],
      },
    ],
  },
  {
    id: 'plataforma', titulo: 'Cuentas de la plataforma', para: 'plataforma', preguntas: [
      {
        id: 'operadores', pregunta: '¿Qué puede hacer mi cuenta de plataforma?', cuerpo: [
          'Cada rol de plataforma tiene una sola consola con lo que le corresponde, y ninguno puede ver trámites ni documentos de la ciudadanía. Las altas sensibles se hacen con control dual: una persona propone y otra distinta aprueba.',
          'En «Acceso a trámites» puedes comprobar en vivo que tu rol no llega a los trámites, y en «Mi seguridad» ves qué te permite tu rol.',
        ],
      },
    ],
  },
]

const sinTildes = (t) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const ENLACE = /\[\[(.+?)\|(.+?)\]\]/g
const planoDe = (texto) => texto.replace(ENLACE, '$1')

function textoPlano(pregunta) {
  const partes = [pregunta.pregunta]
  for (const bloque of pregunta.cuerpo) {
    if (typeof bloque === 'string') partes.push(planoDe(bloque))
    else if (Array.isArray(bloque)) partes.push(...bloque.map(planoDe))
    else partes.push(...bloque.definiciones.flat())
  }
  return sinTildes(partes.join(' '))
}

function Parrafo({ texto }) {
  const trozos = []
  let desde = 0
  for (const m of texto.matchAll(ENLACE)) {
    trozos.push(texto.slice(desde, m.index))
    trozos.push(<a key={m.index} href={m[2]}>{m[1]}</a>)
    desde = m.index + m[0].length
  }
  trozos.push(texto.slice(desde))
  return <p>{trozos}</p>
}

function Cuerpo({ cuerpo }) {
  return cuerpo.map((b, i) => {
    if (typeof b === 'string') return <Parrafo key={i} texto={b} />
    if (Array.isArray(b)) return <ul key={i}>{b.map((t) => <li key={t}>{t}</li>)}</ul>
    return <dl key={i} className="ayuda-definiciones">{b.definiciones.map(([t, d]) => <div key={t}><dt>{t}</dt><dd>{d}</dd></div>)}</dl>
  })
}

// A quién le toca cada sección. «persona»: cualquier cuenta sin rol de plataforma (también el personal: es persona que inicia trámites en otras instituciones)
function audiencias(yo) {
  const roles = (yo.membresias || []).map((m) => m.rol)
  const plataforma = yo.rol_plataforma !== 'ninguno'
  return {
    todos: true,
    persona: !plataforma,
    atiende: !plataforma && roles.some((r) => r === 'funcionario' || r === 'supervisor'),
    supervisa: !plataforma && roles.includes('supervisor'),
    coordina: !plataforma && roles.includes('coordinador_institucional'),
    plataforma,
  }
}

export function Ayuda({ yo }) {
  const [q, setQ] = useState('')
  const visibles = useMemo(() => {
    const quien = audiencias(yo)
    return SECCIONES.filter((s) => quien[s.para]).map((s) => ({ ...s, preguntas: s.preguntas.map((p) => ({ ...p, plano: textoPlano(p) })) }))
  }, [yo])
  const buscado = sinTildes(q.trim())
  const palabras = buscado.split(/\s+/).filter(Boolean)
  const secciones = visibles.map((s) => ({ ...s, preguntas: s.preguntas.filter((p) => palabras.every((w) => p.plano.includes(w))) })).filter((s) => s.preguntas.length)
  const cuantas = secciones.reduce((n, s) => n + s.preguntas.length, 0)

  return (
    <>
      <div className="encabezado-vista">
        <div><h2>Ayuda</h2><p>Respuestas a las preguntas más comunes sobre SIGET, en lenguaje sencillo. Elige una pregunta para ver la respuesta.</p></div>
      </div>
      <div className="barra-herramientas">
        <div className="buscador">
          <Icono nombre="buscar" />
          <input className="entrada entrada-buscar" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Busca una pregunta o una palabra" aria-label="Buscar en la ayuda" />
        </div>
      </div>
      <p className="nota" role="status" aria-live="polite">{q.trim() ? (cuantas === 0 ? 'No hay preguntas que coincidan.' : `${cuantas} ${cuantas === 1 ? 'pregunta coincide' : 'preguntas coinciden'} con tu búsqueda.`) : `${cuantas} preguntas frecuentes.`}</p>
      {cuantas === 0 ? <Vacio titulo="Nada coincide con tu búsqueda" texto="Prueba con otra palabra, por ejemplo «estado», «segundo factor» o «documentos»." /> : secciones.map((s) => (
        <section className="panel ayuda-seccion" key={s.id} aria-labelledby={`ayuda-${s.id}`}>
          <h3 id={`ayuda-${s.id}`}>{s.titulo}</h3>
          {s.preguntas.map((p) => (
            <details className="ayuda-pregunta" key={p.id} open={q.trim() ? true : undefined}>
              <summary>{p.pregunta}</summary>
              <div className="ayuda-respuesta"><Cuerpo cuerpo={p.cuerpo} /></div>
            </details>
          ))}
        </section>
      ))}
      <Alerta tipo="info">¿No encontraste lo que buscabas? Si tu pregunta es sobre un trámite concreto, abre el trámite y revisa su historial: ahí queda cada decisión con su motivo.</Alerta>
    </>
  )
}
