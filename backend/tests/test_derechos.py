"""Derechos sobre los datos personales (PT-15, Ley 81): plazos, validación, aviso de privacidad, PDP, matriz y migración 016.

Sin base de datos: lo que necesita la base real lo recorren `verificar_autenticacion` y `verificar_plataforma`.
"""
import re
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest
from django.urls import reverse
from rest_framework.test import APIRequestFactory, force_authenticate

from apps.autenticacion import derechos, perfil
from apps.autenticacion import servicio as auth
from apps.autenticacion import vistas_derechos
from apps.autorizacion import matriz, pdp, simulador
from apps.autorizacion.modulos import modulos_para
from apps.autorizacion.pdp import Accion, Entorno, Recurso, Sujeto, decidir
from apps.identidad.models import Perfil, SolicitudDerecho
from apps.tramites.serializacion import ZONA_PANAMA
from apps.nucleo.errores import AccesoDenegado
from apps.nucleo.esquema import columnas_del_modelo
from apps.plataforma import servicio as plataforma

AHORA = datetime(2026, 11, 17, 12, 0, tzinfo=timezone.utc)  # martes
MIGRACION = Path(__file__).resolve().parents[2] / "database" / "migraciones" / "016-derechos-datos.sql"


# --------------------------------------------------------------------------- plazo de 10 días hábiles

def test_diez_dias_habiles_son_dos_semanas_justas_y_conservan_la_hora():
    martes = datetime(2026, 11, 17, 14, 30, tzinfo=timezone.utc)  # 9:30 en Panamá
    vence = derechos.vence_en(martes)
    assert vence == martes + timedelta(days=14) and vence.weekday() == 1


def test_un_pedido_en_fin_de_semana_cuenta_desde_el_lunes_siguiente():
    sabado = datetime(2026, 11, 21, 15, 0, tzinfo=timezone.utc)
    vence = derechos.vence_en(sabado)
    assert vence.weekday() == 4  # del lunes 23 al viernes 4 de diciembre: 10 días hábiles
    assert vence.date() == date(2026, 12, 4)


def test_los_feriados_de_panama_no_cuentan():
    lunes = datetime(2026, 11, 2, 14, 0, tzinfo=timezone.utc)  # 9:00 en Panamá
    feriados = {date(2026, 11, 3), date(2026, 11, 4), date(2026, 11, 5), date(2026, 11, 10)}
    sin_feriados = derechos.vence_en(lunes)
    con_feriados = derechos.vence_en(lunes, feriados)
    assert con_feriados - sin_feriados == timedelta(days=4)  # cuatro feriados entre semana: el plazo se corre cuatro días hábiles
    assert con_feriados.weekday() < 5 and con_feriados.date() not in feriados


def test_se_cuenta_en_hora_de_panama_no_en_utc():
    # Viernes 20 de noviembre a las 20:00 de Panamá = sábado 01:00 UTC: sigue siendo viernes para la ley
    viernes_noche = datetime(2026, 11, 21, 1, 0, tzinfo=timezone.utc)
    assert derechos.vence_en(viernes_noche).date() == date(2026, 12, 4)


def test_el_vencimiento_nunca_cae_en_fin_de_semana_ni_antes_de_diez_dias_corridos():
    for dia in range(30):
        desde = AHORA + timedelta(days=dia)
        vence = derechos.vence_en(desde)
        assert vence.astimezone(ZONA_PANAMA).weekday() < 5
        assert (vence - desde).days >= 10


def test_los_dias_habiles_negativos_no_existen():
    with pytest.raises(ValueError):
        derechos.sumar_dias_habiles(AHORA, -1, frozenset())


def test_una_solicitud_vence_solo_si_sigue_abierta_y_paso_su_plazo():
    assert derechos.esta_vencida("recibida", AHORA - timedelta(seconds=1), AHORA) is True
    assert derechos.esta_vencida("recibida", AHORA + timedelta(days=1), AHORA) is False
    assert derechos.esta_vencida("atendida", AHORA - timedelta(days=30), AHORA) is False
    assert derechos.esta_vencida("rechazada", AHORA - timedelta(days=30), AHORA) is False


def test_el_plazo_y_el_tope_son_los_de_la_ley_y_el_diseno():
    assert derechos.PLAZO_DIAS_HABILES == 10
    assert derechos.MAX_SOLICITUDES_ABIERTAS == 3


# --------------------------------------------------------------------------- solicitudes

@pytest.mark.parametrize("tipo", ["rectificacion", "cancelacion", "oposicion"])
def test_una_solicitud_valida_se_acepta(tipo):
    datos, errores = derechos.validar_solicitud({"tipo": tipo, "detalle": "  Quiero que corrijan mi segundo apellido.  "})
    assert errores == [] and datos == (tipo, "Quiero que corrijan mi segundo apellido.")


@pytest.mark.parametrize("cuerpo", [
    None, [], "x", {}, {"tipo": "acceso", "detalle": "x" * 20}, {"tipo": "portabilidad", "detalle": "x" * 20}, {"tipo": ["cancelacion"], "detalle": "x" * 20},
    {"tipo": None, "detalle": "x" * 20}, {"tipo": "cancelacion"}, {"tipo": "cancelacion", "detalle": ""}, {"tipo": "cancelacion", "detalle": "corto"},
    {"tipo": "cancelacion", "detalle": "   " + "x" * 5 + "   "}, {"tipo": "cancelacion", "detalle": "x" * 1001}, {"tipo": "cancelacion", "detalle": 12345678901},
])
def test_una_solicitud_mal_formada_se_rechaza_diciendo_por_que(cuerpo):
    datos, errores = derechos.validar_solicitud(cuerpo)
    assert datos is None and errores


def test_el_detalle_admite_justo_los_limites():
    assert derechos.validar_solicitud({"tipo": "oposicion", "detalle": "x" * 10})[1] == []
    assert derechos.validar_solicitud({"tipo": "oposicion", "detalle": "x" * 1000})[1] == []


def test_el_operador_solo_atiende_o_rechaza_y_siempre_explica():
    assert derechos.validar_resolucion({"estado": "atendida", "respuesta": "Corregimos su apellido y puede verlo en Mis datos."})[1] == []
    assert derechos.validar_resolucion({"estado": "rechazada", "respuesta": "Los trámites son expediente público: no se borran."})[1] == []
    for malo in (None, [], {}, {"estado": "recibida", "respuesta": "x" * 20}, {"estado": "borrada", "respuesta": "x" * 20}, {"estado": ["atendida"], "respuesta": "x" * 20},
                 {"estado": "atendida"}, {"estado": "atendida", "respuesta": "ok"}, {"estado": "atendida", "respuesta": "x" * 2001}):
        datos, errores = derechos.validar_resolucion(malo)
        assert datos is None and errores, malo


# --------------------------------------------------------------------------- corrección: los mismos validadores del registro

def test_se_corrigen_solo_correo_provincia_y_ciudad_y_se_normalizan():
    campos, errores = perfil.validar_correccion({"correo": "  Nuevo.Correo@Ejemplo.COM ", "provincia": "Chiriquí", "ciudad": "David"})
    assert errores == [] and campos == {"correo": "nuevo.correo@ejemplo.com", "provincia": "Chiriquí", "ciudad": "David"}
    assert perfil.validar_correccion({"ciudad": "Santiago"})[0] == {"ciudad": "Santiago"}


