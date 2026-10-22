import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { alPerderLaSesion, api, ApiError, hayToken, iniciarSesion, olvidarToken } from '../api.js'

const respuesta = (estado, cuerpo) => new Response(cuerpo === null ? null : JSON.stringify(cuerpo), { status: estado, headers: { 'Content-Type': 'application/json' } })

let llamadas
function simular(manejador) {
  llamadas = []
  vi.stubGlobal('fetch', vi.fn(async (ruta, opciones = {}) => {
    llamadas.push({ ruta, opciones })
    return manejador(ruta, opciones)
  }))
}

beforeEach(() => olvidarToken())
afterEach(() => vi.unstubAllGlobals())

describe('manejo de la sesión', () => {
  it('el token de acceso vive solo en memoria: nunca en localStorage, sessionStorage ni cookies', async () => {
    simular(() => respuesta(200, { access_token: 'TOKEN-SECRETO-123', scope: 'completo' }))
    await iniciarSesion('ana', 'clave', '123456')
    expect(hayToken()).toBe(true)
    expect(JSON.stringify({ ...localStorage })).not.toContain('TOKEN-SECRETO')
    expect(JSON.stringify({ ...sessionStorage })).not.toContain('TOKEN-SECRETO')
    expect(document.cookie).not.toContain('TOKEN-SECRETO')
  })

  it('envía el token como Bearer y no lo manda al login', async () => {
    simular((ruta) => (ruta === '/auth/login/' ? respuesta(200, { access_token: 'abc', scope: 'completo' }) : respuesta(200, { ok: true })))
    await iniciarSesion('ana', 'clave')
    await api('/tramites/')
    const login = llamadas.find((l) => l.ruta === '/auth/login/')
    const lista = llamadas.find((l) => l.ruta === '/tramites/')
    expect(login.opciones.headers.Authorization).toBeUndefined()
    expect(lista.opciones.headers.Authorization).toBe('Bearer abc')
  })

  it('el código del segundo factor solo se envía si se escribió', async () => {
    simular(() => respuesta(200, { access_token: 'x', scope: 'completo' }))
    await iniciarSesion('ana', 'clave', '')
    await iniciarSesion('ana', 'clave', '123456')
    expect(JSON.parse(llamadas[0].opciones.body)).toEqual({ username: 'ana', password: 'clave' })
    expect(JSON.parse(llamadas[1].opciones.body).codigo).toBe('123456')
  })

  it('ante un 401 renueva la sesión una vez y repite la petición con el token nuevo', async () => {
    let vez = 0
    simular((ruta, opciones) => {
      if (ruta === '/auth/refresh/') return respuesta(200, { access_token: 'nuevo', scope: 'completo' })
      vez += 1
      return opciones.headers.Authorization === 'Bearer nuevo' ? respuesta(200, { ok: vez }) : respuesta(401, { codigo: 'x' })
    })
    const datos = await api('/tramites/')
    expect(datos.ok).toBe(2)
    expect(llamadas.filter((l) => l.ruta === '/auth/refresh/')).toHaveLength(1)
  })

  it('el refresco lleva la cabecera anti-CSRF y la cookie viaja sola', async () => {
    simular((ruta, o) => (ruta === '/auth/refresh/' ? respuesta(200, { access_token: 'n', scope: 'completo' }) : o.headers.Authorization ? respuesta(200, {}) : respuesta(401, {})))
    await api('/tramites/')
    const refresco = llamadas.find((l) => l.ruta === '/auth/refresh/')
    expect(refresco.opciones.method).toBe('POST')
    expect(refresco.opciones.headers['X-SIGET-CSRF']).toBe('1')
    expect(refresco.opciones.credentials).toBe('same-origin')
  })

  it('varias peticiones que fallan a la vez provocan UN solo refresco (el refresco es de un solo uso)', async () => {
    simular((ruta, opciones) => {
      if (ruta === '/auth/refresh/') return respuesta(200, { access_token: 'nuevo', scope: 'completo' })
      return opciones.headers.Authorization === 'Bearer nuevo' ? respuesta(200, { ok: true }) : respuesta(401, {})
    })
    await Promise.all([api('/a/'), api('/b/'), api('/c/'), api('/d/')])
    expect(llamadas.filter((l) => l.ruta === '/auth/refresh/')).toHaveLength(1)
  })

  it('si el refresco falla, avisa que se perdió la sesión y propaga el 401', async () => {
    const perdida = vi.fn()
    alPerderLaSesion(perdida)
    simular((ruta) => (ruta === '/auth/refresh/' ? respuesta(401, { codigo: 'sesion_invalida' }) : respuesta(401, {})))
    await expect(api('/tramites/')).rejects.toMatchObject({ estado: 401 })
    expect(perdida).toHaveBeenCalledTimes(1)
    expect(hayToken()).toBe(false)
  })

  it('el login no intenta renovar la sesión cuando las credenciales son malas', async () => {
    simular(() => respuesta(401, { codigo: 'credenciales_invalidas' }))
    await expect(iniciarSesion('ana', 'mala')).rejects.toBeInstanceOf(ApiError)
    expect(llamadas.map((l) => l.ruta)).toEqual(['/auth/login/'])
  })
})

describe('errores de la API', () => {
  it('conserva el código y el cuerpo del servidor', async () => {
    simular(() => respuesta(400, { codigo: 'datos_invalidos', errores: ['muy corta'] }))
    const e = await api('/x/').catch((x) => x)
    expect(e).toBeInstanceOf(ApiError)
    expect(e.codigo).toBe('datos_invalidos')
    expect(e.datos.errores).toEqual(['muy corta'])
  })

  it('pideReautenticar exige un booleano verdadero de verdad (no el texto "true")', () => {
    expect(new ApiError(403, { reautenticacion_sugerida: true }).pideReautenticar).toBe(true)
    expect(new ApiError(403, { reautenticacion_sugerida: 'True' }).pideReautenticar).toBe(false)
    expect(new ApiError(403, { reautenticacion_sugerida: false }).pideReautenticar).toBe(false)
    expect(new ApiError(401, { reautenticacion_sugerida: true }).pideReautenticar).toBe(false)
  })

  it('tolera respuestas vacías o que no son JSON', async () => {
    simular(() => new Response('<html>502</html>', { status: 502 }))
    const e = await api('/x/').catch((x) => x)
    expect(e.estado).toBe(502)
    expect(e.datos).toEqual({})
  })
})
