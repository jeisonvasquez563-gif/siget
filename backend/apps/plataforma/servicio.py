"""Lo que hacen las consolas de los operadores de plataforma. Ninguna lee ni devuelve datos de trámites.

El PDP ya decidió (en la vista) si la persona puede hacer cada cosa; aquí se valida el contenido, se aplica el efecto y se deja
constancia en los eventos de seguridad (inalterables). Los fallos esperados se devuelven en un `Resultado`, no se lanzan.
"""
import json
import re
import sys
from datetime import timedelta

import django
from django.conf import settings
from django.db import connection
from django.db.models import Count, OuterRef, Q, Subquery
from django.utils import timezone

from apps.autenticacion import servicio as auth
from apps.autenticacion.models import EventoSeguridad, Sesion
from apps.autenticacion.servicio import Resultado, registrar_evento
from apps.catalogo.models import Institucion
from apps.identidad.models import Aprobacion, Membresia, Usuario

from . import secretos
from .models import RotacionSecreto

TIPOS_INSTITUCION = ("real", "demostracion")
_NOMBRE_INSTITUCION = re.compile(r"^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9][A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9 .,'\-/()]{2,79}$")
VENTANA_CONFLICTO = timedelta(hours=24)
_ARRANQUE = timezone.now()


# --------------------------------------------------------------------------- validación (pura)

def validar_objetivo(accion, datos):
    """Devuelve (objetivo_normalizado, errores) para una propuesta de alta. Solo valida la forma; lo demás lo comprueba `proponer`."""
    datos = datos if isinstance(datos, dict) else {}
    errores = []
    if accion == "alta_institucion":
        nombre = datos.get("nombre").strip() if isinstance(datos.get("nombre"), str) else ""
        tipo = datos.get("tipo")
        if not _NOMBRE_INSTITUCION.match(nombre):
            errores.append("el nombre de la institución debe tener de 3 a 80 caracteres (letras, números y signos simples)")
        if tipo not in TIPOS_INSTITUCION:
            errores.append("el tipo debe ser «real» o «demostracion»")
        return ({"nombre": nombre, "tipo": tipo}, errores) if not errores else (None, errores)
    if accion == "alta_coordinador":
        usuario = datos.get("usuario").strip().lower() if isinstance(datos.get("usuario"), str) else ""
        inst = datos.get("institucion_id")
        if not usuario:
            errores.append("falta el usuario")
        if isinstance(inst, bool) or not isinstance(inst, int) or inst < 1:
            errores.append("falta la institución")
        return ({"usuario": usuario, "institucion_id": inst}, errores) if not errores else (None, errores)
    return None, ["acción no admitida"]


def serializar(objetivo) -> str:
    return json.dumps(objetivo, sort_keys=True, ensure_ascii=False)


def _leer(texto):
    try:
        valor = json.loads(texto)
        return valor if isinstance(valor, dict) else {}
    except ValueError:
        return {}


# --------------------------------------------------------------------------- personas

def personas(q="", limite=50):
    """Cuentas con lo mínimo que un operador necesita para actuar: nunca el hash, el secreto del segundo factor ni los datos personales."""
    ahora = timezone.now()
    activas = (Sesion.objects.filter(usuario=OuterRef("pk"), revocada=False, expira_en__gt=ahora)
               .values("usuario").annotate(n=Count("id")).values("n"))
    consulta = Usuario.objects.all().order_by("username")
    if q:
        consulta = consulta.filter(username__icontains=q)
    filas = consulta.annotate(n_sesiones=Subquery(activas))[:limite]
    return [{"id": u.pk, "usuario": u.username, "estado_cuenta": u.estado_cuenta, "rol_plataforma": u.rol_plataforma, "mfa_activo": u.mfa_activo,
             "sesiones_activas": u.n_sesiones or 0,
             "bloqueada_hasta": u.bloqueado_hasta if u.bloqueado_hasta and u.bloqueado_hasta > ahora else None} for u in filas]


