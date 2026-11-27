import { useCallback, useEffect, useState } from 'react'
import { alPerderLaSesion, api, cerrarSesion, olvidarToken, renovar } from './api.js'
import { Acceso, AvisoDemostracion, EnrolarMfa } from './Acceso.jsx'
import { Auditoria } from './Auditoria.jsx'
import { AvisoInactividad, useInactividad } from './inactividad.jsx'
import { SegundoFactor } from './Mfa.jsx'
import { etiquetaDeRol } from './comun.jsx'
import { agrupar, iconoDe } from './modulos.js'
import { CatalogoInstitucion } from './Catalogo.jsx'
import { Equipo } from './Equipo.jsx'
import { LimiteDeError } from './ErrorBoundary.jsx'
import { Campana } from './Notificaciones.jsx'
import { Inicio, Proximamente, PruebaAcceso, Seguridad } from './Otras.jsx'
import { MisDatos } from './MisDatos.jsx'
import { Privacidad } from './Privacidad.jsx'
import { ConsolaCatalogo, ConsolaIdentidades, ConsolaInfraestructura, ConsolaSecretos, ConsolaSeguridad } from './Plataforma.jsx'
import { Constancia } from './Constancia.jsx'
import { Directorio } from './Directorio.jsx'
import { Bandeja, Detalle, MisTramites, NuevoTramite, SIN_FILTROS } from './Tramites.jsx'
import { Avatar, Icono, Logo, useUI } from './ui.jsx'