@pytest.mark.parametrize("campo", ["nombre", "apellidos", "cedula", "fecha_nacimiento", "usuario_id", "username", "creado_en", "cedula_huella", "aviso_version"])
def test_los_datos_que_van_por_solicitud_no_se_corrigen_aqui(campo):
    campos, errores = perfil.validar_correccion({"ciudad": "David", campo: "x"})
    assert campos is None and any(campo in e and "rectificación" in e for e in errores)


@pytest.mark.parametrize("cuerpo", [None, [], {}, "x", 5, [("correo", "a@b.co")]])
def test_una_correccion_vacia_o_mal_formada_se_rechaza(cuerpo):
    campos, errores = perfil.validar_correccion(cuerpo)
    assert campos is None and errores


@pytest.mark.parametrize("campo,valor", [
    ("correo", "sin-arroba"), ("correo", ""), ("correo", "a@b"), ("correo", "x" * 250 + "@ej.com"), ("correo", None), ("correo", ["a@b.co"]),
    ("provincia", "Narnia"), ("provincia", ""), ("provincia", None), ("provincia", "panamá"),
    ("ciudad", ""), ("ciudad", "Ciudad<script>"), ("ciudad", "x" * 61), ("ciudad", None), ("ciudad", 5),
])
def test_los_valores_malos_se_rechazan_igual_que_en_el_registro(campo, valor):
    _, errores = perfil.validar_correccion({campo: valor})
    assert errores
    base = {"nombre": "María", "apellidos": "Pérez", "cedula": "8-123-456", "fecha_nacimiento": "1995-04-12", "provincia": "Panamá", "ciudad": "Panamá", "correo": "m@ej.com"}
    _, del_registro = perfil.validar({**base, campo: valor}, date(2026, 11, 17))
    assert errores == del_registro  # un solo conjunto de validadores: el mensaje es el mismo


# --------------------------------------------------------------------------- aviso de privacidad

def test_el_aviso_dice_quien_para_que_quien_accede_cuanto_tiempo_y_como_ejercer_los_derechos():
    aviso = derechos.aviso_vigente()
    assert aviso["version"] == derechos.AVISO_VERSION and re.match(r"^\d{4}-\d{2}-\d{2}$", aviso["version"])
    titulos = [s["titulo"].lower() for s in aviso["secciones"]]
    for tema in ("quién trata", "por qué", "quién puede verlos", "cuánto tiempo", "derechos", "cómo ejercerlos"):
        assert any(tema in t for t in titulos), tema
    assert aviso["plazo_respuesta_dias_habiles"] == 10 and "10 días hábiles" in aviso["texto"]
    assert set(aviso["derechos"]) == {"acceso", "rectificacion", "cancelacion", "oposicion", "portabilidad"}
    assert "Ley 81" in aviso["base_legal"] and "no cuesta nada" in aviso["texto"]
    assert "Mis datos" in aviso["texto"]


def test_el_aviso_explica_la_finalidad_de_cada_dato_que_se_pide_en_el_registro():
    aviso = derechos.aviso_vigente()
    todo = " ".join(f"{d['dato']} {d['para_que']}" for d in aviso["datos"]).lower()
    for dato in ("nombre", "cédula", "fecha de nacimiento", "provincia", "ciudad", "correo", "contraseña"):
        assert dato in todo, dato
    cedula = next(d for d in aviso["datos"] if "cédula" in d["dato"].lower())
    nacimiento = next(d for d in aviso["datos"] if "nacimiento" in d["dato"].lower())
    assert "identidad única" in cedula["para_que"].lower() and "cifrada" in cedula["para_que"]
    assert "mayor de edad" in nacimiento["para_que"]
    assert all(d["para_que"].strip() for d in aviso["datos"])


def test_el_aviso_informa_sin_pedir_autorizacion_y_explica_que_los_tramites_no_se_borran():
    texto = derechos.aviso_vigente()["texto"]
    assert "no necesita tu autorización" in texto and "no es una autorización adicional" in texto
    assert "no se borran" in texto and "conservación obligatoria" in texto


def test_el_aviso_no_contiene_datos_de_nadie_ni_credenciales():
    texto = derechos.aviso_vigente()["texto"].lower()
    for prohibido in ("@", "8-123", "password=", "jwt", "argon", "fernet"):
        assert prohibido not in texto


def test_el_texto_unico_es_el_mismo_aviso_que_las_secciones():
    aviso = derechos.aviso_vigente()
    for seccion in aviso["secciones"]:
        assert seccion["titulo"] in aviso["texto"] and seccion["texto"] in aviso["texto"]


# --------------------------------------------------------------------------- registro: exige el aviso

DATOS = {"nombre": "María", "apellidos": "Pérez", "cedula": "8-123-456", "fecha_nacimiento": "1995-04-12", "provincia": "Panamá", "ciudad": "Panamá", "correo": "m@ej.com"}


@pytest.mark.parametrize("valor", [None, False, "true", "True", 1, 0, "", [], {}, "si"])
def test_el_registro_exige_el_booleano_true_del_aviso(valor):
    r = auth.registrar_usuario("maria.perez", "una-frase-larga-y-poco-comun-7391", "198.51.100.1", dict(DATOS), hoy=date(2026, 11, 17), acepta_aviso=valor)
    assert r.ok is False and r.codigo == "datos_invalidos" and r.detalle["errores"] == [derechos.MENSAJE_ACEPTA_AVISO]


def test_si_falta_el_aviso_no_se_pide_nada_mas_que_lo_que_ya_faltaba():
    r = auth.registrar_usuario("maria.perez", "corta", "198.51.100.1", {}, hoy=date(2026, 11, 17))
    assert derechos.MENSAJE_ACEPTA_AVISO in r.detalle["errores"] and len(r.detalle["errores"]) >= 8


def test_el_mensaje_del_aviso_es_claro():
    assert "aviso de privacidad" in derechos.MENSAJE_ACEPTA_AVISO and "acepta_aviso" in derechos.MENSAJE_ACEPTA_AVISO


def test_el_perfil_guarda_la_constancia_del_aviso():
    columnas = columnas_del_modelo(Perfil)
    assert {"aviso_version", "aviso_leido_en", "actualizado_en"} <= columnas
    fila = Perfil(aviso_version=derechos.AVISO_VERSION, aviso_leido_en=AHORA)
    assert vistas_derechos.servicio.constancia_del_aviso(fila) == {"version": derechos.AVISO_VERSION, "leido_en": AHORA.isoformat(), "vigente": True}
    assert vistas_derechos.servicio.constancia_del_aviso(Perfil()) is None  # perfiles anteriores: no se inventa una lectura
    assert vistas_derechos.servicio.constancia_del_aviso(None) is None
    assert vistas_derechos.servicio.constancia_del_aviso(Perfil(aviso_version="2020-01-01", aviso_leido_en=AHORA))["vigente"] is False


# --------------------------------------------------------------------------- PDP: corregir los propios datos

def entorno(ahora=AHORA):
    return Entorno(ahora=ahora)


def sujeto(id=10, mfa_min=2, **kw):
    return Sujeto(id=id, mfa_verificado_en=None if mfa_min is None else AHORA - timedelta(minutes=mfa_min), **kw)


def propio(id=10):
    return Recurso(tipo="perfil", solicitante_id=id)


def permite(s, a, r):
    return decidir(s, a, r, entorno()).permitido