def _hizo_hace_poco(operador, evento, objetivo, ahora):
    return EventoSeguridad.objects.filter(actor_id=operador.pk, evento=evento, creado_en__gte=ahora - VENTANA_CONFLICTO,
                                          detalle__objetivo=objetivo.pk).exists()


# --------------------------------------------------------------------------- identidades

def emitir_codigo(operador, objetivo, ip, ahora=None):
    """Código de restablecimiento de contraseña. Un mismo operador no puede además restablecer el segundo factor de esa cuenta
    (quien reúne las dos cosas podría adueñarse de ella): separación de funciones."""
    ahora = ahora or timezone.now()
    if _hizo_hace_poco(operador, "mfa_restablecido", objetivo, ahora):
        return Resultado(False, "conflicto_de_funciones")
    return auth.emitir_restablecimiento(operador, objetivo, ip, ahora)


def restablecer_mfa(operador, objetivo, ip, ahora=None):
    ahora = ahora or timezone.now()
    if objetivo.pk == operador.pk:
        return Resultado(False, "no_a_si_mismo")
    if not objetivo.mfa_activo:
        return Resultado(False, "sin_segundo_factor")
    if _hizo_hace_poco(operador, "restablecimiento_emitido", objetivo, ahora):
        return Resultado(False, "conflicto_de_funciones")
    Usuario.objects.filter(pk=objetivo.pk).update(mfa_secreto=None, mfa_activo=False, mfa_ultimo_paso=None, mfa_verificado_en=None)
    auth._revocar_todas(objetivo.pk)
    registrar_evento(operador.pk, "mfa_restablecido", ip, {"objetivo": objetivo.pk})
    return Resultado(True, "mfa_restablecido")


# --------------------------------------------------------------------------- aprobaciones (control dual)

def proponer(operador, accion, datos, ip):
    objetivo, errores = validar_objetivo(accion, datos)
    if errores:
        return Resultado(False, "datos_invalidos", detalle={"errores": errores})
    if accion == "alta_institucion":
        if Institucion.objects.filter(nombre__iexact=objetivo["nombre"]).exists():
            return Resultado(False, "datos_invalidos", detalle={"errores": ["ya existe una institución con ese nombre"]})
    else:
        persona = Usuario.objects.filter(username=objetivo["usuario"]).first()
        errores = []
        if persona is None:
            errores.append("no existe esa persona")
        elif persona.rol_plataforma != "ninguno":
            errores.append("una cuenta de plataforma no puede ser coordinadora de una institución")
        elif persona.estado_cuenta != "activa":
            errores.append("la cuenta no está activa")
        if not Institucion.objects.filter(pk=objetivo["institucion_id"]).exists():
            errores.append("la institución no existe")
        elif persona is not None and Membresia.objects.filter(usuario=persona, institucion_id=objetivo["institucion_id"], rol="coordinador_institucional").exists():
            errores.append("ya es coordinadora de esa institución")
        if errores:
            return Resultado(False, "datos_invalidos", detalle={"errores": errores})
    texto = serializar(objetivo)
    if Aprobacion.objects.filter(accion=accion, objetivo=texto, estado="pendiente").exists():
        return Resultado(False, "datos_invalidos", detalle={"errores": ["ya hay una propuesta pendiente igual"]})
    fila = Aprobacion.objects.create(accion=accion, objetivo=texto, propuesto_por=operador)
    registrar_evento(operador.pk, "alta_propuesta", ip, {"aprobacion": fila.pk, "accion": accion})
    return Resultado(True, "alta_propuesta", detalle={"id": fila.pk})


def aprobacion_a_dict(a):
    return {"id": a.pk, "accion": a.accion, "objetivo": _leer(a.objetivo), "estado": a.estado, "creado_en": a.creado_en, "resuelto_en": a.resuelto_en,
            "propuesto_por": {"id": a.propuesto_por_id, "usuario": a.propuesto_por.username},
            "resuelto_por": {"id": a.aprobado_por_id, "usuario": a.aprobado_por.username} if a.aprobado_por_id else None}


def listar_aprobaciones(accion):
    consulta = Aprobacion.objects.filter(accion=accion).select_related("propuesto_por", "aprobado_por").order_by("-id")[:100]
    return [aprobacion_a_dict(a) for a in consulta]


