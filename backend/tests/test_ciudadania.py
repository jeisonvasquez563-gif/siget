"""Trámites de la ciudadanía (migración 021): desistir, constancia de presentación y requisitos antes de iniciar.

Sin base de datos: el ORM, el contexto de seguridad por filas y el PDP se sustituyen por dobles que registran lo que la vista les pide. Lo que
decide la base (transiciones, política RLS, disparadores, notificaciones) lo prueban `database/pruebas-ciudadania.sql` y `verificar_tramites`
contra la base real; aquí se revisa además, sobre el texto de la migración, que lo que promete su encabezado esté escrito.
"""
import re
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest
from django.db import DatabaseError
from django.urls import reverse
from rest_framework.test import APIRequestFactory, force_authenticate

from apps.autorizacion.pdp import Accion
from apps.nucleo.errores import AccesoDenegado
from apps.tramites import serializacion as ser
from apps.tramites import vistas

AHORA = datetime(2026, 11, 26, 15, 30, tzinfo=timezone.utc)
FORMULARIO = [
    {"id": "direccion_terreno", "etiqueta": "Dirección del terreno", "tipo": "texto", "obligatorio": True, "max": 200},
    {"id": "tipo_obra", "etiqueta": "Tipo de obra", "tipo": "seleccion", "obligatorio": True, "opciones": ["Obra nueva", "Ampliación"]},
    {"id": "area_m2", "etiqueta": "Área de la obra (m²)", "tipo": "numero", "obligatorio": False, "max": 100000},
    {"id": "descripcion", "etiqueta": "Descripción de la obra", "tipo": "texto_largo", "obligatorio": False, "max": 2000},
]
DATOS = {"tipo_obra": "Ampliación", "direccion_terreno": "Calle 50, Panamá", "area_m2": 85.5}


def un_tramite(**kw):
    base = dict(pk=9, tipo_tramite_id=1, tipo_tramite=SimpleNamespace(nombre="Permiso de Construcción Municipal"), institucion_id=3,
                institucion=SimpleNamespace(nombre="Alcaldía"), estado="En Tramitacion", fecha_limite=AHORA + timedelta(days=3),
                creado_en=AHORA - timedelta(days=1), solicitante_id=5, funcionario_asignado_id=88, sensibilidad=2, escalado_en=None,
                datos=DATOS, formulario=FORMULARIO)
    base.update(kw)
    return SimpleNamespace(**base)


# --------------------------------------------------------------------------- estados: Desistido es final

def test_desistido_es_un_estado_valido_y_final():
    assert "Desistido" in ser.ESTADOS_VALIDOS and ser.ESTADOS_FINALES == {"Aprobado", "Rechazado", "Desistido"}


def test_un_tramite_desistido_nunca_esta_vencido_ni_corre_contra_el_reloj():
    assert ser.esta_vencido(AHORA - timedelta(days=30), "Desistido", AHORA) is False
    assert ser.tramite_a_dict(un_tramite(estado="Desistido", fecha_limite=AHORA - timedelta(days=2)), personal=False, ahora=AHORA)["vencido"] is False


def test_el_modelo_lista_desistido_entre_los_estados():
    from apps.tramites.models import ESTADOS
    assert ("Desistido", "Desistido") in ESTADOS


def evento(**kw):
    base = dict(pk=1, accion="cambio_estado", estado_anterior="En Tramitacion", estado_nuevo="Desistido", institucion_id=3, creado_en=AHORA,
                actor_id=5, atributos={"motivo": "Ya no necesito este trámite."})
    base.update(kw)
    return SimpleNamespace(**base)


def test_la_persona_lee_su_propio_motivo_de_desistimiento_y_el_personal_tambien():
    assert ser.evento_a_dict(evento(), personal=False)["motivo"] == "Ya no necesito este trámite."
    assert ser.evento_a_dict(evento(), personal=True)["motivo"] == "Ya no necesito este trámite."


