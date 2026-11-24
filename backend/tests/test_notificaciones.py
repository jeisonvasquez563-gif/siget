"""Notificaciones dentro de la plataforma (PT-9): regla del PDP, matriz, simulador, salida de la API, vistas y migración 018.

Sin base de datos: que cada transición genere la notificación correcta y que la base filtre y proteja las filas lo recorren
`verificar_tramites` (por la API) y `database/pruebas-notificaciones.sql` (en la base, incluido `escalar_vencidos()`).
"""
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest
from django.urls import get_resolver, reverse
from rest_framework.test import APIRequestFactory, force_authenticate

from apps.autorizacion import matriz, simulador
from apps.autorizacion.pdp import Accion, Entorno, Recurso, Sujeto, decidir
from apps.nucleo.errores import AccesoDenegado
from apps.notificaciones import vistas
from apps.notificaciones.models import TIPOS, Notificacion
from apps.notificaciones.serializacion import notificacion_a_dict

AHORA = datetime(2026, 11, 24, 12, 0, tzinfo=timezone.utc)
ROLES = [r[0] for r in matriz.ROLES]
MIGRACION = Path(__file__).resolve().parents[2] / "database" / "migraciones" / "018-notificaciones.sql"


# --------------------------------------------------------------------------- PDP

def sujeto(id=10, minutos=None, **kw):
    return Sujeto(id=id, mfa_verificado_en=None if minutos is None else AHORA - timedelta(minutes=minutos), **kw)


def decide(s, r):
    return decidir(s, Accion.VER_MIS_NOTIFICACIONES, r, Entorno(ahora=AHORA))


def propias(de=10):
    return Recurso(tipo="notificacion", solicitante_id=de)


def test_la_persona_ve_sus_notificaciones_aun_sin_segundo_factor_reciente():
    for minutos in (None, 1, 600):
        d = decide(sujeto(minutos=minutos), propias())
        assert d.permitido and d.politica == "titular_ve_sus_notificaciones"


def test_no_las_de_otra_persona():
    d = decide(sujeto(), propias(de=11))
    assert not d.permitido and d.politica == "sin_regla_que_permita"


@pytest.mark.parametrize("rol", ["operador_infraestructura", "operador_identidades", "operador_catalogo", "operador_seguridad", "custodio_secretos", "auditor"])
def test_las_cuentas_de_plataforma_tambien_tienen_las_suyas(rol):
    assert decide(sujeto(rol_plataforma=rol), propias()).permitido


@pytest.mark.parametrize("rol", ["funcionario", "supervisor", "coordinador_institucional"])
def test_el_personal_tambien_tiene_las_suyas(rol):
    assert decide(sujeto(membresias=frozenset({(3, rol)})), propias()).permitido


def test_una_cuenta_bloqueada_o_suspendida_no_las_ve():
    for estado in ("bloqueada", "suspendida"):
        d = decide(sujeto(estado_cuenta=estado), propias())
        assert not d.permitido and d.politica == "cuenta_no_activa"


def test_otro_tipo_de_recurso_no_sirve():
    for tipo in ("tramite", "perfil", "cuenta", "plataforma"):
        assert not decide(sujeto(), Recurso(tipo=tipo, solicitante_id=10)).permitido


def test_la_regla_no_da_nada_mas_que_ver_las_notificaciones():
    for accion in Accion:
        if accion != Accion.VER_MIS_NOTIFICACIONES:
            assert decidir(sujeto(), accion, propias(), Entorno(ahora=AHORA)).politica != "titular_ve_sus_notificaciones", accion


# --------------------------------------------------------------------------- matriz y simulador

def test_la_matriz_la_calcula_para_los_diez_roles_sin_exigir_segundo_factor():
    M = matriz.construir()
    assert len(M["acciones"]) == len(Accion) == 28
    for rol in ROLES:
        celda = M["matriz"][rol]["ver_mis_notificaciones"]
        assert celda["favorable"]["permitido"] and celda["favorable"]["politica"] == "titular_ve_sus_notificaciones"
        assert not celda["desfavorable"]["permitido"] and celda["exige_segundo_factor"] is False, rol
    assert next(a for a in M["acciones"] if a["id"] == "ver_mis_notificaciones")["grupo"] == "Cuenta"
    assert M["ningun_rol_puede_todo"] is True


