"""Contenido del trámite en la API: datos del formulario, motivo de las decisiones y respuesta a la subsanación.

Sin base de datos: el ORM, el contexto de seguridad por filas y el PDP se sustituyen por dobles que registran lo que la vista les pide. Lo
que decide la base (RLS, triggers, límites) lo prueba `verificar_tramites` contra la base real.
"""
from contextlib import contextmanager
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from django.db import DatabaseError, IntegrityError
from django.urls import reverse
from rest_framework.test import APIRequestFactory, force_authenticate

from apps.autorizacion.pdp import Accion
from apps.autorizacion.permisos import AccesoDenegado
from apps.tramites import serializacion as ser
from apps.tramites import vistas

AHORA = datetime(2026, 11, 24, 12, 0, tzinfo=timezone.utc)
FORMULARIO = [
    {"id": "asunto", "etiqueta": "Asunto", "tipo": "texto", "obligatorio": True, "max": 150},
    {"id": "descripcion", "etiqueta": "Descripción", "tipo": "texto_largo", "obligatorio": False, "max": 2000},
]
MOTIVO = "Falta el plano firmado del terreno."


class Registro:
    """Lo que la vista le pidió al doble de la base, en orden."""

    def __init__(self):
        self.pasos = []
        self.filas = 1
        self.fallo = None
        self.fallo_crear = None


@pytest.fixture
def registro(monkeypatch):
    reg = Registro()
    tramite = {"estado": "En Tramitacion", "datos": {"asunto": "Antes"}, "solicitante_id": 7}

    def un_tramite(pk=5, **cambios):
        base = dict(pk=pk, tipo_tramite_id=1, tipo_tramite=SimpleNamespace(nombre="Demo", formulario=FORMULARIO), institucion_id=3,
                    institucion=SimpleNamespace(nombre="MOP"), fecha_limite=AHORA, creado_en=AHORA, funcionario_asignado_id=None,
                    sensibilidad=1, escalado_en=None, **{**tramite, **cambios})
        return SimpleNamespace(**base)

    reg.tramite = tramite
    reg.un_tramite = un_tramite

    class Consulta:
        def __init__(self, filtros):
            self.filtros = filtros

        def update(self, **cambios):
            reg.pasos.append(("update", self.filtros, cambios))
            if reg.fallo:
                raise reg.fallo
            return reg.filas

    def crear_tramite(**campos):
        reg.pasos.append(("crear", campos))
        if reg.fallo_crear:
            raise reg.fallo_crear
        return un_tramite(pk=50, datos=campos["datos"])

    class FalsoTramite:
        objects = SimpleNamespace(filter=lambda **filtros: Consulta(filtros), create=crear_tramite)

    @contextmanager
    def atomico():
        reg.pasos.append(("inicio",))
        yield

    monkeypatch.setattr(vistas, "Tramite", FalsoTramite)
    monkeypatch.setattr(vistas, "transaction", SimpleNamespace(atomic=atomico))
    monkeypatch.setattr(vistas, "registrar_evento", lambda actor, evento, ip, detalle=None: reg.pasos.append(("seguridad", actor, evento, detalle)))
    monkeypatch.setattr(vistas, "_fijar_motivo", lambda motivo: reg.pasos.append(("motivo", motivo)))
    monkeypatch.setattr(vistas, "_membresias", lambda usuario: [])
    monkeypatch.setattr(vistas, "fijar_contexto", lambda *a: None)
    monkeypatch.setattr(vistas._Base, "throttle_classes", [])
    monkeypatch.setattr(vistas._Base, "_tramite_visible", lambda self, pk: un_tramite(pk=pk))
    monkeypatch.setattr(vistas, "autorizar", lambda request, accion, recurso: reg.pasos.append(("pdp", accion, recurso)))
    tipo = SimpleNamespace(pk=1, institucion_id=3, institucion=SimpleNamespace(nombre="MOP"), audiencia="ciudadania", sla_dias=10, formulario=FORMULARIO, activo=True)
    monkeypatch.setattr(vistas, "TipoTramite", SimpleNamespace(objects=SimpleNamespace(
        select_related=lambda *a: SimpleNamespace(filter=lambda **k: SimpleNamespace(first=lambda: tipo if k.get("pk") == 1 else None)))))
    monkeypatch.setattr(vistas, "feriados_entre", lambda *a: set())
    monkeypatch.setattr(vistas, "EventoAuditoria", SimpleNamespace(objects=SimpleNamespace(create=lambda **k: reg.pasos.append(("evento", k)))))
    return reg


