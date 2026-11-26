"""Genera la identidad visual de SIGET: la bandera de Panamá en técnica de mola (portada) y el logo (estrella con contornos en eco).

Uso, desde la raíz del repositorio:  python docs/identidad/generar_identidad.py
Escribe frontend/src/assets/{mola-panama,favicon}.svg y docs/identidad/logo-siget*.svg. Imprime los trazados del logo, que viven
también en el componente Logo de frontend/src/ui.jsx (si cambias el logo, actualiza los dos).
"""
import math, os

R = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))  # raíz del repositorio
CREMA, ROJO, AZUL = "#f4ead2", "#d2203f", "#1b57a5"
NARANJA, AMAR, FONDO, TEAL = "#f26b21", "#f6b81f", "#0a2a35", "#0f4c5c"


def f(n):
    return f"{n:.2f}".rstrip("0").rstrip(".")


def estrella(cx, cy, radio, k=1.0):
    """Estrella regular de cinco puntas como trazado cerrado, escalada por k."""
    pts = []
    for i in range(10):
        r = radio * k * (1 if i % 2 == 0 else 0.382)
        a = -math.pi / 2 + i * math.pi / 5
        pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return "M" + " L".join(f"{f(x)} {f(y)}" for x, y in pts) + "Z"


def rect_redondo(x, y, w, h, r):
    return (f"M{f(x + r)} {f(y)}H{f(x + w - r)}A{f(r)} {f(r)} 0 0 1 {f(x + w)} {f(y + r)}V{f(y + h - r)}A{f(r)} {f(r)} 0 0 1 {f(x + w - r)} {f(y + h)}"
            f"H{f(x + r)}A{f(r)} {f(r)} 0 0 1 {f(x)} {f(y + h - r)}V{f(y + r)}A{f(r)} {f(r)} 0 0 1 {f(x + r)} {f(y)}Z")


# ------------------------------------------------------------------ la bandera en mola
W, H = 640, 440
cuerpo = []
retraso = [0.0]


def eco(d, color, grosor=2.6, retardo=None):
    """Contorno de eco: se dibuja al cargar (si la persona no pidió reducir el movimiento)."""
    t = retraso[0] if retardo is None else retardo
    retraso[0] += 0.07
    return f'<path class="d" style="animation-delay:{f(t)}s" pathLength="1" d="{d}" fill="none" stroke="{color}" stroke-width="{grosor}" stroke-linejoin="round" stroke-linecap="round"/>'


cuerpo.append(f'<rect width="{W}" height="{H}" rx="20" fill="{FONDO}"/>')
# franja de dientes de la mola: triángulos que alternan color a lo largo del borde
paso, alto = 20, 11
colores = (NARANJA, AMAR)
for i in range(0, W // paso):
    x = i * paso
    c = colores[i % 2]
    cuerpo.append(f'<path d="M{x + 2} 0L{x + paso / 2} {alto}L{x + paso - 2} 0Z" fill="{c}"/>')
    cuerpo.append(f'<path d="M{x + 2} {H}L{x + paso / 2} {H - alto}L{x + paso - 2} {H}Z" fill="{c}"/>')
for j in range(1, H // paso - 1):
    y = j * paso
    c = colores[j % 2]
    cuerpo.append(f'<path d="M0 {y + 2}L{alto} {y + paso / 2}L0 {y + paso - 2}Z" fill="{c}"/>')
    cuerpo.append(f'<path d="M{W} {y + 2}L{W - alto} {y + paso / 2}L{W} {y + paso - 2}Z" fill="{c}"/>')

# cuatro cuadrantes (como la bandera): blanco con estrella azul, rojo, azul, blanco con estrella roja
x0, y0, hueco = 28, 28, 8
cw, ch = (W - 2 * x0 - hueco) / 2, (H - 2 * y0 - hueco) / 2
cuadrantes = [
    (x0, y0, CREMA, (TEAL, NARANJA, AMAR), "estrella", AZUL, (CREMA, NARANJA)),
    (x0 + cw + hueco, y0, ROJO, (CREMA, AMAR, NARANJA), None, None, None),
    (x0, y0 + ch + hueco, AZUL, (CREMA, AMAR, NARANJA), None, None, None),
    (x0 + cw + hueco, y0 + ch + hueco, CREMA, (TEAL, NARANJA, AMAR), "estrella", ROJO, (CREMA, AMAR)),
]
for x, y, base, ecos, forma, color_estrella, ecos_estrella in cuadrantes:
    cuerpo.append(f'<path d="{rect_redondo(x, y, cw, ch, 12)}" fill="{base}"/>')
    for n, color in enumerate(ecos):
        d = 10 + n * 9
        cuerpo.append(eco(rect_redondo(x + d, y + d, cw - 2 * d, ch - 2 * d, max(2, 9 - n * 2.5)), color, 2.2))
    if forma:
        cx, cy = x + cw / 2, y + ch / 2
        cuerpo.append(f'<path d="{estrella(cx, cy, 78)}" fill="{color_estrella}" stroke="{color_estrella}" stroke-width="3" stroke-linejoin="round"/>')
        cuerpo.append(eco(estrella(cx, cy, 78, 0.8), ecos_estrella[0], 2.6))
        cuerpo.append(eco(estrella(cx, cy, 78, 0.58), ecos_estrella[1], 2.6))
        cuerpo.append(f'<circle cx="{f(cx)}" cy="{f(cy + 2)}" r="6" fill="{CREMA if base == CREMA else AMAR}"/>')
    else:
        # cuadrante liso: un rombo de eco en el centro (los diseños de mola repiten una forma pequeña en sus campos)
        cx, cy = x + cw / 2, y + ch / 2
        for n, (color, radio) in enumerate(((CREMA, 34), (AMAR, 22), (NARANJA, 11))):
            rombo = f"M{f(cx)} {f(cy - radio)}L{f(cx + radio)} {f(cy)}L{f(cx)} {f(cy + radio)}L{f(cx - radio)} {f(cy)}Z"
            cuerpo.append(eco(rombo, color, 2.6))

estilo = '''<style>
@media (prefers-reduced-motion: no-preference) {
  .d { stroke-dasharray: 1; stroke-dashoffset: 0; animation: trazo 1.1s cubic-bezier(.2,.7,.2,1) both; }
  @keyframes trazo { from { stroke-dashoffset: 1; } to { stroke-dashoffset: 0; } }
}
</style>'''
mola = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}" role="img">'
        f'<title>Bandera de Panamá bordada como una mola</title>{estilo}' + "".join(cuerpo) + "</svg>\n")