def test_el_resto_de_los_motivos_internos_siguen_sin_verse_la_ciudadania():
    interno = evento(estado_anterior="Pendiente", estado_nuevo="En Tramitacion", atributos={"motivo": "Comentario interno del personal."})
    assert ser.evento_a_dict(interno, personal=False)["motivo"] is None
    assert ser.evento_a_dict(interno, personal=True)["motivo"] == "Comentario interno del personal."


# --------------------------------------------------------------------------- constancia: salida

def test_los_datos_van_en_el_orden_del_formulario_con_sus_etiquetas_y_solo_los_respondidos():
    datos = ser.datos_con_etiquetas(FORMULARIO, DATOS)
    assert [d["id"] for d in datos] == ["direccion_terreno", "tipo_obra", "area_m2"]  # el orden del formulario, no el de los datos; sin la descripción
    assert datos[0] == {"id": "direccion_terreno", "etiqueta": "Dirección del terreno", "tipo": "texto", "valor": "Calle 50, Panamá"}
    assert datos[2]["etiqueta"] == "Área de la obra (m²)" and datos[2]["valor"] == 85.5


def test_lo_que_ya_no_esta_en_el_formulario_de_la_copia_no_se_muestra_ni_se_inventa():
    assert ser.datos_con_etiquetas(FORMULARIO[:1], {**DATOS, "campo_viejo": "x"}) == [
        {"id": "direccion_terreno", "etiqueta": "Dirección del terreno", "tipo": "texto", "valor": "Calle 50, Panamá"}]


@pytest.mark.parametrize("formulario,datos", [([], {}), ([], None), (None, DATOS), ("no", DATOS), (FORMULARIO, None), (FORMULARIO, []), ([5, None], DATOS)])
def test_datos_raros_no_rompen_la_constancia(formulario, datos):
    assert ser.datos_con_etiquetas(formulario, datos) == [] or isinstance(ser.datos_con_etiquetas(formulario, datos), list)


def test_la_constancia_lleva_lo_pedido_y_nada_de_mas():
    adjuntos = [SimpleNamespace(pk=4, nombre="plano.pdf", tipo_mime="application/pdf", tamano=10, sha256="a" * 64, ubicacion="b" * 32, subido_por_id=5)]
    c = ser.constancia_a_dict(un_tramite(), adjuntos, AHORA)
    assert c["numero"] == 9 and c["tipo_tramite"] == {"id": 1, "nombre": "Permiso de Construcción Municipal"}
    assert c["institucion"] == {"id": 3, "nombre": "Alcaldía"} and c["estado"] == "En Tramitacion"
    assert c["presentado_en"] == (AHORA - timedelta(days=1)).isoformat() and c["fecha_limite"] == (AHORA + timedelta(days=3)).isoformat()
    assert c["emitida_en"] == AHORA.isoformat()
    assert [d["etiqueta"] for d in c["datos"]] == ["Dirección del terreno", "Tipo de obra", "Área de la obra (m²)"]
    assert c["documentos"] == [{"id": 4, "nombre": "plano.pdf"}]  # solo el nombre: ni huella, ni ubicación, ni quién lo subió
    assert set(c) == {"numero", "tipo_tramite", "institucion", "presentado_en", "fecha_limite", "estado", "datos", "documentos", "emitida_en"}
    texto = str(c)
    assert "88" not in texto and "funcionario" not in texto and "sensibilidad" not in texto and "a" * 64 not in texto


def test_la_constancia_de_un_tramite_sin_documentos_ni_datos():
    c = ser.constancia_a_dict(un_tramite(datos={}, fecha_limite=None), [], AHORA)
    assert c["datos"] == [] and c["documentos"] == [] and c["fecha_limite"] is None


# --------------------------------------------------------------------------- vistas (con el ORM, el contexto y el PDP simulados)

