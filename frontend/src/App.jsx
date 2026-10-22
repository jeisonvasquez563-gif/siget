import { useCallback, useEffect, useState } from 'react'
import { alPerderLaSesion, api, cerrarSesion, olvidarToken, renovar } from './api.js'
import { EnrolarMfa, Login } from './Acceso.jsx'
import { Cargando, ROLES_INSTITUCION, ROLES_PLATAFORMA } from './comun.jsx'
import { Equipo, Inicio, Proximamente, PruebaAcceso, Seguridad } from './Otras.jsx'
import { Bandeja, Detalle, MisTramites, NuevoTramite } from './Tramites.jsx'

function etiquetaDeRol(yo) {
  if (yo.rol_plataforma !== 'ninguno') return ROLES_PLATAFORMA[yo.rol_plataforma]
  const roles = [...new Set(yo.membresias.map((m) => ROLES_INSTITUCION[m.rol]))]
  return roles.length ? roles.join(' · ') : 'Ciudadanía'
}

export default function App() {
  const [fase, setFase] = useState('cargando')
  const [yo, setYo] = useState(null)
  const [vista, setVista] = useState({ modulo: 'inicio' })
  const [menuAbierto, setMenuAbierto] = useState(false)

  const cargarYo = useCallback(async () => {
    const datos = await api('/auth/yo/')
    setYo(datos)
    setVista({ modulo: 'inicio' })
    setFase(datos.scope === 'enrolar_mfa' ? 'enrolar' : 'app')
  }, [])

  const salirDelTodo = useCallback(() => { olvidarToken(); setYo(null); setFase('login') }, [])

  useEffect(() => {
    alPerderLaSesion(salirDelTodo)
    renovar().then((d) => (d ? cargarYo() : setFase('login'))).catch(() => setFase('login'))
  }, [cargarYo, salirDelTodo])

  async function salir() {
    await cerrarSesion()
    salirDelTodo()
  }

  if (fase === 'cargando') return <main className="acceso"><Cargando texto="Verificando tu sesión…" /></main>
  if (fase === 'login') return <Login alEntrar={cargarYo} />
  if (fase === 'enrolar') return <EnrolarMfa usuario={yo.usuario} alTerminar={cargarYo} alSalir={salir} />

  const ir = (modulo, extra = {}) => { setVista({ modulo, ...extra }); setMenuAbierto(false) }
  const abrir = (id) => setVista({ modulo: 'detalle', id, desde: vista.modulo })
  const actual = yo.modulos.find((m) => m.id === vista.modulo)

  let contenido
  switch (vista.modulo) {
    case 'inicio': contenido = <Inicio yo={yo} ir={ir} />; break
    case 'mis_tramites': contenido = <MisTramites yo={yo} abrir={abrir} nuevo={() => ir('nuevo_tramite')} />; break
    case 'nuevo_tramite': contenido = <NuevoTramite abrir={abrir} />; break
    case 'bandeja': contenido = <Bandeja yo={yo} abrir={abrir} modo="bandeja" />; break
    case 'supervision': contenido = <Bandeja yo={yo} abrir={abrir} modo="supervision" />; break
    case 'equipo': contenido = <Equipo />; break
    case 'seguridad': contenido = <Seguridad yo={yo} />; break
    case 'prueba_acceso': contenido = <PruebaAcceso yo={yo} />; break
    case 'detalle': contenido = <Detalle id={vista.id} yo={yo} volver={() => ir(vista.desde || 'inicio')} />; break
    default: contenido = actual ? <Proximamente modulo={actual} /> : <Inicio yo={yo} ir={ir} />
  }

  return (
    <div className="aplicacion">
      <header className="barra">
        <button className="menu-movil secundario" onClick={() => setMenuAbierto(!menuAbierto)} aria-label="Abrir menú">☰</button>
        <div className="marca-chica"><span className="logo" aria-hidden="true">S</span><strong>SIGET</strong></div>
        <div className="usuario-barra">
          <span className="chip rol">{etiquetaDeRol(yo)}</span>
          <span className="nombre">{yo.usuario}</span>
          <button className="secundario" onClick={salir}>Salir</button>
        </div>
      </header>
      <div className="cuerpo">
        <nav className={`lateral ${menuAbierto ? 'abierto' : ''}`} aria-label="Módulos">
          <button className={vista.modulo === 'inicio' ? 'activa' : ''} onClick={() => ir('inicio')}>Inicio</button>
          {yo.modulos.map((m) => (
            <button key={m.id} className={vista.modulo === m.id || (vista.modulo === 'detalle' && vista.desde === m.id) ? 'activa' : ''} onClick={() => ir(m.id)}>
              {m.nombre}
              {m.estado === 'proximamente' && <small>pronto</small>}
            </button>
          ))}
        </nav>
        <main className="contenido">{contenido}</main>
      </div>
    </div>
  )
}
