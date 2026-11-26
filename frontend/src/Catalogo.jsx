import { useCallback, useEffect, useId, useMemo, useState } from 'react'
import { api, ApiError } from './api.js'
import { Paginacion, fecha, hace, mensajeDe, useReautenticacion } from './comun.jsx'
import { CamposFormulario, ResumenErrores } from './Contenido.jsx'
import {
  AUDIENCIAS, AYUDA_MAX, ETIQUETA_MAX, MAX_CAMPOS, NOMBRE_AUDIENCIA, NOMBRE_MAX, SLA_MAX, SLA_MIN, TIPOS_CAMPO, borradorDesde, borradorVacio,
  campoVacio, camposDeVista, cuerpoDe, idDesde, MAX_POR_DEFECTO, resumenDeErrores, usaMaximo, validarBorrador,
} from './catalogo-reglas.js'
import { Alerta, BloquesEsqueleto, Icono, Insignia, Vacio, useUI } from './ui.jsx'

// Catálogo de la institución: la coordinación crea, edita, activa y desactiva los trámites que ofrece su institución y mira quién cambió qué.
// El servidor decide (PDP: coordinación de ESA institución con segundo factor reciente; la base lo impone otra vez) y valida todo: aquí se
// dibuja, se ahorran viajes con validaciones evidentes y se muestra lo que el servidor responde, por campo. Todo texto del servidor se
// dibuja como texto de React, nunca como HTML. Nada se borra: un tipo se desactiva.

const TAM_HISTORIAL = 20

// Lo que responde un 400: `errores` es {clave: mensaje} (las claves son las de validarBorrador); cualquier otra forma, un mensaje general
function erroresDelServidor(e) {
  const d = e instanceof ApiError ? e.datos || {} : {}
  const crudos = d.errores
  if (crudos && typeof crudos === 'object' && !Array.isArray(crudos)) {
    return { errores: Object.fromEntries(Object.entries(crudos).map(([k, v]) => [k, Array.isArray(v) ? v.join(' ') : String(v)])), general: '' }
  }
  if (e instanceof ApiError && e.estado === 400 && d.detalle) return { errores: {}, general: d.detalle }
  return { errores: {}, general: mensajeDe(e) }
}