def test_el_simulador_la_conoce_y_explica_el_resultado():
    meta = simulador.meta()
    assert len(meta["variables"]) == 28 and "notificaciones_de" in meta["variables"]["ver_mis_notificaciones"]
    assert "notificaciones_de" in meta["valores"] and meta["defectos"]["notificaciones_de"] == "yo"
    ok = simulador.simular(simulador.normalizar({"rol": "auditor", "accion": "ver_mis_notificaciones", "segundo_factor": "ninguno"})[0], AHORA)
    assert ok["decision"]["permitido"] and ok["decision"]["politica"] == "titular_ve_sus_notificaciones"
    ajeno = simulador.simular(simulador.normalizar({"rol": "ciudadano", "accion": "ver_mis_notificaciones", "notificaciones_de": "otra_persona"})[0], AHORA)
    assert not ajeno["decision"]["permitido"]
    assert {"variable": "notificaciones_de", "valor": "yo"}.items() <= next(a for a in ajeno["alternativas"] if a["variable"] == "notificaciones_de").items()
    assert simulador.normalizar({"rol": "ciudadano", "accion": "ver_mis_notificaciones", "notificaciones_de": "todas"})[0] is None


# --------------------------------------------------------------------------- modelo y salida

def una_notificacion(**kw):
    base = dict(pk=5, tipo="subsanacion_pedida", tramite_id=9, creada_en=AHORA, leida_en=None)
    base.update(kw)
    return SimpleNamespace(**base)


def un_tramite():
    return SimpleNamespace(pk=9, tipo_tramite=SimpleNamespace(nombre="Permiso de Construcción Municipal"), institucion=SimpleNamespace(nombre="MOP"),
                           solicitante_id=77, funcionario_asignado_id=88, datos={"asunto": "x"})


def test_la_salida_lleva_solo_lo_que_la_persona_ya_ve_del_tramite():
    d = notificacion_a_dict(una_notificacion(), un_tramite())
    assert d == {"id": 5, "tipo": "subsanacion_pedida", "tramite_id": 9, "creada_en": AHORA.isoformat(), "leida": False,
                 "tramite": {"tipo_tramite": "Permiso de Construcción Municipal", "institucion": "MOP"}}
    assert "datos" not in str(d) and "77" not in str(d) and "88" not in str(d)


def test_si_la_base_ya_no_le_muestra_el_tramite_no_se_revela_nada_de_el():
    d = notificacion_a_dict(una_notificacion(), None)
    assert d["tramite"] is None and d["tramite_id"] == 9


def test_leida_depende_de_la_fecha_de_lectura():
    assert notificacion_a_dict(una_notificacion(leida_en=AHORA), None)["leida"] is True


def test_los_tipos_del_modelo_son_los_seis_de_la_base():
    assert {t[0] for t in TIPOS} == {"tramite_en_atencion", "subsanacion_pedida", "tramite_aprobado", "tramite_rechazado",
                                     "subsanacion_respondida", "tramite_escalado"}


def test_el_orm_no_crea_ni_modifica_ni_borra_notificaciones():
    n = Notificacion(usuario_id=1, tipo="tramite_aprobado", tramite_id=1, creada_en=AHORA)
    with pytest.raises(PermissionError):
        n.save()
    with pytest.raises(PermissionError):
        n.delete()


# --------------------------------------------------------------------------- rutas

def test_las_rutas_se_resuelven():
    assert reverse("notificaciones") == "/notificaciones/"
    assert reverse("notificaciones-leer-todas") == "/notificaciones/leer-todas/"
    assert reverse("notificacion-leida", kwargs={"pk": 5}) == "/notificaciones/5/leida/"


def test_las_vistas_corren_en_una_transaccion_por_la_seguridad_por_filas():
    for clase in (vistas.NotificacionesColeccion, vistas.NotificacionLeida, vistas.NotificacionesLeerTodas):
        assert not getattr(clase.as_view(), "_non_atomic_requests", None), clase.__name__


def test_ninguna_ruta_recibe_el_identificador_de_otra_persona():
    internas = [str(p.pattern) for r in get_resolver().url_patterns if "notificaciones" in str(r.pattern) for p in r.url_patterns]
    assert sorted(internas) == ["", "<int:pk>/leida/", "leer-todas/"]


# --------------------------------------------------------------------------- vistas (con una base simulada)

