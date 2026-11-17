"""Guarda las respuestas reales de /politicas/* como datos de ejemplo del frontend (src/mock-datos/*.json).
No contienen credenciales: solo la matriz de permisos y los privilegios de la base."""
import http.cookiejar, json, pathlib, ssl, time, urllib.request
import pyotp

raiz = pathlib.Path(__file__).parent.parent
ctx = ssl.create_default_context(cafile=str(raiz / "infra/pki/siget-ca.crt"))
ctx.check_hostname = False
ctx.verify_flags &= ~ssl.VERIFY_X509_STRICT
BASE = "https://192.168.159.137:8443"
filas = {l.split("|")[0]: l.split("|") for l in (pathlib.Path(__file__).parent.parent / "demo-local" / "siembra.local.txt").read_text(encoding="utf-8").splitlines() if l and not l.startswith("#")}

usuario = "ana.ciudadana"
_, _, clave, secreto = filas[usuario]
op = urllib.request.build_opener(urllib.request.HTTPSHandler(context=ctx), urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))


def pedir(metodo, ruta, cuerpo=None, token=None):
    cab = {"Content-Type": "application/json"}
    if token:
        cab["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(BASE + ruta, method=metodo, headers=cab, data=json.dumps(cuerpo).encode() if cuerpo is not None else None)
    with op.open(req, timeout=30) as r:
        return json.loads(r.read())


while True:
    try:
        token = pedir("POST", "/auth/login/", {"username": usuario, "password": clave, "codigo": pyotp.TOTP(secreto).now()})["access_token"]
        break
    except Exception:
        time.sleep(5)

destino = raiz / "frontend/src/mock-datos"
destino.mkdir(exist_ok=True)
for nombre, ruta in (("matriz", "/politicas/matriz/"), ("base-de-datos", "/politicas/base-de-datos/")):
    datos = pedir("GET", ruta, token=token)
    (destino / f"{nombre}.json").write_text(json.dumps(datos, ensure_ascii=False, indent=1), encoding="utf-8")
    print(nombre, "guardado", len(json.dumps(datos)), "bytes")
