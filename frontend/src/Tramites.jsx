import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, ApiError } from './api.js'
import { ACCIONES_EVENTO, ESTADOS, Estado, FINALES, Paginacion, Plazo, SIGUIENTES, fecha, fechaCorta, hace, mensajeDe, usePagina, useReautenticacion } from './comun.jsx'
import { CamposFormulario, DatosSolicitud, ModalMotivo, ResponderSubsanacion, ResumenErrores, armarDatos, erroresDe, ultimoMotivoDeSubsanacion, validarCliente, valoresIniciales } from './Contenido.jsx'
import { Documentos } from './Documentos.jsx'
import { Seguimiento } from './Seguimiento.jsx'
import { Alerta, Esqueleto, Icono, BloquesEsqueleto, Vacio, useUI } from './ui.jsx'

const LOTE = 100 // lo máximo que admite el servidor por petición
const MAX_LOTES = 50 // tope de seguridad: 5000 trámites; si hubiera más se avisa en pantalla

// Trae TODOS los trámites que la persona puede ver, de a 100, usando el `total` del servidor: antes se pedían solo 100 y el resto no aparecía
// nunca. Los filtros, la búsqueda y los indicadores trabajan sobre todos; la pantalla los reparte de a 20 por página.
export async function traerTramites() {
  const primera = await api(`/tramites/?limite=${LOTE}`)
  const total = primera.total ?? primera.resultados.length
  const pedidas = []
  for (let desde = LOTE; desde < total && pedidas.length < MAX_LOTES - 1; desde += LOTE) pedidas.push(api(`/tramites/?limite=${LOTE}&desplazamiento=${desde}`))
  const resto = await Promise.all(pedidas)
  // Si alguien creó un trámite mientras se pedían las páginas, el desplazamiento corre una fila: se descartan los repetidos
  const vistos = new Set()
  const filas = [primera, ...resto].flatMap((p) => p.resultados).filter((t) => !vistos.has(t.id) && vistos.add(t.id))
  return { filas, total, truncado: total > LOTE * MAX_LOTES }
}

function useTramites() {
  const [filas, setFilas] = useState(null)
  const [truncado, setTruncado] = useState(false)
  const [error, setError] = useState('')
  const cargar = useCallback(async () => {
    setError('')
    try {
      const d = await traerTramites()
      setFilas(d.filas)
      setTruncado(d.truncado)
    } catch (e) {
      setError(mensajeDe(e))
      setFilas([])
    }
  }, [])
  useEffect(() => { cargar() }, [cargar])
  return { filas, truncado, error, cargar }
}

const AvisoTruncado = ({ truncado }) => (truncado ? <Alerta tipo="info">Hay muchísimos trámites: aquí se muestran los {LOTE * MAX_LOTES} más recientes.</Alerta> : null)

// El personal también puede ser solicitante: «Mis trámites» son los que él pidió; el resto es de la bandeja.
export const esMio = (t, yo) => !('solicitante_id' in t) || t.solicitante_id === yo.id
const esAbierto = (t) => !FINALES.includes(t.estado)

function coincide(t, q) {
  if (!q) return true
  const texto = `${t.id} ${t.tipo_tramite.nombre} ${t.institucion.nombre} ${ESTADOS[t.estado]?.texto || ''}`.toLowerCase()
  return q.toLowerCase().split(/\s+/).every((p) => texto.includes(p))
}

export function Buscador({ valor, cambiar, etiqueta = 'Buscar por número, trámite o institución' }) {
  return (
    <div className="buscador">
      <Icono nombre="buscar" />
      <input className="entrada entrada-buscar" type="search" value={valor} onChange={(e) => cambiar(e.target.value)} placeholder={etiqueta} aria-label={etiqueta} />
    </div>
  )
}

function atiende(t, yo, nombres = {}) {
  if ('asignado' in t) return t.asignado ? 'En atención' : 'En cola'
  if (!t.funcionario_asignado_id) return <span className="tenue">Sin asignar</span>
  if (t.funcionario_asignado_id === yo.id) return <strong>Tú</strong>
  return nombres[t.funcionario_asignado_id] || `Persona #${t.funcionario_asignado_id}`
}

