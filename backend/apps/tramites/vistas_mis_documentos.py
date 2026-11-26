"""«Mis documentos»: todo lo que la persona adjuntó en SUS trámites, en una sola lista (una función de la ciudadanía, pero sirve a cualquier
cuenta sin rol de plataforma: el personal también inicia trámites en otras instituciones).

Cómo se protege cada petición:
1. Autenticación con acceso completo (igual que el resto de la API de trámites).
2. Contexto de seguridad por filas SOLO con la persona (sin instituciones): aunque atienda trámites, aquí la base no le deja ver más que lo
   suyo (política de `documento`: el solicitante del trámite).
3. El PDP decide con `ver_documento` sobre un recurso propio (`solicitante_id` es siempre quien pregunta, nunca viene de la petición): los roles de
   plataforma no acceden a documentos, y quien no activó el segundo factor tampoco, como en cada trámite.
4. Filtro explícito por solicitante del trámite Y por quien subió el archivo: segunda barrera por si la política de la base se relajara.

La descarga NO es nueva: se hace por la ruta de cada trámite (`GET /tramites/<id>/documentos/<doc>/`), que ya valida, descifra y verifica la integridad.
"""
from django.db.models import Q
from rest_framework import status
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from apps.autenticacion.autenticacion import exige_scope
from apps.autenticacion.tokens import SCOPE_COMPLETO
from apps.autorizacion.pdp import Accion, Recurso
from apps.autorizacion.permisos import autorizar
from apps.nucleo.contexto import fijar_contexto
from apps.tramites.models import Documento
from apps.tramites.serializacion import BIGINT_MAXIMO, pagina_de, paginacion
from apps.tramites.vistas import _error

BUSQUEDA_MAXIMA = 100


def documento_propio_a_dict(d):
    """Solo lo que la persona ya ve de su documento y de su trámite (nada del personal: ni quién atiende ni la huella)."""
    return {
        "id": d.pk, "nombre": d.nombre, "tipo": d.tipo_mime, "tamano": d.tamano, "creado_en": d.creado_en.isoformat(),
        "tramite": {"id": d.tramite_id, "tipo_tramite": d.tramite.tipo_tramite.nombre, "institucion": d.tramite.institucion.nombre},
    }


class MisDocumentos(APIView):
    permission_classes = [exige_scope(SCOPE_COMPLETO)]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "api"

    def check_permissions(self, request):
        super().check_permissions(request)
        fijar_contexto(request.user.usuario.pk, ())  # solo la persona: lo propio no depende de ninguna institución

    def get(self, request):
        usuario = request.user.usuario
        autorizar(request, Accion.VER_DOCUMENTO, Recurso(tipo="documento", solicitante_id=usuario.pk))
        pagina = paginacion(request.query_params)
        if pagina is None:
            return _error("paginacion_invalida", "limite (1 a 100) y desplazamiento deben ser enteros válidos.", status.HTTP_400_BAD_REQUEST)
        limite, desplazamiento = pagina
        consulta = (Documento.objects.filter(tramite__solicitante_id=usuario.pk, subido_por_id=usuario.pk)
                    .select_related("tramite__tipo_tramite", "tramite__institucion").order_by("-creado_en", "-id"))
        q = request.query_params.get("q")
        if q is not None:
            q = q.strip()
            if len(q) > BUSQUEDA_MAXIMA:
                return _error("filtro_invalido", f"`q` admite hasta {BUSQUEDA_MAXIMA} caracteres.", status.HTTP_400_BAD_REQUEST)
            if q:
                criterio = (Q(nombre__icontains=q) | Q(tramite__tipo_tramite__nombre__icontains=q) | Q(tramite__institucion__nombre__icontains=q))
                numero = q.lstrip("#")
                if numero.isascii() and numero.isdigit() and 0 < int(numero) <= BIGINT_MAXIMO:
                    criterio |= Q(tramite_id=int(numero))  # «36» o «#36»: el número del trámite
                consulta = consulta.filter(criterio)
        filas = list(consulta[desplazamiento:desplazamiento + limite])
        respuesta = Response(pagina_de([documento_propio_a_dict(d) for d in filas], consulta.count(), limite, desplazamiento))
        respuesta["Cache-Control"] = "no-store"
        return respuesta
