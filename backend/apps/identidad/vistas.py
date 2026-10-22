"""Equipo de una institución: quién tiene qué rol. Lo ven el coordinador y el supervisor de esa institución."""
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from apps.autenticacion.autenticacion import exige_scope
from apps.autenticacion.tokens import SCOPE_COMPLETO
from apps.autorizacion.pdp import Accion, Recurso
from apps.autorizacion.permisos import _membresias, autorizar

from .models import Membresia


class Equipo(APIView):
    permission_classes = [exige_scope(SCOPE_COMPLETO)]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "api"

    def get(self, request):
        usuario = request.user.usuario
        propias = _membresias(usuario)
        # Solo las instituciones donde la persona coordina o supervisa; si no tiene ninguna, el PDP niega y queda registrado
        instituciones = sorted({m.institucion_id for m in propias if m.rol in {"coordinador_institucional", "supervisor"}})
        if not instituciones:
            autorizar(request, Accion.GESTIONAR_USUARIOS_INSTITUCION, Recurso(tipo="usuario"))
        salida = []
        for inst in instituciones:
            es_coordinador = any(m.institucion_id == inst and m.rol == "coordinador_institucional" for m in propias)
            if es_coordinador:
                autorizar(request, Accion.GESTIONAR_USUARIOS_INSTITUCION, Recurso(tipo="usuario", institucion_id=inst))
            else:
                autorizar(request, Accion.REASIGNAR_TRAMITE, Recurso(tipo="tramite", institucion_id=inst))
            miembros = (Membresia.objects.filter(institucion_id=inst, rol__in=["funcionario", "supervisor", "coordinador_institucional"])
                        .select_related("usuario", "institucion").order_by("rol", "usuario__username"))
            salida.append({
                "institucion": {"id": inst, "nombre": miembros[0].institucion.nombre if miembros else None},
                "personal": [{"usuario_id": m.usuario_id, "usuario": m.usuario.username, "rol": m.rol} for m in miembros],
            })
        return Response({"equipos": salida})
