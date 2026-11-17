"""Verificación manual de la alerta «SQL Injection» de OWASP ZAP (regla 40018).

ZAP compara la respuesta a una condición verdadera (OR 1=1) con la de una falsa (AND 1=1). Este script repite
exactamente esos pares de peticiones, con pausas para no tocar el límite de tasa de nginx, y muestra el código
y el cuerpo de cada respuesta para decidir si la diferencia viene de la base de datos o de otra cosa.
"""
import json
import pathlib
import ssl
import time
import urllib.error
import urllib.request

BASE = "https://192.168.159.137:8443"
CA = pathlib.Path(__file__).resolve().parents[3] / "infra/pki/siget-ca.crt"
contexto = ssl.create_default_context(cafile=str(CA))
contexto.verify_flags &= ~ssl.VERIFY_X509_STRICT  # la CA de laboratorio aún no trae keyUsage (pendiente PT-7)

CASOS = [
    ("/auth/login/", {"username": "zap.prueba"}, "password", "no-es-una-clave", " {} 1=1 -- "),
    ("/auth/registro/", {"username": "zap.prueba"}, "password", "corta", " {} 1=1 -- "),
    ("/auth/restablecer/", {"username": "zap.prueba", "codigo": "AAAA-BBBB-CCCC"}, "password", "corta", "' {} '1'='1' -- "),
    ("/auth/restablecer/", {"codigo": "AAAA-BBBB-CCCC", "password": "corta"}, "username", "zap.prueba", " {} 1=1 -- "),
]


def pedir(ruta, cuerpo):
    peticion = urllib.request.Request(BASE + ruta, data=json.dumps(cuerpo).encode(), method="POST",
                                      headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(peticion, context=contexto, timeout=15) as r:
            return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()


for ruta, fijos, campo, valor, plantilla in CASOS:
    print(f"\n=== {ruta}  (parámetro «{campo}»)")
    for etiqueta, v in (("original", valor), ("AND (falsa)", valor + plantilla.format("AND")),
                        ("OR (verdadera)", valor + plantilla.format("OR"))):
        codigo, cuerpo = pedir(ruta, {**fijos, campo: v})
        print(f"  {etiqueta:<15} {campo}={v!r:<34} -> {codigo} {cuerpo[:150]}")
        time.sleep(4)