def resolver(operador, aprobacion, decision, ip, ahora=None):
    """Aprueba (y aplica el efecto) o rechaza. Quien propuso no puede resolver: lo impone el PDP y, otra vez, la base."""
    ahora = ahora or timezone.now()
    if aprobacion.estado != "pendiente":
        return Resultado(False, "ya_resuelta")
    if decision not in ("aprobar", "rechazar"):
        return Resultado(False, "datos_invalidos", detalle={"errores": ["la decisión debe ser «aprobar» o «rechazar»"]})
    if decision == "aprobar":
        r = _aplicar(operador, aprobacion)
        if not r.ok:
            return r
    Aprobacion.objects.filter(pk=aprobacion.pk).update(estado="aprobada" if decision == "aprobar" else "rechazada", aprobado_por=operador, resuelto_en=ahora)
    registrar_evento(operador.pk, "alta_aprobada" if decision == "aprobar" else "alta_rechazada", ip, {"aprobacion": aprobacion.pk, "accion": aprobacion.accion})
    return Resultado(True, "alta_aprobada" if decision == "aprobar" else "alta_rechazada")


def _aplicar(operador, aprobacion):
    objetivo = _leer(aprobacion.objetivo)
    if aprobacion.accion == "alta_institucion":
        if Institucion.objects.filter(nombre__iexact=objetivo.get("nombre", "")).exists():
            return Resultado(False, "datos_invalidos", detalle={"errores": ["esa institución ya existe"]})
        Institucion.objects.create(nombre=objetivo["nombre"], tipo=objetivo["tipo"])
        return Resultado(True, "ok")
    persona = Usuario.objects.filter(username=objetivo.get("usuario")).first()
    inst = Institucion.objects.filter(pk=objetivo.get("institucion_id")).first()
    if persona is None or inst is None or persona.rol_plataforma != "ninguno" or persona.estado_cuenta != "activa":
        return Resultado(False, "datos_invalidos", detalle={"errores": ["la persona o la institución ya no son válidas para este alta"]})
    Membresia.objects.get_or_create(usuario=persona, institucion=inst, rol="coordinador_institucional", defaults={"asignado_por": operador})
    return Resultado(True, "ok")


# --------------------------------------------------------------------------- seguridad

def cambiar_estado_cuenta(operador, objetivo, bloquear, motivo, ip):
    if objetivo.pk == operador.pk:
        return Resultado(False, "no_a_si_mismo")
    if bloquear:
        motivo = motivo.strip() if isinstance(motivo, str) else ""
        if not 5 <= len(motivo) <= 200:
            return Resultado(False, "datos_invalidos", detalle={"errores": ["el motivo debe tener de 5 a 200 caracteres"]})
        if objetivo.estado_cuenta != "activa":
            return Resultado(False, "no_corresponde")
        Usuario.objects.filter(pk=objetivo.pk).update(estado_cuenta="bloqueada")
        auth._revocar_todas(objetivo.pk)
        registrar_evento(operador.pk, "cuenta_bloqueada_por_operador", ip, {"objetivo": objetivo.pk, "motivo": motivo})
        return Resultado(True, "cuenta_bloqueada")
    if objetivo.estado_cuenta != "bloqueada":
        return Resultado(False, "no_corresponde")  # una cuenta suspendida no la reactiva este rol
    Usuario.objects.filter(pk=objetivo.pk).update(estado_cuenta="activa", intentos_fallidos=0, bloqueado_hasta=None)
    registrar_evento(operador.pk, "cuenta_desbloqueada_por_operador", ip, {"objetivo": objetivo.pk})
    return Resultado(True, "cuenta_desbloqueada")


def revocar_sesiones(operador, objetivo, ip):
    if objetivo.pk == operador.pk:
        return Resultado(False, "no_a_si_mismo")
    cuantas = Sesion.objects.filter(usuario_id=objetivo.pk, revocada=False).count()
    auth._revocar_todas(objetivo.pk)
    registrar_evento(operador.pk, "sesiones_revocadas_por_operador", ip, {"objetivo": objetivo.pk, "cuantas": cuantas})
    return Resultado(True, "sesiones_revocadas", detalle={"cuantas": cuantas})


