import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'

/* ---------------------------------------------------------------- iconos (trazo propio, sin librerías ni CDN) */

const RUTAS = {
  inicio: 'M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10',
  documento: 'M7 3h7l5 5v13H7z M14 3v5h5 M10 13h6 M10 17h6',
  mas: 'M12 5v14M5 12h14',
  bandeja: 'M4 13l2-8h12l2 8M4 13v6h16v-6M4 13h5l1 2h4l1-2h5',
  supervision: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z M12 9a3 3 0 100 6 3 3 0 000-6',
  equipo: 'M16 20v-1a4 4 0 00-4-4H7a4 4 0 00-4 4v1 M9.5 11a3.5 3.5 0 100-7 3.5 3.5 0 000 7 M21 20v-1a4 4 0 00-3-3.9 M16 4.2a3.5 3.5 0 010 6.6',
  escudo: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z M9 12l2 2 4-4',
  candado: 'M6 11V8a6 6 0 1112 0v3 M5 11h14v10H5z M12 15v2',
  auditoria: 'M5 3h11l3 3v15H5z M9 9h6 M9 13h6 M9 17h4',
  consola: 'M4 4h7v7H4z M13 4h7v7h-7z M4 13h7v7H4z M13 13h7v7h-7z',
  salir: 'M9 21H5V3h4 M16 17l5-5-5-5 M21 12H9',
  sol: 'M12 8a4 4 0 100 8 4 4 0 000-8 M12 2v2 M12 20v2 M4.9 4.9l1.4 1.4 M17.7 17.7l1.4 1.4 M2 12h2 M20 12h2 M4.9 19.1l1.4-1.4 M17.7 6.3l1.4-1.4',
  luna: 'M21 13A9 9 0 1111 3a7 7 0 0010 10z',
  menu: 'M4 6h16M4 12h16M4 18h16',
  izquierda: 'M15 6l-6 6 6 6',
  derecha: 'M9 6l6 6-6 6',
  check: 'M5 13l4 4L19 7',
  x: 'M6 6l12 12M18 6L6 18',
  alerta: 'M12 3l10 18H2z M12 10v5 M12 18v.01',
  info: 'M12 3a9 9 0 100 18 9 9 0 000-18 M12 11v5 M12 8v.01',
  buscar: 'M11 4a7 7 0 100 14 7 7 0 000-14 M21 21l-5-5',
  lista: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  tablero: 'M4 4h5v16H4z M10 4h5v10h-5z M16 4h4v13h-4z',
  reloj: 'M12 3a9 9 0 100 18 9 9 0 000-18 M12 7v5l3 2',
  usuario: 'M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2 M12 11a4 4 0 100-8 4 4 0 000 8',
  reasignar: 'M7 7h13l-3-3 M17 17H4l3 3',
  llave: 'M14 10a4 4 0 11-4 4l-7 7v-3h3v-3h3l1-1 M16 8h.01',
  tabla: 'M4 5h16v14H4z M4 10h16 M10 5v14',
  flujo: 'M5 5h4v4H5z M15 5h4v4h-4z M10 17h4v4h-4z M7 9v3h10V9 M12 12v5',
}

export function Icono({ nombre, className = '' }) {
  return (
    <svg className={`icono ${className}`} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {RUTAS[nombre].split(' M').map((d, i) => <path key={i} d={i === 0 ? d : `M${d}`} />)}
    </svg>
  )
}

/* ---------------------------------------------------------------- marca */

