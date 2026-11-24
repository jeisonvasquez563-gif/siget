"""Cambio de contraseña desde la sesión: regla del PDP, matriz, simulador, ruta y límite de tasa.

Sin base de datos: el recorrido real (contraseña actual, bloqueo progresivo, cierre de las demás sesiones) lo hace `verificar_autenticacion`.
"""
import secrets
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from django.conf import settings
from django.core.cache import cache
from django.urls import resolve, reverse
from rest_framework.test import APIRequestFactory, force_authenticate

from apps.autenticacion import contrasenas, servicio, tokens, vistas
from apps.autorizacion import matriz, simulador
from apps.autorizacion.pdp import Accion, Entorno, Recurso, Sujeto, decidir

AHORA = datetime(2026, 11, 24, 12, 0, tzinfo=timezone.utc)
ROLES_PLATAFORMA = [r[0] for r in matriz.ROLES[4:]]
NUEVA = "otra-frase-larga-y-poco-comun-5528"
ACTUAL = "Actual-" + secrets.token_urlsafe(12)  # generada al ejecutar: no queda ninguna contraseña escrita en el código


def sujeto(id=10, minutos=2, **kw):
    return Sujeto(id=id, mfa_verificado_en=None if minutos is None else AHORA - timedelta(minutes=minutos), **kw)


def cuenta(de=10):
    return Recurso(tipo="cuenta", solicitante_id=de)


def decide(s, r):
    return decidir(s, Accion.CAMBIAR_CONTRASENA, r, Entorno(ahora=AHORA))


def test_la_persona_cambia_su_propia_contrasena_con_segundo_factor_reciente():
    d = decide(sujeto(), cuenta())
    assert d.permitido and d.politica == "titular_cambia_su_contrasena"


def test_no_la_de_otra_persona():
    assert not decide(sujeto(), cuenta(de=11)).permitido


@pytest.mark.parametrize("minutos", [None, 16, 600])
def test_sin_segundo_factor_reciente_se_niega(minutos):
    assert not decide(sujeto(minutos=minutos), cuenta()).permitido


@pytest.mark.parametrize("rol", ROLES_PLATAFORMA)
def test_las_cuentas_de_plataforma_tambien_cambian_la_suya_y_solo_la_suya(rol):
    s = sujeto(rol_plataforma=rol, nivel_aseguramiento=3)
    assert decide(s, cuenta()).permitido
    assert not decide(s, cuenta(de=11)).permitido


def test_el_personal_de_una_institucion_tambien_la_cambia():
    assert decide(sujeto(membresias=frozenset({(3, "funcionario")})), cuenta()).permitido


def test_una_cuenta_bloqueada_o_suspendida_no_la_cambia():
    for estado in ("bloqueada", "suspendida"):
        d = decide(sujeto(estado_cuenta=estado), cuenta())
        assert not d.permitido and d.politica == "cuenta_no_activa"


def test_otro_tipo_de_recurso_no_sirve():
    assert not decide(sujeto(), Recurso(tipo="perfil", solicitante_id=10)).permitido


def test_la_matriz_la_calcula_para_los_diez_roles():
    M = matriz.construir()
    assert len(M["acciones"]) == len(Accion) == 27
    for rol in M["matriz"].values():
        celda = rol["cambiar_contrasena"]
        assert celda["favorable"]["permitido"] and not celda["desfavorable"]["permitido"] and celda["exige_segundo_factor"] is True
    assert next(a for a in M["acciones"] if a["id"] == "cambiar_contrasena")["grupo"] == "Cuenta"
    assert M["ningun_rol_puede_todo"] is True


