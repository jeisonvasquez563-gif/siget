"""«Mis documentos» e «Indicadores de la institución»: vistas con una base simulada, rutas y la migración 022.

Sin base de datos: que la base filtre y proteja las filas lo recorren `verificar_equipo` y `verificar_tramites` (por la API) y
`database/pruebas-indicadores.sql` (en la base, como `app_role` con el contexto de cada persona). Las reglas del PDP están en `test_pdp.py`.
"""
import json
import re
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest
from django.db import DatabaseError
from django.urls import get_resolver, reverse
from rest_framework.test import APIRequestFactory, force_authenticate

from apps.autorizacion.pdp import Accion
from apps.identidad import vistas_indicadores as indicadores
from apps.nucleo.errores import AccesoDenegado
from apps.tramites import vistas_mis_documentos as mis_documentos

AHORA = datetime(2026, 11, 26, 12, 0, tzinfo=timezone.utc)
MIGRACION = Path(__file__).resolve().parents[2] / "database" / "migraciones" / "022-indicadores-institucion.sql"
PRUEBAS = Path(__file__).resolve().parents[2] / "database" / "pruebas-indicadores.sql"


def llamar(vista, ruta="/x/", kwargs=None, scope="completo"):
    peticion = APIRequestFactory().get(ruta, secure=True)
    principal = SimpleNamespace(usuario=SimpleNamespace(pk=7), claims=SimpleNamespace(scope=scope), is_authenticated=True, pk=7)
    force_authenticate(peticion, user=principal)
    return vista.as_view()(peticion, **(kwargs or {}))


# --------------------------------------------------------------------------- rutas

def test_las_rutas_se_resuelven():
    assert reverse("mis-documentos") == "/tramites/mis-documentos/"
    assert reverse("equipo-indicadores", kwargs={"institucion": 3}) == "/equipo/3/indicadores/"


def test_mis_documentos_no_se_confunde_con_un_tramite():
    assert get_resolver().resolve("/tramites/mis-documentos/").func.view_class is mis_documentos.MisDocumentos


def test_las_vistas_corren_en_una_transaccion_por_la_seguridad_por_filas():
    for clase in (mis_documentos.MisDocumentos, indicadores.IndicadoresInstitucion):
        assert not getattr(clase.as_view(), "_non_atomic_requests", None), clase.__name__


# --------------------------------------------------------------------------- mis documentos

def un_documento(pk, tramite_id=9, nombre="plano.pdf"):
    return SimpleNamespace(pk=pk, nombre=nombre, tipo_mime="application/pdf", tamano=1234, creado_en=AHORA, tramite_id=tramite_id,
                           sha256="a" * 64, subido_por_id=7, ubicacion="u" * 32,
                           tramite=SimpleNamespace(tipo_tramite=SimpleNamespace(nombre="Permiso de uso de vía pública"),
                                                   institucion=SimpleNamespace(nombre="MOP"), funcionario_asignado_id=88))


class ConsultaDeDocumentos:
    def __init__(self, filas, registro):
        self.filas, self.registro = filas, registro

    def filter(self, *criterios, **filtros):
        self.registro.filtros.append((criterios, filtros))
        return self

    def select_related(self, *campos):
        return self

    def order_by(self, *campos):
        self.registro.orden = campos
        return self

    def count(self):
        return len(self.filas)

    def __getitem__(self, corte):
        self.registro.corte = corte
        return self.filas[corte]


@pytest.fixture
def documentos(monkeypatch):
    reg = SimpleNamespace(filtros=[], decisiones=[], contexto=[], orden=None, corte=None,
                          filas=[un_documento(3, 9, "b.pdf"), un_documento(2, 9), un_documento(1, 4, "c.png")])
    monkeypatch.setattr("rest_framework.throttling.ScopedRateThrottle.allow_request", lambda self, request, view: True)
    monkeypatch.setattr(mis_documentos, "Documento", SimpleNamespace(objects=ConsultaDeDocumentos(reg.filas, reg)))
    monkeypatch.setattr(mis_documentos, "fijar_contexto", lambda usuario_id, instituciones: reg.contexto.append((usuario_id, tuple(instituciones))))
    monkeypatch.setattr(mis_documentos, "autorizar", lambda request, accion, recurso, registrar_permitidas=True: reg.decisiones.append((accion, recurso)))
    return reg