@pytest.fixture
def registro(monkeypatch):
    from rest_framework.response import Response
    reg = SimpleNamespace(pasos=[], tramite=un_tramite(), actualizadas=1, fallo=None, documentos=[])

    class Tramites:
        def filter(self, **filtros):
            reg.pasos.append(("filtro", filtros))

            def actualizar(**cambios):
                reg.pasos.append(("update", cambios))
                if reg.fallo:
                    raise reg.fallo
                return reg.actualizadas
            return SimpleNamespace(update=actualizar)

    class Documentos:
        def filter(self, **filtros):
            reg.pasos.append(("documentos", filtros))
            return SimpleNamespace(order_by=lambda *campos: list(reg.documentos))

    @contextmanager
    def atomico():
        reg.pasos.append(("inicio",))
        yield

    def autorizar(request, accion, recurso):
        reg.pasos.append(("pdp", accion, recurso))
        if reg.niega:
            raise AccesoDenegado({"codigo": "acceso_denegado", "detalle": "No tienes autorización para esta operación.", "reautenticacion_sugerida": False})

    reg.niega = False
    monkeypatch.setattr("rest_framework.throttling.ScopedRateThrottle.allow_request", lambda self, request, view: True)
    monkeypatch.setattr(vistas, "_membresias", lambda usuario: [])
    monkeypatch.setattr(vistas, "fijar_contexto", lambda usuario_id, instituciones: reg.pasos.append(("contexto", usuario_id, instituciones)))
    monkeypatch.setattr(vistas, "autorizar", autorizar)
    monkeypatch.setattr(vistas, "transaction", SimpleNamespace(atomic=atomico))
    monkeypatch.setattr(vistas, "_fijar_motivo", lambda motivo: reg.pasos.append(("motivo", motivo)))
    monkeypatch.setattr(vistas, "Tramite", SimpleNamespace(objects=Tramites()))
    monkeypatch.setattr(vistas, "Documento", SimpleNamespace(objects=Documentos()))
    monkeypatch.setattr(vistas._Base, "_tramite_visible", lambda self, pk: reg.tramite)
    monkeypatch.setattr(vistas._Base, "_respuesta", lambda self, pk, http=200: Response({"id": pk, "estado": "Desistido"}, status=http))
    return reg


def llamar(vista, metodo="post", cuerpo=None, pk=9):
    fabrica = APIRequestFactory()
    peticion = getattr(fabrica, metodo)("/x/", cuerpo, format="json", secure=True) if metodo != "get" else fabrica.get("/x/", secure=True)
    principal = SimpleNamespace(usuario=SimpleNamespace(pk=5), claims=SimpleNamespace(scope="completo"), is_authenticated=True, pk=5)
    force_authenticate(peticion, user=principal)
    return vista.as_view()(peticion, pk=pk)


def pasos(reg, nombre):
    return [p for p in reg.pasos if p[0] == nombre]


MOTIVO = "Ya no necesito este trámite."


def desistir(cuerpo=None):
    return llamar(vistas.TramiteDesistir, cuerpo={"motivo": MOTIVO} if cuerpo is None else cuerpo)


def test_desistir_pasa_a_desistido_con_el_motivo_y_responde_el_tramite(registro):
    r = desistir()
    assert r.status_code == 200 and r.data["estado"] == "Desistido"
    assert pasos(registro, "update") == [("update", {"estado": "Desistido"})]
    assert pasos(registro, "motivo") == [("motivo", MOTIVO)]


def test_desistir_primero_consulta_al_pdp_con_la_accion_nueva_y_el_destino(registro):
    desistir()
    pdp = pasos(registro, "pdp")[0]
    assert pdp[1] == Accion.DESISTIR_TRAMITE and pdp[2].tipo == "tramite" and pdp[2].solicitante_id == 5
    assert pdp[2].estado == "En Tramitacion" and pdp[2].estado_destino == "Desistido"
    assert registro.pasos.index(pdp) < registro.pasos.index(pasos(registro, "motivo")[0])


