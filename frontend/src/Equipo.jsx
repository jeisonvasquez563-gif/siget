import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from './api.js'
import { ROLES_INSTITUCION, mensajeDe, useReautenticacion } from './comun.jsx'
import { Alerta, Avatar, BloquesEsqueleto, Insignia, Vacio, useUI } from './ui.jsx'

// Equipo de una institución. La coordinación asigna, cambia de rol y quita personal; la supervisión solo lo ve. El servidor decide
// (PDP) y la base lo impone: aquí solo se muestran los botones a quien puede y se explica lo que responde el servidor.

function mensaje(e) {
  if (e instanceof ApiError) {
    const d = e.datos || {}
    if (Array.isArray(d.errores) && d.errores.length) return `${d.errores.join('. ')}.`
    if (d.codigo === 'tiene_tramites_abiertos') return `Esa persona aún tiene ${d.tramites_abiertos} trámite(s) abierto(s) asignado(s). Pídele a supervisión que los reasigne y vuelve a intentarlo.`
    if ((e.estado === 400 || e.estado === 409) && d.detalle) return d.detalle
  }
  return mensajeDe(e)
}

const OTRO_ROL = { funcionario: 'supervisor', supervisor: 'funcionario' }

function FormularioAgregar({ institucion, alAgregar }) {
  const [usuario, setUsuario] = useState('')
  const [rol, setRol] = useState('funcionario')
  return (
    <form className="formulario-fila" onSubmit={(e) => { e.preventDefault(); alAgregar(usuario, rol, () => setUsuario('')) }} aria-label={`Agregar personal a ${institucion.nombre}`}>
      <label className="campo"><span>Usuario de la persona</span>
        <input className="entrada" value={usuario} onChange={(e) => setUsuario(e.target.value)} required autoCapitalize="none" spellCheck="false" maxLength={32} />
      </label>
      <label className="campo"><span>Rol</span>
        <select className="entrada" value={rol} onChange={(e) => setRol(e.target.value)}>
          <option value="funcionario">Funcionario</option>
          <option value="supervisor">Supervisor</option>
        </select>
      </label>
      <button className="btn" type="submit">Agregar al equipo</button>
    </form>
  )
}

function Institucion({ equipo, correr }) {
  const { confirmar } = useUI()
  const base = `/equipo/${equipo.institucion.id}/miembros/`

  const agregar = (usuario, rol, limpiar) => correr(async () => {
    await api(base, { metodo: 'POST', cuerpo: { usuario, rol } })
    limpiar()
  }, `${usuario.trim()} se agregó como ${ROLES_INSTITUCION[rol].toLowerCase()}.`)

  const cambiar = (p) => correr(() => api(`${base}${p.usuario_id}/cambiar-rol/`, { metodo: 'POST', cuerpo: { rol: OTRO_ROL[p.rol] } }),
    `${p.usuario} ahora es ${ROLES_INSTITUCION[OTRO_ROL[p.rol]].toLowerCase()}.`)

  async function quitar(p) {
    const si = await confirmar({
      titulo: `Quitar a ${p.usuario} del equipo`, peligro: true, etiqueta: 'Quitar acceso',
      texto: `Dejará de ver la bandeja de ${equipo.institucion.nombre} de inmediato. Su historial se conserva y podrás volver a agregarla.`,
    })
    if (si) await correr(() => api(`${base}${p.usuario_id}/quitar/`, { metodo: 'POST', cuerpo: {} }), `${p.usuario} ya no es parte del equipo.`)
  }

  return (
    <section className="panel">
      <div className="panel-cabecera"><h3>{equipo.institucion.nombre}</h3><span className="suave">{equipo.personal.length} {equipo.personal.length === 1 ? 'persona' : 'personas'}</span></div>
      {equipo.puede_gestionar
        ? <FormularioAgregar institucion={equipo.institucion} alAgregar={agregar} />
        : <p className="nota">Solo la coordinación de la institución puede agregar, cambiar de rol o quitar personal.</p>}
      {equipo.personal.length === 0 ? <Vacio titulo="Sin personal" texto="Cuando la coordinación agregue a alguien aparecerá aquí." /> : (
        <div className="rejilla-personas">
          {equipo.personal.map((p) => (
            <div className="persona persona-gestion" key={`${p.usuario_id}-${p.rol}`}>
              <Avatar nombre={p.usuario} />
              <div className="datos-persona">
                <strong>{p.usuario}</strong>
                <Insignia clase="insignia-rol" punto={false}>{ROLES_INSTITUCION[p.rol] || p.rol}</Insignia>
                {p.gestionable && (
                  <div className="acciones-fila">
                    <button className="btn btn-sec" onClick={() => cambiar(p)} aria-label={`Hacer ${ROLES_INSTITUCION[OTRO_ROL[p.rol]].toLowerCase()} a ${p.usuario}`}>Hacer {ROLES_INSTITUCION[OTRO_ROL[p.rol]].toLowerCase()}</button>
                    <button className="btn btn-sec" onClick={() => quitar(p)} aria-label={`Quitar a ${p.usuario}`}>Quitar</button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

export function Equipo() {
  const [equipos, setEquipos] = useState(null)
  const [error, setError] = useState('')
  const { ejecutar, modal } = useReautenticacion()
  const { avisar } = useUI()

  const cargar = useCallback(async () => {
    try {
      await ejecutar(async () => { setEquipos((await api('/equipo/')).equipos) })
    } catch (e) {
      setError(mensajeDe(e))
      setEquipos((actual) => actual || [])
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { cargar() }, [cargar])

  // Toda acción: pide el segundo factor reciente si hace falta, muestra el motivo si el servidor la rechaza y recarga el equipo
  const correr = (accion, exito) => ejecutar(async () => {
    setError('')
    try {
      await accion()
      avisar(exito)
      setEquipos((await api('/equipo/')).equipos)
    } catch (e) {
      if (e instanceof ApiError && e.pideReautenticar) throw e
      setError(mensaje(e))
    }
  })

  return (
    <>
      <div className="encabezado-vista"><div><h2>Equipo de la institución</h2><p>Quién tiene qué rol en las instituciones que coordinas o supervisas. La coordinación asigna y quita al personal; las coordinaciones las da de alta la plataforma con control dual.</p></div></div>
      <Alerta>{error}</Alerta>
      {equipos === null ? <BloquesEsqueleto n={3} /> : equipos.map((e) => <Institucion key={e.institucion.id} equipo={e} correr={correr} />)}
      {modal}
    </>
  )
}
