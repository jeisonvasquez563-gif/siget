"""Clases de permiso de DRF."""
import logging

from django.conf import settings
from django.utils import timezone
from rest_framework.permissions import BasePermission

from apps.autorizacion.pdp import Entorno, decidir

registro = logging.getLogger("siget.pdp")


class DenegarPorDefecto(BasePermission):
    """Permiso por defecto de toda la API: niega. Una vista debe declarar explícitamente cómo se autoriza."""

    message = "Acceso denegado: ninguna política lo permite."

    def has_permission(self, request, view):
        return False


def _membresias(usuario):
    from apps.identidad.models import Membresia

    return list(Membresia.objects.filter(usuario=usuario))


def _registrar_decision(actor_id, accion, recurso, decision):
    """Guarda la decisión por una conexión aparte, en autocommit: una decisión negada hace que DRF revierta la
    transacción de la petición y, sin esto, se perdería justo el registro más importante."""
    from apps.auditoria.models import DecisionPdp

    DecisionPdp(
        actor_id=actor_id, accion=accion.value, recurso=recurso.tipo, permitido=decision.permitido, politica=decision.politica,
        atributos={"motivo": decision.motivo, "institucion_id": recurso.institucion_id},
    ).save(using="decisiones")


class PermisoPDP(BasePermission):
    """La vista declara `accion_pdp` (una `Accion`) y `recurso_pdp(request)` (devuelve un `Recurso`).

    Sin esa declaración explícita se niega. Si no se puede registrar la decisión, también se niega: no debe
    haber ninguna acción permitida sin su evidencia.
    """

    message = "Acceso denegado."

    def has_permission(self, request, view):
        from apps.identidad.sujeto import construir_sujeto

        principal = request.user
        if principal is None or getattr(principal, "claims", None) is None or principal.claims.scope != "completo":
            return False
        accion = getattr(view, "accion_pdp", None)
        construir_recurso = getattr(view, "recurso_pdp", None)
        if accion is None or construir_recurso is None:
            return False
        try:
            recurso = construir_recurso(request)
            sujeto = construir_sujeto(principal.usuario, _membresias(principal.usuario))
            entorno = Entorno(ahora=timezone.now(), mfa_reciente_minutos=settings.SIGET_MFA_RECIENTE_MINUTOS,
                              mfa_ciudadano_obligatorio=settings.SIGET_MFA_CIUDADANO_OBLIGATORIO)
            decision = decidir(sujeto, accion, recurso, entorno)
            _registrar_decision(principal.usuario.pk, accion, recurso, decision)
        except Exception:  # noqa: BLE001 - sin decisión registrada no se permite nada
            registro.exception("No se pudo decidir o registrar la decisión de acceso: se deniega")
            return False
        return decision.permitido