class Consulta:
    """Lo mínimo del QuerySet que usan las vistas, sobre filas en memoria."""

    def __init__(self, filas):
        self.filas = list(filas)

    def order_by(self, *campos):
        return Consulta(sorted(self.filas, key=lambda f: (f.creada_en, f.pk), reverse=True))

    def select_related(self, *campos):
        return self

    def filter(self, **filtros):
        filas = self.filas
        if filtros.get("leida_en__isnull") is True:
            filas = [f for f in filas if f.leida_en is None]
        if "pk" in filtros:
            filas = [f for f in filas if f.pk == filtros["pk"]]
        if "pk__in" in filtros:
            filas = [f for f in filas if f.pk in filtros["pk__in"]]
        return Consulta(filas)

    def first(self):
        return self.filas[0] if self.filas else None

    def count(self):
        return len(self.filas)

    def __getitem__(self, corte):
        return self.filas[corte]

    def __iter__(self):
        return iter(self.filas)

    def update(self, **cambios):
        for f in self.filas:
            for k, v in cambios.items():
                setattr(f, k, v)
        return len(self.filas)


@pytest.fixture
def base(monkeypatch):
    """Tres notificaciones de la persona 7 (una ya leída) y un trámite visible; el resto de la base no existe para ella (la RLS lo filtra)."""
    contexto, decisiones = [], []
    filas = [una_notificacion(pk=1, tipo="tramite_en_atencion", creada_en=AHORA - timedelta(hours=3), leida_en=AHORA - timedelta(hours=2)),
             una_notificacion(pk=2, tipo="subsanacion_pedida", creada_en=AHORA - timedelta(hours=1)),
             una_notificacion(pk=3, tipo="tramite_aprobado", tramite_id=10, creada_en=AHORA)]
    monkeypatch.setattr("rest_framework.throttling.ScopedRateThrottle.allow_request", lambda self, request, view: True)
    monkeypatch.setattr(vistas, "Notificacion", SimpleNamespace(objects=Consulta(filas)))
    monkeypatch.setattr(vistas, "Tramite", SimpleNamespace(objects=Consulta([un_tramite()])))
    monkeypatch.setattr(vistas, "_membresias", lambda usuario: [SimpleNamespace(institucion_id=3, rol="funcionario"),
                                                                SimpleNamespace(institucion_id=4, rol="coordinador_institucional")])
    monkeypatch.setattr(vistas, "fijar_contexto", lambda usuario_id, instituciones: contexto.append((usuario_id, list(instituciones))))
    monkeypatch.setattr(vistas, "autorizar", lambda request, accion, recurso: decisiones.append((accion, recurso)))
    return SimpleNamespace(filas=filas, contexto=contexto, decisiones=decisiones)


def llamar(vista, metodo, ruta="/x/", kwargs=None, scope="completo"):
    peticion = getattr(APIRequestFactory(), metodo)(ruta, format="json", secure=True, HTTP_X_REAL_IP="198.51.100.9")
    principal = SimpleNamespace(usuario=SimpleNamespace(pk=7), claims=SimpleNamespace(scope=scope), is_authenticated=True, pk=7)
    force_authenticate(peticion, user=principal)
    return vista.as_view()(peticion, **(kwargs or {}))


def test_la_lista_trae_las_mas_recientes_primero_con_el_total_y_las_no_leidas(base):
    r = llamar(vistas.NotificacionesColeccion, "get")
    assert r.status_code == 200 and [n["id"] for n in r.data["resultados"]] == [3, 2, 1]
    assert r.data["total"] == 3 and r.data["no_leidas"] == 2 and r.data["limite"] == 20 and r.data["desplazamiento"] == 0
    assert [n["leida"] for n in r.data["resultados"]] == [False, False, True]
    assert r["Cache-Control"] == "no-store"


def test_el_contexto_y_el_pdp_son_los_de_la_propia_persona(base):
    llamar(vistas.NotificacionesColeccion, "get")
    assert base.contexto == [(7, [3])]  # solo cuentan las instituciones donde atiende trámites
    accion, recurso = base.decisiones[0]
    assert accion == Accion.VER_MIS_NOTIFICACIONES and recurso.tipo == "notificacion" and recurso.solicitante_id == 7


def test_el_tramite_que_la_persona_no_ve_sale_sin_detalle(base):
    r = llamar(vistas.NotificacionesColeccion, "get")
    por_id = {n["id"]: n for n in r.data["resultados"]}
    assert por_id[2]["tramite"] == {"tipo_tramite": "Permiso de Construcción Municipal", "institucion": "MOP"}
    assert por_id[3]["tramite"] is None and por_id[3]["tramite_id"] == 10


def test_solo_no_leidas_y_paginacion(base):
    r = llamar(vistas.NotificacionesColeccion, "get", "/x/?solo_no_leidas=1&limite=1&desplazamiento=1")
    assert [n["id"] for n in r.data["resultados"]] == [2] and r.data["total"] == 2 and r.data["no_leidas"] == 2