def test_el_motivo_se_manda_a_la_base_antes_del_update_y_dentro_de_la_transaccion(registro):
    desistir()
    orden = [p[0] for p in registro.pasos]
    assert orden.index("inicio") < orden.index("motivo") < orden.index("update")


def test_el_update_va_condicionado_al_estado_que_se_vio(registro):
    registro.tramite = un_tramite(estado="En Subsanacion")
    desistir()
    assert pasos(registro, "filtro")[0][1] == {"pk": 9, "estado": "En Subsanacion"}  # concurrencia optimista: no se pisa un cambio ajeno


@pytest.mark.parametrize("estado", ["Pendiente", "En Tramitacion", "En Subsanacion"])
def test_se_puede_desistir_desde_cada_estado_no_final(registro, estado):
    registro.tramite = un_tramite(estado=estado)
    assert desistir().status_code == 200


@pytest.mark.parametrize("estado", ["Aprobado", "Rechazado", "Desistido"])
def test_un_tramite_resuelto_responde_409_y_no_se_escribe_nada(registro, estado):
    registro.tramite = un_tramite(estado=estado)
    r = desistir()
    assert r.status_code == 409 and r.data["codigo"] == "tramite_resuelto"
    assert not pasos(registro, "update") and not pasos(registro, "motivo")


def test_si_el_pdp_niega_no_se_toca_nada_ni_se_mira_el_motivo(registro):
    registro.niega = True
    r = desistir({"motivo": 5})  # ni siquiera se valida: quien no puede desistir no aprende nada
    assert r.status_code == 403 and r.data["codigo"] == "acceso_denegado"
    assert not pasos(registro, "update") and not pasos(registro, "motivo") and not pasos(registro, "inicio")


def test_si_el_pdp_niega_a_un_tramite_resuelto_tampoco_se_revela_su_estado(registro):
    registro.niega = True
    registro.tramite = un_tramite(estado="Aprobado")
    assert desistir().status_code == 403  # no un 409 que diga que ya está resuelto


def test_sin_motivo_es_400_con_el_error_en_el_campo(registro):
    for cuerpo in ({}, {"motivo": None}):
        r = desistir(cuerpo)
        assert r.status_code == 400 and r.data["codigo"] == "motivo_obligatorio" and "motivo" in r.data["errores"]
    assert not pasos(registro, "update")


@pytest.mark.parametrize("motivo", ["", "   ", "corto", "x" * 9, "!!!!!!!!!!!!", "a" * 2001, 5, ["Ya no lo necesito"], {"a": "b"}, "con\x00control largo",
                                    "‍‌‍‍‍‌‍‍‍‌‍"])
def test_un_motivo_invalido_es_400_por_campo_y_no_escribe(registro, motivo):
    r = desistir({"motivo": motivo})
    assert r.status_code == 400 and "motivo" in r.data["errores"], r.data
    assert not pasos(registro, "update") and not pasos(registro, "motivo")


@pytest.mark.parametrize("motivo", ["x" * 10, "a" * 2000, "Ya no lo necesito.\nPrimera línea\nSegunda"])
def test_un_motivo_valido_en_los_limites(registro, motivo):
    assert desistir({"motivo": motivo}).status_code == 200


def test_el_motivo_se_normaliza_sin_espacios_de_los_bordes(registro):
    desistir({"motivo": "   Ya no necesito este trámite.   "})
    assert pasos(registro, "motivo") == [("motivo", MOTIVO)]


def test_si_el_trámite_cambió_entre_tanto_es_409_de_conflicto(registro):
    registro.actualizadas = 0
    r = desistir()
    assert r.status_code == 409 and r.data["codigo"] == "conflicto"


