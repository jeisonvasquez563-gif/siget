"""Alertas ante patrones sospechosos (PT-10, RS-24): reglas del PDP, servicio, vistas, comando y migración 019.

Sin base de datos: que las reglas detecten lo correcto lo recorre `database/pruebas-alertas.sql` (PostgreSQL, como `detector_role`) y que la API
liste y revise con la seguridad por filas lo recorre `verificar_plataforma` (contra la base real).
"""
import os
import re
import subprocess
import sys
from contextlib import nullcontext
from datetime import datetime, timedelta, timezone
from io import StringIO
from pathlib import Path
from types import SimpleNamespace

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import OperationalError
from django.urls import reverse
from rest_framework.test import APIRequestFactory, force_authenticate

from apps.autorizacion.pdp import Accion, Entorno, Recurso, Sujeto, decidir
from apps.nucleo.errores import AccesoDenegado
from apps.nucleo.management.commands import detectar_anomalias
from apps.plataforma import servicio, vistas
from apps.plataforma.models import REGLAS_ALERTA, AlertaSeguridad
from tests import ejemplos_pdp

AHORA = datetime(2026, 11, 26, 12, 0, tzinfo=timezone.utc)
BACKEND = Path(__file__).resolve().parent.parent
MIGRACION = BACKEND.parent / "database" / "migraciones" / "019-alertas-seguridad.sql"
PRUEBAS_SQL = BACKEND.parent / "database" / "pruebas-alertas.sql"
NGINX = BACKEND.parent / "infra" / "podman" / "vm1-app-backend" / "nginx.conf"
INFRA = BACKEND.parent / "infra" / "podman" / "vm1-app-backend"


# --------------------------------------------------------------------------- PDP

def sujeto(rol="operador_seguridad", minutos=1, nivel=2, **kw):
    return Sujeto(id=10, rol_plataforma=rol, nivel_aseguramiento=nivel, mfa_verificado_en=None if minutos is None else AHORA - timedelta(minutes=minutos), **kw)


def decide(s, accion):
    return decidir(s, accion, Recurso(tipo="alerta"), Entorno(ahora=AHORA))


@pytest.mark.parametrize("accion", [Accion.VER_ALERTAS, Accion.REVISAR_ALERTA])
def test_el_operador_de_seguridad_ve_y_revisa_con_segundo_factor_reciente(accion):
    d = decide(sujeto(), accion)
    assert d.permitido and d.politica == f"operador_seguridad_{accion.value}"


@pytest.mark.parametrize("accion", [Accion.VER_ALERTAS, Accion.REVISAR_ALERTA])
@pytest.mark.parametrize("minutos", [None, 600])
def test_al_operador_sin_segundo_factor_reciente_se_le_niega(accion, minutos):
    d = decide(sujeto(minutos=minutos), accion)
    assert not d.permitido and d.politica == "sin_regla_que_permita"


def test_el_auditor_las_ve_pero_no_las_revisa():
    assert decide(sujeto("auditor", nivel=3), Accion.VER_ALERTAS).politica == "auditor_consulta"
    assert not decide(sujeto("auditor", nivel=3), Accion.REVISAR_ALERTA).permitido


def test_el_auditor_exige_nivel_3_y_segundo_factor_reciente_como_para_el_resto_de_la_auditoria():
    assert not decide(sujeto("auditor", nivel=2), Accion.VER_ALERTAS).permitido
    assert not decide(sujeto("auditor", nivel=3, minutos=600), Accion.VER_ALERTAS).permitido


@pytest.mark.parametrize("rol", ["operador_infraestructura", "operador_identidades", "operador_catalogo", "custodio_secretos", "ninguno"])
def test_ningun_otro_rol_de_plataforma_ni_la_ciudadania_las_ve_ni_las_revisa(rol):
    for accion in (Accion.VER_ALERTAS, Accion.REVISAR_ALERTA):
        assert not decide(sujeto(rol), accion).permitido, (rol, accion)


@pytest.mark.parametrize("rol", ["funcionario", "supervisor", "coordinador_institucional"])
def test_el_personal_de_las_instituciones_tampoco(rol):
    for accion in (Accion.VER_ALERTAS, Accion.REVISAR_ALERTA):
        assert not decide(sujeto("ninguno", membresias=frozenset({(3, rol)})), accion).permitido


def test_una_cuenta_bloqueada_no_las_ve():
    d = decide(sujeto(estado_cuenta="bloqueada"), Accion.VER_ALERTAS)
    assert not d.permitido and d.politica == "cuenta_no_activa"


# --------------------------------------------------------------------------- el PDP evaluado para los diez roles

