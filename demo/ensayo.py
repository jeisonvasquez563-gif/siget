"""Ensayo de la demostración: recorre por HTTPS (nginx) los pasos de docs/demo-guion.md con las cuentas reales.
Los pasos que escriben datos usan UN trámite nuevo (no gastan los trámites sembrados). No imprime contraseñas ni códigos."""
import datetime as dt
import email.utils
import http.cookiejar
import json
import pathlib
import socket
import ssl
import sys
import time
import urllib.error
import urllib.request

import pyotp

raiz = pathlib.Path(__file__).parent.parent
BASE = "https://192.168.159.137:8443"
ctx = ssl.create_default_context(cafile=str(raiz / "infra/pki/siget-ca.crt"))
ctx.check_hostname = False
ctx.verify_flags &= ~ssl.VERIFY_X509_STRICT
filas = {l.split("|")[0]: l.split("|") for l in (pathlib.Path(__file__).parent.parent / "demo-local" / "siembra.local.txt").read_text(encoding="utf-8").splitlines() if l and not l.startswith("#")}

resultados = []

# Un código TOTP no se acepta dos veces: se espera al siguiente intervalo de 30 s para no chocar con una corrida anterior
PASO_INICIAL = int(time.time()) // 30 + 1


def paso(ok, texto, detalle=""):
    resultados.append(ok)
    print(("  OK    " if ok else "  FALLA ") + texto + (f"  [{detalle}]" if detalle else ""))


def titulo(t):
    print(f"\n== {t}")


