"""Recorrido completo de la autenticación por HTTP contra la base real, en una transacción que se revierte.

Usa el cliente de pruebas de DRF (las peticiones pasan por nginx-less pero por todo el resto: middleware,
autenticación, permisos, límites de tasa, servicios y base de datos). El reloj se controla para probar
vencimientos, bloqueos y la ventana del segundo factor. No deja ningún dato.
"""
from datetime import timedelta
from unittest import mock

import pyotp
from django.core.cache import cache
from django.core.management.base import BaseCommand, CommandError
from django.db import DatabaseError, connection, transaction
from django.utils import timezone
from rest_framework.test import APIClient

from apps.autenticacion.models import EventoSeguridad, Sesion
from apps.identidad.models import Usuario

CLAVE_BUENA = "una-frase-larga-y-poco-comun-7391"
HOST = {"HTTP_HOST": "localhost", "HTTP_X_REAL_IP": "198.51.100.7"}


class _Revertir(Exception):
    pass


class Command(BaseCommand):
    help = "Prueba de integración de la autenticación contra la base real (se revierte al final)."

    def _paso(self, nombre, ok, detalle=""):
        self.resultados.append(ok)
        marca = self.style.SUCCESS("PASA ") if ok else self.style.ERROR("FALLA")
        self.stdout.write(f"{marca} {nombre}{(' - ' + str(detalle)) if detalle else ''}")

    # --- ayudas HTTP: se limpia la caché entre peticiones para que el límite de tasa no interfiera
    def _http(self, metodo, ruta, datos=None, token=None, **extra):
        cliente = self.cliente
        cabeceras = dict(HOST, **extra)
        if token:
            cabeceras["HTTP_AUTHORIZATION"] = f"Bearer {token}"
        r = getattr(cliente, metodo)(ruta, datos, format="json", secure=True, **cabeceras) if metodo == "post" else \
            getattr(cliente, metodo)(ruta, secure=True, **cabeceras)
        self._limpiar()
        return r

    @staticmethod
    def _limpiar():
        """Entre peticiones: se vacía la caché (límite de tasa) y se quita la marca de reversión que DRF pone al
        lanzar una excepción de API. En producción las vistas de autenticación no son atómicas, así que no
        pasa; aquí todo corre dentro de una transacción exterior que sí se vería afectada."""
        cache.clear()
        transaction.set_rollback(False)

    def _cookie_refresco(self):
        morsel = self.cliente.cookies.get("siget_refresh")
        return morsel.value if morsel else None

    def handle(self, *args, **opciones):
        self.resultados = []
        self.cliente = APIClient()
        try:
            with transaction.atomic():
                self._recorrer()
                raise _Revertir()
        except _Revertir:
            pass
        total, fallas = len(self.resultados), self.resultados.count(False)
        self.stdout.write(f"\n{total - fallas} de {total} pasos correctos; no quedó ningún dato (transacción revertida).")
        if fallas:
            raise CommandError(f"{fallas} paso(s) fallaron")

    def _recorrer(self):
        ahora = timezone.now()

        # ---------------------------------------------------------------- registro
        r = self._http("post", "/auth/registro/", {"username": "int_ana", "password": "corta"})
        self._paso("rechaza una contraseña débil", r.status_code == 400, r.status_code)
        r = self._http("post", "/auth/registro/", {"username": "int_ana", "password": "passwordpassword"})
        self._paso("rechaza una contraseña común aunque sea larga", r.status_code == 400)
        r = self._http("post", "/auth/registro/", {"username": "int_ana", "password": CLAVE_BUENA})
        self._paso("registra una cuenta", r.status_code == 201, r.status_code)
        r = self._http("post", "/auth/registro/", {"username": "int_ana", "password": CLAVE_BUENA})
        self._paso("no permite registrar dos veces el mismo usuario", r.status_code == 409, r.status_code)
        ana = Usuario.objects.get(username="int_ana")
        self._paso("la contraseña quedó con hash Argon2 (nunca en claro)", ana.password_hash.startswith("argon2$") and CLAVE_BUENA not in ana.password_hash)

        # ---------------------------------------------------------------- login sin enumerar usuarios
        mala = self._http("post", "/auth/login/", {"username": "int_ana", "password": "incorrecta-incorrecta"})
        inexistente = self._http("post", "/auth/login/", {"username": "no_existe_nadie", "password": "incorrecta-incorrecta"})
        self._paso("usuario inexistente y contraseña mala dan la MISMA respuesta (no se enumera)",
                   (mala.status_code, mala.json()) == (inexistente.status_code, inexistente.json()) and mala.status_code == 401)
        r = self._http("post", "/auth/login/", {"username": "int_ana"})
        self._paso("un login sin contraseña no rompe nada", r.status_code == 401)
        r = self._http("post", "/auth/login/", {"username": ["int_ana"], "password": 12345})
        self._paso("tipos de datos inesperados no provocan un error 500", r.status_code == 401, r.status_code)

        # ---------------------------------------------------------------- login y enrolamiento del segundo factor
        r = self._http("post", "/auth/login/", {"username": "int_ana", "password": CLAVE_BUENA})
        cuerpo = r.json()
        self._paso("login correcto: acceso limitado hasta activar el segundo factor",
                   r.status_code == 200 and cuerpo["scope"] == "enrolar_mfa" and cuerpo.get("mfa_enrolamiento_requerido") is True)
        acceso = cuerpo["access_token"]
        cookie = r.cookies.get("siget_refresh")
        self._paso("el refresco viaja en una cookie HttpOnly, Secure y SameSite=Strict, y no en el cuerpo",
                   cookie is not None and cookie["httponly"] and cookie["secure"] and cookie["samesite"] == "Strict" and "refresh" not in str(cuerpo).lower())
        self._paso("la cookie solo se envía a /auth/", cookie is not None and cookie["path"] == "/auth/")

        self._paso("sin token se responde 401", self._http("get", "/auth/yo/").status_code == 401)
        self._paso("con un token alterado se responde 401", self._http("get", "/auth/yo/", token=acceso[:-4] + "AAAA").status_code == 401)
        self._paso("con el token válido responde 200", self._http("get", "/auth/yo/", token=acceso).status_code == 200)

        r = self._http("post", "/auth/mfa/enrolar/", token=acceso)
        self._paso("inicia el enrolamiento del segundo factor", r.status_code == 201 and "otpauth://" in r.json()["uri"])
        secreto = r.json()["secreto"]
        ana.refresh_from_db()
        self._paso("el secreto TOTP está CIFRADO en la base (no se ve en claro)", ana.mfa_secreto and secreto not in ana.mfa_secreto)
        self._paso("hasta confirmarlo, el segundo factor no está activo", ana.mfa_activo is False)

        r = self._http("post", "/auth/mfa/confirmar/", {"codigo": "000000"}, token=acceso)
        self._paso("un código incorrecto no activa el segundo factor", r.status_code == 400)
        totp = pyotp.TOTP(secreto)
        r = self._http("post", "/auth/mfa/confirmar/", {"codigo": totp.at(ahora.timestamp())}, token=acceso)
        completo = r.json().get("access_token")
        self._paso("el código correcto activa el segundo factor y entrega un acceso completo", r.status_code == 200 and r.json()["scope"] == "completo")
        ana.refresh_from_db()
        self._paso("queda activo y con la verificación reciente registrada", ana.mfa_activo and ana.mfa_verificado_en is not None)

        # ---------------------------------------------------------------- login con segundo factor
        r = self._http("post", "/auth/login/", {"username": "int_ana", "password": CLAVE_BUENA})
        self._paso("con el segundo factor activo, la contraseña sola ya no basta", r.status_code == 401 and r.json()["codigo"] == "mfa_requerido")
        r = self._http("post", "/auth/login/", {"username": "int_ana", "password": CLAVE_BUENA, "codigo": totp.at(ahora.timestamp())})
        self._paso("el mismo código no sirve dos veces (anti-repetición)", r.status_code == 401, r.status_code)
        r = self._http("post", "/auth/login/", {"username": "int_ana", "password": CLAVE_BUENA, "codigo": totp.at(ahora.timestamp() + 30)})
        self._paso("el código del siguiente paso entra", r.status_code == 200 and r.json()["scope"] == "completo", r.status_code)
        acceso2 = r.json().get("access_token")
        refresh_viejo = self._cookie_refresco()

        # ---------------------------------------------------------------- segundo factor reciente (reautenticación escalonada)
        con_reloj = mock.patch("django.utils.timezone.now", return_value=ahora + timedelta(seconds=65))
        with con_reloj:
            r = self._http("post", "/auth/mfa/verificar/", {"codigo": totp.at(ahora.timestamp() + 65)}, token=acceso2)
        ana.refresh_from_db()
        self._paso("la reautenticación renueva la vigencia del segundo factor", r.status_code == 200 and ana.mfa_verificado_en >= ahora + timedelta(seconds=60))

        # ---------------------------------------------------------------- refresco con rotación y detección de reuso
        r = self._http("post", "/auth/refresh/")
        self._paso("el refresco exige la cabecera de verificación (anti-CSRF)", r.status_code == 403)
        r = self._http("post", "/auth/refresh/", HTTP_X_SIGET_CSRF="1")
        self._paso("refresca y entrega un token nuevo", r.status_code == 200 and r.json()["access_token"] != acceso2, r.status_code)
        acceso3 = r.json().get("access_token")
        refresh_nuevo = self._cookie_refresco()
        self._paso("el token de refresco rota en cada uso", refresh_nuevo and refresh_nuevo != refresh_viejo)
        self.cliente.cookies["siget_refresh"] = refresh_viejo
        r = self._http("post", "/auth/refresh/", HTTP_X_SIGET_CSRF="1")
        self._paso("reusar un refresco ya gastado se rechaza", r.status_code == 401, r.status_code)
        self._paso("y revoca TODAS las sesiones de la persona (el token nuevo deja de servir)", self._http("get", "/auth/yo/", token=acceso3).status_code == 401)
        eventos = set(EventoSeguridad.objects.filter(actor=ana).values_list("evento", flat=True))
        self._paso("el reuso quedó registrado como evento de seguridad", "refresh_reuso" in eventos)

        # ---------------------------------------------------------------- cierre de sesión y vencimiento
        # Emisión y validación con el MISMO reloj controlado
        with mock.patch("django.utils.timezone.now", return_value=ahora + timedelta(seconds=200)):
            r = self._http("post", "/auth/login/", {"username": "int_ana", "password": CLAVE_BUENA, "codigo": totp.at(ahora.timestamp() + 200)})
            acceso4 = r.json().get("access_token")
            self._paso("inicia otra sesión", r.status_code == 200, r.status_code)
            antes = self._http("get", "/auth/yo/", token=acceso4).status_code
            r = self._http("post", "/auth/logout/", token=acceso4)
            self._paso("cierra la sesión", r.status_code == 200 and antes == 200, f"yo={antes} logout={r.status_code}")
            self._paso("un token de una sesión cerrada deja de servir de inmediato (no espera a que venza)", self._http("get", "/auth/yo/", token=acceso4).status_code == 401)

        with mock.patch("django.utils.timezone.now", return_value=ahora + timedelta(seconds=300)):
            r = self._http("post", "/auth/login/", {"username": "int_ana", "password": CLAVE_BUENA, "codigo": totp.at(ahora.timestamp() + 300)})
            acceso5 = r.json().get("access_token")
        with mock.patch("django.utils.timezone.now", return_value=ahora + timedelta(seconds=300 + 601)):
            vencido = self._http("get", "/auth/yo/", token=acceso5).status_code
        self._paso("el token de acceso vence a los 10 minutos", vencido == 401, vencido)

        # ---------------------------------------------------------------- bloqueo por intentos
        self._http("post", "/auth/registro/", {"username": "int_beto", "password": CLAVE_BUENA})
        for _ in range(3):
            self._http("post", "/auth/login/", {"username": "int_beto", "password": "mala-mala-mala-1"})
        r = self._http("post", "/auth/login/", {"username": "int_beto", "password": CLAVE_BUENA})
        self._paso("tras 3 fallos, ni la contraseña correcta entra (bloqueo de 5 minutos)", r.status_code == 401, r.status_code)
        self._paso("el bloqueo no se distingue de una contraseña mala (misma respuesta)", r.json() == mala.json())
        with mock.patch("django.utils.timezone.now", return_value=timezone.now() + timedelta(seconds=301)):
            r = self._http("post", "/auth/login/", {"username": "int_beto", "password": CLAVE_BUENA})
        self._paso("pasados 5 minutos vuelve a poder entrar", r.status_code == 200, r.status_code)
        beto = Usuario.objects.get(username="int_beto")
        self._paso("al entrar se reinicia el contador de intentos", beto.intentos_fallidos == 0 and beto.bloqueado_hasta is None)

        # ---------------------------------------------------------------- cuenta suspendida
        self._http("post", "/auth/registro/", {"username": "int_carla", "password": CLAVE_BUENA})
        r = self._http("post", "/auth/login/", {"username": "int_carla", "password": CLAVE_BUENA})
        token_carla = r.json()["access_token"]
        Usuario.objects.filter(username="int_carla").update(estado_cuenta="suspendida")
        self._paso("suspender una cuenta invalida su sesión de inmediato", self._http("get", "/auth/yo/", token=token_carla).status_code == 401)
        r = self._http("post", "/auth/login/", {"username": "int_carla", "password": CLAVE_BUENA})
        self._paso("y no puede volver a entrar", r.status_code == 401)

        # ---------------------------------------------------------------- límite de tasa
        self._limpiar()
        codigos = [self.cliente.post("/auth/login/", {"username": "nadie", "password": "x"}, format="json", secure=True, **HOST).status_code for _ in range(12)]
        self._limpiar()
        self._paso("el límite de tasa corta una ráfaga de logins (429)", 429 in codigos and codigos[:10].count(429) == 0, f"{codigos.count(401)}x401, {codigos.count(429)}x429")

        # ---------------------------------------------------------------- registro de seguridad inalterable y datos
        n = EventoSeguridad.objects.count()
        self._paso("los eventos de seguridad quedaron registrados", n >= 20, f"{n} eventos")
        evento = EventoSeguridad.objects.first()
        try:
            evento.evento = "borrado"
            evento.save()
            self._paso("el ORM no modifica el registro de seguridad", False)
        except PermissionError:
            self._paso("el ORM no modifica el registro de seguridad", True)
        try:
            with transaction.atomic():
                EventoSeguridad.objects.filter(pk=evento.pk).update(evento="borrado")
            self._paso("la base no deja modificar el registro de seguridad", False)
        except DatabaseError:
            self._paso("la base no deja modificar el registro de seguridad", True)
        crudos = " ".join(str(v) for v in EventoSeguridad.objects.values_list("detalle", flat=True))
        self._paso("ningún evento contiene contraseñas, códigos ni tokens", CLAVE_BUENA not in crudos and secreto not in crudos)
        con_refresh_en_claro = Sesion.objects.filter(refresh_hash=refresh_viejo).count()
        self._paso("el token de refresco no está en claro en la base (solo su hash)", con_refresh_en_claro == 0)
        with connection.cursor() as c:
            c.execute("select current_user, (select rolsuper from pg_roles where rolname = current_user)")
            usuario_bd, es_super = c.fetchone()
        self._paso("todo se ejecutó como app_role, sin superusuario", usuario_bd == "app_role" and not es_super)
