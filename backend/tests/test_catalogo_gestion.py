"""Gestión del catálogo por la coordinación: validación (pura) y vistas.

Sin base de datos: el ORM, el contexto de seguridad por filas y el PDP se sustituyen por dobles que registran lo que la vista les pide. Lo que
decide la base (disparadores, RLS, permisos) lo prueban `database/pruebas-catalogo.sql` y `verificar_equipo` contra la base real.
"""
from contextlib import contextmanager
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from django.db import DatabaseError
from django.urls import reverse
from rest_framework.test import APIRequestFactory, force_authenticate

from apps.autorizacion.pdp import Accion
from apps.autorizacion.permisos import AccesoDenegado
from apps.catalogo import gestion, vistas_institucion as vistas

AHORA = datetime(2026, 11, 26, 12, 0, tzinfo=timezone.utc)
CAMPO = {"id": "asunto", "etiqueta": "Asunto", "tipo": "texto", "obligatorio": True, "max": 100}
FORMULARIO = [CAMPO]
VALIDO = {"nombre": "Permiso de uso de vía", "sla_dias": 10, "audiencia": "ciudadania", "formulario": FORMULARIO}


def campo(**cambios):
    return {**CAMPO, **cambios}


# --------------------------------------------------------------------------- validación pura

def test_un_tipo_valido_se_acepta_y_se_normaliza():
    limpio, errores = gestion.validar({"nombre": "  Permiso de uso de vía  ", "sla_dias": 10})
    assert errores == {} and limpio == {"nombre": "Permiso de uso de vía", "sla_dias": 10, "audiencia": "ciudadania", "formulario": [], "activo": True}


def test_al_crear_el_nombre_y_el_plazo_son_obligatorios():
    limpio, errores = gestion.validar({})
    assert limpio is None and errores == {"nombre": "Este campo es obligatorio.", "sla_dias": "Este campo es obligatorio."}


@pytest.mark.parametrize("nombre", ["", "ab", "  ab  ", "x" * 151, 5, ["Permiso"], "Con\nsalto", "con\x00control", "\u200d\u200c\u200d\u200d", True])
def test_nombre_invalido(nombre):
    limpio, errores = gestion.validar({**VALIDO, "nombre": nombre})
    assert limpio is None and "nombre" in errores


@pytest.mark.parametrize("nombre", ["abc", "x" * 150, "Ñandú y café"])
def test_nombre_valido_en_los_limites(nombre):
    assert gestion.validar({**VALIDO, "nombre": nombre})[1] == {}


@pytest.mark.parametrize("sla", [0, -1, 366, 1.5, "10", True, None, [10], 10**9])
def test_plazo_invalido(sla):
    limpio, errores = gestion.validar({**VALIDO, "sla_dias": sla})
    assert limpio is None and "sla_dias" in errores


@pytest.mark.parametrize("sla", [1, 365])
def test_plazo_valido_en_los_limites(sla):
    assert gestion.validar({**VALIDO, "sla_dias": sla})[1] == {}


@pytest.mark.parametrize("audiencia", ["todos", "", None, 5, ["ambas"]])
def test_audiencia_invalida(audiencia):
    assert "audiencia" in gestion.validar({**VALIDO, "audiencia": audiencia})[1]


@pytest.mark.parametrize("audiencia", ["ciudadania", "institucion", "ambas"])
def test_audiencia_valida(audiencia):
    assert gestion.validar({**VALIDO, "audiencia": audiencia})[1] == {}


@pytest.mark.parametrize("activo", ["si", 1, 0, None, []])
def test_activo_debe_ser_booleano(activo):
    assert "activo" in gestion.validar({**VALIDO, "activo": activo})[1]


@pytest.mark.parametrize("extra", [{"institucion_id": 4}, {"id": 9}, {"creado_en": "hoy"}, {"formulario_viejo": []}])
def test_no_se_aceptan_campos_que_no_se_editan(extra):
    limpio, errores = gestion.validar({**VALIDO, **extra})
    assert limpio is None and "datos" in errores
    assert str(list(extra.values())[0]) not in errores["datos"]