def test_el_simulador_la_conoce_y_explica_el_resultado():
    assert len(simulador.meta()["variables"]) == 27
    entrada, errores = simulador.normalizar({"rol": "auditor", "accion": "cambiar_contrasena", "segundo_factor": "vencido"})
    assert errores == []
    r = simulador.simular(entrada, AHORA)
    assert r["decision"]["permitido"] is False
    assert {"variable": "segundo_factor", "valor": "reciente"}.items() <= next(a for a in r["alternativas"] if a["variable"] == "segundo_factor").items()
    ok = simulador.simular(simulador.normalizar({"rol": "ciudadano", "accion": "cambiar_contrasena"})[0], AHORA)
    assert ok["decision"]["politica"] == "titular_cambia_su_contrasena"
    assert simulador.normalizar({"rol": "ciudadano", "accion": "cambiar_contrasena", "cuenta_de": "alguien"})[0] is None


def test_la_ruta_exige_sesion_completa_y_no_corre_en_una_transaccion():
    url = reverse("contrasena")
    assert url == "/auth/contrasena/"
    clase = resolve(url).func.cls
    assert clase is vistas.CambiarContrasena
    assert [c.__name__ for c in clase.permission_classes] == ["_ExigeScope"]
    assert clase.as_view()._non_atomic_requests  # los intentos fallidos deben guardarse aunque la respuesta sea 400


def test_tiene_su_propio_limite_de_cinco_por_hora():
    assert settings.REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"]["contrasena"] == "5/hour"
    assert vistas.CambiarContrasena.throttle_classes == [vistas.TasaDeCambioDeContrasena]
    assert vistas.TasaDeCambioDeContrasena.scope == "contrasena"


# --------------------------------------------------------------------------- tope de 128 caracteres en la vista (sin base de datos)

@pytest.fixture
def vista(monkeypatch):
    """La vista con el servicio y el PDP sustituidos: solo se mira qué le llega al servicio y qué responde."""
    cache.clear()
    llamadas = []
    monkeypatch.setattr(vistas, "autorizar", lambda *a, **k: None)

    def falso(usuario_id, sesion_id, actual, nueva, ip, ahora=None):
        llamadas.append((actual, nueva))
        return servicio.Resultado(False, "credenciales_invalidas")

    monkeypatch.setattr(servicio, "cambiar_contrasena", falso)
    monkeypatch.setattr(contrasenas, "hashear", lambda *a: pytest.fail("no debe hashear en la vista"))
    principal = SimpleNamespace(usuario=SimpleNamespace(pk=7), claims=SimpleNamespace(sesion_id="s-1", scope=tokens.SCOPE_COMPLETO),
                                pk=7, is_authenticated=True)

    def llamar(cuerpo):
        peticion = APIRequestFactory().post("/auth/contrasena/", cuerpo, format="json")
        force_authenticate(peticion, user=principal)
        return vistas.CambiarContrasena.as_view()(peticion)

    yield llamar, llamadas
    cache.clear()


def test_una_nueva_de_mas_de_128_caracteres_se_rechaza_sin_llegar_al_servicio(vista):
    llamar, llamadas = vista
    r = llamar({"actual": "x" * 20, "nueva": "n" * 129})
    assert r.status_code == 400 and r.data["codigo"] == "datos_invalidos" and "128" in r.data["errores"][0]
    assert llamadas == []


def test_una_actual_de_mas_de_128_caracteres_se_trata_como_incorrecta_sin_hashearla(vista):
    llamar, llamadas = vista
    r = llamar({"actual": "a" * 6_000_000, "nueva": NUEVA})
    assert r.status_code == 400 and r.data["codigo"] == "credenciales_invalidas"
    assert llamadas == [(None, NUEVA)]  # el servicio nunca recibe los 6 MB


def test_si_sale_bien_la_respuesta_trae_los_tokens_nuevos_como_el_login(vista, monkeypatch):
    llamar, _ = vista
    monkeypatch.setattr(servicio, "cambiar_contrasena", lambda *a, **k: servicio.Resultado(
        True, "contrasena_cambiada", access="acceso-nuevo", refresh="refresco-nuevo", scope=tokens.SCOPE_COMPLETO, expira_en=600,
        detalle={"sesiones_cerradas": 2}))
    r = llamar({"actual": ACTUAL, "nueva": NUEVA})
    assert r.status_code == 200
    assert (r.data["access_token"], r.data["tipo"], r.data["expira_en"], r.data["scope"], r.data["sesiones_cerradas"]) == ("acceso-nuevo", "Bearer", 600, "completo", 2)
    assert "refresco-nuevo" not in str(r.data)  # el refresco viaja solo en la cookie
    cookie = r.cookies[settings.SIGET_COOKIE_REFRESH]
    assert cookie.value == "refresco-nuevo" and cookie["httponly"] and cookie["secure"] and cookie["samesite"] == "Strict" and cookie["path"] == "/auth/"


