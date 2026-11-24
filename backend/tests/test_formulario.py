"""Validación del contenido de un trámite: pura, sin base de datos. Incluye entradas hostiles y la definición real de la migración 017."""
import json
import pathlib
import re
from datetime import date

import pytest

from apps.tramites import formulario as f

HOY = date(2026, 11, 24)

PERMISO = [
    {"id": "direccion_terreno", "etiqueta": "Dirección", "tipo": "texto", "obligatorio": True, "max": 200},
    {"id": "numero_finca", "etiqueta": "Finca", "tipo": "texto", "obligatorio": True, "max": 40},
    {"id": "tipo_obra", "etiqueta": "Tipo", "tipo": "seleccion", "obligatorio": True, "opciones": ["Obra nueva", "Ampliación"]},
    {"id": "area_m2", "etiqueta": "Área", "tipo": "numero", "obligatorio": True, "max": 100000},
    {"id": "descripcion", "etiqueta": "Descripción", "tipo": "texto_largo", "obligatorio": False, "max": 2000},
    {"id": "fecha_hechos", "etiqueta": "Fecha", "tipo": "fecha", "obligatorio": False},
    {"id": "empleados", "etiqueta": "Empleados", "tipo": "numero", "obligatorio": False, "max": 10000, "entero": True},
]
VALIDO = {"direccion_terreno": "Calle 5", "numero_finca": "123", "tipo_obra": "Obra nueva", "area_m2": 120.5}


def validar(datos, formulario=PERMISO):
    return f.validar_datos(formulario, datos, hoy=HOY)


def con(**cambios):
    return {**VALIDO, **cambios}


def test_un_contenido_valido_se_acepta_y_se_normaliza():
    limpios, errores = validar(con(direccion_terreno="  Calle 5  ", descripcion="línea 1\r\nlínea 2", fecha_hechos="2026-11-24", area_m2=100.0))
    assert errores == {}
    assert limpios == {"direccion_terreno": "Calle 5", "numero_finca": "123", "tipo_obra": "Obra nueva", "area_m2": 100,
                       "descripcion": "línea 1\nlínea 2", "fecha_hechos": "2026-11-24"}
    assert isinstance(limpios["area_m2"], int)


def test_los_opcionales_vacios_no_se_guardan():
    limpios, errores = validar(con(descripcion="   ", fecha_hechos=None, empleados=None))
    assert errores == {} and set(limpios) == set(VALIDO)


def test_los_obligatorios_faltantes_o_vacios_se_reportan_por_campo():
    limpios, errores = validar({"direccion_terreno": "   ", "numero_finca": None})
    assert limpios is None
    assert set(errores) == {"direccion_terreno", "numero_finca", "tipo_obra", "area_m2"}


def test_los_campos_desconocidos_se_rechazan_sin_repetirlos():
    limpios, errores = validar(con(cedula="8-123-456", **{"<script>": 1}))
    assert limpios is None and errores == {"datos": "Hay campos que este trámite no tiene."}
    assert "cedula" not in json.dumps(errores) and "script" not in json.dumps(errores)


@pytest.mark.parametrize("malo", [None, [], [1], "texto", 5, True, [VALIDO]])
def test_los_datos_deben_ser_un_objeto(malo):
    limpios, errores = validar(malo)
    assert limpios is None and "datos" in errores


@pytest.mark.parametrize("valor", [5, 5.5, True, None, ["a"], {"a": 1}, b"x"])
def test_un_texto_exige_texto(valor):
    _, errores = validar(con(direccion_terreno=valor))
    assert "direccion_terreno" in errores


def test_el_largo_maximo_se_respeta_en_el_limite():
    assert validar(con(numero_finca="x" * 40))[1] == {}
    assert "numero_finca" in validar(con(numero_finca="x" * 41))[1]
    assert "numero_finca" in validar(con(numero_finca="x" * 10_000_000))[1]


def test_el_largo_cuenta_despues_de_quitar_los_espacios():
    assert validar(con(numero_finca="  " + "x" * 40 + "  "))[1] == {}


