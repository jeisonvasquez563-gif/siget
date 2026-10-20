"""Pruebas del PDP: por cada fila de la matriz de roles, un caso permitido y uno denegado."""
from datetime import datetime, timedelta, timezone

import pytest

from apps.autorizacion.pdp import Accion, Entorno, Recurso, Sujeto, decidir

AHORA = datetime(2026, 10, 20, 12, 0, tzinfo=timezone.utc)
MOP, MINSA = 3, 2


def entorno(**kw):
    return Entorno(ahora=AHORA, **kw)


def mfa(minutos_atras):
    return AHORA - timedelta(minutes=minutos_atras)


def persona(id=10, **kw):
    kw.setdefault("mfa_verificado_en", mfa(2))
    return Sujeto(id=id, **kw)


def funcionario(institucion=MOP, **kw):
    return persona(membresias=frozenset({(institucion, "funcionario")}), **kw)


def supervisor(institucion=MOP, **kw):
    return persona(membresias=frozenset({(institucion, "supervisor")}), **kw)


def coordinador(institucion=MOP, **kw):
    return persona(membresias=frozenset({(institucion, "coordinador_institucional")}), **kw)


def tramite(institucion=MOP, **kw):
    kw.setdefault("solicitante_id", 99)
    kw.setdefault("estado", "En Tramitacion")
    return Recurso(tipo="tramite", institucion_id=institucion, **kw)


def permite(s, a, r, e=None):
    return decidir(s, a, r, e or entorno()).permitido


# --------------------------------------------------------------------------- ciudadano

class TestCiudadano:
    def test_crea_su_tramite(self):
        assert permite(persona(id=5), Accion.CREAR_TRAMITE, tramite(solicitante_id=5))

    def test_no_crea_a_nombre_de_otro(self):
        assert not permite(persona(id=5), Accion.CREAR_TRAMITE, tramite(solicitante_id=6))

    def test_ve_lo_propio_y_no_lo_ajeno(self):
        assert permite(persona(id=5), Accion.VER_TRAMITE, tramite(solicitante_id=5))
        assert not permite(persona(id=5), Accion.VER_TRAMITE, tramite(solicitante_id=6))

    def test_adjunta_documento_propio(self):
        doc = Recurso(tipo="documento", institucion_id=MOP, solicitante_id=5)
        assert permite(persona(id=5), Accion.ADJUNTAR_DOCUMENTO, doc)

    def test_no_cambia_estados(self):
        assert not permite(persona(id=5), Accion.CAMBIAR_ESTADO, tramite(solicitante_id=5, estado_destino="Aprobado"))

    def test_sin_mfa_se_niega_si_el_diseno_lo_exige(self):
        sin_mfa = persona(id=5, mfa_verificado_en=None)
        assert not permite(sin_mfa, Accion.CREAR_TRAMITE, tramite(solicitante_id=5))

    def test_sin_mfa_se_permite_si_el_ciudadano_es_opcional(self):
        sin_mfa = persona(id=5, mfa_verificado_en=None)
        assert permite(sin_mfa, Accion.CREAR_TRAMITE, tramite(solicitante_id=5), entorno(mfa_ciudadano_obligatorio=False))


# --------------------------------------------------------------------------- funcionario