def test_la_persona_corrige_su_perfil_con_segundo_factor_reciente():
    d = decidir(sujeto(), Accion.CORREGIR_MIS_DATOS, propio(), entorno())
    assert d.permitido and d.politica == "titular_corrige_sus_datos"


@pytest.mark.parametrize("minutos", [16, 60, None])
def test_sin_segundo_factor_reciente_no_se_corrige(minutos):
    assert not permite(sujeto(mfa_min=minutos), Accion.CORREGIR_MIS_DATOS, propio())


def test_nadie_corrige_el_perfil_de_otra_persona():
    assert not permite(sujeto(id=10), Accion.CORREGIR_MIS_DATOS, propio(id=11))
    assert not permite(sujeto(id=10), Accion.CORREGIR_MIS_DATOS, Recurso(tipo="perfil"))


def test_el_personal_de_una_institucion_corrige_su_propio_perfil_como_cualquiera():
    assert permite(sujeto(membresias=frozenset({(3, "funcionario")})), Accion.CORREGIR_MIS_DATOS, propio())


@pytest.mark.parametrize("rol", sorted(pdp.ROLES_PLATAFORMA))
def test_las_cuentas_de_plataforma_no_corrigen_perfiles(rol):
    assert not permite(sujeto(rol_plataforma=rol, nivel_aseguramiento=3), Accion.CORREGIR_MIS_DATOS, propio())


@pytest.mark.parametrize("estado", ["bloqueada", "suspendida"])
def test_una_cuenta_no_activa_no_corrige_nada(estado):
    d = decidir(sujeto(estado_cuenta=estado), Accion.CORREGIR_MIS_DATOS, propio(), entorno())
    assert not d.permitido and d.politica == "cuenta_no_activa"


def test_corregir_mis_datos_solo_aplica_a_recursos_de_tipo_perfil():
    assert not permite(sujeto(), Accion.CORREGIR_MIS_DATOS, Recurso(tipo="tramite", solicitante_id=10))
    assert not permite(sujeto(), Accion.CORREGIR_MIS_DATOS, Recurso(tipo="usuario", solicitante_id=10))


ACCIONES_DEL_TITULAR = (Accion.VER_MIS_DATOS, Accion.EXPORTAR_MIS_DATOS, Accion.CREAR_SOLICITUD_DATOS, Accion.CORREGIR_MIS_DATOS)


def test_otras_acciones_no_se_abren_por_el_perfil_propio():
    for accion in Accion:
        if accion not in ACCIONES_DEL_TITULAR:
            assert not permite(sujeto(), accion, propio()), accion


@pytest.mark.parametrize("accion,politica", [(Accion.VER_MIS_DATOS, "titular_consulta_sus_datos"), (Accion.CREAR_SOLICITUD_DATOS, "titular_pide_sobre_sus_datos")])
@pytest.mark.parametrize("minutos", [2, 60, None])
def test_ver_y_pedir_sobre_lo_propio_no_exigen_segundo_factor_reciente(accion, politica, minutos):
    d = decidir(sujeto(mfa_min=minutos), accion, propio(), entorno())
    assert d.permitido and d.politica == politica


@pytest.mark.parametrize("minutos", [2, 15])
def test_exportar_lo_propio_con_segundo_factor_reciente(minutos):
    d = decidir(sujeto(mfa_min=minutos), Accion.EXPORTAR_MIS_DATOS, propio(), entorno())
    assert d.permitido and d.politica == "titular_exporta_sus_datos"


@pytest.mark.parametrize("minutos", [16, 60, None])
def test_exportar_sin_segundo_factor_reciente_se_niega(minutos):
    assert not permite(sujeto(mfa_min=minutos), Accion.EXPORTAR_MIS_DATOS, propio())


@pytest.mark.parametrize("accion", ACCIONES_DEL_TITULAR)
def test_nadie_ve_exporta_ni_pide_sobre_el_perfil_de_otra_persona(accion):
    assert not permite(sujeto(id=10), accion, propio(id=11))
    assert not permite(sujeto(id=10), accion, Recurso(tipo="perfil"))
    assert not permite(sujeto(id=10), accion, Recurso(tipo="tramite", solicitante_id=10))


@pytest.mark.parametrize("accion", ACCIONES_DEL_TITULAR)
@pytest.mark.parametrize("rol", sorted(pdp.ROLES_PLATAFORMA))
def test_las_cuentas_de_plataforma_no_ven_exportan_ni_piden_sobre_datos_personales(rol, accion):
    assert not permite(sujeto(rol_plataforma=rol, nivel_aseguramiento=3), accion, propio())


@pytest.mark.parametrize("accion", ACCIONES_DEL_TITULAR)
@pytest.mark.parametrize("estado", ["bloqueada", "suspendida"])
def test_una_cuenta_no_activa_no_ejerce_derechos_sobre_sus_datos(accion, estado):
    d = decidir(sujeto(estado_cuenta=estado), accion, propio(), entorno())
    assert not d.permitido and d.politica == "cuenta_no_activa"


@pytest.mark.parametrize("accion", ACCIONES_DEL_TITULAR)
def test_el_personal_de_una_institucion_ejerce_sus_derechos_como_cualquiera(accion):
    assert permite(sujeto(membresias=frozenset({(3, "funcionario")})), accion, propio())


# --------------------------------------------------------------------------- PDP: la consola de solicitudes

ACCIONES_SOLICITUDES = (Accion.CONSULTAR_SOLICITUDES_DATOS, Accion.RESPONDER_SOLICITUD_DATOS)


def operador(rol="operador_identidades", **kw):
    return sujeto(rol_plataforma=rol, nivel_aseguramiento=2, **kw)


@pytest.mark.parametrize("accion", ACCIONES_SOLICITUDES)
def test_solo_el_operador_de_identidades_atiende_las_solicitudes(accion):
    assert permite(operador(), accion, Recurso(tipo="solicitud_derecho"))
    for otro in sorted(pdp.ROLES_PLATAFORMA - {"operador_identidades"}):
        assert not permite(operador(otro), accion, Recurso(tipo="solicitud_derecho")), otro


@pytest.mark.parametrize("accion", ACCIONES_SOLICITUDES)
def test_la_consola_de_solicitudes_exige_segundo_factor_reciente(accion):
    assert not permite(operador(mfa_min=60), accion, Recurso(tipo="solicitud_derecho"))
    assert not permite(operador(mfa_min=None), accion, Recurso(tipo="solicitud_derecho"))


@pytest.mark.parametrize("accion", ACCIONES_SOLICITUDES)
def test_ninguna_otra_persona_ve_ni_responde_solicitudes(accion):
    recurso = Recurso(tipo="solicitud_derecho")
    for s in (sujeto(), sujeto(membresias=frozenset({(3, "funcionario")})), sujeto(membresias=frozenset({(3, "supervisor")})),
              sujeto(membresias=frozenset({(3, "coordinador_institucional")}))):
        assert not permite(s, accion, recurso)


def test_el_operador_de_identidades_sigue_sin_ver_tramites():
    for accion in (Accion.VER_TRAMITE, Accion.VER_DOCUMENTO, Accion.CAMBIAR_ESTADO):
        d = decidir(operador(), accion, Recurso(tipo="tramite", institucion_id=3, solicitante_id=99), entorno())
        assert not d.permitido and d.politica == "plataforma_sin_acceso_a_tramites"


