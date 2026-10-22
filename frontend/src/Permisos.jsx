import { useEffect, useMemo, useState } from 'react'
import { api } from './api.js'
import { Alerta, BloquesEsqueleto, Icono, Insignia } from './ui.jsx'
import { mensajeDe } from './comun.jsx'

const CORTO = {
  ciudadano: 'Ciudadanía', funcionario: 'Funcionario', supervisor: 'Supervisor', coordinador_institucional: 'Coordinación',
  operador_infraestructura: 'Infraestruc.', operador_identidades: 'Identidades', operador_catalogo: 'Catálogo',
  operador_seguridad: 'Seguridad', custodio_secretos: 'Secretos', auditor: 'Auditor',
}
const AMBITO = { propio: 'Lo propio', institucion: 'Su institución', plataforma: 'Plataforma' }

const EXPLICACION = {
  ciudadano_crea_su_tramite: 'La ciudadanía inicia trámites únicamente a su propio nombre.',
  ciudadano_sobre_lo_propio: 'Solo ve y adjunta documentos de sus propios trámites.',
  personal_ve_su_institucion: 'El personal ve los trámites y documentos de su institución.',
  funcionario_cambia_estado: 'Cambia el estado de lo que está en cola o asignado a él, con un segundo factor reciente.',
  supervisor_cambia_estado: 'El supervisor cambia el estado de cualquier trámite de su institución, con segundo factor reciente.',
  supervisor_reasigna_o_atiende_escalados: 'Reasigna y atiende escalados de su institución, con segundo factor reciente.',
  coordinador_gestiona_su_institucion: 'Gestiona al equipo y los trámites del catálogo de su institución, con segundo factor reciente.',
  auditor_consulta: 'El auditor (nivel de aseguramiento 3) consulta el registro con segundo factor reciente.',
}

// Rol «de la matriz» que corresponde a quien está mirando, para resaltar su columna
export function rolDeMatriz(yo) {
  if (yo.rol_plataforma !== 'ninguno') return yo.rol_plataforma
  const roles = yo.membresias.map((m) => m.rol)
  return ['supervisor', 'coordinador_institucional', 'funcionario'].find((r) => roles.includes(r)) || 'ciudadano'
}

const PESTANAS = [['roles', 'Roles y módulos'], ['matriz', 'Matriz de permisos'], ['bd', 'Base de datos'], ['capas', 'Cómo se decide']]

export function RolesPermisos({ yo }) {
  const [pestana, setPestana] = useState('roles')
  const [matriz, setMatriz] = useState(null)
  const [bd, setBd] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api('/politicas/matriz/').then(setMatriz).catch((e) => setError(mensajeDe(e)))
    api('/politicas/base-de-datos/').then(setBd).catch((e) => setError(mensajeDe(e)))
  }, [])

  return (
    <>
      <div className="encabezado-vista">
        <div>
          <h2>Roles y permisos</h2>
          <p>Quién puede qué en SIGET. No es un documento: la matriz sale de evaluar el motor de decisiones real, y la tabla de la base de datos se lee de PostgreSQL en este instante.</p>
        </div>
      </div>
      <Alerta>{error}</Alerta>
      <div className="pestanas" role="tablist" aria-label="Secciones">
        {PESTANAS.map(([k, n]) => <button key={k} role="tab" aria-selected={pestana === k} onClick={() => setPestana(k)}>{n}</button>)}
      </div>
      {pestana === 'roles' && (matriz ? <Roles datos={matriz} yo={yo} irAMatriz={() => setPestana('matriz')} /> : <BloquesEsqueleto n={3} />)}
      {pestana === 'matriz' && (matriz ? <Matriz datos={matriz} yo={yo} /> : <BloquesEsqueleto n={3} />)}
      {pestana === 'bd' && (bd ? <BaseDeDatos datos={bd} /> : <BloquesEsqueleto n={3} />)}
      {pestana === 'capas' && <Capas denegaciones={matriz?.denegaciones || []} />}
    </>
  )
}

/* ---------------------------------------------------------------- roles y módulos */

