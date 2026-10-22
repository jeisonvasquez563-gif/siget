"""Lógica de autenticación que usa la base de datos.

Los fallos esperados (contraseña mala, código inválido, cuenta bloqueada) NO se lanzan como excepciones:
se devuelven en un `Resultado`. Así los contadores de intentos y los eventos de seguridad se guardan
aunque la petición termine en 401 (una excepción de DRF revertiría la transacción y se perdería el
registro del intento).
"""
import hashlib
import re
from dataclasses import dataclass, field
from datetime import timedelta
from typing import Optional

from django.conf import settings
from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.identidad.models import Membresia, Usuario

from . import bloqueo, contrasenas, mfa, politica_sesion, tokens
from .models import EventoSeguridad, Sesion

USERNAME_RE = re.compile(r"^[a-z0-9][a-z0-9_.-]{2,31}$")
ROLES_CON_MFA_SIEMPRE = {"funcionario", "supervisor", "coordinador_institucional"}


@dataclass
class Resultado:
    ok: bool
    codigo: str = ""
    access: str = ""
    refresh: str = ""
    scope: str = ""
    expira_en: int = 0
    detalle: dict = field(default_factory=dict)


def registrar_evento(actor_id, evento, ip, detalle=None):
    EventoSeguridad.objects.create(actor_id=actor_id, evento=evento, ip=ip, detalle=detalle or {})


def _huella(texto: str) -> str:
    return hashlib.sha256((texto or "").encode("utf-8")).hexdigest()[:12]


def mfa_obligatorio(usuario, roles_membresia) -> bool:
    """El personal de las instituciones y los roles de plataforma siempre; el ciudadano según la configuración."""
    if usuario.rol_plataforma != "ninguno":
        return True
    if set(roles_membresia) & ROLES_CON_MFA_SIEMPRE:
        return True
    return settings.SIGET_MFA_CIUDADANO_OBLIGATORIO


def _scope_para(usuario) -> str:
    roles = list(Membresia.objects.filter(usuario=usuario).values_list("rol", flat=True))
    pendiente = mfa_obligatorio(usuario, roles) and not usuario.mfa_activo
    return tokens.SCOPE_ENROLAR_MFA if pendiente else tokens.SCOPE_COMPLETO


def _crear_sesion(usuario, scope, ip, ahora, evento, vencimiento_anterior=None) -> Resultado:
    refresh = tokens.nuevo_refresh()
    expira = ahora + timedelta(seconds=settings.SIGET_REFRESH_TTL_SEGUNDOS)
    if vencimiento_anterior is not None:
        expira = politica_sesion.vencimiento_heredado(vencimiento_anterior, ahora, settings.SIGET_REFRESH_TTL_SEGUNDOS)
    sesion = Sesion.objects.create(usuario=usuario, refresh_hash=tokens.hash_refresh(refresh), ip=ip, expira_en=expira)
    access = tokens.emitir_access(settings.SIGET_JWT_KEY, usuario.pk, sesion.pk, scope, ahora,
                                  settings.SIGET_ACCESS_TTL_SEGUNDOS, settings.SIGET_EMISOR)
    registrar_evento(usuario.pk, evento, ip, {"scope": scope, "sesion": str(sesion.pk)})
    return Resultado(True, evento, access=access, refresh=refresh, scope=scope, expira_en=settings.SIGET_ACCESS_TTL_SEGUNDOS)


def _registrar_fallo(usuario, ip, ahora, motivo) -> Resultado:
    intentos, hasta = bloqueo.tras_fallo(usuario.intentos_fallidos, ahora)
    Usuario.objects.filter(pk=usuario.pk).update(intentos_fallidos=intentos, bloqueado_hasta=hasta)
    registrar_evento(usuario.pk, "login_fallido", ip, {"motivo": motivo, "bloqueada": hasta is not None})
    if hasta is not None:
        registrar_evento(usuario.pk, "cuenta_bloqueada", ip, {"hasta": hasta.isoformat()})
    return Resultado(False, "credenciales_invalidas")


# --------------------------------------------------------------------------- registro e inicio de sesión

def registrar_usuario(username, password, ip) -> Resultado:
    username = (username or "").strip().lower() if isinstance(username, str) else ""
    errores = []
    if not USERNAME_RE.match(username):
        errores.append("el usuario debe tener de 3 a 32 caracteres: minúsculas, números, punto, guion o guion bajo")
    errores += contrasenas.errores_de_contrasena(password, username)
    if errores:
        return Resultado(False, "datos_invalidos", detalle={"errores": errores})
    try:
        with transaction.atomic():
            usuario = Usuario.objects.create(username=username, password_hash=contrasenas.hashear(password))
    except IntegrityError:
        return Resultado(False, "usuario_existente")
    registrar_evento(usuario.pk, "registro", ip)
    return Resultado(True, "registrado", detalle={"id": usuario.pk})