os.makedirs(os.path.join(R, "frontend", "src", "assets"), exist_ok=True)
open(os.path.join(R, "frontend", "src", "assets", "mola-panama.svg"), "w", encoding="utf-8", newline="\n").write(mola)

# ------------------------------------------------------------------ el logo: una estrella con contornos en eco
def marca(tam=64):
    c = tam / 2
    r = tam * 0.34
    partes = [
        f'<rect width="{tam}" height="{tam}" rx="{f(tam * 0.22)}" fill="{TEAL}"/>',
        f'<path d="{rect_redondo(tam * 0.09, tam * 0.09, tam * 0.82, tam * 0.82, tam * 0.15)}" fill="none" stroke="{AMAR}" stroke-width="{f(tam * 0.025)}" opacity="0.9"/>',
        f'<path d="{estrella(c, c + tam * 0.02, r)}" fill="{NARANJA}" stroke="{NARANJA}" stroke-width="{f(tam * 0.03)}" stroke-linejoin="round"/>',
        f'<path d="{estrella(c, c + tam * 0.02, r, 0.74)}" fill="none" stroke="{CREMA}" stroke-width="{f(tam * 0.035)}" stroke-linejoin="round"/>',
        f'<path d="{estrella(c, c + tam * 0.02, r, 0.46)}" fill="none" stroke="{AMAR}" stroke-width="{f(tam * 0.035)}" stroke-linejoin="round"/>',
        f'<circle cx="{f(c)}" cy="{f(c + tam * 0.035)}" r="{f(tam * 0.04)}" fill="{CREMA}"/>',
    ]
    return partes


sol = marca(64)
logo = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="256" height="256" role="img"><title>SIGET</title>' + "".join(sol) + "</svg>\n"
os.makedirs(os.path.join(R, "docs", "identidad"), exist_ok=True)
open(os.path.join(R, "docs", "identidad", "logo-siget.svg"), "w", encoding="utf-8", newline="\n").write(logo)
open(os.path.join(R, "frontend", "src", "assets", "favicon.svg"), "w", encoding="utf-8", newline="\n").write(logo.replace('width="256" height="256" ', ""))

horizontal = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 420 96" width="420" height="96" role="img"><title>SIGET, Sistema de Gestión y Trazabilidad</title>'
              '<g transform="translate(0 16) scale(1)">' + "".join(sol) + "</g>"
              f'<text x="84" y="52" font-family="Archivo, \'Segoe UI\', Helvetica, Arial, sans-serif" font-size="44" font-weight="800" letter-spacing="1" fill="{TEAL}">SIGET</text>'
              f'<text x="85" y="76" font-family="\'Public Sans\', \'Segoe UI\', Helvetica, Arial, sans-serif" font-size="13" fill="#475d65">Sistema de Gestión y Trazabilidad · Panamá</text></svg>\n')
open(os.path.join(R, "docs", "identidad", "logo-siget-horizontal.svg"), "w", encoding="utf-8", newline="\n").write(horizontal)

# trazados del logo para el componente de React (sin el rectángulo de fondo ni el escalado)
print("\n".join(sol[1:]))