@pytest.mark.parametrize("cuerpo", [[], "x", 5, None, [{"nombre": "abc"}]])
def test_un_cuerpo_que_no_es_objeto_se_rechaza(cuerpo):
    limpio, errores = gestion.validar(cuerpo)
    assert limpio is None and "datos" in errores


def test_al_cambiar_basta_con_un_dato_y_solo_se_devuelve_lo_que_llego():
    assert gestion.validar({"activo": False}, parcial=True) == ({"activo": False}, {})
    assert gestion.validar({"sla_dias": 7}, parcial=True) == ({"sla_dias": 7}, {})
    limpio, errores = gestion.validar({}, parcial=True)
    assert limpio is None and "datos" in errores
    limpio, errores = gestion.validar({"institucion_id": 4}, parcial=True)
    assert limpio is None and "datos" in errores


# --------------------------------------------------------------------------- formulario

def test_el_formulario_se_limpia_y_se_quitan_los_atributos_que_no_aplican():
    limpio, errores = gestion.validar_formulario([
        {"id": "a", "etiqueta": "  Asunto  ", "tipo": "texto", "obligatorio": True, "max": 100, "ayuda": "  Resumen  ", "opciones": ["x"], "entero": True},
        {"id": "b", "etiqueta": "Fecha", "tipo": "fecha", "max": 5},
        {"id": "c", "etiqueta": "Elegir", "tipo": "seleccion", "opciones": [" Uno ", "Dos"], "ayuda": "   "},
        {"id": "d", "etiqueta": "Cantidad", "tipo": "numero", "max": 50, "entero": True, "obligatorio": False},
    ])
    assert errores == {}
    assert limpio == [
        {"id": "a", "etiqueta": "Asunto", "tipo": "texto", "obligatorio": True, "max": 100, "ayuda": "Resumen"},
        {"id": "b", "etiqueta": "Fecha", "tipo": "fecha", "obligatorio": False},
        {"id": "c", "etiqueta": "Elegir", "tipo": "seleccion", "obligatorio": False, "opciones": ["Uno", "Dos"]},
        {"id": "d", "etiqueta": "Cantidad", "tipo": "numero", "obligatorio": False, "max": 50, "entero": True},
    ]


def test_el_formulario_limpio_pasa_la_regla_con_la_que_despues_se_validan_las_respuestas():
    from apps.tramites import formulario
    limpio, _ = gestion.validar_formulario([campo(), {"id": "b", "etiqueta": "B", "tipo": "seleccion", "opciones": ["x", "y"]}])
    assert formulario.definicion_valida(limpio) == []


def test_un_formulario_vacio_es_valido():
    assert gestion.validar_formulario([]) == ([], {})


@pytest.mark.parametrize("crudo", [{}, "x", 5, None, {"id": "a"}])
def test_el_formulario_debe_ser_una_lista(crudo):
    assert gestion.validar_formulario(crudo)[1] == {"formulario": "Debe ser una lista de campos."}


def test_el_limite_es_de_treinta_campos():
    ok = [campo(id=f"c{i}") for i in range(30)]
    assert gestion.validar_formulario(ok)[1] == {}
    assert "formulario" in gestion.validar_formulario(ok + [campo(id="c30")])[1]


@pytest.mark.parametrize("malo,llave", [
    (campo(id="Asunto"), "formulario.0.id"),
    (campo(id="1asunto"), "formulario.0.id"),
    (campo(id="a" + "b" * 40), "formulario.0.id"),
    (campo(id=5), "formulario.0.id"),
    (campo(id=None), "formulario.0.id"),
    (campo(etiqueta=""), "formulario.0.etiqueta"),
    (campo(etiqueta="   "), "formulario.0.etiqueta"),
    (campo(etiqueta="e" * 121), "formulario.0.etiqueta"),
    (campo(etiqueta=None), "formulario.0.etiqueta"),
    (campo(etiqueta=["x"]), "formulario.0.etiqueta"),
    (campo(tipo="archivo"), "formulario.0.tipo"),
    (campo(tipo=None), "formulario.0.tipo"),
    (campo(obligatorio="si"), "formulario.0.obligatorio"),
    (campo(max=0), "formulario.0.max"),
    (campo(max=-5), "formulario.0.max"),
    (campo(max="100"), "formulario.0.max"),
    (campo(max=True), "formulario.0.max"),
    (campo(max=1.5), "formulario.0.max"),
    (campo(max=501), "formulario.0.max"),
    (campo(max=None), "formulario.0.max"),
    (campo(ayuda=5), "formulario.0.ayuda"),
    (campo(ayuda="a" * 301), "formulario.0.ayuda"),
    (campo(entero="si"), "formulario.0.entero"),
    (campo(secreto="x"), "formulario.0"),
    ("texto", "formulario.0"),
    (["x"], "formulario.0"),
])
def test_cada_regla_del_campo_da_su_error_por_campo(malo, llave):
    limpio, errores = gestion.validar_formulario([malo])
    assert limpio is None and llave in errores, errores


