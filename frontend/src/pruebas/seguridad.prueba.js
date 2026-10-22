// La interfaz se sirve con la CSP de nginx `default-src 'self'`: nada de estilos ni scripts en línea, ni de código dinámico,
// ni de almacenar credenciales en el navegador. Estas pruebas leen el código fuente y fallan si alguien lo intenta.
import { describe, expect, it } from 'vitest'

const quitarComentarios = (texto) => texto.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
const esPrueba = (ruta) => ruta.includes('.prueba.') || ruta.endsWith('/preparar.js')
const fuentes = Object.fromEntries(
  Object.entries(import.meta.glob('../**/*.{js,jsx}', { query: '?raw', import: 'default', eager: true })).map(([ruta, texto]) => [ruta, quitarComentarios(texto)]),
)
const produccion = Object.entries(fuentes).filter(([ruta]) => !esPrueba(ruta))
// El simulador solo existe en desarrollo (main.jsx lo importa bajo `import.meta.env.DEV`)
const sinSimulador = produccion.filter(([ruta]) => !ruta.endsWith('/mock.js'))

const incumplen = (lista, patron) => lista.filter(([, texto]) => patron.test(texto)).map(([ruta]) => ruta)

describe('CSP: sin código ni estilos en línea', () => {
  it('ningún componente usa la propiedad style', () => {
    expect(incumplen(produccion, /\bstyle\s*=\s*\{/)).toEqual([])
  })

  it('no hay dangerouslySetInnerHTML, eval ni new Function', () => {
    expect(incumplen(produccion, /dangerouslySetInnerHTML/)).toEqual([])
    expect(incumplen(produccion, /\beval\s*\(/)).toEqual([])
    expect(incumplen(produccion, /new\s+Function\s*\(/)).toEqual([])
  })

  it('el HTML no lleva scripts ni estilos en línea', async () => {
    const html = (await import('../../index.html?raw')).default
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/i)
    expect(html).not.toMatch(/<style[\s>]/i)
    expect(html).not.toMatch(/\sstyle\s*=/i)
    expect(html).not.toMatch(/\son[a-z]+\s*=/i)
  })

  it('no se cargan recursos de otros orígenes (fuentes, scripts ni imágenes remotas)', () => {
    expect(incumplen(produccion, /https?:\/\/(?!localhost|www\.w3\.org)[^\s'"`]+\.(js|css|woff2?|png|jpg|svg)/i)).toEqual([])
    expect(incumplen(produccion, /fonts\.googleapis|cdn\./i)).toEqual([])
  })
})

describe('credenciales y datos sensibles', () => {
  it('el token de acceso nunca se guarda en el navegador', () => {
    const quienUsaAlmacenamiento = sinSimulador.filter(([, texto]) => /(localStorage|sessionStorage|indexedDB|document\.cookie)/.test(texto)).map(([ruta]) => ruta)
    // Solo el tema (claro/oscuro) puede usar almacenamiento, y dentro de try/catch
    expect(quienUsaAlmacenamiento).toEqual(['../ui.jsx'])
    const ui = fuentes['../ui.jsx']
    expect(ui).toMatch(/localStorage\.(get|set)Item\('siget-tema'/)
    expect(ui.match(/localStorage/g).length).toBe(ui.match(/localStorage\.(get|set)Item\('siget-tema'/g).length)
  })

  it('no hay claves, contraseñas ni tokens escritos en el código', () => {
    expect(incumplen(produccion, /(password|passwd|secret|api[_-]?key|token)\s*[:=]\s*['"][A-Za-z0-9+/_-]{12,}['"]/i)).toEqual([])
    expect(incumplen(produccion, /-----BEGIN [A-Z ]*PRIVATE KEY-----/)).toEqual([])
  })

  it('las peticiones usan siempre el mismo origen (rutas relativas)', () => {
    const api = fuentes['../api.js']
    expect(api).not.toMatch(/fetch\(\s*['"`]https?:/)
    expect(api).toMatch(/credentials:\s*'same-origin'/)
  })
})

describe('el simulador de desarrollo', () => {
  it('solo se carga bajo import.meta.env.DEV', () => {
    const principal = fuentes['../main.jsx']
    const usos = principal.match(/mock\.js/g) || []
    expect(usos.length).toBe(1)
    expect(principal).toMatch(/if \(import\.meta\.env\.DEV\)[\s\S]*import\('\.\/mock\.js'\)/)
    // y ningún otro archivo de producción lo importa
    expect(incumplen(sinSimulador, /from\s+['"]\.\/mock\.js['"]/)).toEqual([])
  })
})
