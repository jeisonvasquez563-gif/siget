"""Consolas de plataforma: lógica pura (códigos de restablecimiento, secretos, validación de altas) y reglas del PDP."""
from datetime import date, datetime, timedelta, timezone

import pytest

from apps.autenticacion import restablecimiento as r
from apps.plataforma import secretos, servicio

AHORA = datetime(2026, 10, 22, 12, 0, tzinfo=timezone.utc)


# --------------------------------------------------------------------------- códigos de restablecimiento

def test_el_codigo_tiene_formato_alfabeto_sin_ambiguos_y_es_aleatorio():
    codigos = {r.nuevo_codigo() for _ in range(200)}
    assert len(codigos) == 200
    for c in codigos:
        assert len(c) == 14 and c.count("-") == 2
        assert set(c.replace("-", "")) <= set(r.ALFABETO)
        assert not set("01OIL") & set(c)


def test_normalizar_acepta_guiones_espacios_y_minusculas_y_rechaza_lo_demas():
    c = r.nuevo_codigo()
    assert r.normalizar(c) == c.replace("-", "")
    assert r.normalizar(c.lower()) == c.replace("-", "")
    assert r.normalizar("  " + c.replace("-", " ") + " ") == c.replace("-", "")
    for malo in (None, 123, "", "ABCD", "ABCD-EFGH-IJKL-MNPQ", "0000-0000-0000", "ABCD-EFGH-IJK!", ["A"], {"a": 1}):
        assert r.normalizar(malo) is None


def test_la_huella_es_sha256_estable_y_distinta_por_codigo():
    n = r.normalizar(r.nuevo_codigo())
    assert r.huella(n) == r.huella(n) and len(r.huella(n)) == 64 and n not in r.huella(n)
    assert r.huella(n) != r.huella(r.normalizar(r.nuevo_codigo()))


def test_el_codigo_vence_a_los_quince_minutos_y_no_sirve_dos_veces():
    vence = AHORA + r.VIGENCIA
    assert r.VIGENCIA == timedelta(minutes=15)
    assert r.vigente(vence, None, AHORA)
    assert r.vigente(vence, None, vence - timedelta(seconds=1))
    assert not r.vigente(vence, None, vence)
    assert not r.vigente(vence, AHORA, AHORA)  # ya usado


# --------------------------------------------------------------------------- secretos

def test_todo_secreto_tiene_nombre_frecuencia_y_lugar_pero_nunca_un_valor():
    assert set(secretos.SECRETOS) == {"jwt", "mfa", "db_app", "db_auditor", "django", "cert_nginx", "cert_postgres", "ca"}
    for nombre, frecuencia, donde in secretos.SECRETOS.values():
        assert nombre and frecuencia > 0 and donde


def test_estado_de_un_secreto_segun_su_ultima_rotacion():
    assert secretos.estado(None, 90, AHORA) == {"estado": "sin_registro", "dias_restantes": None}
    assert secretos.estado(AHORA - timedelta(days=10), 90, AHORA)["estado"] == "al_dia"
    assert secretos.estado(AHORA - timedelta(days=70), 90, AHORA)["estado"] == "por_vencer"
    assert secretos.estado(AHORA - timedelta(days=91), 90, AHORA) == {"estado": "vencida", "dias_restantes": -1}


def test_dias_hasta_el_vencimiento_del_certificado():
    assert secretos.dias_hasta(date(2027, 10, 20), date(2026, 10, 22)) == 363


# --------------------------------------------------------------------------- validación de altas

def test_alta_de_institucion_valida_nombre_y_tipo():
    ok, errores = servicio.validar_objetivo("alta_institucion", {"nombre": "  Ministerio de Cultura ", "tipo": "real"})
    assert errores == [] and ok == {"nombre": "Ministerio de Cultura", "tipo": "real"}
    for malo in ({"nombre": "", "tipo": "real"}, {"nombre": "ab", "tipo": "real"}, {"nombre": "<script>", "tipo": "real"},
                 {"nombre": "Ministerio", "tipo": "otro"}, {"nombre": "x" * 81, "tipo": "real"}, {"nombre": ["a"], "tipo": 1}, {}):
        assert servicio.validar_objetivo("alta_institucion", malo)[1], malo