# --------------------------------------------------------------------------- servicio con la base sustituida

class _SinTransaccion:
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class _Consulta:
    def __init__(self, registro, modelo, pasos=()):
        self.registro, self.modelo, self.pasos = registro, modelo, pasos

    def filter(self, **kw):
        return _Consulta(self.registro, self.modelo, self.pasos + (("filter", kw),))

    def exclude(self, **kw):
        return _Consulta(self.registro, self.modelo, self.pasos + (("exclude", kw),))

    def values_list(self, *a, **k):
        return self

    def first(self):
        return AHORA + timedelta(hours=3)

    def exists(self):
        return False

    def update(self, **kw):
        self.registro.append((self.modelo, self.pasos, kw))
        return 2


class _Administrador:
    def __init__(self, registro, modelo):
        self.registro, self.modelo = registro, modelo

    def __getattr__(self, nombre):
        return getattr(_Consulta(self.registro, self.modelo), nombre)

    def get(self, **kw):
        return SimpleNamespace(pk="s-2")


class _Fabrica:
    """Sustituye la base: guarda cada UPDATE y cada evento de seguridad para comprobar qué se hizo."""

    def __init__(self, monkeypatch, usuario_intentos=0):
        self.actualizaciones, self.eventos = [], []
        self.usuario = SimpleNamespace(pk=1, username="ana", password_hash="h", intentos_fallidos=usuario_intentos, bloqueado_hasta=None)
        yo = self

        class _Seleccion:
            def filter(self, **kw):
                return SimpleNamespace(first=lambda: yo.usuario)

        usuarios = _Administrador(self.actualizaciones, "usuario")
        usuarios.select_for_update = lambda: _Seleccion()
        monkeypatch.setattr(servicio, "Usuario", SimpleNamespace(objects=usuarios))
        monkeypatch.setattr(servicio, "Sesion", SimpleNamespace(objects=_Administrador(self.actualizaciones, "sesion")))
        monkeypatch.setattr(servicio, "registrar_evento", lambda actor, evento, ip, detalle=None: self.eventos.append((evento, detalle)))
        monkeypatch.setattr(servicio.transaction, "atomic", lambda: _SinTransaccion())
        monkeypatch.setattr(servicio, "_scope_para", lambda usuario: tokens.SCOPE_COMPLETO)


def test_el_servicio_tampoco_hashea_una_actual_demasiado_larga(monkeypatch):
    verificadas = []
    monkeypatch.setattr(contrasenas, "verificar", lambda actual, h: verificadas.append(actual) or False)
    _Fabrica(monkeypatch)
    servicio.cambiar_contrasena(1, "s-1", "a" * 129, NUEVA, "10.0.0.1", AHORA)
    assert verificadas == [""]