def test_el_pdp_calcula_las_dos_acciones_nuevas_y_siguen_sin_existir_superusuarios():
    M = ejemplos_pdp.construir()
    assert len(M["acciones"]) == len(Accion) == 31
    permitidos = lambda rol, a: M["matriz"][rol][a]["favorable"]["permitido"]  # noqa: E731
    assert [r for r in ejemplos_pdp.ROLES if permitidos(r, "ver_alertas")] == ["operador_seguridad", "auditor"]
    assert [r for r in ejemplos_pdp.ROLES if permitidos(r, "revisar_alerta")] == ["operador_seguridad"]
    assert M["matriz"]["operador_seguridad"]["revisar_alerta"]["exige_segundo_factor"] is True
    assert M["matriz"]["auditor"]["ver_alertas"]["exige_segundo_factor"] is True
    assert M["ningun_rol_puede_todo"] is True


# --------------------------------------------------------------------------- modelo y servicio

def test_las_reglas_del_modelo_son_las_cuatro_de_la_base():
    assert {r[0] for r in REGLAS_ALERTA} == {"rafaga_login_fallido_ip", "denegaciones_persona", "reuso_token_refresco", "bloqueos_repetidos"}


def test_el_orm_no_crea_ni_borra_alertas():
    a = AlertaSeguridad(regla="reuso_token_refresco", severidad="alta", conteo=1, primera_vez=AHORA, ultima_vez=AHORA)
    with pytest.raises(PermissionError):
        a.save()
    with pytest.raises(PermissionError):
        a.delete()


def una_fila(**kw):
    base = dict(id=5, regla="rafaga_login_fallido_ip", severidad="media", usuario_id=None, usuario__username=None, ip="192.0.2.10", conteo=12,
                primera_vez=AHORA - timedelta(minutes=8), ultima_vez=AHORA, detalle={"ventana_minutos": 10, "umbral": 10, "por_nombre": {"login_fallido": 12}},
                estado="abierta", revisada_por_id=None, revisada_por__username=None, revisada_en=None, nota=None)
    base.update(kw)
    return base


def test_la_alerta_muestra_el_usuario_y_la_ip_y_nada_mas_de_la_persona():
    d = servicio.alerta_a_dict(una_fila(regla="reuso_token_refresco", severidad="alta", usuario_id=7, usuario__username="ana", ip=None))
    assert d["persona"] == {"id": 7, "usuario": "ana"} and d["ip"] is None and d["revisada_por"] is None
    assert set(d) == {"id", "regla", "severidad", "persona", "ip", "conteo", "primera_vez", "ultima_vez", "detalle", "estado", "revisada_por", "revisada_en", "nota"}
    por_ip = servicio.alerta_a_dict(una_fila())
    assert por_ip["persona"] is None and por_ip["ip"] == "192.0.2.10"


def test_la_alerta_revisada_muestra_quien_y_la_nota():
    d = servicio.alerta_a_dict(una_fila(estado="revisada", revisada_por_id=3, revisada_por__username="olga", revisada_en=AHORA, nota="Era una prueba"))
    assert d["revisada_por"] == {"id": 3, "usuario": "olga"} and d["nota"] == "Era una prueba"


@pytest.mark.parametrize("datos,errores", [
    ({"estado": "revisada", "nota": "Era una prueba de carga"}, 0),
    ({"estado": "descartada", "nota": "  Falso positivo  "}, 0),
    ({"estado": "revisada"}, 1),
    ({"estado": "revisada", "nota": ""}, 1),
    ({"estado": "revisada", "nota": "  ab  "}, 1),
    ({"estado": "revisada", "nota": "x" * 1001}, 1),
    ({"estado": "abierta", "nota": "Reabrir no se puede"}, 1),
    ({"estado": "cerrada", "nota": "Estado inventado"}, 1),
    ({"estado": ["revisada"], "nota": "Un estado que es una lista"}, 1),
    ({"estado": "revisada", "nota": 12345}, 1),
    ({"estado": "revisada", "nota": "Con un nulo\u0000 adentro"}, 1),
    ({"estado": "revisada", "nota": "Con control\x07 adentro"}, 1),
    ({"estado": "revisada", "nota": "​​​​"}, 1),
    ({"estado": "revisada", "nota": "ab​​"}, 1),
    ({"estado": "revisada", "nota": "...!!!"}, 1),
    ({"estado": "revisada", "nota": "Linea uno\nlinea dos"}, 0),
    ({"estado": "revisada", "nota": "x" * 1000}, 0),
    ({}, 2),
    (None, 2),
])
def test_la_revision_exige_un_estado_valido_y_una_nota(datos, errores):
    valores, mensajes = servicio.validar_revision(datos)
    assert len(mensajes) == errores and (valores is None) == bool(errores)


