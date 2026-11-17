"""Recorrido completo de la autenticación por HTTP contra la base real, en una transacción que se revierte.

Usa el cliente de pruebas de DRF (las peticiones pasan por nginx-less pero por todo el resto: middleware,
autenticación, permisos, límites de tasa, servicios y base de datos). El reloj se controla para probar
vencimientos, bloqueos y la ventana del segundo factor. No deja ningún dato.
"""
from datetime import timedelta
from unittest import mock

import pyotp
from django.conf import settings
from django.core.cache import cache
from django.core.management.base import BaseCommand, CommandError
from django.db import DatabaseError, connection, transaction
from django.utils import timezone
from rest_framework.test import APIClient

from apps.autenticacion import contrasenas, derechos, mfa, perfil, tokens
from apps.autenticacion.models import EventoSeguridad, Sesion
from apps.catalogo.models import Institucion, TipoTramite
from apps.identidad.models import Membresia, Perfil, SolicitudDerecho, Usuario

CLAVE_BUENA = "una-frase-larga-y-poco-comun-7391"
HOST = {"HTTP_HOST": "localhost", "HTTP_X_REAL_IP": "198.51.100.7"}


def personales(n, **cambios):
    """Datos personales válidos y únicos por número (la cédula y el correo no pueden repetirse)."""
    base = {"nombre": "Prueba", "apellidos": "Integración", "cedula": f"8-900-{1000 + n}", "fecha_nacimiento": "1990-05-20",
            "provincia": "Panamá", "ciudad": "Ciudad de Panamá", "correo": f"prueba{n}@ejemplo.com", "acepta_aviso": True}
    base.update(cambios)
    return base


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
        r = getattr(cliente, metodo)(ruta, datos, format="json", secure=True, **cabeceras) if metodo in ("post", "patch") else \
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
        r = self._http("post", "/auth/registro/", {"username": "int_ana", "password": CLAVE_BUENA, **personales(1)})
        self._paso("registra una cuenta", r.status_code == 201, r.status_code)
        r = self._http("post", "/auth/registro/", {"username": "int_ana", "password": CLAVE_BUENA, **personales(9)})
        self._paso("no permite registrar dos veces el mismo usuario", r.status_code == 409, r.status_code)
        r = self._http("post", "/auth/registro/", {"username": "int_otra", "password": CLAVE_BUENA, **personales(9, cedula="8-900-1001")})
        self._paso("no permite repetir la cédula, y responde igual que un usuario repetido (no revela quién está registrado)",
                   r.status_code == 409 and r.json() == self._http("post", "/auth/registro/", {"username": "int_ana", "password": CLAVE_BUENA, **personales(9)}).json())
        r = self._http("post", "/auth/registro/", {"username": "int_otra", "password": CLAVE_BUENA, **personales(9, correo="PRUEBA1@ejemplo.com")})
        self._paso("no permite repetir el correo (sin distinguir mayúsculas)", r.status_code == 409, r.status_code)
        r = self._http("post", "/auth/registro/", {"username": "int_otra", "password": CLAVE_BUENA})
        self._paso("sin datos personales no se crea la cuenta", r.status_code == 400 and len(r.json()["errores"]) >= 7, r.status_code)
        r = self._http("post", "/auth/registro/", {"username": "int_menor", "password": CLAVE_BUENA, **personales(8, fecha_nacimiento="2015-01-01")})
        self._paso("una persona menor de 18 años no puede registrarse", r.status_code == 400, r.status_code)
        self._paso("las altas rechazadas no dejaron cuentas a medias (ni usuario ni perfil)",
                   not Usuario.objects.filter(username__in=["int_otra", "int_menor"]).exists() and not Perfil.objects.filter(correo__in=["prueba9@ejemplo.com", "prueba8@ejemplo.com"]).exists())
        ana = Usuario.objects.get(username="int_ana")
        perfil_ana = Perfil.objects.get(usuario=ana)
        self._paso("el perfil quedó guardado con sus datos", perfil_ana.nombre == "Prueba" and perfil_ana.provincia == "Panamá" and perfil_ana.correo == "prueba1@ejemplo.com")
        self._paso("el perfil guarda la constancia del aviso de privacidad (versión y hora) y aún no fue corregido",
                   perfil_ana.aviso_version == derechos.AVISO_VERSION and perfil_ana.aviso_leido_en is not None and perfil_ana.actualizado_en is None)
        self._paso("la cédula NO está en claro: solo cifrada y como huella", "8-900-1001" not in (perfil_ana.cedula_cifrada + perfil_ana.cedula_huella)
                   and len(perfil_ana.cedula_huella) == 64)
        self._paso("la cédula cifrada se puede recuperar con la clave del servidor",
                   perfil.descifrar_cedula(settings.SIGET_MFA_KEY, perfil_ana.cedula_cifrada) == "8-900-1001")
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

        # ---------------------------------------------------------------- inactividad y duración máxima de la sesión
        inicio = ahora + timedelta(seconds=400)
        with mock.patch("django.utils.timezone.now", return_value=inicio):
            r = self._http("post", "/auth/login/", {"username": "int_ana", "password": CLAVE_BUENA, "codigo": totp.at(inicio.timestamp())})
        original = Sesion.objects.get(usuario=ana, revocada=False, reemplazada_por__isnull=True, creado_en=inicio)
        with mock.patch("django.utils.timezone.now", return_value=inicio + timedelta(seconds=600)):
            r = self._http("post", "/auth/refresh/", HTTP_X_SIGET_CSRF="1")
        self._paso("quien sigue activo renueva sin problema (10 min después)", r.status_code == 200, r.status_code)
        renovada = Sesion.objects.get(usuario=ana, creado_en=inicio + timedelta(seconds=600))
        self._paso("la renovación hereda el vencimiento: la sesión no se puede prolongar renovándola", renovada.expira_en == original.expira_en,
                   f"{original.expira_en} / {renovada.expira_en}")
        with mock.patch("django.utils.timezone.now", return_value=inicio + timedelta(seconds=600 + 901)):
            r = self._http("post", "/auth/refresh/", HTTP_X_SIGET_CSRF="1")
        self._paso("tras más de 15 minutos sin actividad, el refresco se rechaza (sesión cerrada por inactividad)", r.status_code == 401, r.status_code)
        renovada.refresh_from_db()
        self._paso("esa sesión queda revocada en la base", renovada.revocada is True)
        eventos = set(EventoSeguridad.objects.filter(actor=ana).values_list("evento", flat=True))
        self._paso("el cierre por inactividad queda registrado como evento de seguridad", "sesion_cerrada_por_inactividad" in eventos)

        # ---------------------------------------------------------------- bloqueo por intentos
        self._http("post", "/auth/registro/", {"username": "int_beto", "password": CLAVE_BUENA, **personales(2)})
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

        # ---------------------------------------------------------------- bloqueo progresivo: 5 -> 15 -> 60 minutos
        self._http("post", "/auth/registro/", {"username": "int_dani", "password": CLAVE_BUENA, **personales(4)})
        dani = Usuario.objects.get(username="int_dani")
        mala_dani = {"username": "int_dani", "password": "mala-mala-mala-1"}
        buena_dani = {"username": "int_dani", "password": CLAVE_BUENA}

        def tres_fallos(instante):
            with mock.patch("django.utils.timezone.now", return_value=instante):
                for _ in range(3):
                    self._http("post", "/auth/login/", mala_dani)
            dani.refresh_from_db()
            return dani.bloqueado_hasta

        def entrar(instante):
            with mock.patch("django.utils.timezone.now", return_value=instante):
                return self._http("post", "/auth/login/", buena_dani).status_code

        t1 = timezone.now()
        self._paso("el primer bloqueo dura 5 minutos", tres_fallos(t1) == t1 + timedelta(minutes=5))
        t2 = t1 + timedelta(seconds=301)  # el primer bloqueo ya venció, pero se vuelve a fallar
        self._paso("el segundo bloqueo seguido dura 15 minutos", tres_fallos(t2) == t2 + timedelta(minutes=15))
        self._paso("a los 5 minutos del segundo bloqueo sigue bloqueada (ni la contraseña correcta entra)", entrar(t2 + timedelta(seconds=301)) == 401)
        t3 = t2 + timedelta(seconds=901)
        self._paso("el tercer bloqueo seguido dura 60 minutos", tres_fallos(t3) == t3 + timedelta(minutes=60))
        self._paso("a los 59 minutos del tercer bloqueo sigue bloqueada", entrar(t3 + timedelta(minutes=59)) == 401)
        minutos = list(EventoSeguridad.objects.filter(actor=dani, evento="cuenta_bloqueada").order_by("id").values_list("detalle__minutos", flat=True))
        self._paso("cada bloqueo quedó registrado con su duración", minutos == [5, 15, 60], minutos)
        t4 = t3 + timedelta(minutes=60, seconds=1)
        self._paso("pasada la hora vuelve a poder entrar", entrar(t4) == 200)
        t5 = t4 + timedelta(seconds=1)
        self._paso("un inicio de sesión exitoso reinicia la escalera: el siguiente bloqueo vuelve a durar 5 minutos", tres_fallos(t5) == t5 + timedelta(minutes=5))

        # ---------------------------------------------------------------- las tres puertas: ciudadanía, personal por institución y plataforma
        inst_a, inst_b = list(Institucion.objects.order_by("id")[:2])
        asignador = Usuario.objects.create(username="int_asig", password_hash=contrasenas.hashear(CLAVE_BUENA), estado_cuenta="suspendida")
        for nombre, rol in (("int_pc", "ninguno"), ("int_staff", "ninguno"), ("int_op", "operador_seguridad")):
            Usuario.objects.create(username=nombre, password_hash=contrasenas.hashear(CLAVE_BUENA), rol_plataforma=rol, nivel_aseguramiento=2)
        Membresia.objects.create(usuario=Usuario.objects.get(username="int_staff"), institucion=inst_a, rol="funcionario", asignado_por=asignador)

        def puerta(usuario, canal, institucion=None, clave=CLAVE_BUENA):
            cuerpo = {"username": usuario, "password": clave}
            if canal is not None:
                cuerpo["canal"] = canal
            if institucion is not None:
                cuerpo["institucion_id"] = institucion
            return self._http("post", "/auth/login/", cuerpo)

        self._paso("la lista pública de instituciones se ve sin iniciar sesión y trae solo id y nombre",
                   (lambda r: r.status_code == 200 and len(r.json()) >= 2 and all(set(i) == {"id", "nombre"} for i in r.json()))(self._http("get", "/auth/instituciones/")))
        self._paso("la ciudadanía entra por la puerta pública", puerta("int_pc", "ciudadania").status_code == 200)
        r = puerta("int_pc", "institucion", inst_a.pk)
        self._paso("pero no por la del personal: se le dice cuál es la suya y no se abre sesión",
                   r.status_code == 401 and r.json()["codigo"] == "canal_incorrecto" and r.json()["acceso_correcto"] == "ciudadania" and "access_token" not in r.json())
        self._paso("el personal entra por SU institución", puerta("int_staff", "institucion", inst_a.pk).status_code == 200)
        r = puerta("int_staff", "institucion", inst_b.pk)
        self._paso("no por otra institución: se le indica la suya", r.status_code == 401 and r.json()["acceso_correcto"] == "institucion" and r.json()["instituciones"] == [inst_a.nombre], r.json())
        self._paso("el personal no usa la puerta pública", puerta("int_staff", "ciudadania").json().get("codigo") == "canal_incorrecto")
        self._paso("un operador de plataforma entra por la suya y no por la pública",
                   puerta("int_op", "plataforma").status_code == 200 and puerta("int_op", "ciudadania").status_code == 401)
        self._paso("un cliente de la API sin `canal` entra como siempre", puerta("int_staff", None).status_code == 200)
        malo = puerta("int_staff", "administrador")
        self._paso("una puerta inexistente responde como cualquier credencial inválida", malo.status_code == 401 and malo.json()["codigo"] == "credenciales_invalidas")
        mala = puerta("int_staff", "ciudadania", clave="mala-mala-mala-1")
        self._paso("con contraseña mala la respuesta es la genérica: la puerta no se comprueba sin credenciales válidas (no filtra quién es personal)",
                   mala.status_code == 401 and mala.json()["codigo"] == "credenciales_invalidas" and "acceso_correcto" not in mala.json())
        for _ in range(4):
            puerta("int_staff", "ciudadania")
        self._paso("equivocarse de puerta no cuenta como intento fallido ni bloquea la cuenta", puerta("int_staff", "institucion", inst_a.pk).status_code == 200
                   and Usuario.objects.get(username="int_staff").intentos_fallidos == 0)
        eventos = set(EventoSeguridad.objects.filter(actor__username="int_staff").values_list("evento", flat=True))
        self._paso("entrar por la puerta equivocada queda registrado como evento de seguridad", "login_canal_incorrecto" in eventos)
        self._paso("y no se abrió ninguna sesión por esos intentos", Sesion.objects.filter(usuario__username="int_pc").count() == 1)

        # ---------------------------------------------------------------- cuenta suspendida
        self._http("post", "/auth/registro/", {"username": "int_carla", "password": CLAVE_BUENA, **personales(3)})
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

        self._derechos(ahora)

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
        for columna in ("nombre", "apellidos", "cedula_cifrada", "cedula_huella", "fecha_nacimiento", "creado_en", "aviso_version", "aviso_leido_en", "actualizado_en", "usuario_id"):
            try:
                with transaction.atomic(), connection.cursor() as c:
                    c.execute(f"update siget.perfil set {columna} = {columna}")
                self._paso(f"la base no deja modificar «{columna}» de un perfil (ni a la propia aplicación)", False)
            except DatabaseError:
                self._paso(f"la base no deja modificar «{columna}» de un perfil (ni a la propia aplicación)", True)
        try:
            with transaction.atomic(), connection.cursor() as c:
                c.execute("delete from siget.perfil")
            self._paso("la base no deja borrar un perfil (ni a la propia aplicación)", False)
        except DatabaseError:
            self._paso("la base no deja borrar un perfil (ni a la propia aplicación)", True)
        for columna in ("correo", "provincia", "ciudad"):
            try:
                with transaction.atomic(), connection.cursor() as c:
                    c.execute(f"update siget.perfil set {columna} = {columna} where usuario_id = %s", [ana.pk])
                    self._paso(f"en cambio sí deja modificar «{columna}» (la única corrección permitida)", c.rowcount == 1)
            except DatabaseError as error:
                self._paso(f"en cambio sí deja modificar «{columna}» (la única corrección permitida)", False, error)
        crudos = " ".join(str(v) for v in EventoSeguridad.objects.values_list("detalle", flat=True))
        self._paso("la bitácora de seguridad no lleva cédula, correo ni nombre", all(x not in crudos for x in ("8-900-", "@ejemplo.com", "Prueba")))
        self._paso("ningún evento contiene contraseñas, códigos ni tokens", CLAVE_BUENA not in crudos and secreto not in crudos)
        con_refresh_en_claro = Sesion.objects.filter(refresh_hash=refresh_viejo).count()
        self._paso("el token de refresco no está en claro en la base (solo su hash)", con_refresh_en_claro == 0)
        with connection.cursor() as c:
            c.execute("select current_user, (select rolsuper from pg_roles where rolname = current_user)")
            usuario_bd, es_super = c.fetchone()
        self._paso("todo se ejecutó como app_role, sin superusuario", usuario_bd == "app_role" and not es_super)

    # ------------------------------------------------------------------ derechos sobre los datos personales (PT-15, Ley 81)
    def _entrar(self, usuario, minutos_mfa=1, scope=tokens.SCOPE_COMPLETO):
        """Un token de acceso con una sesión real y el segundo factor verificado hace `minutos_mfa` (None = nunca)."""
        ahora = timezone.now()
        sesion = Sesion.objects.create(usuario=usuario, refresh_hash=tokens.hash_refresh(tokens.nuevo_refresh()), expira_en=ahora + timedelta(minutes=10))
        Usuario.objects.filter(pk=usuario.pk).update(mfa_verificado_en=None if minutos_mfa is None else ahora - timedelta(minutes=minutos_mfa))
        return tokens.emitir_access(settings.SIGET_JWT_KEY, usuario.pk, sesion.pk, scope, ahora, 600, settings.SIGET_EMISOR)

    def _ciudadana(self, n, username):
        """Se registra por la API (con aviso) y se le deja el segundo factor activo con un secreto conocido para reautenticar."""
        r = self._http("post", "/auth/registro/", {"username": username, "password": CLAVE_BUENA, **personales(n)})
        usuario = Usuario.objects.get(username=username)
        secreto = mfa.nuevo_secreto()
        Usuario.objects.filter(pk=usuario.pk).update(mfa_activo=True, mfa_secreto=mfa.cifrar(settings.SIGET_MFA_KEY, secreto))
        usuario.refresh_from_db()
        return usuario, secreto, r

    def _derechos(self, ahora):
        # ---------------------------------------------------------------- el aviso de privacidad y el registro
        r = self._http("get", "/auth/aviso-privacidad/")
        aviso = r.json() if r.status_code == 200 else {}
        self._paso("el aviso de privacidad se lee sin iniciar sesión y trae versión, finalidad de cada dato y el plazo de 10 días hábiles",
                   r.status_code == 200 and aviso.get("version") == derechos.AVISO_VERSION and aviso.get("plazo_respuesta_dias_habiles") == 10
                   and len(aviso.get("datos", [])) >= 6 and "10 días hábiles" in aviso.get("texto", ""), r.status_code)
        self._paso("el aviso no lleva datos de nadie", "@" not in aviso.get("texto", "") and "8-900-" not in aviso.get("texto", ""))
        sin_aviso = personales(30)
        sin_aviso.pop("acepta_aviso")
        r = self._http("post", "/auth/registro/", {"username": "int_sinaviso", "password": CLAVE_BUENA, **sin_aviso})
        self._paso("registrarse sin confirmar el aviso se rechaza con un mensaje claro", r.status_code == 400 and derechos.MENSAJE_ACEPTA_AVISO in r.json().get("errores", []), r.status_code)
        for valor in (False, "true", 1):
            r = self._http("post", "/auth/registro/", {"username": "int_sinaviso", "password": CLAVE_BUENA, **personales(30, acepta_aviso=valor)})
            self._paso(f"confirmar el aviso con {valor!r} (no es el booleano true) tampoco sirve", r.status_code == 400, r.status_code)
        self._paso("sin el aviso no se creó ni la cuenta ni el perfil", not Usuario.objects.filter(username="int_sinaviso").exists() and not Perfil.objects.filter(correo="prueba30@ejemplo.com").exists())

        luz, secreto_luz, r = self._ciudadana(20, "int_luz")
        mario, _, _ = self._ciudadana(21, "int_mario")
        self._paso("con el aviso confirmado el registro se completa y queda la constancia", r.status_code == 201 and Perfil.objects.get(usuario=luz).aviso_version == derechos.AVISO_VERSION)
        token_luz, token_mario = self._entrar(luz), self._entrar(mario)

        # ---------------------------------------------------------------- ver los propios datos
        self._paso("«Mis datos» exige iniciar sesión (401)", self._http("get", "/auth/mis-datos/").status_code == 401)
        enrolamiento = self._entrar(luz, scope=tokens.SCOPE_ENROLAR_MFA)
        self._paso("un token de enrolamiento (sin segundo factor activado) no abre «Mis datos» (403)", self._http("get", "/auth/mis-datos/", token=enrolamiento).status_code == 403)
        token_luz = self._entrar(luz)  # `_entrar` volvió a fijar la verificación
        r = self._http("get", "/auth/mis-datos/", token=token_luz)
        cuerpo = r.json() if r.status_code == 200 else {}
        self._paso("la persona ve su perfil completo y descifrado (es su propio dato)", r.status_code == 200 and cuerpo["perfil"]["cedula"] == "8-900-1020"
                   and cuerpo["perfil"]["correo"] == "prueba20@ejemplo.com" and cuerpo["perfil"]["nombre"] == "Prueba", r.status_code)
        self._paso("con los datos de la cuenta, el aviso vigente, la constancia de lectura y sus solicitudes",
                   cuerpo.get("cuenta", {}).get("usuario") == "int_luz" and cuerpo.get("aviso_vigente", {}).get("version") == derechos.AVISO_VERSION
                   and cuerpo.get("aviso_aceptado", {}).get("vigente") is True and cuerpo.get("solicitudes") == [] and cuerpo.get("tramites") == {"total": 0})
        self._paso("las respuestas con datos personales no se guardan en cachés", r.headers.get("Cache-Control") == "no-store")
        crudo = r.content.decode()
        self._paso("no devuelve credenciales ni la cédula cifrada o su huella", all(x not in crudo for x in ("password", "argon2", "mfa_secreto", "cedula_cifrada", "cedula_huella", secreto_luz)))
        self._paso("cada persona ve solo lo suyo", self._http("get", "/auth/mis-datos/", token=token_mario).json()["perfil"]["cedula"] == "8-900-1021")

        # ---------------------------------------------------------------- corregir correo, provincia y ciudad
        token_viejo = self._entrar(luz, minutos_mfa=60)
        r = self._http("patch", "/auth/mis-datos/", {"ciudad": "David"}, token=token_viejo)
        self._paso("corregir exige segundo factor reciente: se niega y se sugiere reautenticar", r.status_code == 403 and r.json().get("reautenticacion_sugerida") is True, r.status_code)
        self._paso("y no cambió nada", Perfil.objects.get(usuario=luz).ciudad == "Ciudad de Panamá")
        r = self._http("post", "/auth/mfa/verificar/", {"codigo": pyotp.TOTP(secreto_luz).at(timezone.now().timestamp())}, token=token_viejo)
        self._paso("reautenticarse con el código del segundo factor", r.status_code == 200, r.status_code)
        r = self._http("patch", "/auth/mis-datos/", {"correo": " Luz.Nueva@Ejemplo.COM ", "ciudad": "David", "provincia": "Chiriquí"}, token=token_viejo)
        fila = Perfil.objects.get(usuario=luz)
        self._paso("tras reautenticarse corrige correo, provincia y ciudad (con los mismos validadores del registro)",
                   r.status_code == 200 and sorted(r.json()["campos_cambiados"]) == ["ciudad", "correo", "provincia"]
                   and (fila.correo, fila.provincia, fila.ciudad) == ("luz.nueva@ejemplo.com", "Chiriquí", "David"), r.status_code)
        self._paso("la base sella `actualizado_en` (no depende de lo que mande la aplicación)", fila.actualizado_en is not None and abs((fila.actualizado_en - ahora).total_seconds()) < 600)
        self._paso("nombre, apellidos, cédula y fecha de nacimiento no cambiaron", (fila.nombre, fila.apellidos, fila.fecha_nacimiento.isoformat()) == ("Prueba", "Integración", "1990-05-20")
                   and perfil.descifrar_cedula(settings.SIGET_MFA_KEY, fila.cedula_cifrada) == "8-900-1020")
        evento = EventoSeguridad.objects.filter(actor=luz, evento="datos_personales_corregidos").first()
        self._paso("queda un evento de seguridad con los NOMBRES de los campos y nunca los valores",
                   evento is not None and evento.detalle == {"campos": ["ciudad", "correo", "provincia"]} and "luz.nueva" not in str(evento.detalle) and "David" not in str(evento.detalle))
        for cuerpo_malo, motivo in (({"nombre": "Otra Persona"}, "el nombre"), ({"cedula": "8-1-1"}, "la cédula"), ({"fecha_nacimiento": "1980-01-01"}, "la fecha de nacimiento"),
                                    ({"usuario_id": mario.pk, "ciudad": "David"}, "un identificador ajeno"), ({}, "un cuerpo vacío"),
                                    ({"correo": "malo"}, "un correo inválido"), ({"provincia": "Narnia"}, "una provincia inexistente"), ({"ciudad": "<script>"}, "una ciudad inválida")):
            r = self._http("patch", "/auth/mis-datos/", cuerpo_malo, token=token_viejo)
            self._paso(f"corregir {motivo} se rechaza (400)", r.status_code == 400 and r.json()["errores"], r.status_code)
        self._paso("lo rechazado no cambió nada ni tocó a otra persona", Perfil.objects.get(usuario=luz).nombre == "Prueba" and Perfil.objects.get(usuario=mario).ciudad == "Ciudad de Panamá")
        antes = EventoSeguridad.objects.filter(actor=luz, evento="datos_personales_corregidos").count()
        r = self._http("patch", "/auth/mis-datos/", {"ciudad": "David"}, token=token_viejo)
        self._paso("repetir el mismo valor no cambia nada ni deja un evento falso", r.status_code == 200 and r.json()["campos_cambiados"] == []
                   and EventoSeguridad.objects.filter(actor=luz, evento="datos_personales_corregidos").count() == antes)
        repetido = self._http("post", "/auth/registro/", {"username": "int_luz", "password": CLAVE_BUENA, **personales(40)})
        r = self._http("patch", "/auth/mis-datos/", {"correo": "PRUEBA21@Ejemplo.com"}, token=token_viejo)
        self._paso("un correo de otra cuenta responde igual que en el registro (409, mismo código, sin revelar de quién es)",
                   r.status_code == 409 and r.json()["codigo"] == repetido.json()["codigo"] == "usuario_existente" and "prueba21" not in str(r.json()), r.status_code)
        self._paso("y el perfil sigue como estaba", Perfil.objects.get(usuario=luz).correo == "luz.nueva@ejemplo.com")
        self._paso("sin sesión no se corrige (401)", self._http("patch", "/auth/mis-datos/", {"ciudad": "David"}).status_code == 401)

        # ---------------------------------------------------------------- portabilidad: exportar
        tipo = TipoTramite.objects.filter(audiencia__in=("ciudadania", "ambas")).order_by("id").first()
        r = self._http("post", "/tramites/", {"tipo_tramite": tipo.pk}, token=token_viejo)
        self._paso("(preparación) la persona inicia un trámite", r.status_code == 201, r.status_code)
        r = self._http("get", "/auth/mis-datos/exportar/", token=token_viejo)
        texto = r.content.decode()
        documento = r.json() if r.status_code == 200 else {}
        self._paso("exportar entrega un archivo JSON descargable que no se guarda en cachés",
                   r.status_code == 200 and r.headers.get("Content-Disposition", "").startswith("attachment;") and ".json" in r.headers.get("Content-Disposition", "")
                   and r.headers.get("Cache-Control") == "no-store", r.status_code)
        self._paso("trae el perfil, la cuenta, los trámites propios con su historial, las solicitudes y la actividad de seguridad",
                   documento.get("perfil", {}).get("cedula") == "8-900-1020" and documento.get("cuenta", {}).get("usuario") == "int_luz"
                   and len(documento.get("tramites", [])) == 1 and isinstance(documento["tramites"][0].get("historial"), list)
                   and "solicitudes" in documento and any(a["evento"] == "datos_personales_corregidos" for a in documento.get("actividad_de_seguridad", [])))
        self._paso("no trae datos de otra persona ni credenciales", all(x not in texto for x in ("8-900-1021", "prueba21@", "int_mario", "password", "argon2", "mfa_secreto", "cedula_huella", secreto_luz)))
        otro = self._http("get", "/auth/mis-datos/exportar/", token=token_mario).json()
        self._paso("los trámites de una persona no aparecen en la exportación de otra", otro["tramites"] == [] and otro["perfil"]["cedula"] == "8-900-1021")
        self._paso("«Mis datos» cuenta sus trámites", self._http("get", "/auth/mis-datos/", token=token_viejo).json()["tramites"] == {"total": 1})
        self._paso("exportar queda en los eventos de seguridad, sin contenido", EventoSeguridad.objects.filter(actor=luz, evento="datos_personales_exportados").exists()
                   and "8-900" not in str(list(EventoSeguridad.objects.filter(actor=luz, evento="datos_personales_exportados").values_list("detalle", flat=True))))

        # ---------------------------------------------------------------- solicitudes de rectificación, cancelación u oposición
        for malo, motivo in (({"tipo": "acceso", "detalle": "x" * 20}, "un tipo inexistente"), ({"tipo": "cancelacion", "detalle": "corto"}, "un detalle muy corto"),
                             ({"tipo": "cancelacion", "detalle": "x" * 1001}, "un detalle muy largo"), ({}, "un cuerpo vacío")):
            self._paso(f"una solicitud con {motivo} se rechaza (400)", self._http("post", "/auth/mis-datos/solicitudes/", malo, token=token_luz).status_code == 400)
        r = self._http("post", "/auth/mis-datos/solicitudes/", {"tipo": "rectificacion", "detalle": "Mi segundo apellido está mal escrito.", "usuario_id": mario.pk, "estado": "atendida"}, token=token_luz)
        sol = r.json() if r.status_code == 201 else {}
        fila_sol = SolicitudDerecho.objects.filter(usuario=luz).first()
        self._paso("crea una solicitud: queda «recibida», a nombre de quien llama (no de lo que diga el cuerpo)",
                   r.status_code == 201 and sol["estado"] == "recibida" and fila_sol is not None and fila_sol.estado == "recibida" and not SolicitudDerecho.objects.filter(usuario=mario).exists(), r.status_code)
        vence, creada = fila_sol.vence_en, fila_sol.creada_en
        self._paso("vence en 10 días hábiles (nunca en fin de semana)", vence.weekday() < 5 and 12 <= (vence - creada).days <= 14, f"{creada:%a %d-%m} -> {vence:%a %d-%m}")
        self._paso("cada persona ve solo sus solicitudes", len(self._http("get", "/auth/mis-datos/solicitudes/", token=token_luz).json()["solicitudes"]) == 1
                   and self._http("get", "/auth/mis-datos/solicitudes/", token=token_mario).json()["solicitudes"] == [])
        self._paso("el evento de seguridad no lleva el detalle de la solicitud (podría tener datos personales)",
                   EventoSeguridad.objects.filter(actor=luz, evento="solicitud_derecho_creada").exists()
                   and "apellido" not in str(list(EventoSeguridad.objects.filter(actor=luz, evento="solicitud_derecho_creada").values_list("detalle", flat=True))))
        for _ in range(2):
            self._http("post", "/auth/mis-datos/solicitudes/", {"tipo": "oposicion", "detalle": "No quiero que usen mis datos para otra cosa."}, token=token_luz)
        r = self._http("post", "/auth/mis-datos/solicitudes/", {"tipo": "cancelacion", "detalle": "Quiero cancelar mi cuenta, por favor."}, token=token_luz)
        self._paso(f"hay un tope de {derechos.MAX_SOLICITUDES_ABIERTAS} solicitudes abiertas por persona (409)", r.status_code == 409 and r.json()["codigo"] == "demasiadas_abiertas"
                   and SolicitudDerecho.objects.filter(usuario=luz).count() == derechos.MAX_SOLICITUDES_ABIERTAS, r.status_code)

        # ---------------------------------------------------------------- la base protege las solicitudes y el perfil
        operador = Usuario.objects.create(username="int_ident", password_hash=contrasenas.hashear(CLAVE_BUENA), rol_plataforma="operador_identidades", nivel_aseguramiento=2)
        abierta = SolicitudDerecho.objects.filter(usuario=luz).order_by("id").first()

        def rechazada_por_la_base(sql, parametros=()):
            try:
                with transaction.atomic(), connection.cursor() as c:
                    c.execute(sql, parametros)
                return False
            except DatabaseError:
                return True

        self._paso("la aplicación no puede borrar solicitudes", rechazada_por_la_base("delete from siget.solicitud_derecho"))
        for columna in ("detalle", "tipo", "usuario_id", "vence_en", "creada_en"):
            self._paso(f"ni modificar «{columna}» de una solicitud", rechazada_por_la_base(f"update siget.solicitud_derecho set {columna} = {columna}"))
        self._paso("una respuesta necesita quien responde y el texto (la base lo exige)",
                   rechazada_por_la_base("update siget.solicitud_derecho set estado = 'atendida' where id = %s", [abierta.pk])
                   and rechazada_por_la_base("update siget.solicitud_derecho set estado = 'atendida', respondida_por = %s where id = %s", [operador.pk, abierta.pk]))
        self._paso("nadie responde su propia solicitud (la base lo exige)",
                   rechazada_por_la_base("update siget.solicitud_derecho set estado = 'atendida', respondida_por = %s, respuesta = 'Respuesta de prueba.' where id = %s", [luz.pk, abierta.pk]))
        try:
            with transaction.atomic():
                filas = SolicitudDerecho.objects.filter(pk=abierta.pk).update(estado="atendida", respondida_por=operador, respuesta="Respuesta de prueba para la verificación.", respondida_en=ahora)
            self._paso("una respuesta completa sí se guarda", filas == 1)
        except DatabaseError as error:
            self._paso("una respuesta completa sí se guarda", False, error)
        self._paso("pero una solicitud ya respondida no se vuelve a tocar (ni para cambiar la respuesta)",
                   rechazada_por_la_base("update siget.solicitud_derecho set respuesta = 'Otra respuesta distinta.' where id = %s", [abierta.pk])
                   and rechazada_por_la_base("update siget.solicitud_derecho set estado = 'rechazada' where id = %s", [abierta.pk]))
        self._paso("y la base fijó la hora de la respuesta", SolicitudDerecho.objects.get(pk=abierta.pk).respondida_en is not None)
        self._paso("la persona ve la respuesta a su solicitud", any(x["respuesta"] == "Respuesta de prueba para la verificación." and x["estado"] == "atendida"
                                                                    for x in self._http("get", "/auth/mis-datos/solicitudes/", token=token_luz).json()["solicitudes"]))
        with connection.cursor() as c:
            c.execute("""select r.rolname, has_table_privilege(r.rolname, 'siget.solicitud_derecho', 'SELECT'), has_table_privilege(r.rolname, 'siget.solicitud_derecho', 'INSERT'),
                         has_table_privilege(r.rolname, 'siget.solicitud_derecho', 'DELETE'), has_table_privilege(r.rolname, 'siget.perfil', 'DELETE'),
                         has_column_privilege(r.rolname, 'siget.perfil', 'correo', 'UPDATE'), has_column_privilege(r.rolname, 'siget.perfil', 'provincia', 'UPDATE'),
                         has_column_privilege(r.rolname, 'siget.perfil', 'ciudad', 'UPDATE'), has_column_privilege(r.rolname, 'siget.perfil', 'nombre', 'UPDATE'),
                         has_column_privilege(r.rolname, 'siget.perfil', 'cedula_cifrada', 'UPDATE'), has_column_privilege(r.rolname, 'siget.perfil', 'actualizado_en', 'UPDATE')
                         from pg_roles r where r.rolname in ('app_role', 'auditor_role', 'pgadmin_lectura', 'checkpoint_app')""")
            privilegios = {f[0]: f[1:] for f in c.fetchall()}
        self._paso("ni el auditor, ni pgadmin_lectura ni el checkpoint leen las solicitudes (el detalle puede tener datos personales)",
                   not any(privilegios[rol][0] for rol in ("auditor_role", "pgadmin_lectura", "checkpoint_app")))
        self._paso("la aplicación lee e inserta solicitudes pero no las borra, ni borra perfiles",
                   privilegios["app_role"][0] and privilegios["app_role"][1] and not privilegios["app_role"][2] and not privilegios["app_role"][3])
        self._paso("de las columnas del perfil solo se pueden actualizar correo, provincia y ciudad",
                   privilegios["app_role"][4:7] == (True, True, True) and privilegios["app_role"][7:] == (False, False, False))
