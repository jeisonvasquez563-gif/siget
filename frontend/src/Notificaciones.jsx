// Campana de notificaciones de la barra superior (PT-9): cuántas hay sin leer, el panel con las últimas y marcarlas como leídas.
// Las genera el servidor (la base de datos, al cambiar un trámite) y NO llevan texto: aquí se arma según el `tipo`. El motivo y los datos
// se ven en el detalle del trámite, que ya tiene sus propios controles. Se actualiza al navegar y cada 60 s mientras la pestaña se ve.
import { useCallback, useEffect, useRef, useState } from 'react'
import { api, hayToken } from './api.js'
import { fecha, hace } from './comun.jsx'
import { Icono } from './ui.jsx'

export const ULTIMAS = 10
export const CADA_MS = 60000

// En lenguaje llano. Un tipo que esta interfaz no conozca (un servidor más nuevo) cae en un texto general: nunca se muestra nada crudo.
export const TEXTOS = {
  tramite_en_atencion: (id) => `Ya están atendiendo tu trámite #${id}`,
  subsanacion_pedida: (id) => `Te pidieron corregir algo en el trámite #${id}`,
  tramite_aprobado: (id) => `Aprobaron tu trámite #${id}`,
  tramite_rechazado: (id) => `Rechazaron tu trámite #${id}`,
  subsanacion_respondida: (id) => `La persona respondió la corrección del trámite #${id}`,
  tramite_escalado: (id) => `El trámite #${id} pasó su plazo y quedó en supervisión`,
  tramite_desistido: (id) => `La persona desistió del trámite #${id}`,
}
export const textoDe = (n) => (TEXTOS[n.tipo] || ((id) => `Hay novedades en el trámite #${id}`))(n.tramite_id)

const etiquetaDe = (estado) => (estado.cargado ? `Notificaciones, ${estado.no_leidas} sin leer` : 'Notificaciones')