def llamar(vista, cuerpo, **kwargs):
    peticion = APIRequestFactory().post("/x/", cuerpo, format="json", secure=True, HTTP_X_REAL_IP="198.51.100.9")
    principal = SimpleNamespace(usuario=SimpleNamespace(pk=7), claims=SimpleNamespace(scope="completo"), is_authenticated=True, pk=7)
    force_authenticate(peticion, user=principal)
    return vista.as_view()(peticion, **kwargs)


def estado(cuerpo):
    return llamar(vistas.TramiteEstado, cuerpo, pk=5)


def subsanacion(cuerpo):
    return llamar(vistas.TramiteSubsanacion, cuerpo, pk=5)


def crear(cuerpo):
    return llamar(vistas.TramitesColeccion, cuerpo)


def pasos(registro, nombre):
    return [p for p in registro.pasos if p[0] == nombre]


# --------------------------------------------------------------------------- crear con datos

def test_crear_con_datos_validos_los_guarda_normalizados(registro):
    r = crear({"tipo_tramite": 1, "datos": {"asunto": "  Bache en la vía  ", "descripcion": ""}})
    assert r.status_code == 201
    assert pasos(registro, "crear")[0][1]["datos"] == {"asunto": "Bache en la vía"}
    assert r.data["formulario"] == FORMULARIO and "datos" in r.data


def test_crear_consulta_al_pdp_antes_de_validar_los_datos(registro):
    crear({"tipo_tramite": 1, "datos": {"asunto": ""}})
    assert pasos(registro, "pdp")[0][1] == Accion.CREAR_TRAMITE
    assert not pasos(registro, "crear")


def test_crear_sin_datos_obligatorios_da_400_con_el_error_por_campo(registro):
    for cuerpo in ({"tipo_tramite": 1}, {"tipo_tramite": 1, "datos": {}}, {"tipo_tramite": 1, "datos": {"asunto": "   "}}):
        r = crear(cuerpo)
        assert r.status_code == 400 and r.data["codigo"] == "datos_invalidos" and r.data["errores"] == {"asunto": "Este campo es obligatorio."}
    assert not pasos(registro, "crear")


@pytest.mark.parametrize("datos", [[], "x", 5, None, [{"asunto": "a"}], {"asunto": ["a"]}, {"asunto": {"a": 1}}, {"asunto": 5}, {"asunto": "x" * 100_000},
                                   {"asunto": "a\u202eb"}, {"asunto": "a\x00b"}, {"asunto": "ok", "cedula": "8-123-456"}, {"asunto": "ok", "descripcion": {"a": {"b": {"c": 1}}}}])
def test_crear_rechaza_datos_hostiles_sin_tocar_la_base(registro, datos):
    r = crear({"tipo_tramite": 1, "datos": datos})
    assert r.status_code == 400 and r.data["codigo"] == "datos_invalidos" and r.data["errores"]
    assert not pasos(registro, "crear")


def test_crear_no_repite_en_la_respuesta_los_campos_desconocidos(registro):
    r = crear({"tipo_tramite": 1, "datos": {"asunto": "ok", "cedula": "8-123-456"}})
    assert r.status_code == 400 and "8-123-456" not in str(r.data) and "cedula" not in str(r.data)


def test_crear_rechaza_un_obligatorio_de_solo_caracteres_invisibles(registro):
    r = crear({"tipo_tramite": 1, "datos": {"asunto": "‍‌‍"}})
    assert r.status_code == 400 and "asunto" in r.data["errores"] and not pasos(registro, "crear")


