import { useCallback, useEffect, useState } from 'react'
import { alPerderLaSesion, api, cerrarSesion, olvidarToken, renovar } from './api.js'
import { EnrolarMfa, Login } from './Acceso.jsx'
import { Auditoria } from './Auditoria.jsx'
import { AvisoInactividad, useInactividad } from './inactividad.jsx'
import { SegundoFactor } from './Mfa.jsx'
import { RolesPermisos } from './Permisos.jsx'
import { etiquetaDeRol } from './comun.jsx'
import { agrupar, iconoDe } from './modulos.js'
import { Equipo, Inicio, Proximamente, PruebaAcceso, Seguridad } from './Otras.jsx'
import { ConsolaCatalogo, ConsolaIdentidades, ConsolaInfraestructura, ConsolaSecretos, ConsolaSeguridad } from './Plataforma.jsx'
import { Bandeja, Detalle, MisTramites, NuevoTramite } from './Tramites.jsx'
import { Avatar, Icono, Logo, useUI } from './ui.jsx'

export default function App() {
  const [fase, setFase] = useState('cargando')
  const [yo, setYo] = useState(null)
  const [vista, setVista] = useState({ modulo: 'inicio' })
  const [menuAbierto, setMenuAbierto] = useState(false)
  const { tema, alternarTema, avisar } = useUI()

  const [motivo, setMotivo] = useState('')

  const cargarYo = useCallback(async () => {
    const datos = await api('/auth/yo/')
    setYo(datos)
    // Siempre se aterriza en el Inicio: la vista vive solo en memoria, así que recargar la página (F5) saca a la persona de
    // un trámite abierto o de un formulario a medias. Es deliberado: nada sensible queda "recordado" por la dirección.
    setVista({ modulo: 'inicio' })
    setFase(datos.scope === 'enrolar_mfa' ? 'enrolar' : 'app')
  }, [])

  // Vuelve a pedir quién soy (p. ej. tras verificar el segundo factor) sin cambiar de pantalla
  const refrescarYo = useCallback(async () => { setYo(await api('/auth/yo/')) }, [])

  const salirDelTodo = useCallback((porque = '') => { olvidarToken(); setYo(null); setMotivo(porque); setFase('login') }, [])

  useEffect(() => {
    // El servidor rechazó renovar la sesión (venció, se revocó o estuvo inactiva demasiado tiempo)
    alPerderLaSesion(() => salirDelTodo('vencida'))
    renovar().then((d) => (d ? cargarYo() : setFase('login'))).catch(() => setFase('login'))
  }, [cargarYo, salirDelTodo])

  async function salir() {
    await cerrarSesion()
    salirDelTodo()
    avisar('Cerraste tu sesión.')
  }

  // Inactividad: aviso a los 60 s del final y cierre completo (se revoca en el servidor, no solo se oculta la pantalla)
  const { restante, seguir } = useInactividad({
    minutos: yo?.inactividad_minutos ?? 10,
    activo: fase === 'app' || fase === 'enrolar',
    alExpirar: async () => { await cerrarSesion(); salirDelTodo('inactividad') },
  })
  const seguirConectado = () => { seguir(); api('/auth/yo/').catch(() => {}) }

  if (fase === 'cargando') {
    return <main className="acceso"><section className="acceso-formulario" role="status" aria-label="Verificando tu sesión"><Logo className="marca-logo" /></section></main>
  }
  if (fase === 'login') return <Login alEntrar={cargarYo} motivo={motivo} />
  if (fase === 'enrolar') return <><EnrolarMfa usuario={yo.usuario} alTerminar={cargarYo} alSalir={salir} />{restante !== null && <AvisoInactividad restante={restante} seguir={seguirConectado} salir={salir} />}</>

  const ir = (modulo) => { setVista({ modulo }); setMenuAbierto(false); window.scrollTo({ top: 0 }) }
  const abrir = (id) => { setVista({ modulo: 'detalle', id, desde: vista.modulo }); window.scrollTo({ top: 0 }) }
  const actual = yo.modulos.find((m) => m.id === vista.modulo)
  const origen = vista.modulo === 'detalle' ? yo.modulos.find((m) => m.id === vista.desde) : null
  const titulo = vista.modulo === 'inicio' ? 'Inicio' : vista.modulo === 'detalle' ? `Trámite #${vista.id}` : actual?.nombre

  let contenido
  switch (vista.modulo) {
    case 'inicio': contenido = <Inicio yo={yo} ir={ir} abrir={abrir} />; break
    case 'mis_tramites': contenido = <MisTramites yo={yo} abrir={abrir} nuevo={() => ir('nuevo_tramite')} />; break
    case 'nuevo_tramite': contenido = <NuevoTramite abrir={abrir} />; break
    case 'bandeja': contenido = <Bandeja yo={yo} abrir={abrir} modo="bandeja" />; break
    case 'supervision': contenido = <Bandeja yo={yo} abrir={abrir} modo="supervision" />; break
    case 'equipo': contenido = <Equipo />; break
    case 'seguridad': contenido = <Seguridad yo={yo} />; break
    case 'auditoria': contenido = <Auditoria />; break
    case 'mfa': contenido = <SegundoFactor yo={yo} refrescar={refrescarYo} />; break
    case 'roles_permisos': contenido = <RolesPermisos yo={yo} />; break
    case 'prueba_acceso': contenido = <PruebaAcceso yo={yo} />; break
    case 'consola_identidades': contenido = <ConsolaIdentidades yo={yo} />; break
    case 'consola_catalogo': contenido = <ConsolaCatalogo yo={yo} />; break
    case 'consola_seguridad': contenido = <ConsolaSeguridad yo={yo} />; break
    case 'consola_secretos': contenido = <ConsolaSecretos />; break
    case 'consola_infraestructura': contenido = <ConsolaInfraestructura />; break
    case 'detalle': contenido = <Detalle id={vista.id} yo={yo} volver={() => ir(vista.desde || 'inicio')} volverA={origen?.nombre || 'Inicio'} />; break
    default: contenido = actual ? <Proximamente modulo={actual} /> : <Inicio yo={yo} ir={ir} abrir={abrir} />
  }

  return (
    <div className="aplicacion">
      <a className="saltar" href="#contenido">Saltar al contenido</a>
      {menuAbierto && <button className="telon" aria-label="Cerrar menú" onClick={() => setMenuAbierto(false)} />}
      <aside className={`lateral ${menuAbierto ? 'abierta' : ''}`} aria-label="Barra lateral">
        <div className="marca"><Logo /><div><strong>SIGET</strong><small>Gestión y trazabilidad</small></div></div>
        <nav aria-label="Módulos">
          <div className="nav-grupo">
            <button className="nav-item" aria-current={vista.modulo === 'inicio' ? 'page' : undefined} onClick={() => ir('inicio')}><Icono nombre="inicio" />Inicio</button>
          </div>
          {agrupar(yo.modulos).map((g) => (
            <div className="nav-grupo" key={g.titulo}>
              <h4>{g.titulo}</h4>
              {g.modulos.map((m) => (
                <button key={m.id} className="nav-item" aria-current={vista.modulo === m.id || (vista.modulo === 'detalle' && vista.desde === m.id) ? 'page' : undefined} onClick={() => ir(m.id)}>
                  <Icono nombre={iconoDe(m.id)} />{m.nombre}
                  {m.estado === 'proximamente' && <span className="pronto">pronto</span>}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="lateral-pie">
          <Avatar nombre={yo.usuario} />
          <div className="quien"><strong>{yo.usuario}</strong><span>{etiquetaDeRol(yo)}</span></div>
          <button className="btn btn-fantasma btn-icono" onClick={salir} aria-label="Cerrar sesión" title="Cerrar sesión"><Icono nombre="salir" /></button>
        </div>
      </aside>
      <div className="principal">
        <header className="barra-superior">
          <button className="btn btn-fantasma btn-icono menu-movil" onClick={() => setMenuAbierto(true)} aria-label="Abrir menú"><Icono nombre="menu" /></button>
          <div className="ruta">
            <span>SIGET</span><Icono nombre="derecha" className="tenue" />
            {origen && <><span>{origen.nombre}</span><Icono nombre="derecha" className="tenue" /></>}
            <strong>{titulo}</strong>
          </div>
          <div className="derecha">
            <button className="btn btn-fantasma btn-icono" onClick={alternarTema} aria-label={tema === 'oscuro' ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'} title="Cambiar tema">
              <Icono nombre={tema === 'oscuro' ? 'sol' : 'luna'} />
            </button>
          </div>
        </header>
        <main className="contenido" id="contenido">{contenido}</main>
      </div>
      {restante !== null && <AvisoInactividad restante={restante} seguir={seguirConectado} salir={salir} />}
    </div>
  )
}
