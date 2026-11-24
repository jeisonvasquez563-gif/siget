import { Component, useEffect, useRef } from 'react'
import { Icono, Logo } from './ui.jsx'

// Pantalla de error: si algo falla al dibujar la interfaz, la persona ve un mensaje en lenguaje llano en lugar de una página en blanco.
// NUNCA muestra la traza, el mensaje del error ni datos de la persona (podrían llevar nombres, cédulas o números de trámite): solo el
// error técnico va a la consola, y únicamente en desarrollo. Hay dos niveles: uno envuelve toda la aplicación (main.jsx) y otro cada
// pantalla (App.jsx), para que un fallo en una pantalla no tire el menú. Solo atrapa errores al DIBUJAR; los de peticiones y clics los
// maneja cada pantalla con sus propios avisos.

function PantallaDeError({ nivel, alReintentar, alInicio }) {
  const titulo = useRef(null)
  useEffect(() => { titulo.current?.focus() }, []) // el foco va al título: se anuncia de inmediato y el teclado queda a un Tab de los botones
  const completa = nivel === 'aplicacion'
  const cuerpo = (
    <div className="error-pantalla" role="alert">
      <span className="icono-grande" aria-hidden="true"><Icono nombre="alerta" /></span>
      <h2 ref={titulo} tabIndex={-1}>{completa ? 'Algo salió mal' : 'No pudimos mostrar esta pantalla'}</h2>
      <p>
        {completa
          ? 'Ocurrió un problema inesperado y la aplicación no pudo continuar. Lo que ya estaba guardado en el sistema no se vio afectado.'
          : 'Ocurrió un problema inesperado en esta pantalla. El resto de la aplicación sigue funcionando y lo que ya estaba guardado no se vio afectado.'}
      </p>
      <p className="suave">Puedes volver al inicio o intentarlo de nuevo. Si el problema se repite, avisa a quien administra la plataforma.</p>
      <div className="fila-botones">
        <button type="button" className="btn" onClick={alInicio}>Volver al inicio</button>
        <button type="button" className="btn btn-sec" onClick={alReintentar}>Reintentar</button>
      </div>
    </div>
  )
  if (!completa) return <section className="panel">{cuerpo}</section>
  return <main className="error-global"><section className="panel"><Logo className="marca-logo" />{cuerpo}</section></main>
}

export class LimiteDeError extends Component {
  state = { fallo: false }

  static getDerivedStateFromError() {
    return { fallo: true } // no se guarda el error: nada de lo que dijo se puede mostrar por descuido
  }

  componentDidCatch(error, info) {
    // Solo en desarrollo: en producción la consola del navegador de quien usa el sistema no recibe trazas ni datos
    if (import.meta.env.DEV) console.error(`[SIGET] Error de interfaz (${this.props.nivel || 'pantalla'}):`, error, info?.componentStack)
  }

  reintentar = () => this.setState({ fallo: false })

  volverAlInicio = () => {
    // En la aplicación completa «inicio» es la dirección sin ancla (App siempre arranca en el Inicio); en una pantalla lo hace App
    if (this.props.alVolverAlInicio) this.props.alVolverAlInicio()
    else window.location.hash = ''
    this.setState({ fallo: false })
  }

  render() {
    if (!this.state.fallo) return this.props.children
    return <PantallaDeError nivel={this.props.nivel || 'pantalla'} alReintentar={this.reintentar} alInicio={this.volverAlInicio} />
  }
}