def test_una_cuenta_bloqueada_no_responde_solicitudes():
    assert not permite(operador(estado_cuenta="bloqueada"), Accion.RESPONDER_SOLICITUD_DATOS, Recurso(tipo="solicitud_derecho"))


# --------------------------------------------------------------------------- matriz, simulador y módulos

M = matriz.construir()


def celda(rol, accion, caso="favorable"):
    return M["matriz"][rol][accion.value][caso]


def test_la_matriz_muestra_las_acciones_nuevas_calculadas_por_el_pdp():
    ids = {a["id"] for a in M["acciones"]}
    assert {"ver_mis_datos", "exportar_mis_datos", "crear_solicitud_datos", "corregir_mis_datos", "consultar_solicitudes_datos", "responder_solicitud_datos"} <= ids
    assert len(M["acciones"]) == 30 and len(Accion) == 31  # la 31.ª, desistir_tramite (021), aún no figura en la matriz (se ajusta al fusionar con la baja de «Roles y permisos»)
    assert all(next(a for a in M["acciones"] if a["id"] == i)["grupo"] == "Datos personales" for i in ("ver_mis_datos", "exportar_mis_datos", "crear_solicitud_datos"))
    assert next(a for a in M["acciones"] if a["id"] == "corregir_mis_datos")["grupo"] == "Datos personales"


@pytest.mark.parametrize("rol", ["ciudadano", "funcionario", "supervisor", "coordinador_institucional"])
def test_en_la_matriz_toda_persona_corrige_lo_propio_y_no_lo_ajeno_con_segundo_factor(rol):
    assert celda(rol, Accion.CORREGIR_MIS_DATOS)["permitido"] is True
    assert celda(rol, Accion.CORREGIR_MIS_DATOS, "desfavorable")["permitido"] is False
    assert M["matriz"][rol]["corregir_mis_datos"]["exige_segundo_factor"] is True


def test_en_la_matriz_solo_identidades_atiende_solicitudes_y_con_segundo_factor():
    for accion in ACCIONES_SOLICITUDES:
        quienes = {r for r in M["matriz"] if celda(r, accion)["permitido"]}
        assert quienes == {"operador_identidades"}, (accion, quienes)
        assert M["matriz"]["operador_identidades"][accion.value]["exige_segundo_factor"] is True


@pytest.mark.parametrize("rol", ["ciudadano", "funcionario", "supervisor", "coordinador_institucional"])
def test_en_la_matriz_toda_persona_ve_y_pide_lo_propio_sin_segundo_factor_y_exporta_con_el(rol):
    for accion in (Accion.VER_MIS_DATOS, Accion.CREAR_SOLICITUD_DATOS, Accion.EXPORTAR_MIS_DATOS):
        assert celda(rol, accion)["permitido"] is True and celda(rol, accion, "desfavorable")["permitido"] is False, accion
    assert M["matriz"][rol]["ver_mis_datos"]["exige_segundo_factor"] is False
    assert M["matriz"][rol]["crear_solicitud_datos"]["exige_segundo_factor"] is False
    assert M["matriz"][rol]["exportar_mis_datos"]["exige_segundo_factor"] is True


def test_en_la_matriz_ninguna_cuenta_de_plataforma_ejerce_derechos_sobre_perfiles():
    for rol in (r[0] for r in matriz.ROLES[4:]):
        for accion in ACCIONES_DEL_TITULAR:
            assert celda(rol, accion)["permitido"] is False, (rol, accion)


def test_el_operador_de_identidades_sigue_sin_poder_todo_ni_ver_tramites_en_la_matriz():
    assert next(r for r in M["roles"] if r["id"] == "operador_identidades")["acciones_permitidas"] == 8  # alta, aprobación, restablecer MFA, invitar (PT-2), las dos de solicitudes, cambiar su contraseña y ver sus notificaciones
    assert celda("operador_identidades", Accion.VER_TRAMITE)["politica"] == "plataforma_sin_acceso_a_tramites"
    assert M["ningun_rol_puede_todo"] is True


def test_el_simulador_conoce_las_acciones_nuevas():
    meta = simulador.meta()
    for accion in ("ver_mis_datos", "exportar_mis_datos", "crear_solicitud_datos", "corregir_mis_datos", "consultar_solicitudes_datos", "responder_solicitud_datos"):
        assert accion in meta["variables"]
    assert len(meta["variables"]) == 30
    for accion in ("ver_mis_datos", "exportar_mis_datos", "crear_solicitud_datos"):
        assert "perfil_de" in meta["variables"][accion]
    assert "perfil_de" in meta["variables"]["corregir_mis_datos"] and "perfil_de" in meta["valores"] and "perfil_de" in meta["defectos"]


def simular(**datos):
    entrada, errores = simulador.normalizar(datos)
    assert errores == [], errores
    return simulador.simular(entrada)["decision"]


def test_el_simulador_decide_con_el_mismo_pdp():
    assert simular(rol="ciudadano", accion="corregir_mis_datos")["permitido"] is True
    assert simular(rol="ciudadano", accion="corregir_mis_datos", perfil_de="otra_persona")["permitido"] is False
    assert simular(rol="ciudadano", accion="corregir_mis_datos", segundo_factor="vencido")["permitido"] is False
    assert simular(rol="operador_seguridad", accion="corregir_mis_datos")["permitido"] is False
    assert simular(rol="operador_identidades", accion="responder_solicitud_datos")["permitido"] is True
    assert simular(rol="operador_catalogo", accion="responder_solicitud_datos")["permitido"] is False
    assert simular(rol="operador_identidades", accion="responder_solicitud_datos", segundo_factor="ninguno")["permitido"] is False
    assert simular(rol="ciudadano", accion="ver_mis_datos", segundo_factor="ninguno")["permitido"] is True
    assert simular(rol="ciudadano", accion="exportar_mis_datos", segundo_factor="vencido")["permitido"] is False
    assert simular(rol="ciudadano", accion="exportar_mis_datos")["permitido"] is True
    assert simular(rol="operador_identidades", accion="crear_solicitud_datos")["permitido"] is False
    assert simular(rol="ciudadano", accion="crear_solicitud_datos", perfil_de="otra_persona")["permitido"] is False


def test_el_simulador_rechaza_un_perfil_de_que_no_esta_en_la_lista():
    entrada, errores = simulador.normalizar({"rol": "ciudadano", "accion": "corregir_mis_datos", "perfil_de": "todos"})
    assert entrada is None and any("perfil_de" in e for e in errores)


def test_las_alternativas_muestran_que_cambiar_de_titular_o_de_factor_invierte_el_resultado():
    entrada, _ = simulador.normalizar({"rol": "ciudadano", "accion": "corregir_mis_datos"})
    variables = {a["variable"] for a in simulador.simular(entrada)["alternativas"]}
    assert variables == {"perfil_de", "segundo_factor", "cuenta"}


def test_mis_datos_es_un_modulo_de_las_personas_y_no_de_las_cuentas_de_plataforma():
    for roles in ([], ["ciudadano"], ["funcionario"], ["supervisor"], ["coordinador_institucional"]):
        assert "mis_datos" in [m["id"] for m in modulos_para("ninguno", roles)], roles
    for rol in sorted(pdp.ROLES_PLATAFORMA):
        assert "mis_datos" not in [m["id"] for m in modulos_para(rol, [])], rol
    # el módulo solo arma el menú: la consola de solicitudes sigue siendo la del operador de identidades
    assert "consola_identidades" in [m["id"] for m in modulos_para("operador_identidades", [])]
    por_modulo = {m["id"]: m["roles"] for m in M["modulos"]}
    assert set(por_modulo["mis_datos"]) == {"ciudadano", "funcionario", "supervisor", "coordinador_institucional"}