@pytest.mark.parametrize("hostil", ["a\x00b", "a\x1bb", "a\x7fb", "a\u202eb", "a\ufeffb", "a\u2028b", "a\ud800b", "ab", "a\nb", "a\tb"])
def test_un_texto_de_una_linea_rechaza_caracteres_de_control_y_formato(hostil):
    _, errores = validar(con(direccion_terreno=hostil))
    assert "direccion_terreno" in errores


@pytest.mark.parametrize("hostil", ["a\x00b", "a\x1bb", "a\u202eb", "a\ufeffb", "a\u2028b"])
def test_un_texto_largo_rechaza_control_y_formato_pero_admite_saltos(hostil):
    assert "descripcion" in validar(con(descripcion=hostil))[1]
    assert validar(con(descripcion="uno\ndos\n\ttres"))[1] == {}


@pytest.mark.parametrize("invisible", ["‍", "‌‍‌", "‍" * 20])
def test_un_obligatorio_de_solo_caracteres_invisibles_no_vale(invisible):
    _, errores = validar(con(direccion_terreno=invisible))
    assert list(errores) == ["direccion_terreno"]


@pytest.mark.parametrize("sin_contenido", ["?!?", "---", "‍?‍", "👨‍👩‍👧"])
def test_un_obligatorio_sin_letras_ni_numeros_no_vale(sin_contenido):
    assert "direccion_terreno" in validar(con(direccion_terreno=sin_contenido))[1]


@pytest.mark.parametrize("valido", ["5", "Ａ", "ñ", "Calle 5", "‍A‍"])
def test_basta_una_letra_o_un_numero_en_cualquier_alfabeto(valido):
    assert validar(con(direccion_terreno=valido))[1] == {}


def test_un_opcional_con_solo_signos_se_conserva_pero_el_obligatorio_no():
    limpios, errores = validar(con(descripcion="???"))
    assert errores == {} and limpios["descripcion"] == "???"


@pytest.mark.parametrize("texto", ["‍" * 12, "‌" * 12, "‍‌" * 6, "?" * 12, "." * 12])
def test_el_texto_libre_exige_una_letra_o_un_numero(texto):
    assert f.validar_texto_libre(texto, 10, 2000)[0] is None


def test_el_minimo_del_texto_libre_se_cuenta_sobre_texto_con_contenido_real():
    # 5 letras + 10 invisibles: 15 caracteres en total pero solo 5 de verdad
    assert f.validar_texto_libre("ab‍cd‍" + "‍" * 8 + "e", 10, 2000) == (None, "Debe tener al menos 10 caracteres.")
    assert f.validar_texto_libre("Falta el plano.", 10, 2000) == ("Falta el plano.", None)
    assert f.validar_texto_libre("1234567890", 10, 2000)[1] is None


def test_el_texto_libre_admite_saltos_y_unicode_normal():
    assert f.validar_texto_libre("Línea uno\nLínea dos\n\tcon sangría", 10, 2000)[1] is None


def test_los_emojis_y_el_unicode_normal_se_admiten():
    limpios, errores = validar(con(direccion_terreno="Calle ñandú 5 – 👨‍👩‍👧 ✓", numero_finca="Ａ１"))
    assert errores == {} and limpios["direccion_terreno"].startswith("Calle ñandú")


def test_el_texto_se_normaliza_a_nfc():
    limpios, _ = validar(con(direccion_terreno="Café"))
    assert limpios["direccion_terreno"] == "Café"


@pytest.mark.parametrize("valor", [0, 1, 120, 120.5, 100000, 100000.0])
def test_numeros_validos(valor):
    assert validar(con(area_m2=valor))[1] == {}


@pytest.mark.parametrize("valor", [-1, -0.01, 100000.01, 100001, 10**30, "12", "", True, False, [], {}, float("nan"), float("inf"), float("-inf")])
def test_numeros_invalidos(valor):
    _, errores = validar(con(area_m2=valor))
    assert "area_m2" in errores


def test_un_booleano_no_es_un_numero_ni_siquiera_el_cero():
    assert "area_m2" in validar(con(area_m2=False))[1]
    assert "empleados" in validar(con(empleados=True))[1]


