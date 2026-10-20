"""Recorrido de la API de trámites por HTTP contra la base real, en una transacción que se revierte.

Se mintean tokens directamente (la autenticación ya la cubre `verificar_autenticacion`) para armar personas con
distintos roles. Atraviesa todo: autenticación, límites, contexto RLS, PDP, base de datos y auditoría.
Las decisiones del PDP se capturan en memoria SOLO en esta prueba (escribirlas dejaría filas permanentes: la tabla
es de solo inserción); en producción van por una conexión aparte que no se revierte.
"""
from datetime import timedelta
from unittest import mock

from django.core.cache import cache
from django.core.management.base import BaseCommand, CommandError
from django.db import connection, connections, transaction
from django.utils import timezone
from rest_framework.test import APIClient

from apps.autenticacion import tokens
from apps.autenticacion.models import Sesion
from apps.autorizacion import permisos
from apps.catalogo.models import Institucion, TipoTramite
from apps.identidad.models import Membresia, Usuario

HOST = {"HTTP_HOST": "localhost", "HTTP_X_REAL_IP": "198.51.100.9"}


class _Revertir(Exception):
    pass


DECISIONES = []


def _capturar_decision(actor_id, accion, recurso, decision):
    """En producción las decisiones van por una conexión aparte (`decisiones`), que no se revierte aunque la petición
    sí. Aquí se capturan en memoria: escribirlas de verdad dejaría filas permanentes (la tabla es de solo inserción)."""
    DECISIONES.append((actor_id, accion.value, decision.permitido, decision.politica))


