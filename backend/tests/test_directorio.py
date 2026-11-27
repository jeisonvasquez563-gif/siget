"""Migración 023 (directorio de instituciones): lo que el archivo SQL siembra cumple las reglas del backend y de la base.

Sin base de datos: se lee el JSON de la migración y se pasa por las mismas funciones con las que la API valida un formulario, unos
requisitos y lo que responde la ciudadanía (`apps.tramites.formulario`, `apps.catalogo.gestion`). Lo que decide la base (disparadores,
CHECK) lo prueba `database/pruebas-directorio.sql`.
"""
import json
import pathlib
import re
from datetime import date

import pytest

from apps.catalogo import gestion
from apps.tramites import formulario as fm

RAIZ = pathlib.Path(__file__).resolve().parents[2]
SQL = (RAIZ / "database" / "migraciones" / "023-directorio-instituciones.sql").read_text(encoding="utf-8")
HOY = date(2026, 11, 26)

# (institución, nombre, plazo, formulario, requisitos) de cada trámite para la ciudadanía
TIPOS = [(i, n, int(s), json.loads(f), json.loads(r))
         for i, n, s, f, r in re.findall(r"\('([^']+)', '([^']+)', (\d+), \$f\$(.*?)\$f\$, \$r\$(.*?)\$r\$\)", SQL, re.S)]
NUEVAS = ["Registro Público de Panamá", "Ministerio de Comercio e Industrias (Panamá Emprende)", "ATTT", "MEDUCA", "IDAAN", "Municipio de San Miguelito"]
ANTIGUAS = ["MINSA", "MOP", "MiAmbiente"]
IDS = [f"{i} / {n}" for i, n, *_ in TIPOS]
PROHIBIDOS = {"cedula", "nombre", "apellidos", "apellido", "correo", "email", "telefono", "celular", "fecha_nacimiento"}
MAL_PEDIDO = ("cédula", "cedula", "correo", "teléfono", "telefono", "apellido")


def test_la_migracion_trae_los_tramites_de_las_nueve_instituciones():
    assert len(TIPOS) == 14
    por_institucion = {}
    for i, n, *_ in TIPOS:
        por_institucion.setdefault(i, []).append(n)
    assert set(por_institucion) == set(NUEVAS) | set(ANTIGUAS)
    assert all(1 <= len(v) <= 2 for v in por_institucion.values()), por_institucion
    assert all(len(v) == len(set(v)) for v in por_institucion.values())
    # las que ya existían reciben un solo trámite para la ciudadanía: los verificar_* y el ensayo piden «el» tipo de MINSA y MOP
    assert all(len(por_institucion[i]) == 1 for i in ANTIGUAS)


def test_las_instituciones_nuevas_son_reales_y_se_siembran_sin_duplicar():
    bloque = re.search(r"INSERT INTO siget\.institucion \(nombre, tipo\) VALUES(.*?)ON CONFLICT \(nombre\) DO NOTHING;", SQL, re.S).group(1)
    filas = re.findall(r"\('([^']+)',\s*'([^']+)'\)", bloque)
    assert [n for n, _ in filas] == NUEVAS
    assert {t for _, t in filas} == {"real"}


def test_ninguna_institucion_queda_ni_se_crea_como_demostracion():
    sin_comentarios = "\n".join(l for l in SQL.splitlines() if not l.lstrip().startswith("--"))
    assert "demostracion'" not in sin_comentarios.replace("'Trámite de demostración", "")
    assert re.search(r"UPDATE siget\.institucion SET tipo = 'real' WHERE nombre IN \('MINSA', 'MOP', 'MiAmbiente'\)", sin_comentarios)


def test_los_tramites_de_demostracion_se_desactivan_sin_renombrar_ni_borrar():
    sin_comentarios = "\n".join(l for l in SQL.splitlines() if not l.lstrip().startswith("--"))
    desactivar = re.search(r"UPDATE siget\.tipo_tramite SET activo = false\s+WHERE nombre IN \((.*?)\) AND activo;", sin_comentarios, re.S).group(1)
    assert re.findall(r"'([^']+)'", desactivar) == [f"Trámite de demostración ({i})" for i in ANTIGUAS]
    assert "DELETE" not in sin_comentarios.upper() and "SET nombre" not in sin_comentarios