def test_la_nota_se_guarda_sin_espacios_sobrantes():
    assert servicio.validar_revision({"estado": "descartada", "nota": "  Falso positivo  "})[0] == ("descartada", "Falso positivo")


class Consulta:
    """Lo mínimo del QuerySet que usa el servicio, sobre filas en memoria."""

    def __init__(self, filas, bds=None):
        self.filas, self.bds = filas, bds if bds is not None else []

    def using(self, bd):
        self.bds.append(bd)
        return Consulta(self.filas, self.bds)

    def filter(self, **f):
        filas = self.filas
        for clave, valor in f.items():
            clave = "id" if clave == "pk" else clave
            filas = [x for x in filas if x[clave] == valor]
        return Consulta(filas, self.bds)

    def order_by(self, *campos):
        return Consulta(sorted(self.filas, key=lambda x: (x["ultima_vez"], x["id"]), reverse=True), self.bds)

    def values(self, *campos):
        return Consulta([{c: x[c] for c in campos} for x in self.filas], self.bds)

    def first(self):
        return self.filas[0] if self.filas else None

    def count(self):
        return len(self.filas)

    def __getitem__(self, corte):
        return self.filas[corte]

    def update(self, **cambios):
        for x in self.filas:
            x.update({("revisada_por_id" if k == "revisada_por" else k): (v.pk if k == "revisada_por" else v) for k, v in cambios.items()})
        return len(self.filas)


@pytest.fixture
def base(monkeypatch):
    filas = [una_fila(id=1, estado="revisada", ultima_vez=AHORA - timedelta(hours=2), revisada_por_id=3, revisada_por__username="olga", revisada_en=AHORA, nota="Era una prueba"),
             una_fila(id=2, estado="abierta", ultima_vez=AHORA - timedelta(hours=1)),
             una_fila(id=3, estado="abierta", ultima_vez=AHORA, regla="reuso_token_refresco", severidad="alta", usuario_id=7, usuario__username="ana", ip=None)]
    bds, eventos = [], []
    monkeypatch.setattr(servicio, "AlertaSeguridad", SimpleNamespace(objects=Consulta(filas, bds)))
    monkeypatch.setattr(servicio.transaction, "atomic", lambda *a, **k: nullcontext())
    monkeypatch.setattr(servicio, "registrar_evento", lambda *a: eventos.append(a))
    return SimpleNamespace(filas=filas, bds=bds, eventos=eventos)


def test_la_lista_trae_las_mas_recientes_primero_con_el_total_y_las_abiertas(base):
    r = servicio.alertas("", 20, 0)
    assert [a["id"] for a in r["resultados"]] == [3, 2, 1] and r["total"] == 3 and r["abiertas"] == 2


def test_el_filtro_por_estado_cambia_el_total_pero_no_las_abiertas(base):
    r = servicio.alertas("revisada", 20, 0)
    assert [a["id"] for a in r["resultados"]] == [1] and r["total"] == 1 and r["abiertas"] == 2


def test_la_paginacion_corta_la_lista(base):
    r = servicio.alertas("", 1, 1)
    assert [a["id"] for a in r["resultados"]] == [2] and r["total"] == 3


def test_el_auditor_lee_por_su_propia_conexion(base):
    servicio.alertas("", 20, 0, "auditoria")
    assert set(base.bds) == {"auditoria"}


def test_se_revisa_una_alerta_abierta_con_su_nota_y_queda_el_evento_sin_la_nota(base):
    r = servicio.revisar_alerta(SimpleNamespace(pk=3), 2, {"estado": "revisada", "nota": "Era una prueba de carga interna"}, "198.51.100.7")
    assert r.ok and r.codigo == "alerta_revisada" and r.detalle == {"id": 2, "estado": "revisada"}
    fila = next(f for f in base.filas if f["id"] == 2)
    assert fila["estado"] == "revisada" and fila["revisada_por_id"] == 3 and fila["nota"] == "Era una prueba de carga interna"
    assert base.eventos == [(3, "alerta_revisada", "198.51.100.7", {"alerta": 2, "regla": "rafaga_login_fallido_ip", "estado": "revisada"})]
    assert "prueba" not in str(base.eventos)


def test_no_se_revisa_dos_veces(base):
    r = servicio.revisar_alerta(SimpleNamespace(pk=3), 1, {"estado": "descartada", "nota": "Segunda revision"}, "198.51.100.7")
    assert not r.ok and r.codigo == "ya_revisada" and base.eventos == []