def test_si_el_check_de_tamano_de_la_base_salta_responde_400_y_no_500(registro):
    registro.fallo_crear = IntegrityError('new row for relation "tramite" violates check constraint "tramite_datos_tamano"')
    r = crear({"tipo_tramite": 1, "datos": {"asunto": "ok"}})
    assert r.status_code == 400 and r.data["codigo"] == "datos_invalidos" and "datos" in r.data["errores"]
    assert not pasos(registro, "evento")  # no se audita una creación que no ocurrió


def test_otro_fallo_de_integridad_al_crear_no_se_disfraza_de_400(registro):
    registro.fallo_crear = IntegrityError('insert or update on table "tramite" violates foreign key constraint "tramite_x_fkey"')
    with pytest.raises(IntegrityError):
        crear({"tipo_tramite": 1, "datos": {"asunto": "ok"}})


def test_el_tope_de_python_deja_margen_bajo_el_check_de_la_base():
    from apps.tramites import formulario
    assert formulario.TAMANO_MAXIMO_DATOS == 15000 < formulario.TAMANO_BASE_DATOS == 16384


def test_un_formulario_mal_definido_da_503_con_un_evento_de_seguridad_sin_datos_personales(registro, monkeypatch):
    mal = [{"id": "Asunto Con Espacios", "tipo": "inventado"}]
    tipo = SimpleNamespace(pk=1, institucion_id=3, institucion=SimpleNamespace(nombre="MOP"), audiencia="ciudadania", sla_dias=10, formulario=mal, activo=True)
    monkeypatch.setattr(vistas, "TipoTramite", SimpleNamespace(objects=SimpleNamespace(
        select_related=lambda *a: SimpleNamespace(filter=lambda **k: SimpleNamespace(first=lambda: tipo)))))
    r = crear({"tipo_tramite": 1, "datos": {"asunto": "Mi dato personal 8-123-456"}})
    assert r.status_code == 503 and r.data["codigo"] == "formulario_no_disponible"
    assert "Asunto Con Espacios" not in str(r.data) and "8-123-456" not in str(r.data)  # no se filtra la definición ni lo recibido
    assert not pasos(registro, "crear")
    evento = pasos(registro, "seguridad")[0]
    assert evento[1:3] == (7, "formulario_no_disponible") and evento[3] == {"tipo_tramite": 1} and "8-123-456" not in str(evento)


def test_crear_ignora_el_resto_del_cuerpo(registro):
    crear({"tipo_tramite": 1, "datos": {"asunto": "ok"}, "estado": "Aprobado", "solicitante_id": 99})
    campos = pasos(registro, "crear")[0][1]
    assert "estado" not in campos and campos["solicitante"].pk == 7


# --------------------------------------------------------------------------- estado y motivo

@pytest.mark.parametrize("destino,desde", [("Rechazado", "En Tramitacion"), ("En Subsanacion", "En Tramitacion"), ("En Tramitacion", "En Subsanacion")])
@pytest.mark.parametrize("cuerpo_motivo", [{}, {"motivo": None}, {"motivo": ""}, {"motivo": "   "}, {"motivo": "corto"}, {"motivo": "123456789"}])
def test_el_motivo_es_obligatorio_para_rechazar_pedir_y_cerrar_una_subsanacion(registro, destino, desde, cuerpo_motivo):
    registro.tramite["estado"] = desde
    r = estado({"estado": destino, **cuerpo_motivo})
    assert r.status_code == 400 and "motivo" in r.data["errores"]
    assert not pasos(registro, "update") and not pasos(registro, "motivo")
    assert pasos(registro, "pdp")[0][1] == Accion.CAMBIAR_ESTADO  # el PDP decidió antes de mirar el motivo