def test_la_lista_trae_el_tramite_y_nada_del_personal(documentos):
    r = llamar(mis_documentos.MisDocumentos)
    assert r.status_code == 200 and r.data["total"] == 3 and r.data["limite"] == 20 and r.data["desplazamiento"] == 0
    assert r.data["resultados"][0] == {"id": 3, "nombre": "b.pdf", "tipo": "application/pdf", "tamano": 1234, "creado_en": AHORA.isoformat(),
                                       "tramite": {"id": 9, "tipo_tramite": "Permiso de uso de vía pública", "institucion": "MOP"}}
    texto = str(r.data)
    assert "88" not in texto and "sha256" not in texto and "ubicacion" not in texto and "a" * 64 not in texto
    assert r["Cache-Control"] == "no-store"


def test_el_contexto_es_solo_la_persona_y_el_pdp_decide_sobre_lo_propio(documentos):
    llamar(mis_documentos.MisDocumentos)
    assert documentos.contexto == [(7, ())]  # sin instituciones: aunque atienda trámites, aquí solo ve lo suyo
    accion, recurso = documentos.decisiones[0]
    assert accion == Accion.VER_DOCUMENTO and recurso.tipo == "documento" and recurso.solicitante_id == 7


def test_filtra_por_solicitante_y_por_quien_subio_el_archivo_ademas_de_la_base(documentos):
    llamar(mis_documentos.MisDocumentos)
    _, filtros = documentos.filtros[0]
    assert filtros == {"tramite__solicitante_id": 7, "subido_por_id": 7} and documentos.orden == ("-creado_en", "-id")


def test_paginacion_y_total(documentos):
    r = llamar(mis_documentos.MisDocumentos, "/x/?limite=1&desplazamiento=1")
    assert r.data["limite"] == 1 and r.data["desplazamiento"] == 1 and r.data["total"] == 3
    assert documentos.corte == slice(1, 2)


@pytest.mark.parametrize("consulta", ["limite=0", "limite=101", "limite=abc", "desplazamiento=-1"])
def test_una_paginacion_invalida_da_400(documentos, consulta):
    r = llamar(mis_documentos.MisDocumentos, f"/x/?{consulta}")
    assert r.status_code == 400 and r.data["codigo"] == "paginacion_invalida"


def test_la_busqueda_por_nombre_o_tramite_y_por_numero(documentos):
    llamar(mis_documentos.MisDocumentos, "/x/?q=plano")
    criterio = str(documentos.filtros[-1][0][0])
    assert "nombre__icontains" in criterio and "tramite_id" not in criterio
    llamar(mis_documentos.MisDocumentos, "/x/?q=%2336")
    assert "tramite_id" in str(documentos.filtros[-1][0][0])  # «#36»: el número del trámite


def test_una_busqueda_vacia_no_filtra_y_una_larga_da_400(documentos):
    assert llamar(mis_documentos.MisDocumentos, "/x/?q=%20%20").status_code == 200 and len(documentos.filtros) == 1
    r = llamar(mis_documentos.MisDocumentos, "/x/?q=" + "a" * 101)
    assert r.status_code == 400 and r.data["codigo"] == "filtro_invalido"


def test_si_el_pdp_niega_no_se_consulta_nada(documentos, monkeypatch):
    def negar(request, accion, recurso, registrar_permitidas=True):
        raise AccesoDenegado({"codigo": "acceso_denegado", "detalle": "No tienes autorización para esta operación.", "reautenticacion_sugerida": False})
    monkeypatch.setattr(mis_documentos, "autorizar", negar)
    assert llamar(mis_documentos.MisDocumentos).status_code == 403 and not documentos.filtros


def test_un_token_de_enrolamiento_no_sirve(documentos):
    assert llamar(mis_documentos.MisDocumentos, scope="enrolar_mfa").status_code == 403 and not documentos.decisiones


# --------------------------------------------------------------------------- indicadores

CRUDO = {
    "por_estado": {"Aprobado": 2, "En Subsanacion": 1, "En Tramitacion": 3, "Pendiente": 1, "Rechazado": 1},
    "abiertos": 5, "vencidos": 2, "escalados_abiertos": 1, "sin_asignar": 1, "resueltos_90_dias": 2, "dias_promedio_resolucion": 15.0,
    "por_funcionario": [{"usuario_id": 21, "usuario": "fabio.mop", "abiertos": 2, "solicitante": "dato que no debe salir"}],
    "ids_de_tramites": [1, 2, 3],  # no debe salir aunque la función lo devolviera
}