def test_una_alerta_que_no_existe_o_que_la_base_no_muestra_no_existe(base):
    r = servicio.revisar_alerta(SimpleNamespace(pk=3), 99, {"estado": "revisada", "nota": "Nada que ver aqui"}, "198.51.100.7")
    assert not r.ok and r.codigo == "no_existe"


def test_sin_nota_no_se_toca_nada(base):
    r = servicio.revisar_alerta(SimpleNamespace(pk=3), 2, {"estado": "revisada"}, "198.51.100.7")
    assert not r.ok and r.codigo == "datos_invalidos" and base.filas[1]["estado"] == "abierta" and base.eventos == []


# --------------------------------------------------------------------------- vistas

def llamar(vista, metodo, ruta="/x/", kwargs=None, datos=None):
    peticion = getattr(APIRequestFactory(), metodo)(ruta, datos, format="json", secure=True, HTTP_X_REAL_IP="198.51.100.9")
    principal = SimpleNamespace(usuario=SimpleNamespace(pk=7, rol_plataforma=ROL["valor"]), claims=SimpleNamespace(scope=SCOPE["valor"]), is_authenticated=True, pk=7)
    force_authenticate(peticion, user=principal)
    return vista.as_view()(peticion, **(kwargs or {}))


ROL, SCOPE = {"valor": "operador_seguridad"}, {"valor": "completo"}


@pytest.fixture
def api(monkeypatch):
    ROL["valor"], SCOPE["valor"] = "operador_seguridad", "completo"
    llamadas = SimpleNamespace(decisiones=[], contexto=[], alertas=[], revisiones=[])
    monkeypatch.setattr("rest_framework.throttling.ScopedRateThrottle.allow_request", lambda self, request, view: True)
    monkeypatch.setattr(vistas, "autorizar", lambda request, accion, recurso: llamadas.decisiones.append((accion, recurso.tipo)))
    monkeypatch.setattr(vistas, "fijar_contexto", lambda usuario_id, instituciones=(): llamadas.contexto.append(usuario_id))
    monkeypatch.setattr(vistas.servicio, "alertas", lambda estado, limite, desp, bd="default": (llamadas.alertas.append((estado, limite, desp, bd)),
                                                                                              {"resultados": [], "total": 0, "abiertas": 0})[1])

    def revisar(operador, pk, datos, ip):
        llamadas.revisiones.append((operador.pk, pk, datos, ip))
        return vistas.servicio.Resultado(True, "alerta_revisada", detalle={"id": pk, "estado": datos["estado"]}) if pk != 99 else vistas.servicio.Resultado(False, "no_existe")
    monkeypatch.setattr(vistas.servicio, "revisar_alerta", revisar)
    return llamadas


def test_la_lista_pasa_por_el_pdp_y_devuelve_total_abiertas_y_paginacion(api):
    r = llamar(vistas.Alertas, "get", "/x/?estado=abierta&limite=5&desplazamiento=10")
    assert r.status_code == 200 and r.data == {"resultados": [], "total": 0, "abiertas": 0, "limite": 5, "desplazamiento": 10}
    assert api.decisiones == [(Accion.VER_ALERTAS, "alerta")] and api.alertas == [("abierta", 5, 10, "default")]
    assert api.contexto == [7] and r["Cache-Control"] == "no-store"


def test_el_auditor_lee_por_su_conexion_y_sin_contexto_de_aplicacion(api):
    ROL["valor"] = "auditor"
    r = llamar(vistas.Alertas, "get")
    assert r.status_code == 200 and api.alertas == [("", 20, 0, "auditoria")] and api.contexto == []


@pytest.mark.parametrize("consulta", ["limite=0", "limite=101", "limite=abc", "desplazamiento=-1"])
def test_una_paginacion_invalida_da_400(api, consulta):
    r = llamar(vistas.Alertas, "get", f"/x/?{consulta}")
    assert r.status_code == 400 and r.data["codigo"] == "paginacion_invalida" and api.alertas == []


@pytest.mark.parametrize("estado", ["cerrada", "ABIERTA", "abierta;--", "x" * 50])
def test_un_estado_invalido_da_400(api, estado):
    r = llamar(vistas.Alertas, "get", f"/x/?estado={estado}")
    assert r.status_code == 400 and r.data["codigo"] == "datos_invalidos" and api.alertas == []


