"""Prueba de la consola de auditoría contra la base real.

Dos cosas distintas:
1. La CONEXIÓN de auditoría (`auditor_role`) por sí sola: puede leer el registro y NO puede escribir, borrar ni leer
   secretos. Es la barrera de la base de datos: vale aunque el código del backend tuviera un error.
2. La API por HTTP: solo el auditor con nivel de aseguramiento 3 y segundo factor reciente; el resto recibe 403.

Las personas de la prueba viven en una transacción que se revierte; la consola lee por otra conexión, así que ve los
datos ya guardados (los de la demostración), no los de la prueba. Las decisiones del PDP se capturan en memoria.
"""
from datetime import timedelta
from unittest import mock

from django.core.cache import cache
from django.core.management.base import BaseCommand, CommandError
from django.db import DatabaseError, connections, transaction
from django.utils import timezone
from rest_framework.test import APIClient

from apps.autenticacion import tokens
from apps.autenticacion.models import Sesion
from apps.autorizacion import permisos
from apps.catalogo.models import Institucion
from apps.identidad.models import Membresia, Usuario

HOST = {"HTTP_HOST": "localhost", "HTTP_X_REAL_IP": "198.51.100.9"}
DECISIONES = []


class _Revertir(Exception):
    pass


def _capturar(actor_id, accion, recurso, decision):
    DECISIONES.append((actor_id, accion.value, decision.permitido, decision.politica))