def test_si_la_base_rechaza_el_desistimiento_es_409_y_no_un_500(registro):
    registro.fallo = DatabaseError("Solo la persona que solicito el tramite puede desistir de el")
    r = desistir()
    assert r.status_code == 409 and r.data["codigo"] == "transicion_rechazada"
    assert "persona que solicito" not in str(r.data)  # no se repite el texto de la base


def test_desistir_ignora_cualquier_otro_campo_del_cuerpo(registro):
    desistir({"motivo": MOTIVO, "estado": "Aprobado", "solicitante_id": 99, "funcionario_id": 1})
    assert pasos(registro, "update") == [("update", {"estado": "Desistido"})]


def test_un_cuerpo_que_no_es_objeto_se_trata_como_sin_motivo(registro):
    r = desistir(["x"])
    assert r.status_code == 400 and r.data["codigo"] == "motivo_obligatorio"


def test_fija_el_contexto_de_seguridad_por_filas_antes_de_hacer_nada(registro):
    desistir()
    assert registro.pasos[0][0] == "contexto" and registro.pasos[0][1] == 5


# ----- constancia

def constancia():
    return llamar(vistas.TramiteConstancia, metodo="get")


def test_la_constancia_se_pide_al_pdp_como_ver_el_tramite_propio_sin_institucion(registro):
    r = constancia()
    assert r.status_code == 200
    pdp = pasos(registro, "pdp")[0]
    # Sin institucion_id el personal de la institucion no entra por la regla del personal: solo quien lo pidio
    assert pdp[1] == Accion.VER_TRAMITE and pdp[2].institucion_id is None and pdp[2].solicitante_id == 5 and pdp[2].tipo == "tramite"


def test_la_constancia_lleva_cache_control_no_store_y_los_datos_del_tramite(registro):
    registro.documentos = [SimpleNamespace(pk=4, nombre="plano.pdf")]
    r = constancia()
    assert r["Cache-Control"] == "no-store"
    assert r.data["numero"] == 9 and r.data["documentos"] == [{"id": 4, "nombre": "plano.pdf"}]
    assert r.data["datos"][0]["etiqueta"] == "Dirección del terreno"
    assert pasos(registro, "documentos")[0][1] == {"tramite_id": 9}


def test_si_el_pdp_niega_la_constancia_no_se_arma_ni_se_buscan_los_documentos(registro):
    registro.niega = True
    assert constancia().status_code == 403
    assert not pasos(registro, "documentos")


def test_la_constancia_de_un_tramite_desistido_tambien_se_puede_pedir(registro):
    registro.tramite = un_tramite(estado="Desistido")
    r = constancia()
    assert r.status_code == 200 and r.data["estado"] == "Desistido"


def test_la_constancia_solo_responde_a_get(registro):
    assert llamar(vistas.TramiteConstancia, metodo="post", cuerpo={}).status_code == 405
    assert llamar(vistas.TramiteDesistir, metodo="get").status_code == 405


def test_las_rutas_nuevas_se_resuelven_bajo_tramites():
    assert reverse("tramite-desistir", kwargs={"pk": 5}) == "/tramites/5/desistir/"
    assert reverse("tramite-constancia", kwargs={"pk": 5}) == "/tramites/5/constancia/"


def test_las_vistas_nuevas_exigen_acceso_completo_y_limitan_la_tasa_y_corren_en_transaccion():
    for clase in (vistas.TramiteDesistir, vistas.TramiteConstancia):
        assert any(c.__name__ == "_ExigeScope" for c in clase.permission_classes), clase
        assert clase.throttle_scope == "api"
        assert not getattr(clase.as_view(), "_non_atomic_requests", None), f"{clase.__name__} debe correr en una transacción (RLS)"


# --------------------------------------------------------------------------- notificaciones: el tipo nuevo

def test_el_modelo_de_notificaciones_conoce_tramite_desistido():
    from apps.notificaciones.models import TIPOS
    assert ("tramite_desistido", "Trámite desistido") in TIPOS


# --------------------------------------------------------------------------- la migración 021, leída