# --------------------------------------------------------------------------- rutas y vistas

def test_las_rutas_se_resuelven():
    assert reverse("aviso-privacidad") == "/auth/aviso-privacidad/"
    assert reverse("mis-datos") == "/auth/mis-datos/"
    assert reverse("mis-datos-exportar") == "/auth/mis-datos/exportar/"
    assert reverse("mis-datos-solicitudes") == "/auth/mis-datos/solicitudes/"
    assert reverse("plataforma-solicitudes-datos") == "/plataforma/solicitudes-datos/"
    assert reverse("plataforma-solicitud-datos-responder", kwargs={"pk": 5}) == "/plataforma/solicitudes-datos/5/responder/"


def test_las_vistas_de_mis_datos_corren_en_una_transaccion_por_la_seguridad_por_filas():
    for clase in (vistas_derechos.MisDatos, vistas_derechos.MisDatosExportar, vistas_derechos.MisSolicitudes):
        assert not getattr(clase.as_view(), "_non_atomic_requests", None), clase.__name__


def test_ninguna_ruta_de_mis_datos_recibe_el_identificador_de_otra_persona():
    from django.urls import get_resolver
    rutas = [str(p.pattern) for p in get_resolver().url_patterns[1].url_patterns if "mis-datos" in str(p.pattern)]
    assert rutas and not any("<" in r for r in rutas)


@pytest.fixture(autouse=True)
def tasa_aislada(monkeypatch):
    """Los topes de tasa del PDP y de la corrección usan una memoria nueva por prueba (el caché real es de archivo y sobreviviría entre ejecuciones)."""
    import uuid

    from django.core.cache.backends.locmem import LocMemCache
    monkeypatch.setattr(vistas_derechos.TasaDeCorreccion, "cache", LocMemCache(uuid.uuid4().hex, {}))


def llamar(vista, metodo, cuerpo=None, usuario=None, scope="completo"):
    peticion = getattr(APIRequestFactory(), metodo)("/x/", cuerpo, format="json", secure=True, HTTP_X_REAL_IP="198.51.100.9")
    principal = SimpleNamespace(usuario=usuario or SimpleNamespace(pk=7), claims=SimpleNamespace(scope=scope), is_authenticated=True, pk=7)
    force_authenticate(peticion, user=principal)
    return vista.as_view()(peticion)


def test_el_aviso_es_publico_y_se_ve_sin_iniciar_sesion():
    respuesta = vistas_derechos.AvisoPrivacidad.as_view()(APIRequestFactory().get("/auth/aviso-privacidad/", secure=True))
    assert respuesta.status_code == 200 and respuesta.data["version"] == derechos.AVISO_VERSION and "texto" in respuesta.data


def test_un_token_de_enrolamiento_no_sirve_para_mis_datos():
    for vista in (vistas_derechos.MisDatos, vistas_derechos.MisDatosExportar, vistas_derechos.MisSolicitudes):
        assert llamar(vista, "get", scope="enrolar_mfa").status_code == 403, vista.__name__
    assert llamar(vistas_derechos.MisDatos, "patch", {"ciudad": "David"}, scope="enrolar_mfa").status_code == 403


def test_corregir_sin_segundo_factor_reciente_responde_403_con_la_sugerencia(monkeypatch):
    def negar(request, accion, recurso):
        assert accion == Accion.CORREGIR_MIS_DATOS and recurso.tipo == "perfil" and recurso.solicitante_id == 7  # el recurso es el PROPIO perfil
        raise AccesoDenegado({"codigo": "acceso_denegado", "detalle": "No tienes autorización para esta operación.", "reautenticacion_sugerida": True})
    monkeypatch.setattr(vistas_derechos, "autorizar", negar)
    r = llamar(vistas_derechos.MisDatos, "patch", {"ciudad": "David"})
    assert r.status_code == 403 and r.data["reautenticacion_sugerida"] is True


def test_corregir_no_confia_en_un_identificador_que_venga_en_el_cuerpo(monkeypatch):
    vistos = []
    monkeypatch.setattr(vistas_derechos, "autorizar", lambda request, accion, recurso: vistos.append(recurso))
    r = llamar(vistas_derechos.MisDatos, "patch", {"ciudad": "David", "usuario_id": 99, "solicitante_id": 99})
    assert r.status_code == 400 and vistos[0].solicitante_id == 7
    assert "usuario_id" in " ".join(r.data["errores"])


@pytest.mark.parametrize("cuerpo", [{}, {"correo": "malo"}, {"provincia": "Narnia"}, {"nombre": "Otro Nombre"}, {"cedula": "8-1-1"}, {"fecha_nacimiento": "1990-01-01"}, ["correo"]])
def test_corregir_con_datos_invalidos_responde_400_sin_tocar_la_base(monkeypatch, cuerpo):
    monkeypatch.setattr(vistas_derechos, "autorizar", lambda *a: None)
    monkeypatch.setattr(vistas_derechos.servicio, "corregir_datos", lambda *a: pytest.fail("no debe llegar a la base"))
    r = llamar(vistas_derechos.MisDatos, "patch", cuerpo)
    assert r.status_code == 400 and r.data["codigo"] == "datos_invalidos" and r.data["errores"]


def test_un_correo_repetido_responde_igual_que_en_el_registro_y_sin_pistas(monkeypatch):
    monkeypatch.setattr(vistas_derechos, "autorizar", lambda *a: None)
    monkeypatch.setattr(vistas_derechos.servicio, "corregir_datos", lambda *a: auth.Resultado(False, "usuario_existente"))
    r = llamar(vistas_derechos.MisDatos, "patch", {"correo": "ya.registrado@ejemplo.com"})
    assert r.status_code == 409 and r.data["codigo"] == "usuario_existente"
    assert "ya.registrado" not in str(r.data) and "registrado" not in r.data["detalle"].lower()


def test_una_cuenta_sin_perfil_recibe_404_al_corregir(monkeypatch):
    monkeypatch.setattr(vistas_derechos, "autorizar", lambda *a: None)
    monkeypatch.setattr(vistas_derechos.servicio, "corregir_datos", lambda *a: auth.Resultado(False, "sin_perfil"))
    assert llamar(vistas_derechos.MisDatos, "patch", {"ciudad": "David"}).status_code == 404


@pytest.mark.parametrize("cuerpo", [None, {}, {"tipo": "acceso", "detalle": "x" * 20}, {"tipo": "cancelacion", "detalle": "corto"}])
def test_una_solicitud_invalida_responde_400_sin_tocar_la_base(monkeypatch, cuerpo):
    monkeypatch.setattr(vistas_derechos, "autorizar", lambda *a: None)
    monkeypatch.setattr(vistas_derechos.servicio, "crear_solicitud", lambda *a, **k: pytest.fail("no debe llegar a la base"))
    r = llamar(vistas_derechos.MisSolicitudes, "post", cuerpo)
    assert r.status_code == 400 and r.data["errores"]