@pytest.mark.parametrize("opciones", [None, [], "Uno", [1, 2], ["a", "a"], ["  "], [""], ["x" * 121], ["a" + str(i) for i in range(31)], [["a"]], [None]])
def test_las_opciones_de_una_seleccion_se_validan(opciones):
    limpio, errores = gestion.validar_formulario([{"id": "s", "etiqueta": "S", "tipo": "seleccion", "opciones": opciones}])
    assert limpio is None and "formulario.0.opciones" in errores


def test_treinta_opciones_se_admiten():
    opciones = [f"op{i}" for i in range(30)]
    assert gestion.validar_formulario([{"id": "s", "etiqueta": "S", "tipo": "seleccion", "opciones": opciones}])[1] == {}


def test_un_id_repetido_marca_al_segundo_campo():
    limpio, errores = gestion.validar_formulario([campo(), campo(etiqueta="Otro")])
    assert limpio is None and errores == {"formulario.1.id": "Otro campo ya usa este id."}


def test_los_errores_de_varios_campos_se_dan_juntos():
    limpio, errores = gestion.validar_formulario([campo(id="MAL"), campo(id="bien"), campo(id="otro", etiqueta="")])
    assert set(errores) == {"formulario.0.id", "formulario.2.etiqueta"}


def test_los_errores_no_repiten_lo_recibido():
    _, errores = gestion.validar_formulario([campo(id="Cédula 8-123-456", etiqueta="x", secreto="8-123-456")])
    assert "8-123-456" not in str(errores)


def test_los_caracteres_de_control_y_los_invisibles_no_pasan_en_etiquetas_ni_opciones():
    assert "formulario.0.etiqueta" in gestion.validar_formulario([campo(etiqueta="a\x00b")])[1]
    assert "formulario.0.etiqueta" in gestion.validar_formulario([campo(etiqueta="a\u202eb")])[1]
    assert "formulario.0.etiqueta" in gestion.validar_formulario([campo(etiqueta="a\nb")])[1]
    assert "formulario.0.opciones" in gestion.validar_formulario([{"id": "s", "etiqueta": "S", "tipo": "seleccion", "opciones": ["a\u202eb"]}])[1]


# --------------------------------------------------------------------------- salida

def test_el_tipo_se_muestra_con_su_institucion_y_estado():
    t = SimpleNamespace(pk=4, institucion_id=3, nombre="N", sla_dias=5, audiencia="ambas", formulario=FORMULARIO, activo=False)
    assert gestion.tipo_a_dict(t) == {"id": 4, "institucion_id": 3, "nombre": "N", "sla_dias": 5, "audiencia": "ambas", "formulario": FORMULARIO, "activo": False}


def test_el_cambio_muestra_quien_cuando_y_que_sin_datos_de_mas():
    c = SimpleNamespace(pk=9, accion="cambio", creado_en=AHORA, tipo_tramite_id=4, tipo_tramite=SimpleNamespace(nombre="N"),
                        actor=SimpleNamespace(pk=7, username="carla.mop", password_hash="no-debe-salir"), antes={"sla_dias": 5}, despues={"sla_dias": 7})
    salida = gestion.cambio_a_dict(c)
    assert salida == {"id": 9, "accion": "cambio", "creado_en": AHORA, "tipo_tramite": {"id": 4, "nombre": "N"},
                      "actor": {"id": 7, "usuario": "carla.mop"}, "antes": {"sla_dias": 5}, "despues": {"sla_dias": 7}}
    assert "no-debe-salir" not in str(salida)
    sin_actor = SimpleNamespace(**{**c.__dict__, "actor": None})
    assert gestion.cambio_a_dict(sin_actor)["actor"] is None