@pytest.mark.parametrize("institucion,nombre,sla,formulario,requisitos", TIPOS, ids=IDS)
def test_cada_tramite_cumple_las_reglas_de_la_base_y_de_la_api(institucion, nombre, sla, formulario, requisitos):
    # base: nombre de 3 a 150, plazo de 1 a 365, formulario de hasta 30 campos con ids válidos (formulario_invalido de la 020)
    assert 3 <= len(nombre.strip()) <= 150 and 1 <= sla <= 365 and 1 <= len(formulario) <= 30
    assert all(re.fullmatch(r"[a-z][a-z0-9_]{0,39}", c["id"]) for c in formulario)
    assert {c["tipo"] for c in formulario} <= {"texto", "texto_largo", "numero", "fecha", "seleccion"}
    assert all(len(c["etiqueta"]) <= 120 and len(c.get("ayuda", "")) <= 300 for c in formulario)
    assert all(len(o) <= 120 and len(c["opciones"]) <= 30 for c in formulario if c["tipo"] == "seleccion" for o in c["opciones"])
    # API: la misma validación que usa la coordinación al guardar y la ciudadanía al responder
    assert fm.definicion_valida(formulario) == []
    limpio, errores = gestion.validar_formulario(formulario)
    assert errores == {} and [c["id"] for c in limpio] == [c["id"] for c in formulario]
    limpios, errores = gestion.validar_requisitos(requisitos)
    assert errores == {} and limpios == requisitos
    assert set(requisitos) == {"descripcion", "documentos", "despues"} and requisitos["documentos"]
    ejemplo = fm.datos_de_ejemplo(formulario)
    assert fm.validar_datos(formulario, ejemplo, hoy=HOY)[1] == {}
    # minimización de datos (Ley 81): la identidad y el contacto ya están en el perfil
    assert not {c["id"] for c in formulario} & PROHIBIDOS
    assert not [c["etiqueta"] for c in formulario if any(p in c["etiqueta"].lower() for p in MAL_PEDIDO)]


def test_el_tramite_del_mop_conserva_asunto_y_descripcion_como_el_de_demostracion():
    mop = next(f for i, _, _, f, _ in TIPOS if i == "MOP")
    campos = {c["id"]: c for c in mop}
    assert list(campos)[:2] == ["asunto", "descripcion"]
    assert campos["asunto"]["obligatorio"] is True and campos["asunto"]["max"] == 150
    assert campos["descripcion"]["obligatorio"] is False and campos["descripcion"]["max"] == 2000
    assert [c["id"] for c in mop if c["obligatorio"]] == ["asunto"]
    assert fm.validar_datos(mop, {"asunto": "  Bache frente a la escuela  ", "descripcion": "Hace tres semanas que el hueco crece."}, hoy=HOY)[1] == {}


def test_cada_institucion_nueva_recibe_su_solicitud_interinstitucional_como_la_012():
    bloque = SQL[SQL.index("5. «Solicitud interinstitucional"):]
    assert "'Solicitud interinstitucional de información', 5, 'institucion'" in bloque
    nombres = re.findall(r"'([^']+)'", re.search(r"WHERE i\.nombre IN \((.*?)\)\s*ON CONFLICT", bloque, re.S).group(1))
    assert nombres == NUEVAS
    formulario = json.loads(re.search(r"\$f\$(.*?)\$f\$", bloque, re.S).group(1))
    requisitos = json.loads(re.search(r"\$r\$(.*?)\$r\$", bloque, re.S).group(1))
    assert fm.definicion_valida(formulario) == [] and gestion.validar_formulario(formulario)[1] == {}
    assert gestion.validar_requisitos(requisitos) == (requisitos, {})
    # el mismo formulario y los mismos requisitos que sembraron la 017 y la 021
    f017 = (RAIZ / "database" / "migraciones" / "017-contenido-tramite.sql").read_text(encoding="utf-8")
    r021 = (RAIZ / "database" / "migraciones" / "021-tramites-ciudadania.sql").read_text(encoding="utf-8")
    assert formulario == json.loads(re.search(r"SET formulario = '(\[[^']*\])'::jsonb WHERE nombre = 'Solicitud interinstitucional de información'", f017).group(1))
    assert requisitos == json.loads(re.search(r"SET requisitos = '(\{[^']*\})'::jsonb WHERE nombre = 'Solicitud interinstitucional de información'", r021).group(1))


def test_el_encabezado_dice_que_el_contenido_es_ilustrativo_y_lo_valida_cada_institucion():
    encabezado = SQL[:SQL.index("BEGIN;")]
    assert "ILUSTRATIVOS" in encabezado and "coordinacion" in encabezado and "NO la normativa vigente" in encabezado


def test_la_migracion_es_una_transaccion_del_duenio_y_no_toca_los_tramites_ni_la_estructura():
    assert SQL.count("BEGIN;") == 1 and SQL.rstrip().endswith("COMMIT;") and "SET LOCAL ROLE siget_owner;" in SQL
    sin_comentarios = "\n".join(l for l in SQL.splitlines() if not l.lstrip().startswith("--"))
    assert not re.search(r"\b(ALTER|DROP|CREATE|TRUNCATE|DELETE)\b", sin_comentarios)
    assert "siget.tramite " not in sin_comentarios and "INSERT INTO siget.tramite" not in sin_comentarios
    assert sin_comentarios.count("ON CONFLICT (institucion_id, nombre) DO NOTHING") == 2