const sinClave = (errores, ...claves) => Object.fromEntries(Object.entries(errores).filter(([k]) => !claves.includes(k)))
const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`

/* ---------------------------------------------------------------- piezas del editor */

// Una etiqueta con su ayuda y su error, unidos al control por aria-describedby. `children` recibe las propiedades que le tocan al control.
function Etiquetado({ etiqueta, ayuda, error, requerido = false, children }) {
  const id = useId()
  const idAyuda = ayuda ? `${id}-ayuda` : null
  const idError = error ? `${id}-error` : null
  const describe = [idAyuda, idError].filter(Boolean).join(' ') || undefined
  return (
    <div className={`campo ${error ? 'con-error' : ''}`}>
      <label className="campo-etiqueta" htmlFor={id}>{etiqueta}{requerido && <span className="marca-requerido" aria-hidden="true"> *</span>}</label>
      {ayuda && <small id={idAyuda}>{ayuda}</small>}
      {children({ id, 'aria-invalid': error ? 'true' : undefined, 'aria-describedby': describe })}
      {error && <small id={idError} className="error-campo">{error}</small>}
    </div>
  )
}

function TarjetaCampo({ campo, indice, total, errores, cambiar, mover, quitar }) {
  const k = `formulario.${indice}`
  const error = (atributo) => errores[`${k}.${atributo}`]
  const titulo = campo.etiqueta.trim()
  return (
    <fieldset className="campo-editor">
      <legend>Campo {indice + 1}{titulo ? ` · ${titulo}` : ''}</legend>
      {errores[k] && <Alerta>{errores[k]}</Alerta>}
      <div className="campo-editor-rejilla">
        <Etiquetado etiqueta="Etiqueta" error={error('etiqueta')} requerido>
          {(p) => <input className="entrada" {...p} value={campo.etiqueta} maxLength={ETIQUETA_MAX} onChange={(e) => cambiar(indice, { etiqueta: e.target.value })} />}
        </Etiquetado>
        <Etiquetado etiqueta="Id" ayuda={campo.idManual ? 'El nombre interno del dato (minúsculas, números y guion bajo).' : 'Se genera de la etiqueta; puedes editarlo.'} error={error('id')} requerido>
          {(p) => <input className="entrada" {...p} value={campo.id} maxLength={40} autoCapitalize="none" spellCheck="false" onChange={(e) => cambiar(indice, { id: e.target.value, idManual: true })} />}
        </Etiquetado>
        <Etiquetado etiqueta="Tipo de campo" error={error('tipo')}>
          {(p) => (
            <select className="entrada" {...p} value={campo.tipo} onChange={(e) => cambiar(indice, { tipo: e.target.value })}>
              {TIPOS_CAMPO.map(([valor, nombre]) => <option key={valor} value={valor}>{nombre}</option>)}
            </select>
          )}
        </Etiquetado>
        {usaMaximo(campo.tipo) && (
          <Etiquetado etiqueta={campo.tipo === 'numero' ? 'Valor máximo' : 'Largo máximo (caracteres)'} error={error('max')} requerido>
            {(p) => <input className="entrada" {...p} value={campo.max} inputMode={campo.tipo === 'numero' ? 'decimal' : 'numeric'} onChange={(e) => cambiar(indice, { max: e.target.value })} />}
          </Etiquetado>
        )}
      </div>
      {campo.tipo === 'seleccion' && (
        <Etiquetado etiqueta="Opciones" ayuda="Una opción por línea." error={error('opciones')} requerido>
          {(p) => <textarea className="entrada" {...p} rows={4} value={campo.opciones} onChange={(e) => cambiar(indice, { opciones: e.target.value })} />}
        </Etiquetado>
      )}
      <Etiquetado etiqueta="Ayuda (opcional)" ayuda="Una línea que se muestra bajo la etiqueta." error={error('ayuda')}>
        {(p) => <input className="entrada" {...p} value={campo.ayuda} maxLength={AYUDA_MAX} onChange={(e) => cambiar(indice, { ayuda: e.target.value })} />}
      </Etiquetado>
      <div className="campo-editor-opciones">
        <label className="casilla"><input type="checkbox" checked={campo.obligatorio} onChange={(e) => cambiar(indice, { obligatorio: e.target.checked })} />Obligatorio</label>
        {campo.tipo === 'numero' && <label className="casilla"><input type="checkbox" checked={campo.entero} onChange={(e) => cambiar(indice, { entero: e.target.checked })} />Solo números enteros</label>}
      </div>
      <div className="acciones-fila">
        <button type="button" className="btn btn-sec btn-s" disabled={indice === 0} onClick={() => mover(indice, -1)} aria-label={`Subir el campo ${indice + 1}`}>Subir</button>
        <button type="button" className="btn btn-sec btn-s" disabled={indice === total - 1} onClick={() => mover(indice, 1)} aria-label={`Bajar el campo ${indice + 1}`}>Bajar</button>
        <button type="button" className="btn btn-sec btn-s" onClick={() => quitar(indice)} aria-label={`Quitar el campo ${indice + 1}`}>Quitar</button>
      </div>
    </fieldset>
  )
}

// La vista previa usa el MISMO componente de campos que el formulario real de «Iniciar un trámite»: lo que se ve aquí es lo que verá la persona
function VistaPrevia({ campos }) {
  const [valores, setValores] = useState({})
  const vista = useMemo(() => camposDeVista(campos), [campos])
  return (
    <section className="panel" aria-labelledby="vista-previa-titulo">
      <h3 id="vista-previa-titulo">Vista previa del formulario</h3>
      <p className="suave">Así lo verá quien inicie este trámite. Puedes probar los campos: lo que escribas aquí no se guarda ni se envía.</p>
      {vista.length === 0 ? <p className="nota">Todavía no hay campos. Agrega el primero para verlo aquí.</p> : (
        <form className="vista-previa" aria-label="Vista previa del formulario" onSubmit={(e) => e.preventDefault()} noValidate>
          <CamposFormulario campos={vista} valores={valores} cambiar={(id, v) => setValores((x) => ({ ...x, [id]: v }))} />
        </form>
      )}
    </section>
  )
}

/* ---------------------------------------------------------------- el editor */

function Editor({ institucion, tipo, alTerminar, alCancelar, ejecutar }) {
  const { avisar } = useUI()
  const [b, setB] = useState(() => (tipo ? borradorDesde(tipo) : borradorVacio()))
  const [errores, setErrores] = useState({})
  const [general, setGeneral] = useState('')
  const [trabajando, setTrabajando] = useState(false)

  const cambiarDatos = (parche, ...claves) => { setB((x) => ({ ...x, ...parche })); setErrores((e) => sinClave(e, ...claves)) }
  const cambiarCampo = (i, parche) => {
    setB((x) => ({
      ...x,
      campos: x.campos.map((c, j) => {
        if (j !== i) return c
        let nuevo = { ...c, ...parche }
        // El id sigue a la etiqueta mientras nadie lo haya tocado a mano
        if ('etiqueta' in parche && !c.idManual) nuevo.id = idDesde(parche.etiqueta, x.campos.filter((_, n) => n !== i).map((o) => o.id))
        // Al cambiar de tipo, el máximo arranca con el valor habitual del tipo nuevo (o se quita si no aplica)
        if ('tipo' in parche && parche.tipo !== c.tipo) nuevo = { ...nuevo, max: MAX_POR_DEFECTO[parche.tipo] ?? '', entero: parche.tipo === 'numero' ? c.entero : false }
        return nuevo
      }),
    }))
    setErrores((e) => sinClave(e, `formulario.${i}`, ...Object.keys(e).filter((k) => k.startsWith(`formulario.${i}.`)), 'formulario'))
  }
  // Agregar, quitar y reordenar cambian los números de campo: los errores anteriores ya no apuntan a lo mismo
  const reestructurar = (campos) => { setB((x) => ({ ...x, campos })); setErrores({}); setGeneral('') }
  const agregar = () => reestructurar([...b.campos, campoVacio(b.campos.map((c) => c.id))])
  const quitar = (i) => reestructurar(b.campos.filter((_, j) => j !== i))
  const mover = (i, delta) => {
    const campos = [...b.campos]
    ;[campos[i], campos[i + delta]] = [campos[i + delta], campos[i]]
    reestructurar(campos)
  }

  async function guardar(ev) {
    ev.preventDefault()
    setGeneral('')
    const locales = validarBorrador(b)
    setErrores(locales)
    if (Object.keys(locales).length) return
    const cuerpo = cuerpoDe(b)
    await ejecutar(async () => {
      setTrabajando(true)
      try {
        if (tipo) await api(`/catalogo/institucion/${institucion.id}/tipos/${tipo.id}/`, { metodo: 'PATCH', cuerpo })
        else await api(`/catalogo/institucion/${institucion.id}/tipos/`, { metodo: 'POST', cuerpo })
        avisar(tipo ? `Guardaste los cambios de «${cuerpo.nombre}».` : `«${cuerpo.nombre}» se agregó al catálogo.`)
        await alTerminar()
      } catch (e) {
        if (e instanceof ApiError && e.pideReautenticar) throw e
        const r = erroresDelServidor(e)
        setErrores(r.errores)
        setGeneral(r.general)
      } finally {
        setTrabajando(false)
      }
    })
  }

  const hayErrores = Object.keys(errores).length > 0 || general
  return (
    <>
      <section className="panel" aria-labelledby="editor-titulo">
        <div className="panel-cabecera">
          <h3 id="editor-titulo">{tipo ? `Editar «${tipo.nombre}»` : 'Nuevo trámite'}</h3>
          <span className="suave">{institucion.nombre}</span>
        </div>
        <form onSubmit={guardar} noValidate aria-label={tipo ? 'Editar el trámite' : 'Nuevo trámite'}>
          {hayErrores && <ResumenErrores campos={[]} errores={Object.fromEntries(resumenDeErrores(errores).map((linea, i) => [i, linea]))} general={general} />}
          <div className="campo-editor-rejilla">
            <Etiquetado etiqueta="Nombre del trámite" error={errores.nombre} requerido>
              {(p) => <input className="entrada" {...p} value={b.nombre} maxLength={NOMBRE_MAX} onChange={(e) => cambiarDatos({ nombre: e.target.value }, 'nombre')} autoFocus />}
            </Etiquetado>
            <Etiquetado etiqueta="Plazo (días hábiles)" ayuda={`De ${SLA_MIN} a ${SLA_MAX}. Cuenta lunes a viernes sin feriados.`} error={errores.sla_dias} requerido>
              {(p) => <input className="entrada" {...p} value={b.sla_dias} inputMode="numeric" onChange={(e) => cambiarDatos({ sla_dias: e.target.value }, 'sla_dias')} />}
            </Etiquetado>
            <Etiquetado etiqueta="Para quién es" ayuda="Quién puede iniciar este trámite." error={errores.audiencia}>
              {(p) => (
                <select className="entrada" {...p} value={b.audiencia} onChange={(e) => cambiarDatos({ audiencia: e.target.value }, 'audiencia')}>
                  {AUDIENCIAS.map(([valor, nombre]) => <option key={valor} value={valor}>{nombre}</option>)}
                </select>
              )}
            </Etiquetado>
          </div>
          <fieldset className="editor-campos">
            <legend>Datos que pide el trámite</legend>
            {errores.formulario && <Alerta>{errores.formulario}</Alerta>}
            {b.campos.length === 0 && <p className="nota">Este trámite no pide datos. Agrega los campos que necesites.</p>}
            {b.campos.map((c, i) => (
              <TarjetaCampo key={c.clave} campo={c} indice={i} total={b.campos.length} errores={errores} cambiar={cambiarCampo} mover={mover} quitar={quitar} />
            ))}
            <button type="button" className="btn btn-sec" onClick={agregar} disabled={b.campos.length >= MAX_CAMPOS}><Icono nombre="mas" />Agregar campo</button>
            {b.campos.length >= MAX_CAMPOS && <small className="suave"> Un trámite admite hasta {MAX_CAMPOS} campos.</small>}
          </fieldset>
          <div className="fila-botones">
            <button type="button" className="btn btn-sec" onClick={alCancelar}>Cancelar</button>
            <button type="submit" className="btn" disabled={trabajando}>{trabajando ? 'Guardando…' : tipo ? 'Guardar los cambios' : 'Crear el trámite'}</button>
          </div>
        </form>
      </section>
      <VistaPrevia campos={b.campos} />
    </>
  )
}

/* ---------------------------------------------------------------- la lista */

function ListaTipos({ tipos, alEditar, alCambiarActivo }) {
  if (tipos.length === 0) return <Vacio titulo="Todavía no hay trámites" texto="Cuando agregues el primero aparecerá aquí." />
  return (
    <div className="tabla-caja">
      <table className="tabla apilada">
        <caption className="solo-lector">Trámites de la institución</caption>
        <thead><tr><th scope="col">Trámite</th><th scope="col">Plazo</th><th scope="col">Para quién</th><th scope="col">Campos</th><th scope="col">Estado</th><th scope="col">Acciones</th></tr></thead>
        <tbody>
          {tipos.map((t) => (
            <tr key={t.id}>
              <th scope="row">{t.nombre}</th>
              <td data-etiqueta="Plazo">{plural(t.sla_dias, 'día hábil', 'días hábiles')}</td>
              <td data-etiqueta="Para quién">{NOMBRE_AUDIENCIA[t.audiencia] ?? t.audiencia}</td>
              <td data-etiqueta="Campos">{t.formulario.length}</td>
              <td data-etiqueta="Estado"><Insignia clase={t.activo ? 'e-aprobado' : 'e-pendiente'}>{t.activo ? 'Activo' : 'Desactivado'}</Insignia></td>
              <td data-etiqueta="Acciones">
                <div className="acciones-fila">
                  <button type="button" className="btn btn-sec" onClick={() => alEditar(t)} aria-label={`Editar ${t.nombre}`}>Editar</button>
                  <button type="button" className="btn btn-sec" onClick={() => alCambiarActivo(t)} aria-label={`${t.activo ? 'Desactivar' : 'Activar'} ${t.nombre}`}>{t.activo ? 'Desactivar' : 'Activar'}</button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* ---------------------------------------------------------------- el historial */

// Qué hizo un cambio, en lenguaje llano. Solo texto: nada de lo que viene del servidor se interpreta como HTML.
export function describirCambio(c) {
  const nombre = c.tipo_tramite?.nombre ?? 'el trámite'
  const antes = c.antes || {}
  const despues = c.despues || {}
  const campos = (f) => (Array.isArray(f) ? plural(f.length, 'campo', 'campos') : '—')
  if (c.accion === 'alta') {
    return [`Creó «${despues.nombre ?? nombre}»: ${plural(despues.sla_dias, 'día hábil', 'días hábiles')}, para ${(NOMBRE_AUDIENCIA[despues.audiencia] ?? despues.audiencia ?? '').toLowerCase()}, ${campos(despues.formulario)}.`]
  }
  if (c.accion === 'activado') return [`Activó «${nombre}»: vuelve a ofrecerse para trámites nuevos.`]
  if (c.accion === 'desactivado') return [`Desactivó «${nombre}»: ya no se ofrece para trámites nuevos.`]
  const lineas = []
  if ('nombre' in despues) lineas.push(`Cambió el nombre: «${antes.nombre}» → «${despues.nombre}».`)
  if ('sla_dias' in despues) lineas.push(`Cambió el plazo de «${nombre}»: ${antes.sla_dias} → ${despues.sla_dias} días hábiles.`)
  if ('audiencia' in despues) lineas.push(`Cambió para quién es «${nombre}»: ${NOMBRE_AUDIENCIA[antes.audiencia] ?? antes.audiencia} → ${NOMBRE_AUDIENCIA[despues.audiencia] ?? despues.audiencia}.`)
  if ('formulario' in despues) lineas.push(`Cambió el formulario de «${nombre}»: ${campos(antes.formulario)} → ${campos(despues.formulario)}.`)
  if ('activo' in despues) lineas.push(despues.activo ? `Activó «${nombre}».` : `Desactivó «${nombre}».`)
  return lineas.length ? lineas : [`Cambió «${nombre}».`]
}

function Historial({ institucion, ejecutar }) {
  const [pagina, setPagina] = useState(0)
  const [datos, setDatos] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let vigente = true
    setDatos(null)
    ejecutar(async () => {
      const d = await api(`/catalogo/institucion/${institucion.id}/cambios/?limite=${TAM_HISTORIAL}&desplazamiento=${pagina * TAM_HISTORIAL}`)
      if (vigente) { setDatos(d); setError('') }
    }).catch((e) => { if (vigente) { setError(mensajeDe(e)); setDatos({ resultados: [], total: 0 }) } })
    return () => { vigente = false }
  }, [institucion.id, pagina]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <section className="panel" aria-labelledby="historial-titulo">
      <h3 id="historial-titulo">Historial de cambios</h3>
      <p className="suave">Quién cambió qué en el catálogo de {institucion.nombre}, del más reciente al más antiguo. Este registro no se puede modificar ni borrar.</p>
      <Alerta>{error}</Alerta>
      {!datos ? <BloquesEsqueleto n={2} /> : datos.resultados.length === 0 ? <Vacio titulo="Sin cambios registrados" texto="Cuando alguien cree o cambie un trámite quedará aquí." /> : (
        <>
          <div className="tabla-caja">
            <table className="tabla apilada">
              <caption className="solo-lector">Cambios del catálogo</caption>
              <thead><tr><th scope="col">Cuándo</th><th scope="col">Quién</th><th scope="col">Qué cambió</th></tr></thead>
              <tbody>
                {datos.resultados.map((c) => (
                  <tr key={c.id}>
                    <td data-etiqueta="Cuándo" title={fecha(c.creado_en)}>{hace(c.creado_en)}</td>
                    <td data-etiqueta="Quién">{c.actor ? c.actor.usuario : 'Sistema'}</td>
                    <td data-etiqueta="Qué cambió"><ul className="lista-cambios">{describirCambio(c).map((linea, i) => <li key={i}>{linea}</li>)}</ul></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Paginacion total={datos.total} tamano={TAM_HISTORIAL} pagina={pagina} cambiar={setPagina} unidad="cambios" />
        </>
      )}
    </section>
  )
}

/* ---------------------------------------------------------------- el módulo */

export function CatalogoInstitucion({ yo }) {
  const coordinaciones = useMemo(() => {
    const vistas = new Set()
    return yo.membresias.filter((m) => m.rol === 'coordinador_institucional' && !vistas.has(m.institucion_id) && vistas.add(m.institucion_id))
  }, [yo])
  const [institucionId, setInstitucionId] = useState(coordinaciones[0]?.institucion_id ?? null)
  const institucion = coordinaciones.find((m) => m.institucion_id === institucionId)
  const [pestana, setPestana] = useState('tramites')
  const [editando, setEditando] = useState(null) // null: la lista; {tipo: null} un trámite nuevo; {tipo} uno existente
  const [tipos, setTipos] = useState(null)
  const [error, setError] = useState('')
  const { ejecutar, modal } = useReautenticacion()
  const { avisar, confirmar } = useUI()
  const ruta = `/catalogo/institucion/${institucionId}/tipos/`

  const recargar = useCallback(async () => { setTipos((await api(ruta)).tipos) }, [ruta])
  const cargar = useCallback(async () => {
    try {
      await ejecutar(async () => { await recargar(); setError('') })
    } catch (e) {
      setError(mensajeDe(e))
      setTipos((actual) => actual || [])
    }
  }, [recargar]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (institucionId !== null) { setTipos(null); setEditando(null); cargar() } }, [institucionId, cargar])

  async function cambiarActivo(t) {
    const desactivar = t.activo
    const si = await confirmar(desactivar ? {
      titulo: `Desactivar «${t.nombre}»`, peligro: true, etiqueta: 'Desactivar',
      texto: 'Dejará de ofrecerse para iniciar trámites nuevos, tanto en el catálogo como en «Iniciar un trámite». No se borra: los trámites que ya existen de este tipo siguen su curso hasta resolverse y podrás volver a activarlo. Quedará registrado quién lo hizo.',
    } : {
      titulo: `Activar «${t.nombre}»`, etiqueta: 'Activar',
      texto: `Volverá a ofrecerse para iniciar trámites nuevos (${(NOMBRE_AUDIENCIA[t.audiencia] ?? t.audiencia).toLowerCase()}). Quedará registrado quién lo hizo.`,
    })
    if (!si) return
    await ejecutar(async () => {
      setError('')
      try {
        await api(`${ruta}${t.id}/`, { metodo: 'PATCH', cuerpo: { activo: !desactivar } })
        avisar(desactivar ? `«${t.nombre}» ya no se ofrece para trámites nuevos.` : `«${t.nombre}» vuelve a ofrecerse.`)
        await recargar()
      } catch (e) {
        if (e instanceof ApiError && e.pideReautenticar) throw e
        setError(erroresDelServidor(e).general || Object.values(erroresDelServidor(e).errores).join(' '))
      }
    })
  }

  if (!institucion) {
    return (
      <>
        <div className="encabezado-vista"><div><h2>Catálogo de la institución</h2><p>Solo la coordinación de una institución gestiona su catálogo.</p></div></div>
        <Alerta tipo="info">Tu cuenta no coordina ninguna institución.</Alerta>
      </>
    )
  }

  return (
    <>
      <div className="encabezado-vista">
        <div>
          <h2>Catálogo de la institución</h2>
          <p>Los trámites que ofrece {institucion.institucion}: crea, edita, activa o desactiva, y consulta quién cambió qué. Nada se borra.</p>
        </div>
        {!editando && pestana === 'tramites' && tipos !== null && (
          <button type="button" className="btn" onClick={() => setEditando({ tipo: null })}><Icono nombre="mas" />Nuevo trámite</button>
        )}
      </div>
      {coordinaciones.length > 1 && (
        <label className="campo selector-institucion"><span>Institución</span>
          <select className="entrada" value={institucionId} onChange={(e) => setInstitucionId(Number(e.target.value))}>
            {coordinaciones.map((m) => <option key={m.institucion_id} value={m.institucion_id}>{m.institucion}</option>)}
          </select>
        </label>
      )}
      <Alerta>{error}</Alerta>
      {editando ? (
        <Editor
          key={editando.tipo?.id ?? 'nuevo'} institucion={{ id: institucionId, nombre: institucion.institucion }} tipo={editando.tipo} ejecutar={ejecutar}
          alCancelar={() => setEditando(null)} alTerminar={async () => { await recargar(); setEditando(null) }}
        />
      ) : (
        <>
          <div className="pestanas" role="tablist" aria-label="Secciones del catálogo">
            <button type="button" role="tab" aria-selected={pestana === 'tramites'} onClick={() => setPestana('tramites')}>Trámites</button>
            <button type="button" role="tab" aria-selected={pestana === 'historial'} onClick={() => setPestana('historial')}>Historial de cambios</button>
          </div>
          {pestana === 'historial'
            ? <Historial key={institucionId} institucion={{ id: institucionId, nombre: institucion.institucion }} ejecutar={ejecutar} />
            : tipos === null ? <BloquesEsqueleto n={3} /> : <ListaTipos tipos={tipos} alEditar={(t) => setEditando({ tipo: t })} alCambiarActivo={cambiarActivo} />}
        </>
      )}
      {modal}
    </>
  )
}