def test_al_cambiarla_se_revoca_tambien_la_sesion_actual_y_se_abre_una_nueva(monkeypatch):
    f = _Fabrica(monkeypatch)
    monkeypatch.setattr(contrasenas, "verificar", lambda actual, h: actual == ACTUAL)
    monkeypatch.setattr(contrasenas, "hashear", lambda c: "hash:" + c)
    creadas = []

    def crear(usuario, scope, ip, ahora, evento, vencimiento_anterior=None):
        creadas.append((evento, vencimiento_anterior))
        return servicio.Resultado(True, evento, access="acceso-nuevo", refresh="refresco-nuevo", scope=scope, expira_en=600)

    monkeypatch.setattr(servicio, "_crear_sesion", crear)
    r = servicio.cambiar_contrasena(1, "s-1", ACTUAL, NUEVA, "10.0.0.1", AHORA)
    assert r.ok and (r.access, r.refresh, r.scope, r.expira_en) == ("acceso-nuevo", "refresco-nuevo", tokens.SCOPE_COMPLETO, 600)
    assert r.detalle == {"sesiones_cerradas": 2}
    sesiones = [(pasos, kw) for modelo, pasos, kw in f.actualizaciones if modelo == "sesion"]
    # las otras sesiones (todas menos la actual) quedan revocadas...
    assert any(("exclude", {"pk": "s-1"}) in pasos and kw == {"revocada": True} for pasos, kw in sesiones)
    # ...y también la actual, que además queda reemplazada por la nueva (reusar su refresco viejo dispara la revocación por reuso)
    assert any(("filter", {"pk": "s-1", "usuario_id": 1}) in pasos and kw == {"revocada": True} for pasos, kw in sesiones)
    assert any(("filter", {"pk": "s-1", "usuario_id": 1}) in pasos and getattr(kw.get("reemplazada_por"), "pk", None) == "s-2" for pasos, kw in sesiones)
    # la nueva hereda el vencimiento de la actual (no alarga la sesión) y queda constancia sin contraseñas
    assert creadas == [("sesion_nueva_tras_cambio_contrasena", AHORA + timedelta(hours=3))]
    assert ("contrasena_cambiada", {"sesiones_cerradas": 2}) in f.eventos


def test_con_datos_invalidos_no_se_revoca_ni_se_abre_nada(monkeypatch):
    f = _Fabrica(monkeypatch)
    monkeypatch.setattr(contrasenas, "verificar", lambda actual, h: actual == ACTUAL)
    monkeypatch.setattr(servicio, "_crear_sesion", lambda *a, **k: pytest.fail("no debe abrir sesión"))
    r = servicio.cambiar_contrasena(1, "s-1", ACTUAL, "corta", "10.0.0.1", AHORA)
    assert (r.ok, r.codigo) == (False, "datos_invalidos") and not r.access
    assert f.actualizaciones == []


def test_un_fallo_se_registra_como_cambio_contrasena_fallido_y_no_como_login(monkeypatch):
    f = _Fabrica(monkeypatch)
    monkeypatch.setattr(contrasenas, "verificar", lambda actual, h: False)
    r = servicio.cambiar_contrasena(1, "s-1", "mala-mala-mala-1", NUEVA, "10.0.0.1", AHORA)
    assert (r.ok, r.codigo) == (False, "credenciales_invalidas")
    assert f.eventos == [("cambio_contrasena_fallido", {"motivo": "contrasena_actual_incorrecta", "bloqueada": False})]
    assert ("usuario", (("filter", {"pk": 1}),), {"intentos_fallidos": 1, "bloqueado_hasta": None}) in f.actualizaciones


def test_el_tercer_fallo_bloquea_igual_que_antes_y_el_login_sigue_llamandose_login_fallido(monkeypatch):
    f = _Fabrica(monkeypatch, usuario_intentos=2)
    monkeypatch.setattr(contrasenas, "verificar", lambda actual, h: False)
    monkeypatch.setattr(servicio, "_bloqueos_recientes", lambda *a: 0)
    r = servicio.cambiar_contrasena(1, "s-1", "mala-mala-mala-1", NUEVA, "10.0.0.1", AHORA)
    assert not r.ok
    assert [e for e, _ in f.eventos] == ["cambio_contrasena_fallido", "cuenta_bloqueada"]
    assert f.eventos[0][1]["bloqueada"] is True
    assert ("usuario", (("filter", {"pk": 1}),), {"intentos_fallidos": 0, "bloqueado_hasta": AHORA + servicio.bloqueo.DURACION}) in f.actualizaciones
    f.eventos.clear()  # el login conserva su nombre de evento
    servicio._registrar_fallo(f.usuario, "10.0.0.1", AHORA, "contrasena_incorrecta")
    assert f.eventos[0][0] == "login_fallido"
