"""Pruebas de los modelos y del adaptador. No usan la base de datos."""
from datetime import datetime, timezone

import pytest

from apps.auditoria.models import DecisionPdp, EventoAuditoria
from apps.autenticacion.models import EventoSeguridad, Sesion
from apps.catalogo.models import Institucion, TipoTramite
from apps.identidad.models import Aprobacion, Membresia, Perfil, Usuario
from apps.identidad.sujeto import construir_sujeto
from apps.nucleo.esquema import columnas_del_modelo, diferencias, modelos_de_dominio
from apps.tramites.models import Tramite, Transicion

TABLAS = {
    Institucion: "institucion", TipoTramite: "tipo_tramite", Usuario: "usuario", Membresia: "membresia",
    Aprobacion: "aprobacion", Tramite: "tramite", Transicion: "transicion",
    EventoAuditoria: "evento_auditoria", DecisionPdp: "decision_pdp",
    Sesion: "sesion", EventoSeguridad: "evento_seguridad", Perfil: "perfil",
}


@pytest.mark.parametrize("modelo,tabla", TABLAS.items())
def test_ningun_modelo_crea_ni_migra_tablas(modelo, tabla):
    assert modelo._meta.managed is False
    assert modelo._meta.db_table == tabla


def test_estan_los_doce_modelos_del_esquema():
    assert {m._meta.db_table for m in modelos_de_dominio()} == set(TABLAS.values())


def test_las_columnas_de_las_claves_foraneas_coinciden_con_la_base():
    assert columnas_del_modelo(Tramite) >= {"tipo_tramite_id", "institucion_id", "solicitante_id", "funcionario_asignado_id", "estado"}
    assert columnas_del_modelo(Membresia) >= {"usuario_id", "institucion_id", "rol", "asignado_por"}
    assert "usuario_id" not in columnas_del_modelo(Usuario)


def test_las_claves_compuestas_se_mapean():
    assert Membresia._meta.pk.__class__.__name__ == "CompositePrimaryKey"
    assert Transicion._meta.pk.__class__.__name__ == "CompositePrimaryKey"


def test_diferencias_distingue_lo_que_falta_de_lo_que_sobra():
    assert diferencias({"a", "b"}, {"a", "b", "c"}) == ([], ["c"])
    assert diferencias({"a", "b", "z"}, {"a", "b"}) == (["z"], [])


@pytest.mark.parametrize("modelo", [EventoAuditoria, DecisionPdp, EventoSeguridad])
def test_la_auditoria_no_se_modifica_ni_se_borra(modelo):
    existente = modelo(pk=1)
    existente._state.adding = False
    with pytest.raises(PermissionError):
        existente.save()
    with pytest.raises(PermissionError):
        existente.delete()


def test_el_adaptador_traduce_el_usuario_al_sujeto_del_pdp():
    mfa = datetime(2026, 10, 20, 12, 0, tzinfo=timezone.utc)
    u = Usuario(pk=7, username="ana", estado_cuenta="activa", nivel_aseguramiento=2, rol_plataforma="ninguno", mfa_verificado_en=mfa)
    m = Membresia(institucion_id=3, rol="funcionario")
    s = construir_sujeto(u, [m, (5, "supervisor")])
    assert s.id == 7 and s.nivel_aseguramiento == 2 and s.mfa_verificado_en == mfa
    assert s.membresias == frozenset({(3, "funcionario"), (5, "supervisor")})


def test_el_pdp_funciona_con_un_sujeto_construido_desde_el_modelo():
    from apps.autorizacion.pdp import Accion, Entorno, Recurso, decidir
    ahora = datetime(2026, 10, 20, 12, 0, tzinfo=timezone.utc)
    u = Usuario(pk=7, username="ana", mfa_verificado_en=ahora)
    s = construir_sujeto(u, [(3, "funcionario")])
    d = decidir(s, Accion.VER_TRAMITE, Recurso(tipo="tramite", institucion_id=3, solicitante_id=99), Entorno(ahora=ahora))
    assert d.permitido
