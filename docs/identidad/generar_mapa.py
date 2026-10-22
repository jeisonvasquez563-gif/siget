"""Genera el mapa de Panamá de la portada (frontend/src/mapa-panama.js) a partir de la geometría real de Natural Earth.

Uso, desde la raíz del repositorio:  python docs/identidad/generar_mapa.py
Fuente: Natural Earth 50m (dominio público), países, Panamá. Se guarda aquí (panama-natural-earth-50m.json) para que sea reproducible.
Proyección equirrectangular centrada en la latitud media; se simplifica con Douglas-Peucker. No necesita ninguna librería externa.
"""
import json
import math
import os

RAIZ = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
FUENTE = os.path.join(os.path.dirname(__file__), "panama-natural-earth-50m.json")
SALIDA = os.path.join(RAIZ, "frontend", "src", "mapa-panama.js")

ANCHO, ALTO, MARGEN = 640, 300, 18
EPSILON = 0.35  # píxeles

# Lugares reales (lon, lat). Los tres con etiqueta marcan el recorrido de un trámite: de la recepción a la resolución
CIUDADES = {"david": (-82.43, 8.43), "santiago": (-80.97, 8.10), "penonome": (-80.36, 8.52), "panama": (-79.52, 8.98)}
CANAL = [(-79.917, 9.366), (-79.919, 9.272), (-79.86, 9.19), (-79.78, 9.14), (-79.70, 9.12), (-79.66, 9.06), (-79.61, 9.02), (-79.55, 8.99), (-79.52, 8.915)]


def geometria():
    g = json.load(open(FUENTE, encoding="utf-8"))["geometry"]
    return g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]


def proyectar(lon, lat, caja, k):
    lon_min, lat_max = caja
    return ((lon - lon_min) * k + MARGEN, (lat_max - lat) * k + MARGEN)


def douglas_peucker(pts, eps):
    if len(pts) < 3:
        return pts
    (x1, y1), (x2, y2) = pts[0], pts[-1]
    dx, dy = x2 - x1, y2 - y1
    norma = math.hypot(dx, dy) or 1e-9
    mejor, idx = 0, 0
    for i in range(1, len(pts) - 1):
        d = abs(dy * pts[i][0] - dx * pts[i][1] + x2 * y1 - y2 * x1) / norma
        if d > mejor:
            mejor, idx = d, i
    if mejor > eps:
        return douglas_peucker(pts[: idx + 1], eps)[:-1] + douglas_peucker(pts[idx:], eps)
    return [pts[0], pts[-1]]


def simplificar_anillo(pts, eps):
    """Un anillo cerrado empieza y termina en el mismo punto: se parte en dos mitades por el punto más lejano y se simplifica cada una."""
    if pts[0] == pts[-1]:
        pts = pts[:-1]
    lejano = max(range(len(pts)), key=lambda i: math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]))
    a = douglas_peucker(pts[: lejano + 1], eps)
    b = douglas_peucker(pts[lejano:] + [pts[0]], eps)
    return a[:-1] + b[:-1]


def area(pts):
    return abs(sum(pts[i][0] * pts[(i + 1) % len(pts)][1] - pts[(i + 1) % len(pts)][0] * pts[i][1] for i in range(len(pts)))) / 2


def trazado(pts, cerrar=True):
    s = "M" + " L".join(f"{x:.1f} {y:.1f}" for x, y in pts)
    return s + ("Z" if cerrar else "")


def suave(pts):
    """Curva que pasa por todos los puntos (Catmull-Rom convertida a cúbicas de Bézier)."""
    d = f"M{pts[0][0]:.1f} {pts[0][1]:.1f}"
    for i in range(len(pts) - 1):
        p0, p1, p2, p3 = pts[max(i - 1, 0)], pts[i], pts[i + 1], pts[min(i + 2, len(pts) - 1)]
        c1 = (p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6)
        c2 = (p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6)
        d += f" C{c1[0]:.1f} {c1[1]:.1f} {c2[0]:.1f} {c2[1]:.1f} {p2[0]:.1f} {p2[1]:.1f}"
    return d


def main():
    polis = geometria()
    todos = [p for poli in polis for p in poli[0]]
    lon_min, lon_max = min(p[0] for p in todos), max(p[0] for p in todos)
    lat_min, lat_max = min(p[1] for p in todos), max(p[1] for p in todos)
    corr = math.cos(math.radians((lat_min + lat_max) / 2))
    k = min((ANCHO - 2 * MARGEN) / ((lon_max - lon_min) * corr), (ALTO - 2 * MARGEN) / (lat_max - lat_min))
    # la longitud se ensancha por el coseno de la latitud: se aplica al proyectar
    def pr(lon, lat):
        return ((lon - lon_min) * corr * k + MARGEN, (lat_max - lat) * k + MARGEN)

    partes = []
    for poli in polis:
        pts = [pr(lon, lat) for lon, lat in poli[0]]
        if area(pts) < 14:  # islotes que no se ven a este tamaño
            continue
        partes.append(simplificar_anillo(pts, EPSILON))
    partes.sort(key=area, reverse=True)

    datos = {
        "ancho": ANCHO, "alto": ALTO,
        "pais": " ".join(trazado(p) for p in partes),
        "canal": trazado([pr(*c) for c in CANAL], cerrar=False),
        "ruta_hecha": suave([pr(*CIUDADES[n]) for n in ("david", "santiago", "penonome")]),
        "ruta_pendiente": suave([pr(*CIUDADES[n]) for n in ("penonome", "panama")]),
        "nodos": {n: [round(v, 1) for v in pr(*CIUDADES[n])] for n in ("david", "penonome", "panama")},
    }
    js = ("// Generado por docs/identidad/generar_mapa.py a partir de Natural Earth 50m (dominio público). No se edita a mano.\n"
          "export const MAPA = " + json.dumps(datos, ensure_ascii=False, indent=2) + "\n")
    open(SALIDA, "w", encoding="utf-8", newline="\n").write(js)
    print(f"{len(partes)} polígonos, {sum(len(p) for p in partes)} puntos, escala {k:.1f} px/grado -> {os.path.relpath(SALIDA, RAIZ)}")


if __name__ == "__main__":
    main()