def test_pasado_el_tope_de_solicitudes_abiertas_responde_409_con_un_mensaje_claro(monkeypatch):
    monkeypatch.setattr(vistas_derechos, "autorizar", lambda *a: None)
    monkeypatch.setattr(vistas_derechos.servicio, "crear_solicitud", lambda *a, **k: auth.Resultado(False, "demasiadas_abiertas", detalle={"abiertas": 3, "maximo": 3}))
    r = llamar(vistas_derechos.MisSolicitudes, "post", {"tipo": "cancelacion", "detalle": "Quiero cancelar mi cuenta."})
    assert r.status_code == 409 and r.data["codigo"] == "demasiadas_abiertas" and "3" in r.data["detalle"]


def test_una_solicitud_valida_se_crea_con_el_usuario_que_llama_y_responde_201(monkeypatch):
    monkeypatch.setattr(vistas_derechos, "autorizar", lambda *a: None)
    visto = {}

    def crear(usuario, tipo, detalle, ip):
        visto.update(usuario=usuario.pk, tipo=tipo, detalle=detalle, ip=ip)
        return auth.Resultado(True, "solicitud_creada", detalle={"solicitud": {"id": 1, "estado": "recibida"}})
    monkeypatch.setattr(vistas_derechos.servicio, "crear_solicitud", crear)
    r = llamar(vistas_derechos.MisSolicitudes, "post", {"tipo": "cancelacion", "detalle": "Quiero cancelar mi cuenta.", "usuario_id": 99})
    assert r.status_code == 201 and visto == {"usuario": 7, "tipo": "cancelacion", "detalle": "Quiero cancelar mi cuenta.", "ip": "198.51.100.9"}


def test_las_respuestas_con_datos_personales_no_se_guardan_en_cachés(monkeypatch):
    monkeypatch.setattr(vistas_derechos, "autorizar", lambda *a: None)
    monkeypatch.setattr(vistas_derechos.servicio, "solicitudes_de", lambda *a, **k: [])
    assert llamar(vistas_derechos.MisSolicitudes, "get").headers["Cache-Control"] == "no-store"


# --- B1: cada método consulta al PDP, sobre el PROPIO perfil, antes de hacer nada

def _registrar_consultas(monkeypatch):
    vistas = []
    monkeypatch.setattr(vistas_derechos, "autorizar", lambda request, accion, recurso: vistas.append((accion, recurso)))
    return vistas


@pytest.mark.parametrize("vista,metodo,cuerpo,accion", [
    (vistas_derechos.MisDatos, "get", None, Accion.VER_MIS_DATOS),
    (vistas_derechos.MisDatos, "patch", {"ciudad": "David"}, Accion.CORREGIR_MIS_DATOS),
    (vistas_derechos.MisDatosExportar, "get", None, Accion.EXPORTAR_MIS_DATOS),
    (vistas_derechos.MisSolicitudes, "get", None, Accion.VER_MIS_DATOS),
    (vistas_derechos.MisSolicitudes, "post", {"tipo": "cancelacion", "detalle": "Quiero cancelar mi cuenta."}, Accion.CREAR_SOLICITUD_DATOS),
])
def test_cada_metodo_consulta_al_pdp_sobre_el_propio_perfil_y_si_niega_no_hace_nada(monkeypatch, vista, metodo, cuerpo, accion):
    consultas = []

    def negar(request, accion_, recurso):
        consultas.append((accion_, recurso))
        raise AccesoDenegado({"codigo": "acceso_denegado", "detalle": "No tienes autorización para esta operación.", "reautenticacion_sugerida": False})
    monkeypatch.setattr(vistas_derechos, "autorizar", negar)
    for nombre in ("contar_tramites", "exportar", "solicitudes_de", "crear_solicitud", "corregir_datos"):
        monkeypatch.setattr(vistas_derechos.servicio, nombre, lambda *a, **k: pytest.fail("la vista actuó sin autorización"))
    r = llamar(vista, metodo, cuerpo)
    assert r.status_code == 403
    assert consultas == [(accion, Recurso(tipo="perfil", solicitante_id=7))]


def test_ver_y_exportar_usan_acciones_distintas_porque_exportar_exige_segundo_factor():
    assert Accion.VER_MIS_DATOS != Accion.EXPORTAR_MIS_DATOS
    assert not permite(sujeto(mfa_min=60), Accion.EXPORTAR_MIS_DATOS, propio()) and permite(sujeto(mfa_min=60), Accion.VER_MIS_DATOS, propio())


def test_exportar_sin_segundo_factor_reciente_responde_403_con_la_sugerencia(monkeypatch):
    def negar(request, accion, recurso):
        assert accion == Accion.EXPORTAR_MIS_DATOS and recurso.solicitante_id == 7
        raise AccesoDenegado({"codigo": "acceso_denegado", "detalle": "No tienes autorización para esta operación.", "reautenticacion_sugerida": True})
    monkeypatch.setattr(vistas_derechos, "autorizar", negar)
    r = llamar(vistas_derechos.MisDatosExportar, "get")
    assert r.status_code == 403 and r.data["reautenticacion_sugerida"] is True


# --- B2: tope propio para corregir (10 por hora por persona)

def test_el_tope_de_correcciones_es_de_10_por_hora():
    from django.conf import settings
    assert settings.REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"]["corregir"] == "10/hour"
    assert vistas_derechos.TasaDeCorreccion.scope == "corregir"
    assert vistas_derechos.TasaDeCorreccion().parse_rate("10/hour") == (10, 3600)


def test_solo_corregir_lleva_el_tope_de_correcciones():
    peticion = APIRequestFactory().patch("/x/")
    for metodo, esperado in (("PATCH", True), ("GET", False)):
        vista = vistas_derechos.MisDatos()
        vista.request = SimpleNamespace(method=metodo)
        assert any(isinstance(t, vistas_derechos.TasaDeCorreccion) for t in vista.get_throttles()) is esperado, metodo
    assert not any(isinstance(t, vistas_derechos.TasaDeCorreccion) for t in vistas_derechos.MisSolicitudes().get_throttles())
    assert peticion is not None


def test_la_correccion_11_en_una_hora_responde_429_y_ver_no_se_cuenta(monkeypatch):
    monkeypatch.setattr(vistas_derechos, "autorizar", lambda *a: None)
    monkeypatch.setattr(vistas_derechos.servicio, "corregir_datos", lambda *a: auth.Resultado(False, "usuario_existente"))
    for _ in range(10):
        assert llamar(vistas_derechos.MisDatos, "patch", {"correo": "ya.registrado@ejemplo.com"}).status_code == 409
    r = llamar(vistas_derechos.MisDatos, "patch", {"correo": "ya.registrado@ejemplo.com"})
    assert r.status_code == 429
    # el tope es por persona: otra persona sigue pudiendo corregir
    otra = SimpleNamespace(pk=8)
    peticion = APIRequestFactory().patch("/x/", {"correo": "otro@ejemplo.com"}, format="json", secure=True, HTTP_X_REAL_IP="198.51.100.9")
    force_authenticate(peticion, user=SimpleNamespace(usuario=otra, claims=SimpleNamespace(scope="completo"), is_authenticated=True, pk=8))
    assert vistas_derechos.MisDatos.as_view()(peticion).status_code == 409


# --- B3: la cédula sale enmascarada al ver y completa solo al exportar