MIGRACION = Path(__file__).resolve().parents[2] / "database" / "migraciones" / "021-tramites-ciudadania.sql"
SQL = MIGRACION.read_text(encoding="utf-8")
SQL_SIN_COMENTARIOS = "\n".join(linea.split("--")[0] for linea in SQL.splitlines())
PRUEBAS = (Path(__file__).resolve().parents[2] / "database" / "pruebas-ciudadania.sql").read_text(encoding="utf-8")


def funcion(nombre):
    return re.search(rf"CREATE (?:OR REPLACE )?FUNCTION siget\.{re.escape(nombre)}\(.*?\$\$;", SQL_SIN_COMENTARIOS, re.S).group(0)


def test_la_migracion_son_dos_transacciones_y_el_enum_va_en_la_primera():
    bloques = re.findall(r"BEGIN;(.*?)COMMIT;", SQL_SIN_COMENTARIOS, re.S)
    assert len(bloques) == 2
    assert "ALTER TYPE siget.estado_tramite ADD VALUE IF NOT EXISTS 'Desistido';" in bloques[0]
    assert "'Desistido'" not in bloques[0].replace("ALTER TYPE siget.estado_tramite ADD VALUE IF NOT EXISTS 'Desistido';", "")  # sin usarlo en la misma transaccion
    assert "'Desistido'" in bloques[1]
    assert all("SET LOCAL ROLE siget_owner;" in b for b in bloques)


def test_requisitos_es_jsonb_objeto_con_valor_por_defecto_y_permiso_por_columna():
    assert "ADD COLUMN requisitos jsonb NOT NULL DEFAULT '{}'::jsonb" in SQL_SIN_COMENTARIOS
    assert "CHECK (jsonb_typeof(requisitos) = 'object')" in SQL_SIN_COMENTARIOS
    assert re.findall(r"GRANT UPDATE \(requisitos\) ON siget\.tipo_tramite TO (\w+);", SQL_SIN_COMENTARIOS) == ["app_role"]


def test_la_validacion_de_requisitos_es_la_misma_que_hace_el_backend():
    f = funcion("requisitos_invalido")
    for regla in ("'descripcion', 'documentos', 'despues'", "> 1000", "> 15", "> 200", "char_length(btrim("):
        assert regla in f, regla
    from apps.catalogo import gestion
    assert (gestion.DESCRIPCION_MAX, gestion.DESPUES_MAX, gestion.DOCUMENTOS_MAX, gestion.DOCUMENTO_MAX) == (1000, 1000, 15, 200)
    assert set(gestion.CLAVES_REQUISITOS) == {"descripcion", "documentos", "despues"}
    assert "REVOKE ALL ON FUNCTION siget.requisitos_invalido(jsonb) FROM PUBLIC;" in SQL_SIN_COMENTARIOS


def test_el_disparador_del_catalogo_conserva_lo_de_la_020_y_agrega_los_requisitos():
    f = funcion("tipo_tramite_valida")
    assert "SECURITY DEFINER" in f and "SET search_path = siget, pg_temp" in f
    for de_la_020 in ("NEW.id IS DISTINCT FROM OLD.id OR NEW.institucion_id IS DISTINCT FROM OLD.institucion_id", "siget.es_coordinador_vigente(v_actor, NEW.institucion_id)",
                      "v_actor IS NULL AND session_user = 'app_role'", "siget.formulario_invalido(NEW.formulario)", "NEW.version := 1", "ERRCODE = '42501'"):
        assert de_la_020 in f, de_la_020
    assert "siget.requisitos_invalido(NEW.requisitos)" in f
    assert "NEW.requisitos" in f.split("ELSIF")[1] and "OLD.requisitos" in f.split("ELSIF")[1]  # entra en el control de version