function Roles({ datos, yo, irAMatriz }) {
  const mio = rolDeMatriz(yo)
  const maximo = Math.max(...datos.roles.map((r) => r.acciones_permitidas))
  const total = datos.roles[0].acciones_totales
  return (
    <>
      <div className={`aviso-zt ${datos.ningun_rol_puede_todo ? '' : 'roto'}`} role="status">
        <Icono nombre="escudo" />
        <div>
          {datos.ningun_rol_puede_todo
            ? <><strong>No existe un superusuario.</strong> Ningún rol puede las {total} acciones del sistema: el que más puede llega a {maximo}. Cada poder está repartido y separado.</>
            : <><strong>Atención:</strong> algún rol puede todas las acciones. Revisa las políticas.</>}
          <button className="enlace-sutil" onClick={irAMatriz}>Ver la matriz completa</button>
        </div>
      </div>
      <div className="rejilla-roles">
        {datos.roles.map((r) => (
          <article key={r.id} className={`rol-tarjeta ${r.id === mio ? 'tuyo' : ''}`} aria-label={r.nombre}>
            <header>
              <h3>{r.nombre}</h3>
              <span className="insignia sin-punto insignia-rol">{AMBITO[r.ambito]}</span>
              {r.id === mio && <Insignia clase="insignia-boya" punto={false}>Tu rol</Insignia>}
            </header>
            <p className="suave">{r.descripcion}</p>
            <div className="medidor">
              <progress max={total} value={r.acciones_permitidas} aria-label={`Acciones permitidas: ${r.acciones_permitidas} de ${total}`} />
              <span>{r.acciones_permitidas} de {total} acciones</span>
            </div>
            <h4>Módulos que ve</h4>
            <ul className="chips">
              {r.modulos.map((m) => <li key={m.id} className={m.estado === 'proximamente' ? 'pronto' : ''}>{m.nombre}{m.estado === 'proximamente' ? ' · pronto' : ''}</li>)}
            </ul>
          </article>
        ))}
      </div>
    </>
  )
}

/* ---------------------------------------------------------------- matriz */

function Matriz({ datos, yo }) {
  const mio = rolDeMatriz(yo)
  const [caso, setCaso] = useState('favorable')
  const [sel, setSel] = useState(null)
  const grupos = useMemo(() => {
    const salida = []
    for (const a of datos.acciones) {
      let g = salida.find((x) => x.titulo === a.grupo)
      if (!g) { g = { titulo: a.grupo, acciones: [] }; salida.push(g) }
      g.acciones.push(a)
    }
    return salida
  }, [datos])
  const explicacionDe = (politica) => EXPLICACION[politica]
    || datos.denegaciones.find((d) => d.politica === politica)?.descripcion
    || (politica.startsWith('operador_') || politica.startsWith('custodio_') ? 'El rol de plataforma está autorizado para esta acción de su área, con segundo factor reciente.' : '')

  const detalle = sel && (() => {
    const rol = datos.roles.find((r) => r.id === sel.rol)
    const accion = datos.acciones.find((a) => a.id === sel.accion)
    const fila = datos.matriz[sel.rol][sel.accion]
    const decision = fila[caso]
    return { rol, accion, decision, exige: fila.exige_segundo_factor && caso === 'favorable' }
  })()

  return (
    <>
      <div className="barra-herramientas">
        <div className="segmentos" role="group" aria-label="Caso">
          <button aria-pressed={caso === 'favorable'} onClick={() => setCaso('favorable')}>En su propio ámbito</button>
          <button aria-pressed={caso === 'desfavorable'} onClick={() => setCaso('desfavorable')}>Fuera de su ámbito</button>
        </div>
        <ul className="leyenda-matriz" aria-label="Leyenda">
          <li><span className="celda-ejemplo ok"><Icono nombre="check" /></span>Permitido</li>
          <li><span className="celda-ejemplo no"><Icono nombre="x" /></span>Negado</li>
          <li><span className="celda-ejemplo ok"><Icono nombre="check" /><Icono nombre="llave" className="mini" /></span>Exige segundo factor reciente</li>
        </ul>
      </div>
      <div className="tabla-caja">
        <table className="tabla matriz">
          <caption className="solo-lector">Matriz de permisos: filas son acciones, columnas son roles</caption>
          <thead>
            <tr>
              <th scope="col">Acción</th>
              {datos.roles.map((r) => <th key={r.id} scope="col" className={r.id === mio ? 'col-tuya' : ''} title={r.nombre}>{CORTO[r.id]}{r.id === mio && <span className="tu">tú</span>}</th>)}
            </tr>
          </thead>
          <tbody>
            {grupos.map((g) => [
              <tr key={g.titulo} className="grupo"><th colSpan={datos.roles.length + 1} scope="colgroup">{g.titulo}</th></tr>,
              ...g.acciones.map((a) => (
                <tr key={a.id}>
                  <th scope="row">{a.nombre}{a.casos && <small>{caso === 'favorable' ? a.casos[0] : a.casos[1]}</small>}</th>
                  {datos.roles.map((r) => {
                    const f = datos.matriz[r.id][a.id]
                    const d = f[caso]
                    const exige = d.permitido && caso === 'favorable' && f.exige_segundo_factor
                    const activa = sel && sel.rol === r.id && sel.accion === a.id
                    return (
                      <td key={r.id} className={r.id === mio ? 'col-tuya' : ''}>
                        <button
                          className={`celda ${d.permitido ? 'ok' : 'no'} ${activa ? 'activa' : ''}`}
                          aria-pressed={activa}
                          aria-label={`${r.nombre} · ${a.nombre}: ${d.permitido ? 'permitido' : 'negado'}${exige ? ', exige segundo factor reciente' : ''}. Política ${d.politica}`}
                          onClick={() => setSel({ rol: r.id, accion: a.id })}
                        >
                          <Icono nombre={d.permitido ? 'check' : 'x'} />
                          {exige && <Icono nombre="llave" className="mini" />}
                        </button>
                      </td>
                    )
                  })}
                </tr>
              )),
            ])}
          </tbody>
        </table>
      </div>
      <section className="panel detalle-decision" aria-live="polite">
        {detalle ? (
          <>
            <div className="panel-cabecera">
              <h3>{detalle.rol.nombre} · {detalle.accion.nombre}</h3>
              <Insignia clase={detalle.decision.permitido ? 'e-aprobado' : 'e-rechazado'}>{detalle.decision.permitido ? 'Permitido' : 'Negado'}</Insignia>
            </div>
            <dl className="datos">
              <dt>Caso</dt><dd>{detalle.accion.casos ? detalle.accion.casos[caso === 'favorable' ? 0 : 1] : 'Sin variantes'}</dd>
              <dt>Política que decidió</dt><dd><code>{detalle.decision.politica}</code></dd>
              <dt>Segundo factor</dt><dd>{detalle.exige ? 'Exige un código verificado en los últimos 15 minutos' : 'No lo exige'}</dd>
            </dl>
            <p className="suave">{explicacionDe(detalle.decision.politica) || 'Ninguna política permite esta acción: se niega por defecto.'}</p>
          </>
        ) : <p className="suave">Elige una celda de la matriz para ver qué política decidió y por qué.</p>}
      </section>
    </>
  )
}