@pytest.mark.parametrize("cedula,esperada", [
    ("8-123-456", "*-***-456"), ("8-765-4321", "*-***-*321"), ("PE-12-3456", "**-**-*456"), ("E-8-123456", "*-*-***456"), ("10-1-123", "**-*-123"), ("8-1-2", "8-1-2"), ("", ""),
])
def test_la_cedula_enmascarada_solo_deja_visibles_los_ultimos_3_caracteres_y_respeta_los_guiones(cedula, esperada):
    assert perfil.enmascarar_cedula(cedula) == esperada
    assert perfil.enmascarar_cedula(None) is None
    assert [c for c in perfil.enmascarar_cedula(cedula) if c == "-"] == [c for c in cedula if c == "-"]
    assert sum(c.isalnum() and c != "*" for c in perfil.enmascarar_cedula(cedula)) <= 3


def _fila_de_perfil():
    cifrada = perfil.cifrar_cedula(vistas_derechos.servicio.settings.SIGET_MFA_KEY, "8-123-456")
    return SimpleNamespace(nombre="Ana", apellidos="Pérez", cedula_cifrada=cifrada, fecha_nacimiento=date(1990, 5, 20), provincia="Panamá", ciudad="David",
                           correo="ana@ejemplo.com", creado_en=AHORA, actualizado_en=None, aviso_version=None, aviso_leido_en=None)


def test_el_perfil_que_se_ve_lleva_la_cedula_enmascarada_y_el_de_la_exportacion_completa():
    fila = _fila_de_perfil()
    assert vistas_derechos.servicio.perfil_a_dict(fila)["cedula"] == "*-***-456"
    assert vistas_derechos.servicio.perfil_a_dict(fila, cedula_completa=True)["cedula"] == "8-123-456"
    assert "8-123" not in str(vistas_derechos.servicio.perfil_a_dict(fila))


def test_la_vista_de_mis_datos_no_devuelve_la_cedula_completa_ni_al_corregir(monkeypatch):
    fila = _fila_de_perfil()
    monkeypatch.setattr(vistas_derechos, "autorizar", lambda *a: None)
    monkeypatch.setattr(vistas_derechos.Perfil, "objects", SimpleNamespace(filter=lambda **k: SimpleNamespace(first=lambda: fila), get=lambda **k: fila))
    monkeypatch.setattr(vistas_derechos.servicio, "contar_tramites", lambda u: 0)
    monkeypatch.setattr(vistas_derechos.servicio, "cuenta_a_dict", lambda u: {})
    monkeypatch.setattr(vistas_derechos.servicio, "solicitudes_de", lambda *a, **k: [])
    monkeypatch.setattr(vistas_derechos, "fijar_contexto", lambda *a: None)
    monkeypatch.setattr(vistas_derechos._Propia, "_puede_ver_tramites", lambda self, request: False)
    r = llamar(vistas_derechos.MisDatos, "get")
    assert r.status_code == 200 and r.data["perfil"]["cedula"] == "*-***-456" and "8-123-456" not in str(r.data)
    monkeypatch.setattr(vistas_derechos.servicio, "corregir_datos", lambda *a: auth.Resultado(True, "datos_corregidos", detalle={"campos": ["ciudad"]}))
    r = llamar(vistas_derechos.MisDatos, "patch", {"ciudad": "David"})
    assert r.status_code == 200 and r.data["perfil"]["cedula"] == "*-***-456"


def test_la_exportacion_si_lleva_la_cedula_completa(monkeypatch):
    fila = _fila_de_perfil()
    monkeypatch.setattr(vistas_derechos.servicio, "Perfil", SimpleNamespace(objects=SimpleNamespace(filter=lambda **k: SimpleNamespace(first=lambda: fila))))
    monkeypatch.setattr(vistas_derechos.servicio, "cuenta_a_dict", lambda u: {})
    monkeypatch.setattr(vistas_derechos.servicio, "solicitudes_de", lambda *a, **k: [])
    monkeypatch.setattr(vistas_derechos.servicio, "EventoSeguridad", SimpleNamespace(objects=SimpleNamespace(filter=lambda **k: SimpleNamespace(order_by=lambda *a: SimpleNamespace(values=lambda *c: [])))))
    documento = vistas_derechos.servicio.exportar(SimpleNamespace(pk=7), False, AHORA)
    assert documento["perfil"]["cedula"] == "8-123-456"


# --------------------------------------------------------------------------- consola de solicitudes (operador)

class _S(SimpleNamespace):
    pass


def solicitud(**kw):
    base = dict(pk=4, usuario_id=50, usuario=SimpleNamespace(username="ana"), tipo="cancelacion", detalle="Quiero cancelar mi cuenta.", estado="recibida",
                creada_en=AHORA, vence_en=AHORA + timedelta(days=14), respondida_en=None, respuesta=None, respondida_por_id=None, respondida_por=None)
    base.update(kw)
    return SimpleNamespace(**base)


def test_el_operador_ve_quien_pide_por_identificador_y_usuario_nunca_nombre_cedula_ni_correo():
    d = plataforma.solicitud_para_operador(solicitud(), AHORA)
    assert d["persona"] == {"id": 50, "usuario": "ana"} and d["vencida"] is False and d["respondida_por"] is None
    crudo = str(d).lower()
    for prohibido in ("cedula", "correo", "nombre", "apellidos", "tramite"):
        assert prohibido not in crudo


def test_una_solicitud_vencida_se_marca_para_el_operador():
    assert plataforma.solicitud_para_operador(solicitud(vence_en=AHORA - timedelta(hours=1)), AHORA)["vencida"] is True
    cerrada = solicitud(estado="atendida", vence_en=AHORA - timedelta(days=3), respondida_por_id=9, respondida_por=SimpleNamespace(username="irene"))
    assert plataforma.solicitud_para_operador(cerrada, AHORA)["vencida"] is False
    assert plataforma.solicitud_para_operador(cerrada, AHORA)["respondida_por"] == {"id": 9, "usuario": "irene"}


def test_el_operador_no_responde_su_propia_solicitud_ni_una_ya_respondida():
    operador_ = SimpleNamespace(pk=50)
    assert plataforma.responder_solicitud_de_datos(operador_, solicitud(), "atendida", "Listo, ya está corregido.", "1.1.1.1").codigo == "no_a_si_mismo"
    otro = SimpleNamespace(pk=9)
    assert plataforma.responder_solicitud_de_datos(otro, solicitud(estado="atendida"), "atendida", "Listo, ya está corregido.", "1.1.1.1").codigo == "ya_resuelta"


@pytest.mark.parametrize("estado,respuesta", [("recibida", "x" * 20), ("borrar", "x" * 20), (None, "x" * 20), ("atendida", ""), ("atendida", "ok"), ("atendida", None)])
def test_responder_exige_estado_valido_y_respuesta_con_texto(estado, respuesta):
    r = plataforma.responder_solicitud_de_datos(SimpleNamespace(pk=9), solicitud(), estado, respuesta, "1.1.1.1")
    assert r.ok is False and r.codigo == "datos_invalidos" and r.detalle["errores"]


def test_un_estado_de_filtro_inexistente_no_llega_a_la_base():
    assert plataforma.solicitudes_de_datos("cualquiera") is None


# --------------------------------------------------------------------------- migración 016 (se revisa el texto: la base real la prueba `verificar_*`)

SQL = MIGRACION.read_text(encoding="utf-8")
SQL_SIN_COMENTARIOS = "\n".join(linea.split("--")[0] for linea in SQL.splitlines())