def test_el_registro_del_catalogo_anota_los_requisitos_en_el_alta_y_en_los_cambios():
    f = funcion("tipo_tramite_registra")
    assert "'requisitos', NEW.requisitos" in f and "'requisitos', OLD.requisitos" in f
    for de_la_020 in ("'alta'", "'activado'", "'desactivado'", "'cambio'", "IF v_despues = '{}'::jsonb THEN"):
        assert de_la_020 in f, de_la_020


def test_los_tipos_sembrados_reciben_requisitos_sin_contexto_y_despues_de_reemplazar_los_disparadores():
    posicion = SQL_SIN_COMENTARIOS.index
    for nombre in ("Permiso de Construcción Municipal", "Solicitud o denuncia ciudadana", "Registro empresarial simplificado",
                   "Solicitud interinstitucional de información", "Trámite de demostración (%)"):
        assert nombre in SQL_SIN_COMENTARIOS, nombre
    assert posicion("CREATE OR REPLACE FUNCTION siget.tipo_tramite_valida") < posicion("UPDATE siget.tipo_tramite SET requisitos") < posicion("INSERT INTO siget.transicion")


def test_los_requisitos_sembrados_cumplen_las_reglas_del_backend():
    import json
    from apps.catalogo import gestion
    sembrados = re.findall(r"UPDATE siget\.tipo_tramite SET requisitos = '(\{.*?\})'::jsonb WHERE", SQL, re.S)
    assert len(sembrados) == 5
    for crudo in sembrados:
        limpio, errores = gestion.validar_requisitos(json.loads(crudo))
        assert errores == {} and limpio == json.loads(crudo), (crudo[:60], errores)
        assert limpio["descripcion"] and limpio["documentos"] and limpio["despues"]


def test_desistido_tiene_tres_transiciones_de_entrada_y_ninguna_de_salida():
    assert re.search(r"INSERT INTO siget\.transicion \(desde, hasta\) VALUES\s+\('Pendiente', 'Desistido'\),\s+\('En Tramitacion', 'Desistido'\),\s+\('En Subsanacion', 'Desistido'\)",
                     SQL_SIN_COMENTARIOS)
    assert "'Desistido', '" not in SQL_SIN_COMENTARIOS.replace("', 'Desistido'", "")  # ningun ('Desistido', otro)


def test_la_transicion_a_desistido_exige_ser_la_persona_solicitante_y_un_motivo():
    f = funcion("validar_transicion")
    assert "NEW.estado = 'Desistido' AND OLD.solicitante_id IS DISTINCT FROM siget.ctx_usuario()" in f
    assert "NEW.estado IN ('Rechazado', 'En Subsanacion', 'Desistido') OR OLD.estado = 'En Subsanacion'" in f
    for de_la_017 in ("> 2000", "[\\x01-\\x08\\x0b-\\x1f\\x7f-\\x9f]", "char_length(v_motivo) < 10", "[[:alnum:]]", "Transicion no permitida"):
        assert de_la_017 in f, de_la_017
    assert "LANGUAGE plpgsql AS" in f and "SECURITY DEFINER" not in f  # sigue siendo invoker, como la 017


def test_la_persona_solicitante_solo_puede_responder_la_subsanacion_o_desistir():
    f = funcion("validar_respuesta_solicitante")
    assert "OLD.estado = 'En Subsanacion' AND NEW.estado = 'En Tramitacion'" in f
    assert "OLD.estado IN ('Pendiente', 'En Tramitacion', 'En Subsanacion') AND NEW.estado = 'Desistido'" in f
    assert "NEW.funcionario_asignado_id IS DISTINCT FROM OLD.funcionario_asignado_id" in f