class Cursor:
    def __init__(self, reg):
        self.reg = reg

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def execute(self, sql, params):
        self.reg.pasos.append(("sql", sql, params))
        if self.reg.fallo:
            raise self.reg.fallo

    def fetchone(self):
        return (self.reg.crudo,)


class CausaDelControlador(Exception):
    def __init__(self, sqlstate):
        super().__init__("permission denied")
        self.sqlstate = sqlstate


@pytest.fixture
def base(monkeypatch):
    reg = SimpleNamespace(pasos=[], fallo=None, crudo=CRUDO)

    @contextmanager
    def atomico():
        reg.pasos.append(("inicio",))
        yield

    monkeypatch.setattr("rest_framework.throttling.ScopedRateThrottle.allow_request", lambda self, request, view: True)
    monkeypatch.setattr(indicadores, "connection", SimpleNamespace(cursor=lambda: Cursor(reg)))
    monkeypatch.setattr(indicadores, "transaction", SimpleNamespace(atomic=atomico))
    monkeypatch.setattr(indicadores, "fijar_contexto", lambda usuario_id, instituciones: reg.pasos.append(("contexto", usuario_id, tuple(instituciones))))
    monkeypatch.setattr(indicadores, "autorizar", lambda request, accion, recurso, registrar_permitidas=True: reg.pasos.append(("pdp", accion, recurso)))
    monkeypatch.setattr(indicadores, "registrar_evento", lambda actor, evento, ip, detalle=None: reg.pasos.append(("seguridad", actor, evento, ip, detalle)))
    return reg


def pedir(institucion=3):
    return llamar(indicadores.IndicadoresInstitucion, kwargs={"institucion": institucion})


def test_el_pdp_decide_antes_de_tocar_la_base_sobre_la_institucion_de_la_ruta(base):
    assert pedir(3).status_code == 200
    orden = [p[0] for p in base.pasos]
    assert orden.index("pdp") < orden.index("sql")
    accion, recurso = next(p[1:] for p in base.pasos if p[0] == "pdp")
    assert accion == Accion.VER_INDICADORES_INSTITUCION and recurso.tipo == "indicadores" and recurso.institucion_id == 3
    assert ("contexto", 7, ()) in base.pasos and next(p for p in base.pasos if p[0] == "sql")[2] == [3]


def test_la_respuesta_lleva_solo_agregados_y_las_claves_de_la_lista_fija(base):
    r = pedir(3)
    assert set(r.data) == {"institucion", "generado_en", "por_estado", "abiertos", "vencidos", "escalados_abiertos", "sin_asignar",
                           "resueltos_90_dias", "dias_promedio_resolucion", "por_funcionario"}
    assert r.data["institucion"] == 3 and r.data["abiertos"] == 5 and r.data["dias_promedio_resolucion"] == 15.0
    assert r.data["por_estado"]["En Tramitacion"] == 3
    assert r.data["por_funcionario"] == [{"usuario_id": 21, "usuario": "fabio.mop", "abiertos": 2}]
    assert "dato que no debe salir" not in str(r.data) and "ids_de_tramites" not in r.data
    assert r["Cache-Control"] == "no-store"


def test_sin_resueltos_el_promedio_es_nulo_y_no_cero(base):
    base.crudo = {**CRUDO, "dias_promedio_resolucion": None, "resueltos_90_dias": 0}
    assert pedir().data["dias_promedio_resolucion"] is None


def test_acepta_el_json_como_texto(base):
    base.crudo = json.dumps(CRUDO)
    assert pedir().data["abiertos"] == 5


def test_si_el_pdp_niega_no_se_toca_la_base(base, monkeypatch):
    def negar(request, accion, recurso, registrar_permitidas=True):
        base.pasos.append(("pdp", accion, recurso))
        raise AccesoDenegado({"codigo": "acceso_denegado", "detalle": "No tienes autorización para esta operación.", "reautenticacion_sugerida": False})
    monkeypatch.setattr(indicadores, "autorizar", negar)
    r = pedir(99)
    assert r.status_code == 403 and r.data["codigo"] == "acceso_denegado" and not [p for p in base.pasos if p[0] == "sql"]