@pytest.mark.parametrize("motivo", ["‍" * 12, "‌‍" * 6, "?" * 12, " " * 12])
def test_un_motivo_sin_ninguna_letra_ni_numero_no_vale_aunque_tenga_largo(registro, motivo):
    registro.tramite["estado"] = "En Tramitacion"
    r = estado({"estado": "Rechazado", "motivo": motivo})
    assert r.status_code == 400 and "motivo" in r.data["errores"] and not pasos(registro, "update")


def test_el_ciudadano_que_llama_a_estado_sin_motivo_recibe_403_y_no_400(registro, monkeypatch):
    # El PDP va primero: quien no puede decidir no se entera de qué exige la decisión, y la negación queda registrada por el PDP
    def negar(request, accion, recurso):
        registro.pasos.append(("pdp", accion, recurso))
        raise AccesoDenegado({"codigo": "acceso_denegado", "detalle": "No tienes autorización para esta operación."})
    monkeypatch.setattr(vistas, "autorizar", negar)
    for cuerpo in ({"estado": "Rechazado"}, {"estado": "Rechazado", "motivo": "corto"}, {"estado": "Aprobado", "motivo": 5}):
        r = estado(cuerpo)
        assert r.status_code == 403 and "errores" not in r.data
    assert len(pasos(registro, "pdp")) == 3 and not pasos(registro, "update") and not pasos(registro, "motivo")


@pytest.mark.parametrize("malo", [5, True, ["largo texto de motivo"], {"a": "largo texto de motivo"}, "x" * 2001, "motivo\x00largo", "motivo\u202elargo", pytest.param("m" * 100_000, id="enorme")])
def test_un_motivo_que_no_es_texto_valido_se_rechaza_tambien_cuando_es_opcional(registro, malo):
    r = estado({"estado": "Aprobado", "motivo": malo})
    assert r.status_code == 400 and "motivo" in r.data["errores"] and not pasos(registro, "update")


@pytest.mark.parametrize("destino,desde", [("Rechazado", "En Tramitacion"), ("En Subsanacion", "En Tramitacion"), ("En Tramitacion", "En Subsanacion")])
def test_con_motivo_valido_se_fija_en_la_misma_transaccion_antes_del_update(registro, destino, desde):
    registro.tramite["estado"] = desde
    r = estado({"estado": destino, "motivo": f"  {MOTIVO}  "})
    assert r.status_code == 200
    orden = [p[0] for p in registro.pasos]
    assert orden.index("inicio") < orden.index("motivo") < orden.index("update")
    assert pasos(registro, "motivo")[0][1] == MOTIVO  # sin espacios en los bordes
    assert pasos(registro, "update")[0][1:] == ({"pk": 5, "estado": desde}, {"estado": destino})  # concurrencia optimista


def test_en_las_demas_transiciones_el_motivo_es_opcional(registro):
    registro.tramite["estado"] = "En Tramitacion"
    assert estado({"estado": "Aprobado"}).status_code == 200
    assert pasos(registro, "motivo")[-1][1] is None
    assert estado({"estado": "Aprobado", "motivo": "   "}).status_code == 200 and pasos(registro, "motivo")[-1][1] is None
    assert estado({"estado": "Aprobado", "motivo": "Cumple con todos los requisitos."}).status_code == 200
    assert pasos(registro, "motivo")[-1][1] == "Cumple con todos los requisitos."


def test_el_estado_invalido_sigue_dando_400_y_el_pdp_se_consulta_despues_de_validar(registro):
    assert estado({"estado": "Inventado"}).status_code == 400
    estado({"estado": "Aprobado"})
    assert pasos(registro, "pdp")[0][1] == Accion.CAMBIAR_ESTADO


def test_si_la_base_rechaza_la_transicion_responde_409(registro):
    registro.fallo = DatabaseError("Transicion no permitida")
    r = estado({"estado": "Rechazado", "motivo": MOTIVO})
    assert r.status_code == 409 and r.data["codigo"] == "transicion_rechazada"


def test_si_el_tramite_cambio_entre_tanto_responde_409_conflicto(registro):
    registro.filas = 0
    assert estado({"estado": "Rechazado", "motivo": MOTIVO}).data["codigo"] == "conflicto"