def iniciar_sesion(username, password, codigo_mfa, ip, ahora=None) -> Resultado:
    ahora = ahora or timezone.now()
    username = (username or "").strip().lower() if isinstance(username, str) else ""
    password = password if isinstance(password, str) else ""
    with transaction.atomic():
        usuario = Usuario.objects.select_for_update().filter(username=username).first() if username else None
        if usuario is None:
            contrasenas.verificacion_falsa(password)
            registrar_evento(None, "login_fallido", ip, {"motivo": "usuario_desconocido", "huella": _huella(username)})
            return Resultado(False, "credenciales_invalidas")
        if bloqueo.esta_bloqueado(usuario.bloqueado_hasta, ahora):
            contrasenas.verificacion_falsa(password)
            registrar_evento(usuario.pk, "login_rechazado_bloqueada", ip)
            return Resultado(False, "credenciales_invalidas")
        if not contrasenas.verificar(password, usuario.password_hash):
            return _registrar_fallo(usuario, ip, ahora, "contrasena_incorrecta")
        if usuario.estado_cuenta != "activa":
            registrar_evento(usuario.pk, "login_cuenta_no_activa", ip, {"estado": usuario.estado_cuenta})
            return Resultado(False, "credenciales_invalidas")

        paso = None
        if usuario.mfa_activo:
            if not codigo_mfa:
                return Resultado(False, "mfa_requerido")
            secreto = mfa.descifrar(settings.SIGET_MFA_KEY, usuario.mfa_secreto)
            paso = mfa.paso_valido(secreto, codigo_mfa, ahora, usuario.mfa_ultimo_paso)
            if paso is None:
                return _registrar_fallo(usuario, ip, ahora, "mfa_incorrecto")

        campos = {"intentos_fallidos": 0, "bloqueado_hasta": None}
        if paso is not None:
            campos.update(mfa_ultimo_paso=paso, mfa_verificado_en=ahora)
        Usuario.objects.filter(pk=usuario.pk).update(**campos)
        return _crear_sesion(usuario, _scope_para(usuario), ip, ahora, "login_ok")


# --------------------------------------------------------------------------- refresco y cierre

def _revocar_todas(usuario_id):
    Sesion.objects.filter(usuario_id=usuario_id, revocada=False).update(revocada=True)


def refrescar(refresh_token, ip, ahora=None) -> Resultado:
    """Rota el token de refresco (un solo uso). Reusar uno ya gastado revoca TODAS las sesiones de la persona."""
    ahora = ahora or timezone.now()
    if not isinstance(refresh_token, str) or not refresh_token:
        return Resultado(False, "refresh_invalido")
    with transaction.atomic():
        sesion = (Sesion.objects.select_for_update(of=("self",)).select_related("usuario")
                  .filter(refresh_hash=tokens.hash_refresh(refresh_token)).first())
        if sesion is None:
            return Resultado(False, "refresh_invalido")
        usuario = sesion.usuario
        if sesion.reemplazada_por_id is not None:
            _revocar_todas(usuario.pk)
            registrar_evento(usuario.pk, "refresh_reuso", ip, {"sesion": str(sesion.pk)})
            return Resultado(False, "refresh_invalido")
        if sesion.revocada or sesion.expira_en <= ahora or usuario.estado_cuenta != "activa":
            return Resultado(False, "refresh_invalido")
        if politica_sesion.inactiva(sesion.creado_en, ahora, settings.SIGET_REFRESH_MAX_EDAD_SEGUNDOS):
            # Nadie usó la sesión durante demasiado tiempo: se cierra y queda constancia (se devuelve, no se lanza, para que se guarde)
            Sesion.objects.filter(pk=sesion.pk).update(revocada=True)
            registrar_evento(usuario.pk, "sesion_cerrada_por_inactividad", ip, {"sesion": str(sesion.pk)})
            return Resultado(False, "refresh_invalido")
        nuevo = _crear_sesion(usuario, _scope_para(usuario), ip, ahora, "refresh_ok", vencimiento_anterior=sesion.expira_en)
        nueva_sesion = Sesion.objects.get(refresh_hash=tokens.hash_refresh(nuevo.refresh))
        Sesion.objects.filter(pk=sesion.pk).update(revocada=True, reemplazada_por=nueva_sesion)
        return nuevo