class Command(BaseCommand):
    help = "Prueba de integración de la consola de auditoría contra la base real (se revierte al final)."

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

    def _persona(self, nombre, rol_plataforma="ninguno", nivel=1, mfa_hace_min=1):
        return Usuario.objects.create(username=f"int_a_{nombre}", password_hash="x", rol_plataforma=rol_plataforma, mfa_activo=True,
                                      nivel_aseguramiento=nivel, mfa_verificado_en=timezone.now() - timedelta(minutes=mfa_hace_min))

    def _token(self, usuario):
        from django.conf import settings
        ahora = timezone.now()
        s = Sesion.objects.create(usuario=usuario, refresh_hash=tokens.hash_refresh(tokens.nuevo_refresh()), expira_en=ahora + timedelta(hours=1))
        return tokens.emitir_access(settings.SIGET_JWT_KEY, usuario.pk, s.pk, tokens.SCOPE_COMPLETO, ahora, 600, settings.SIGET_EMISOR)

    def handle(self, *args, **opciones):
        self.resultados = []
        self.cliente = APIClient()
        self._conexion_de_auditoria()
        DECISIONES.clear()
        try:
            with transaction.atomic(), mock.patch.object(permisos, "_registrar_decision", _capturar):
                self._api()
                raise _Revertir()
        except _Revertir:
            pass
        residuo = Usuario.objects.filter(username__startswith="int_a_").count()
        self._paso("la transacción se revirtió: no quedó ninguna persona de la prueba", residuo == 0, f"{residuo} filas")
        total, fallas = len(self.resultados), self.resultados.count(False)
        self.stdout.write(f"\n{total - fallas} de {total} pasos correctos; no quedó ningún dato (transacción revertida).")
        if fallas:
            raise CommandError(f"{fallas} paso(s) fallaron")

    # ------------------------------------------------------------------ la barrera de la base de datos

    def _intentar(self, sql):
        """True si la base RECHAZA la sentencia por falta de permisos. Corre dentro de una transacción que SIEMPRE se
        revierte: si un permiso estuviera mal y la sentencia prosperara, la prueba no dañaría ningún dato."""
        try:
            with transaction.atomic(using="auditoria"):
                with connections["auditoria"].cursor() as c:
                    c.execute(sql)
                raise _Revertir()
        except _Revertir:
            return False  # la base la dejó pasar: es un fallo
        except DatabaseError as error:
            return any(t in str(error) for t in ("permission denied", "permiso denegado", "row-level security", "must be owner", "debe ser due"))

    def _conexion_de_auditoria(self):
        conexion = connections["auditoria"]
        with conexion.cursor() as c:
            c.execute("select current_user, (select rolsuper or rolbypassrls from pg_roles where rolname = current_user)")
            usuario, privilegiado = c.fetchone()
            self._paso("la consola se conecta como auditor_role, sin superusuario ni BYPASSRLS", usuario == "auditor_role" and not privilegiado, usuario)
            c.execute("select count(*) from siget.decision_pdp")
            n_dec = c.fetchone()[0]
            c.execute("select count(*) from siget.evento_auditoria")
            n_ev = c.fetchone()[0]
            c.execute("select count(*) from siget.evento_seguridad")
            n_seg = c.fetchone()[0]
            c.execute("select id, username from siget.usuario limit 1")
            persona = c.fetchone()
        self._paso("puede leer el registro: decisiones, eventos de trámites y de seguridad", n_dec > 0 and n_ev > 0 and n_seg > 0, f"{n_dec} / {n_ev} / {n_seg}")
        self._paso("y el nombre de quien actuó (solo id y usuario)", persona is not None)
        rechazos = {
            "insertar decisiones": "insert into siget.decision_pdp (accion, permitido) values ('x', true)",
            "alterar decisiones": "update siget.decision_pdp set permitido = true",
            "borrar eventos de trámites": "delete from siget.evento_auditoria",
            "borrar eventos de seguridad": "delete from siget.evento_seguridad",
            "alterar un trámite": "update siget.tramite set estado = 'Aprobado'",
            "leer trámites": "select id from siget.tramite limit 1",
            "leer hashes de contraseña": "select password_hash from siget.usuario limit 1",
            "leer secretos del segundo factor": "select mfa_secreto from siget.usuario limit 1",
            "leer sesiones": "select refresh_hash from siget.sesion limit 1",
            "crear personas": "insert into siget.usuario (username, password_hash) values ('x', 'x')",
            "borrar una tabla": "drop table siget.decision_pdp",
        }
        for nombre, sql in rechazos.items():
            self._paso(f"la base le NIEGA {nombre}", self._intentar(sql))

    # ------------------------------------------------------------------ la API

    def _api(self):
        mop = Institucion.objects.get(nombre="MOP")
        auditor = self._persona("auditor", "auditor", nivel=3)
        auditor_bajo = self._persona("auditor_bajo", "auditor", nivel=2)
        auditor_viejo = self._persona("auditor_viejo", "auditor", nivel=3, mfa_hace_min=40)
        operador = self._persona("operador", "operador_seguridad", nivel=2)
        func = self._persona("func")
        Membresia.objects.create(usuario=func, institucion=mop, rol="funcionario", asignado_por=operador)
        ciudadana = self._persona("ciudadana")
        tok = {u.username: self._token(u) for u in (auditor, auditor_bajo, auditor_viejo, operador, func, ciudadana)}

        for ruta in ("/auditoria/resumen/", "/auditoria/decisiones/", "/auditoria/seguridad/", "/auditoria/tramites/"):
            self._paso(f"{ruta} sin token responde 401", self._http(ruta).status_code == 401)
        sin_acceso = (("la ciudadana", ciudadana), ("el funcionario", func), ("un operador de seguridad", operador),
                      ("un auditor con nivel de aseguramiento 2", auditor_bajo))
        for quien, persona in sin_acceso:
            r = self._http("/auditoria/decisiones/", tok[persona.username])
            self._paso(f"{quien} no accede a la auditoría (403)", r.status_code == 403, r.status_code)
        r = self._http("/auditoria/resumen/", tok[auditor_viejo.username])
        self._paso("un auditor con el segundo factor vencido recibe 403 y se le sugiere reautenticar",
                   r.status_code == 403 and r.json().get("reautenticacion_sugerida") is True, r.json())

        DECISIONES.clear()
        r = self._http("/auditoria/resumen/", tok[auditor.username])
        resumen = r.json() if r.status_code == 200 else {}
        d = resumen.get("decisiones", {})
        self._paso("el auditor ve el resumen", r.status_code == 200 and d.get("total", 0) > 0 and d.get("permitidas", 0) + d.get("negadas", 0) == d.get("total"), d)
        self._paso("con las políticas que más negaron", len(resumen.get("por_politica", [])) > 0 and "denegaciones_por_persona" in resumen)
        self._paso("quién audita al auditor: su consulta quedó registrada como una decisión permitida",
                   (auditor.pk, "consultar_decisiones", True, "auditor_consulta") in DECISIONES, DECISIONES)

        r = self._http("/auditoria/decisiones/?limite=5", tok[auditor.username])
        cuerpo = r.json() if r.status_code == 200 else {}
        self._paso("lista las decisiones paginadas, de la más reciente a la más antigua",
                   r.status_code == 200 and len(cuerpo["resultados"]) == 5 and cuerpo["total"] >= 5
                   and [x["id"] for x in cuerpo["resultados"]] == sorted((x["id"] for x in cuerpo["resultados"]), reverse=True))
        r = self._http("/auditoria/decisiones/?resultado=negadas&limite=100", tok[auditor.username])
        filas = r.json()["resultados"] if r.status_code == 200 else []
        self._paso("filtra solo las negadas", r.status_code == 200 and filas and all(f["permitido"] is False for f in filas), len(filas))
        pol = filas[0]["politica"] if filas else "x"
        r = self._http(f"/auditoria/decisiones/?politica={pol}&limite=100", tok[auditor.username])
        self._paso("filtra por política", r.status_code == 200 and all(f["politica"] == pol for f in r.json()["resultados"]), pol)
        r = self._http("/auditoria/seguridad/?limite=10", tok[auditor.username])
        self._paso("lista los eventos de seguridad", r.status_code == 200 and len(r.json()["resultados"]) > 0)
        r = self._http("/auditoria/tramites/?limite=10", tok[auditor.username])
        self._paso("lista los eventos de los trámites, con quién actuó", r.status_code == 200 and any(e["actor"] for e in r.json()["resultados"]))

        for filtro in ("resultado=todas", "politica=a;drop", "actor=-1", "actor=abc", "limite=0", "limite=101", "desplazamiento=-1"):
            r = self._http(f"/auditoria/decisiones/?{filtro}", tok[auditor.username])
            if r.status_code != 400:
                self._paso(f"un filtro inválido ({filtro}) se rechaza", False, r.status_code)
                break
        else:
            self._paso("los filtros inválidos (valores raros, inyección, límites) se rechazan con 400", True)

        todo = " ".join(self._http(ruta, tok[auditor.username]).content.decode() for ruta in
                        ("/auditoria/resumen/", "/auditoria/decisiones/?limite=100", "/auditoria/seguridad/?limite=100", "/auditoria/tramites/?limite=100")).lower()
        self._paso("ninguna respuesta contiene hashes ni secretos", "argon2" not in todo and "mfa_secreto" not in todo and "password_hash" not in todo and "refresh_hash" not in todo)