# --------------------------------------------------------------------------- responder la subsanación

@pytest.fixture
def en_subsanacion(registro):
    registro.tramite["estado"] = "En Subsanacion"
    return registro


def test_la_respuesta_vuelve_el_tramite_a_en_tramitacion_con_la_respuesta_como_motivo(en_subsanacion):
    r = subsanacion({"respuesta": f"  {MOTIVO}  "})
    assert r.status_code == 200
    assert pasos(en_subsanacion, "pdp")[0][1] == Accion.RESPONDER_SUBSANACION
    assert pasos(en_subsanacion, "motivo")[0][1] == MOTIVO
    assert pasos(en_subsanacion, "update")[0][1:] == ({"pk": 5, "estado": "En Subsanacion"}, {"estado": "En Tramitacion"})  # sin `datos`: no se tocan


def test_con_datos_los_reemplaza_en_el_mismo_update(en_subsanacion):
    r = subsanacion({"respuesta": MOTIVO, "datos": {"asunto": " Corregido ", "descripcion": ""}})
    assert r.status_code == 200
    assert pasos(en_subsanacion, "update")[0][2] == {"estado": "En Tramitacion", "datos": {"asunto": "Corregido"}}


@pytest.mark.parametrize("datos", [{}, {"asunto": 5}, {"x": 1}, None, [], "x"])
def test_unos_datos_que_no_cumplen_el_formulario_completo_se_rechazan(en_subsanacion, datos):
    r = subsanacion({"respuesta": MOTIVO, "datos": datos})
    assert r.status_code == 400 and r.data["codigo"] == "datos_invalidos" and r.data["errores"]
    assert not pasos(en_subsanacion, "update")


@pytest.mark.parametrize("respuesta", [None, "", "   ", "corta", 5, ["respuesta larga"], {"a": 1}, "x" * 2001, "respuesta\x07larga"])
def test_la_respuesta_es_obligatoria_de_10_a_2000_caracteres(en_subsanacion, respuesta):
    r = subsanacion({"respuesta": respuesta})
    assert r.status_code == 400 and "respuesta" in r.data["errores"] and not pasos(en_subsanacion, "update")
    assert subsanacion({}).status_code == 400


@pytest.mark.parametrize("actual", ["Pendiente", "En Tramitacion", "Aprobado", "Rechazado"])
def test_solo_se_responde_un_tramite_en_subsanacion(registro, actual):
    registro.tramite["estado"] = actual
    r = subsanacion({"respuesta": MOTIVO})
    assert r.status_code == 409 and r.data["codigo"] == "no_en_subsanacion" and not pasos(registro, "update")


def test_si_el_pdp_niega_no_se_toca_nada(en_subsanacion, monkeypatch):
    def negar(request, accion, recurso):
        raise AccesoDenegado({"codigo": "acceso_denegado", "detalle": "No tienes autorización para esta operación."})
    monkeypatch.setattr(vistas, "autorizar", negar)
    r = subsanacion({"respuesta": MOTIVO})
    assert r.status_code == 403 and not pasos(en_subsanacion, "update") and not pasos(en_subsanacion, "motivo")


def test_si_dos_personas_responden_a_la_vez_la_segunda_recibe_409(en_subsanacion):
    en_subsanacion.filas = 0
    assert subsanacion({"respuesta": MOTIVO}).data["codigo"] == "conflicto"


def test_si_la_base_rechaza_la_respuesta_responde_409(en_subsanacion):
    en_subsanacion.fallo = DatabaseError("permission denied")
    r = subsanacion({"respuesta": MOTIVO})
    assert r.status_code == 409 and r.data["codigo"] == "transicion_rechazada"


def test_el_tramite_ajeno_responde_404_antes_que_cualquier_otra_cosa(registro, monkeypatch):
    from rest_framework.exceptions import NotFound

    def invisible(self, pk):
        raise NotFound()
    monkeypatch.setattr(vistas._Base, "_tramite_visible", invisible)
    assert subsanacion({"respuesta": MOTIVO}).status_code == 404
    assert not pasos(registro, "pdp")


