"""Derechos de la persona sobre sus datos personales (PT-15, Ley 81 de 2019): ver, corregir, exportar y pedir.

Reglas:
- Todo es sobre la PROPIA cuenta: nada de aquí recibe el identificador de otra persona.
- Se corrige solo correo, provincia y ciudad (la base solo da UPDATE sobre esas tres columnas); lo demás va por una solicitud.
- Los eventos de seguridad llevan los NOMBRES de los campos corregidos, nunca los valores (ni correo ni ciudad).
- Cancelar no borra nada: los trámites son expediente público con conservación obligatoria (ver `derechos.py`).
Los fallos esperados se devuelven en un `Resultado`, no se lanzan.
"""
from django.conf import settings
from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.auditoria.models import EventoAuditoria
from apps.identidad.models import Membresia, Perfil, SolicitudDerecho, Usuario
from apps.tramites.models import Tramite
from apps.tramites.serializacion import evento_a_dict, tramite_a_dict

from . import derechos, perfil as lib_perfil
from .models import EventoSeguridad
from .servicio import Resultado, registrar_evento

CAMPOS_EDITABLES = list(lib_perfil.CAMPOS_CORREGIBLES)
LIMITE_TRAMITES_EXPORTADOS = 1000
LIMITE_EVENTOS_EXPORTADOS = 500


def _iso(valor):
    return valor.isoformat() if valor is not None else None


# --------------------------------------------------------------------------- perfil

def perfil_a_dict(fila):
    """El perfil completo y descifrado: es SU dato, solo se devuelve a su titular."""
    cedula = lib_perfil.descifrar_cedula(settings.SIGET_MFA_KEY, fila.cedula_cifrada)
    return {"nombre": fila.nombre, "apellidos": fila.apellidos, "cedula": cedula, "fecha_nacimiento": fila.fecha_nacimiento.isoformat(),
            "provincia": fila.provincia, "ciudad": fila.ciudad, "correo": fila.correo, "creado_en": _iso(fila.creado_en),
            "actualizado_en": _iso(fila.actualizado_en)}


def constancia_del_aviso(fila):
    """Qué versión del aviso leyó la persona y cuándo; `None` en los perfiles anteriores a la migración 016."""
    if fila is None or fila.aviso_version is None:
        return None
    return {"version": fila.aviso_version, "leido_en": _iso(fila.aviso_leido_en), "vigente": fila.aviso_version == derechos.AVISO_VERSION}


def cuenta_a_dict(usuario):
    membresias = list(Membresia.objects.filter(usuario=usuario).values("institucion__nombre", "rol"))
    return {"id": usuario.pk, "usuario": usuario.username, "estado_cuenta": usuario.estado_cuenta, "rol_plataforma": usuario.rol_plataforma,
            "mfa_activo": usuario.mfa_activo, "nivel_aseguramiento": usuario.nivel_aseguramiento, "creada_en": _iso(usuario.creado_en),
            "membresias": [{"institucion": m["institucion__nombre"], "rol": m["rol"]} for m in membresias]}


def corregir_datos(usuario, campos, ip) -> Resultado:
    """Aplica la corrección (campos ya validados con los mismos validadores del registro). Devuelve los NOMBRES de lo que cambió."""
    fila = Perfil.objects.filter(pk=usuario.pk).first()
    if fila is None:
        return Resultado(False, "sin_perfil")
    cambios = {nombre: valor for nombre, valor in campos.items() if (fila.correo.lower() if nombre == "correo" else getattr(fila, nombre)) != valor}
    if not cambios:
        return Resultado(True, "sin_cambios", detalle={"campos": []})
    try:
        # Savepoint: si el correo ya es de otra cuenta, la base lo rechaza (índice único) y se responde sin revelar de quién es
        with transaction.atomic():
            Perfil.objects.filter(pk=usuario.pk).update(**cambios)  # nunca save(): solo estas columnas tienen UPDATE
            registrar_evento(usuario.pk, "datos_personales_corregidos", ip, {"campos": sorted(cambios)})
    except IntegrityError:
        return Resultado(False, "usuario_existente")
    return Resultado(True, "datos_corregidos", detalle={"campos": sorted(cambios)})