class Sesion:
    def __init__(self, usuario):
        self.usuario = usuario
        _, _, self.clave, self.secreto = filas[usuario]
        self.op = urllib.request.build_opener(urllib.request.HTTPSHandler(context=ctx), urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        self.token = None
        self.ultimo_paso = PASO_INICIAL - 1

    def pedir(self, metodo, ruta, cuerpo=None, extra=None):
        cab = {"Content-Type": "application/json"}
        if self.token:
            cab["Authorization"] = f"Bearer {self.token}"
        cab.update(extra or {})
        req = urllib.request.Request(BASE + ruta, method=metodo, headers=cab, data=json.dumps(cuerpo).encode() if cuerpo is not None else None)
        try:
            with self.op.open(req, timeout=30) as r:
                return r.status, json.loads(r.read() or b"null")
        except urllib.error.HTTPError as e:
            try:
                return e.code, json.loads(e.read() or b"null")
            except Exception:
                return e.code, None

    def codigo_nuevo(self):
        """Un código que no se haya usado antes (el servidor no acepta el mismo paso dos veces)."""
        t = pyotp.TOTP(self.secreto)
        while True:
            paso_actual = int(time.time()) // 30
            if paso_actual != self.ultimo_paso:
                self.ultimo_paso = paso_actual
                return t.now()
            time.sleep(1)

    def entrar(self):
        e, d = self.pedir("POST", "/auth/login/", {"username": self.usuario, "password": self.clave, "codigo": self.codigo_nuevo()})
        if e != 200:
            return e, d
        self.token = d["access_token"]
        return e, d


# --------------------------------------------------------------------------- 0. preparación
print(f"Esperando el siguiente intervalo del segundo factor ({PASO_INICIAL * 30 - int(time.time())} s)…")
titulo("0. Preparación: servidores, certificado, hora y seguridad de la puerta")
try:
    t0 = time.time()
    req = urllib.request.Request(BASE + "/salud/")
    with urllib.request.urlopen(req, context=ctx, timeout=15) as r:
        cuerpo = json.loads(r.read())
        fecha_srv = email.utils.parsedate_to_datetime(r.headers["Date"])
        cab = {k.lower(): v for k, v in r.headers.items()}
    paso(cuerpo.get("estado") == "ok" or r.status == 200, "la plataforma responde por HTTPS (/salud/)", cuerpo)
    desfase = abs((dt.datetime.now(dt.timezone.utc) - fecha_srv).total_seconds())
    paso(desfase < 5, "la hora de VM1 coincide con la del PC (el segundo factor depende de ella)", f"{desfase:.1f} s de diferencia")
    for h in ("strict-transport-security", "content-security-policy", "x-content-type-options", "x-frame-options"):
        paso(h in cab, f"cabecera de seguridad {h}")
except Exception as e:  # noqa: BLE001
    paso(False, "la plataforma responde", repr(e))
    sys.exit("No hay conexión con VM1: enciende las VMs y revisa la red.")

try:
    with socket.create_connection(("192.168.159.137", 8443), timeout=10) as s, ctx.wrap_socket(s, server_hostname="192.168.159.137") as ss:
        c = ss.getpeercert()
        vence = dt.datetime.strptime(c["notAfter"], "%b %d %H:%M:%S %Y %Z")
        paso((vence - dt.datetime.now(dt.timezone.utc).replace(tzinfo=None)).days > 30, "el certificado vence dentro de más de 30 días", f"vence {vence:%d-%m-%Y}")
        paso(ss.version() == "TLSv1.3", "se negocia TLS 1.3", ss.version())
except Exception as e:  # noqa: BLE001
    paso(False, "certificado y TLS", repr(e))

for ruta, esperado in (("/", 200), ("/index.html", 200), ("/admin", 404), ("/assets/inexistente.js", 404), ("/tramites/", 401)):
    try:
        req = urllib.request.Request(BASE + ruta)
        with urllib.request.urlopen(req, context=ctx, timeout=15) as r:
            codigo = r.status
    except urllib.error.HTTPError as e:
        codigo = e.code
    paso(codigo == esperado, f"GET {ruta} responde {esperado}", codigo)

try:
    pagina = urllib.request.urlopen(urllib.request.Request(BASE + "/"), context=ctx, timeout=15).read().decode()
    import re
    activos = re.findall(r'/assets/[^"]+', pagina)
    caidos = []
    for a in activos:
        try:
            urllib.request.urlopen(urllib.request.Request(BASE + a), context=ctx, timeout=15).read(1)
        except Exception:
            caidos.append(a)
    paso(bool(activos) and not caidos, "los archivos de la interfaz (JS y CSS) se sirven", f"{len(activos)} archivos")
except Exception as e:  # noqa: BLE001
    paso(False, "interfaz servida", repr(e))

# --------------------------------------------------------------------------- 1. ciudadana
titulo("1. Ana (ciudadana): login, menú, iniciar un trámite, historial")
ana = Sesion("ana.ciudadana")
# Acceso en dos pasos: la contraseña sola solo lleva a pedir el código, y no delata si la cuenta existe o tiene segundo factor
e, d = ana.pedir("POST", "/auth/login/", {"username": ana.usuario, "password": ana.clave})
paso(e == 401 and (d or {}).get("codigo") == "mfa_requerido", "paso 1: contraseña correcta sin código -> el servidor pide el código", e)
e, d = ana.pedir("POST", "/auth/login/", {"username": "nadie.existe", "password": "x"})
paso(e == 401 and (d or {}).get("codigo") == "credenciales_invalidas", "un usuario inexistente no responde «pide código» (no delata quién tiene segundo factor)", e)
e, d = ana.pedir("POST", "/auth/registro/", {"username": "sin.datos.personales", "password": "una-frase-larga-y-poco-comun-5821"})
paso(e == 400 and len((d or {}).get("errores", [])) >= 7, "crear cuenta sin datos personales se rechaza (400, dice qué falta)", e)
e, _ = ana.entrar()
paso(e == 200, "entra con usuario, contraseña y código del segundo factor", e)
_, yo = ana.pedir("GET", "/auth/yo/")
inactividad = yo.get("inactividad_minutos")
paso(isinstance(inactividad, int) and 1 <= inactividad <= 15, "el servidor informa el tiempo de inactividad (la interfaz no lo escribe a mano)", f"{inactividad} min")
ids = [m["id"] for m in yo["modulos"]]
paso(ids == ["mis_tramites", "nuevo_tramite", "seguridad", "mfa", "roles_permisos"], "su menú es el de la ciudadanía", ids)
_, lista = ana.pedir("GET", "/tramites/?limite=100")
antes = len(lista["resultados"])
paso(antes >= 3 and all("solicitante_id" not in t for t in lista["resultados"]), "ve sus trámites y ningún dato interno del personal", antes)
_, instituciones = ana.pedir("GET", "/catalogo/instituciones/")
mop = next(i["id"] for i in instituciones if i["nombre"] == "MOP")
_, tipos = ana.pedir("GET", f"/catalogo/tipos-tramite/?institucion={mop}")
e, nuevo = ana.pedir("POST", "/tramites/", {"tipo_tramite": tipos[0]["id"]})
paso(e == 201 and nuevo["estado"] == "Pendiente", "inicia un trámite del MOP", f"#{nuevo.get('id')}")
tramite = nuevo["id"]
e, h = ana.pedir("GET", f"/tramites/{tramite}/historial/")
paso(e == 200 and [x["accion"] for x in h["eventos"]] == ["creacion"] and "actor_id" not in h["eventos"][0], "el historial muestra la creación y no revela quién actuó")
e, _ = ana.pedir("POST", f"/tramites/{tramite}/estado/", {"estado": "En Tramitacion"})
paso(e == 403, "no puede cambiar el estado (403)", e)
e, _ = ana.pedir("GET", "/equipo/")
paso(e == 403, "no ve el equipo (403)", e)
e, m = ana.pedir("GET", "/politicas/matriz/")
paso(e == 200 and m["ningun_rol_puede_todo"] is True, "ve la matriz de permisos: no hay superusuario")

# --------------------------------------------------------------------------- 2. funcionario
titulo("2. Fabio (funcionario del MOP): bandeja, cambiar estado, conflicto de interés")
fabio = Sesion("fabio.mop")
e, _ = fabio.entrar()
paso(e == 200, "entra", e)
_, lista = fabio.pedir("GET", "/tramites/?limite=100")
ids_visibles = {t["id"] for t in lista["resultados"]}
paso(tramite in ids_visibles, "ve el trámite nuevo de Ana en su bandeja", f"{len(ids_visibles)} trámites")
paso(all(t["institucion"]["nombre"] == "MOP" for t in lista["resultados"]), "solo ve trámites del MOP")
e, r = fabio.pedir("POST", f"/tramites/{tramite}/estado/", {"estado": "En Tramitacion"})
paso(e == 200 and r["estado"] == "En Tramitacion", "lo pasa a «En tramitación» (el segundo factor del login sigue vigente 15 minutos)", e)
e, r = fabio.pedir("POST", f"/tramites/{tramite}/estado/", {"estado": "Aprobado"})
paso(e == 200 and r["estado"] == "Aprobado", "lo aprueba", e)
e, r = fabio.pedir("POST", f"/tramites/{tramite}/estado/", {"estado": "Rechazado"})
paso(e == 403, "un estado final no admite más cambios (403)", e)
_, tipos_mop = fabio.pedir("GET", f"/catalogo/tipos-tramite/?institucion={mop}")
e, propio = fabio.pedir("POST", "/tramites/", {"tipo_tramite": tipos_mop[0]["id"]})
e2, r = fabio.pedir("POST", f"/tramites/{propio['id']}/estado/", {"estado": "En Tramitacion"})
paso(e == 201 and e2 == 403, "no gestiona un trámite que él mismo inició (conflicto de interés)", f"crear {e}, gestionar {e2}")
e, h = fabio.pedir("GET", f"/tramites/{tramite}/historial/")
paso(e == 200 and [x["accion"] for x in h["eventos"]] == ["creacion", "cambio_estado", "cambio_estado"] and all("actor_id" in x for x in h["eventos"]), "el personal ve el historial completo con quién actuó")
e, _ = ana.pedir("GET", f"/tramites/{tramite}/historial/")
paso(e == 200, "y Ana lo ve (sin actores)")

# --------------------------------------------------------------------------- 3. supervisor
titulo("3. Saúl (supervisor): reasignar y equipo")
saul = Sesion("saul.mop")
e, _ = saul.entrar()
paso(e == 200, "entra", e)
_, eq = saul.pedir("GET", "/equipo/")
personal = {p["usuario"]: p["usuario_id"] for p in eq["equipos"][0]["personal"]}
paso({"fabio.mop", "flor.mop", "saul.mop", "carla.mop"} <= set(personal), "ve al equipo del MOP", sorted(personal))
_, t2 = ana.pedir("POST", "/tramites/", {"tipo_tramite": tipos[0]["id"]})
e, r = saul.pedir("POST", f"/tramites/{t2['id']}/reasignar/", {"funcionario_id": personal["flor.mop"]})
paso(e == 200 and r["funcionario_asignado_id"] == personal["flor.mop"], "reasigna un trámite a Flor", e)
e, _ = fabio.pedir("POST", f"/tramites/{t2['id']}/reasignar/", {"funcionario_id": personal["fabio.mop"]})
paso(e == 403, "un funcionario no puede reasignar (403)", e)
e, _ = fabio.pedir("POST", f"/tramites/{t2['id']}/estado/", {"estado": "En Tramitacion"})
paso(e == 403, "Fabio no mueve lo asignado a Flor (403)", e)

# --------------------------------------------------------------------------- 4. otra institución y coordinación
titulo("4. Félix (MINSA) y Carla (coordinadora)")
felix = Sesion("felix.minsa")
felix.entrar()
_, lista = felix.pedir("GET", "/tramites/?limite=100")
paso(all(t["institucion"]["nombre"] == "MINSA" for t in lista["resultados"]) and tramite not in {t["id"] for t in lista["resultados"]}, "Félix solo ve el MINSA: lo del MOP no existe para él")
e, _ = felix.pedir("GET", f"/tramites/{tramite}/")
paso(e == 404, "pedir un trámite del MOP da 404 (no revela que existe)", e)
carla = Sesion("carla.mop")
carla.entrar()
e, eq = carla.pedir("GET", "/equipo/")
_, lista = carla.pedir("GET", "/tramites/?limite=100")
paso(e == 200 and len(lista["resultados"]) == 0, "Carla ve el equipo pero ningún trámite de la institución", f"equipo {e}, trámites {len(lista['resultados'])}")

# --------------------------------------------------------------------------- 5. plataforma
titulo("5. Ines (operadora de infraestructura): su menú y el acceso negado")
ines = Sesion("ines.infra")
ines.entrar()
_, yo = ines.pedir("GET", "/auth/yo/")
paso([m["id"] for m in yo["modulos"]][0] == "consola_infraestructura" and "mis_tramites" not in [m["id"] for m in yo["modulos"]], "su menú es distinto: solo su consola")
e, _ = ines.pedir("GET", "/tramites/?limite=1")
paso(e == 403, "ver trámites: 403 del servidor", e)

# --------------------------------------------------------------------------- 6. auditor
titulo("6. Aldo (auditor): consola de auditoría")
aldo = Sesion("aldo.auditor")
aldo.entrar()
e, res = aldo.pedir("GET", "/auditoria/resumen/")
paso(e == 200 and res["decisiones"]["negadas"] > 0, "el resumen muestra decisiones permitidas y negadas", res.get("decisiones") if e == 200 else e)
e, neg = aldo.pedir("GET", "/auditoria/decisiones/?resultado=negadas&limite=100")
politicas = {x["politica"] for x in neg["resultados"]} if e == 200 else set()
paso({"conflicto_de_interes", "plataforma_sin_acceso_a_tramites"} <= politicas, "las negadas incluyen el conflicto de interés y a Ines intentando ver trámites", sorted(politicas))
e, tr = aldo.pedir("GET", "/auditoria/tramites/?limite=10")
paso(e == 200 and any(x["tramite_id"] == tramite for x in tr["resultados"]), "las actuaciones recientes incluyen lo que acabamos de hacer en el ensayo")
e, _ = aldo.pedir("GET", "/tramites/?limite=1")
paso(e == 403, "el auditor tampoco ve trámites (403)", e)
e, _ = saul.pedir("GET", "/auditoria/resumen/")
paso(e == 403, "un supervisor no accede a la auditoría (403)", e)

# --------------------------------------------------------------------------- 7. MFA
titulo("7. Segundo factor: verificar y comprobar que un código no se reutiliza")
codigo = fabio.codigo_nuevo()
e, _ = fabio.pedir("POST", "/auth/mfa/verificar/", {"codigo": codigo})
paso(e == 200, "un código nuevo se acepta y renueva la ventana", e)
e, d = fabio.pedir("POST", "/auth/mfa/verificar/", {"codigo": codigo})
paso(e == 400, "el MISMO código se rechaza (anti-repetición)", e)
e, act = fabio.pedir("GET", "/auth/actividad/")
eventos = [x["evento"] for x in act["eventos"]] if e == 200 else []
paso("login_ok" in eventos and "mfa_verificado" in eventos, "su actividad de seguridad muestra el inicio de sesión y la verificación", eventos[:6])
_, yo = fabio.pedir("GET", "/auth/yo/")
paso(yo["mfa_activo"] and yo["mfa_obligatorio"], "el estado de MFA: activo y obligatorio")

# --------------------------------------------------------------------------- 8. roles, permisos y simulador
titulo("8. Roles y permisos, base de datos y simulador")
e, bd = saul.pedir("GET", "/politicas/base-de-datos/")
paso(e == 200 and bd["ningun_rol_de_aplicacion_es_superusuario"], "la base de datos: ningún rol de la aplicación es superusuario")
e, s1 = saul.pedir("POST", "/politicas/simular/", {"rol": "funcionario", "accion": "cambiar_estado", "solicitante": "yo"})
paso(e == 200 and s1["decision"]["politica"] == "conflicto_de_interes", "simulador: el conflicto de interés se niega con su política")
e, s2 = saul.pedir("POST", "/politicas/simular/", {"rol": "funcionario", "accion": "cambiar_estado", "segundo_factor": "vencido"})
paso(e == 200 and any(a["variable"] == "segundo_factor" and a["valor"] == "reciente" and a["permitido"] for a in s2["alternativas"]), "simulador: con el factor vencido se niega y dice qué lo arreglaría")

# --------------------------------------------------------------------------- cierre
titulo("9. Cierre de sesión y token")
e, _ = ana.pedir("POST", "/auth/logout/", {})
paso(e == 200, "Ana cierra sesión", e)
e, _ = ana.pedir("GET", "/tramites/?limite=1")
paso(e == 401, "su token ya no sirve tras cerrar la sesión (401)", e)

# --------------------------------------------------------------------------- 10. consolas de plataforma
titulo("10. Consolas de plataforma, control dual y recuperación de contraseña")
print("  (se espera un minuto: el límite de intentos de inicio de sesión es de 10 por minuto)")
time.sleep(62)
ivan, irene, sergio, silvia, ines = (Sesion(u) for u in ("ivan.identidades", "irene.identidades", "sergio.seguridad", "silvia.secretos", "ines.infra"))
for s in (ivan, irene, sergio, silvia, ines):
    e, _ = s.entrar()
    paso(e == 200, f"{s.usuario} entra", e)
_, yo_i = ivan.pedir("GET", "/auth/yo/")
paso("consola_identidades" in [m["id"] for m in yo_i["modulos"]] and all(m["estado"] == "disponible" for m in yo_i["modulos"]), "su consola figura como disponible en el menú que arma el servidor")
e, pers = ivan.pedir("GET", "/plataforma/personas/")
crudo = json.dumps(pers)
paso(e == 200 and len(pers["personas"]) >= 13 and not any(x in crudo for x in ("argon2", "password", "mfa_secreto", "cedula", "correo")), "identidades lista las personas sin hashes ni datos personales", e)
e, _ = ana.pedir("GET", "/plataforma/personas/")
paso(e in (401, 403), "la ciudadanía no entra a las consolas", e)
e, _ = ines.pedir("GET", "/plataforma/personas/")
paso(e == 403, "infraestructura no ve las personas (403)", e)
e, _ = ivan.pedir("GET", "/tramites/?limite=1")
paso(e == 403, "ninguna consola da acceso a trámites: identidades recibe 403", e)
e, _ = ivan.pedir("GET", "/plataforma/secretos/")
paso(e == 403, "identidades no ve los secretos (403)", e)

# Si una corrida anterior se interrumpió, quedó una propuesta pendiente igual: la otra persona de identidades la rechaza antes de empezar
_, previas = irene.pedir("GET", "/plataforma/aprobaciones/")
for pendiente in (previas or {}).get("aprobaciones", []):
    if pendiente["estado"] == "pendiente" and pendiente["objetivo"].get("usuario") == "beto.ciudadano" and pendiente["propuesto_por"]["usuario"] == "ivan.identidades":
        irene.pedir("POST", f"/plataforma/aprobaciones/{pendiente['id']}/resolver/", {"decision": "rechazar"})
e, alta = ivan.pedir("POST", "/plataforma/aprobaciones/", {"usuario": "beto.ciudadano", "institucion_id": mop})
paso(e == 201 and alta.get("id"), "identidades propone un alta de coordinadora", e)
e, _ = ivan.pedir("POST", f"/plataforma/aprobaciones/{alta['id']}/resolver/", {"decision": "aprobar"})
paso(e == 403, "CONTROL DUAL: quien propone no puede aprobar (403)", e)
e, _ = ines.pedir("POST", f"/plataforma/aprobaciones/{alta['id']}/resolver/", {"decision": "aprobar"})
paso(e == 403, "otro rol de plataforma tampoco aprueba (403)", e)
e, r = irene.pedir("POST", f"/plataforma/aprobaciones/{alta['id']}/resolver/", {"decision": "rechazar"})
paso(e == 200 and r["codigo"] == "alta_rechazada", "otra persona de identidades revisa y rechaza (el ensayo no deja altas aplicadas)", e)
e, r = irene.pedir("GET", "/plataforma/aprobaciones/")
fila = next((a for a in r["aprobaciones"] if a["id"] == alta["id"]), None) if e == 200 else None
paso(bool(fila) and fila["estado"] == "rechazada" and fila["propuesto_por"]["usuario"] == "ivan.identidades" and fila["resuelto_por"]["usuario"] == "irene.identidades", "queda registrado quién propuso y quién resolvió")

e, c = ivan.pedir("POST", f"/plataforma/personas/{next(p['id'] for p in pers['personas'] if p['usuario'] == 'beto.ciudadano')}/restablecer-contrasena/", {})
codigo = (c or {}).get("codigo_restablecimiento", "")
paso(e == 201 and len(codigo) == 14, "emite un código de restablecimiento (se muestra una sola vez)", e)
yo_id = yo_i["id"]
e, _ = ivan.pedir("POST", f"/plataforma/personas/{yo_id}/restablecer-contrasena/", {})
paso(e == 409, "nadie se emite un código a sí mismo (409)", e)
e, mala = ivan.pedir("POST", "/auth/restablecer/", {"username": "beto.ciudadano", "codigo": "AAAA-BBBB-CCCC", "password": "una-frase-larga-y-poco-comun-1234"})
e2, otra = ivan.pedir("POST", "/auth/restablecer/", {"username": "nadie.existe", "codigo": codigo, "password": "una-frase-larga-y-poco-comun-1234"})
paso(e == e2 == 400 and mala == otra, "un código inválido y un usuario inexistente responden IGUAL (no se enumera)", f"{e}/{e2}")
e, _ = ivan.pedir("POST", "/auth/restablecer/", {"username": "beto.ciudadano", "codigo": codigo, "password": "corta"})
paso(e == 400, "una contraseña débil se rechaza y NO gasta el código", e)

e, ev = sergio.pedir("GET", "/plataforma/eventos/")
paso(e == 200 and len(ev["eventos"]) > 5, "seguridad ve los eventos de seguridad recientes", e)
e, _ = sergio.pedir("POST", f"/plataforma/personas/{next(p['id'] for p in pers['personas'] if p['usuario'] == 'sergio.seguridad')}/bloquear/", {"motivo": "me bloqueo yo mismo"})
paso(e == 409, "nadie bloquea su propia cuenta (409)", e)
e, _ = ivan.pedir("POST", f"/plataforma/personas/{next(p['id'] for p in pers['personas'] if p['usuario'] == 'beto.ciudadano')}/bloquear/", {"motivo": "no me corresponde"})
paso(e == 403, "identidades no bloquea cuentas (403)", e)
e, _ = sergio.pedir("GET", "/plataforma/infraestructura/")
paso(e == 403, "seguridad no ve la infraestructura (403)", e)

e, sec = silvia.pedir("GET", "/plataforma/secretos/")
paso(e == 200 and len(sec["secretos"]) == 8 and "valor" not in json.dumps(sec), "el custodio ve el estado de sus 8 secretos, sin valores", e)
e, inf = ines.pedir("GET", "/plataforma/infraestructura/")
paso(e == 200 and inf["base"]["ok"] and inf["base"]["tls"] == "TLSv1.3", "infraestructura ve la base viva con la conexión cifrada TLS 1.3", inf["base"].get("tls") if e == 200 else e)
paso(e == 200 and inf["certificado"]["dias_restantes"] > 30, "y el certificado de nginx vence dentro de más de 30 días", inf["certificado"]["dias_restantes"] if e == 200 else e)

# --- las tres puertas (la semántica completa la prueba verificar_autenticacion; aquí lo observable desde fuera)
e, lista = ana.pedir("GET", "/auth/instituciones/")
paso(e == 200 and len(lista) >= 6 and all(set(i) == {"id", "nombre"} for i in lista), "la lista de instituciones de la puerta del personal es pública y solo trae id y nombre", e)
e, mala_puerta = ivan.pedir("POST", "/auth/login/", {"username": "ivan.identidades", "password": ivan.clave, "canal": "administrador"})
paso(e == 401 and mala_puerta["codigo"] == "credenciales_invalidas", "una puerta que no existe responde como cualquier credencial inválida", e)
e, sin_filtrar = ivan.pedir("POST", "/auth/login/", {"username": "fabio.mop", "password": "contraseña-equivocada-1234", "canal": "ciudadania"})
paso(e == 401 and sin_filtrar["codigo"] == "credenciales_invalidas" and "acceso_correcto" not in sin_filtrar, "equivocarse de puerta sin credenciales válidas no revela quién es personal de una institución", e)

malos = resultados.count(False)
print(f"\nENSAYO: {len(resultados) - malos} de {len(resultados)} comprobaciones correctas" + ("" if not malos else f"  ← {malos} FALLARON"))
print(f"Se creó el trámite #{tramite} (aprobado) y el #{t2['id']} (asignado a Flor) durante el ensayo; el #{propio['id']} es de Fabio.")
sys.exit(1 if malos else 0)
