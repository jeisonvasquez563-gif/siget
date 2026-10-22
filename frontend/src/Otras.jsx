import { useEffect, useState } from 'react'
import { api, ApiError } from './api.js'
import { Alerta, Cargando, ROLES_INSTITUCION, ROLES_PLATAFORMA, fecha, mensajeDe, useReautenticacion } from './comun.jsx'

export function Inicio({ yo, ir }) {
  return (
    <>
      <div className="encabezado-vista"><div><h2>Hola, {yo.usuario}</h2><p>Estos son los módulos que tu rol tiene asignados. Lo que no ves, no existe para ti.</p></div></div>
      <div className="tarjetas">
        {yo.modulos.map((m) => (
          <button key={m.id} className={`tarjeta-modulo ${m.estado}`} onClick={() => ir(m.id)}>
            <h3>{m.nombre}</h3>
            <p>{m.descripcion}</p>
            {m.estado === 'proximamente' && <span className="chip e-pendiente">Próximamente</span>}
          </button>
        ))}
      </div>
    </>
  )
}

export function Equipo() {
  const [equipos, setEquipos] = useState(null)
  const [error, setError] = useState('')
  const { ejecutar, modal } = useReautenticacion()

  async function cargar() {
    setError('')
    try {
      await ejecutar(async () => { setEquipos((await api('/equipo/')).equipos) })
    } catch (e) {
      setError(mensajeDe(e))
      setEquipos([])
    }
  }
  useEffect(() => { cargar() }, [])

  return (
    <>
      <div className="encabezado-vista"><div><h2>Equipo de la institución</h2><p>Quién tiene qué rol en las instituciones que coordinas o supervisas.</p></div></div>
      <Alerta>{error}</Alerta>
      {equipos === null ? <Cargando /> : equipos.map((e) => (
        <section className="panel" key={e.institucion.id}>
          <h3>{e.institucion.nombre}</h3>
          <ul className="lista-equipo">
            {e.personal.map((p) => <li key={`${p.usuario_id}-${p.rol}`}><span>{p.usuario}</span><span className="chip">{ROLES_INSTITUCION[p.rol] || p.rol}</span></li>)}
          </ul>
        </section>
      ))}
      {modal}
    </>
  )
}

const PERMISOS = {
  ciudadano: {
    puede: ['Iniciar trámites del catálogo', 'Ver el estado e historial de SUS trámites', 'Ver si su trámite está en cola o en atención'],
    no: ['Ver trámites de otras personas (responde 404, como si no existieran)', 'Cambiar el estado de un trámite', 'Saber qué funcionario lo atiende'],
  },
  funcionario: {
    puede: ['Ver los trámites de su institución', 'Pasar a la siguiente etapa los que están en cola o asignados a él (con segundo factor reciente)'],
    no: ['Ver trámites de otra institución', 'Gestionar un trámite que él mismo pidió (conflicto de interés)', 'Reasignar trámites'],
  },
  supervisor: {
    puede: ['Todo lo del funcionario, sobre cualquier trámite de su institución', 'Reasignar trámites y atender los escalados', 'Ver el equipo de su institución'],
    no: ['Tocar trámites de otra institución', 'Gestionar un trámite que él mismo pidió'],
  },
  coordinador_institucional: {
    puede: ['Ver y gestionar el equipo y los roles de su institución (con segundo factor reciente)'],
    no: ['Ver o mover trámites: gestionar personas no implica ver datos de los ciudadanos', 'Asignarse un rol a sí mismo (lo impone la base de datos)'],
  },
  plataforma: {
    puede: ['Operar solo su área (ver su consola)', 'Las altas sensibles exigen dos personas distintas (control dual)'],
    no: ['Ver ningún trámite ni dato de ciudadanos', 'Ser a la vez operador y miembro de una institución', 'Existir un superusuario: nadie tiene todos los poderes'],
  },
}

function perfil(yo) {
  if (yo.rol_plataforma !== 'ninguno') return ['plataforma']
  const roles = new Set(yo.membresias.map((m) => m.rol))
  const salida = ['ciudadano']
  ;['funcionario', 'supervisor', 'coordinador_institucional'].forEach((r) => roles.has(r) && salida.push(r))
  return salida
}