def test_la_ruta_de_subsanacion_existe():
    assert reverse("tramite-subsanacion", kwargs={"pk": 5}) == "/tramites/5/subsanacion/"


# --------------------------------------------------------------------------- salida

def un_tramite_serializable(**kw):
    base = dict(pk=9, tipo_tramite_id=1, tipo_tramite=SimpleNamespace(nombre="Permiso", formulario=FORMULARIO), institucion_id=3,
                institucion=SimpleNamespace(nombre="MOP"), estado="En Subsanacion", fecha_limite=AHORA, creado_en=AHORA,
                solicitante_id=77, funcionario_asignado_id=88, sensibilidad=2, escalado_en=None, datos={"asunto": "Hola"})
    base.update(kw)
    return SimpleNamespace(**base)


@pytest.mark.parametrize("personal", [False, True])
def test_el_detalle_lleva_los_datos_y_el_formulario_para_el_solicitante_y_para_el_personal(personal):
    d = ser.tramite_a_dict(un_tramite_serializable(), personal, AHORA, detalle=True)
    assert d["datos"] == {"asunto": "Hola"} and d["formulario"] == FORMULARIO


def test_el_listado_no_lleva_el_contenido():
    d = ser.tramite_a_dict(un_tramite_serializable(), False, AHORA)
    assert "datos" not in d and "formulario" not in d


def un_evento(anterior="En Tramitacion", nuevo="En Subsanacion", accion="cambio_estado", **atributos):
    return SimpleNamespace(pk=1, accion=accion, estado_anterior=anterior, estado_nuevo=nuevo, institucion_id=3,
                           creado_en=AHORA, actor_id=88, atributos=atributos)


def test_la_ciudadania_ve_el_motivo_pero_no_el_resto_de_los_atributos():
    d = ser.evento_a_dict(un_evento(motivo=MOTIVO, datos_actualizados=True, interno=1), personal=False)
    assert d["motivo"] == MOTIVO and "atributos" not in d and "actor_id" not in d
    assert "interno" not in str(d) and "datos_actualizados" not in str(d)


def test_el_personal_ve_el_motivo_y_los_atributos():
    d = ser.evento_a_dict(un_evento(motivo=MOTIVO, interno=1), personal=True)
    assert d["motivo"] == MOTIVO and d["atributos"] == {"motivo": MOTIVO, "interno": 1}


@pytest.mark.parametrize("atributos", [{}, {"motivo": 5}, {"motivo": ["x"]}, {"motivo": None}])
def test_sin_motivo_o_con_un_motivo_que_no_es_texto_se_devuelve_null(atributos):
    assert ser.evento_a_dict(un_evento(**atributos), personal=False)["motivo"] is None


# La persona lee el motivo solo cuando es para ella; el resto son comentarios internos del personal
CON_MOTIVO_PARA_LA_PERSONA = [("En Tramitacion", "Rechazado"), ("Pendiente", "Rechazado"), ("En Tramitacion", "En Subsanacion"),
                              ("En Subsanacion", "En Tramitacion")]  # el último: respuesta de ella o cierre del personal
SIN_MOTIVO_PARA_LA_PERSONA = [("Pendiente", "En Tramitacion"), ("En Tramitacion", "Aprobado"), ("Pendiente", "Aprobado")]


@pytest.mark.parametrize("anterior,nuevo", CON_MOTIVO_PARA_LA_PERSONA)
def test_la_persona_ve_el_motivo_de_rechazar_pedir_subsanar_y_cerrar_la_subsanacion(anterior, nuevo):
    assert ser.evento_a_dict(un_evento(anterior, nuevo, motivo=MOTIVO), personal=False)["motivo"] == MOTIVO