export function Logo({ className = 'marca-logo' }) {
  // Estrella con contornos en eco, como una mola: el mismo lenguaje de la portada. Ver docs/identidad/README.md
  return (
    <svg className={className} viewBox="0 0 64 64" role="img" aria-label="SIGET">
      <rect width="64" height="64" rx="14.08" fill="#0f4c5c" />
      <path d="M15.36 5.76H48.64A9.6 9.6 0 0 1 58.24 15.36V48.64A9.6 9.6 0 0 1 48.64 58.24H15.36A9.6 9.6 0 0 1 5.76 48.64V15.36A9.6 9.6 0 0 1 15.36 5.76Z" fill="none" stroke="#f6b81f" strokeWidth="1.6" opacity="0.9"/>
      <path d="M32 11.52 L36.89 26.56 L52.69 26.56 L39.91 35.85 L44.79 50.88 L32 41.59 L19.21 50.88 L24.09 35.85 L11.31 26.56 L27.11 26.56Z" fill="#f26b21" stroke="#f26b21" strokeWidth="1.92" strokeLinejoin="round"/>
      <path d="M32 17.18 L35.62 28.3 L47.31 28.3 L37.85 35.18 L41.46 46.31 L32 39.43 L22.54 46.31 L26.15 35.18 L16.69 28.3 L28.38 28.3Z" fill="none" stroke="#f4ead2" strokeWidth="2.24" strokeLinejoin="round"/>
      <path d="M32 23.27 L34.25 30.19 L41.52 30.19 L35.64 34.46 L37.88 41.38 L32 37.1 L26.12 41.38 L28.36 34.46 L22.48 30.19 L29.75 30.19Z" fill="none" stroke="#f6b81f" strokeWidth="2.24" strokeLinejoin="round"/>
      <circle cx="32" cy="34.24" r="2.56" fill="#f4ead2"/>
    </svg>
  )
}

/* ---------------------------------------------------------------- la pieza firma: recorrido por esclusas */

const CAMARAS = [
  { x: 20, etiqueta: 'Recepción' },
  { x: 230, etiqueta: 'Tramitación' },
  { x: 440, etiqueta: 'Resolución' },
]

function posicionDe(estado) {
  if (estado === 'Pendiente') return 0
  if (estado === 'En Tramitacion') return 1
  if (estado === 'En Subsanacion') return 'sub'
  return 2
}

function Onda({ x, y }) {
  return <path className="esc-onda" d={`M${x + 10} ${y} q8 -5 16 0 t16 0 t16 0 t16 0 t16 0 t16 0 t16 0 t16 0`} />
}

export function Esclusas({ estado, decorativo = false }) {
  const pos = posicionDe(estado)
  const indice = pos === 'sub' ? 1 : pos
  const resuelto = estado === 'Aprobado' || estado === 'Rechazado'
  const etiquetas = { Pendiente: 'Recepción', 'En Tramitacion': 'En tramitación', 'En Subsanacion': 'En subsanación', Aprobado: 'Aprobado', Rechazado: 'Rechazado' }
  return (
    <svg className="esclusas" viewBox="0 0 640 200" role={decorativo ? 'presentation' : 'img'} aria-hidden={decorativo ? 'true' : undefined}
      aria-label={decorativo ? undefined : `Recorrido del trámite: ${etiquetas[estado] || estado}`}>
      {CAMARAS.map((c, i) => {
        const clase = i < indice || (resuelto && i < 2) ? 'hecha' : i === indice ? 'actual' : 'futura'
        const nivel = clase === 'hecha' ? 44 : clase === 'actual' ? 66 : null
        return (
          <g key={c.etiqueta}>
            <text className="esc-etiqueta" x={c.x + 90} y="14" textAnchor="middle">{c.etiqueta}</text>
            <rect className={`esc-cuenca ${clase}`} x={c.x} y="24" width="180" height="100" rx="10" />
            {nivel && <rect className={`esc-agua ${clase === 'actual' ? 'actual' : ''}`} x={c.x + 2} y={nivel} width="176" height={122 - nivel} rx="8" />}
            {clase === 'actual' && !decorativo && <Onda x={c.x + 4} y={nivel + 1} />}
            {clase === 'actual' && decorativo && <Onda x={c.x + 4} y={nivel + 1} />}
          </g>
        )
      })}
      <path className={`esc-compuerta ${indice >= 1 ? 'abierta' : ''}`} d="M215 38V112" />
      <path className={`esc-compuerta ${indice >= 2 ? 'abierta' : ''}`} d="M425 38V112" />
      <path className="esc-compuerta" d="M300 128H340" />
      <rect className={`esc-cuenca ${pos === 'sub' ? 'actual' : 'futura'}`} x="260" y="138" width="120" height="54" rx="10" />
      {pos === 'sub' && <rect className="esc-agua actual" x="262" y="160" width="116" height="30" rx="8" />}
      <text className="esc-sub" x="320" y="154" textAnchor="middle">Subsanación</text>

      {resuelto ? (
        <g transform="translate(530 76) rotate(-6)">
          <rect x="-64" y="-19" width="128" height="38" rx="6" className="esc-sello-fondo" /><rect x="-62" y="-17" width="124" height="34" rx="6" fill="none" className={estado === 'Aprobado' ? 'esc-sello-verde-trazo' : 'esc-sello-rojo-trazo'} strokeWidth="3" />
          <text className={estado === 'Aprobado' ? 'esc-sello-verde' : 'esc-sello-rojo'} textAnchor="middle" y="6" fontFamily="IBM Plex Mono, monospace" fontSize="16" letterSpacing="2">
            {estado === 'Aprobado' ? 'APROBADO' : 'RECHAZADO'}
          </text>
        </g>
      ) : (
        <g className={`esc-boya-g pos-${pos}`}>
          <circle className="esc-boya-aro" r="9" />
          <circle className="esc-boya" r="9" />
        </g>
      )}
    </svg>
  )
}