def test_si_la_base_niega_el_permiso_es_403_con_un_evento_sin_datos_sensibles(base):
    error = DatabaseError("Indicadores: solo la supervision o la coordinacion vigente de la institucion")
    error.__cause__ = CausaDelControlador("42501")
    base.fallo = error
    r = pedir(3)
    assert r.status_code == 403 and r.data == {"codigo": "acceso_denegado", "detalle": "No tienes autorización para esta operación."}
    evento = [p for p in base.pasos if p[0] == "seguridad"]
    assert evento == [("seguridad", 7, "indicadores_denegados_por_la_base", None, {"institucion": 3})]
    assert "Indicadores:" not in str(evento)


def test_cualquier_otro_error_de_la_base_sigue_siendo_un_fallo_real(base):
    error = DatabaseError("conexion perdida")
    error.__cause__ = CausaDelControlador("08006")
    base.fallo = error
    with pytest.raises(DatabaseError):
        pedir(3)
    assert not [p for p in base.pasos if p[0] == "seguridad"]


def test_un_token_de_enrolamiento_no_sirve_ni_llega_al_pdp(base):
    r = llamar(indicadores.IndicadoresInstitucion, kwargs={"institucion": 3}, scope="enrolar_mfa")
    assert r.status_code == 403 and not [p for p in base.pasos if p[0] == "pdp"]


def test_la_ruta_solo_recibe_numeros_de_institucion():
    assert get_resolver().resolve("/equipo/3/indicadores/").func.view_class is indicadores.IndicadoresInstitucion
    with pytest.raises(Exception):
        get_resolver().resolve("/equipo/tres/indicadores/")


# --------------------------------------------------------------------------- migración 022

SQL = MIGRACION.read_text(encoding="utf-8")


def sin_comentarios(texto):
    return "\n".join(re.sub(r"--.*", "", linea) for linea in texto.splitlines())


def test_la_migracion_es_una_transaccion_del_duenio_con_la_funcion_definida_como_se_espera():
    codigo = sin_comentarios(SQL)
    assert codigo.strip().startswith("BEGIN;") and codigo.strip().endswith("COMMIT;") and "SET LOCAL ROLE siget_owner;" in codigo
    assert "CREATE FUNCTION siget.indicadores_institucion(p_institucion int) RETURNS jsonb" in codigo
    assert "SECURITY DEFINER" in codigo and "SET search_path = siget, pg_temp" in codigo
    assert "REVOKE ALL ON FUNCTION siget.indicadores_institucion(int) FROM PUBLIC;" in codigo
    assert "GRANT EXECUTE ON FUNCTION siget.indicadores_institucion(int) TO app_role;" in codigo
    assert len(re.findall(r"GRANT EXECUTE", codigo)) == 1


def test_la_funcion_verifica_adentro_quien_pregunta_y_solo_devuelve_agregados():
    codigo = sin_comentarios(SQL)
    assert "siget.ctx_usuario()" in codigo and "revocada_en IS NULL" in codigo and "estado_cuenta = 'activa'" in codigo
    assert "('supervisor', 'coordinador_institucional')" in codigo and "ERRCODE = '42501'" in codigo
    devuelto = codigo[codigo.index("RETURN jsonb_build_object"):]
    assert "solicitante" not in devuelto and "t.id" not in devuelto and "tramite_id" not in devuelto
    carga = codigo[codigo.index("SELECT coalesce(jsonb_agg"):codigo.index("RETURN jsonb_build_object")]
    assert "m.rol IN ('funcionario', 'supervisor')" in carga and "solicitante" not in carga


def test_la_migracion_no_cambia_tablas():
    assert not re.search(r"\b(ALTER TABLE|CREATE TABLE|DROP|INSERT INTO|UPDATE |DELETE FROM)", sin_comentarios(SQL))


def test_las_pruebas_de_la_base_traen_su_resumen_y_terminan_revirtiendo():
    texto = PRUEBAS.read_text(encoding="utf-8")
    codigo = sin_comentarios(texto)
    assert codigo.strip().startswith("BEGIN;") and codigo.strip().endswith("ROLLBACK;") and "RESUMEN:" in texto and "PASA" in texto and "FALLA" in texto
