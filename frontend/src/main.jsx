import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import './estilos.css'

// Sin StrictMode a propósito: duplica los efectos y el refresco de sesión es de un solo uso.
createRoot(document.getElementById('raiz')).render(<App />)