def test_un_campo_entero_rechaza_decimales():
    assert validar(con(empleados=12))[1] == {} and validar(con(empleados=12.0))[1] == {}
    assert "empleados" in validar(con(empleados=12.5))[1]


@pytest.mark.parametrize("valor", ["2026-11-24", "2026-01-01", "1900-01-01", " 2000-02-29 "])
def test_fechas_validas(valor):
    assert validar(con(fecha_hechos=valor))[1] == {}


@pytest.mark.parametrize("valor", ["2026-11-25", "2999-01-01", "2026-02-30", "2026-13-01", "2025-02-29", "1899-12-31", "0001-01-01", "24-11-2026",
                                   "2026/11/24", "20261124", "2026-1-5", "２０２６-１１-２４", "2026-11-24T10:00:00", "hoy", "", 20261124, True, ["2026-11-24"], {"a": 1}])
def test_fechas_invalidas_o_futuras(valor):
    limpios, errores = validar(con(fecha_hechos=valor))
    # la cadena vacía cuenta como ausente (es opcional): solo se rechaza si no está vacía
    if valor == "":
        assert errores == {}
    else:
        assert "fecha_hechos" in errores and limpios is None


def test_la_fecha_futura_depende_de_hoy():
    assert validar(con(fecha_hechos="2026-11-24"))[1] == {}
    assert "fecha_hechos" in validar(con(fecha_hechos="2026-11-25"))[1]


@pytest.mark.parametrize("valor", ["Obra nueva", " Ampliación "])
def test_opciones_validas(valor):
    assert validar(con(tipo_obra=valor))[1] == {}


@pytest.mark.parametrize("valor", ["obra nueva", "Demolición", "Obra  nueva", "", 1, True, ["Obra nueva"], {"x": 1}, "Obra nueva\x00"])
def test_opciones_fuera_de_la_lista(valor):
    assert "tipo_obra" in validar(con(tipo_obra=valor))[1]


def test_varios_errores_se_devuelven_juntos():
    _, errores = validar(con(direccion_terreno=5, area_m2=-1, tipo_obra="x"))
    assert set(errores) == {"direccion_terreno", "area_m2", "tipo_obra"}


def test_el_contenido_total_no_puede_pasar_del_tope_de_python_que_deja_margen_bajo_los_16_kb_de_la_base():
    grande = [{"id": f"c{i}", "etiqueta": "c", "tipo": "texto_largo", "obligatorio": True, "max": 3000} for i in range(6)]
    datos = {f"c{i}": "ñ" * 3000 for i in range(6)}  # 36 000 bytes
    limpios, errores = f.validar_datos(grande, datos, hoy=HOY)
    assert limpios is None and errores == {"datos": "El contenido es demasiado grande."}


def test_un_formulario_vacio_solo_acepta_un_objeto_vacio():
    assert f.validar_datos([], {}, hoy=HOY) == ({}, {})
    assert f.validar_datos([], {"x": 1}, hoy=HOY)[0] is None


def test_un_formulario_mal_definido_es_un_error_de_configuracion():
    with pytest.raises(f.FormularioMalDefinido):
        f.validar_datos([{"id": "a", "tipo": "raro", "etiqueta": "a", "obligatorio": True}], {}, hoy=HOY)
    assert issubclass(f.FormularioMalDefinido, ValueError)


@pytest.mark.parametrize("campo,fragmento", [
    ({"id": "A", "etiqueta": "x", "tipo": "texto", "obligatorio": True, "max": 5}, "id"),
    ({"id": "a", "etiqueta": "", "tipo": "texto", "obligatorio": True, "max": 5}, "etiqueta"),
    ({"id": "a", "etiqueta": "x", "tipo": "texto", "obligatorio": "si", "max": 5}, "obligatorio"),
    ({"id": "a", "etiqueta": "x", "tipo": "texto", "obligatorio": True}, "max"),
    ({"id": "a", "etiqueta": "x", "tipo": "seleccion", "obligatorio": True, "opciones": []}, "opciones"),
    ({"id": "a", "etiqueta": "x", "tipo": "seleccion", "obligatorio": True, "opciones": ["a", "a"]}, "opciones"),
    ({"id": "a", "etiqueta": "x", "tipo": "texto", "obligatorio": True, "max": 5, "opciones": ["a"]}, "opciones"),
    ({"id": "a", "etiqueta": "x", "tipo": "texto", "obligatorio": True, "max": 5, "entero": True}, "entero"),
])
def test_la_definicion_detecta_formularios_incoherentes(campo, fragmento):
    problemas = f.definicion_valida([campo])
    assert problemas and any(fragmento in p for p in problemas)