function Tabla({ filas, yo, abrir, nombres }) {
  return (
    <div className="tabla-caja">
      <table className="tabla">
        <thead><tr><th>N.º</th><th>Trámite</th><th>Estado</th><th>Plazo</th><th>Atiende</th></tr></thead>
        <tbody>
          {filas.map((t) => (
            <tr key={t.id} className="fila-enlace" tabIndex={0} onClick={() => abrir(t.id)} onKeyDown={(e) => e.key === 'Enter' && abrir(t.id)} aria-label={`Trámite ${t.id}: ${t.tipo_tramite.nombre}`}>
              <td className="num">#{t.id}</td>
              <td className="titulo-fila">{t.tipo_tramite.nombre}<small>{t.institucion.nombre}</small></td>
              <td><Estado valor={t.estado} /></td>
              <td><Plazo tramite={t} /></td>
              <td>{atiende(t, yo, nombres)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Indicador({ valor, texto, clase = '' }) {
  return <div className={`indicador ${clase}`}><strong>{valor}</strong><span>{texto}</span></div>
}

/* ---------------------------------------------------------------- mis trámites */

export const SIN_FILTROS = { q: '', estado: '', institucion: '' }

// «Mis trámites» se busca por número (con o sin «#») o por el nombre del trámite
export function coincideMio(t, q) {
  const palabras = q.toLowerCase().replace(/#/g, '').split(/\s+/).filter(Boolean)
  const texto = `${t.id} ${t.tipo_tramite.nombre}`.toLowerCase()
  return palabras.every((p) => texto.includes(p))
}

// Búsqueda, estado e institución se combinan. Se filtra sobre la lista COMPLETA y después se pagina (de a 20, en el navegador): los totales del
// paginador son los de lo filtrado. `filtros` y `cambiarFiltros` los puede guardar quien llama (para conservarlos al volver del detalle);
// sin ellos, la pantalla los lleva sola.
export function MisTramites({ yo, abrir, nuevo, filtros: guardados, cambiarFiltros }) {
  const { filas, truncado, error } = useTramites()
  const [propios, setPropios] = useState(SIN_FILTROS)
  const filtros = guardados ?? propios
  const poner = cambiarFiltros ?? setPropios
  const { q, estado, institucion } = filtros
  const cambiar = (parche) => poner({ ...filtros, ...parche })
  const mios = useMemo(() => (filas || []).filter((t) => esMio(t, yo)), [filas, yo])
  const instituciones = useMemo(() => [...new Map(mios.map((t) => [t.institucion.id, t.institucion.nombre])).entries()].sort((a, b) => a[1].localeCompare(b[1], 'es')), [mios])
  const coinciden = useMemo(
    () => mios.filter((t) => coincideMio(t, q) && (!estado || t.estado === estado) && (!institucion || String(t.institucion.id) === institucion)),
    [mios, q, estado, institucion],
  )
  const { pagina, setPagina, visibles, total } = usePagina(coinciden, undefined, `${q}|${estado}|${institucion}`)
  const hayFiltros = Boolean(q.trim() || estado || institucion)
  const enCurso = mios.filter(esAbierto)
  const vencen = enCurso.filter((t) => t.vencido).length
  return (
    <>
      <div className="encabezado-vista">
        <div><h2>Mis trámites</h2><p>Lo que iniciaste y en qué etapa va cada uno.</p></div>
        <button className="btn" onClick={nuevo}><Icono nombre="mas" />Iniciar un trámite</button>
      </div>
      <Alerta>{error}</Alerta>
      <AvisoTruncado truncado={truncado} />
      {filas === null ? <><BloquesEsqueleto n={3} /><Esqueleto /></> : (
        <>
          <div className="indicadores">
            <Indicador valor={enCurso.length} texto="En curso" />
            <Indicador valor={mios.filter((t) => t.estado === 'Aprobado').length} texto="Aprobados" clase="ok-ind" />
            <Indicador valor={vencen} texto="Con el plazo vencido" clase={vencen ? 'alerta-ind' : ''} />
          </div>
          {mios.length === 0 ? (
            <Vacio titulo="Todavía no iniciaste ningún trámite" texto="Elige una institución y un trámite del catálogo. Podrás seguir cada etapa desde aquí." accion={<button className="btn" onClick={nuevo}><Icono nombre="mas" />Iniciar un trámite</button>} />
          ) : (
            <>
              <div className="barra-herramientas" role="group" aria-label="Buscar y filtrar mis trámites">
                <Buscador valor={q} cambiar={(v) => cambiar({ q: v })} etiqueta="Buscar por número o nombre del trámite" />
                <select className="seleccion filtro" aria-label="Estado" value={estado} onChange={(e) => cambiar({ estado: e.target.value })}>
                  <option value="">Todos los estados</option>
                  {Object.entries(ESTADOS).map(([clave, e]) => <option key={clave} value={clave}>{e.texto}</option>)}
                </select>
                <select className="seleccion filtro" aria-label="Institución" value={institucion} onChange={(e) => cambiar({ institucion: e.target.value })}>
                  <option value="">Todas las instituciones</option>
                  {instituciones.map(([id, nombre]) => <option key={id} value={String(id)}>{nombre}</option>)}
                </select>
                {hayFiltros && <button type="button" className="btn btn-sec btn-s" onClick={() => poner(SIN_FILTROS)}>Quitar filtros</button>}
                {hayFiltros && <span className="suave" role="status">{total} de {mios.length} {mios.length === 1 ? 'trámite' : 'trámites'}</span>}
              </div>
              {total ? <><Tabla filas={visibles} yo={yo} abrir={abrir} /><Paginacion total={total} pagina={pagina} cambiar={setPagina} unidad="trámites" /></> : (
                <Vacio titulo="Nada coincide con tu búsqueda" texto="Prueba con otro número o nombre del trámite, o cambia los filtros."
                  accion={<button type="button" className="btn btn-sec" onClick={() => poner(SIN_FILTROS)}>Ver todos mis trámites</button>} />
              )}
            </>
          )}
        </>
      )}
    </>
  )
}

/* ---------------------------------------------------------------- nuevo trámite */

export const diasHabiles = (n) => `${n} ${n === 1 ? 'día hábil' : 'días hábiles'}`

// La tarjeta que se lee antes del formulario: para qué sirve el trámite, el plazo, los documentos que hacen falta y qué pasa después. Todo texto
// que llega del catálogo se dibuja como texto de React (nunca como HTML). Los requisitos los escribe la coordinación de la institución.
export function AntesDeEmpezar({ tipo, empezado, empezar }) {
  const r = tipo.requisitos || {}
  const documentos = Array.isArray(r.documentos) ? r.documentos : []
  return (
    <section className="panel antes-de-empezar" aria-labelledby="antes-de-empezar">
      <div className="panel-cabecera"><h3 id="antes-de-empezar">Antes de empezar</h3></div>
      {r.descripcion ? <p className="texto-largo">{r.descripcion}</p> : <p className="suave">La institución todavía no describió este trámite.</p>}
      <dl className="datos">
        <dt>Plazo de atención</dt><dd>{diasHabiles(tipo.sla_dias)}</dd>
      </dl>
      <h4>Documentos que vas a necesitar</h4>
      {documentos.length ? (
        <>
          <ul className="lista-requisitos">{documentos.map((d, i) => <li key={i}>{d}</li>)}</ul>
          <p className="nota">Los adjuntas desde el trámite ya iniciado, en PDF, PNG o JPEG de hasta 5 MB cada uno.</p>
        </>
      ) : <p className="suave">La institución no pide documentos para este trámite.</p>}
      <h4>Qué pasa después</h4>
      <p className="texto-largo">{r.despues || 'Recibirás un número de seguimiento y verás aquí cada paso del trámite.'}</p>
      {!empezado && <div className="fila-botones inicio"><button type="button" className="btn" onClick={empezar}>Empezar</button></div>}
    </section>
  )
}

// `preseleccion` ({ institucion, tipo }: ids) la manda el «Directorio»: se aplica una sola vez, cuando llegan el catálogo y los trámites de esa institución
export function NuevoTramite({ yo, abrir, preseleccion = null }) {
  const [instituciones, setInstituciones] = useState(null)
  const [tipos, setTipos] = useState(null)
  const [institucion, setInstitucion] = useState(null)
  const [tipo, setTipo] = useState(null)
  const [empezado, setEmpezado] = useState(false) // leyó «Antes de empezar» y pidió el formulario
  const formulario = useRef(null)
  const pendiente = useRef(preseleccion)
  const [error, setError] = useState('')
  const [trabajando, setTrabajando] = useState(false)
  const [valores, setValores] = useState({})
  const [errores, setErrores] = useState({})
  const [general, setGeneral] = useState('')
  const { avisar } = useUI()
  // El personal inicia trámites hacia OTRAS instituciones (solicitudes interinstitucionales); la ciudadanía, los suyos. Nadie inicia en su propia institución.
  const esPersonal = yo.membresias.length > 0
  const propias = useMemo(() => new Set(yo.membresias.map((m) => m.institucion_id)), [yo.membresias])

  useEffect(() => {
    api('/catalogo/instituciones/').then((l) => {
      const lista = l.filter((i) => !propias.has(i.id))
      setInstituciones(lista)
      const elegida = pendiente.current && lista.find((i) => i.id === pendiente.current.institucion)
      if (elegida) setInstitucion(elegida)
      else pendiente.current = null
    }).catch((e) => setError(mensajeDe(e)))
  }, [propias])
  useEffect(() => {
    setTipo(null)
    setEmpezado(false)
    setTipos(null)
    if (!institucion) return
    api(`/catalogo/tipos-tramite/?institucion=${institucion.id}`).then((l) => {
      const lista = l.filter((t) => t.audiencia === 'ambas' || t.audiencia === (esPersonal ? 'institucion' : 'ciudadania'))
      setTipos(lista)
      const elegido = pendiente.current && lista.find((t) => t.id === pendiente.current.tipo)
      pendiente.current = null
      if (elegido) { setTipo(elegido); setValores(valoresIniciales(elegido.formulario || [])) } // lo que llega del directorio: se lee «Antes de empezar» antes del formulario
    }).catch((e) => setError(mensajeDe(e)))
  }, [institucion, esPersonal])

  // Cada tipo trae su formulario: al cambiar de trámite se parte de un formulario limpio
  const campos = tipo?.formulario || []
  const elegirTipo = (t) => {
    setTipo(t)
    setEmpezado(false)
    setValores(valoresIniciales(t.formulario || []))
    setErrores({})
    setGeneral('')
  }

  // Al pulsar «Empezar» el foco pasa al primer dato del formulario (o al formulario mismo si no pide ninguno)
  useEffect(() => {
    if (empezado) (formulario.current?.querySelector('input, select, textarea') ?? formulario.current)?.focus()
  }, [empezado])

  async function crear(ev) {
    ev.preventDefault()
    setError('')
    setGeneral('')
    const locales = validarCliente(campos, valores)
    setErrores(locales)
    if (Object.keys(locales).length) return
    setTrabajando(true)
    try {
      const t = await api('/tramites/', { metodo: 'POST', cuerpo: { tipo_tramite: tipo.id, datos: armarDatos(campos, valores) } })
      avisar(`Tu trámite #${t.id} quedó registrado.`)
      abrir(t.id, { nuevo: true }) // el detalle ofrece la constancia de presentación
    } catch (e) {
      const porCampo = erroresDe(e)
      if (porCampo) {
        // Lo que no es de un campo del formulario (la clave `datos`) va solo en el resumen
        setErrores(Object.fromEntries(Object.entries(porCampo).filter(([k]) => campos.some((c) => c.id === k))))
        setGeneral(Object.entries(porCampo).filter(([k]) => !campos.some((c) => c.id === k)).map(([, m]) => m).join(' '))
      } else setError(mensajeDe(e))
      setTrabajando(false)
    }
  }

  return (
    <>
      <div className="encabezado-vista"><div><h2>Iniciar un trámite</h2><p>{esPersonal ? 'Solicitudes de tu institución a otra institución. No puedes iniciar trámites en la tuya.' : 'Dos pasos: la institución y el trámite. Verás el plazo antes de confirmar.'}</p></div></div>
      <Alerta>{error}</Alerta>
      <div className="nuevo">
        <div>
          <section className="panel">
            <div className="panel-cabecera"><h3>{esPersonal ? '1. ¿A qué institución?' : '1. ¿Ante qué institución?'}</h3></div>
            {instituciones === null ? <BloquesEsqueleto n={2} /> : (
              <div className="opciones" role="radiogroup" aria-label="Institución">
                {instituciones.map((i) => (
                  <button key={i.id} className="opcion" role="radio" aria-checked={institucion?.id === i.id} onClick={() => setInstitucion(i)}>
                    <span className="marca-opcion">{institucion?.id === i.id && <Icono nombre="check" />}</span>
                    <span className="cuerpo-opcion"><strong>{i.nombre}</strong></span>
                  </button>
                ))}
              </div>
            )}
          </section>
          {institucion && (
            <section className="panel">
              <div className="panel-cabecera"><h3>2. ¿Qué trámite?</h3></div>
              {tipos === null ? <BloquesEsqueleto n={2} /> : tipos.length === 0 ? <p className="suave">Esta institución aún no publicó trámites.</p> : (
                <div className="opciones" role="radiogroup" aria-label="Trámite">
                  {tipos.map((t) => (
                    <button key={t.id} className="opcion" role="radio" aria-checked={tipo?.id === t.id} onClick={() => elegirTipo(t)}>
                      <span className="marca-opcion">{tipo?.id === t.id && <Icono nombre="check" />}</span>
                      <span className="cuerpo-opcion"><strong>{t.nombre}</strong><small>Plazo de atención: {t.sla_dias} días</small></span>
                    </button>
                  ))}
                </div>
              )}
            </section>
          )}
          {tipo && <AntesDeEmpezar tipo={tipo} empezado={empezado} empezar={() => setEmpezado(true)} />}
          {tipo && empezado && (
            <form id="form-nuevo-tramite" ref={formulario} tabIndex={-1} onSubmit={crear} noValidate aria-labelledby={campos.length ? 'datos-nuevo' : undefined}>
              <ResumenErrores campos={campos} errores={errores} general={general} />
              {campos.length > 0 && (
                <section className="panel">
                  <div className="panel-cabecera"><h3 id="datos-nuevo">3. Datos de la solicitud</h3></div>
                  <CamposFormulario campos={campos} valores={valores} cambiar={(id, v) => setValores((x) => ({ ...x, [id]: v }))} errores={errores} />
                </section>
              )}
            </form>
          )}
        </div>
        <aside className="panel resumen-nuevo" aria-label="Resumen del trámite">
          <h3>Resumen</h3>
          {tipo ? (
            <>
              <dl className="datos">
                <dt>Institución</dt><dd>{institucion.nombre}</dd>
                <dt>Trámite</dt><dd>{tipo.nombre}</dd>
                <dt>Plazo</dt><dd>{tipo.sla_dias} días</dd>
              </dl>
              {empezado ? (
                <>
                  <button className="btn btn-ancho" type="submit" form="form-nuevo-tramite" disabled={trabajando}>{trabajando ? 'Iniciando…' : 'Iniciar trámite'}</button>
                  <p className="nota">Quedará registrado a tu nombre y podrás seguir cada paso, con quién lo hizo y cuándo.</p>
                </>
              ) : <p className="nota">Lee lo anterior y pulsa «Empezar» para llenar el formulario.</p>}
            </>
          ) : <p className="suave">Elige una institución y un trámite para ver el resumen.</p>}
        </aside>
      </div>
    </>
  )
}

/* ---------------------------------------------------------------- bandeja y supervisión */

const COLUMNAS = [
  { clave: 'Pendiente', titulo: 'Pendientes', estados: ['Pendiente'] },
  { clave: 'En Tramitacion', titulo: 'En tramitación', estados: ['En Tramitacion'] },
  { clave: 'En Subsanacion', titulo: 'En subsanación', estados: ['En Subsanacion'] },
  { clave: 'Resueltos', titulo: 'Resueltos', estados: FINALES },
]

// `todas` es la lista completa (con los filtros activos): de ahí sale el número de cada columna. `filas` es solo la página actual: de ahí salen las fichas.
function Tablero({ filas, todas, yo, abrir, nombres }) {
  return (
    <div className="tablero">
      {COLUMNAS.map((c) => {
        const items = filas.filter((t) => c.estados.includes(t.estado))
        const cuenta = todas.filter((t) => c.estados.includes(t.estado)).length
        return (
          <section key={c.clave} className="columna" aria-label={c.titulo}>
            <div className="columna-cabecera"><span>{c.titulo}</span><span className="cuenta">{cuenta}</span></div>
            {cuenta === 0 && <p className="columna-vacia">Sin trámites</p>}
            {cuenta > 0 && items.length === 0 && <p className="columna-vacia">En otras páginas</p>}
            {items.map((t) => (
              <button key={t.id} className="ficha" onClick={() => abrir(t.id)}>
                <span className="num">#{t.id} · {t.institucion.nombre}</span>
                <span className="nombre">{t.tipo_tramite.nombre}</span>
                <Plazo tramite={t} />
                <span className="pie"><span>{atiende(t, yo, nombres)}</span>{c.clave === 'Resueltos' && <Estado valor={t.estado} />}</span>
              </button>
            ))}
          </section>
        )
      })}
    </div>
  )
}

export function Bandeja({ yo, abrir, modo }) {
  const { filas, truncado, error } = useTramites()
  const supervision = modo === 'supervision'
  const [filtro, setFiltro] = useState('abiertos')
  const [vista, setVista] = useState('lista')
  const [q, setQ] = useState('')
  const [nombres, setNombres] = useState({})
  // Quien supervisa o coordina conoce al equipo: se muestran nombres en vez de números
  useEffect(() => {
    if (!yo.membresias.some((m) => ['supervisor', 'coordinador_institucional'].includes(m.rol))) return
    api('/equipo/').then((d) => setNombres(Object.fromEntries(d.equipos.flatMap((e) => e.personal.map((p) => [p.usuario_id, p.usuario]))))).catch(() => {})
  }, [yo])
  const ajenos = useMemo(() => (filas || []).filter((t) => !esMio(t, yo)), [filas, yo])
  const coinciden = useMemo(() => ajenos.filter((t) => {
    if (!coincide(t, q)) return false
    if (filtro === 'abiertos') return esAbierto(t)
    if (filtro === 'sin_asignar') return esAbierto(t) && !t.funcionario_asignado_id
    if (filtro === 'vencidos') return t.vencido
    if (filtro === 'escalados') return t.escalado && esAbierto(t)
    if (filtro === 'mios') return t.funcionario_asignado_id === yo.id
    return true
  }), [ajenos, filtro, q, yo])
  // Cambiar el filtro o la búsqueda vuelve a la primera página; la vista (lista o tablero) comparte la página
  const { pagina, setPagina, visibles, total } = usePagina(coinciden, undefined, `${filtro}|${q}`)
  const cuenta = (f) => ajenos.filter(f).length
  const filtros = supervision
    ? [['abiertos', 'Abiertos'], ['sin_asignar', 'Sin asignar'], ['escalados', 'Escalados'], ['vencidos', 'Vencidos'], ['todos', 'Todos']]
    : [['abiertos', 'Abiertos'], ['mios', 'Asignados a mí'], ['vencidos', 'Vencidos'], ['todos', 'Todos']]
  const vencidos = cuenta((t) => t.vencido)
  return (
    <>
      <div className="encabezado-vista">
        <div>
          <h2>{supervision ? 'Supervisión' : 'Bandeja de la institución'}</h2>
          <p>{supervision ? 'Detecta los trámites vencidos o sin atender y reasígnalos.' : 'Los trámites de las instituciones donde trabajas. Solo ves los de tu institución.'}</p>
        </div>
      </div>
      <Alerta>{error}</Alerta>
      <AvisoTruncado truncado={truncado} />
      {filas === null ? <><BloquesEsqueleto n={4} /><Esqueleto /></> : (
        <>
          <div className="indicadores">
            <Indicador valor={cuenta((t) => t.estado === 'Pendiente')} texto="Pendientes" />
            <Indicador valor={cuenta((t) => t.estado === 'En Tramitacion')} texto="En tramitación" />
            <Indicador valor={cuenta((t) => t.estado === 'En Subsanacion')} texto="En subsanación" />
            <Indicador valor={vencidos} texto="Con el plazo vencido" clase={vencidos ? 'alerta-ind' : ''} />
          </div>
          <div className="barra-herramientas">
            <Buscador valor={q} cambiar={setQ} />
            <div className="segmentos" role="group" aria-label="Filtro">
              {filtros.map(([k, n]) => <button key={k} aria-pressed={filtro === k} onClick={() => setFiltro(k)}>{n}</button>)}
            </div>
            <div className="segmentos espacio" role="group" aria-label="Vista">
              <button aria-pressed={vista === 'lista'} onClick={() => setVista('lista')}><Icono nombre="lista" />Lista</button>
              <button aria-pressed={vista === 'tablero'} onClick={() => setVista('tablero')}><Icono nombre="tablero" />Tablero</button>
            </div>
          </div>
          {total === 0
            ? <Vacio titulo={ajenos.length ? 'Nada coincide con este filtro' : 'No hay trámites en tu institución'} texto={ajenos.length ? 'Cambia el filtro o la búsqueda para ver más.' : 'Cuando la ciudadanía inicie trámites, aparecerán aquí.'} />
            : (
              <>
                {vista === 'lista' ? <Tabla filas={visibles} yo={yo} abrir={abrir} nombres={nombres} /> : <Tablero filas={visibles} todas={coinciden} yo={yo} abrir={abrir} nombres={nombres} />}
                <Paginacion total={total} pagina={pagina} cambiar={setPagina} unidad="trámites" />
              </>
            )}
        </>
      )}
    </>
  )
}

/* ---------------------------------------------------------------- detalle */

// Un 400 de una decisión trae el motivo del rechazo por campo (`errores.motivo`) o su propio detalle
function mensajeDeDecision(e) {
  const porCampo = erroresDe(e)
  if (porCampo && Object.keys(porCampo).length) return Object.values(porCampo).join(' ')
  if (e instanceof ApiError && e.codigo === 'tramite_resuelto') return e.message  // el servidor dice que ya está resuelto: se le cree
  return mensajeDe(e)
}

const ICONO_EVENTO = { creacion: 'mas', cambio_estado: 'flujo', reasignacion: 'reasignar', escalamiento: 'alerta', documento_adjuntado: 'documento' }

export function Detalle({ id, yo, volver, volverA, constancia, nuevo }) {
  const [tramite, setTramite] = useState(null)
  const [eventos, setEventos] = useState([])
  const [personal, setPersonal] = useState([])
  const [error, setError] = useState('')
  const [pidiendoMotivo, setPidiendoMotivo] = useState(null) // 'Rechazado' | 'En Subsanacion' | 'cierre' mientras el modal está abierto
  const [errorMotivo, setErrorMotivo] = useState('')
  const { ejecutar, modal } = useReautenticacion()
  const { avisar, confirmar } = useUI()

  const cargar = useCallback(async () => {
    try {
      const [t, h] = await Promise.all([api(`/tramites/${id}/`), api(`/tramites/${id}/historial/`)])
      setTramite(t)
      setEventos(h.eventos)
      setError('')
    } catch (e) {
      setError(mensajeDe(e))
      setTramite(false)
    }
  }, [id])
  useEffect(() => { cargar() }, [cargar])

  const esPersonal = !!tramite && 'solicitante_id' in tramite
  const esSupervisor = esPersonal && yo.membresias.some((m) => m.institucion_id === tramite.institucion.id && m.rol === 'supervisor')
  const esPropio = esPersonal && tramite.solicitante_id === yo.id
  const nombres = Object.fromEntries(personal.map((p) => [p.usuario_id, p.usuario]))

  useEffect(() => {
    if (!esSupervisor) return
    api('/equipo/').then((d) => {
      const eq = d.equipos.find((e) => e.institucion.id === tramite.institucion.id)
      setPersonal(eq ? eq.personal : [])
    }).catch(() => setPersonal([]))
  }, [esSupervisor, tramite])

  // `enModal`: el error se muestra dentro del modal del motivo, que solo se cierra cuando el servidor acepta (2xx)
  async function accion(f, mensaje, enModal = false) {
    setError('')
    setErrorMotivo('')
    // Se ejecuta de nuevo tras la reautenticación, así que maneja sus propios errores (salvo el que pide reautenticar)
    await ejecutar(async () => {
      try {
        await f()
        setPidiendoMotivo(null)
        await cargar()
        avisar(mensaje)
      } catch (e) {
        if (e instanceof ApiError && e.pideReautenticar) throw e
        const texto = mensajeDeDecision(e)
        if (enModal) setErrorMotivo(texto)
        else setError(texto)
      }
    })
  }

  // Rechazar, pedir una subsanación y cerrarla piden un motivo: el servidor y la base lo vuelven a exigir
  const claveMotivo = (estado) => (estado === 'Rechazado' || estado === 'En Subsanacion' ? estado : tramite.estado === 'En Subsanacion' ? 'cierre' : null)

  // Desistir lo hace solo la persona que presentó el trámite (otra ruta, otra acción del servidor): no cambia el estado «a la fuerza»
  const enviarMotivo = (motivo) => (pidiendoMotivo === 'desistir'
    ? accion(() => api(`/tramites/${id}/desistir/`, { metodo: 'POST', cuerpo: { motivo } }), 'Desististe del trámite: quedó cerrado y registrado en su historial.', true)
    : accion(
      () => api(`/tramites/${id}/estado/`, { metodo: 'POST', cuerpo: { estado: pidiendoMotivo === 'cierre' ? 'En Tramitacion' : pidiendoMotivo, motivo } }),
      `El trámite pasó a «${ESTADOS[pidiendoMotivo === 'cierre' ? 'En Tramitacion' : pidiendoMotivo].texto}».`,
      true,
    ))

  async function cambiar(estado) {
    const clave = claveMotivo(estado)
    if (clave) {
      setErrorMotivo('')
      setPidiendoMotivo(clave)
      return
    }
    if (FINALES.includes(estado)) {
      const si = await confirmar({
        titulo: 'Aprobar este trámite',
        texto: 'Es un estado final: después no se puede cambiar. La decisión queda en el historial con tu nombre.',
        etiqueta: 'Aprobar trámite',
      })
      if (!si) return
    }
    await accion(() => api(`/tramites/${id}/estado/`, { metodo: 'POST', cuerpo: { estado } }), `El trámite pasó a «${ESTADOS[estado].texto}».`)
  }

  const reasignar = (valor) => {
    if (!valor) return undefined
    const destino = valor === 'cola' ? null : Number(valor)
    return accion(
      () => api(`/tramites/${id}/reasignar/`, { metodo: 'POST', cuerpo: { funcionario_id: destino } }),
      destino ? `Trámite reasignado a ${nombres[destino] || 'otra persona'}.` : 'El trámite volvió a la cola.',
    )
  }

  if (tramite === null) return <><BloquesEsqueleto n={1} /><Esqueleto filas={3} /></>
  if (tramite === false) {
    return <><button className="migas" onClick={volver}><Icono nombre="izquierda" />Volver</button><Alerta>{error}</Alerta></>
  }

  const puedeResponder = tramite.estado === 'En Subsanacion' && (!esPersonal || esPropio)
  const esDeLaPersona = !esPersonal // quien lo presentó (el servidor solo da `solicitante_id` al personal de la institución)
  const puedeDesistir = esDeLaPersona && !FINALES.includes(tramite.estado)
  const quien = (uid) => (uid === yo.id ? 'ti' : nombres[uid] || `persona #${uid}`)
  return (
    <>
      <button className="migas" onClick={volver}><Icono nombre="izquierda" />Volver a {volverA}</button>
      <div className="detalle-cabecera">
        <div>
          <span className="num">TRÁMITE #{tramite.id}</span>
          <h2>{tramite.tipo_tramite.nombre}</h2>
          <p className="suave">{tramite.institucion.nombre}</p>
        </div>
        <div className="estado-grande">
          <Estado valor={tramite.estado} />
          {esDeLaPersona && constancia && <button type="button" className="btn btn-sec" onClick={() => constancia(tramite.id)}><Icono nombre="documento" />Constancia</button>}
        </div>
      </div>
      <Alerta>{error}</Alerta>
      {nuevo && esDeLaPersona && constancia && (
        <Alerta tipo="ok">
          Guarda la constancia de presentación de tu trámite: la puedes imprimir o guardar como PDF.
          {' '}<button type="button" className="btn btn-sec btn-s" onClick={() => constancia(tramite.id)}>Ver mi constancia</button>
        </Alerta>
      )}

      <section className="panel recorrido" aria-label="Recorrido del trámite">
        <Seguimiento estado={tramite.estado} />
        <div className="leyenda">
          <span>Iniciado el <strong>{fechaCorta(tramite.creado_en)}</strong></span>
          <span>Fecha límite <strong>{fechaCorta(tramite.fecha_limite)}</strong></span>
          <Plazo tramite={tramite} />
        </div>
      </section>

      {puedeResponder && <ResponderSubsanacion tramite={tramite} motivo={ultimoMotivoDeSubsanacion(eventos)} alResponder={cargar} />}
      <DatosSolicitud formulario={tramite.formulario} datos={tramite.datos} />

      <div className="rejilla-detalle">
        <section className="panel">
          <h3>Detalle</h3>
          <dl className="datos">
            {esPersonal ? (
              <>
                <dt>Solicitante</dt><dd>{esPropio ? 'Tú' : `Persona #${tramite.solicitante_id}`}</dd>
                <dt>Atiende</dt><dd>{tramite.funcionario_asignado_id ? quien(tramite.funcionario_asignado_id) : 'Sin asignar'}</dd>
                <dt>Sensibilidad</dt><dd>Nivel {tramite.sensibilidad}</dd>
              </>
            ) : (
              <><dt>Atención</dt><dd>{tramite.asignado ? 'Un funcionario lo está atendiendo' : 'En la cola de la institución'}</dd></>
            )}
          </dl>
          {esPersonal && !esPropio && (
            <div className="acciones">
              <h4>Acciones</h4>
              {SIGUIENTES[tramite.estado].length === 0 ? <p className="suave">{tramite.estado === 'Desistido' ? 'La persona que presentó este trámite desistió de él: ya no admite cambios.' : 'Este trámite ya tiene una resolución final: no admite más cambios.'}</p> : (
                <div className="fila-botones inicio">
                  {SIGUIENTES[tramite.estado].map((s) => (
                    <button key={s} className={`btn ${s === 'Rechazado' ? 'btn-peligro' : s === 'En Subsanacion' ? 'btn-sec' : ''}`} onClick={() => cambiar(s)}>
                      {s === 'Aprobado' ? 'Aprobar' : s === 'Rechazado' ? 'Rechazar' : s === 'En Subsanacion' ? 'Pedir subsanación' : tramite.estado === 'En Subsanacion' ? 'Cerrar la subsanación' : 'Pasar a tramitación'}
                    </button>
                  ))}
                </div>
              )}
              {esSupervisor && !FINALES.includes(tramite.estado) && (
                <label className="campo separado">
                  <span>Reasignar a</span>
                  <select className="seleccion" value="" onChange={(e) => reasignar(e.target.value)}>
                    <option value="">Elegir una persona…</option>
                    {tramite.funcionario_asignado_id && <option value="cola">Devolver a la cola</option>}
                    {personal.filter((p) => ['funcionario', 'supervisor'].includes(p.rol) && p.usuario_id !== tramite.funcionario_asignado_id).map((p) => <option key={p.usuario_id} value={p.usuario_id}>{p.usuario}</option>)}
                  </select>
                </label>
              )}
              <p className="nota">Los botones son una ayuda: el servidor decide cada cambio (segundo factor reciente, conflicto de interés, asignación) y la base de datos valida la transición.</p>
            </div>
          )}
          {esPropio && <Alerta tipo="info">Este trámite lo iniciaste tú: por conflicto de interés no puedes gestionarlo como funcionario.</Alerta>}
          {puedeDesistir && (
            <div className="acciones">
              <h4>Tu trámite</h4>
              <button type="button" className="btn btn-peligro" onClick={() => { setErrorMotivo(''); setPidiendoMotivo('desistir') }}>Desistir del trámite</button>
              <p className="nota">Si ya no lo necesitas, puedes retirarlo. Queda cerrado y no se puede deshacer.</p>
            </div>
          )}
        </section>

        <section className="panel">
          <h3>Historial</h3>
          <ol className="linea-tiempo">
            {eventos.map((e, i) => (
              <li key={e.id} className={i === eventos.length - 1 ? 'ultimo' : ''}>
                <span className="punto"><Icono nombre={ICONO_EVENTO[e.accion] || 'flujo'} /></span>
                <div className="evento">
                  <strong>{ACCIONES_EVENTO[e.accion] || e.accion}</strong>
                  {e.accion === 'cambio_estado' && <span className="cambio"><Estado valor={e.estado_anterior} /><Icono nombre="derecha" className="tenue" /><Estado valor={e.estado_nuevo} /></span>}
                  {e.accion === 'escalamiento' && <span className="quien">Superó el plazo: el sistema lo pasó a la supervisión de la institución</span>}
                  {e.accion === 'reasignacion' && e.atributos && <span className="quien">{e.atributos.de ? `De ${quien(e.atributos.de)} a ` : 'Asignado a '}{e.atributos.a ? quien(e.atributos.a) : 'la cola'}</span>}
                  {e.motivo && <blockquote className="cita-motivo"><span className="etiqueta-cita">Motivo</span>{e.motivo}</blockquote>}
                  <time dateTime={e.creado_en} title={fecha(e.creado_en)}>{fecha(e.creado_en)} · {hace(e.creado_en)}</time>
                  {'actor_id' in e && <span className="quien">Por {quien(e.actor_id)}</span>}
                </div>
              </li>
            ))}
          </ol>
          {!esPersonal && <p className="nota">El historial es inalterable. Por privacidad no muestra qué funcionario actuó.</p>}
        </section>
      </div>
      {/* Adjunta quien pidió el trámite (no el personal en su nombre) y solo mientras no tiene resolución final */}
      <Documentos tramiteId={tramite.id} puedeAdjuntar={!esPersonal && !FINALES.includes(tramite.estado)} alAdjuntar={cargar} />
      {modal}
      {pidiendoMotivo && <ModalMotivo clave={pidiendoMotivo} error={errorMotivo} enviar={enviarMotivo} cancelar={() => setPidiendoMotivo(null)} />}
    </>
  )
}