def cerrar_sesion(usuario_id, sesion_id, ip):
    Sesion.objects.filter(pk=sesion_id, usuario_id=usuario_id).update(revocada=True)
    registrar_evento(usuario_id, "logout", ip, {"sesion": str(sesion_id)})


# --------------------------------------------------------------------------- segundo factor

def enrolar_mfa(usuario, ip) -> Resultado:
    if usuario.mfa_activo:
        return Resultado(False, "mfa_ya_activo")
    secreto = mfa.nuevo_secreto()
    Usuario.objects.filter(pk=usuario.pk).update(mfa_secreto=mfa.cifrar(settings.SIGET_MFA_KEY, secreto), mfa_ultimo_paso=None)
    registrar_evento(usuario.pk, "mfa_enrolamiento_iniciado", ip)
    return Resultado(True, "enrolamiento", detalle={"secreto": secreto, "uri": mfa.uri_de_aprovisionamiento(secreto, usuario.username)})


def _codigo_incorrecto_en_sesion(usuario, ip, ahora, motivo) -> Resultado:
    """Un código malo dentro de una sesión también cuenta: 3 fallos bloquean y cierran todas las sesiones."""
    intentos, hasta = bloqueo.tras_fallo(usuario.intentos_fallidos, ahora)
    Usuario.objects.filter(pk=usuario.pk).update(intentos_fallidos=intentos, bloqueado_hasta=hasta)
    registrar_evento(usuario.pk, motivo, ip, {"bloqueada": hasta is not None})
    if hasta is not None:
        _revocar_todas(usuario.pk)
        registrar_evento(usuario.pk, "cuenta_bloqueada", ip, {"hasta": hasta.isoformat(), "origen": "mfa_en_sesion"})
    return Resultado(False, "mfa_invalido")


def _validar_codigo(usuario, codigo, ip, ahora, evento_fallo) -> Optional[Resultado]:
    """Devuelve None si el código es válido (y ya registra el paso usado); si no, el Resultado del fallo."""
    if not usuario.mfa_secreto:
        return Resultado(False, "mfa_sin_enrolar")
    if bloqueo.esta_bloqueado(usuario.bloqueado_hasta, ahora):
        return Resultado(False, "mfa_invalido")
    secreto = mfa.descifrar(settings.SIGET_MFA_KEY, usuario.mfa_secreto)
    paso = mfa.paso_valido(secreto, codigo, ahora, usuario.mfa_ultimo_paso)
    if paso is None:
        return _codigo_incorrecto_en_sesion(usuario, ip, ahora, evento_fallo)
    Usuario.objects.filter(pk=usuario.pk).update(
        mfa_ultimo_paso=paso, mfa_verificado_en=ahora, intentos_fallidos=0, bloqueado_hasta=None)
    return None


def confirmar_mfa(usuario, codigo, sesion_id, ip, ahora=None) -> Resultado:
    """Activa el segundo factor tras comprobar un primer código; devuelve un acceso completo."""
    ahora = ahora or timezone.now()
    if usuario.mfa_activo:
        return Resultado(False, "mfa_ya_activo")
    with transaction.atomic():
        usuario = Usuario.objects.select_for_update().get(pk=usuario.pk)
        fallo = _validar_codigo(usuario, codigo, ip, ahora, "mfa_confirmacion_fallida")
        if fallo is not None:
            return fallo
        Usuario.objects.filter(pk=usuario.pk).update(mfa_activo=True)
        registrar_evento(usuario.pk, "mfa_activado", ip)
        access = tokens.emitir_access(settings.SIGET_JWT_KEY, usuario.pk, sesion_id, tokens.SCOPE_COMPLETO, ahora,
                                      settings.SIGET_ACCESS_TTL_SEGUNDOS, settings.SIGET_EMISOR)
        return Resultado(True, "mfa_activado", access=access, scope=tokens.SCOPE_COMPLETO, expira_en=settings.SIGET_ACCESS_TTL_SEGUNDOS)


def verificar_mfa(usuario, codigo, ip, ahora=None) -> Resultado:
    """Reautenticación escalonada: renueva `mfa_verificado_en`, que el PDP exige reciente para acciones sensibles."""
    ahora = ahora or timezone.now()
    if not usuario.mfa_activo:
        return Resultado(False, "mfa_sin_enrolar")
    with transaction.atomic():
        usuario = Usuario.objects.select_for_update().get(pk=usuario.pk)
        fallo = _validar_codigo(usuario, codigo, ip, ahora, "mfa_verificacion_fallida")
        if fallo is not None:
            return fallo
        registrar_evento(usuario.pk, "mfa_verificado", ip)
        return Resultado(True, "mfa_verificado")