/* ---------------------------------------------------------------- base de datos */

const LETRAS = { SELECT: 'S', INSERT: 'I', UPDATE: 'U', DELETE: 'D' }
const NOMBRES_PRIV = { SELECT: 'leer', INSERT: 'insertar', UPDATE: 'modificar', DELETE: 'borrar' }

function BaseDeDatos({ datos }) {
  const [rol, setRol] = useState('app_role')
  const actual = datos.roles.find((r) => r.nombre === rol)
  return (
    <>
      <div className={`aviso-zt ${datos.ningun_rol_de_aplicacion_es_superusuario ? '' : 'roto'}`} role="status">
        <Icono nombre="candado" />
        <div>
          {datos.ningun_rol_de_aplicacion_es_superusuario
            ? <><strong>Ningún rol de la aplicación es superusuario</strong> ni puede saltarse la seguridad por filas. {datos.administrador_del_motor.nota}</>
            : <><strong>Atención:</strong> algún rol de la aplicación es superusuario o omite la seguridad por filas.</>}
        </div>
      </div>
      <div className="segmentos grande" role="group" aria-label="Rol de la base de datos">
        {datos.roles.map((r) => <button key={r.nombre} aria-pressed={rol === r.nombre} onClick={() => setRol(r.nombre)}><span className="mono">{r.nombre}</span></button>)}
      </div>
      <section className="panel">
        <div className="panel-cabecera"><h3 className="mono">{actual.nombre}</h3></div>
        <p className="suave">{actual.descripcion}</p>
        <ul className="atributos">
          <li className={actual.superusuario ? 'mal' : 'bien'}>Superusuario: <strong>{actual.superusuario ? 'sí' : 'no'}</strong></li>
          <li className={actual.omite_rls ? 'mal' : 'bien'}>Omite la seguridad por filas: <strong>{actual.omite_rls ? 'sí' : 'no'}</strong></li>
          <li>Puede iniciar sesión: <strong>{actual.puede_conectar ? 'sí' : 'no'}</strong></li>
          <li>Conexiones simultáneas: <strong>{actual.limite_conexiones > 0 ? actual.limite_conexiones : 'sin límite'}</strong></li>
          <li className={actual.crea_roles || actual.crea_bases ? 'mal' : 'bien'}>Crea roles o bases: <strong>{actual.crea_roles || actual.crea_bases ? 'sí' : 'no'}</strong></li>
        </ul>
        {rol === 'siget_owner' && <Alerta tipo="info">El dueño tiene todos los privilegios sobre sus tablas por serlo, pero no puede iniciar sesión, y los disparadores de solo inserción rechazan el UPDATE y el DELETE del registro incluso para él.</Alerta>}
        <div className="tabla-caja">
          <table className="tabla">
            <caption className="solo-lector">Privilegios de {actual.nombre} por tabla</caption>
            <thead><tr><th scope="col">Tabla</th>{Object.keys(LETRAS).map((p) => <th key={p} scope="col" title={NOMBRES_PRIV[p]}>{LETRAS[p]}</th>)}<th scope="col">Filas protegidas (RLS)</th><th scope="col">Disparadores</th></tr></thead>
            <tbody>
              {datos.tablas.map((t) => (
                <tr key={t.nombre}>
                  <th scope="row" className="mono">{t.nombre}</th>
                  {Object.keys(LETRAS).map((p) => {
                    const v = datos.privilegios[rol][t.nombre][p]
                    return <td key={p}><span className={`priv priv-${v}`} title={`${NOMBRES_PRIV[p]}: ${v === 'total' ? 'sí' : v === 'columnas' ? 'solo algunas columnas' : 'no'}`}>{v === 'total' ? 'sí' : v === 'columnas' ? 'cols.' : '—'}</span></td>
                  })}
                  <td>{t.rls ? <Insignia clase="e-aprobado" punto={false}>{t.politicas} políticas</Insignia> : <span className="tenue">—</span>}</td>
                  <td>{t.triggers > 0 ? <Insignia punto={false}>{t.triggers}</Insignia> : <span className="tenue">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="nota"><strong>S</strong> leer · <strong>I</strong> insertar · <strong>U</strong> modificar · <strong>D</strong> borrar. «cols.» significa que solo puede tocar algunas columnas (por ejemplo, la aplicación no puede cambiar el rol de plataforma de una persona).</p>
      </section>
    </>
  )
}

/* ---------------------------------------------------------------- capas */

const CAPAS = [
  ['candado', 'nginx y TLS 1.3', 'Única puerta de entrada. Solo pasan las rutas de la API; todo lo demás recibe 404. Cabeceras de seguridad y límites de tasa.', 'Sin esto, el tráfico viajaría en claro o llegaría a servicios internos.'],
  ['llave', 'Autenticación', 'Token de acceso de 10 minutos, sesión vigente, cuenta activa y segundo factor. Cada petición se revalida: no hay confianza heredada.', 'Un token robado deja de servir en minutos y un refresco reutilizado revoca la sesión.'],
  ['escudo', 'Punto de decisión de acceso (ABAC)', 'Decide con atributos de la persona, del recurso y del entorno. Niega por defecto y registra cada decisión, también las negadas.', 'Si una política falla o no existe, el resultado es negar.'],
  ['tablero', 'Seguridad por filas (RLS)', 'PostgreSQL filtra qué filas ve cada persona e institución, sin depender de que el código esté bien.', 'Aunque el backend tuviera un error, la base no entrega filas ajenas.'],
  ['auditoria', 'Disparadores y registro inalterable', 'La base valida las transiciones de estado y escribe el historial en la misma transacción. Nadie lo altera ni lo borra.', 'No se puede cambiar un estado sin dejar rastro ni saltarse un paso.'],
]

function Capas({ denegaciones }) {
  return (
    <>
      <p className="suave">Cada petición atraviesa cinco capas. Ninguna confía en la anterior: es defensa en profundidad.</p>
      <ol className="capas">
        {CAPAS.map(([icono, titulo, texto, falla], i) => (
          <li key={titulo}>
            <span className="capa-num" aria-hidden="true">{i + 1}</span>
            <div className="capa-cuerpo">
              <h3><Icono nombre={icono} />{titulo}</h3>
              <p>{texto}</p>
              <p className="si-falla"><strong>Si esta capa fallara:</strong> {falla}</p>
            </div>
          </li>
        ))}
      </ol>
      {denegaciones.length > 0 && (
        <section className="panel">
          <h3>Reglas que anulan todo lo demás</h3>
          <p className="suave">Se evalúan primero. Si una niega, ninguna otra política puede permitir.</p>
          <ul className="lista-simple">
            {denegaciones.map((d) => <li key={d.politica}><code>{d.politica}</code><span>{d.descripcion}</span></li>)}
          </ul>
        </section>
      )}
    </>
  )
}