def test_revisar_pasa_por_el_pdp_y_responde_200(api):
    r = llamar(vistas.AlertaRevisar, "post", kwargs={"pk": 2}, datos={"estado": "revisada", "nota": "Era una prueba"})
    assert r.status_code == 200 and r.data == {"codigo": "alerta_revisada", "id": 2, "estado": "revisada"}
    assert api.decisiones == [(Accion.REVISAR_ALERTA, "alerta")] and api.revisiones == [(7, 2, {"estado": "revisada", "nota": "Era una prueba"}, "198.51.100.9")]
    assert api.contexto == [7]


def test_revisar_una_alerta_que_no_existe_da_404(api):
    assert llamar(vistas.AlertaRevisar, "post", kwargs={"pk": 99}, datos={"estado": "revisada", "nota": "Nada que ver"}).status_code == 404


@pytest.mark.parametrize("vista,metodo,kw", [(vistas.Alertas, "get", None), (vistas.AlertaRevisar, "post", {"pk": 2})])
def test_si_el_pdp_niega_no_se_hace_nada(api, monkeypatch, vista, metodo, kw):
    def negar(request, accion, recurso):
        raise AccesoDenegado({"codigo": "acceso_denegado", "detalle": "No tienes autorización para esta operación.", "reautenticacion_sugerida": False})
    monkeypatch.setattr(vistas, "autorizar", negar)
    assert llamar(vista, metodo, kwargs=kw, datos={"estado": "revisada", "nota": "Una nota"}).status_code == 403
    assert api.alertas == [] and api.revisiones == [] and api.contexto == []


def test_un_token_de_enrolamiento_no_sirve(api):
    SCOPE["valor"] = "enrolar_mfa"
    assert llamar(vistas.Alertas, "get").status_code == 403
    assert llamar(vistas.AlertaRevisar, "post", kwargs={"pk": 2}, datos={"estado": "revisada", "nota": "Una nota"}).status_code == 403
    assert api.revisiones == []


def test_las_rutas_se_resuelven_bajo_plataforma_que_nginx_y_vite_ya_pasan():
    assert reverse("plataforma-alertas") == "/plataforma/alertas/"
    assert reverse("plataforma-alerta-revisar", kwargs={"pk": 5}) == "/plataforma/alertas/5/revisar/"
    assert re.search(r"location ~ \^/\([^)]*\bplataforma\b[^)]*\)", NGINX.read_text(encoding="utf-8"))  # ninguna ruta de primer nivel nueva
    assert "'/plataforma'" in (BACKEND.parent / "frontend" / "vite.config.js").read_text(encoding="utf-8")


# --------------------------------------------------------------------------- comando y configuración del temporizador

class _Cursor:
    def __init__(self, resultado=None, error=None):
        self.resultado, self.error, self.sql = resultado, error, None

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql):
        if self.error:
            raise self.error
        self.sql = sql

    def fetchone(self):
        return (self.resultado,)


def _con(monkeypatch, cursor):
    usadas = []

    class _Conexiones(dict):
        def __getitem__(self, alias):
            usadas.append(alias)
            return SimpleNamespace(cursor=lambda: cursor)

    monkeypatch.setattr(detectar_anomalias, "connections", _Conexiones())
    return usadas


def test_el_comando_usa_la_conexion_del_detector_y_solo_llama_a_la_funcion(monkeypatch):
    cursor = _Cursor(resultado=2)
    usadas = _con(monkeypatch, cursor)
    salida = StringIO()
    call_command("detectar_anomalias", stdout=salida)
    assert usadas == ["detector"] and cursor.sql == "SELECT siget.detectar_anomalias()"
    assert "2 alerta(s) creada(s) o actualizada(s)" in salida.getvalue()


def test_un_error_de_la_base_falla_sin_filtrar_detalles(monkeypatch):
    _con(monkeypatch, _Cursor(error=OperationalError("password authentication failed for user detector_role: secreto")))
    with pytest.raises(CommandError) as error:
        call_command("detectar_anomalias", stdout=StringIO())
    assert "secreto" not in str(error.value) and "OperationalError" in str(error.value)


def _importar_configuracion(**extra):
    entorno = {k: v for k, v in os.environ.items() if not k.startswith("SIGET_") and k != "DJANGO_SETTINGS_MODULE"}
    entorno.update(DJANGO_SETTINGS_MODULE="config.settings_detector", **extra)
    return subprocess.run([sys.executable, "-c", "import django; django.setup(); from django.conf import settings; "
                           "print(settings.DATABASES['detector']['USER'])"],
                          cwd=BACKEND, env=entorno, capture_output=True, text=True, timeout=60)