export default function App() {
  const [fase, setFase] = useState('cargando')
  const [yo, setYo] = useState(null)
  const [vista, setVista] = useState({ modulo: 'inicio' })
  const [menuAbierto, setMenuAbierto] = useState(false)
  const [filtrosMis, setFiltrosMis] = useState(SIN_FILTROS) // los filtros de «Mis trámites» sobreviven a abrir un trámite y volver; al salir se olvidan
  const { tema, alternarTema, avisar } = useUI()

  const [motivo, setMotivo] = useState('')
  // El aviso de privacidad es público: vive en la dirección (#/privacidad) y se puede leer antes de registrarse o con la sesión abierta
  const [enPrivacidad, setEnPrivacidad] = useState(window.location.hash === '#/privacidad')
  useEffect(() => {
    const f = () => setEnPrivacidad(window.location.hash === '#/privacidad')
    window.addEventListener('hashchange', f)
    return () => window.removeEventListener('hashchange', f)
  }, [])

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

  const salirDelTodo = useCallback((porque = '') => { olvidarToken(); setYo(null); setMotivo(porque); setFiltrosMis(SIN_FILTROS); setFase('login') }, [])

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

  if (enPrivacidad) return <><Privacidad />{restante !== null && <AvisoInactividad restante={restante} seguir={seguirConectado} salir={salir} />}</>
  if (fase === 'cargando') {
    return <main className="acceso"><section className="acceso-formulario" role="status" aria-label="Verificando tu sesión"><Logo className="marca-logo" /></section></main>
  }
  if (fase === 'login') return <><AvisoDemostracion /><Acceso alEntrar={cargarYo} motivo={motivo} /></>
  if (fase === 'enrolar') return <><EnrolarMfa usuario={yo.usuario} alTerminar={cargarYo} alSalir={salir} />{restante !== null && <AvisoInactividad restante={restante} seguir={seguirConectado} salir={salir} />}</>

  const ir = (modulo) => { setVista({ modulo }); setMenuAbierto(false); window.scrollTo({ top: 0 }) }
  // Del «Directorio» a «Iniciar un trámite» con la institución y el trámite ya elegidos (ids)
  const iniciar = (institucion, tipo) => { setVista({ modulo: 'nuevo_tramite', preseleccion: { institucion, tipo } }); setMenuAbierto(false); window.scrollTo({ top: 0 }) }
  // `extra`: `{ nuevo: true }` al terminar de iniciar un trámite (el detalle ofrece entonces la constancia)
  const abrir = (id, extra = {}) => { setVista({ modulo: 'detalle', id, desde: vista.modulo, ...extra }); window.scrollTo({ top: 0 }) }
  const verConstancia = (id) => { setVista({ modulo: 'constancia', id, desde: vista.modulo === 'detalle' ? vista.desde : vista.modulo }); window.scrollTo({ top: 0 }) }
  const actual = yo.modulos.find((m) => m.id === vista.modulo)
  const deUnTramite = vista.modulo === 'detalle' || vista.modulo === 'constancia'
  const origen = deUnTramite ? yo.modulos.find((m) => m.id === vista.desde) : null
  const titulo = vista.modulo === 'inicio' ? 'Inicio' : vista.modulo === 'detalle' ? `Trámite #${vista.id}` : vista.modulo === 'constancia' ? `Constancia del trámite #${vista.id}` : actual?.nombre

  let contenido
  switch (vista.modulo) {
    case 'inicio': contenido = <Inicio yo={yo} ir={ir} abrir={abrir} />; break
    case 'mis_tramites': contenido = <MisTramites yo={yo} abrir={abrir} nuevo={() => ir('nuevo_tramite')} filtros={filtrosMis} cambiarFiltros={setFiltrosMis} />; break
    case 'nuevo_tramite': contenido = <NuevoTramite yo={yo} abrir={abrir} preseleccion={vista.preseleccion} />; break
    case 'directorio': contenido = <Directorio yo={yo} iniciar={iniciar} />; break
    case 'bandeja': contenido = <Bandeja yo={yo} abrir={abrir} modo="bandeja" />; break
    case 'supervision': contenido = <Bandeja yo={yo} abrir={abrir} modo="supervision" />; break
    case 'equipo': contenido = <Equipo />; break
    case 'catalogo_institucion': contenido = <CatalogoInstitucion yo={yo} />; break
    case 'mis_datos': contenido = <MisDatos yo={yo} />; break
    case 'seguridad': contenido = <Seguridad yo={yo} />; break
    case 'auditoria': contenido = <Auditoria />; break
    case 'mfa': contenido = <SegundoFactor yo={yo} refrescar={refrescarYo} />; break
    case 'prueba_acceso': contenido = <PruebaAcceso yo={yo} />; break
    case 'consola_identidades': contenido = <ConsolaIdentidades yo={yo} />; break
    case 'consola_catalogo': contenido = <ConsolaCatalogo yo={yo} />; break
    case 'consola_seguridad': contenido = <ConsolaSeguridad yo={yo} />; break
    case 'consola_secretos': contenido = <ConsolaSecretos />; break
    case 'consola_infraestructura': contenido = <ConsolaInfraestructura />; break
    case 'detalle': contenido = <Detalle id={vista.id} yo={yo} volver={() => ir(vista.desde || 'inicio')} volverA={origen?.nombre || 'Inicio'} constancia={verConstancia} nuevo={vista.nuevo} />; break
    case 'constancia': contenido = <Constancia id={vista.id} volver={() => { setVista({ modulo: 'detalle', id: vista.id, desde: vista.desde }); window.scrollTo({ top: 0 }) }} />; break
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
                <button key={m.id} className="nav-item" aria-current={vista.modulo === m.id || (deUnTramite && vista.desde === m.id) ? 'page' : undefined} onClick={() => ir(m.id)}>
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
            <Campana clave={`${vista.modulo}-${vista.id ?? ''}`} abrir={abrir} />
            <button className="btn btn-fantasma btn-icono" onClick={alternarTema} aria-label={tema === 'oscuro' ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'} title="Cambiar tema">
              <Icono nombre={tema === 'oscuro' ? 'sol' : 'luna'} />
            </button>
          </div>
        </header>
        <AvisoDemostracion />
        <main className="contenido" id="contenido">
          <LimiteDeError key={`${vista.modulo}-${vista.id ?? ''}`} nivel="pantalla" alVolverAlInicio={() => ir('inicio')}>{contenido}</LimiteDeError>
        </main>
      </div>
      {restante !== null && <AvisoInactividad restante={restante} seguir={seguirConectado} salir={salir} />}
    </div>
  )
}