def test_alta_de_coordinador_valida_usuario_e_institucion():
    ok, errores = servicio.validar_objetivo("alta_coordinador", {"usuario": " Ana.Perez ", "institucion_id": 3})
    assert errores == [] and ok == {"usuario": "ana.perez", "institucion_id": 3}
    for malo in ({"usuario": "", "institucion_id": 3}, {"usuario": "ana", "institucion_id": 0}, {"usuario": "ana", "institucion_id": True},
                 {"usuario": "ana", "institucion_id": "3"}, {"usuario": ["a"], "institucion_id": None}, {}):
        assert servicio.validar_objetivo("alta_coordinador", malo)[1], malo


def test_una_accion_desconocida_o_datos_que_no_son_un_objeto_no_rompen_nada():
    assert servicio.validar_objetivo("borrar_todo", {})[1]
    assert servicio.validar_objetivo("alta_institucion", "texto")[1]
    assert servicio.validar_objetivo("alta_coordinador", None)[1]


def test_el_objetivo_se_serializa_igual_sin_importar_el_orden_de_las_llaves():
    assert servicio.serializar({"b": 1, "a": 2}) == servicio.serializar({"a": 2, "b": 1})
    assert servicio._leer("{no es json") == {} and servicio._leer("[1]") == {}


# --------------------------------------------------------------------------- reglas del PDP para estas consolas

def _operador(rol, id=10, factor=True):
    from apps.autorizacion.pdp import Sujeto
    ultimo = AHORA - timedelta(minutes=1) if factor else None
    return Sujeto(id=id, rol_plataforma=rol, membresias=(), nivel_aseguramiento=2, mfa_verificado_en=ultimo)


def _decide(sujeto, accion, recurso):
    from apps.autorizacion.pdp import Entorno, decidir
    return decidir(sujeto, accion, recurso, Entorno(ahora=AHORA)).permitido


def test_cada_consola_solo_la_usa_su_rol_y_con_segundo_factor_reciente():
    from apps.autorizacion.pdp import Accion, Recurso
    quien = {Accion.RESTABLECER_MFA: "operador_identidades", Accion.BLOQUEAR_CUENTA: "operador_seguridad", Accion.REVOCAR_SESION: "operador_seguridad",
             Accion.ROTAR_SECRETOS: "custodio_secretos", Accion.ADMINISTRAR_INFRAESTRUCTURA: "operador_infraestructura"}
    roles = ["operador_identidades", "operador_seguridad", "custodio_secretos", "operador_infraestructura", "operador_catalogo", "auditor", "ninguno"]
    for accion, rol_ok in quien.items():
        for rol in roles:
            assert _decide(_operador(rol), accion, Recurso(tipo="usuario")) is (rol == rol_ok), (accion, rol)
        assert not _decide(_operador(rol_ok, factor=False), accion, Recurso(tipo="usuario")), "sin segundo factor reciente se niega"


def test_quien_propone_un_alta_no_la_aprueba_y_cada_operador_solo_su_tipo():
    from apps.autorizacion.pdp import Accion, Recurso
    propia = Recurso(tipo="alta_coordinador", propuesto_por=10)
    assert not _decide(_operador("operador_identidades", id=10), Accion.APROBAR_ALTA, propia)
    assert _decide(_operador("operador_identidades", id=11), Accion.APROBAR_ALTA, propia)
    assert not _decide(_operador("operador_catalogo", id=11), Accion.APROBAR_ALTA, propia)
    assert _decide(_operador("operador_catalogo", id=11), Accion.APROBAR_ALTA, Recurso(tipo="alta_institucion", propuesto_por=10))
    assert not _decide(_operador("operador_identidades", id=11), Accion.PROPONER_ALTA, Recurso(tipo="alta_institucion"))


def test_ninguna_consola_da_acceso_a_tramites():
    from apps.autorizacion.pdp import Accion, Recurso
    tramite = Recurso(tipo="tramite", institucion_id=1, solicitante_id=99)
    for rol in ("operador_identidades", "operador_seguridad", "custodio_secretos", "operador_infraestructura", "operador_catalogo"):
        for accion in (Accion.VER_TRAMITE, Accion.CAMBIAR_ESTADO, Accion.REASIGNAR_TRAMITE, Accion.VER_DOCUMENTO):
            assert not _decide(_operador(rol), accion, tramite), (rol, accion)


@pytest.mark.parametrize("ruta", ["personas/", "eventos/", "aprobaciones/", "secretos/", "infraestructura/"])
def test_las_rutas_de_plataforma_existen_y_son_privadas(ruta):
    from django.urls import resolve
    patron = resolve("/plataforma/" + ruta)
    assert any(c.__name__ == "_ExigeScope" for c in patron.func.view_class.permission_classes)