# --------------------------------------------------------------------------- vistas

class CausaDelControlador(Exception):
    """Lo que trae psycopg como causa de un DatabaseError de Django: el SQLSTATE y el mensaje primario."""

    def __init__(self, sqlstate, mensaje):
        super().__init__(mensaje)
        self.sqlstate = sqlstate
        self.diag = SimpleNamespace(message_primary=mensaje)


def error_de_base(sqlstate, mensaje=""):
    error = DatabaseError(mensaje)
    error.__cause__ = CausaDelControlador(sqlstate, mensaje)
    return error


class Registro:
    def __init__(self):
        self.pasos = []
        self.filas = {}
        self.siguiente = 100
        self.fallo_crear = None
        self.fallo_actualizar = None
        self.cambios = []

    def tipo(self, pk, institucion_id=3, nombre="Existente", **resto):
        base = dict(pk=pk, institucion_id=institucion_id, nombre=nombre, sla_dias=10, audiencia="ciudadania", formulario=FORMULARIO, activo=True)
        self.filas[pk] = SimpleNamespace(**{**base, **resto})
        return self.filas[pk]


@pytest.fixture
def registro(monkeypatch):
    reg = Registro()
    reg.tipo(1, nombre="Beta")
    reg.tipo(2, nombre="Alfa", activo=False)
    reg.tipo(3, institucion_id=4, nombre="De otra institución")

    def coincide(t, filtros):
        for llave, valor in filtros.items():
            if llave == "nombre__iexact":
                if t.nombre.lower() != valor.lower():
                    return False
            elif getattr(t, llave) != valor:
                return False
        return True

    class Consulta:
        def __init__(self, filas):
            self.filas = filas

        def first(self):
            return self.filas[0] if self.filas else None

        def exists(self):
            return bool(self.filas)

        def exclude(self, pk):
            return Consulta([t for t in self.filas if t.pk != pk])

        def order_by(self, *campos):
            reg.pasos.append(("orden", campos))
            return sorted(self.filas, key=lambda t: (t.nombre, t.pk))

        def update(self, **cambios):
            reg.pasos.append(("update", [t.pk for t in self.filas], cambios))
            if reg.fallo_actualizar:
                raise reg.fallo_actualizar
            for t in self.filas:
                for llave, valor in cambios.items():
                    setattr(t, llave, valor)
            return len(self.filas)

    def crear(**campos):
        reg.pasos.append(("crear", campos))
        if reg.fallo_crear:
            raise reg.fallo_crear
        reg.siguiente += 1
        return reg.tipo(reg.siguiente, **campos)

    def buscar(**filtros):
        reg.pasos.append(("buscar", filtros))
        return Consulta([t for t in reg.filas.values() if coincide(t, filtros)])

    class Cambios:
        def __init__(self, filas):
            self.filas = filas

        def select_related(self, *a):
            return self

        def order_by(self, *a):
            return self

        def count(self):
            return len(self.filas)

        def __getitem__(self, corte):
            return self.filas[corte]

    @contextmanager
    def atomico():
        reg.pasos.append(("inicio",))
        yield

    monkeypatch.setattr(vistas, "TipoTramite", SimpleNamespace(objects=SimpleNamespace(
        filter=buscar, create=crear, get=lambda pk: reg.filas[pk])))
    monkeypatch.setattr(vistas, "Institucion", SimpleNamespace(objects=SimpleNamespace(
        filter=lambda pk: SimpleNamespace(first=lambda: SimpleNamespace(pk=pk, nombre="MOP") if pk == 3 else None))))
    monkeypatch.setattr(vistas, "CatalogoCambio", SimpleNamespace(objects=SimpleNamespace(filter=lambda **f: (
        reg.pasos.append(("cambios", f)), Cambios(reg.cambios))[1])))
    monkeypatch.setattr(vistas, "transaction", SimpleNamespace(atomic=atomico))
    monkeypatch.setattr(vistas, "fijar_contexto", lambda *a: reg.pasos.append(("contexto", a)))
    monkeypatch.setattr(vistas, "autorizar", lambda request, accion, recurso: reg.pasos.append(("pdp", accion, recurso)))
    monkeypatch.setattr(vistas._Coordinacion, "throttle_classes", [])
    return reg