@pytest.mark.parametrize("consulta", ["limite=0", "limite=101", "limite=abc", "desplazamiento=-1", "desplazamiento=99999999"])
def test_una_paginacion_invalida_da_400(base, consulta):
    r = llamar(vistas.NotificacionesColeccion, "get", f"/x/?{consulta}")
    assert r.status_code == 400 and r.data["codigo"] == "paginacion_invalida"


@pytest.mark.parametrize("valor", ["0", "true", "2", ""])
def test_un_filtro_invalido_da_400(base, valor):
    r = llamar(vistas.NotificacionesColeccion, "get", f"/x/?solo_no_leidas={valor}")
    assert r.status_code == 400 and r.data["codigo"] == "filtro_invalido"


def test_marcar_una_como_leida_devuelve_las_que_quedan(base):
    r = llamar(vistas.NotificacionLeida, "post", kwargs={"pk": 2})
    assert r.status_code == 200 and r.data == {"id": 2, "leida": True, "no_leidas": 1}
    assert base.filas[1].leida_en is not None and base.filas[2].leida_en is None


def test_marcar_una_ya_leida_no_escribe_nada_y_responde_igual(base):
    antes = base.filas[0].leida_en
    r = llamar(vistas.NotificacionLeida, "post", kwargs={"pk": 1})
    assert r.status_code == 200 and r.data["leida"] is True and base.filas[0].leida_en == antes


@pytest.mark.parametrize("pk", [99, 0])
def test_lo_ajeno_o_inexistente_da_404(base, pk):
    r = llamar(vistas.NotificacionLeida, "post", kwargs={"pk": pk})
    assert r.status_code == 404 and base.filas[1].leida_en is None and base.filas[2].leida_en is None


def test_leer_todas_marca_solo_las_no_leidas(base):
    r = llamar(vistas.NotificacionesLeerTodas, "post")
    assert r.status_code == 200 and r.data == {"marcadas": 2, "no_leidas": 0}
    assert all(f.leida_en is not None for f in base.filas)


def test_si_el_pdp_niega_no_se_toca_nada(base, monkeypatch):
    def negar(request, accion, recurso):
        raise AccesoDenegado({"codigo": "acceso_denegado", "detalle": "No tienes autorización para esta operación.", "reautenticacion_sugerida": False})
    monkeypatch.setattr(vistas, "autorizar", negar)
    for vista, metodo, kw in ((vistas.NotificacionesColeccion, "get", None), (vistas.NotificacionLeida, "post", {"pk": 2}), (vistas.NotificacionesLeerTodas, "post", None)):
        assert llamar(vista, metodo, kwargs=kw).status_code == 403
    assert base.filas[1].leida_en is None and base.filas[2].leida_en is None


def test_un_token_de_enrolamiento_no_sirve(base):
    for vista, metodo, kw in ((vistas.NotificacionesColeccion, "get", None), (vistas.NotificacionLeida, "post", {"pk": 2}), (vistas.NotificacionesLeerTodas, "post", None)):
        assert llamar(vista, metodo, kwargs=kw, scope="enrolar_mfa").status_code == 403


# --------------------------------------------------------------------------- migración 018

SQL = MIGRACION.read_text(encoding="utf-8")
SQL_SIN_COMENTARIOS = "\n".join(linea.split("--")[0] for linea in SQL.splitlines())


def test_la_migracion_va_en_una_transaccion_como_el_dueno_de_los_objetos():
    assert SQL_SIN_COMENTARIOS.strip().startswith("BEGIN;") and SQL_SIN_COMENTARIOS.strip().endswith("COMMIT;")
    assert "SET LOCAL ROLE siget_owner;" in SQL_SIN_COMENTARIOS


def test_la_tabla_no_lleva_texto_libre_y_el_tipo_es_una_lista_cerrada():
    tabla = re.search(r"CREATE TABLE siget\.notificacion \((.*?)\n\);", SQL_SIN_COMENTARIOS, re.S).group(1)
    columnas = re.findall(r"^\s{2}(\w+)\s", tabla, re.M)
    assert columnas == ["id", "usuario_id", "tipo", "tramite_id", "creada_en", "leida_en"]
    assert set(re.findall(r"'(\w+)'", re.search(r"CHECK \(tipo IN \((.*?)\)\)", tabla, re.S).group(1))) == {t[0] for t in TIPOS}
    assert "tramite_id  bigint NOT NULL REFERENCES siget.tramite(id)" in tabla


