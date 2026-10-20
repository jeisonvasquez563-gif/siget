"""Pruebas de la autenticación que no usan la base: tokens, TOTP, bloqueo, contraseñas y el permiso del PDP."""
import base64
import json
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import jwt
import pyotp
import pytest
from cryptography.fernet import Fernet

from apps.autenticacion import bloqueo, contrasenas, mfa, tokens
from apps.autorizacion import permisos as permisos_pdp
from apps.autorizacion.pdp import Accion, Recurso

AHORA = datetime(2026, 10, 20, 12, 0, 0, tzinfo=timezone.utc)
CLAVE = "clave-de-prueba-" + "x" * 32
EMISOR = "siget"


# --------------------------------------------------------------------------- tokens de acceso

def emitir(**kw):
    p = dict(clave=CLAVE, usuario_id=7, sesion_id="s-1", scope=tokens.SCOPE_COMPLETO, ahora=AHORA, ttl_segundos=600, emisor=EMISOR)
    p.update(kw)
    return tokens.emitir_access(p["clave"], p["usuario_id"], p["sesion_id"], p["scope"], p["ahora"], p["ttl_segundos"], p["emisor"])


def test_el_token_de_acceso_se_emite_y_se_valida():
    c = tokens.decodificar_access(CLAVE, emitir(), AHORA + timedelta(minutes=5), EMISOR)
    assert (c.usuario_id, c.sesion_id, c.scope) == (7, "s-1", "completo")


@pytest.mark.parametrize("segundos,valido", [(599, True), (600, False), (601, False), (3600, False)])
def test_el_token_vence_exactamente_a_los_diez_minutos(segundos, valido):
    token = emitir()
    ahora = AHORA + timedelta(seconds=segundos)
    if valido:
        assert tokens.decodificar_access(CLAVE, token, ahora, EMISOR)
    else:
        with pytest.raises(tokens.TokenInvalido):
            tokens.decodificar_access(CLAVE, token, ahora, EMISOR)


@pytest.mark.parametrize("adelanto,valido", [(60, True), (120, True), (121, False), (3600, False)])
def test_un_token_del_futuro_solo_se_tolera_un_ajuste_pequeno_de_reloj(adelanto, valido):
    token = emitir(ahora=AHORA + timedelta(seconds=adelanto))
    if valido:
        assert tokens.decodificar_access(CLAVE, token, AHORA, EMISOR)
    else:
        with pytest.raises(tokens.TokenInvalido):
            tokens.decodificar_access(CLAVE, token, AHORA, EMISOR)


def test_una_clave_distinta_lo_rechaza():
    with pytest.raises(tokens.TokenInvalido):
        tokens.decodificar_access("otra-clave-" + "y" * 32, emitir(), AHORA, EMISOR)


def test_un_emisor_distinto_lo_rechaza():
    with pytest.raises(tokens.TokenInvalido):
        tokens.decodificar_access(CLAVE, emitir(emisor="otro-sistema"), AHORA, EMISOR)


def test_ataque_de_algoritmo_none_se_rechaza():
    def b64(d):
        return base64.urlsafe_b64encode(json.dumps(d).encode()).rstrip(b"=").decode()
    sin_firma = b64({"alg": "none", "typ": "JWT"}) + "." + b64({"iss": EMISOR, "sub": "7", "sid": "s", "scope": "completo",
                                                                "iat": int(AHORA.timestamp()), "exp": int(AHORA.timestamp()) + 600}) + "."
    with pytest.raises(tokens.TokenInvalido):
        tokens.decodificar_access(CLAVE, sin_firma, AHORA, EMISOR)


def test_un_algoritmo_distinto_del_fijado_se_rechaza():
    token = jwt.encode({"iss": EMISOR, "sub": "7", "sid": "s", "scope": "completo", "iat": int(AHORA.timestamp()),
                        "exp": int(AHORA.timestamp()) + 600}, CLAVE, algorithm="HS512")
    with pytest.raises(tokens.TokenInvalido):
        tokens.decodificar_access(CLAVE, token, AHORA, EMISOR)


def test_un_token_alterado_se_rechaza():
    t = emitir()
    cabecera, cuerpo, firma = t.split(".")
    alterado = ".".join([cabecera, cuerpo[:-3] + ("AAA" if not cuerpo.endswith("AAA") else "BBB"), firma])
    with pytest.raises(tokens.TokenInvalido):
        tokens.decodificar_access(CLAVE, alterado, AHORA, EMISOR)


@pytest.mark.parametrize("basura", ["", "abc", "a.b.c", "Bearer x", None, 123])
def test_basura_se_rechaza_sin_romper(basura):
    with pytest.raises(tokens.TokenInvalido):
        tokens.decodificar_access(CLAVE, basura, AHORA, EMISOR)