# --------------------------------------------------------------------------- solicitudes

def solicitud_a_dict(s, ahora):
    """Lo que ve la persona de su solicitud (no quién la respondió: es un dato del personal de la plataforma)."""
    return {"id": s.pk, "tipo": s.tipo, "detalle": s.detalle, "estado": s.estado, "creada_en": _iso(s.creada_en), "vence_en": _iso(s.vence_en),
            "vencida": derechos.esta_vencida(s.estado, s.vence_en, ahora), "respondida_en": _iso(s.respondida_en), "respuesta": s.respuesta}


def solicitudes_de(usuario, ahora=None):
    ahora = ahora or timezone.now()
    return [solicitud_a_dict(s, ahora) for s in SolicitudDerecho.objects.filter(usuario=usuario).order_by("-id")[:100]]


def crear_solicitud(usuario, tipo, detalle, ip, ahora=None) -> Resultado:
    ahora = ahora or timezone.now()
    with transaction.atomic():
        Usuario.objects.select_for_update().get(pk=usuario.pk)  # serializa a quien manda varias a la vez: el tope no se esquiva
        abiertas = SolicitudDerecho.objects.filter(usuario=usuario, estado="recibida").count()
        if abiertas >= derechos.MAX_SOLICITUDES_ABIERTAS:
            return Resultado(False, "demasiadas_abiertas", detalle={"abiertas": abiertas, "maximo": derechos.MAX_SOLICITUDES_ABIERTAS})
        fila = SolicitudDerecho.objects.create(usuario=usuario, tipo=tipo, detalle=detalle, vence_en=derechos.vence_en(ahora))
        registrar_evento(usuario.pk, "solicitud_derecho_creada", ip, {"solicitud": fila.pk, "tipo": tipo})  # sin el detalle: puede tener datos personales
    return Resultado(True, "solicitud_creada", detalle={"solicitud": solicitud_a_dict(fila, ahora)})


# --------------------------------------------------------------------------- tramites y exportación

def contar_tramites(usuario) -> int:
    """Los trámites que la persona inició. Requiere el contexto de seguridad por filas ya fijado (ver `fijar_contexto`)."""
    return Tramite.objects.filter(solicitante_id=usuario.pk).count()


def exportar(usuario, con_tramites, ahora=None) -> dict:
    """Portabilidad: todo lo propio en un solo documento. Los trámites son los que la persona ya puede ver por la API (los suyos, con su
    historial) y solo si el PDP se lo permite; el contexto de seguridad por filas debe estar fijado SIN instituciones."""
    ahora = ahora or timezone.now()
    fila = Perfil.objects.filter(pk=usuario.pk).first()
    tramites = []
    if con_tramites:
        filas = list(Tramite.objects.select_related("tipo_tramite", "institucion").filter(solicitante_id=usuario.pk)
                     .order_by("-creado_en", "-id")[:LIMITE_TRAMITES_EXPORTADOS])
        eventos = {}
        for e in EventoAuditoria.objects.filter(tramite_id__in=[t.pk for t in filas]).order_by("id"):
            eventos.setdefault(e.tramite_id, []).append(evento_a_dict(e, False))
        tramites = [{**tramite_a_dict(t, False, ahora), "historial": eventos.get(t.pk, [])} for t in filas]
    actividad = EventoSeguridad.objects.filter(actor_id=usuario.pk).order_by("-id").values("evento", "creado_en", "ip")[:LIMITE_EVENTOS_EXPORTADOS]
    return {
        "formato": "siget-mis-datos/1", "generado_en": _iso(ahora),
        "aviso_privacidad": constancia_del_aviso(fila),
        "cuenta": cuenta_a_dict(usuario),
        "perfil": perfil_a_dict(fila) if fila is not None else None,
        "tramites": tramites,
        "solicitudes": solicitudes_de(usuario, ahora),
        "actividad_de_seguridad": [{"evento": a["evento"], "creado_en": _iso(a["creado_en"]), "ip": a["ip"]} for a in actividad],
    }