def test_app_role_solo_lee_y_marca_como_leida():
    assert re.findall(r"GRANT\s+SELECT\s+ON\s+siget\.notificacion\s+TO\s+(\w+)", SQL_SIN_COMENTARIOS) == ["app_role"]
    assert re.findall(r"GRANT\s+UPDATE\s*\(([^)]*)\)\s+ON\s+siget\.notificacion\s+TO\s+(\w+)", SQL_SIN_COMENTARIOS) == [("leida_en", "app_role")]
    assert not re.search(r"GRANT[^;]*\b(INSERT|DELETE|TRUNCATE|ALL)\b", SQL_SIN_COMENTARIOS)
    assert not re.search(r"GRANT[^;]*SEQUENCE", SQL_SIN_COMENTARIOS)


def test_ningun_otro_rol_recibe_nada():
    revocados = {r.strip() for grupo in re.findall(r"REVOKE\s+ALL\s+ON\s+siget\.notificacion\s+FROM\s+([^;]*);", SQL_SIN_COMENTARIOS) for r in grupo.split(",")}
    assert revocados == {"PUBLIC", "pgadmin_lectura", "auditor_role", "checkpoint_app", "escalador_role"}
    assert not re.search(r"GRANT[^;]*(auditor_role|pgadmin_lectura|checkpoint_app|escalador_role|PUBLIC)", SQL_SIN_COMENTARIOS)


def test_la_seguridad_por_filas_limita_cada_politica_a_la_propia_persona():
    assert "ALTER TABLE siget.notificacion ENABLE ROW LEVEL SECURITY;" in SQL_SIN_COMENTARIOS
    politicas = re.findall(r"CREATE POLICY (\w+) ON siget\.notificacion FOR (\w+) TO app_role\s+(.*?);", SQL_SIN_COMENTARIOS, re.S)
    assert [(p[0], p[1]) for p in politicas] == [("notificacion_ver", "SELECT"), ("notificacion_marcar", "UPDATE")]
    assert all("usuario_id = siget.ctx_usuario()" in p[2] for p in politicas)
    assert "WITH CHECK (usuario_id = siget.ctx_usuario())" in politicas[1][2]
    assert "FORCE ROW LEVEL SECURITY" not in SQL_SIN_COMENTARIOS  # el disparador (dueño de la tabla) inserta por encima de la política


def test_el_disparador_que_genera_es_security_definer_con_la_ruta_de_busqueda_fija():
    funcion = re.search(r"CREATE FUNCTION siget\.generar_notificaciones\(\).*?\$\$;", SQL_SIN_COMENTARIOS, re.S).group(0)
    assert "SECURITY DEFINER" in funcion and "SET search_path = siget, pg_temp" in funcion
    assert re.search(r"CREATE TRIGGER \w+ AFTER UPDATE OF estado, escalado_en ON siget\.tramite\s+FOR EACH ROW", SQL_SIN_COMENTARIOS)
    assert "REVOKE ALL ON FUNCTION siget.generar_notificaciones() FROM PUBLIC;" in SQL_SIN_COMENTARIOS


def test_el_disparador_cubre_las_seis_notificaciones_y_no_avisa_al_actor():
    funcion = re.search(r"CREATE FUNCTION siget\.generar_notificaciones\(\).*?\$\$;", SQL_SIN_COMENTARIOS, re.S).group(0)
    for tipo in (t[0] for t in TIPOS):
        assert f"'{tipo}'" in funcion, tipo
    assert "NEW.solicitante_id IS DISTINCT FROM v_actor" in funcion       # al solicitante, salvo que él cambie el trámite
    assert "v_actor = NEW.solicitante_id" in funcion                      # al asignado, solo si responde el solicitante
    assert "m.usuario_id IS DISTINCT FROM v_actor" in funcion             # a la supervisión, salvo el propio actor
    assert "m.rol = 'supervisor'" in funcion and "m.revocada_en IS NULL" in funcion
    assert "OLD.escalado_en IS NULL AND NEW.escalado_en IS NOT NULL" in funcion


def test_la_lectura_solo_pasa_de_nulo_a_un_valor_que_fija_la_base():
    funcion = re.search(r"CREATE FUNCTION siget\.notificacion_solo_marca_leida\(\).*?\$\$;", SQL_SIN_COMENTARIOS, re.S).group(0)
    assert "NEW.leida_en := now();" in funcion and "no se desmarca ni se vuelve a marcar" in funcion
    assert re.search(r"CREATE TRIGGER \w+ BEFORE UPDATE ON siget\.notificacion\s+FOR EACH ROW", SQL_SIN_COMENTARIOS)