def test_el_temporizador_arranca_sin_las_claves_reales():
    r = _importar_configuracion()
    assert r.returncode == 0, r.stderr
    assert r.stdout.strip() == "detector_role"


@pytest.mark.parametrize("clave", ["SIGET_JWT_KEY", "SIGET_MFA_KEY_FILE", "SIGET_SECRET_KEY"])
def test_el_temporizador_se_niega_a_recibir_claves_reales(clave):
    r = _importar_configuracion(**{clave: "x" * 40})
    assert r.returncode != 0 and "no debe llegar al temporizador" in r.stderr


def test_la_unidad_de_systemd_solo_recibe_los_dos_secretos_del_detector():
    servicio_unidad = (INFRA / "siget-detectar.service").read_text(encoding="utf-8")
    assert re.findall(r"--secret (\S+?),mode", servicio_unidad) == ["siget-db-detector-password", "siget-ca"]
    assert "config.settings_detector" in servicio_unidad and "manage.py detectar_anomalias" in servicio_unidad
    for clave in ("SIGET_SECRET_KEY", "SIGET_JWT_KEY", "SIGET_MFA_KEY", "SIGET_DB_APP_PASSWORD"):
        assert clave not in servicio_unidad
    assert "--read-only" in servicio_unidad and "--cap-drop=ALL" in servicio_unidad and "no-new-privileges" in servicio_unidad


def test_el_temporizador_corre_cada_cinco_minutos_y_recupera_lo_perdido():
    temporizador = (INFRA / "siget-detectar.timer").read_text(encoding="utf-8")
    assert "OnCalendar=*-*-* *:00/5:00" in temporizador and "Persistent=true" in temporizador


# --------------------------------------------------------------------------- migración 019

SQL = MIGRACION.read_text(encoding="utf-8")
SQL_SIN_COMENTARIOS = "\n".join(linea.split("--")[0] for linea in SQL.splitlines())


def test_la_migracion_va_en_una_transaccion_como_el_dueno_y_el_rol_se_crea_aparte():
    assert SQL_SIN_COMENTARIOS.strip().startswith("BEGIN;") and "SET LOCAL ROLE siget_owner;" in SQL_SIN_COMENTARIOS
    antes, despues = SQL_SIN_COMENTARIOS.split("COMMIT;", 1)
    assert "CREATE ROLE" not in antes and "CREATE ROLE detector_role LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS" in despues
    assert "PASSWORD" not in SQL_SIN_COMENTARIOS.upper()  # la contraseña nunca va en una migración


def test_la_tabla_tiene_las_columnas_y_las_listas_cerradas_del_diseno():
    tabla = re.search(r"CREATE TABLE siget\.alerta_seguridad \((.*?)\n\);", SQL_SIN_COMENTARIOS, re.S).group(1)
    assert re.findall(r"^\s{2}(\w+)\s", tabla, re.M) == ["id", "regla", "severidad", "usuario_id", "ip", "conteo", "primera_vez", "ultima_vez", "detalle", "estado",
                                                         "revisada_por", "revisada_en", "nota", "CONSTRAINT", "CONSTRAINT"]
    assert set(re.findall(r"'(\w+)'", re.search(r"regla\s+text NOT NULL CHECK \(regla IN \((.*?)\)\)", tabla, re.S).group(1))) == {r[0] for r in REGLAS_ALERTA}
    assert "severidad     text NOT NULL CHECK (severidad IN ('media', 'alta'))" in tabla
    assert "CHECK (estado IN ('abierta', 'revisada', 'descartada'))" in tabla and "length(nota) <= 1000" in tabla
    assert "usuario_id    int REFERENCES siget.usuario(id)" in tabla and "revisada_por  int REFERENCES siget.usuario(id)" in tabla
    assert "ip            inet" in tabla and "detalle       jsonb" in tabla


def test_una_sola_alerta_abierta_por_regla_persona_e_ip_cuidando_los_nulos():
    assert re.search(r"CREATE UNIQUE INDEX alerta_abierta_unica ON siget\.alerta_seguridad \(regla, COALESCE\(usuario_id, 0\), COALESCE\(ip, '0\.0\.0\.0'::inet\)\)\s+"
                     r"WHERE estado = 'abierta';", SQL_SIN_COMENTARIOS)
    assert "ON CONFLICT (regla, COALESCE(usuario_id, 0), COALESCE(ip, '0.0.0.0'::inet)) WHERE estado = 'abierta'" in SQL_SIN_COMENTARIOS