def test_faltan_claims_obligatorios():
    token = jwt.encode({"iss": EMISOR, "sub": "7", "exp": int(AHORA.timestamp()) + 600}, CLAVE, algorithm="HS256")
    with pytest.raises(tokens.TokenInvalido):
        tokens.decodificar_access(CLAVE, token, AHORA, EMISOR)


def test_scope_desconocido_no_se_emite_ni_se_acepta():
    with pytest.raises(ValueError):
        emitir(scope="administrador")
    token = jwt.encode({"iss": EMISOR, "sub": "7", "sid": "s", "scope": "administrador", "iat": int(AHORA.timestamp()),
                        "exp": int(AHORA.timestamp()) + 600}, CLAVE, algorithm="HS256")
    with pytest.raises(tokens.TokenInvalido):
        tokens.decodificar_access(CLAVE, token, AHORA, EMISOR)


def test_el_refresh_es_aleatorio_y_solo_se_guarda_su_hash():
    a, b = tokens.nuevo_refresh(), tokens.nuevo_refresh()
    assert a != b and len(a) >= 60
    assert tokens.hash_refresh(a) == tokens.hash_refresh(a) != tokens.hash_refresh(b)
    assert a not in tokens.hash_refresh(a) and len(tokens.hash_refresh(a)) == 64


# --------------------------------------------------------------------------- segundo factor

SECRETO = pyotp.random_base32()


def codigo_en(ahora, secreto=SECRETO):
    return pyotp.TOTP(secreto).at(int(ahora.timestamp()))


def test_un_codigo_vigente_es_valido():
    assert mfa.paso_valido(SECRETO, codigo_en(AHORA), AHORA, None) == int(AHORA.timestamp()) // 30


@pytest.mark.parametrize("desfase_s,valido", [(-30, True), (30, True), (-60, False), (60, False), (-90, False)])
def test_la_ventana_acepta_un_paso_de_desfase_y_no_mas(desfase_s, valido):
    codigo = codigo_en(AHORA + timedelta(seconds=desfase_s))
    assert (mfa.paso_valido(SECRETO, codigo, AHORA, None) is not None) is valido


def test_un_codigo_no_sirve_dos_veces():
    paso = mfa.paso_valido(SECRETO, codigo_en(AHORA), AHORA, None)
    assert mfa.paso_valido(SECRETO, codigo_en(AHORA), AHORA, paso) is None


def test_un_codigo_viejo_no_sirve_aunque_este_en_la_ventana():
    paso_actual = int(AHORA.timestamp()) // 30
    codigo_anterior = codigo_en(AHORA - timedelta(seconds=30))
    assert mfa.paso_valido(SECRETO, codigo_anterior, AHORA, paso_actual) is None


@pytest.mark.parametrize("codigo", ["", "12345", "1234567", "abcdef", "12 456", None, 123456, "１２３４５６"])
def test_codigos_mal_formados_se_rechazan(codigo):
    assert mfa.paso_valido(SECRETO, codigo, AHORA, None) is None


def test_un_codigo_de_otro_secreto_no_sirve():
    assert mfa.paso_valido(SECRETO, codigo_en(AHORA, pyotp.random_base32()), AHORA, None) is None


def test_el_secreto_se_cifra_y_no_se_ve_en_claro():
    clave = Fernet.generate_key().decode()
    cifrado = mfa.cifrar(clave, SECRETO)
    assert SECRETO not in cifrado
    assert mfa.descifrar(clave, cifrado) == SECRETO


def test_con_otra_clave_no_se_descifra():
    cifrado = mfa.cifrar(Fernet.generate_key().decode(), SECRETO)
    with pytest.raises(mfa.ErrorDeCifrado):
        mfa.descifrar(Fernet.generate_key().decode(), cifrado)


def test_la_uri_de_aprovisionamiento_sirve_para_una_app_de_autenticacion():
    uri = mfa.uri_de_aprovisionamiento(SECRETO, "ana")
    assert uri.startswith("otpauth://totp/") and "issuer=SIGET" in uri and f"secret={SECRETO}" in uri


# --------------------------------------------------------------------------- bloqueo

def test_los_dos_primeros_fallos_no_bloquean():
    assert bloqueo.tras_fallo(0, AHORA) == (1, None)
    assert bloqueo.tras_fallo(1, AHORA) == (2, None)


def test_el_tercer_fallo_bloquea_cinco_minutos_y_reinicia_el_contador():
    assert bloqueo.tras_fallo(2, AHORA) == (0, AHORA + timedelta(minutes=5))


@pytest.mark.parametrize("segundos,bloqueada", [(0, True), (299, True), (300, False), (301, False)])
def test_el_bloqueo_dura_exactamente_cinco_minutos(segundos, bloqueada):
    assert bloqueo.esta_bloqueado(AHORA + timedelta(minutes=5), AHORA + timedelta(seconds=segundos)) is bloqueada


