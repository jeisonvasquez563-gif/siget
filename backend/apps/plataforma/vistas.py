"""Consolas de los operadores de plataforma: identidades, catálogo, seguridad, secretos e infraestructura.

Reglas comunes (las impone el PDP en cada petición, y la base por debajo):
- Cada acción exige el rol de plataforma que le corresponde y un segundo factor reciente.
- Nunca se devuelven datos de trámites ni datos personales: una persona es su identificador, su usuario y su estado.
- Quien propone un alta no la aprueba (control dual); nadie actúa sobre su propia cuenta.
- Todo queda en los eventos de seguridad (inalterables) y en las decisiones del PDP.
"""
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from apps.autenticacion.autenticacion import exige_scope
from apps.autenticacion.tokens import SCOPE_COMPLETO
from apps.autorizacion.pdp import Accion, Recurso
from apps.autorizacion.permisos import autorizar
from apps.identidad.models import Aprobacion, Usuario

from . import servicio

# Qué tipo de alta gestiona cada operador (el PDP lo vuelve a comprobar)
ALTA_DE_ROL = {"operador_identidades": "alta_coordinador", "operador_catalogo": "alta_institucion"}

MENSAJES = {
    "no_a_si_mismo": "No puedes hacer esto sobre tu propia cuenta.",
    "conflicto_de_funciones": "Ya hiciste la otra mitad del restablecimiento de esta cuenta en las últimas 24 horas: lo debe hacer otra persona.",
    "no_corresponde": "La cuenta no está en un estado en el que se pueda hacer esto.",
    "ya_resuelta": "Esta propuesta ya fue resuelta.",
    "sin_segundo_factor": "Esa cuenta no tiene segundo factor activo.",
    "cuenta_suspendida": "La cuenta está suspendida.",
}


def _ip(request):
    return request.META.get("HTTP_X_REAL_IP") or request.META.get("REMOTE_ADDR")


def _campo(request, nombre):
    datos = request.data if isinstance(request.data, dict) else {}
    return datos.get(nombre)


def _responder(r, creado=False):
    if r.ok:
        return Response({"codigo": r.codigo, **(r.detalle or {})}, status=status.HTTP_201_CREATED if creado else status.HTTP_200_OK)
    if r.codigo == "datos_invalidos":
        return Response({"codigo": r.codigo, "errores": r.detalle["errores"]}, status=status.HTTP_400_BAD_REQUEST)
    return Response({"codigo": r.codigo, "detalle": MENSAJES.get(r.codigo, "No se pudo completar la operación.")}, status=status.HTTP_409_CONFLICT)


class _Plataforma(APIView):
    permission_classes = [exige_scope(SCOPE_COMPLETO)]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "api"

    def yo(self, request):
        return request.user.usuario


def _persona(pk):
    return get_object_or_404(Usuario, pk=pk)


# --------------------------------------------------------------------------- personas (identidades y seguridad)

class Personas(_Plataforma):
    def get(self, request):
        accion = Accion.BLOQUEAR_CUENTA if self.yo(request).rol_plataforma == "operador_seguridad" else Accion.RESTABLECER_MFA
        autorizar(request, accion, Recurso(tipo="usuario"))
        q = request.query_params.get("q", "")[:40]
        return Response({"personas": servicio.personas(q)})


class PersonaRestablecerContrasena(_Plataforma):
    def post(self, request, pk):
        autorizar(request, Accion.RESTABLECER_MFA, Recurso(tipo="usuario"))
        r = servicio.emitir_codigo(self.yo(request), _persona(pk), _ip(request))
        respuesta = _responder(r, creado=True)
        respuesta["Cache-Control"] = "no-store"  # lleva el código en claro: que nada lo guarde
        return respuesta


class PersonaRestablecerMfa(_Plataforma):
    def post(self, request, pk):
        autorizar(request, Accion.RESTABLECER_MFA, Recurso(tipo="usuario"))
        return _responder(servicio.restablecer_mfa(self.yo(request), _persona(pk), _ip(request)))


class PersonaBloquear(_Plataforma):
    def post(self, request, pk):
        autorizar(request, Accion.BLOQUEAR_CUENTA, Recurso(tipo="usuario"))
        return _responder(servicio.cambiar_estado_cuenta(self.yo(request), _persona(pk), True, _campo(request, "motivo"), _ip(request)))


class PersonaDesbloquear(_Plataforma):
    def post(self, request, pk):
        autorizar(request, Accion.BLOQUEAR_CUENTA, Recurso(tipo="usuario"))
        return _responder(servicio.cambiar_estado_cuenta(self.yo(request), _persona(pk), False, "", _ip(request)))


class PersonaRevocarSesiones(_Plataforma):
    def post(self, request, pk):
        autorizar(request, Accion.REVOCAR_SESION, Recurso(tipo="usuario"))
        return _responder(servicio.revocar_sesiones(self.yo(request), _persona(pk), _ip(request)))


class EventosSeguridad(_Plataforma):
    def get(self, request):
        autorizar(request, Accion.BLOQUEAR_CUENTA, Recurso(tipo="usuario"))
        return Response({"eventos": servicio.eventos_recientes(request.query_params.get("evento", "")[:60])})


# --------------------------------------------------------------------------- aprobaciones (control dual)

class Aprobaciones(_Plataforma):
    def _tipo(self, request):
        return ALTA_DE_ROL.get(self.yo(request).rol_plataforma, "alta_institucion")

    def get(self, request):
        tipo = self._tipo(request)
        autorizar(request, Accion.PROPONER_ALTA, Recurso(tipo=tipo))
        return Response({"accion": tipo, "aprobaciones": servicio.listar_aprobaciones(tipo)})

    def post(self, request):
        tipo = self._tipo(request)  # el tipo sale del rol, nunca del cliente
        autorizar(request, Accion.PROPONER_ALTA, Recurso(tipo=tipo))
        datos = request.data if isinstance(request.data, dict) else {}
        return _responder(servicio.proponer(self.yo(request), tipo, datos, _ip(request)), creado=True)


class AprobacionResolver(_Plataforma):
    def post(self, request, pk):
        aprobacion = get_object_or_404(Aprobacion.objects.select_related("propuesto_por"), pk=pk)
        autorizar(request, Accion.APROBAR_ALTA, Recurso(tipo=aprobacion.accion, propuesto_por=aprobacion.propuesto_por_id))
        decision = _campo(request, "decision")
        return _responder(servicio.resolver(self.yo(request), aprobacion, decision if isinstance(decision, str) else "", _ip(request)))


# --------------------------------------------------------------------------- secretos e infraestructura

class Secretos(_Plataforma):
    def get(self, request):
        autorizar(request, Accion.ROTAR_SECRETOS, Recurso(tipo="secreto"))
        return Response({"secretos": servicio.estado_secretos()})

    def post(self, request):
        autorizar(request, Accion.ROTAR_SECRETOS, Recurso(tipo="secreto"))
        secreto, nota = _campo(request, "secreto"), _campo(request, "nota")
        return _responder(servicio.registrar_rotacion(self.yo(request), secreto if isinstance(secreto, str) else "", nota or "", _ip(request)), creado=True)


class Infraestructura(_Plataforma):
    def get(self, request):
        autorizar(request, Accion.ADMINISTRAR_INFRAESTRUCTURA, Recurso(tipo="infraestructura"))
        return Response(servicio.salud())
