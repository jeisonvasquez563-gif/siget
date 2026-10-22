import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// En desarrollo, la API se pide al mismo origen de nginx (https://<vm1>:8443) mediante un proxy;
// en producción nginx sirve esta carpeta y la API bajo el mismo origen (sin CORS).
const API = process.env.SIGET_API || 'https://192.168.159.137:8443'
const rutas = ['/auth', '/tramites', '/catalogo', '/equipo', '/salud']

export default defineConfig({
  plugins: [react()],
  build: { sourcemap: false, target: 'es2020' },
  server: { proxy: Object.fromEntries(rutas.map((r) => [r, { target: API, secure: false, changeOrigin: true }])) },
})