def eventos_recientes(evento="", limite=100):
    consulta = EventoSeguridad.objects.select_related("actor").order_by("-id")
    if evento:
        consulta = consulta.filter(evento=evento)
    return [{"id": e.pk, "creado_en": e.creado_en, "evento": e.evento, "usuario": e.actor.username if e.actor_id else None, "ip": e.ip}
            for e in consulta[:limite]]


# --------------------------------------------------------------------------- secretos

def estado_secretos(ahora=None):
    ahora = ahora or timezone.now()
    ultimas = {}
    for fila in RotacionSecreto.objects.order_by("id"):
        ultimas[fila.secreto] = fila
    salida = []
    for identificador, (nombre, frecuencia, donde) in secretos.SECRETOS.items():
        ultima = ultimas.get(identificador)
        salida.append({"id": identificador, "nombre": nombre, "frecuencia_dias": frecuencia, "donde": donde,
                       "ultima_rotacion": ultima.creado_en if ultima else None, "nota": ultima.nota if ultima else "",
                       **secretos.estado(ultima.creado_en if ultima else None, frecuencia, ahora)})
    return salida


def registrar_rotacion(operador, identificador, nota, ip):
    if identificador not in secretos.SECRETOS:
        return Resultado(False, "datos_invalidos", detalle={"errores": ["secreto desconocido"]})
    nota = nota.strip() if isinstance(nota, str) else ""
    if len(nota) > 300:
        return Resultado(False, "datos_invalidos", detalle={"errores": ["la nota admite hasta 300 caracteres"]})
    fila = RotacionSecreto.objects.create(secreto=identificador, registrado_por=operador, nota=nota)
    registrar_evento(operador.pk, "rotacion_registrada", ip, {"secreto": identificador})
    return Resultado(True, "rotacion_registrada", detalle={"id": fila.pk})


# --------------------------------------------------------------------------- infraestructura (solo lectura)

def _consulta(sql):
    with connection.cursor() as c:
        c.execute(sql)
        return c.fetchone()


def salud():
    """Estado de la base y del proceso, desde lo que el propio backend puede ver. No toca contenedores ni lee datos de trámites."""
    ahora = timezone.now()
    base = {"ok": False}
    try:
        inicio = timezone.now()
        _consulta("select 1")
        base["latencia_ms"] = round((timezone.now() - inicio).total_seconds() * 1000, 1)
        base["tamano_mb"] = round(_consulta("select pg_database_size(current_database())")[0] / 1048576, 1)
        base["version"] = _consulta("show server_version")[0]
        ssl = _consulta("select ssl, version from pg_stat_ssl where pid = pg_backend_pid()")
        base["tls"] = ssl[1] if ssl and ssl[0] else None
        base["conexiones"] = _consulta("select count(*) from pg_stat_activity where datname = current_database()")[0]
        base["ok"] = True
    except Exception:  # noqa: BLE001 - un fallo de la base se informa, no se oculta ni se propaga
        base["error"] = "la base de datos no respondió"
    vence = settings.SIGET_CERT_NGINX_VENCE
    return {
        "hora_servidor": ahora,
        "base": base,
        "proceso": {"python": sys.version.split()[0], "django": django.get_version(), "activo_desde": _ARRANQUE,
                    "activo_minutos": int((ahora - _ARRANQUE).total_seconds() // 60)},
        "configuracion": {"inactividad_minutos": settings.SIGET_INACTIVIDAD_MINUTOS, "mfa_ventana_minutos": settings.SIGET_MFA_RECIENTE_MINUTOS,
                          "access_ttl_segundos": settings.SIGET_ACCESS_TTL_SEGUNDOS, "refresh_ttl_segundos": settings.SIGET_REFRESH_TTL_SEGUNDOS},
        "certificado": {"vence": vence, "dias_restantes": secretos.dias_hasta(vence, ahora.date())},
    }
