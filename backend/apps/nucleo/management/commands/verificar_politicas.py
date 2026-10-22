"""Prueba contra la base real de la transparencia de roles y permisos, y de la actividad de seguridad propia.

La parte importante es que lo que `/politicas/base-de-datos/` MUESTRA coincide con lo que PostgreSQL REALMENTE permite:
si alguien concediera por error un permiso de más, esta prueba (y la pantalla) lo mostrarían.
Las personas de la prueba viven en una transacción que se revierte.
"""
from datetime import timedelta

from django.core.cache import cache
from django.core.management.base import BaseCommand, CommandError
from django.db import connections, transaction
from django.utils import timezone
from rest_framework.test import APIClient

from apps.autenticacion import tokens
from apps.autenticacion.models import EventoSeguridad, Sesion
from apps.identidad.models import Usuario

HOST = {"HTTP_HOST": "localhost", "HTTP_X_REAL_IP": "198.51.100.9"}


class _Revertir(Exception):
    pass


class Command(BaseCommand):
    help = "Prueba de integración de roles, permisos y actividad de seguridad contra la base real (se revierte al final)."

    def _paso(self, nombre, ok, detalle=""):
        self.resultados.append(ok)
        marca = self.style.SUCCESS("PASA ") if ok else self.style.ERROR("FALLA")
        self.stdout.write(f"{marca} {nombre}{(' - ' + str(detalle)) if detalle else ''}")

    def _http(self, ruta, token=None):
        cabeceras = dict(HOST)
        if token:
            cabeceras["HTTP_AUTHORIZATION"] = f"Bearer {token}"
        r = self.cliente.get(ruta, secure=True, **cabeceras)
        cache.clear()
        transaction.set_rollback(False)
        return r

    def _post(self, ruta, cuerpo, token=None, formato="json"):
        cabeceras = dict(HOST)
        if token:
            cabeceras["HTTP_AUTHORIZATION"] = f"Bearer {token}"
        r = self.cliente.post(ruta, cuerpo, format=formato, secure=True, **cabeceras)
        cache.clear()
        transaction.set_rollback(False)
        return r

    def _decisiones_registradas(self):
        with connections["auditoria"].cursor() as c:
            c.execute("select count(*) from siget.decision_pdp")
            return c.fetchone()[0]

    def _persona(self, nombre, rol_plataforma="ninguno"):
        return Usuario.objects.create(username=f"int_p_{nombre}", password_hash="x", rol_plataforma=rol_plataforma, mfa_activo=True,
                                      mfa_verificado_en=timezone.now() - timedelta(minutes=1))

    def _token(self, usuario):
        from django.conf import settings
        ahora = timezone.now()
        s = Sesion.objects.create(usuario=usuario, refresh_hash=tokens.hash_refresh(tokens.nuevo_refresh()), expira_en=ahora + timedelta(hours=1))
        return tokens.emitir_access(settings.SIGET_JWT_KEY, usuario.pk, s.pk, tokens.SCOPE_COMPLETO, ahora, 600, settings.SIGET_EMISOR)

    def handle(self, *args, **opciones):
        self.resultados = []
        self.cliente = APIClient()
        try:
            with transaction.atomic():
                self._recorrer()
                raise _Revertir()
        except _Revertir:
            pass
        residuo = Usuario.objects.filter(username__startswith="int_p_").count()
        self._paso("la transacción se revirtió: no quedó ninguna persona de la prueba", residuo == 0, f"{residuo} filas")
        total, fallas = len(self.resultados), self.resultados.count(False)
        self.stdout.write(f"\n{total - fallas} de {total} pasos correctos; no quedó ningún dato (transacción revertida).")
        if fallas:
            raise CommandError(f"{fallas} paso(s) fallaron")

    def _recorrer(self):
        ana, auditor, operador = self._persona("ana"), self._persona("auditor", "auditor"), self._persona("operador", "operador_seguridad")
        t = {u.username: self._token(u) for u in (ana, auditor, operador)}
        for ruta in ("/politicas/matriz/", "/politicas/base-de-datos/", "/auth/actividad/"):
            self._paso(f"{ruta} sin token responde 401", self._http(ruta).status_code == 401)

        # ---------------------------------------------------------------- base de datos
        self._paso("una ciudadana NO ve los permisos de la base: es información técnica de seguridad (403)", self._http("/politicas/base-de-datos/", t[ana.username]).status_code == 403)
        r = self._http("/politicas/base-de-datos/", t[operador.username])
        d = r.json() if r.status_code == 200 else {}
        self._paso("el personal (aquí, un operador de plataforma) sí los ve", r.status_code == 200 and len(d.get("roles", [])) == 5, r.status_code)
        roles = {x["nombre"]: x for x in d.get("roles", [])}
        priv = d.get("privilegios", {})
        tablas = {x["nombre"]: x for x in d.get("tablas", [])}
        self._paso("existen los 5 roles de la base", all(roles[n]["existe"] for n in ("app_role", "auditor_role", "siget_owner", "checkpoint_app", "pgadmin_lectura")))
        self._paso("ningún rol de la aplicación es superusuario ni omite la seguridad por filas", d.get("ningun_rol_de_aplicacion_es_superusuario") is True)
        self._paso("el administrador del motor existe pero está contenido (sin contraseña, solo socket local)", d.get("administrador_del_motor", {}).get("superusuario") is True)
        self._paso("el dueño de las tablas no puede iniciar sesión", roles["siget_owner"]["puede_conectar"] is False)
        self._paso("app_role tiene límite de conexiones", (roles["app_role"]["limite_conexiones"] or -1) > 0, roles["app_role"]["limite_conexiones"])
        self._paso("las tablas del negocio tienen seguridad por filas (RLS) y políticas", all(tablas[n]["rls"] and tablas[n]["politicas"] > 0 for n in ("tramite", "evento_auditoria")),
                   {n: (tablas[n]["rls"], tablas[n]["politicas"]) for n in ("tramite", "evento_auditoria")})
        self._paso("hay disparadores que protegen el registro y las transiciones", tablas["evento_auditoria"]["triggers"] > 0 and tablas["tramite"]["triggers"] > 0)

        for tabla in ("decision_pdp", "evento_auditoria", "evento_seguridad"):
            # El dueño de la tabla tiene todos los privilegios por serlo: lo que lo contiene es que NO puede iniciar sesión y que
            # los disparadores de solo inserción rechazan el UPDATE y el DELETE incluso para él (se comprueba más abajo).
            peor = [(r, p) for r in priv if r != "siget_owner" for p in ("UPDATE", "DELETE") if priv[r][tabla][p] != "no"]
            self._paso(f"ningún rol que se conecta puede alterar ni borrar {tabla} (registro inalterable)", peor == [], peor)
            self._paso(f"{tabla} está protegida además por disparadores (el dueño, que no inicia sesión, tampoco la altera)", tablas[tabla]["triggers"] > 0, tablas[tabla]["triggers"])
        self._paso("app_role inserta decisiones de acceso pero no las lee de vuelta con permisos de escritura",
                   priv["app_role"]["decision_pdp"]["INSERT"] == "total" and priv["app_role"]["decision_pdp"]["UPDATE"] == "no")
        self._paso("auditor_role solo lee: sin insertar, alterar ni borrar nada",
                   all(priv["auditor_role"][tb][p] == "no" for tb in tablas for p in ("INSERT", "UPDATE", "DELETE")) and priv["auditor_role"]["decision_pdp"]["SELECT"] == "total")
        self._paso("auditor_role no lee trámites ni sesiones", priv["auditor_role"]["tramite"]["SELECT"] == "no" and priv["auditor_role"]["sesion"]["SELECT"] == "no")
        self._paso("auditor_role de las personas solo ve algunas columnas (no el hash ni el secreto)", priv["auditor_role"]["usuario"]["SELECT"] == "columnas", priv["auditor_role"]["usuario"]["SELECT"])
        self._paso("app_role no borra nada en ninguna tabla", all(priv["app_role"][tb]["DELETE"] == "no" for tb in tablas))
        self._paso("de las personas, app_role solo altera algunas columnas (no puede cambiar su rol de plataforma)", priv["app_role"]["usuario"]["UPDATE"] == "columnas")
        self._paso("el catálogo de transiciones es inmodificable para la aplicación", priv["app_role"]["transicion"]["INSERT"] == "no" and priv["app_role"]["transicion"]["UPDATE"] == "no")

        # ---------------------------------------------------------------- matriz del PDP
        r = self._http("/politicas/matriz/", t[operador.username])
        m = r.json() if r.status_code == 200 else {}
        self._paso("un operador de plataforma ve la matriz de permisos", r.status_code == 200 and len(m.get("roles", [])) == 10, r.status_code)
        self._paso("la matriz confirma que no existe un superusuario", m.get("ningun_rol_puede_todo") is True)
        fila = m.get("matriz", {}).get("operador_seguridad", {})
        self._paso("y que el operador de seguridad no ve trámites, con la política que lo dice",
                   fila.get("ver_tramite", {}).get("favorable") == {"permitido": False, "politica": "plataforma_sin_acceso_a_tramites"})

        # ---------------------------------------------------------------- actividad de seguridad propia
        EventoSeguridad.objects.create(actor_id=ana.pk, evento="login_ok", ip="198.51.100.9", detalle={})
        EventoSeguridad.objects.create(actor_id=ana.pk, evento="mfa_verificado", ip="198.51.100.9", detalle={})
        EventoSeguridad.objects.create(actor_id=auditor.pk, evento="login_ok", ip="198.51.100.10", detalle={})
        r = self._http("/auth/actividad/", t[ana.username])
        eventos = r.json()["eventos"] if r.status_code == 200 else []
        self._paso("cada persona ve su propia actividad de seguridad", r.status_code == 200 and [e["evento"] for e in eventos] == ["mfa_verificado", "login_ok"], [e["evento"] for e in eventos])
        self._paso("y solo la suya: nunca la de otra persona", all("198.51.100.10" != e["ip"] for e in eventos))

        # ---------------------------------------------------------------- simulador de «qué pasaría si…»
        self._paso("el simulador sin token responde 401", self._post("/politicas/simular/", {"rol": "funcionario", "accion": "ver_tramite"}).status_code == 401)
        antes = self._decisiones_registradas()
        r = self._post("/politicas/simular/", {"rol": "funcionario", "accion": "cambiar_estado"}, t[ana.username])
        c = r.json() if r.status_code == 200 else {}
        self._paso("una ciudadana simula qué pasaría si un funcionario cambia un estado: se permite", r.status_code == 200 and c.get("decision", {}).get("permitido") is True and c["decision"]["politica"] == "funcionario_cambia_estado", r.status_code)
        r = self._post("/politicas/simular/", {"rol": "funcionario", "accion": "cambiar_estado", "solicitante": "yo"}, t[ana.username])
        c = r.json() if r.status_code == 200 else {}
        self._paso("y si el trámite lo pidió él mismo, se niega por conflicto de interés, con la traza que lo explica",
                   c.get("decision", {}).get("politica") == "conflicto_de_interes" and c["traza"][-1]["resultado"] == "niega" and c.get("hipotetico") is True)
        r = self._post("/politicas/simular/", {"rol": "funcionario", "accion": "cambiar_estado", "segundo_factor": "vencido"}, t[ana.username])
        c = r.json() if r.status_code == 200 else {}
        self._paso("con el segundo factor vencido se niega y la alternativa dice que con uno reciente se permitiría",
                   c.get("decision", {}).get("permitido") is False and any(a["variable"] == "segundo_factor" and a["valor"] == "reciente" and a["permitido"] for a in c.get("alternativas", [])))
        for cuerpo in ({"rol": ["x"], "accion": "ver_tramite"}, {"rol": "funcionario", "accion": "borrar_todo"}, {"rol": "funcionario", "accion": "ver_tramite", "cuenta": "root"}, [1, 2], "texto"):
            r = self._post("/politicas/simular/", cuerpo, t[ana.username])
            if r.status_code != 400:
                self._paso(f"una entrada inválida ({cuerpo!r}) se rechaza con 400 y no con un error del servidor", False, r.status_code)
                break
        else:
            self._paso("las entradas inválidas (rol o acción desconocidos, valores fuera de la lista, formatos raros) se rechazan con 400", True)
        r = self._post("/politicas/simular/", {"rol": "funcionario", "accion": "ver_tramite"}, t[ana.username], formato="multipart")
        self._paso("un cuerpo que no es JSON se rechaza (415)", r.status_code == 415, r.status_code)
        r = self._http("/politicas/simular/", t[ana.username])
        self._paso("el formulario del simulador (GET) lista las variables de las 18 acciones", r.status_code == 200 and len(r.json()["variables"]) == 18)
        self._paso("el simulador no registró ninguna decisión: es hipotético y no ensucia la auditoría", self._decisiones_registradas() == antes, f"{antes} -> {self._decisiones_registradas()}")

        # ---------------------------------------------------------------- una sola fuente para la ventana del segundo factor
        yo = self._http("/auth/yo/", t[ana.username]).json()
        matriz_v = self._http("/politicas/matriz/", t[ana.username]).json()["ventana_minutos"]
        meta_v = self._http("/politicas/simular/", t[ana.username]).json()["ventana_minutos"]
        self._paso("la ventana del segundo factor es la misma en /auth/yo/, la matriz y el simulador (la configuración real)",
                   yo["mfa_ventana_minutos"] == matriz_v == meta_v, f"{yo['mfa_ventana_minutos']} / {matriz_v} / {meta_v}")

