// Simulador (solo desarrollo y pruebas) de las consolas de plataforma. Imita el contrato de docs/api.md con estado en memoria:
// las reglas que importan aquí son las del servidor real (quien propone no aprueba, nadie actúa sobre sí mismo, motivo obligatorio).
const ROL_DE_ALTA = { operador_identidades: 'alta_coordinador', operador_catalogo: 'alta_institucion' }
const SECRETOS = {
  jwt: ['Clave de firma de los tokens (JWT)', 90, 'podman secret siget-jwt-key'],
  mfa: ['Clave de cifrado del segundo factor y de las cédulas', 180, 'podman secret siget-mfa-key'],
  db_app: ['Contraseña de la base para la aplicación (app_role)', 180, 'podman secret siget-db-app-password'],
  db_auditor: ['Contraseña de la base para auditoría (auditor_role)', 180, 'podman secret siget-db-auditor-password'],
  django: ['Clave secreta de Django', 365, 'podman secret siget-django-key'],
  cert_nginx: ['Certificado TLS de nginx', 365, 'podman secrets siget-nginx-crt y siget-nginx-key'],
  cert_postgres: ['Certificado TLS de PostgreSQL', 365, 'podman secrets siget-pg-tls-crt y siget-pg-tls-key'],
  ca: ['Autoridad certificadora interna', 1825, '/root/siget-ca (VM2) y secreto siget-ca'],
}
const DIA = 86400000