def test_la_funcion_del_detector_es_security_definer_con_la_ruta_fija_y_sin_acceso_publico():
    funcion = re.search(r"CREATE FUNCTION siget\.detectar_anomalias\(\) RETURNS int.*?END \$\$;", SQL_SIN_COMENTARIOS, re.S).group(0)
    assert "SECURITY DEFINER" in funcion and "SET search_path = siget, pg_temp" in funcion
    assert "REVOKE ALL ON FUNCTION siget.detectar_anomalias() FROM PUBLIC;" in SQL_SIN_COMENTARIOS
    assert re.findall(r"GRANT EXECUTE ON FUNCTION siget\.detectar_anomalias\(\) TO (\w+);", SQL_SIN_COMENTARIOS) == ["detector_role"]


def test_las_cuatro_reglas_llevan_su_severidad_ventana_y_umbral():
    funcion = re.search(r"CREATE FUNCTION siget\.detectar_anomalias\(\) RETURNS int.*?END \$\$;", SQL_SIN_COMENTARIOS, re.S).group(0)
    assert "('rafaga_login_fallido_ip', 'media', 10, 10)" in funcion
    assert "('denegaciones_persona',    'media', 10, 5)" in funcion
    assert "('reuso_token_refresco',    'alta',  1440, 1)" in funcion
    assert "('bloqueos_repetidos',      'alta',  1440, 2)" in funcion
    assert "e.evento IN ('login_fallido', 'cambio_contrasena_fallido')" in funcion
    assert "e.evento = 'refresh_reuso'" in funcion and "e.evento = 'cuenta_bloqueada'" in funcion
    assert "NOT d.permitido" in funcion


def test_el_detector_se_serializa_con_la_revision_y_no_pide_permisos_al_rol():
    funcion = re.search(r"CREATE FUNCTION siget\.detectar_anomalias\(\) RETURNS int.*?END \$\$;", SQL_SIN_COMENTARIOS, re.S).group(0)
    assert funcion.index("LOCK TABLE siget.alerta_seguridad IN SHARE ROW EXCLUSIVE MODE;") < funcion.index("WITH")
    assert len(re.findall(r"GRANT[^;]*detector_role", SQL_SIN_COMENTARIOS)) == 3  # conectar, usar el esquema y ejecutar la funcion: nada mas


def test_las_denegaciones_solo_cuentan_personas_que_existen():
    funcion = re.search(r"CREATE FUNCTION siget\.detectar_anomalias\(\) RETURNS int.*?END \$\$;", SQL_SIN_COMENTARIOS, re.S).group(0)
    assert "FROM siget.decision_pdp d JOIN siget.usuario u ON u.id = d.actor_id" in funcion  # sin clave foranea en decision_pdp


def test_el_detector_une_por_coalesce_y_calcula_la_ip_una_sola_vez():
    funcion = re.search(r"CREATE FUNCTION siget\.detectar_anomalias\(\) RETURNS int.*?END \$\$;", SQL_SIN_COMENTARIOS, re.S).group(0)
    assert "IS NOT DISTINCT FROM" not in funcion
    assert funcion.count("siget.ip_o_nulo(") == 1


def test_el_detalle_solo_lleva_contadores_y_nombres():
    funcion = re.search(r"CREATE FUNCTION siget\.detectar_anomalias\(\) RETURNS int.*?END \$\$;", SQL_SIN_COMENTARIOS, re.S).group(0)
    assert "jsonb_build_object('ventana_minutos', d.ventana_min, 'umbral', d.umbral, 'por_nombre'," in funcion
    for prohibido in ("e.detalle", "atributos", "cedula", "correo", "password", "hash"):
        assert prohibido not in funcion, prohibido


def test_app_role_solo_lee_y_cambia_los_cuatro_campos_de_la_revision():
    assert re.findall(r"GRANT\s+SELECT\s+ON\s+siget\.alerta_seguridad\s+TO\s+(\w+)", SQL_SIN_COMENTARIOS) == ["app_role", "auditor_role"]
    assert re.findall(r"GRANT\s+UPDATE\s*\(([^)]*)\)\s+ON\s+siget\.alerta_seguridad\s+TO\s+(\w+)", SQL_SIN_COMENTARIOS) == [("estado, revisada_por, revisada_en, nota", "app_role")]
    assert not re.search(r"GRANT[^;]*\b(INSERT|DELETE|TRUNCATE|ALL)\b", SQL_SIN_COMENTARIOS)
    assert not re.search(r"GRANT[^;]*SEQUENCE", SQL_SIN_COMENTARIOS)


