"""Clases de permiso de DRF y la función `autorizar`, que usan las vistas para consultar al PDP."""
import logging
from datetime import timedelta

from django.conf import settings
from django.utils import timezone
from rest_framework.permissions import BasePermission

from apps.autorizacion.pdp import Entorno, decidir
from apps.nucleo.errores import AccesoDenegado

registro = logging.getLogger("siget.pdp")


class DenegarPorDefecto(BasePermission):
    """Permiso por defecto de toda la API: niega. Una vista debe declarar explícitamente cómo se autoriza."""

    message = "Acceso denegado: ninguna política lo permite."

    def has_permission(self, request, view):
        return False


def _membresias(usuario):
    """Las membresías de la persona, memorizadas durante la petición (varias consultas al PDP no repiten la consulta)."""
    from apps.identidad.models import Membresia

    memoria = getattr(usuario, "_membresias_memorizadas", None)
    if memoria is None:
        memoria = list(Membresia.objects.filter(usuario=usuario))
        usuario._membresias_memorizadas = memoria
    return memoria


def _registrar_decision(actor_id, accion, recurso, decision):
    """Guarda la decisión por una conexión aparte, en autocommit: una decisión negada hace que DRF revierta la
    transacción de la petición y, sin esto, se perdería justo el registro más importante."""
    from apps.auditoria.models import DecisionPdp

    DecisionPdp(
        actor_id=actor_id, accion=accion.value, recurso=recurso.tipo, permitido=decision.permitido, politica=decision.politica,
        atributos={"motivo": decision.motivo, "institucion_id": recurso.institucion_id},
    ).save(using="decisiones")


def evaluar(usuario, accion, recurso):
    """Decide y REGISTRA la decisión. Si no se puede decidir o registrar, devuelve una denegación: no debe haber
    ninguna acción permitida sin su evidencia."""
    from apps.autorizacion.pdp import Decision
    from apps.identidad.sujeto import construir_sujeto

    try:
        sujeto = construir_sujeto(usuario, _membresias(usuario))
        entorno = Entorno(ahora=timezone.now(), mfa_reciente_minutos=settings.SIGET_MFA_RECIENTE_MINUTOS,
                          mfa_ciudadano_obligatorio=settings.SIGET_MFA_CIUDADANO_OBLIGATORIO)
        decision = decidir(sujeto, accion, recurso, entorno)
        _registrar_decision(usuario.pk, accion, recurso, decision)
        return decision
    except Exception:  # noqa: BLE001 - sin decisión registrada no se permite nada
        registro.exception("No se pudo decidir o registrar la decisión de acceso: se deniega")
        return Decision(False, "fallo_del_pdp", "no se pudo decidir o registrar")


def _mfa_reciente(usuario):
    if not usuario.mfa_activo or usuario.mfa_verificado_en is None:
        return False
    return timezone.now() - usuario.mfa_verificado_en <= timedelta(minutes=settings.SIGET_MFA_RECIENTE_MINUTOS)


def autorizar(request, accion, recurso):
    """Consulta al PDP; si no permite, lanza 403. El mensaje es siempre el mismo: no explica qué regla falló.

    Única pista que se da: si la persona tiene segundo factor pero hace rato que no lo verifica, se sugiere
    reautenticarse (es lo que la interfaz necesita para pedirle el código y reintentar).
    """
    usuario = request.user.usuario
    decision = evaluar(usuario, accion, recurso)
    if not decision.permitido:
        raise AccesoDenegado({
            "codigo": "acceso_denegado", "detalle": "No tienes autorización para esta operación.",
            "reautenticacion_sugerida": bool(usuario.mfa_activo and not _mfa_reciente(usuario)),
        })
    return decision


class PermisoPDP(BasePermission):
    """La vista declara `accion_pdp` (una `Accion`) y `recurso_pdp(request)` (devuelve un `Recurso`).

    Sin esa declaración explícita se niega. Úsese para vistas de un solo recurso conocido antes de ejecutarlas;
    las demás llaman a `autorizar` dentro de la vista, después de cargar el recurso.
    """

    message = "Acceso denegado."

    def has_permission(self, request, view):
        principal = request.user
        if principal is None or getattr(principal, "claims", None) is None or principal.claims.scope != "completo":
            return False
        accion = getattr(view, "accion_pdp", None)
        construir_recurso = getattr(view, "recurso_pdp", None)
        if accion is None or construir_recurso is None:
            return False
        try:
            recurso = construir_recurso(request)
        except Exception:  # noqa: BLE001
            registro.exception("No se pudo construir el recurso: se deniega")
            return False
        return evaluar(principal.usuario, accion, recurso).permitido
