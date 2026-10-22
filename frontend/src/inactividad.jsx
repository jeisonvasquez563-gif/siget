import { useCallback, useEffect, useRef, useState } from 'react'
import { Icono } from './ui.jsx'

// Cierre de sesión por inactividad (Zero Trust: una sesión abandonada no debe seguir abierta).
// El servidor es quien manda: este reloj solo evita que una pantalla con datos sensibles quede a la vista. Aunque se
// manipulara aquí, el servidor igual rechaza renovar un acceso que nadie usó (ver `SIGET_REFRESH_MAX_EDAD_SEGUNDOS`).
const EVENTOS_DE_ACTIVIDAD = ['pointerdown', 'keydown', 'scroll', 'touchstart']

/**
 * Cuenta el tiempo sin actividad. Devuelve `restante` (segundos) solo durante el aviso final, y `seguir` para continuar.
 * `alExpirar` se llama una única vez al agotarse el tiempo. Durante el aviso el movimiento NO cancela la cuenta:
 * hay que decir explícitamente que se sigue ahí.
 */
export function useInactividad({ minutos, avisoSegundos = 60, activo, alExpirar }) {
  const [restante, setRestante] = useState(null)
  const ultima = useRef(Date.now())
  const enAviso = useRef(false)
  const expiro = useRef(false)
  const alExpirarRef = useRef(alExpirar)
  useEffect(() => { alExpirarRef.current = alExpirar })

  const seguir = useCallback(() => {
    ultima.current = Date.now()
    enAviso.current = false
    setRestante(null)
  }, [])

  useEffect(() => {
    if (!activo || !minutos) return undefined
    expiro.current = false
    seguir()
    const limite = minutos * 60
    const marcar = () => { if (!enAviso.current) ultima.current = Date.now() }
    let ultimoMovimiento = 0
    const mover = () => { const t = Date.now(); if (t - ultimoMovimiento > 1000) { ultimoMovimiento = t; marcar() } }
    EVENTOS_DE_ACTIVIDAD.forEach((e) => window.addEventListener(e, marcar, { passive: true }))
    window.addEventListener('pointermove', mover, { passive: true })

    const revisar = () => {
      const quieto = (Date.now() - ultima.current) / 1000
      if (quieto >= limite) {
        if (!expiro.current) { expiro.current = true; enAviso.current = false; setRestante(null); alExpirarRef.current() }
      } else if (quieto >= limite - avisoSegundos) {
        enAviso.current = true
        setRestante(Math.ceil(limite - quieto))
      }
    }
    const reloj = setInterval(revisar, 1000)
    // Al volver a la pestaña (o tras suspender el equipo) se revisa de inmediato: el tiempo no se detiene por estar dormida
    document.addEventListener('visibilitychange', revisar)
    return () => {
      clearInterval(reloj)
      document.removeEventListener('visibilitychange', revisar)
      EVENTOS_DE_ACTIVIDAD.forEach((e) => window.removeEventListener(e, marcar))
      window.removeEventListener('pointermove', mover)
    }
  }, [activo, minutos, avisoSegundos, seguir])

  return { restante, seguir }
}

export function AvisoInactividad({ restante, seguir, salir }) {
  const boton = useRef(null)
  useEffect(() => { boton.current?.focus() }, [])
  return (
    <div className="fondo-modal">
      <div className="modal" role="alertdialog" aria-modal="true" aria-labelledby="inac-titulo" aria-describedby="inac-texto">
        <h2 id="inac-titulo"><span className="icono-grande peligro"><Icono nombre="alerta" /></span>¿Sigues ahí?</h2>
        <p id="inac-texto" className="suave">
          Por tu seguridad, cerraremos tu sesión por inactividad en <strong>{restante} {restante === 1 ? 'segundo' : 'segundos'}</strong>.
          Lo que estés haciendo sin guardar se perderá.
        </p>
        <div className="fila-botones">
          <button className="btn btn-sec" onClick={salir}>Cerrar sesión</button>
          <button ref={boton} className="btn" onClick={seguir}>Seguir conectado</button>
        </div>
      </div>
    </div>
  )
}
