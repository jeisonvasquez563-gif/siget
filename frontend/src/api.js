// Cliente de la API de SIGET.
// El token de acceso vive SOLO en memoria (nunca en localStorage); el de refresco viaja en una cookie HttpOnly
// que JavaScript no puede leer. La interfaz no decide qué está permitido: el servidor lo vuelve a decidir en cada petición.

let tokenDeAcceso = null
let refrescando = null // una sola renovación a la vez: el refresco es de un solo uso y un reuso revoca la sesión
let alPerderSesion = () => {}

export class ApiError extends Error {
  constructor(estado, datos) {
    super((datos && (datos.detalle || datos.codigo)) || `Error ${estado}`)
    this.estado = estado
    this.datos = datos || {}
  }
  get codigo() { return this.datos.codigo }
  get pideReautenticar() { return this.estado === 403 && this.datos.reautenticacion_sugerida === true }
}

export const alPerderLaSesion = (f) => { alPerderSesion = f }
export const hayToken = () => tokenDeAcceso !== null
// Al cerrar la sesión también se descarta cualquier renovación en curso: no debe sobrevivir a la persona que la pidió
export const olvidarToken = () => { tokenDeAcceso = null; refrescando = null }

async function pedir(ruta, { metodo = 'GET', cuerpo, conToken = true } = {}) {
  const cabeceras = { Accept: 'application/json' }
  if (cuerpo !== undefined) cabeceras['Content-Type'] = 'application/json'
  if (conToken && tokenDeAcceso) cabeceras.Authorization = `Bearer ${tokenDeAcceso}`
  const r = await fetch(ruta, {
    method: metodo, headers: cabeceras, credentials: 'same-origin',
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  })
  let datos = null
  try { datos = await r.json() } catch { /* cuerpo vacío o no JSON */ }
  return { estado: r.status, datos }
}

export function renovar() {
  if (!refrescando) {
    refrescando = (async () => {
      try {
        const r = await fetch('/auth/refresh/', { method: 'POST', headers: { 'X-SIGET-CSRF': '1' }, credentials: 'same-origin' })
        if (!r.ok) { tokenDeAcceso = null; return null }
        const d = await r.json()
        tokenDeAcceso = d.access_token
        return d
      } catch { return null } finally { setTimeout(() => { refrescando = null }, 0) }
    })()
  }
  return refrescando
}

export async function api(ruta, opciones = {}) {
  let r = await pedir(ruta, opciones)
  if (r.estado === 401 && opciones.conToken !== false) {
    const nuevo = await renovar()
    if (nuevo) r = await pedir(ruta, opciones)
    else alPerderSesion()
  }
  if (r.estado < 200 || r.estado >= 300) throw new ApiError(r.estado, r.datos)
  return r.datos
}

export async function iniciarSesion(username, password, codigo, puerta = {}) {
  const cuerpo = { username, password }
  if (codigo) cuerpo.codigo = codigo
  // La puerta por la que se entra (ciudadanía, personal de una institución o plataforma). No da permisos: solo evita entrar por la equivocada
  if (puerta.canal) cuerpo.canal = puerta.canal
  if (puerta.institucion_id) cuerpo.institucion_id = puerta.institucion_id
  const d = await api('/auth/login/', { metodo: 'POST', cuerpo, conToken: false })
  tokenDeAcceso = d.access_token
  return d
}

export const instituciones = () => api('/auth/instituciones/', { conToken: false })

export const registrar = (username, password, personales = {}) =>
  api('/auth/registro/', { metodo: 'POST', cuerpo: { username, password, ...personales }, conToken: false })

export const restablecerContrasena = (username, codigo, password) =>
  api('/auth/restablecer/', { metodo: 'POST', cuerpo: { username, codigo, password }, conToken: false })

export async function confirmarMfa(codigo) {
  const d = await api('/auth/mfa/confirmar/', { metodo: 'POST', cuerpo: { codigo } })
  tokenDeAcceso = d.access_token
  return d
}

export async function cerrarSesion() {
  try { await api('/auth/logout/', { metodo: 'POST', cuerpo: {} }) } catch { /* ya estaba cerrada */ }
  tokenDeAcceso = null
}
