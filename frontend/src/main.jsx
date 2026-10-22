import { createRoot } from 'react-dom/client'
import '@fontsource-variable/archivo/standard.css'
import '@fontsource-variable/public-sans/wght.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import './estilos/tokens.css'
import './estilos/base.css'
import './estilos/componentes.css'
import './estilos/layout.css'
import './estilos/pantallas.css'
import './estilos/permisos.css'
import './estilos/simulador.css'
import './estilos/plataforma.css'
import './estilos/seguimiento.css'
import App from './App.jsx'
import { ProveedorUI } from './ui.jsx'

async function arrancar() {
  // Solo en desarrollo: datos de ejemplo para ver cada pantalla por rol (ver src/mock.js). No entra en producción.
  if (import.meta.env.DEV) {
    const parametros = new URLSearchParams(window.location.search)
    if (parametros.has('mock')) {
      const { instalarMock } = await import('./mock.js')
      instalarMock(parametros.get('mock'))
    }
  }
  // Sin StrictMode a propósito: duplica los efectos y el refresco de sesión es de un solo uso.
  createRoot(document.getElementById('raiz')).render(<ProveedorUI><App /></ProveedorUI>)
}

arrancar()