def test_ningun_otro_rol_recibe_nada():
    revocados = {r.strip() for grupo in re.findall(r"REVOKE\s+ALL\s+ON\s+siget\.alerta_seguridad\s+FROM\s+([^;]*);", SQL_SIN_COMENTARIOS) for r in grupo.split(",")}
    assert revocados == {"PUBLIC", "pgadmin_lectura", "checkpoint_app", "escalador_role"}
    assert not re.search(r"GRANT[^;]*(pgadmin_lectura|checkpoint_app|escalador_role|PUBLIC)", SQL_SIN_COMENTARIOS)


def test_la_seguridad_por_filas_deja_ver_y_revisar_solo_al_operador_y_leer_al_auditor():
    assert "ALTER TABLE siget.alerta_seguridad ENABLE ROW LEVEL SECURITY;" in SQL_SIN_COMENTARIOS
    politicas = re.findall(r"CREATE POLICY (\w+) ON siget\.alerta_seguridad FOR (\w+) TO (\w+)\s+(.*?);", SQL_SIN_COMENTARIOS, re.S)
    assert [(p[0], p[1], p[2]) for p in politicas] == [("alerta_ver_operador", "SELECT", "app_role"), ("alerta_revisar_operador", "UPDATE", "app_role"),
                                                       ("alerta_ver_auditor", "SELECT", "auditor_role")]
    assert all("(SELECT siget.es_operador_seguridad(siget.ctx_usuario()))" in p[3] for p in politicas[:2])  # envuelto: se evalua una vez
    assert "WITH CHECK ((SELECT siget.es_operador_seguridad(siget.ctx_usuario())))" in politicas[1][3]
    assert "FORCE ROW LEVEL SECURITY" not in SQL_SIN_COMENTARIOS  # la funcion (dueño de la tabla) inserta por encima de las politicas


def test_el_disparador_de_revision_exige_nota_operador_y_una_sola_vez_y_fija_la_hora():
    funcion = re.search(r"CREATE FUNCTION siget\.alerta_valida_cambio\(\).*?END \$\$;", SQL_SIN_COMENTARIOS, re.S).group(0)
    assert "IF OLD.estado <> 'abierta' THEN" in funcion
    assert "length(btrim(NEW.nota)) < 3" in funcion
    assert "siget.es_operador_seguridad(NEW.revisada_por)" in funcion
    assert "siget.ctx_usuario() IS NOT NULL AND siget.ctx_usuario() <> NEW.revisada_por" in funcion
    assert "NEW.revisada_en := now();" in funcion
    assert re.search(r"CREATE TRIGGER alerta_valida_cambio BEFORE UPDATE ON siget\.alerta_seguridad\s+FOR EACH ROW", SQL_SIN_COMENTARIOS)
    assert re.search(r"CREATE TRIGGER alerta_sin_borrado BEFORE DELETE ON siget\.alerta_seguridad", SQL_SIN_COMENTARIOS)
    assert re.search(r"CREATE TRIGGER alerta_sin_truncate BEFORE TRUNCATE ON siget\.alerta_seguridad", SQL_SIN_COMENTARIOS)


def test_el_auxiliar_de_operador_es_security_definer_con_la_ruta_fija():
    funcion = re.search(r"CREATE FUNCTION siget\.es_operador_seguridad\(p_usuario int\).*?\$\$;", SQL_SIN_COMENTARIOS, re.S).group(0)
    assert "SECURITY DEFINER" in funcion and "SET search_path = siget, pg_temp" in funcion
    assert "u.rol_plataforma = 'operador_seguridad' AND u.estado_cuenta = 'activa'" in funcion
    assert re.findall(r"GRANT EXECUTE ON FUNCTION siget\.es_operador_seguridad\(int\) TO (\w+);", SQL_SIN_COMENTARIOS) == ["app_role"]


def test_hay_indices_para_los_filtros_por_tiempo_del_detector():
    assert "CREATE INDEX evento_seguridad_evento_creado_idx ON siget.evento_seguridad (evento, creado_en);" in SQL_SIN_COMENTARIOS
    assert "CREATE INDEX decision_pdp_negadas_idx ON siget.decision_pdp (creado_en) WHERE NOT permitido;" in SQL_SIN_COMENTARIOS


def test_las_pruebas_sql_prueban_los_dos_lados_de_cada_regla_y_no_dejan_nada():
    pruebas = PRUEBAS_SQL.read_text(encoding="utf-8")
    assert pruebas.strip().endswith("ROLLBACK;") and pruebas.count("BEGIN;") == 1
    assert "SET LOCAL ROLE detector_role;" in pruebas and "192.0.2." in pruebas
    assert "RESUMEN:" in pruebas
    assert len(re.findall(r"pg_temp\.r\(", pruebas)) >= 40
