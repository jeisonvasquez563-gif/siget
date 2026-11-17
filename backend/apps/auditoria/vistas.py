"""Consola de auditoría: solo lectura del registro inalterable.

- Solo el rol de plataforma `auditor` (nivel de aseguramiento 3 y segundo factor reciente): lo decide el PDP.
- Lee por una conexión PROPIA como `auditor_role` (solo SELECT): esta consola no puede escribir ni borrar nada.
- Quién audita al auditor: cada consulta pasa por el PDP y queda registrada como una decisión más.
- Solo se piden columnas concretas (`values`): la base ni siquiera permite al auditor leer hashes ni secretos.
"""
from datetime import timedelta

from django.db.models import Count, Q
from django.utils import timezone
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from apps.autenticacion.autenticacion import exige_scope
from apps.autenticacion.models import EventoSeguridad
from apps.autenticacion.tokens import SCOPE_COMPLETO
from apps.autorizacion.pdp import Accion, Recurso
from apps.autorizacion.permisos import autorizar

from .models import DecisionPdp, EventoAuditoria
from .serializacion import decision_a_dict, evento_seguridad_a_dict, evento_tramite_a_dict, filtros, paginacion

BD = "auditoria"


class _Auditoria(APIView):
    permission_classes = [exige_scope(SCOPE_COMPLETO)]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "api"
    accion = Accion.CONSULTAR_AUDITORIA


class _Listado(_Auditoria):
    modelo = None
    columnas = ()
    filtros_admitidos = ()
    convertir = None

    def get(self, request):
        autorizar(request, self.accion, Recurso(tipo="auditoria"))
        pagina = paginacion(request.query_params)
        filtro = filtros(request.query_params, self.filtros_admitidos)
        if pagina is None or filtro is None:
            return Response({"codigo": "datos_invalidos", "detalle": "Filtros o paginación inválidos (limite 1 a 100)."}, status=400)
        limite, desplazamiento = pagina
        consulta = self.modelo.objects.using(BD).filter(**filtro)
        total = consulta.count()
        filas = consulta.order_by("-id").values(*self.columnas)[desplazamiento:desplazamiento + limite]
        convertir = type(self).convertir
        return Response({"total": total, "limite": limite, "desplazamiento": desplazamiento, "resultados": [convertir(f) for f in filas]})


class Decisiones(_Listado):
    accion = Accion.CONSULTAR_DECISIONES
    modelo = DecisionPdp
    filtros_admitidos = ("resultado", "politica", "accion", "actor")
    columnas = ("id", "creado_en", "actor_id", "actor__username", "accion", "recurso", "permitido", "politica", "atributos")
    convertir = staticmethod(decision_a_dict)


class EventosSeguridad(_Listado):
    modelo = EventoSeguridad
    filtros_admitidos = ("evento", "actor")
    columnas = ("id", "creado_en", "actor_id", "actor__username", "evento", "ip", "detalle")
    convertir = staticmethod(evento_seguridad_a_dict)


class EventosTramites(_Listado):
    modelo = EventoAuditoria
    filtros_admitidos = ("accion", "actor")
    columnas = ("id", "creado_en", "tramite_id", "institucion_id", "actor_id", "actor__username", "accion", "estado_anterior", "estado_nuevo")
    convertir = staticmethod(evento_tramite_a_dict)


class Resumen(_Auditoria):
    accion = Accion.CONSULTAR_DECISIONES

    def get(self, request):
        autorizar(request, self.accion, Recurso(tipo="auditoria"))
        desde = timezone.now() - timedelta(hours=24)
        decisiones = DecisionPdp.objects.using(BD)
        totales = decisiones.aggregate(
            total=Count("id"), permitidas=Count("id", filter=Q(permitido=True)), negadas=Count("id", filter=Q(permitido=False)),
            ultimas_24h=Count("id", filter=Q(creado_en__gte=desde)), negadas_24h=Count("id", filter=Q(permitido=False, creado_en__gte=desde)))
        por_politica = (decisiones.values("politica").annotate(permitidas=Count("id", filter=Q(permitido=True)), negadas=Count("id", filter=Q(permitido=False)))
                        .order_by("-negadas", "-permitidas", "politica")[:12])
        denegaciones_por_persona = (decisiones.filter(permitido=False, actor_id__isnull=False).values("actor_id", "actor__username")
                                    .annotate(total=Count("id")).order_by("-total")[:5])
        seguridad = EventoSeguridad.objects.using(BD).values("evento").annotate(total=Count("id")).order_by("-total")[:12]
        tramites = EventoAuditoria.objects.using(BD).values("accion").annotate(total=Count("id")).order_by("-total")
        return Response({
            "decisiones": totales,
            "por_politica": [{"politica": f["politica"], "permitidas": f["permitidas"], "negadas": f["negadas"]} for f in por_politica],
            "denegaciones_por_persona": [{"id": f["actor_id"], "usuario": f["actor__username"], "total": f["total"]} for f in denegaciones_por_persona],
            "seguridad": [{"evento": f["evento"], "total": f["total"]} for f in seguridad],
            "tramites": [{"accion": f["accion"], "total": f["total"]} for f in tramites],
        })