export function Campana({ clave, abrir }) {
  const [estado, setEstado] = useState({ cargado: false, error: false, no_leidas: 0, total: 0, items: [] })
  const [abierto, setAbierto] = useState(false)
  const [anuncio, setAnuncio] = useState('')
  const caja = useRef(null)
  const boton = useRef(null)
  const panel = useRef(null)
  const ultima = useRef(0) // solo vale la respuesta de la última petición: una lenta no pisa a una más nueva
  const escrituras = useRef(0) // marca que sube al empezar y al terminar cada escritura (marcar leída / todas): una consulta que salió antes no vale
  const previas = useRef(null) // sin leer en la carga anterior, para anunciar solo lo que llega después

  // Una escritura (marcar leída / todas) cuenta desde que sale hasta que termina: las consultas que salieron antes, o que se cruzaron con
  // ella, pueden traer el estado de antes y no deben volver a mostrar como no leído lo que ya se leyó
  const escribir = (peticion) => {
    escrituras.current += 1
    return peticion.finally(() => { escrituras.current += 1 })
  }

  // `deFondo`: la consulta periódica. No pregunta con la pestaña oculta ni sin sesión, y si el acceso venció no lo renueva (eso alargaría una
  // sesión inactiva): ese turno se salta EN SILENCIO (ni error ni anuncio) y se retoma en la próxima navegación o al abrir el panel, que sí
  // son de la persona.
  const refrescar = useCallback(async ({ deFondo = false } = {}) => {
    if (!hayToken() || (deFondo && document.visibilityState !== 'visible')) return
    const mia = ++ultima.current
    const marca = escrituras.current
    const vigente = () => mia === ultima.current && marca === escrituras.current
    try {
      const d = await api(`/notificaciones/?limite=${ULTIMAS}`, deFondo ? { renovar: false } : {})
      if (!vigente()) return
      setEstado({ cargado: true, error: false, no_leidas: d.no_leidas, total: d.total, items: d.resultados })
      if (previas.current !== null && d.no_leidas > previas.current) {
        const nuevas = d.no_leidas - previas.current
        setAnuncio(nuevas === 1 ? 'Tienes una notificación nueva.' : `Tienes ${nuevas} notificaciones nuevas.`)
      }
      previas.current = d.no_leidas
    } catch (fallo) {
      if (deFondo && fallo?.estado === 401) return // acceso vencido: no es un error de las notificaciones; se salta el turno sin avisar
      if (vigente()) setEstado((e) => ({ ...e, error: true })) // se conserva lo último que se vio y se reintenta en el siguiente turno
    }
  }, [])

  // Al navegar a otra pantalla
  useEffect(() => { refrescar() }, [clave, refrescar])

  // Cada 60 s y al volver a la pestaña, solo si se ve
  useEffect(() => {
    const cada = setInterval(() => refrescar({ deFondo: true }), CADA_MS)
    const alVolver = () => { if (document.visibilityState === 'visible') refrescar({ deFondo: true }) }
    document.addEventListener('visibilitychange', alVolver)
    return () => { clearInterval(cada); document.removeEventListener('visibilitychange', alVolver) }
  }, [refrescar])

  // Al abrir el panel se actualiza y el foco pasa a él
  useEffect(() => {
    if (!abierto) return
    refrescar()
    panel.current?.focus()
  }, [abierto, refrescar])

  // Un clic fuera lo cierra (sin quitarle el foco a lo que se hizo clic)
  useEffect(() => {
    if (!abierto) return undefined
    const fuera = (e) => { if (caja.current && !caja.current.contains(e.target)) setAbierto(false) }
    document.addEventListener('mousedown', fuera)
    return () => document.removeEventListener('mousedown', fuera)
  }, [abierto])

  const cerrar = (devolverFoco = true) => {
    setAbierto(false)
    if (devolverFoco) boton.current?.focus()
  }

  const alPulsarTecla = (e) => {
    if (e.key === 'Escape' && abierto) { e.stopPropagation(); cerrar() }
  }
  // Si el foco sale del panel con el teclado (Tab), se cierra sin tirar el foco hacia atrás
  const alPerderFoco = (e) => {
    if (abierto && e.relatedTarget && caja.current && !caja.current.contains(e.relatedTarget)) setAbierto(false)
  }

  async function abrirNotificacion(n) {
    setAbierto(false)
    if (!n.leida) {
      setEstado((e) => ({ ...e, no_leidas: Math.max(0, e.no_leidas - 1), items: e.items.map((x) => (x.id === n.id ? { ...x, leida: true } : x)) }))
      escribir(api(`/notificaciones/${n.id}/leida/`, { metodo: 'POST', cuerpo: {} }))
        .then((d) => { previas.current = d.no_leidas; setEstado((e) => ({ ...e, no_leidas: d.no_leidas })) })
        .catch(() => refrescar()) // si no se pudo marcar, se vuelve a pedir lo que dice el servidor
    }
    if (n.tramite) abrir(n.tramite_id)
  }

  async function leerTodas() {
    try {
      await escribir(api('/notificaciones/leer-todas/', { metodo: 'POST', cuerpo: {} }))
      previas.current = 0
      setEstado((e) => ({ ...e, no_leidas: 0, items: e.items.map((x) => ({ ...x, leida: true })) }))
      setAnuncio('Marcaste todas las notificaciones como leídas.')
    } catch {
      setEstado((e) => ({ ...e, error: true }))
    }
  }

  const insignia = estado.no_leidas > 99 ? '99+' : String(estado.no_leidas)
  return (
    <div className="campana" ref={caja} onKeyDown={alPulsarTecla} onBlur={alPerderFoco}>
      <button
        ref={boton} type="button" className="btn btn-fantasma btn-icono campana-boton" aria-label={etiquetaDe(estado)}
        aria-expanded={abierto} aria-haspopup="dialog" aria-controls={abierto ? 'panel-notificaciones' : undefined}
        onClick={() => (abierto ? cerrar() : setAbierto(true))}
      >
        <Icono nombre="campana" />
        {estado.cargado && estado.no_leidas > 0 && <span className="campana-insignia" aria-hidden="true">{insignia}</span>}
      </button>
      <span className="solo-lector" role="status">{anuncio}</span>
      {abierto && (
        <div className="notif-panel" id="panel-notificaciones" role="dialog" aria-label="Notificaciones" tabIndex={-1} ref={panel}>
          <div className="notif-cabecera">
            <p className="notif-titulo">Notificaciones</p>
            <button type="button" className="btn btn-fantasma notif-todas" disabled={!estado.cargado || estado.no_leidas === 0} onClick={leerTodas}>
              Marcar todas como leídas
            </button>
          </div>
          {estado.error && <p className="notif-aviso" role="alert">{estado.cargado ? 'No pudimos actualizar tus notificaciones. Lo intentaremos de nuevo en un minuto.' : 'No pudimos cargar tus notificaciones. Lo intentaremos de nuevo en un minuto.'}</p>}
          {!estado.cargado && !estado.error && <p className="notif-aviso">Cargando tus notificaciones…</p>}
          {estado.cargado && estado.items.length === 0 && <p className="notif-aviso">No tienes notificaciones.</p>}
          {estado.items.length > 0 && (
            <ul className="notif-lista">
              {estado.items.map((n) => (
                <li key={n.id}>
                  <button type="button" className={`notif-item ${n.leida ? '' : 'sin-leer'}`} onClick={() => abrirNotificacion(n)}>
                    <span className="notif-punto" aria-hidden="true" />
                    <span className="notif-cuerpo">
                      {!n.leida && <span className="solo-lector">Sin leer. </span>}
                      <span className="notif-texto">{textoDe(n)}</span>
                      <span className="notif-detalle">
                        {n.tramite ? `${n.tramite.tipo_tramite} · ${n.tramite.institucion}` : 'Ya no tienes acceso a este trámite'}
                      </span>
                      <time className="notif-fecha" dateTime={n.creada_en} title={fecha(n.creada_en)}>{hace(n.creada_en)}</time>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {estado.total > estado.items.length && <p className="notif-pie">Mostrando las {estado.items.length} más recientes de {estado.total}.</p>}
        </div>
      )}
    </div>
  )
}
