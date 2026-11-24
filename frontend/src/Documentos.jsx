import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api.js'
import { fecha, mensajeDe } from './comun.jsx'
import { Alerta, Icono } from './ui.jsx'

// Lo mismo que valida el servidor (que es quien decide): aquí solo se avisa antes de subir
const TAMANO_MAXIMO = 5 * 1024 * 1024
const ACEPTA = '.pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg'
const TIPOS = { 'application/pdf': 'PDF', 'image/png': 'PNG', 'image/jpeg': 'JPEG' }

const tamano = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`)

// Documentos adjuntos de un trámite. La persona que lo pidió adjunta mientras no tenga resolución final; el personal de la
// institución los ve y los descarga. Los archivos viajan cifrados en disco y se descargan siempre como adjunto.
export function Documentos({ tramiteId, puedeAdjuntar, alAdjuntar = () => {} }) {
  const [lista, setLista] = useState(null)
  const [error, setError] = useState('')
  const [subiendo, setSubiendo] = useState(false)
  const [aviso, setAviso] = useState('')
  const entrada = useRef(null)

  const cargar = useCallback(() => api(`/tramites/${tramiteId}/documentos/`)
    .then((d) => { setLista(d.documentos); setError('') })
    .catch((e) => { setLista([]); setError(mensajeDe(e)) }), [tramiteId])
  useEffect(() => { cargar() }, [cargar])

  async function subir(e) {
    const archivo = e.target.files?.[0]
    e.target.value = ''
    if (!archivo) return
    setAviso(''); setError('')
    if (archivo.size > TAMANO_MAXIMO) { setError('El archivo supera los 5 MB.'); return }
    const formulario = new FormData()
    formulario.append('archivo', archivo)
    setSubiendo(true)
    try {
      await api(`/tramites/${tramiteId}/documentos/`, { metodo: 'POST', formulario })
      setAviso(`«${archivo.name}» se adjuntó al trámite.`)
      await cargar()
      alAdjuntar() // el historial del trámite muestra el documento nuevo
    } catch (err) {
      setError(mensajeDe(err))
    } finally {
      setSubiendo(false)
    }
  }

  async function descargar(d) {
    setError('')
    try {
      const blob = await api(`/tramites/${tramiteId}/documentos/${d.id}/`, { binario: true })
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

  return (
    <section className="panel documentos" aria-labelledby="titulo-documentos">
      <div className="panel-cabecera">
        <h3 id="titulo-documentos">Documentos</h3>
        {puedeAdjuntar && (
          <>
            <input ref={entrada} type="file" accept={ACEPTA} className="entrada-archivo" id="archivo-documento" aria-label="Elegir el documento a adjuntar" onChange={subir} disabled={subiendo} />
            <button className="btn btn-sec" onClick={() => entrada.current?.click()} disabled={subiendo}>
              <Icono nombre="mas" />{subiendo ? 'Subiendo…' : 'Adjuntar documento'}
            </button>
          </>
        )}
      </div>
      <Alerta>{error}</Alerta>
      {aviso && <Alerta tipo="ok">{aviso}</Alerta>}
      {lista === null ? <p className="suave">Cargando documentos…</p> : lista.length === 0 ? (
        <p className="suave">{puedeAdjuntar ? 'Todavía no adjuntaste documentos. Puedes subir PDF, PNG o JPEG de hasta 5 MB.' : 'Este trámite no tiene documentos adjuntos.'}</p>
      ) : (
        <ul className="lista-documentos">
          {lista.map((d) => (
            <li key={d.id}>
              <Icono nombre="documento" />
              <div>
                <strong>{d.nombre}</strong>
                <small>{TIPOS[d.tipo] || d.tipo} · {tamano(d.tamano)} · {fecha(d.creado_en)}</small>
              </div>
              <button className="btn btn-fantasma" onClick={() => descargar(d)} aria-label={`Descargar ${d.nombre}`}>Descargar</button>
            </li>
          ))}
        </ul>
      )}
      <p className="nota">Los documentos se guardan cifrados y no se pueden modificar ni borrar: quedan en el historial del trámite.</p>
    </section>
  )
}