def test_la_politica_de_desistir_solo_abre_filas_propias_no_finales_y_solo_a_desistido():
    politica = re.search(r"CREATE POLICY tramite_desistir ON siget\.tramite FOR UPDATE TO app_role\s+USING \((.*?)\)\s+WITH CHECK \((.*?)\);", SQL_SIN_COMENTARIOS, re.S)
    usando, con_chequeo = politica.group(1), politica.group(2)
    assert "solicitante_id = siget.ctx_usuario()" in usando and "estado IN ('Pendiente', 'En Tramitacion', 'En Subsanacion')" in usando
    assert "Aprobado" not in usando and "Rechazado" not in usando
    assert "solicitante_id = siget.ctx_usuario()" in con_chequeo and "estado = 'Desistido'" in con_chequeo


def test_todo_lo_que_enumeraba_estados_finales_excluye_a_los_desistidos():
    assert "estado NOT IN ('Aprobado', 'Rechazado', 'Desistido')" in SQL_SIN_COMENTARIOS
    assert SQL_SIN_COMENTARIOS.count("NOT IN ('Aprobado', 'Rechazado', 'Desistido')") == 3  # el indice, escalar_vencidos y tramites_abiertos_de
    assert "IN ('Aprobado', 'Rechazado', 'Desistido')" in funcion("documento_valida")
    assert "DROP INDEX siget.tramite_vencidos_sin_escalar;" in SQL_SIN_COMENTARIOS
    for nombre, firma in (("escalar_vencidos", "RETURNS int"), ("documento_valida", "RETURNS trigger"), ("tramites_abiertos_de", "RETURNS int")):
        f = funcion(nombre)
        assert "SECURITY DEFINER" in f and "SET search_path = siget, pg_temp" in f and firma in f, nombre


def test_las_notificaciones_agregan_el_tipo_y_conservan_las_reglas_de_la_018():
    assert re.search(r"CHECK \(tipo IN \(.*'tramite_escalado',\s+'tramite_desistido'\)\)", SQL_SIN_COMENTARIOS, re.S)
    f = funcion("generar_notificaciones")
    assert "SECURITY DEFINER" in f and "SET search_path = siget, pg_temp" in f
    assert "NEW.solicitante_id IS DISTINCT FROM v_actor" in f and "v_actor = NEW.solicitante_id" in f and "m.usuario_id IS DISTINCT FROM v_actor" in f
    assert "u.estado_cuenta = 'activa'" in f and "m.rol IN ('funcionario', 'supervisor') AND m.revocada_en IS NULL" in f
    assert "NEW.estado = 'Desistido' THEN 'tramite_desistido' ELSE 'subsanacion_respondida'" in f
    assert "OLD.escalado_en IS NULL AND NEW.escalado_en IS NOT NULL" in f
    assert "'tramite_desistido'" not in f.split("v_tipo := CASE")[1].split("END;")[0]  # a quien desiste no se le avisa de su propio desistimiento


def test_ninguna_funcion_nueva_queda_para_public():
    assert "GRANT EXECUTE ON FUNCTION siget.requisitos_invalido(jsonb) TO app_role;" in SQL_SIN_COMENTARIOS
    assert not re.search(r"GRANT[^;]*\b(ALL|DELETE|TRUNCATE)\b", SQL_SIN_COMENTARIOS)
    assert not re.search(r"GRANT[^;]*TO PUBLIC", SQL_SIN_COMENTARIOS)


def test_el_script_de_pruebas_de_la_base_corre_en_una_transaccion_que_se_revierte_y_resume():
    sin_comentarios = "\n".join(linea.split("--")[0] for linea in PRUEBAS.splitlines())
    assert sin_comentarios.strip().startswith("BEGIN;") and sin_comentarios.strip().endswith("ROLLBACK;")
    assert "RESUMEN: % de % comprobaciones PASAN, % FALLAN" in PRUEBAS and "PASA " in PRUEBAS and "FALLA" in PRUEBAS
    assert "SET LOCAL SESSION AUTHORIZATION app_role" in PRUEBAS  # sin contexto: la 020 mira session_user
    assert not re.search(r"(?i)\b(password|secreto|token)\s*=\s*'[^!']", PRUEBAS)  # sin credenciales
