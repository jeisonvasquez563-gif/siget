"""Catálogo de instituciones y trámites: lectura para cualquier persona autenticada.

Es información pública de las instituciones (qué trámites existen y su plazo), no datos de trámites de
nadie: por eso no pasa por el PDP. Sí exige un acceso completo y tiene límite de tasa.
"""
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from apps.autenticacion.autenticacion import exige_scope
from apps.autenticacion.tokens import SCOPE_COMPLETO
from apps.tramites.serializacion import entero_positivo

from .models import Institucion, TipoTramite


class _Lectura(APIView):
    permission_classes = [exige_scope(SCOPE_COMPLETO)]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "api"


class InstitucionesLista(_Lectura):
    def get(self, request):
        return Response([{"id": i.pk, "nombre": i.nombre, "tipo": i.tipo} for i in Institucion.objects.order_by("id")])


class TiposTramiteLista(_Lectura):
    def get(self, request):
        consulta = TipoTramite.objects.select_related("institucion").order_by("id")
        crudo = request.query_params.get("institucion")
        if crudo is not None:
            if not crudo.isascii() or not crudo.isdigit() or entero_positivo(int(crudo)) is None:
                return Response({"codigo": "datos_invalidos", "detalle": "`institucion` debe ser un id válido."}, status=400)
            consulta = consulta.filter(institucion_id=int(crudo))
        return Response([{"id": t.pk, "nombre": t.nombre, "sla_dias": t.sla_dias,
                          "institucion": {"id": t.institucion_id, "nombre": t.institucion.nombre}} for t in consulta])
