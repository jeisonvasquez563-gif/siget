"""Recorre la plataforma por HTTPS (nginx) con cada cuenta de demostración: login con TOTP, módulos y accesos."""
import http.cookiejar, json, pathlib, ssl, sys, time, urllib.request, urllib.error
import pyotp

BASE = "https://192.168.159.137:8443"
ctx = ssl.create_default_context(cafile=str(pathlib.Path(__file__).parent.parent / "infra/pki/siget-ca.crt"))
ctx.check_hostname = False  # el certificado es para el nombre del servidor, aquí se entra por IP
ctx.verify_flags &= ~ssl.VERIFY_X509_STRICT  # la CA interna no trae keyUsage (pendiente de reemitir)
filas = {l.split("|")[0]: l.split("|") for l in pathlib.Path(__file__).parent.parent / "demo-local" / "siembra.local.txt".read_text(encoding="utf-8").splitlines() if l and not l.startswith("#")}

def pedir(op, metodo, ruta, cuerpo=None, token=None):
    cab = {"Content-Type": "application/json"}
    if token: cab["Authorization"] = f"Bearer {token}"
    if ruta.startswith("/auth/refresh"): cab["X-SIGET-CSRF"] = "1"
    req = urllib.request.Request(BASE + ruta, method=metodo, headers=cab, data=json.dumps(cuerpo).encode() if cuerpo is not None else None)
    try:
        with op.open(req, timeout=20) as r: return r.status, json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read() or b"null")
        except Exception: return e.code, None

def entrar(usuario):
    _, _, clave, secreto = filas[usuario]
    op = urllib.request.build_opener(urllib.request.HTTPSHandler(context=ctx), urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    while True:  # evita el paso TOTP ya usado en una corrida anterior
        e, d = pedir(op, "POST", "/auth/login/", {"username": usuario, "password": clave, "codigo": pyotp.TOTP(secreto).now()})
        if e == 200: return op, d["access_token"], secreto
        if e == 401: time.sleep(5); continue
        raise SystemExit(f"{usuario}: login {e} {d}")

for usuario in (sys.argv[1:] or filas):
    op, tok, secreto = entrar(usuario)
    _, yo = pedir(op, "GET", "/auth/yo/", token=tok)
    mods = [m["id"] + ("*" if m["estado"] != "disponible" else "") for m in yo["modulos"]]
    e_t, t = pedir(op, "GET", "/tramites/?limite=100", token=tok)
    n = len(t["resultados"]) if e_t == 200 else "—"
    e_q, q = pedir(op, "GET", "/equipo/", token=tok)
    eq = sum(len(x["personal"]) for x in q["equipos"]) if e_q == 200 else "—"
    e_a, a = pedir(op, "GET", "/auditoria/resumen/", token=tok)
    aud = f"auditoría:HTTP {e_a}" + (f" ({a['decisiones']['total']} decisiones, {a['decisiones']['negadas']} negadas)" if e_a == 200 else "")
    rol = yo["rol_plataforma"] if yo["rol_plataforma"] != "ninguno" else ",".join(m["rol"] for m in yo["membresias"]) or "ciudadano"
    print(f"{usuario:17} {rol:26} trámites:HTTP {e_t} ({n})  equipo:HTTP {e_q} ({eq})  {aud}  módulos: {' '.join(mods)}")