def test_la_migracion_va_en_una_transaccion_como_el_dueno_de_los_objetos():
    assert SQL_SIN_COMENTARIOS.strip().startswith("BEGIN;") and SQL_SIN_COMENTARIOS.strip().endswith("COMMIT;")
    assert "SET LOCAL ROLE siget_owner;" in SQL_SIN_COMENTARIOS


def test_solo_correo_provincia_y_ciudad_se_pueden_actualizar_en_el_perfil():
    updates = re.findall(r"GRANT\s+UPDATE\s*\(([^)]*)\)\s+ON\s+siget\.perfil", SQL_SIN_COMENTARIOS)
    assert len(updates) == 1 and [c.strip() for c in updates[0].split(",")] == ["correo", "provincia", "ciudad"]
    assert not re.search(r"GRANT\s+(ALL|UPDATE)\s+ON\s+siget\.perfil", SQL_SIN_COMENTARIOS)


def test_nadie_recibe_delete_ni_truncate_en_nada():
    assert not re.search(r"GRANT[^;]*\b(DELETE|TRUNCATE|ALL)\b", SQL_SIN_COMENTARIOS.replace("REVOKE ALL", ""))


def test_las_solicitudes_solo_se_pueden_responder_en_sus_columnas_de_respuesta():
    updates = re.findall(r"GRANT\s+UPDATE\s*\(([^)]*)\)\s+ON\s+siget\.solicitud_derecho", SQL_SIN_COMENTARIOS)
    # `respondida_en` NO se concede: la fija el trigger (D4)
    assert len(updates) == 1 and {c.strip() for c in updates[0].split(",")} == {"estado", "respondida_por", "respuesta"}
    assert re.search(r"GRANT\s+SELECT,\s*INSERT\s+ON\s+siget\.solicitud_derecho\s+TO\s+app_role", SQL_SIN_COMENTARIOS)


def test_ni_el_auditor_ni_pgadmin_ni_el_checkpoint_leen_las_solicitudes():
    revocados = {r.strip() for grupo in re.findall(r"REVOKE\s+ALL\s+ON\s+siget\.solicitud_derecho\s+FROM\s+([^;]*);", SQL_SIN_COMENTARIOS) for r in grupo.split(",")}
    assert revocados == {"PUBLIC", "pgadmin_lectura", "auditor_role", "checkpoint_app", "escalador_role"}
    assert not re.search(r"GRANT[^;]*solicitud_derecho[^;]*(auditor_role|pgadmin_lectura|checkpoint_app|escalador_role|PUBLIC)", SQL_SIN_COMENTARIOS)


def test_la_tabla_de_solicitudes_coincide_con_el_modelo():
    bloque = re.search(r"CREATE TABLE siget\.solicitud_derecho \((.*?)\n\);", SQL_SIN_COMENTARIOS, re.S).group(1)
    columnas = {m.group(1) for m in re.finditer(r"^\s{2}([a-z_]+)\s+(?:bigserial|int|text|timestamptz)\b", bloque, re.M)}
    assert columnas == columnas_del_modelo(SolicitudDerecho)


def test_las_columnas_nuevas_del_perfil_coinciden_con_el_modelo():
    for columna in ("actualizado_en", "aviso_version", "aviso_leido_en"):
        assert f"ADD COLUMN {columna}" in SQL_SIN_COMENTARIOS and columna in columnas_del_modelo(Perfil)


def test_un_trigger_impide_tocar_una_solicitud_respondida_y_exige_respuesta_y_responsable():
    assert "BEFORE UPDATE ON siget.solicitud_derecho" in SQL_SIN_COMENTARIOS
    assert "OLD.estado <> 'recibida'" in SQL_SIN_COMENTARIOS and "NEW.respondida_por IS NULL" in SQL_SIN_COMENTARIOS
    assert "respondida_por <> usuario_id" in SQL_SIN_COMENTARIOS  # nadie responde su propia solicitud
    assert "ON siget.solicitud_derecho" in SQL_SIN_COMENTARIOS and "DELETE" not in SQL_SIN_COMENTARIOS.replace("sin DELETE", "")


def test_la_migracion_no_lleva_datos_personales_ni_secretos():
    for prohibido in ("password", "INSERT INTO", "@", "8-"):
        assert prohibido not in SQL_SIN_COMENTARIOS, prohibido


def _funcion(nombre):
    return re.search(rf"CREATE FUNCTION siget\.{nombre}\(\).*?END \$\$;", SQL_SIN_COMENTARIOS, re.S).group(0)


def test_d1_una_solicitud_nace_recibida_sin_respuesta_y_con_un_plazo_razonable():
    assert "BEFORE INSERT ON siget.solicitud_derecho" in SQL_SIN_COMENTARIOS
    cuerpo = _funcion("solicitud_derecho_validar_alta")
    for asignacion in ("NEW.estado := 'recibida'", "NEW.respondida_en := NULL", "NEW.respondida_por := NULL", "NEW.respuesta := NULL", "NEW.creada_en := now()"):
        assert asignacion in cuerpo, asignacion
    assert "NEW.vence_en < now() + interval '10 days'" in cuerpo and "NEW.vence_en > now() + interval '30 days'" in cuerpo and "RAISE EXCEPTION" in cuerpo
    assert "EXECUTE FUNCTION siget.solicitud_derecho_validar_alta()" in SQL_SIN_COMENTARIOS


def test_d2_solo_un_operador_de_identidades_responde_y_nadie_su_propia_solicitud():
    cuerpo = _funcion("solicitud_derecho_validar_respuesta")
    assert "siget.usuario WHERE id = NEW.respondida_por AND rol_plataforma = 'operador_identidades'" in cuerpo and "RAISE EXCEPTION" in cuerpo
    assert "SECURITY DEFINER" in SQL_SIN_COMENTARIOS and "SET search_path = siget, pg_temp" in SQL_SIN_COMENTARIOS  # no depende de los grants de app_role sobre usuario
    assert "respondida_por <> usuario_id" in SQL_SIN_COMENTARIOS
    assert "NEW.respondida_en := now()" in cuerpo


def test_d3_el_perfil_nace_sin_fecha_de_actualizacion_y_con_la_constancia_fechada_por_la_base():
    assert "BEFORE INSERT ON siget.perfil" in SQL_SIN_COMENTARIOS
    cuerpo = _funcion("perfil_sellar_alta")
    assert "NEW.actualizado_en := NULL" in cuerpo and "IF NEW.aviso_version IS NOT NULL THEN" in cuerpo and "NEW.aviso_leido_en := now()" in cuerpo
    assert "EXECUTE FUNCTION siget.perfil_sellar_alta()" in SQL_SIN_COMENTARIOS


def test_d4_la_aplicacion_ya_no_envia_la_hora_de_la_respuesta():
    servicio = (Path(plataforma.__file__).parent / "servicio.py").read_text(encoding="utf-8")
    llamada = re.search(r"SolicitudDerecho\.objects\.filter\(pk=solicitud\.pk, estado=\"recibida\"\)\.update\((.*?)\)\n", servicio, re.S).group(1)
    assert "respondida_en" not in llamada and "respondida_por=operador" in llamada
    verificacion = (Path(plataforma.__file__).parents[1] / "nucleo" / "management" / "commands" / "verificar_autenticacion.py").read_text(encoding="utf-8")
    assert not re.search(r"\.update\([^)]*respondida_en", verificacion)