class TestFuncionario:
    def test_ve_tramites_de_su_institucion(self):
        assert permite(funcionario(), Accion.VER_TRAMITE, tramite())

    def test_no_ve_tramites_de_otra_institucion(self):
        assert not permite(funcionario(MOP), Accion.VER_TRAMITE, tramite(MINSA))

    def test_cambia_estado_valido_de_su_cola(self):
        assert permite(funcionario(), Accion.CAMBIAR_ESTADO, tramite(estado="Pendiente", estado_destino="En Tramitacion"))

    def test_cambia_estado_si_esta_asignado_a_el(self):
        assert permite(funcionario(), Accion.CAMBIAR_ESTADO,
                       tramite(funcionario_asignado_id=10, estado_destino="Aprobado"))

    def test_no_cambia_estado_si_esta_asignado_a_otro(self):
        assert not permite(funcionario(), Accion.CAMBIAR_ESTADO,
                           tramite(funcionario_asignado_id=77, estado_destino="Aprobado"))

    @pytest.mark.parametrize("minutos", [16, 120])
    def test_mfa_vencido_se_niega(self, minutos):
        s = funcionario(mfa_verificado_en=mfa(minutos))
        assert not permite(s, Accion.CAMBIAR_ESTADO, tramite(estado_destino="Aprobado"))

    def test_mfa_en_el_limite_se_permite(self):
        s = funcionario(mfa_verificado_en=mfa(15))
        assert permite(s, Accion.CAMBIAR_ESTADO, tramite(estado_destino="Aprobado"))

    def test_sin_mfa_se_niega(self):
        s = funcionario(mfa_verificado_en=None)
        assert not permite(s, Accion.CAMBIAR_ESTADO, tramite(estado_destino="Aprobado"))

    @pytest.mark.parametrize("estado,destino", [
        ("Pendiente", "Aprobado"), ("En Tramitacion", "Pendiente"), ("Aprobado", "Rechazado"),
        ("Rechazado", "En Tramitacion"), ("En Subsanacion", "Aprobado"),
    ])
    def test_transiciones_invalidas_se_niegan(self, estado, destino):
        assert not permite(funcionario(), Accion.CAMBIAR_ESTADO, tramite(estado=estado, estado_destino=destino))

    def test_sin_estado_destino_se_niega(self):
        assert not permite(funcionario(), Accion.CAMBIAR_ESTADO, tramite())

    def test_conflicto_de_interes(self):
        s = funcionario(id=10)
        assert not permite(s, Accion.CAMBIAR_ESTADO, tramite(solicitante_id=10, estado_destino="Aprobado"))

    @pytest.mark.parametrize("estado_cuenta", ["bloqueada", "suspendida"])
    def test_cuenta_no_activa_se_niega_todo(self, estado_cuenta):
        s = funcionario(estado_cuenta=estado_cuenta)
        assert not permite(s, Accion.VER_TRAMITE, tramite())

    def test_no_reasigna(self):
        assert not permite(funcionario(), Accion.REASIGNAR_TRAMITE, tramite())


# --------------------------------------------------------------------------- supervisor

class TestSupervisor:
    def test_cambia_estado_aunque_este_asignado_a_otro(self):
        assert permite(supervisor(), Accion.CAMBIAR_ESTADO,
                       tramite(funcionario_asignado_id=77, estado_destino="Aprobado"))

    def test_reasigna_y_atiende_escalados(self):
        assert permite(supervisor(), Accion.REASIGNAR_TRAMITE, tramite())
        assert permite(supervisor(), Accion.ESCALAR_TRAMITE, tramite())

    def test_reasignar_exige_mfa_reciente(self):
        assert not permite(supervisor(mfa_verificado_en=mfa(40)), Accion.REASIGNAR_TRAMITE, tramite())

    def test_solo_en_su_institucion(self):
        assert not permite(supervisor(MOP), Accion.REASIGNAR_TRAMITE, tramite(MINSA))

    def test_no_gestiona_un_tramite_propio(self):
        assert not permite(supervisor(id=10), Accion.REASIGNAR_TRAMITE, tramite(solicitante_id=10))


# --------------------------------------------------------------------------- coordinador institucional