export function Seguridad({ yo }) {
  const verificado = yo.mfa_verificado_en ? Math.max(0, Math.round((Date.now() - new Date(yo.mfa_verificado_en)) / 60000)) : null
  return (
    <>
      <div className="encabezado-vista"><div><h2>Mi seguridad</h2><p>Quién eres para el sistema y qué te permite Zero Trust.</p></div></div>
      <div className="rejilla-detalle">
        <section className="panel">
          <h3>Mi identidad</h3>
          <dl>
            <dt>Usuario</dt><dd>{yo.usuario}</dd>
            <dt>Rol de plataforma</dt><dd>{ROLES_PLATAFORMA[yo.rol_plataforma] || yo.rol_plataforma}</dd>
            <dt>Instituciones</dt>
            <dd>{yo.membresias.length ? yo.membresias.map((m) => `${m.institucion}: ${ROLES_INSTITUCION[m.rol]}`).join(' · ') : 'Ninguna (ciudadanía o rol de plataforma)'}</dd>
            <dt>Segundo factor</dt><dd>{yo.mfa_activo ? 'Activo (TOTP)' : 'No activo'}</dd>
            <dt>Última verificación</dt><dd>{verificado === null ? '—' : `hace ${verificado} min (${fecha(yo.mfa_verificado_en)})`}</dd>
            <dt>Nivel de aseguramiento</dt><dd>{yo.nivel_aseguramiento}</dd>
          </dl>
          <p className="nota">Tu sesión dura 8 horas con token de acceso de 10 minutos; el de renovación es de un solo uso y se guarda en una cookie que JavaScript no puede leer.</p>
        </section>
        <section className="panel">
          <h3>Lo que tu rol puede y no puede</h3>
          {perfil(yo).map((p) => (
            <div key={p} className="permisos">
              <h4>{p === 'plataforma' ? ROLES_PLATAFORMA[yo.rol_plataforma] : ROLES_INSTITUCION[p]}</h4>
              <ul className="puede">{PERMISOS[p].puede.map((t) => <li key={t}>{t}</li>)}</ul>
              <ul className="no-puede">{PERMISOS[p].no.map((t) => <li key={t}>{t}</li>)}</ul>
            </div>
          ))}
        </section>
      </div>
    </>
  )
}

export function PruebaAcceso({ yo }) {
  const [resultado, setResultado] = useState(null)
  async function probar() {
    setResultado('probando')
    try {
      await api('/tramites/?limite=1')
      setResultado({ permitido: true })
    } catch (e) {
      setResultado({ permitido: false, estado: e instanceof ApiError ? e.estado : 0, mensaje: mensajeDe(e) })
    }
  }
  return (
    <>
      <div className="encabezado-vista"><div><h2>Acceso a trámites</h2><p>Un rol de plataforma opera la infraestructura, no los trámites de las personas.</p></div></div>
      <section className="panel">
        <p>Pulsa el botón: la plataforma intentará listar trámites como <strong>{ROLES_PLATAFORMA[yo.rol_plataforma]}</strong>. El punto de decisión de acceso (PDP) consulta la política, niega y deja la decisión registrada, sin importar qué muestre la interfaz.</p>
        <button onClick={probar} disabled={resultado === 'probando'}>Intentar ver los trámites</button>
        {resultado && resultado !== 'probando' && (resultado.permitido
          ? <Alerta tipo="ok">Acceso permitido.</Alerta>
          : <Alerta>HTTP {resultado.estado} · {resultado.mensaje}</Alerta>)}
      </section>
    </>
  )
}

export function Proximamente({ modulo }) {
  return (
    <>
      <div className="encabezado-vista"><div><h2>{modulo.nombre}</h2><p>{modulo.descripcion}</p></div></div>
      <section className="panel">
        <p><span className="chip e-pendiente">Próximamente</span></p>
        <p>Este módulo forma parte del diseño de roles y permisos (cada operador de plataforma tiene su propia área, sin un superusuario) y se construye en la siguiente fase. La separación de poderes ya está aplicada en la base de datos.</p>
      </section>
    </>
  )
}