def test_sin_bloqueo_registrado_no_esta_bloqueada():
    assert bloqueo.esta_bloqueado(None, AHORA) is False


# --------------------------------------------------------------------------- contraseñas

def test_la_politica_exige_longitud():
    assert contrasenas.errores_de_contrasena("corta", "ana")
    assert not contrasenas.errores_de_contrasena("una-frase-larga-y-poco-comun-7391", "ana")


@pytest.mark.parametrize("mala", ["passwordpassword", "1234567890123", "qwertyuiopasdf", "aaaaaaaaaaaaaaa"])
def test_rechaza_contrasenas_comunes_o_repetitivas(mala):
    assert contrasenas.errores_de_contrasena(mala, "ana")


def test_no_puede_contener_el_usuario():
    assert any("usuario" in e for e in contrasenas.errores_de_contrasena("ana-garcia-2026-xyz", "ana"))


@pytest.mark.parametrize("no_texto", [None, 12345678901234, [], {}])
def test_lo_que_no_es_texto_se_rechaza(no_texto):
    assert contrasenas.errores_de_contrasena(no_texto, "ana")


def test_el_hash_es_argon2_y_se_verifica():
    h = contrasenas.hashear("una-frase-larga-y-poco-comun-7391")
    assert h.startswith("argon2$")
    assert contrasenas.verificar("una-frase-larga-y-poco-comun-7391", h)
    assert not contrasenas.verificar("otra-frase-larga-y-poco-comun-1", h)


def test_la_verificacion_falsa_siempre_falla():
    assert contrasenas.verificacion_falsa("lo-que-sea") is False


# --------------------------------------------------------------------------- permiso del PDP

class VistaDePrueba:
    accion_pdp = Accion.VER_TRAMITE

    @staticmethod
    def recurso_pdp(request):
        return Recurso(tipo="tramite", institucion_id=3, solicitante_id=99)


def peticion(scope="completo", mfa_en=None):
    usuario = SimpleNamespace(pk=7, id=7, estado_cuenta="activa", nivel_aseguramiento=1, rol_plataforma="ninguno", mfa_verificado_en=mfa_en, mfa_activo=True)
    return SimpleNamespace(user=SimpleNamespace(usuario=usuario, claims=SimpleNamespace(scope=scope)))


@pytest.fixture
def decisiones(monkeypatch):
    guardadas = []
    monkeypatch.setattr(permisos_pdp, "_membresias", lambda u: [(3, "funcionario")])
    monkeypatch.setattr(permisos_pdp, "_registrar_decision", lambda actor, accion, recurso, d: guardadas.append((actor, accion, d)))
    return guardadas


def test_el_pdp_permite_y_registra(decisiones):
    assert permisos_pdp.PermisoPDP().has_permission(peticion(), VistaDePrueba) is True
    assert decisiones[0][2].permitido and decisiones[0][1] == Accion.VER_TRAMITE


def test_una_negacion_tambien_se_registra(decisiones, monkeypatch):
    monkeypatch.setattr(permisos_pdp, "_membresias", lambda u: [])
    assert permisos_pdp.PermisoPDP().has_permission(peticion(), VistaDePrueba) is False
    assert len(decisiones) == 1 and decisiones[0][2].permitido is False


def test_un_token_de_enrolamiento_no_sirve_para_el_pdp(decisiones):
    assert permisos_pdp.PermisoPDP().has_permission(peticion(scope="enrolar_mfa"), VistaDePrueba) is False
    assert decisiones == []


def test_sin_autenticar_se_niega(decisiones):
    assert permisos_pdp.PermisoPDP().has_permission(SimpleNamespace(user=None), VistaDePrueba) is False


def test_una_vista_sin_declaracion_explicita_se_niega(decisiones):
    class SinDeclarar:
        pass
    assert permisos_pdp.PermisoPDP().has_permission(peticion(), SinDeclarar) is False


def test_si_no_se_puede_registrar_la_decision_se_niega(monkeypatch):
    monkeypatch.setattr(permisos_pdp, "_membresias", lambda u: [(3, "funcionario")])

    def falla(*a):
        raise RuntimeError("la base no responde")
    monkeypatch.setattr(permisos_pdp, "_registrar_decision", falla)
    assert permisos_pdp.PermisoPDP().has_permission(peticion(), VistaDePrueba) is False


def test_las_decisiones_usan_la_conexion_aparte_en_autocommit():
    from django.conf import settings
    assert settings.DATABASES["decisiones"]["ATOMIC_REQUESTS"] is False
    assert settings.DATABASES["default"]["ATOMIC_REQUESTS"] is True