class TestCoordinador:
    @pytest.mark.parametrize("accion", [Accion.GESTIONAR_USUARIOS_INSTITUCION, Accion.GESTIONAR_CATALOGO_INSTITUCION])
    def test_gestiona_su_institucion(self, accion):
        assert permite(coordinador(), accion, Recurso(tipo="usuario", institucion_id=MOP))

    def test_no_gestiona_otra_institucion(self):
        assert not permite(coordinador(MOP), Accion.GESTIONAR_USUARIOS_INSTITUCION, Recurso(tipo="usuario", institucion_id=MINSA))

    def test_exige_mfa_reciente(self):
        assert not permite(coordinador(mfa_verificado_en=mfa(60)), Accion.GESTIONAR_CATALOGO_INSTITUCION,
                           Recurso(tipo="tipo_tramite", institucion_id=MOP))

    def test_no_cambia_estados(self):
        assert not permite(coordinador(), Accion.CAMBIAR_ESTADO, tramite(estado_destino="Aprobado"))

    def test_no_lee_documentos_ni_tramites(self):
        assert not permite(coordinador(), Accion.VER_DOCUMENTO, Recurso(tipo="documento", institucion_id=MOP, solicitante_id=99))
        assert not permite(coordinador(), Accion.VER_TRAMITE, tramite())


# --------------------------------------------------------------------------- roles de plataforma

def operador(rol, **kw):
    return persona(rol_plataforma=rol, **kw)


ALTA_COORD = Recurso(tipo="alta_coordinador", propuesto_por=1)
ALTA_INST = Recurso(tipo="alta_institucion", propuesto_por=1)

PERMITIDO_POR_ROL = [
    ("operador_infraestructura", Accion.ADMINISTRAR_INFRAESTRUCTURA, Recurso(tipo="servidor")),
    ("operador_identidades", Accion.PROPONER_ALTA, ALTA_COORD),
    ("operador_identidades", Accion.APROBAR_ALTA, ALTA_COORD),
    ("operador_identidades", Accion.RESTABLECER_MFA, Recurso(tipo="usuario")),
    ("operador_catalogo", Accion.PROPONER_ALTA, ALTA_INST),
    ("operador_catalogo", Accion.APROBAR_ALTA, ALTA_INST),
    ("operador_seguridad", Accion.BLOQUEAR_CUENTA, Recurso(tipo="usuario")),
    ("operador_seguridad", Accion.REVOCAR_SESION, Recurso(tipo="usuario")),
    ("custodio_secretos", Accion.ROTAR_SECRETOS, Recurso(tipo="secreto")),
]


class TestPlataforma:
    @pytest.mark.parametrize("rol,accion,recurso", PERMITIDO_POR_ROL)
    def test_cada_operador_hace_su_funcion(self, rol, accion, recurso):
        assert permite(operador(rol, id=50), accion, recurso)

    @pytest.mark.parametrize("rol,accion,recurso", PERMITIDO_POR_ROL)
    def test_exigen_mfa_reciente(self, rol, accion, recurso):
        assert not permite(operador(rol, id=50, mfa_verificado_en=mfa(30)), accion, recurso)

    @pytest.mark.parametrize("rol", sorted({r for r, _, _ in PERMITIDO_POR_ROL}))
    def test_ningun_operador_accede_a_tramites_ni_documentos(self, rol):
        s = operador(rol, id=50)
        for accion in (Accion.VER_TRAMITE, Accion.CAMBIAR_ESTADO, Accion.VER_DOCUMENTO):
            assert not permite(s, accion, tramite(solicitante_id=50, estado_destino="Aprobado"))
            assert not permite(s, accion, Recurso(tipo="documento", institucion_id=MOP, solicitante_id=50))

    def test_un_operador_no_hace_la_funcion_de_otro(self):
        assert not permite(operador("operador_infraestructura", id=50), Accion.PROPONER_ALTA, ALTA_COORD)
        assert not permite(operador("operador_seguridad", id=50), Accion.ROTAR_SECRETOS, Recurso(tipo="secreto"))
        assert not permite(operador("custodio_secretos", id=50), Accion.BLOQUEAR_CUENTA, Recurso(tipo="usuario"))
        assert not permite(operador("operador_identidades", id=50), Accion.ADMINISTRAR_INFRAESTRUCTURA, Recurso(tipo="servidor"))

    def test_cada_operador_solo_gestiona_su_tipo_de_alta(self):
        assert not permite(operador("operador_identidades", id=50), Accion.PROPONER_ALTA, ALTA_INST)
        assert not permite(operador("operador_catalogo", id=50), Accion.PROPONER_ALTA, ALTA_COORD)

    def test_control_dual_quien_propone_no_aprueba(self):
        propia = Recurso(tipo="alta_coordinador", propuesto_por=50)
        assert not permite(operador("operador_identidades", id=50), Accion.APROBAR_ALTA, propia)

    def test_control_dual_otra_persona_si_aprueba(self):
        assert permite(operador("operador_identidades", id=51), Accion.APROBAR_ALTA, Recurso(tipo="alta_coordinador", propuesto_por=50))

    def test_un_operador_no_es_ciudadano(self):
        s = operador("operador_infraestructura", id=50)
        assert not permite(s, Accion.CREAR_TRAMITE, tramite(solicitante_id=50))