def llamar(vista, metodo="get", cuerpo=None, consulta="", **kwargs):
    fabrica = APIRequestFactory()
    ruta = "/x/" + consulta
    peticion = getattr(fabrica, metodo)(ruta, cuerpo, format="json", secure=True) if metodo != "get" else fabrica.get(ruta, secure=True)
    principal = SimpleNamespace(usuario=SimpleNamespace(pk=7), claims=SimpleNamespace(scope="completo"), is_authenticated=True, pk=7)
    force_authenticate(peticion, user=principal)
    return vista.as_view()(peticion, **kwargs)


def pasos(reg, nombre):
    return [p for p in reg.pasos if p[0] == nombre]


def listar(institucion=3):
    return llamar(vistas.TiposDeInstitucion, institucion=institucion)


def crear(cuerpo, institucion=3):
    return llamar(vistas.TiposDeInstitucion, "post", cuerpo, institucion=institucion)


def cambiar(cuerpo, pk=1, institucion=3):
    return llamar(vistas.TipoDeInstitucion, "patch", cuerpo, institucion=institucion, pk=pk)


def test_las_rutas_se_resuelven():
    assert reverse("catalogo-tipos", kwargs={"institucion": 3}) == "/catalogo/institucion/3/tipos/"
    assert reverse("catalogo-tipo", kwargs={"institucion": 3, "pk": 8}) == "/catalogo/institucion/3/tipos/8/"
    assert reverse("catalogo-cambios", kwargs={"institucion": 3}) == "/catalogo/institucion/3/cambios/"


def test_listar_decide_el_pdp_antes_de_buscar_y_fija_el_contexto_de_quien_actua(registro):
    r = listar()
    assert r.status_code == 200
    assert registro.pasos[0][0] == "contexto" and registro.pasos[0][1] == (7, [])
    pdp = pasos(registro, "pdp")[0]
    assert pdp[1] == Accion.GESTIONAR_CATALOGO_INSTITUCION and pdp[2].tipo == "tipo_tramite" and pdp[2].institucion_id == 3
    assert registro.pasos.index(pdp) < registro.pasos.index(pasos(registro, "buscar")[0])


def test_listar_trae_los_tipos_de_esa_institucion_incluidos_los_desactivados_y_ordenados_por_nombre(registro):
    r = listar()
    assert r.data["institucion"] == {"id": 3, "nombre": "MOP"}
    assert [(t["id"], t["nombre"], t["activo"]) for t in r.data["tipos"]] == [(2, "Alfa", False), (1, "Beta", True)]  # no trae el de la 4
    assert set(r.data["tipos"][0]) == {"id", "institucion_id", "nombre", "sla_dias", "audiencia", "formulario", "activo"}


def test_si_el_pdp_niega_no_se_toca_nada(registro, monkeypatch):
    def negar(request, accion, recurso):
        registro.pasos.append(("pdp", accion, recurso))
        raise AccesoDenegado({"codigo": "acceso_denegado", "detalle": "No tienes autorización para esta operación."})
    monkeypatch.setattr(vistas, "autorizar", negar)
    for r in (listar(), crear(VALIDO), cambiar({"activo": False}), llamar(vistas.CambiosDeInstitucion, institucion=3)):
        assert r.status_code == 403 and "errores" not in r.data
    assert len(pasos(registro, "pdp")) == 4 and not pasos(registro, "buscar") and not pasos(registro, "crear") and not pasos(registro, "update")
    assert not pasos(registro, "cambios")