class Command(BaseCommand):
    help = "Prueba de integración de la API de trámites contra la base real (se revierte al final)."

    def _paso(self, nombre, ok, detalle=""):
        self.resultados.append(ok)
        marca = self.style.SUCCESS("PASA ") if ok else self.style.ERROR("FALLA")
        self.stdout.write(f"{marca} {nombre}{(' - ' + str(detalle)) if detalle else ''}")

    def _http(self, metodo, ruta, token=None, datos=None):
        cabeceras = dict(HOST)
        if token:
            cabeceras["HTTP_AUTHORIZATION"] = f"Bearer {token}"
        if metodo == "get":
            r = self.cliente.get(ruta, secure=True, **cabeceras)
        else:
            r = self.cliente.post(ruta, datos, format="json", secure=True, **cabeceras)
        cache.clear()
        transaction.set_rollback(False)  # DRF marca la transacción al rechazar; en producción cada petición tiene la suya
        return r

    def _persona(self, nombre, rol_plataforma="ninguno", mfa_hace_min=1):
        ahora = timezone.now()
        return Usuario.objects.create(username=f"int_t_{nombre}", password_hash="x", rol_plataforma=rol_plataforma, mfa_activo=True,
                                      mfa_verificado_en=ahora - timedelta(minutes=mfa_hace_min))

    def _token(self, usuario, scope=tokens.SCOPE_COMPLETO):
        ahora = timezone.now()
        s = Sesion.objects.create(usuario=usuario, refresh_hash=tokens.hash_refresh(tokens.nuevo_refresh()), expira_en=ahora + timedelta(hours=1))
        from django.conf import settings
        return tokens.emitir_access(settings.SIGET_JWT_KEY, usuario.pk, s.pk, scope, ahora, 600, settings.SIGET_EMISOR)

    def handle(self, *args, **opciones):
        self.resultados = []
        self.cliente = APIClient()
        try:
            with transaction.atomic(), mock.patch.object(permisos, "_registrar_decision", _capturar_decision):
                self._recorrer()
                raise _Revertir()
        except _Revertir:
            pass
        residuo = Usuario.objects.filter(username__startswith="int_t_").count()
        self._paso("la transacción se revirtió: no quedó ninguna persona de la prueba", residuo == 0, f"{residuo} filas")
        total, fallas = len(self.resultados), self.resultados.count(False)
        self.stdout.write(f"\n{total - fallas} de {total} pasos correctos; no quedó ningún dato (transacción revertida).")
        if fallas:
            raise CommandError(f"{fallas} paso(s) fallaron")

    def _recorrer(self):
        mop = Institucion.objects.get(nombre="MOP")
        minsa = Institucion.objects.get(nombre="MINSA")
        tipo_mop = TipoTramite.objects.get(institucion=mop)
        tipo_minsa = TipoTramite.objects.get(institucion=minsa)

        coord = self._persona("coord")
        ana, beto = self._persona("ana"), self._persona("beto")
        func_mop, func2_mop, super_mop, func_minsa = (self._persona(n) for n in ("func_mop", "func2_mop", "super_mop", "func_minsa"))
        operador = self._persona("operador", rol_plataforma="operador_infraestructura")
        for u, inst, rol in ((func_mop, mop, "funcionario"), (func2_mop, mop, "funcionario"), (super_mop, mop, "supervisor"), (func_minsa, minsa, "funcionario")):
            Membresia.objects.create(usuario=u, institucion=inst, rol=rol, asignado_por=coord)
        t = {u.username: self._token(u) for u in (ana, beto, func_mop, func2_mop, super_mop, func_minsa, operador)}
        tok = lambda u: t[u.username]  # noqa: E731

        # ---------------------------------------------------------------- acceso y catálogo
        self._paso("sin token se responde 401", self._http("get", "/tramites/").status_code == 401)
        enrolar = self._token(ana, tokens.SCOPE_ENROLAR_MFA)
        self._paso("un token de enrolamiento no sirve para la API de trámites", self._http("get", "/tramites/", enrolar).status_code == 403)
        DECISIONES.clear()
        r = self._http("get", "/tramites/", tok(operador))
        self._paso("un operador de plataforma no accede a trámites (el PDP lo niega)", r.status_code == 403, r.status_code)
        self._paso("y esa denegación quedó registrada, con la política que la motivó",
                   [(d[2], d[3]) for d in DECISIONES] == [(False, "plataforma_sin_acceso_a_tramites")], DECISIONES)

        r = self._http("get", "/catalogo/instituciones/", tok(ana))
        self._paso("el catálogo lista las 6 instituciones", r.status_code == 200 and len(r.json()) >= 6, len(r.json()) if r.status_code == 200 else r.status_code)
        r = self._http("get", f"/catalogo/tipos-tramite/?institucion={mop.pk}", tok(ana))
        self._paso("el catálogo se filtra por institución", r.status_code == 200 and len(r.json()) == 1 and r.json()[0]["sla_dias"] == 10)
        self._paso("un filtro inválido se rechaza", self._http("get", "/catalogo/tipos-tramite/?institucion=abc", tok(ana)).status_code == 400)

        # ---------------------------------------------------------------- crear
        r = self._http("post", "/tramites/", tok(ana), {"tipo_tramite": tipo_mop.pk})
        cuerpo = r.json()
        self._paso("la ciudadana crea un trámite", r.status_code == 201 and cuerpo["estado"] == "Pendiente", r.status_code)
        tramite_ana = cuerpo["id"]
        self._paso("el plazo se calcula con el SLA del catálogo (10 días)", cuerpo["fecha_limite"] is not None and cuerpo["vencido"] is False)
        self._paso("la ciudadana no ve datos de otras personas en su propio trámite", "solicitante_id" not in cuerpo and "funcionario_asignado_id" not in cuerpo and cuerpo["asignado"] is False)
        r = self._http("post", "/tramites/", tok(ana), {"tipo_tramite": tipo_mop.pk, "solicitante": beto.pk, "solicitante_id": beto.pk,
                                                        "estado": "Aprobado", "funcionario_asignado_id": func_mop.pk})
        self._paso("los campos que no le corresponden se ignoran (no puede fijar solicitante, estado ni asignado)",
                   r.status_code == 201 and r.json()["estado"] == "Pendiente" and r.json()["asignado"] is False)
        self._paso("un trámite inexistente en el catálogo da 404", self._http("post", "/tramites/", tok(ana), {"tipo_tramite": 999999}).status_code == 404)
        for malo in ("1", True, 1.5, None, [1], -3, 10**30):
            if self._http("post", "/tramites/", tok(ana), {"tipo_tramite": malo}).status_code != 400:
                self._paso(f"un tipo de trámite inválido ({malo!r}) se rechaza", False)
                break
        else:
            self._paso("un tipo de trámite inválido (texto, booleano, decimal, nulo, lista, negativo, enorme) se rechaza con 400", True)
        self._paso("un cuerpo que no es un objeto se rechaza", self._http("post", "/tramites/", tok(ana), [1, 2]).status_code == 400)
        r = self._http("post", "/tramites/", tok(beto), {"tipo_tramite": tipo_minsa.pk})
        tramite_beto_minsa = r.json()["id"]

        # ---------------------------------------------------------------- quién ve qué (RLS)
        def cuantos(persona):
            r = self._http("get", "/tramites/", tok(persona))
            return len(r.json()["resultados"]) if r.status_code == 200 else f"HTTP {r.status_code}"
        self._paso("la ciudadana ve solo sus 2 trámites", cuantos(ana) == 2, cuantos(ana))
        self._paso("el funcionario del MOP ve los 2 del MOP (su institución), no el del MINSA", cuantos(func_mop) == 2, cuantos(func_mop))
        self._paso("el funcionario del MINSA ve solo el del MINSA", cuantos(func_minsa) == 1, cuantos(func_minsa))
        self._paso("la segunda ciudadana ve solo el suyo", cuantos(beto) == 1, cuantos(beto))
        r = self._http("get", "/tramites/", tok(func_mop))
        self._paso("el personal ve los datos internos; la ciudadana no", "solicitante_id" in r.json()["resultados"][0])

        self._paso("el solicitante ve el detalle de su trámite", self._http("get", f"/tramites/{tramite_ana}/", tok(ana)).status_code == 200)
        self._paso("otra ciudadana recibe 404 (no se revela que existe)", self._http("get", f"/tramites/{tramite_ana}/", tok(beto)).status_code == 404)
        self._paso("el personal de otra institución recibe 404", self._http("get", f"/tramites/{tramite_ana}/", tok(func_minsa)).status_code == 404)
        self._paso("el personal de la institución lo ve", self._http("get", f"/tramites/{tramite_ana}/", tok(func_mop)).status_code == 200)
        self._paso("un id enorme no rompe nada (404)", self._http("get", f"/tramites/{10**30}/", tok(ana)).status_code == 404)
        self._paso("una paginación inválida se rechaza", self._http("get", "/tramites/?limite=0", tok(ana)).status_code == 400 and self._http("get", "/tramites/?limite=1", tok(ana)).json()["limite"] == 1)

        # ---------------------------------------------------------------- cambio de estado
        r = self._http("post", f"/tramites/{tramite_ana}/estado/", tok(ana), {"estado": "En Tramitacion"})
        self._paso("la ciudadana no puede cambiar el estado", r.status_code == 403)
        Usuario.objects.filter(pk=func_mop.pk).update(mfa_verificado_en=timezone.now() - timedelta(minutes=20))
        r = self._http("post", f"/tramites/{tramite_ana}/estado/", tok(func_mop), {"estado": "En Tramitacion"})
        self._paso("con el segundo factor vencido (20 min) se niega y se sugiere reautenticar (con un booleano de verdad)", r.status_code == 403 and r.json().get("reautenticacion_sugerida") is True, r.json())
        Usuario.objects.filter(pk=func_mop.pk).update(mfa_verificado_en=timezone.now() - timedelta(minutes=2))
        r = self._http("post", f"/tramites/{tramite_ana}/estado/", tok(func_mop), {"estado": "Aprobado"})
        self._paso("saltarse un paso (Pendiente a Aprobado) se niega", r.status_code == 403)
        for malo in ({"estado": "Inventado"}, {}, {"estado": 5}, {"estado": None}):
            if self._http("post", f"/tramites/{tramite_ana}/estado/", tok(func_mop), malo).status_code != 400:
                self._paso(f"un estado inválido ({malo}) se rechaza", False)
                break
        else:
            self._paso("un estado inexistente, ausente o que no es texto se rechaza con 400", True)
        r = self._http("post", f"/tramites/{tramite_ana}/estado/", tok(func_minsa), {"estado": "En Tramitacion"})
        self._paso("el personal de otra institución recibe 404 al intentar cambiarlo", r.status_code == 404)
        r = self._http("post", f"/tramites/{tramite_ana}/estado/", tok(func_mop), {"estado": "En Tramitacion"})
        self._paso("el funcionario con el segundo factor reciente lo pasa a En Tramitación", r.status_code == 200 and r.json()["estado"] == "En Tramitacion", r.status_code)

        # conflicto de interés: una persona que es funcionaria y también pidió un trámite
        r = self._http("post", "/tramites/", tok(func_mop), {"tipo_tramite": tipo_mop.pk})
        propio = r.json()["id"]
        r = self._http("post", f"/tramites/{propio}/estado/", tok(func_mop), {"estado": "En Tramitacion"})
        self._paso("un funcionario no gestiona un trámite que él mismo pidió (conflicto de interés)", r.status_code == 403)

        # ---------------------------------------------------------------- reasignación
        r = self._http("post", f"/tramites/{tramite_ana}/reasignar/", tok(func_mop), {"funcionario_id": func2_mop.pk})
        self._paso("un funcionario no puede reasignar (solo el supervisor)", r.status_code == 403)
        for malo in ({"funcionario_id": func_minsa.pk}, {"funcionario_id": ana.pk}, {"funcionario_id": "x"}, {}):
            if self._http("post", f"/tramites/{tramite_ana}/reasignar/", tok(super_mop), malo).status_code != 400:
                self._paso(f"una reasignación inválida ({malo}) se rechaza", False)
                break
        else:
            self._paso("reasignar a otra institución, al solicitante o con datos inválidos se rechaza con 400", True)
        r = self._http("post", f"/tramites/{tramite_ana}/reasignar/", tok(super_mop), {"funcionario_id": func2_mop.pk})
        self._paso("el supervisor reasigna a personal de su institución", r.status_code == 200 and r.json()["funcionario_asignado_id"] == func2_mop.pk, r.status_code)
        r = self._http("post", f"/tramites/{tramite_ana}/estado/", tok(func_mop), {"estado": "Aprobado"})
        self._paso("un funcionario no mueve un trámite asignado a otro", r.status_code == 403)
        Usuario.objects.filter(pk=super_mop.pk).update(mfa_verificado_en=timezone.now() - timedelta(minutes=1))
        r = self._http("post", f"/tramites/{tramite_ana}/estado/", tok(super_mop), {"estado": "Aprobado"})
        self._paso("el supervisor sí, aunque esté asignado a otro", r.status_code == 200 and r.json()["estado"] == "Aprobado", r.status_code)
        r = self._http("post", f"/tramites/{tramite_ana}/estado/", tok(super_mop), {"estado": "Rechazado"})
        self._paso("un estado final no admite más cambios", r.status_code == 403)

        # ---------------------------------------------------------------- historial
        r = self._http("get", f"/tramites/{tramite_ana}/historial/", tok(ana))
        eventos = r.json()["eventos"]
        acciones = [e["accion"] for e in eventos]
        self._paso("el solicitante ve el historial completo de su trámite, en orden",
                   r.status_code == 200 and acciones == ["creacion", "cambio_estado", "reasignacion", "cambio_estado"], acciones)
        self._paso("pero sin saber quién actuó ni el detalle interno", all("actor_id" not in e and "atributos" not in e for e in eventos))
        r = self._http("get", f"/tramites/{tramite_ana}/historial/", tok(func_mop))
        self._paso("el personal ve quién actuó en cada paso", all("actor_id" in e for e in r.json()["eventos"]) and r.json()["eventos"][1]["actor_id"] == func_mop.pk)
        self._paso("otra ciudadana recibe 404 al pedir el historial", self._http("get", f"/tramites/{tramite_ana}/historial/", tok(beto)).status_code == 404)

        # ---------------------------------------------------------------- decisiones registradas
        negadas = [d for d in DECISIONES if d[2] is False]
        permitidas = [d for d in DECISIONES if d[2] is True]
        self._paso("cada decisión del PDP, permitida o negada, quedó registrada", len(negadas) >= 6 and len(permitidas) >= 8, f"{len(permitidas)} permitidas y {len(negadas)} negadas")
        politicas = {d[3] for d in DECISIONES}
        self._paso("con la política que la motivó",
                   {"conflicto_de_interes", "sin_regla_que_permita", "funcionario_cambia_estado"} <= politicas, sorted(politicas))
        # La propiedad que importa en producción: las decisiones NO van por la conexión de la petición
        principal, aparte = connections["default"], connections["decisiones"]
        self._paso("las decisiones usan una conexión distinta, en autocommit y fuera de toda transacción",
                   principal is not aparte and aparte.get_autocommit() and not aparte.in_atomic_block)
        with connection.cursor() as c:
            c.execute("select current_user, (select rolsuper from pg_roles where rolname = current_user)")
            usuario_bd, es_super = c.fetchone()
        self._paso("todo se ejecutó como app_role, sin superusuario", usuario_bd == "app_role" and not es_super)