def test_la_definicion_rechaza_ids_repetidos_y_formas_raras():
    campo = {"id": "a", "etiqueta": "x", "tipo": "texto", "obligatorio": True, "max": 5}
    assert f.definicion_valida([campo, campo])
    assert f.definicion_valida({"a": 1}) and f.definicion_valida(["a"]) and f.definicion_valida("x")


def test_los_datos_de_ejemplo_son_validos_para_cualquier_formulario():
    for formulario in (PERMISO, [], [{"id": "a", "etiqueta": "Largo", "tipo": "texto", "obligatorio": True, "max": 5}]):
        ejemplo = f.datos_de_ejemplo(formulario)
        assert f.validar_datos(formulario, ejemplo, hoy=HOY)[1] == {}


# --------------------------------------------------------------------------- los formularios reales (migración 017)

RAIZ = pathlib.Path(__file__).resolve().parents[2]
SQL = (RAIZ / "database" / "migraciones" / "017-contenido-tramite.sql").read_text(encoding="utf-8")
CARGAS = re.findall(r"UPDATE siget\.tipo_tramite SET formulario = '(\[.*?\])'::jsonb WHERE nombre (?:=|LIKE) '([^']+)';", SQL, re.S)
FORMULARIOS = {nombre: json.loads(texto) for texto, nombre in CARGAS}


def test_la_migracion_carga_los_cinco_formularios_del_catalogo():
    assert len(FORMULARIOS) == 5
    assert "Permiso de Construcción Municipal" in FORMULARIOS and "Trámite de demostración (%)" in FORMULARIOS


@pytest.mark.parametrize("nombre", sorted(FORMULARIOS))
def test_cada_formulario_de_la_migracion_esta_bien_definido(nombre):
    formulario = FORMULARIOS[nombre]
    assert f.definicion_valida(formulario) == []
    # minimización de datos: ningún formulario pide identidad ni contacto
    assert not {c["id"] for c in formulario} & {"cedula", "nombre", "apellidos", "correo", "telefono"}
    ejemplo = f.datos_de_ejemplo(formulario)
    assert f.validar_datos(formulario, ejemplo, hoy=HOY)[1] == {}


def test_los_formularios_reales_tienen_los_campos_y_limites_aprobados():
    permiso = {c["id"]: c for c in FORMULARIOS["Permiso de Construcción Municipal"]}
    assert list(permiso) == ["direccion_terreno", "numero_finca", "tipo_obra", "area_m2", "descripcion"]
    assert permiso["tipo_obra"]["opciones"] == ["Obra nueva", "Ampliación", "Remodelación", "Demolición"]
    assert permiso["area_m2"]["max"] == 100000 and permiso["descripcion"]["obligatorio"] is False
    denuncia = {c["id"]: c for c in FORMULARIOS["Solicitud o denuncia ciudadana"]}
    assert denuncia["asunto"]["max"] == 150 and denuncia["descripcion"]["max"] == 3000 and denuncia["fecha_hechos"]["tipo"] == "fecha"
    empresa = {c["id"]: c for c in FORMULARIOS["Registro empresarial simplificado"]}
    assert empresa["numero_empleados"]["max"] == 10000 and all(c["obligatorio"] for c in empresa.values())
    inter = {c["id"]: c for c in FORMULARIOS["Solicitud interinstitucional de información"]}
    assert inter["fundamento_legal"]["max"] == 300 and inter["informacion_solicitada"]["obligatorio"] is True
    demo = {c["id"]: c for c in FORMULARIOS["Trámite de demostración (%)"]}
    assert demo["asunto"]["obligatorio"] is True and demo["descripcion"]["obligatorio"] is False
