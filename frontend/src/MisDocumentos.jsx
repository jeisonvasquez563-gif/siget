import { useCallback, useEffect, useState } from 'react'
import { api } from './api.js'
import { Paginacion, TAM_PAGINA, fecha, mensajeDe } from './comun.jsx'
import { Alerta, BloquesEsqueleto, Icono, Vacio } from './ui.jsx'

const TIPOS = { 'application/pdf': 'PDF', 'image/png': 'PNG', 'image/jpeg': 'JPEG' }
const tamano = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`)

// «Mis documentos»: todo lo que la persona adjuntó en sus trámites, en una sola lista. Solo lectura: se adjunta desde cada trámite. El servidor
// devuelve únicamente lo propio (la base filtra por filas y la API vuelve a filtrar); la descarga usa la ruta de cada trámite, que verifica la
// integridad del archivo y lo entrega siempre como adjunto.
export function MisDocumentos({ abrir }) {
  const [escrito, setEscrito] = useState('')
  const [q, setQ] = useState('')
  const [pagina, setPagina] = useState(0)
  const [datos, setDatos] = useState(null)
  const [error, setError] = useState('')

  const cargar = useCallback(async () => {
    const consulta = new URLSearchParams({ limite: String(TAM_PAGINA), desplazamiento: String(pagina * TAM_PAGINA) })
    if (q) consulta.set('q', q)
    try {
      const d = await api(`/tramites/mis-documentos/?${consulta}`)
      setDatos(d)
      setError('')
    } catch (e) {
      setDatos((actual) => actual || { resultados: [], total: 0 })
      setError(mensajeDe(e))
    }
  }, [q, pagina])
  useEffect(() => { cargar() }, [cargar])

  function buscar(e) {
    e.preventDefault()
    setPagina(0)
    setQ(escrito.trim())
  }
  function limpiar() {
    setEscrito('')
    setQ('')
    setPagina(0)
  }

  async function descargar(d) {
    setError('')
    try {
      const blob = await api(`/tramites/${d.tramite.id}/documentos/${d.id}/`, { binario: true })
      const url = URL.createObjectURL(blob)
      const enlace = document.createElement('a')
      enlace.href = url
      enlace.download = d.nombre
      document.body.appendChild(enlace)
      enlace.click()
      enlace.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (err) {
      setError(mensajeDe(err))
    }
  }

  const sinDocumentos = datos && datos.total === 0 && !q
  return (
    <>
      <div className="encabezado-vista">
        <div><h2>Mis documentos</h2><p>Todos los documentos que adjuntaste en tus trámites. Para adjuntar uno nuevo, abre el trámite correspondiente.</p></div>
      </div>
      <Alerta>{error}</Alerta>
      {datos === null ? <BloquesEsqueleto n={2} /> : sinDocumentos ? (
        <Vacio titulo="Todavía no adjuntaste ningún documento" texto="Cuando adjuntes un documento a uno de tus trámites, lo vas a encontrar aquí para descargarlo." />
      ) : (
        <>
          <form className="barra-herramientas barra-busqueda-documentos" role="search" aria-label="Buscar en mis documentos" onSubmit={buscar}>
            <label className="campo"><span>Buscar por nombre del documento o por trámite</span>
              <input className="entrada" type="search" value={escrito} onChange={(e) => setEscrito(e.target.value)} maxLength={100} placeholder="Nombre, número o tipo de trámite" />
            </label>
            <button className="btn" type="submit"><Icono nombre="buscar" />Buscar</button>
            {q && <button className="btn btn-sec" type="button" onClick={limpiar}>Quitar la búsqueda</button>}
          </form>
          <p className="nota" role="status" aria-live="polite">
            {datos.total === 0 ? '' : q ? `${datos.total} ${datos.total === 1 ? 'documento coincide' : 'documentos coinciden'} con «${q}».` : `${datos.total} ${datos.total === 1 ? 'documento' : 'documentos'} en total.`}
          </p>
          {datos.total === 0 ? <Vacio titulo="Nada coincide con tu búsqueda" texto="Prueba con parte del nombre del documento, con el número del trámite o con su tipo." /> : (
            <>
              <div className="tabla-caja">
                <table className="tabla">
                  <caption className="solo-lector">Documentos que adjuntaste</caption>
                  <thead><tr><th scope="col">Documento</th><th scope="col">Trámite</th><th scope="col">Adjuntado</th><th scope="col"><span className="solo-lector">Acciones</span></th></tr></thead>
                  <tbody>
                    {datos.resultados.map((d) => (
                      <tr key={d.id}>
                        <td className="titulo-fila">{d.nombre}<small>{TIPOS[d.tipo] || d.tipo} · {tamano(d.tamano)}</small></td>
                        <td className="titulo-fila">
                          <button type="button" className="enlace-tramite" onClick={() => abrir(d.tramite.id)} aria-label={`Trámite #${d.tramite.id}: ${d.tramite.tipo_tramite}`}>Trámite #{d.tramite.id}</button>
                          <small>{d.tramite.tipo_tramite} · {d.tramite.institucion}</small>
                        </td>
                        <td>{fecha(d.creado_en)}</td>
                        <td><button type="button" className="btn btn-sec btn-s" onClick={() => descargar(d)} aria-label={`Descargar ${d.nombre}`}>Descargar</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Paginacion total={datos.total} pagina={pagina} cambiar={setPagina} unidad="documentos" />
            </>
          )}
        </>
      )}
    </>
  )
}
