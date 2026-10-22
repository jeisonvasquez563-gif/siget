"""Captura las respuestas REALES del simulador para los escenarios de la interfaz (src/escenarios.json) y el formulario (GET).
Genera src/mock-datos/simulador.json = {meta, casos: [{entrada, respuesta}]}. No contiene credenciales."""
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

escenarios = json.loads((raiz / "frontend/src/escenarios.json").read_text(encoding="utf-8"))
salida = {"meta": pedir("GET", "/politicas/simular/", token=token), "casos": []}
for e in escenarios:
    r = pedir("POST", "/politicas/simular/", e["entrada"], token=token)
    salida["casos"].append({"entrada": e["entrada"], "respuesta": r})
    print(f"{e['id']:26} -> {'PERMITIDO' if r['decision']['permitido'] else 'negado   '} {r['decision']['politica']}")
(raiz / "frontend/src/mock-datos/simulador.json").write_text(json.dumps(salida, ensure_ascii=False, indent=1), encoding="utf-8")
print("guardado")