export function plataformaMock({ usuarios, actual, resp, negado, hace, mfaFresco = () => true }) {
  const personas = Object.entries(usuarios).map(([usuario, u]) => ({
    id: u.id, usuario, estado_cuenta: 'activa', rol_plataforma: u.plataforma, mfa_activo: true, sesiones_activas: 1, bloqueada_hasta: null,
  }))
  const aprobaciones = [
    { id: 1, accion: 'alta_institucion', objetivo: { nombre: 'Autoridad de Turismo', tipo: 'real' }, estado: 'pendiente', creado_en: hace(3600000), resuelto_en: null,
      propuesto_por: { id: 308, usuario: 'camilo.catalogo' }, resuelto_por: null },
    { id: 2, accion: 'alta_coordinador', objetivo: { usuario: 'flor.mop', institucion_id: 3 }, estado: 'pendiente', creado_en: hace(7200000), resuelto_en: null,
      propuesto_por: { id: 307, usuario: 'irene.identidades' }, resuelto_por: null },
  ]
  const rotaciones = {}
  const eventos = ['login_ok', 'mfa_verificado', 'login_fallido', 'refresh_ok', 'cuenta_bloqueada', 'logout'].map((evento, i) => ({
    id: 90 - i, creado_en: hace((i + 1) * 420000), evento, usuario: ['ana.ciudadana', 'fabio.mop', 'beto.ciudadano'][i % 3], ip: '192.168.100.10',
  }))
  let sigAprobacion = 3
  // Alertas del detector (migración 019). Datos de ejemplo: solo contadores y nombres, nunca contraseñas ni datos personales
  const idDe = (nombre) => usuarios[nombre]?.id ?? null
  const alertas = [
    { id: 6, regla: 'bloqueos_repetidos', severidad: 'alta', persona: { id: idDe('fabio.mop'), usuario: 'fabio.mop' }, ip: null, conteo: 2, primera_vez: hace(5 * 3600000), ultima_vez: hace(2 * 3600000),
      detalle: { ventana_minutos: 1440, umbral: 2, por_nombre: { cuenta_bloqueada: 2 } }, estado: 'abierta', revisada_por: null, revisada_en: null, nota: null },
    { id: 5, regla: 'denegaciones_persona', severidad: 'media', persona: { id: idDe('beto.ciudadano'), usuario: 'beto.ciudadano' }, ip: null, conteo: 7, primera_vez: hace(14 * 60000), ultima_vez: hace(9 * 60000),
      detalle: { ventana_minutos: 10, umbral: 5, por_nombre: { sin_regla_que_permita: 5, conflicto_de_interes: 2 } }, estado: 'abierta', revisada_por: null, revisada_en: null, nota: null },
    { id: 4, regla: 'reuso_token_refresco', severidad: 'alta', persona: { id: idDe('ana.ciudadana'), usuario: 'ana.ciudadana' }, ip: null, conteo: 1, primera_vez: hace(40 * 60000), ultima_vez: hace(40 * 60000),
      detalle: { ventana_minutos: 1440, umbral: 1, por_nombre: { refresh_reuso: 1 } }, estado: 'abierta', revisada_por: null, revisada_en: null, nota: null },
    { id: 3, regla: 'rafaga_login_fallido_ip', severidad: 'media', persona: null, ip: '198.51.100.23', conteo: 14, primera_vez: hace(3 * 3600000), ultima_vez: hace(3 * 3600000 - 480000),
      detalle: { ventana_minutos: 10, umbral: 10, por_nombre: { login_fallido: 11, cambio_contrasena_fallido: 3 } }, estado: 'abierta', revisada_por: null, revisada_en: null, nota: null },
    { id: 2, regla: 'rafaga_login_fallido_ip', severidad: 'media', persona: null, ip: '203.0.113.9', conteo: 12, primera_vez: hace(2 * DIA), ultima_vez: hace(2 * DIA - 420000),
      detalle: { ventana_minutos: 10, umbral: 10, por_nombre: { login_fallido: 12 } }, estado: 'revisada', revisada_por: { id: idDe('sergio.seguridad'), usuario: 'sergio.seguridad' }, revisada_en: hace(2 * DIA - 3600000),
      nota: 'Eran las pruebas de carga del equipo de calidad.' },
    { id: 1, regla: 'denegaciones_persona', severidad: 'media', persona: { id: idDe('fabio.mop'), usuario: 'fabio.mop' }, ip: null, conteo: 5, primera_vez: hace(5 * DIA), ultima_vez: hace(5 * DIA - 300000),
      detalle: { ventana_minutos: 10, umbral: 5, por_nombre: { sin_regla_que_permita: 5 } }, estado: 'descartada', revisada_por: { id: idDe('sergio.seguridad'), usuario: 'sergio.seguridad' }, revisada_en: hace(5 * DIA - 7200000),
      nota: 'Falso positivo: probaba un trámite de otra institución.' },
  ]
  const pideCodigo = () => resp(403, { codigo: 'acceso_denegado', detalle: 'No tienes autorización para esta operación.', reautenticacion_sugerida: true })
  const entero = (valor, defecto, minimo, maximo) => {
    if (valor === null) return defecto
    return /^\d+$/.test(valor) && Number(valor) >= minimo && Number(valor) <= maximo ? Number(valor) : null
  }


  const estadoSecreto = (ultima, frecuencia) => {
    if (!ultima) return { estado: 'sin_registro', dias_restantes: null }
    const restantes = Math.floor((new Date(ultima).getTime() + frecuencia * DIA - Date.now()) / DIA)
    return { estado: restantes < 0 ? 'vencida' : restantes < 30 ? 'por_vencer' : 'al_dia', dias_restantes: restantes }
  }

  const invitaciones = [
    { id: 2, nota: 'Prueba de usabilidad (grupo B)', emitida_por: 302, creado_en: hace(86400000), vence_en: new Date(Date.now() + 6 * 86400000).toISOString(), usada: false, estado: 'vigente' },
    { id: 1, nota: 'Entrevista con la Alcaldía', emitida_por: 302, creado_en: hace(5 * 86400000), vence_en: new Date(Date.now() + 2 * 86400000).toISOString(), usada: true, estado: 'usada' },
  ]

  return (camino, metodo, cuerpo, parametros) => {
    if (!camino.startsWith('/plataforma/')) return null
    const yo = usuarios[actual()]
    const rol = yo.plataforma
    const persona = (id) => personas.find((p) => p.id === Number(id))
    const tipoAlta = ROL_DE_ALTA[rol]

    if (camino === '/plataforma/personas/') {
      if (!['operador_identidades', 'operador_seguridad'].includes(rol)) return negado()
      const q = (parametros.get('q') || '').toLowerCase()
      return resp(200, { personas: personas.filter((p) => p.usuario.includes(q)) })
    }
    const accionPersona = camino.match(/^\/plataforma\/personas\/(\d+)\/([a-z-]+)\/$/)
    if (accionPersona && metodo === 'POST') {
      const [, id, que] = accionPersona
      const p = persona(id)
      const permitido = { 'restablecer-contrasena': 'operador_identidades', 'restablecer-mfa': 'operador_identidades', bloquear: 'operador_seguridad', desbloquear: 'operador_seguridad', 'revocar-sesiones': 'operador_seguridad' }[que]
      if (!p || rol !== permitido) return negado()
      if (p.id === yo.id) return resp(409, { codigo: 'no_a_si_mismo', detalle: 'No puedes hacer esto sobre tu propia cuenta.' })
      if (que === 'restablecer-contrasena') return resp(201, { codigo: 'restablecimiento_emitido', codigo_restablecimiento: 'K7MQ-2XWD-9PRT', vence_en: new Date(Date.now() + 900000).toISOString() })
      if (que === 'restablecer-mfa') { p.mfa_activo = false; p.sesiones_activas = 0; return resp(200, { codigo: 'mfa_restablecido' }) }
      if (que === 'bloquear') {
        if (!cuerpo.motivo || cuerpo.motivo.trim().length < 5) return resp(400, { codigo: 'datos_invalidos', errores: ['el motivo debe tener de 5 a 200 caracteres'] })
        p.estado_cuenta = 'bloqueada'; p.sesiones_activas = 0
        eventos.unshift({ id: Date.now(), creado_en: new Date().toISOString(), evento: 'cuenta_bloqueada_por_operador', usuario: actual(), ip: '192.168.100.10' })
        return resp(200, { codigo: 'cuenta_bloqueada' })
      }
      if (que === 'desbloquear') {
        if (p.estado_cuenta !== 'bloqueada') return resp(409, { codigo: 'no_corresponde', detalle: 'La cuenta no está en un estado en el que se pueda hacer esto.' })
        p.estado_cuenta = 'activa'; return resp(200, { codigo: 'cuenta_desbloqueada' })
      }
      const cuantas = p.sesiones_activas; p.sesiones_activas = 0
      return resp(200, { codigo: 'sesiones_revocadas', cuantas })
    }
    if (camino === '/plataforma/alertas/' && metodo === 'GET') {
      // Igual que el servidor: el operador de seguridad y el auditor las ven, con segundo factor reciente (el auditor, además, nivel 3)
      if (!['operador_seguridad', 'auditor'].includes(rol)) return negado()
      if (!mfaFresco()) return pideCodigo()
      const estado = parametros.get('estado') || ''
      const limite = entero(parametros.get('limite'), 20, 1, 100)
      const desplazamiento = entero(parametros.get('desplazamiento'), 0, 0, 1000000)
      if (limite === null || desplazamiento === null) return resp(400, { codigo: 'paginacion_invalida', detalle: 'limite (1 a 100) y desplazamiento deben ser enteros válidos.' })
      if (estado && !['abierta', 'revisada', 'descartada'].includes(estado)) return resp(400, { codigo: 'datos_invalidos', errores: ['el estado debe ser «abierta», «revisada» o «descartada»'] })
      const filtradas = alertas.filter((a) => !estado || a.estado === estado).sort((a, b) => new Date(b.ultima_vez) - new Date(a.ultima_vez) || b.id - a.id)
      return resp(200, { resultados: filtradas.slice(desplazamiento, desplazamiento + limite), total: filtradas.length, abiertas: alertas.filter((a) => a.estado === 'abierta').length, limite, desplazamiento })
    }
    const revisar = camino.match(/^\/plataforma\/alertas\/(\d+)\/revisar\/$/)
    if (revisar && metodo === 'POST') {
      if (rol !== 'operador_seguridad') return negado() // solo el operador de seguridad revisa; el auditor no
      if (!mfaFresco()) return pideCodigo()
      const a = alertas.find((x) => x.id === Number(revisar[1]))
      if (!a) return resp(404, { detalle: 'No encontrado.' })
      const nota = typeof cuerpo.nota === 'string' ? cuerpo.nota.trim() : ''
      const errores = []
      if (!['revisada', 'descartada'].includes(cuerpo.estado)) errores.push('el estado debe ser «revisada» o «descartada»')
      if (nota.length < 3 || nota.length > 1000) errores.push('la nota debe tener de 3 a 1000 caracteres')
      if (errores.length) return resp(400, { codigo: 'datos_invalidos', errores })
      if (a.estado !== 'abierta') return resp(409, { codigo: 'ya_revisada', detalle: 'Esta alerta ya fue revisada o descartada.' })
      Object.assign(a, { estado: cuerpo.estado, nota, revisada_por: { id: yo.id, usuario: actual() }, revisada_en: new Date().toISOString() })
      return resp(200, { codigo: `alerta_${cuerpo.estado}`, id: a.id, estado: a.estado })
    }
    if (camino === '/plataforma/eventos/') return rol === 'operador_seguridad' ? resp(200, { eventos }) : negado()
    if (camino === '/plataforma/invitaciones/') {
      if (rol !== 'operador_identidades') return negado()
      if (metodo === 'GET') return resp(200, { modo_registro: 'invitacion', invitaciones })
      const nueva = { id: invitaciones.length + 1, nota: String(cuerpo.nota || ''), emitida_por: yo.id, creado_en: new Date().toISOString(),
        vence_en: new Date(Date.now() + 7 * 86400000).toISOString(), usada: false, estado: 'vigente' }
      invitaciones.unshift(nueva)
      return resp(201, { codigo: 'invitacion_emitida', id: nueva.id, codigo_invitacion: 'K7MQ-2XWD-9PRT', vence_en: nueva.vence_en })
    }
    if (camino === '/plataforma/aprobaciones/') {
      if (!tipoAlta) return negado()
      if (metodo === 'GET') return resp(200, { accion: tipoAlta, aprobaciones: aprobaciones.filter((a) => a.accion === tipoAlta).sort((a, b) => b.id - a.id) })
      const objetivo = tipoAlta === 'alta_institucion' ? { nombre: (cuerpo.nombre || '').trim(), tipo: cuerpo.tipo } : { usuario: (cuerpo.usuario || '').trim().toLowerCase(), institucion_id: cuerpo.institucion_id }
      const errores = []
      if (tipoAlta === 'alta_institucion' && objetivo.nombre.length < 3) errores.push('el nombre de la institución debe tener de 3 a 80 caracteres (letras, números y signos simples)')
      if (tipoAlta === 'alta_coordinador' && !usuarios[objetivo.usuario]) errores.push('no existe esa persona')
      if (errores.length) return resp(400, { codigo: 'datos_invalidos', errores })
      const fila = { id: sigAprobacion++, accion: tipoAlta, objetivo, estado: 'pendiente', creado_en: new Date().toISOString(), resuelto_en: null, propuesto_por: { id: yo.id, usuario: actual() }, resuelto_por: null }
      aprobaciones.push(fila)
      return resp(201, { codigo: 'alta_propuesta', id: fila.id })
    }
    const resolver = camino.match(/^\/plataforma\/aprobaciones\/(\d+)\/resolver\/$/)
    if (resolver && metodo === 'POST') {
      const a = aprobaciones.find((x) => x.id === Number(resolver[1]))
      if (!a || a.accion !== tipoAlta || a.propuesto_por.id === yo.id) return negado() // quien propone no aprueba
      if (a.estado !== 'pendiente') return resp(409, { codigo: 'ya_resuelta', detalle: 'Esta propuesta ya fue resuelta.' })
      if (!['aprobar', 'rechazar'].includes(cuerpo.decision)) return resp(400, { codigo: 'datos_invalidos', errores: ['la decisión debe ser «aprobar» o «rechazar»'] })
      a.estado = cuerpo.decision === 'aprobar' ? 'aprobada' : 'rechazada'; a.resuelto_en = new Date().toISOString(); a.resuelto_por = { id: yo.id, usuario: actual() }
      return resp(200, { codigo: a.estado === 'aprobada' ? 'alta_aprobada' : 'alta_rechazada' })
    }
    if (camino === '/plataforma/secretos/') {
      if (rol !== 'custodio_secretos') return negado()
      if (metodo === 'POST') {
        if (!SECRETOS[cuerpo.secreto]) return resp(400, { codigo: 'datos_invalidos', errores: ['secreto desconocido'] })
        rotaciones[cuerpo.secreto] = { creado_en: new Date().toISOString(), nota: cuerpo.nota || '' }
        return resp(201, { codigo: 'rotacion_registrada', id: Date.now() })
      }
      return resp(200, { secretos: Object.entries(SECRETOS).map(([id, [nombre, frecuencia_dias, donde]]) => ({
        id, nombre, frecuencia_dias, donde, ultima_rotacion: rotaciones[id]?.creado_en || null, nota: rotaciones[id]?.nota || '', ...estadoSecreto(rotaciones[id]?.creado_en, frecuencia_dias),
      })) })
    }
    if (camino === '/plataforma/infraestructura/') {
      if (rol !== 'operador_infraestructura') return negado()
      return resp(200, {
        hora_servidor: new Date().toISOString(),
        base: { ok: true, latencia_ms: 1.4, tamano_mb: 8.9, version: '16.15', tls: 'TLSv1.3', conexiones: 3 },
        proceso: { python: '3.12.12', django: '5.2.18', activo_desde: hace(3600000), activo_minutos: 60 },
        configuracion: { inactividad_minutos: 10, mfa_ventana_minutos: 15, access_ttl_segundos: 600, refresh_ttl_segundos: 28800 },
        certificado: { vence: '2027-10-20', dias_restantes: 363 },
      })
    }
    return null
  }
}