/* ---------------------------------------------------------------- piezas pequeñas */

export function Insignia({ clase = '', children, punto = true }) {
  return <span className={`insignia ${clase} ${punto ? '' : 'sin-punto'}`}>{children}</span>
}

export function Avatar({ nombre = '?' }) {
  const iniciales = nombre.split(/[._\s-]+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('') || '?'
  let h = 0
  for (const c of nombre) h = (h * 31 + c.charCodeAt(0)) % 6
  return <span className={`avatar av-${h}`} aria-hidden="true">{iniciales}</span>
}

export function Alerta({ tipo = 'error', children }) {
  if (!children) return null
  const icono = tipo === 'ok' ? 'check' : tipo === 'info' ? 'info' : 'alerta'
  return (
    <div className={`alerta alerta-${tipo}`} role={tipo === 'error' ? 'alert' : 'status'}>
      <Icono nombre={icono} />
      <div>{children}</div>
    </div>
  )
}

const ILUSTRACION_VACIA = (
  <svg viewBox="0 0 120 80" role="presentation" aria-hidden="true">
    <rect x="6" y="14" width="34" height="46" rx="6" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.4" strokeDasharray="4 3" />
    <rect x="43" y="14" width="34" height="46" rx="6" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.4" strokeDasharray="4 3" />
    <rect x="80" y="14" width="34" height="46" rx="6" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.4" strokeDasharray="4 3" />
    <path d="M10 66q8-5 16 0t16 0t16 0t16 0t16 0t16 0" fill="none" stroke="#2b8a9a" strokeWidth="2.5" strokeLinecap="round" />
    <circle cx="23" cy="38" r="5" fill="#f26b21" />
  </svg>
)

export function Vacio({ titulo, texto, accion }) {
  return (
    <div className="vacio">
      {ILUSTRACION_VACIA}
      <h3>{titulo}</h3>
      {texto && <p>{texto}</p>}
      {accion}
    </div>
  )
}

export function Esqueleto({ filas = 4 }) {
  return (
    <div className="tabla-caja" role="status" aria-label="Cargando">
      <table className="tabla">
        <tbody>
          {Array.from({ length: filas }, (_, i) => (
            <tr key={i} className="esq-fila"><td><div className="esqueleto esq-linea corta" /><div className="esqueleto esq-linea media" /></td><td><div className="esqueleto esq-linea" /></td><td><div className="esqueleto esq-linea corta" /></td></tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function BloquesEsqueleto({ n = 3 }) {
  return <div className="indicadores" role="status" aria-label="Cargando">{Array.from({ length: n }, (_, i) => <div key={i} className="esqueleto esq-bloque" />)}</div>
}

/* ---------------------------------------------------------------- avisos y confirmaciones */

const ContextoUI = createContext(null)

export function useUI() {
  return useContext(ContextoUI)
}

export function ProveedorUI({ children }) {
  const [avisos, setAvisos] = useState([])
  const [pregunta, setPregunta] = useState(null)
  const [tema, setTemaEstado] = useState(() => {
    try {
      const guardado = localStorage.getItem('siget-tema')
      if (guardado === 'claro' || guardado === 'oscuro') return guardado
    } catch { /* sin almacenamiento: se usa la preferencia del sistema */ }
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'oscuro' : 'claro'
  })

  useEffect(() => { document.documentElement.dataset.tema = tema }, [tema])
  const alternarTema = useCallback(() => {
    setTemaEstado((t) => {
      const nuevo = t === 'oscuro' ? 'claro' : 'oscuro'
      try { localStorage.setItem('siget-tema', nuevo) } catch { /* no es crítico */ }
      return nuevo
    })
  }, [])

  const avisar = useCallback((texto, tipo = 'ok') => {
    const id = Math.random().toString(36).slice(2)
    setAvisos((a) => [...a, { id, texto, tipo }])
    setTimeout(() => setAvisos((a) => a.filter((x) => x.id !== id)), 5500)
  }, [])

  const confirmar = useCallback((opciones) => new Promise((resolver) => setPregunta({ ...opciones, resolver })), [])
  const cerrar = (valor) => { pregunta.resolver(valor); setPregunta(null) }

  const valor = useMemo(() => ({ avisar, confirmar, tema, alternarTema }), [avisar, confirmar, tema, alternarTema])
  return (
    <ContextoUI.Provider value={valor}>
      {children}
      <div className="avisos" aria-live="polite">
        {avisos.map((a) => (
          <div key={a.id} className={`aviso aviso-${a.tipo}`} role="status">
            <Icono nombre={a.tipo === 'ok' ? 'check' : 'alerta'} />
            <span>{a.texto}</span>
            <button aria-label="Cerrar aviso" onClick={() => setAvisos((x) => x.filter((v) => v.id !== a.id))}><Icono nombre="x" /></button>
          </div>
        ))}
      </div>
      {pregunta && <Dialogo pregunta={pregunta} cerrar={cerrar} />}
    </ContextoUI.Provider>
  )
}

export function Dialogo({ pregunta, cerrar }) {
  const boton = useRef(null)
  useEffect(() => {
    boton.current?.focus()
    const tecla = (e) => e.key === 'Escape' && cerrar(false)
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="fondo-modal" onMouseDown={(e) => e.target === e.currentTarget && cerrar(false)}>
      <div className="modal" role="alertdialog" aria-modal="true" aria-labelledby="dlg-titulo" aria-describedby="dlg-texto">
        <h2 id="dlg-titulo"><span className={`icono-grande ${pregunta.peligro ? 'peligro' : ''}`}><Icono nombre={pregunta.peligro ? 'alerta' : 'info'} /></span>{pregunta.titulo}</h2>
        <p id="dlg-texto" className="suave">{pregunta.texto}</p>
        <div className="fila-botones">
          <button className="btn btn-sec" onClick={() => cerrar(false)}>Cancelar</button>
          <button ref={boton} className={`btn ${pregunta.peligro ? 'btn-peligro' : ''}`} onClick={() => cerrar(true)}>{pregunta.etiqueta || 'Confirmar'}</button>
        </div>
      </div>
    </div>
  )
}