# --------------------------------------------------------------------------- auditor

class TestAuditor:
    @pytest.mark.parametrize("accion", [Accion.CONSULTAR_AUDITORIA, Accion.CONSULTAR_DECISIONES])
    def test_consulta_con_nivel_alto_y_mfa(self, accion):
        assert permite(operador("auditor", nivel_aseguramiento=3), accion, Recurso(tipo="evento_auditoria"))

    @pytest.mark.parametrize("nivel", [1, 2])
    def test_nivel_insuficiente_se_niega(self, nivel):
        assert not permite(operador("auditor", nivel_aseguramiento=nivel), Accion.CONSULTAR_AUDITORIA, Recurso(tipo="evento_auditoria"))

    def test_mfa_vencido_se_niega(self):
        s = operador("auditor", nivel_aseguramiento=3, mfa_verificado_en=mfa(20))
        assert not permite(s, Accion.CONSULTAR_AUDITORIA, Recurso(tipo="evento_auditoria"))

    def test_no_lee_tramites_ni_modifica_nada(self):
        s = operador("auditor", nivel_aseguramiento=3)
        assert not permite(s, Accion.VER_TRAMITE, tramite())
        assert not permite(s, Accion.REASIGNAR_TRAMITE, tramite())
        assert not permite(s, Accion.CAMBIAR_ESTADO, tramite(estado_destino="Aprobado"))


# --------------------------------------------------------------------------- denegar por defecto y fail closed

class TestDenegarPorDefecto:
    def test_sin_membresias_ni_roles_no_puede_nada_ajeno(self):
        s = persona(id=5)
        for accion in Accion:
            if accion in {Accion.CREAR_TRAMITE, Accion.VER_TRAMITE, Accion.ADJUNTAR_DOCUMENTO, Accion.VER_DOCUMENTO}:
                continue
            assert not permite(s, accion, Recurso(tipo="tramite", institucion_id=MOP, solicitante_id=99, estado="Pendiente", estado_destino="En Tramitacion"))

    def test_el_motivo_queda_registrado(self):
        d = decidir(persona(id=5), Accion.ROTAR_SECRETOS, Recurso(tipo="secreto"), entorno())
        assert d.permitido is False and d.politica == "sin_regla_que_permita"

    def test_toda_decision_denegada_o_permitida_trae_politica(self):
        d = decidir(funcionario(), Accion.VER_TRAMITE, tramite(), entorno())
        assert d.permitido and d.politica

    def test_fallo_interno_deniega(self):
        d = decidir(None, Accion.VER_TRAMITE, tramite(), entorno())
        assert d.permitido is False and d.politica == "fallo_del_pdp"

    def test_una_denegacion_anula_un_permiso(self):
        # funcionario con permiso sobre su institucion, pero cuenta suspendida
        assert not permite(funcionario(estado_cuenta="suspendida"), Accion.VER_TRAMITE, tramite())
