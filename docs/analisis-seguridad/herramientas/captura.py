"""Captura de evidencia para el informe de análisis estático y dinámico.

Ejecuta un comando, guarda su salida completa en texto (.txt) y genera una
captura de pantalla (.png) de la terminal con el comando, la fecha y la
respuesta. Las salidas largas se reparten en varias capturas numeradas.

También puede capturar un reporte HTML de una herramienta (Bandit, ZAP, ...).

Uso:
    python captura.py cmd  <carpeta> <nombre> "<titulo>" -- <comando ...>
    python captura.py html <carpeta> <nombre> <archivo.html> [alto]
"""
import datetime
import getpass
import html
import os
import pathlib
import platform
import re
import subprocess
import sys

LINEAS_POR_CAPTURA = 55
ANSI = re.compile(r"\x1b\[[0-9;?]*[A-Za-z]")
# La carpeta local donde se instalaron las herramientas no aporta nada a la evidencia: se reemplaza por un marcador.
RUTA_HERRAMIENTAS = os.environ.get("CAPTURA_RUTA_HERRAMIENTAS", "")
MARCADOR = "<carpeta-herramientas>"


def ocultar_ruta(texto: str) -> str:
    if not RUTA_HERRAMIENTAS:
        return texto
    for variante in {RUTA_HERRAMIENTAS, RUTA_HERRAMIENTAS.replace("/", "\\"), RUTA_HERRAMIENTAS.replace("\\", "/")}:
        texto = re.sub(re.escape(variante), MARCADOR, texto, flags=re.IGNORECASE)
    return texto


def capturar_pagina(origen: pathlib.Path, destino: pathlib.Path, alto: int, ancho: int = 1280,
                    pagina_completa: bool = True) -> None:
    """Abre la página en Microsoft Edge (sin ventana) y guarda la captura en PNG."""
    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        navegador = p.chromium.launch(channel="msedge")
        pagina = navegador.new_page(viewport={"width": ancho, "height": alto})
        pagina.goto(origen.resolve().as_uri())
        pagina.screenshot(path=str(destino.resolve()), full_page=pagina_completa)
        navegador.close()


def ventana(titulo: str, prompt: str, comando: str, lineas: list[str], pie: str) -> str:
    cuerpo = "\n".join(html.escape(l) for l in lineas)
    return f"""<!doctype html><html><head><meta charset="utf-8"><style>
body{{margin:0;background:#2b2b2b;font-family:'Cascadia Mono',Consolas,monospace}}
.v{{margin:14px;border-radius:8px;overflow:hidden;box-shadow:0 4px 18px #0008;border:1px solid #444}}
.b{{background:#3c3c3c;color:#ddd;font:13px 'Segoe UI',sans-serif;padding:7px 12px;display:flex;justify-content:space-between}}
.t{{background:#0c0c0c;color:#cccccc;font-size:13.5px;line-height:18px;padding:12px 14px;white-space:pre-wrap;word-break:break-all}}
.p{{color:#3bb33b}} .c{{color:#f2f2f2}} .f{{color:#8a8a8a}}
</style></head><body><div class="v"><div class="b"><span>{html.escape(titulo)}</span><span>— ☐ ✕</span></div>
<div class="t"><span class="p">{html.escape(prompt)}</span> <span class="c">{html.escape(comando)}</span>
{cuerpo}
<span class="f">{html.escape(pie)}</span></div></div></body></html>"""