def test_crear_valida_y_guarda_lo_limpio_en_la_institucion_de_la_ruta(registro):
    r = crear({**VALIDO, "institucion_id": 4})
    assert r.status_code == 400  # `institucion_id` no se acepta: la institución sale de la ruta, nunca del cuerpo
    assert not pasos(registro, "crear")
    r = crear({"nombre": "  Nuevo trámite  ", "sla_dias": 7, "formulario": [campo(etiqueta="  Asunto ")]})
    assert r.status_code == 201
    llamada = pasos(registro, "crear")[0][1]
    assert llamada["institucion_id"] == 3 and llamada["nombre"] == "Nuevo trámite" and llamada["formulario"][0]["etiqueta"] == "Asunto" and llamada["activo"] is True
    assert r.data["id"] == 101 and r.data["institucion_id"] == 3


def test_crear_con_errores_da_400_con_el_error_por_campo_sin_tocar_la_base(registro):
    r = crear({"nombre": "ab", "sla_dias": 0, "formulario": [campo(id="MAL")]})
    assert r.status_code == 400 and r.data["codigo"] == "datos_invalidos"
    assert set(r.data["errores"]) == {"nombre", "sla_dias", "formulario.0.id"}
    assert not pasos(registro, "crear")


def test_crear_con_un_nombre_repetido_en_la_institucion_da_400_ignorando_mayusculas(registro):
    r = crear({**VALIDO, "nombre": "BETA"})
    assert r.status_code == 400 and "nombre" in r.data["errores"] and not pasos(registro, "crear")
    assert crear({**VALIDO, "nombre": "De otra institución"}).status_code == 201  # el mismo nombre en OTRA institución sí se admite


@pytest.mark.parametrize("cuerpo", [[], "x", 5, None])
def test_crear_con_un_cuerpo_que_no_es_objeto_da_400(registro, cuerpo):
    assert crear(cuerpo).status_code == 400 and not pasos(registro, "crear")


def test_si_la_base_rechaza_por_un_disparador_responde_400_y_no_500(registro):
    registro.fallo_crear = error_de_base("P0001", "Catalogo: formulario invalido: campo 1: id invalido")
    r = crear(VALIDO)
    assert r.status_code == 400 and r.data["codigo"] == "catalogo_rechazado" and "campo 1: id invalido" in r.data["detalle"]


def test_si_la_base_rechaza_por_permiso_responde_400_con_un_mensaje_general(registro):
    registro.fallo_crear = error_de_base("42501", "permission denied for table tipo_tramite")
    r = crear(VALIDO)
    assert r.status_code == 400 and r.data["codigo"] == "catalogo_rechazado" and "permission denied" not in str(r.data)


def test_si_la_base_rechaza_por_un_check_responde_400_sin_repetir_su_texto(registro):
    registro.fallo_crear = error_de_base("23514", 'new row violates check constraint "tipo_tramite_sla_rango"')
    r = crear(VALIDO)
    assert r.status_code == 400 and "tipo_tramite_sla_rango" not in str(r.data)


def test_si_otra_persona_creo_el_mismo_nombre_entre_tanto_responde_400_por_nombre(registro):
    registro.fallo_crear = error_de_base("23505", "duplicate key value violates unique constraint")
    r = crear(VALIDO)
    assert r.status_code == 400 and "nombre" in r.data["errores"] and "duplicate" not in str(r.data)


def test_un_fallo_de_la_base_que_no_es_una_regla_sigue_siendo_un_error_del_servidor(registro):
    registro.fallo_crear = error_de_base("08006", "connection failure")
    with pytest.raises(DatabaseError):
        crear(VALIDO)


def test_cambiar_solo_escribe_lo_que_cambio(registro):
    r = cambiar({"nombre": "Beta", "sla_dias": 12, "activo": True})
    assert r.status_code == 200
    assert pasos(registro, "update")[0][2] == {"sla_dias": 12}
    assert r.data["sla_dias"] == 12 and r.data["activo"] is True


def test_cambiar_sin_cambios_no_escribe_nada(registro):
    r = cambiar({"nombre": "Beta", "activo": True})
    assert r.status_code == 200 and not pasos(registro, "update")


def test_desactivar_y_reactivar(registro):
    assert cambiar({"activo": False}).data["activo"] is False
    assert pasos(registro, "update")[0][2] == {"activo": False}
    assert cambiar({"activo": True}, pk=1).data["activo"] is True


