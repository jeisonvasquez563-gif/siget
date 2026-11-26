import { useEffect, useState } from 'react'
import { api } from './api.js'
import { Alerta, BloquesEsqueleto, Logo } from './ui.jsx'

// Aviso de privacidad (Ley 81 de 2019). Es público: se lee desde la dirección #/privacidad, con o sin sesión, y lo trae el
// servidor (la interfaz no escribe el texto: así lo que se lee es siempre lo que está vigente y lo que se guarda al registrarse).

const DERECHOS = {
  acceso: 'Acceso', rectificacion: 'Rectificación', cancelacion: 'Cancelación', oposicion: 'Oposición', portabilidad: 'Portabilidad',
}

export function Privacidad() {
  const [aviso, setAviso] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    api('/auth/aviso-privacidad/', { conToken: false }).then(setAviso).catch(() => setError('No se pudo cargar el aviso de privacidad. Revisa tu conexión e inténtalo de nuevo.'))
  }, [])

  // El aviso se abre en una pestaña nueva desde el registro, o dentro de la sesión desde «Mis datos»: en ambos casos se vuelve a lo anterior
  const volver = () => { window.location.hash = '' }

  return (
    <main className="privacidad" id="contenido">
      <header className="privacidad-cabecera">
        <div className="marca"><Logo /><div><strong>SIGET</strong><small>Sistema de Gestión y Trazabilidad</small></div></div>
        <button type="button" className="btn btn-sec" onClick={volver}>Volver</button>
      </header>
      <article className="privacidad-cuerpo" aria-labelledby="titulo-privacidad">
        <Alerta>{error}</Alerta>
        {!aviso && !error && <BloquesEsqueleto n={2} />}
        {aviso && (
          <>
            <h1 id="titulo-privacidad">{aviso.titulo}</h1>
            <p className="suave">Versión {aviso.version} · vigente desde {aviso.vigente_desde} · {aviso.base_legal}</p>
            {aviso.secciones.slice(0, 4).map((s) => <section key={s.titulo}><h2>{s.titulo}</h2><p>{s.texto}</p></section>)}
            <section>
              <h2>Qué datos pedimos y para qué</h2>
              <dl className="datos-finalidad">
                {aviso.datos.map((d) => <div key={d.dato}><dt>{d.dato}</dt><dd>{d.para_que}</dd></div>)}
              </dl>
            </section>
            {aviso.secciones.slice(4).map((s) => <section key={s.titulo}><h2>{s.titulo}</h2><p>{s.texto}</p></section>)}
            <section>
              <h2>Resumen de tus derechos</h2>
              <ul className="chips">{aviso.derechos.map((d) => <li key={d}>{DERECHOS[d] || d}</li>)}</ul>
              <p className="nota">Respondemos en no más de {aviso.plazo_respuesta_dias_habiles} días hábiles y no cuesta nada. Si ya tienes cuenta, entra a «Mis datos» para ejercerlos.</p>
            </section>
          </>
        )}
      </article>
    </main>
  )
}
