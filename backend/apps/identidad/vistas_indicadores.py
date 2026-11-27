"""Indicadores de una institución para su supervisión y su coordinación: cifras agregadas, sin datos de personas ni de trámites.

La coordinación NO ve trámites (la seguridad por filas solo abre los de quien los atiende), así que las cifras no salen de consultar la tabla
`tramite` desde aquí sino de la función `siget.indicadores_institucion()` de la migración 022 (SECURITY DEFINER, ruta de búsqueda fija), que
devuelve solo agregados y vuelve a comprobar adentro que quien pregunta sea supervisión o coordinación VIGENTE de esa institución.

Cómo se protege cada petición:
1. Autenticación con acceso completo.
2. Contexto de seguridad por filas con la persona (la función lee `siget.ctx_usuario()`), sin instituciones: esta vista no abre trámites.
3. El PDP decide ANTES de tocar la base (`ver_indicadores_institucion`, supervisión o coordinación de ESA institución): lo ajeno, lo inexistente y
   quien no tiene el rol reciben el mismo 403, así que no se revela qué instituciones existen. La decisión, también la negada, queda registrada.
4. La base valida otra vez: si la persona dejó de tener el rol entre el PDP y la consulta (42501), es 403 y queda un evento de seguridad.
5. La respuesta se arma clave por clave con una lista fija: aunque la función devolviera algo más, no sale de aquí.
"""
import json

from django.db import DatabaseError, connection, transaction
from django.utils import timezone
from rest_framework import status
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from apps.autenticacion.autenticacion import exige_scope
from apps.autenticacion.servicio import registrar_evento
from apps.autenticacion.tokens import SCOPE_COMPLETO
from apps.autorizacion.pdp import Accion, Recurso
from apps.autorizacion.permisos import autorizar
from apps.nucleo.contexto import fijar_contexto

SIN_PERMISO = "No tienes autorización para esta operación."  # el mismo texto que da el PDP
CIFRAS = ("abiertos", "vencidos", "escalados_abiertos", "sin_asignar", "resueltos_90_dias", "dias_promedio_resolucion")


def indicadores_a_dict(institucion, crudo, ahora):
    """Solo las claves conocidas, y de la carga por funcionario solo id, usuario y conteo."""
    if isinstance(crudo, (str, bytes)):
        crudo = json.loads(crudo)
    carga = [{"usuario_id": f["usuario_id"], "usuario": f["usuario"], "abiertos": f["abiertos"]} for f in crudo.get("por_funcionario", [])]
    promedio = crudo.get("dias_promedio_resolucion")
    cuerpo = {"institucion": institucion, "generado_en": ahora.isoformat(), "por_estado": {str(k): int(v) for k, v in crudo.get("por_estado", {}).items()}}
    cuerpo.update({c: crudo.get(c) for c in CIFRAS})
    cuerpo["dias_promedio_resolucion"] = None if promedio is None else float(promedio)
    cuerpo["por_funcionario"] = carga
    return cuerpo


class IndicadoresInstitucion(APIView):
    permission_classes = [exige_scope(SCOPE_COMPLETO)]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "api"

    def check_permissions(self, request):
        super().check_permissions(request)
        fijar_contexto(request.user.usuario.pk, ())

    def get(self, request, institucion):
        usuario = request.user.usuario
        autorizar(request, Accion.VER_INDICADORES_INSTITUCION, Recurso(tipo="indicadores", institucion_id=institucion))
        try:
            with transaction.atomic(), connection.cursor() as cursor:  # punto de guardado: si la base niega, la petición sigue viva para registrar el evento
                cursor.execute("SELECT siget.indicadores_institucion(%s)", [institucion])
                crudo = cursor.fetchone()[0]
        except DatabaseError as error:
            if getattr(getattr(error, "__cause__", None), "sqlstate", None) != "42501":
                raise
            # La persona dejó de ser supervisión o coordinación entre el PDP y la consulta. Solo quién y dónde, nada del texto del error
            registrar_evento(usuario.pk, "indicadores_denegados_por_la_base", None, {"institucion": institucion})
            return Response({"codigo": "acceso_denegado", "detalle": SIN_PERMISO}, status=status.HTTP_403_FORBIDDEN)
        respuesta = Response(indicadores_a_dict(institucion, crudo, timezone.now()))
        respuesta["Cache-Control"] = "no-store"
        return respuesta