def test_cambiar_el_formulario_lo_valida_y_lo_guarda_limpio(registro):
    r = cambiar({"formulario": [campo(etiqueta=" Motivo "), campo(id="otro", etiqueta="Otro", tipo="fecha")]})
    assert r.status_code == 200
    guardado = pasos(registro, "update")[0][2]["formulario"]
    assert [c["etiqueta"] for c in guardado] == ["Motivo", "Otro"] and "max" not in guardado[1]
    r = cambiar({"formulario": [campo(id="MAL")]})
    assert r.status_code == 400 and "formulario.0.id" in r.data["errores"] and len(pasos(registro, "update")) == 1


@pytest.mark.parametrize("cuerpo", [{}, {"institucion_id": 4}, {"id": 9}, {"nombre": "ab"}, {"sla_dias": 400}, {"activo": "no"}, [], "x"])
def test_cambiar_con_datos_invalidos_da_400_sin_escribir(registro, cuerpo):
    r = cambiar(cuerpo)
    assert r.status_code == 400 and r.data["codigo"] == "datos_invalidos" and not pasos(registro, "update")


def test_un_tipo_de_otra_institucion_o_que_no_existe_responde_404(registro):
    assert cambiar({"activo": False}, pk=3).status_code == 404  # existe, pero es de la 4
    assert cambiar({"activo": False}, pk=999).status_code == 404
    assert cambiar({"activo": False}, pk=2**63).status_code == 404  # no cabe en la base: ni se consulta
    assert not pasos(registro, "update")
    assert registro.filas[3].activo is True


def test_el_pdp_decide_antes_de_buscar_el_tipo(registro):
    cambiar({"activo": False}, pk=999)
    assert registro.pasos.index(pasos(registro, "pdp")[0]) < registro.pasos.index(pasos(registro, "buscar")[0])


def test_cambiar_a_un_nombre_que_ya_tiene_otro_tipo_da_400_pero_conservar_el_propio_no(registro):
    r = cambiar({"nombre": "alfa"})  # el tipo 1 pasa a llamarse como el 2
    assert r.status_code == 400 and "nombre" in r.data["errores"] and not pasos(registro, "update")
    assert cambiar({"nombre": "BETA", "sla_dias": 3}).status_code == 200  # su propio nombre, con otra capitalización


def test_si_la_base_rechaza_el_cambio_responde_400(registro):
    registro.fallo_actualizar = error_de_base("P0001", "Catalogo: solo la coordinacion vigente de la institucion gestiona su catalogo")
    r = cambiar({"sla_dias": 20})
    assert r.status_code == 400 and r.data["codigo"] == "catalogo_rechazado" and "coordinacion vigente" in r.data["detalle"]


def test_los_cambios_se_paginan_y_llevan_el_total(registro):
    registro.cambios = [SimpleNamespace(pk=i, accion="cambio", creado_en=AHORA, tipo_tramite_id=1, tipo_tramite=SimpleNamespace(nombre="Beta"),
                                        actor=SimpleNamespace(pk=7, username="carla.mop"), antes={}, despues={}) for i in range(5, 0, -1)]
    r = llamar(vistas.CambiosDeInstitucion, institucion=3, consulta="?limite=2&desplazamiento=2")
    assert r.status_code == 200 and r.data["total"] == 5 and r.data["limite"] == 2 and r.data["desplazamiento"] == 2
    assert [c["id"] for c in r.data["resultados"]] == [3, 2]
    assert pasos(registro, "cambios")[0][1] == {"institucion_id": 3}


@pytest.mark.parametrize("consulta", ["?limite=0", "?limite=101", "?limite=abc", "?desplazamiento=-1"])
def test_los_cambios_rechazan_una_paginacion_invalida(registro, consulta):
    r = llamar(vistas.CambiosDeInstitucion, institucion=3, consulta=consulta)
    assert r.status_code == 400 and r.data["codigo"] == "paginacion_invalida"


def test_toda_vista_de_gestion_exige_acceso_completo_y_limita_la_tasa():
    for clase in (vistas.TiposDeInstitucion, vistas.TipoDeInstitucion, vistas.CambiosDeInstitucion):
        assert any(c.__name__ == "_ExigeScope" for c in clase.permission_classes), clase
        assert clase.throttle_scope == "api"