@pytest.mark.parametrize("anterior,nuevo", SIN_MOTIVO_PARA_LA_PERSONA)
def test_la_persona_no_ve_el_motivo_de_las_demas_transiciones_pero_el_personal_si(anterior, nuevo):
    comentario = "Comentario interno: revisar con el supervisor."
    assert ser.evento_a_dict(un_evento(anterior, nuevo, motivo=comentario), personal=False)["motivo"] is None
    assert comentario not in str(ser.evento_a_dict(un_evento(anterior, nuevo, motivo=comentario), personal=False))
    assert ser.evento_a_dict(un_evento(anterior, nuevo, motivo=comentario), personal=True)["motivo"] == comentario


def test_el_personal_ve_todos_los_motivos_de_cualquier_transicion():
    for anterior, nuevo in CON_MOTIVO_PARA_LA_PERSONA + SIN_MOTIVO_PARA_LA_PERSONA:
        assert ser.evento_a_dict(un_evento(anterior, nuevo, motivo=MOTIVO), personal=True)["motivo"] == MOTIVO


def test_un_evento_que_no_es_un_cambio_de_estado_no_muestra_motivo_a_la_persona():
    assert ser.evento_a_dict(un_evento("En Tramitacion", "Rechazado", accion="reasignacion", motivo=MOTIVO), personal=False)["motivo"] is None


def test_un_formulario_mal_definido_al_responder_la_subsanacion_da_503(en_subsanacion, monkeypatch):
    mal = SimpleNamespace(nombre="Demo", formulario=[{"id": "X", "tipo": "inventado"}])
    tramite = en_subsanacion.un_tramite()
    tramite.tipo_tramite = mal
    monkeypatch.setattr(vistas._Base, "_tramite_visible", lambda self, pk: tramite)
    r = subsanacion({"respuesta": MOTIVO, "datos": {"asunto": "Corregido"}})
    assert r.status_code == 503 and r.data["codigo"] == "formulario_no_disponible" and not pasos(en_subsanacion, "update")
    assert pasos(en_subsanacion, "seguridad")[0][2] == "formulario_no_disponible"


# --------------------------------------------------------------------------- tipo desactivado (migración 020)

def test_un_tipo_desactivado_no_admite_tramites_nuevos_y_responde_400_claro(registro, monkeypatch):
    inactivo = SimpleNamespace(pk=1, institucion_id=3, institucion=SimpleNamespace(nombre="MOP"), audiencia="ciudadania", sla_dias=10, formulario=FORMULARIO,
                               activo=False)
    monkeypatch.setattr(vistas, "TipoTramite", SimpleNamespace(objects=SimpleNamespace(
        select_related=lambda *a: SimpleNamespace(filter=lambda **k: SimpleNamespace(first=lambda: inactivo)))))
    r = crear({"tipo_tramite": 1, "datos": {"asunto": "ok"}})
    assert r.status_code == 400 and r.data["codigo"] == "tipo_tramite_inactivo" and "ya no se ofrece" in r.data["detalle"]
    assert not pasos(registro, "crear") and not pasos(registro, "evento")
    assert pasos(registro, "pdp")  # el PDP va primero: quien no puede crear el trámite no se entera de que el tipo está desactivado


def test_el_catalogo_publico_no_muestra_los_tipos_desactivados(monkeypatch):
    from apps.catalogo import vistas as catalogo
    filtros = []

    class Consulta:
        def select_related(self, *a):
            return self

        def order_by(self, *a):
            return []

    monkeypatch.setattr(catalogo, "TipoTramite", SimpleNamespace(objects=SimpleNamespace(filter=lambda **k: (filtros.append(k), Consulta())[1])))
    monkeypatch.setattr(catalogo.TiposTramiteLista, "throttle_classes", [])
    peticion = APIRequestFactory().get("/catalogo/tipos-tramite/", secure=True)
    force_authenticate(peticion, user=SimpleNamespace(usuario=SimpleNamespace(pk=7), claims=SimpleNamespace(scope="completo"), is_authenticated=True, pk=7))
    assert catalogo.TiposTramiteLista.as_view()(peticion).status_code == 200
    assert filtros[0] == {"activo": True}