def modo_cmd(carpeta: pathlib.Path, nombre: str, titulo: str, comando: list[str]) -> None:
    inicio = datetime.datetime.now()
    proceso = subprocess.run(comando, capture_output=True, text=True, encoding="utf-8", errors="replace")
    salida = ocultar_ruta(ANSI.sub("", (proceso.stdout or "") + (proceso.stderr or "")).rstrip("\n"))
    fin = datetime.datetime.now()
    # Se muestra el nombre de la herramienta, no la ruta del entorno virtual donde está instalada.
    texto_cmd = ocultar_ruta(subprocess.list2cmdline([pathlib.Path(comando[0]).stem] + comando[1:]))
    usuario = f"{getpass.getuser()}@{platform.node()}"
    cabecera = f"# {titulo}\n# {inicio:%Y-%m-%d %H:%M:%S}  {usuario}  {os.getcwd()}\n$ {texto_cmd}\n"
    (carpeta / f"{nombre}.txt").write_text(cabecera + salida + f"\n# código de salida: {proceso.returncode}\n", encoding="utf-8")
    renderizar(carpeta, nombre, titulo, usuario, os.getcwd(), texto_cmd, salida, proceso.returncode, fin)


def renderizar(carpeta, nombre, titulo, usuario, cwd, texto_cmd, salida, codigo, fin) -> None:
    lineas = salida.splitlines() or ["(sin salida)"]
    partes = [lineas[i:i + LINEAS_POR_CAPTURA] for i in range(0, len(lineas), LINEAS_POR_CAPTURA)]
    for viejo in carpeta.glob(f"{nombre}_[0-9][0-9].png"):
        viejo.unlink()
    prompt = f"PS {cwd}>"
    for n, parte in enumerate(partes, 1):
        sufijo = "" if len(partes) == 1 else f"_{n:02d}"
        pie = (f"[{fin:%Y-%m-%d %H:%M:%S}] código de salida {codigo}"
               + ("" if len(partes) == 1 else f" · captura {n} de {len(partes)} · salida completa en {nombre}.txt"))
        pagina = carpeta / f"_{nombre}{sufijo}.html"
        pagina.write_text(ventana(f"{titulo} — {usuario}", prompt, texto_cmd if n == 1 else "(continuación)", parte, pie), encoding="utf-8")
        capturar_pagina(pagina, carpeta / f"{nombre}{sufijo}.png", 200)
        pagina.unlink()
    print(f"{nombre}: código {codigo}, {len(lineas)} líneas, {len(partes)} captura(s)")


def modo_rehacer(carpeta: pathlib.Path, nombre: str) -> None:
    """Vuelve a dibujar las capturas de una salida ya guardada (.txt), ocultando la carpeta de herramientas.
    No ejecuta nada: conserva el comando, la fecha y la salida originales."""
    archivo = carpeta / f"{nombre}.txt"
    lineas = ocultar_ruta(archivo.read_text(encoding="utf-8")).splitlines()
    titulo = lineas[0].removeprefix("# ")
    fecha, usuario, cwd = re.match(r"# (\S+ \S+)\s+(\S+)\s+(.+)", lineas[1]).groups()
    texto_cmd = lineas[2].removeprefix("$ ")
    codigo = int(re.search(r"(-?\d+)", lineas[-1]).group(1))
    salida = "\n".join(lineas[3:-1])
    archivo.write_text("\n".join(lineas) + "\n", encoding="utf-8")
    renderizar(carpeta, nombre, titulo, usuario, cwd, texto_cmd, salida, codigo,
               datetime.datetime.strptime(fecha, "%Y-%m-%d %H:%M:%S"))


def modo_html(carpeta: pathlib.Path, nombre: str, archivo: str, alto: int) -> None:
    capturar_pagina(pathlib.Path(archivo), carpeta / f"{nombre}.png", alto, 1400, pagina_completa=False)
    print(f"{nombre}: captura del reporte {archivo}")


if __name__ == "__main__":
    modo, carpeta, nombre = sys.argv[1], pathlib.Path(sys.argv[2]), sys.argv[3]
    carpeta.mkdir(parents=True, exist_ok=True)
    if modo == "cmd":
        separador = sys.argv.index("--")
        modo_cmd(carpeta, nombre, sys.argv[4], sys.argv[separador + 1:])
    elif modo == "rehacer":
        modo_rehacer(carpeta, nombre)
    else:
        modo_html(carpeta, nombre, sys.argv[4], int(sys.argv[5]) if len(sys.argv) > 5 else 1800)
