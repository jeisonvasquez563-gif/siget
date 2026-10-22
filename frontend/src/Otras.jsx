import { useEffect, useState } from 'react'
import { api, ApiError } from './api.js'
import { Estado, FINALES, Plazo, ROLES_INSTITUCION, ROLES_PLATAFORMA, etiquetaDeRol, hace, mensajeDe } from './comun.jsx'
import { iconoDe } from './modulos.js'
import { Alerta, Avatar, Esqueleto, Icono, Insignia, Vacio } from './ui.jsx'
import { esMio } from './Tramites.jsx'

function saludoDeLaHora() {
  const h = new Date().getHours()
  return h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches'
}

/* ---------------------------------------------------------------- inicio */

export function Inicio({ yo, ir, abrir }) {
  const veTramites = yo.modulos.some((m) => ['mis_tramites', 'bandeja'].includes(m.id))
  const [filas, setFilas] = useState(veTramites ? null : [])
  useEffect(() => {
    if (veTramites) api('/tramites/?limite=100').then((d) => setFilas(d.resultados)).catch(() => setFilas([]))
  }, [veTramites])

  const mios = (filas || []).filter((t) => esMio(t, yo))
  const bandeja = (filas || []).filter((t) => !esMio(t, yo) && !FINALES.includes(t.estado))
  const aten = []
  mios.filter((t) => t.estado === 'En Subsanacion').forEach((t) => aten.push({ t, motivo: 'Te pidieron corregir o completar información' }))
  mios.filter((t) => t.vencido && t.estado !== 'En Subsanacion').forEach((t) => aten.push({ t, motivo: 'El plazo ya venció' }))
  bandeja.filter((t) => t.vencido).forEach((t) => aten.push({ t, motivo: 'Vencido en tu institución' }))
  bandeja.filter((t) => !t.vencido && !t.funcionario_asignado_id).slice(0, 4).forEach((t) => aten.push({ t, motivo: 'Nadie lo está atendiendo' }))

  return (
    <>
      <div className="encabezado-vista">
        <div className="saludo">
          <Avatar nombre={yo.usuario} />
          <div>
            <h2>{saludoDeLaHora()}, {yo.usuario}</h2>
            <p><Insignia clase="insignia-rol" punto={false}>{etiquetaDeRol(yo)}</Insignia></p>
          </div>
        </div>
      </div>

      {veTramites && (
        <section className="panel">
          <div className="panel-cabecera"><h3>Requiere tu atención</h3></div>
          {filas === null ? <Esqueleto filas={2} /> : aten.length === 0 ? (
            <p className="suave">Todo al día: no tienes trámites que requieran una acción ahora mismo.</p>
          ) : (
            <ul className="atencion-lista">
              {aten.slice(0, 6).map(({ t, motivo }) => (
                <li key={`${t.id}-${motivo}`}>
                  <div className="texto">
                    <button className="enlace" onClick={() => abrir(t.id)}>#{t.id} · {t.tipo_tramite.nombre}</button>
                    <small>{motivo} · {t.institucion.nombre}</small>
                  </div>
                  <Estado valor={t.estado} />
                  <Plazo tramite={t} />
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <div className="panel-cabecera"><h3>Tus módulos</h3></div>
      <div className="modulos">
        {yo.modulos.map((m) => (
          <button key={m.id} className={`modulo ${m.estado === 'proximamente' ? 'pronto' : ''}`} onClick={() => ir(m.id)}>
            <span className="icono-modulo"><Icono nombre={iconoDe(m.id)} /></span>
            <h3>{m.nombre}</h3>
            <p>{m.descripcion}</p>
            {m.estado === 'proximamente' && <Insignia punto={false}>Próximamente</Insignia>}
          </button>
        ))}
      </div>
      <p className="nota">Solo ves los módulos que tu rol tiene asignados. Lo demás no aparece, y aunque lo intentaras, el servidor lo negaría.</p>
    </>
  )
}

/* ---------------------------------------------------------------- equipo */

/* ---------------------------------------------------------------- mi seguridad */

const PERMISOS = {
  ciudadano: {
    puede: ['Iniciar trámites del catálogo', 'Ver el estado y el historial de tus trámites', 'Saber si tu trámite está en cola o en atención'],
    no: ['Ver trámites de otras personas (para ti no existen: responde 404)', 'Cambiar el estado de un trámite', 'Saber qué funcionario lo atiende'],
  },
  funcionario: {
    puede: ['Ver los trámites de tu institución', 'Pasar a la siguiente etapa los que están en cola o asignados a ti (con segundo factor reciente)'],
    no: ['Ver trámites de otra institución', 'Gestionar un trámite que tú mismo pediste (conflicto de interés)', 'Reasignar trámites'],
  },
  supervisor: {
    puede: ['Todo lo del funcionario, sobre cualquier trámite de tu institución', 'Reasignar trámites y atender los escalados', 'Ver el equipo de tu institución'],
    no: ['Tocar trámites de otra institución', 'Gestionar un trámite que tú mismo pediste'],
  },
  coordinador_institucional: {
    puede: ['Ver el equipo y los roles de tu institución (con segundo factor reciente)'],
    no: ['Ver o mover trámites: gestionar personas no da acceso a los datos de la ciudadanía', 'Asignarte un rol a ti mismo (lo impone la base de datos)'],
  },
  plataforma: {
    puede: ['Operar únicamente tu área', 'Participar en altas sensibles, siempre con una segunda persona (control dual)'],
    no: ['Ver ningún trámite ni dato de la ciudadanía', 'Ser a la vez operador y miembro de una institución', 'Hacerlo todo: no existe un superusuario'],
  },
  auditor: {
    puede: ['Leer el registro inalterable de decisiones y eventos', 'Ver quién hizo qué, cuándo y con qué política'],
    no: ['Escribir, alterar o borrar cualquier registro (la base de datos se lo niega)', 'Ver trámites ni datos personales', 'Escapar de la auditoría: sus consultas también quedan registradas'],
  },
}

function perfiles(yo) {
  if (yo.rol_plataforma === 'auditor') return ['auditor']
  if (yo.rol_plataforma !== 'ninguno') return ['plataforma']
  const roles = new Set(yo.membresias.map((m) => m.rol))
  const salida = ['ciudadano']
  ;['funcionario', 'supervisor', 'coordinador_institucional'].forEach((r) => roles.has(r) && salida.push(r))
  return salida
}

const VENTANA_POR_DEFECTO = 15 // solo si el servidor no la informa
const CIRCUNFERENCIA = 2 * Math.PI * 38

export function VentanaMfa({ verificadoEn, ventana = VENTANA_POR_DEFECTO }) {
  const minutos = verificadoEn ? Math.max(0, (Date.now() - new Date(verificadoEn)) / 60000) : Infinity
  const restante = Math.max(0, ventana - minutos)
  const vigente = restante > 0
  return (
    <div className="ventana">
      <svg viewBox="0 0 92 92" role="img" aria-label={vigente ? `Segundo factor vigente: quedan ${Math.ceil(restante)} minutos` : 'Segundo factor vencido'}>
        <circle className="anillo-fondo" cx="46" cy="46" r="38" />
        <circle className={`anillo ${vigente ? '' : 'vencida'}`} cx="46" cy="46" r="38" strokeDasharray={CIRCUNFERENCIA} strokeDashoffset={CIRCUNFERENCIA * (1 - restante / ventana)} />
        <text className="cifra" x="46" y="48">{vigente ? Math.ceil(restante) : '0'}</text>
        <text className="cifra-sub" x="46" y="62">min</text>
      </svg>
      <div>
        <strong>{vigente ? 'Segundo factor vigente' : 'Segundo factor vencido'}</strong>
        <p>{vigente ? `Las acciones que cambian trámites exigen una verificación de los últimos ${ventana} minutos.` : 'Para cambiar un trámite te pediremos un código nuevo.'}</p>
      </div>
    </div>
  )
}

export function Seguridad({ yo }) {
  return (
    <>
      <div className="encabezado-vista"><div><h2>Mi seguridad</h2><p>Quién eres para el sistema y qué te permite Zero Trust: nunca confiar, siempre verificar.</p></div></div>
      <div className="rejilla-seguridad">
        <div>
          <div className="credencial">
            <span className="id-mono">Credencial SIGET · cuenta {String(yo.id).padStart(4, '0')}</span>
            <div className="quien">
              <Avatar nombre={yo.usuario} />
              <div><h3>{yo.usuario}</h3><span className="rol">{etiquetaDeRol(yo)}</span></div>
            </div>
            <dl>
              <dt>Plataforma</dt><dd>{ROLES_PLATAFORMA[yo.rol_plataforma] || yo.rol_plataforma}</dd>
              <dt>Instituciones</dt><dd>{yo.membresias.length ? yo.membresias.map((m) => `${m.institucion} (${ROLES_INSTITUCION[m.rol]})`).join(', ') : 'Ninguna'}</dd>
              <dt>Segundo factor</dt><dd>{yo.mfa_activo ? 'Activo (TOTP)' : 'No activo'}</dd>
              <dt>Verificado</dt><dd>{yo.mfa_verificado_en ? `${hace(yo.mfa_verificado_en)}` : '—'}</dd>
              <dt>Aseguramiento</dt><dd>Nivel {yo.nivel_aseguramiento}</dd>
            </dl>
          </div>
          <section className="panel">
            <h3>Ventana del segundo factor</h3>
            <VentanaMfa verificadoEn={yo.mfa_verificado_en} />
            <p className="nota">Tu sesión dura 8 horas. El token de acceso vive 10 minutos y se renueva solo; el de renovación es de un solo uso y va en una cookie que JavaScript no puede leer.</p>
          </section>
        </div>
        <section className="panel permisos">
          <h3>Lo que tu rol puede y no puede</h3>
          {perfiles(yo).map((p) => (
            <div key={p}>
              <h4>{p === 'plataforma' || p === 'auditor' ? ROLES_PLATAFORMA[yo.rol_plataforma] : ROLES_INSTITUCION[p]}</h4>
              <ul className="puede">{PERMISOS[p].puede.map((t) => <li key={t}><Icono nombre="check" />{t}</li>)}</ul>
              <ul className="no-puede">{PERMISOS[p].no.map((t) => <li key={t}><Icono nombre="x" />{t}</li>)}</ul>
            </div>
          ))}
        </section>
      </div>
    </>
  )
}

/* ---------------------------------------------------------------- acceso a trámites (rol de plataforma) */

export function PruebaAcceso({ yo }) {
  const [resultado, setResultado] = useState(null)
  async function probar() {
    setResultado('probando')
    try {
      await api('/tramites/?limite=1')
      setResultado({ estado: 200, cuerpo: { detalle: 'Acceso permitido' } })
    } catch (e) {
      setResultado({ estado: e instanceof ApiError ? e.estado : 0, cuerpo: e instanceof ApiError ? e.datos : { detalle: mensajeDe(e) } })
    }
  }
  const negado = resultado && resultado !== 'probando' && resultado.estado === 403
  return (
    <>
      <div className="encabezado-vista"><div><h2>Acceso a trámites</h2><p>Un rol de plataforma opera la infraestructura, no los trámites de las personas.</p></div></div>
      <div className="prueba">
        <section className="panel">
          <h3>La prueba</h3>
          <p>Pulsa el botón: la plataforma intentará listar trámites como <strong>{ROLES_PLATAFORMA[yo.rol_plataforma]}</strong>.</p>
          <p className="suave">El punto de decisión de acceso (PDP) consulta la política, niega y deja la decisión registrada, sin importar qué muestre la interfaz.</p>
          <button className="btn" onClick={probar} disabled={resultado === 'probando'}>{resultado === 'probando' ? 'Probando…' : 'Intentar ver los trámites'}</button>
        </section>
        <section className="panel">
          <h3>Lo que respondió el servidor</h3>
          {!resultado || resultado === 'probando' ? <p className="suave">Aquí aparecerá la respuesta real de la API.</p> : (
            <>
              <Alerta tipo={negado ? 'ok' : 'error'}>{negado ? 'Acceso negado, como debe ser.' : 'Esto no debería pasar: revisa las políticas.'}</Alerta>
              <div className="respuesta-http">
                <div className="dim">GET /tramites/?limite=1</div>
                <div className={negado ? 'no' : 'ok'}>← {resultado.estado} {negado ? 'Forbidden' : ''}</div>
                <div>{JSON.stringify(resultado.cuerpo, null, 2).split('\n').map((l, i) => <div key={i}>{l}</div>)}</div>
              </div>
            </>
          )}
        </section>
      </div>
    </>
  )
}

/* ---------------------------------------------------------------- próximamente */

export function Proximamente({ modulo }) {
  return (
    <>
      <div className="encabezado-vista"><div><h2>{modulo.nombre}</h2><p>{modulo.descripcion}</p></div></div>
      <div className="pronto-detalle">
        <Vacio titulo="Este módulo se construye en la siguiente fase"
          texto="Forma parte del diseño de roles y permisos: cada operador de plataforma tiene su propia área, sin un superusuario. La separación de poderes ya está aplicada en la base de datos." />
      </div>
    </>
  )
}
