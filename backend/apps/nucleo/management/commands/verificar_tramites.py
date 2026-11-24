"""Recorrido de la API de trámites por HTTP contra la base real, en una transacción que se revierte.

Se mintean tokens directamente (la autenticación ya la cubre `verificar_autenticacion`) para armar personas con
distintos roles. Atraviesa todo: autenticación, límites, contexto RLS, PDP, base de datos y auditoría.
Las decisiones del PDP se capturan en memoria SOLO en esta prueba (escribirlas dejaría filas permanentes: la tabla
es de solo inserción); en producción van por una conexión aparte que no se revierte.
"""
import os
import pathlib
import tempfile
from datetime import datetime, timedelta
from unittest import mock

from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management.base import BaseCommand, CommandError
from django.db import DatabaseError, connection, connections, transaction
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from apps.auditoria.models import EventoAuditoria
from apps.autenticacion import contrasenas, tokens
from apps.autenticacion.models import Sesion
from apps.autorizacion import permisos
from apps.catalogo.models import Institucion, TipoTramite, feriados_entre
from apps.identidad.models import Membresia, Usuario
from apps.nucleo.contexto import fijar_contexto
from apps.tramites.formulario import datos_de_ejemplo
from apps.tramites.models import Documento, Tramite
from apps.tramites.serializacion import sumar_dias_habiles

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
        return Usuario.objects.create(username=f"int_t_{nombre}", password_hash=contrasenas.inutilizable(), rol_plataforma=rol_plataforma, mfa_activo=True,
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

    # ------------------------------------------------------------------ contenido del trámite (migración 017)

    def _bd(self, usuario, instituciones, accion, motivo=None):
        """Ejecuta `accion` (un UPDATE directo, sin pasar por la API) como `usuario`, con su contexto de seguridad por filas y el motivo
        dado (None = ninguno), en su PROPIO atomic(): un error de la base no estropea la transacción de la prueba.
        Devuelve (error, filas): el DatabaseError que lanzó la base (o None) y las filas afectadas."""
        try:
            with transaction.atomic():
                fijar_contexto(usuario.pk, instituciones)
                if motivo is not None:  # sin motivo NO se limpia nada: así se comprueba que el de un UPDATE anterior no se arrastra
                    with connection.cursor() as c:
                        c.execute("SELECT set_config('siget.motivo', %s, true)", [motivo])
                return None, accion()
        except DatabaseError as error:
            return error, 0

    @staticmethod
    def _dice(error, fragmento):
        return error is not None and fragmento in str(error).lower()

    def _contenido(self, mop, tipo_mop, ana, beto, func_mop, super_mop, func_minsa, operador, coordinador, tok):
        h = lambda metodo, ruta, persona, datos=None: self._http(metodo, ruta, tok(persona), datos)  # noqa: E731
        Usuario.objects.filter(pk__in=[func_mop.pk, super_mop.pk]).update(mfa_verificado_en=timezone.now() - timedelta(minutes=1))

        def tramite(pk):
            fijar_contexto(func_mop.pk, [mop.pk])
            return Tramite.objects.get(pk=pk)

        def eventos(pk):
            fijar_contexto(func_mop.pk, [mop.pk])
            return list(EventoAuditoria.objects.filter(tramite_id=pk).order_by("id"))

        def crear_en(estado, motivo="Falta el plano firmado del terreno."):
            """Un trámite de la ciudadana llevado por la API hasta `estado` (Pendiente, En Tramitacion o En Subsanacion)."""
            r = h("post", "/tramites/", ana, {"tipo_tramite": tipo_mop.pk, "datos": datos_de_ejemplo(tipo_mop.formulario)})
            pk = r.json()["id"]
            if estado != "Pendiente":
                h("post", f"/tramites/{pk}/estado/", func_mop, {"estado": "En Tramitacion"})
            if estado == "En Subsanacion":
                h("post", f"/tramites/{pk}/estado/", func_mop, {"estado": "En Subsanacion", "motivo": motivo})
            return pk

        ORIGINAL = {"asunto": "Bache frente a la escuela", "descripcion": "Hace tres semanas que el hueco crece."}

        # ---------------------------------------------------------------- crear con datos
        r = h("get", f"/catalogo/tipos-tramite/?institucion={mop.pk}", ana)
        self._paso("el catálogo devuelve el formulario de cada trámite (lista de campos con id, etiqueta, tipo y obligatorio)",
                   r.status_code == 200 and all(isinstance(t["formulario"], list) and t["formulario"] and all({"id", "etiqueta", "tipo", "obligatorio"} <= set(c) for c in t["formulario"])
                                                 for t in r.json()))
        antes = h("get", "/tramites/?limite=100", ana).json()["resultados"]
        r = h("post", "/tramites/", ana, {"tipo_tramite": tipo_mop.pk, "datos": {"asunto": "  Bache frente a la escuela  ", "descripcion": ORIGINAL["descripcion"]}})
        tc = r.json().get("id")
        self._paso("la ciudadana crea un trámite con los datos de su formulario (se quitan los espacios de los bordes)",
                   r.status_code == 201 and r.json()["datos"] == ORIGINAL and r.json()["formulario"] == tipo_mop.formulario, r.status_code)
        self._paso("el contenido queda guardado en la base", tramite(tc).datos == ORIGINAL)
        self._paso("el detalle devuelve los datos y el formulario a la ciudadana y al personal de la institución",
                   all(h("get", f"/tramites/{tc}/", p).json().get("datos") == ORIGINAL and h("get", f"/tramites/{tc}/", p).json().get("formulario") == tipo_mop.formulario for p in (ana, func_mop)))
        self._paso("el listado no lleva el contenido (solo el detalle)", all("datos" not in t for t in h("get", "/tramites/?limite=100", ana).json()["resultados"]))
        invalidos = (({}, "asunto", "obligatorio ausente"), ({"asunto": "   "}, "asunto", "obligatorio en blanco"), ({"asunto": 5}, "asunto", "texto que es un número"),
                     ({"asunto": ["a"]}, "asunto", "texto que es una lista"), ({"asunto": {"a": 1}}, "asunto", "texto que es un objeto"),
                     ({"asunto": "x" * 151}, "asunto", "texto más largo que el máximo"), ({"asunto": "a\u202eb"}, "asunto", "carácter de control bidireccional"),
                     ({"asunto": "a\x00b"}, "asunto", "carácter nulo"), ({"asunto": "ok", "cedula": "8-123-456"}, "datos", "campo desconocido"),
                     ({"asunto": "ok", "descripcion": "d" * 2001}, "descripcion", "texto largo más largo que el máximo"))
        fallas = [motivo for datos, campo, motivo in invalidos
                  if (lambda r: r.status_code != 400 or r.json().get("codigo") != "datos_invalidos" or campo not in r.json().get("errores", {}))(h("post", "/tramites/", ana, {"tipo_tramite": tipo_mop.pk, "datos": datos}))]
        self._paso("datos inválidos (faltantes, de otro tipo, demasiado largos, con caracteres de control o campos de más) se rechazan con 400 y el error por campo", not fallas, fallas)
        fallas = [str(malo)[:20] for malo in ([], "texto", 5, True, [{"asunto": "a"}])
                  if h("post", "/tramites/", ana, {"tipo_tramite": tipo_mop.pk, "datos": malo}).status_code != 400]
        self._paso("`datos` que no es un objeto se rechaza con 400", not fallas, fallas)
        despues = h("get", "/tramites/?limite=100", ana).json()["resultados"]
        self._paso("los intentos inválidos no crearon ningún trámite", len(despues) == len(antes) + 1, f"{len(antes)} antes, {len(despues)} después")
        permiso = TipoTramite.objects.get(nombre="Permiso de Construcción Municipal")
        valido = {"direccion_terreno": "Calle 5, casa 10", "numero_finca": "123456", "tipo_obra": "Remodelación", "area_m2": 120.5}
        r = h("post", "/tramites/", ana, {"tipo_tramite": permiso.pk, "datos": valido})
        self._paso("un trámite con selección y números guarda los valores normalizados", r.status_code == 201 and r.json()["datos"] == valido, r.status_code)
        fallas = [motivo for cambio, motivo in (({"tipo_obra": "Castillo"}, "opción fuera de la lista"), ({"area_m2": "120"}, "número como texto"),
                                                ({"area_m2": True}, "booleano como número"), ({"area_m2": -1}, "número negativo"),
                                                ({"area_m2": 100001}, "número sobre el máximo"))
                  if h("post", "/tramites/", ana, {"tipo_tramite": permiso.pk, "datos": {**valido, **cambio}}).status_code != 400]
        self._paso("opciones fuera de la lista y números inválidos (texto, booleano, negativo, sobre el máximo) se rechazan", not fallas, fallas)
        denuncia = TipoTramite.objects.get(nombre="Solicitud o denuncia ciudadana")
        manana = (timezone.now() + timedelta(days=2)).date().isoformat()
        fallas = [str(f) for f in (manana, "2026-02-30", "24-11-2026", "ayer", 20261124)
                  if h("post", "/tramites/", ana, {"tipo_tramite": denuncia.pk, "datos": {"asunto": "a", "descripcion": "b", "fecha_hechos": f}}).status_code != 400]
        self._paso("una fecha futura, inexistente o con otro formato se rechaza", not fallas, fallas)
        self._paso("una fecha pasada válida se acepta",
                   h("post", "/tramites/", ana, {"tipo_tramite": denuncia.pk, "datos": {"asunto": "a", "descripcion": "b", "fecha_hechos": "2026-01-15"}}).status_code == 201)
        for nombre, malo in (("una lista", []), ("más de 16 KB", {"x": "y" * 20000})):
            error, _ = self._bd(ana, [], lambda: Tramite.objects.create(tipo_tramite=tipo_mop, institucion=mop, solicitante=ana, datos=malo))
            self._paso(f"la base rechaza un contenido que es {nombre} (CHECK), aunque la aplicación fallara", error is not None and "tramite_datos" in str(error), str(error)[:80])

        # ---------------------------------------------------------------- motivo por la API
        h("post", f"/tramites/{tc}/estado/", func_mop, {"estado": "En Tramitacion"})
        fallas = []
        for destino, cuerpo in (("Rechazado", {}), ("Rechazado", {"motivo": "corto"}), ("En Subsanacion", {}), ("En Subsanacion", {"motivo": "   "}),
                                ("En Subsanacion", {"motivo": "x" * 2001}), ("Rechazado", {"motivo": 123456789012})):
            r = h("post", f"/tramites/{tc}/estado/", func_mop, {"estado": destino, **cuerpo})
            if r.status_code != 400 or "motivo" not in r.json().get("errores", {}):
                fallas.append((destino, cuerpo))
        self._paso("rechazar o pedir subsanación sin motivo (o con uno corto, enorme o que no es texto) se rechaza con 400", not fallas, fallas)
        self._paso("y el trámite no cambió de estado", tramite(tc).estado == "En Tramitacion")
        pedido = "Falta el plano firmado del terreno; adjúntalo para continuar."
        r = h("post", f"/tramites/{tc}/estado/", func_mop, {"estado": "En Subsanacion", "motivo": f"  {pedido}  "})
        self._paso("con motivo, el funcionario pide la subsanación", r.status_code == 200 and r.json()["estado"] == "En Subsanacion", r.status_code)
        ev = eventos(tc)[-1]
        self._paso("el motivo (sin espacios en los bordes) quedó en el historial, escrito por la base en la misma transacción",
                   ev.accion == "cambio_estado" and ev.estado_nuevo == "En Subsanacion" and ev.atributos == {"motivo": pedido} and ev.actor_id == func_mop.pk, ev.atributos)
        historial = h("get", f"/tramites/{tc}/historial/", ana).json()["eventos"]
        self._paso("la ciudadana ve el motivo en su historial, pero ni el actor ni el resto de los atributos",
                   historial[-1]["motivo"] == pedido and "atributos" not in historial[-1] and "actor_id" not in historial[-1] and historial[1]["motivo"] is None, historial[-1])
        self._paso("el personal ve el motivo y los atributos", next(e for e in h("get", f"/tramites/{tc}/historial/", func_mop).json()["eventos"] if e["motivo"] == pedido)["atributos"] == {"motivo": pedido})

        # ---------------------------------------------------------------- motivo en la base (UPDATE directo, sin pasar por la API)
        td = crear_en("En Tramitacion")
        pasar = lambda estado: (lambda: Tramite.objects.filter(pk=td).update(estado=estado))  # noqa: E731
        con_funcionario = lambda estado, motivo=None: self._bd(func_mop, [mop.pk], pasar(estado), motivo)  # noqa: E731
        error, _ = con_funcionario("Rechazado")
        self._paso("la base rechaza «Rechazado» sin motivo, aunque la API fallara", self._dice(error, "motivo"), str(error)[:90])
        error, _ = con_funcionario("Rechazado", "123456789")
        self._paso("y con un motivo de 9 caracteres", self._dice(error, "motivo"))
        error, _ = con_funcionario("Rechazado", "x" * 2001)
        self._paso("y con uno de 2001 caracteres", self._dice(error, "2000"))
        error, _ = con_funcionario("Rechazado", " " * 30)
        self._paso("y con un motivo que son solo espacios", self._dice(error, "motivo"))
        error, _ = con_funcionario("En Subsanacion")
        self._paso("la base rechaza «En Subsanacion» sin motivo", self._dice(error, "motivo"))
        self._paso("ninguno de esos intentos cambió el trámite", tramite(td).estado == "En Tramitacion")
        error, filas = con_funcionario("En Subsanacion", "1234567890")
        self._paso("un motivo de exactamente 10 caracteres sí pasa", error is None and filas == 1 and tramite(td).estado == "En Subsanacion", str(error)[:90])
        with connection.cursor() as c:
            c.execute("SELECT current_setting('siget.motivo', true)")
            resto = c.fetchone()[0]
        self._paso("al terminar el UPDATE la base limpia el motivo: no se arrastra a otro cambio de la misma transacción", resto in (None, ""), repr(resto))
        error, _ = self._bd(func_mop, [mop.pk], pasar("En Tramitacion"), None)
        self._paso("por eso cerrar la subsanación sin motivo (aunque el anterior ya se usó) también lo rechaza la base", self._dice(error, "motivo"))

        def dos_cambios():
            Tramite.objects.filter(pk=td).update(estado="En Tramitacion")  # consume el motivo
            Tramite.objects.filter(pk=td).update(estado="En Subsanacion")  # sin motivo: la base debe rechazarlo
        error, _ = self._bd(func_mop, [mop.pk], dos_cambios, "Se cierra la subsanación sin respuesta.")
        self._paso("y dos UPDATE seguidos en la misma transacción con un solo motivo: el segundo ya no lo tiene y se rechaza", self._dice(error, "motivo"))
        self._paso("(esa transacción se revirtió entera)", tramite(td).estado == "En Subsanacion")
        error, filas = con_funcionario("En Tramitacion", "Se cierra la subsanación sin respuesta.")
        self._paso("el personal cierra una subsanación en la base con motivo", error is None and filas == 1)
        error, filas = con_funcionario("Aprobado")
        ev = eventos(td)[-1]
        self._paso("en las demás transiciones el motivo es opcional y no queda uno heredado del paso anterior",
                   error is None and filas == 1 and ev.estado_nuevo == "Aprobado" and ev.atributos == {}, ev.atributos)

        # ---------------------------------------------------------------- `datos` fuera de la respuesta a una subsanación
        te = crear_en("En Tramitacion")
        nuevos = {"asunto": "Cambiado a escondidas"}
        error, _ = self._bd(func_mop, [mop.pk], lambda: Tramite.objects.filter(pk=te).update(datos=nuevos))
        self._paso("la base rechaza cambiar `datos` de un trámite en curso (ni siquiera el personal de la institución)", self._dice(error, "contenido"), str(error)[:90])
        error, filas = self._bd(ana, [], lambda: Tramite.objects.filter(pk=te).update(datos=nuevos))
        self._paso("tampoco la persona solicitante: fuera de una subsanación no puede escribir nada", (error is not None or filas == 0) and tramite(te).datos != nuevos)
        error, _ = self._bd(func_mop, [mop.pk], lambda: Tramite.objects.filter(pk=te).update(datos=nuevos, estado="Rechazado"), "Motivo suficientemente largo.")
        self._paso("ni junto con otra transición", self._dice(error, "contenido") and tramite(te).datos != nuevos)
        error, _ = self._bd(func_mop, [mop.pk], lambda: Tramite.objects.filter(pk=tc).update(datos=nuevos))
        self._paso("ni en una subsanación sin cerrarla", self._dice(error, "contenido"))
        error, _ = self._bd(func_mop, [mop.pk], lambda: Tramite.objects.filter(pk=tc).update(datos=nuevos, estado="En Tramitacion"), "Motivo suficientemente largo.")
        self._paso("ni el personal al cerrar la subsanación: solo la persona solicitante puede cambiar el contenido", self._dice(error, "contenido") and tramite(tc).datos == ORIGINAL)

        # ---------------------------------------------------------------- responder la subsanación (tc está «En Subsanacion»)
        respuesta = "Adjunto el plano firmado y corrijo la descripción."
        corregido = {"asunto": "Bache frente a la escuela (corregido)", "descripcion": "El hueco ya mide medio metro."}
        ruta = f"/tramites/{tc}/subsanacion/"
        self._paso("otra ciudadana recibe 404 al intentar responder (para ella no existe)", h("post", ruta, beto, {"respuesta": respuesta}).status_code == 404)
        self._paso("el personal de otra institución y un rol de plataforma también (404)",
                   h("post", ruta, func_minsa, {"respuesta": respuesta}).status_code == 404 and h("post", ruta, operador, {"respuesta": respuesta}).status_code == 404)
        self._paso("el personal de la institución no responde en nombre de la persona (403)", h("post", ruta, func_mop, {"respuesta": respuesta}).status_code == 403)
        self._paso("ni la supervisión (403)", h("post", ruta, super_mop, {"respuesta": respuesta}).status_code == 403)
        self._paso("ni la coordinación (404: no ve datos de trámites)", h("post", ruta, coordinador, {"respuesta": respuesta}).status_code == 404)
        fallas = [str(c)[:30] for c in ({}, {"respuesta": ""}, {"respuesta": "corta"}, {"respuesta": 12345678901}, {"respuesta": ["texto largo"]}, {"respuesta": "x" * 2001},
                                        {"respuesta": "texto\x00largo"}, {"respuesta": respuesta, "datos": {}}, {"respuesta": respuesta, "datos": {"asunto": 5}},
                                        {"respuesta": respuesta, "datos": [corregido]}, {"respuesta": respuesta, "datos": {**corregido, "cedula": "8-123-456"}})
                  if h("post", ruta, ana, c).status_code != 400]
        self._paso("sin respuesta válida o con datos que no cumplen el formulario completo se rechaza con 400", not fallas, fallas)
        self._paso("y nada cambió", tramite(tc).estado == "En Subsanacion" and tramite(tc).datos == ORIGINAL)
        Usuario.objects.filter(pk=ana.pk).update(mfa_verificado_en=timezone.now() - timedelta(hours=8))
        r = h("post", ruta, ana, {"respuesta": f"  {respuesta}  ", "datos": corregido})
        self._paso("la persona responde con el segundo factor vencido (no se exige uno reciente): el trámite vuelve a En Tramitación con los datos corregidos",
                   r.status_code == 200 and r.json()["estado"] == "En Tramitacion" and r.json()["datos"] == corregido, r.status_code)
        self._paso("el contenido quedó actualizado en la base", tramite(tc).datos == corregido and tramite(tc).estado == "En Tramitacion")
        ev = eventos(tc)[-1]
        self._paso("la respuesta quedó como motivo en el historial, hecha por la persona y marcando que se actualizó el contenido",
                   ev.estado_anterior == "En Subsanacion" and ev.estado_nuevo == "En Tramitacion" and ev.actor_id == ana.pk
                   and ev.atributos == {"motivo": respuesta, "datos_actualizados": True}, ev.atributos)
        historial = h("get", f"/tramites/{tc}/historial/", ana).json()["eventos"]
        self._paso("y la persona la ve en su historial", historial[-1]["motivo"] == respuesta and "atributos" not in historial[-1])
        r = h("post", ruta, ana, {"respuesta": respuesta})
        self._paso("responder otra vez, ya fuera de la subsanación, da 409", r.status_code == 409 and r.json()["codigo"] == "no_en_subsanacion")
        self._paso("responder un trámite que nunca estuvo en subsanación también (409)", h("post", f"/tramites/{crear_en('Pendiente')}/subsanacion/", ana, {"respuesta": respuesta}).status_code == 409)

        tf = crear_en("En Subsanacion")
        r = h("post", f"/tramites/{tf}/subsanacion/", ana, {"respuesta": respuesta})
        self._paso("sin `datos`, la respuesta no toca el contenido", r.status_code == 200 and r.json()["estado"] == "En Tramitacion" and tramite(tf).datos == datos_de_ejemplo(tipo_mop.formulario))

        # ---------------------------------------------------------------- lo que la persona NO puede hacer directamente en la base
        tg = crear_en("En Subsanacion")
        original_g = tramite(tg).datos
        persona = lambda accion, motivo="Motivo suficientemente largo.": self._bd(ana, [], accion, motivo)  # noqa: E731
        error, filas = persona(lambda: Tramite.objects.filter(pk=tc).update(estado="Aprobado"))
        self._paso("la persona no cambia el estado de un trámite que no está en subsanación (la seguridad por filas no se lo muestra)", error is None and filas == 0 and tramite(tc).estado == "En Tramitacion")
        error, filas = persona(lambda: Tramite.objects.filter(pk=tg).update(estado="Rechazado"))
        self._paso("ni siquiera uno en subsanación puede pasarlo a Rechazado", (error is not None or filas == 0) and tramite(tg).estado == "En Subsanacion")
        error, filas = persona(lambda: Tramite.objects.filter(pk=tg).update(funcionario_asignado_id=func_mop.pk))
        self._paso("ni asignárselo a alguien sin cerrar la subsanación", (error is not None or filas == 0) and tramite(tg).funcionario_asignado_id is None)
        error, filas = persona(lambda: Tramite.objects.filter(pk=tg).update(estado="En Tramitacion", funcionario_asignado_id=func_mop.pk))
        self._paso("ni al responder la subsanación elegir quién atiende el trámite (el trigger de la persona solicitante)", self._dice(error, "solo puede responder") and tramite(tg).funcionario_asignado_id is None, str(error)[:90])
        error, filas = persona(lambda: Tramite.objects.filter(pk=tg).update(estado="En Tramitacion"), None)
        self._paso("ni responder sin motivo (la base lo exige también a la persona)", self._dice(error, "motivo"))
        error, filas = persona(lambda: Tramite.objects.filter(pk=tg).update(estado="En Tramitacion", datos=[1]))
        self._paso("ni responder con un contenido que no es un objeto (CHECK)", error is not None and "tramite_datos" in str(error) and tramite(tg).datos == original_g)

        # ---------------------------------------------------------------- el personal cierra una subsanación sin respuesta, pero con motivo
        r = h("post", f"/tramites/{tg}/estado/", func_mop, {"estado": "En Tramitacion"})
        self._paso("el personal no cierra una subsanación sin motivo (400)", r.status_code == 400 and r.json()["codigo"] == "motivo_obligatorio")
        r = h("post", f"/tramites/{tg}/estado/", func_mop, {"estado": "En Tramitacion", "motivo": "La persona no respondió; se retoma el trámite."})
        self._paso("con motivo, sí lo cierra y vuelve a En Tramitación", r.status_code == 200 and r.json()["estado"] == "En Tramitacion", r.status_code)
        ev = eventos(tg)[-1]
        self._paso("sin tocar el contenido, y el motivo queda en el historial", tramite(tg).datos == original_g and ev.atributos == {"motivo": "La persona no respondió; se retoma el trámite."}, ev.atributos)
        self._paso("la persona ve ese motivo",
                   h("get", f"/tramites/{tg}/historial/", ana).json()["eventos"][-1]["motivo"] == "La persona no respondió; se retoma el trámite.")
        ev = eventos(tc)[0]
        self._paso("el evento de creación no lleva motivo", ev.accion == "creacion" and "motivo" not in ev.atributos)

        # ---------------------------------------------------------------- el motivo no se arrastra por un UPDATE que no toca el estado (D1)
        th = crear_en("En Tramitacion")

        def reasignar_y_rechazar():
            Tramite.objects.filter(pk=th).update(funcionario_asignado_id=super_mop.pk)  # un UPDATE sin `estado`: no debe dejar el motivo puesto
            Tramite.objects.filter(pk=th).update(estado="Rechazado")  # sin motivo propio: la base debe rechazarlo
        error, _ = self._bd(func_mop, [mop.pk], reasignar_y_rechazar, "Motivo suficientemente largo.")
        self._paso("un UPDATE que no toca el estado (reasignación) no deja el motivo puesto: el rechazo siguiente de la transacción lo exige de nuevo",
                   self._dice(error, "motivo") and tramite(th).estado == "En Tramitacion", str(error)[:90])

        # ---------------------------------------------------------------- un motivo sin contenido real ni caracteres de control (D2)
        fallas = []
        for nombre, motivo in (("10 espacios duros (U+00A0)", "\u00a0" * 10), ("10 espacios ideográficos (U+3000)", "\u3000" * 10),
                               ("10 espacios de ancho cero (U+200B)", "\u200b" * 10), ("10 tabulaciones verticales", "\x0b" * 10),
                               ("10 saltos de página", "\x0c" * 10), ("10 signos sin letras ni números", "?" * 10)):
            error, _ = self._bd(func_mop, [mop.pk], lambda: Tramite.objects.filter(pk=th).update(estado="Rechazado"), motivo)
            if not self._dice(error, "motivo"):
                fallas.append(nombre)
        self._paso("la base rechaza un motivo de 10 caracteres sin ninguna letra ni número (espacios duros, ideográficos, de ancho cero, \v, \f, signos)", not fallas, fallas)
        error, _ = self._bd(func_mop, [mop.pk], lambda: Tramite.objects.filter(pk=th).update(estado="Rechazado"), "Plano incompleto\x0b" + "x" * 10)
        self._paso("y un motivo con letras pero con un carácter de control (\v)", self._dice(error, "control"), str(error)[:90])
        error, filas = self._bd(func_mop, [mop.pk], lambda: Tramite.objects.filter(pk=th).update(estado="Rechazado"), "Plano incompleto,\n\tfalta la firma.")
        self._paso("pero un motivo de varias líneas (salto de línea y tabulación) con letras sí pasa", error is None and filas == 1 and tramite(th).estado == "Rechazado", str(error)[:90])

        # ---------------------------------------------------------------- conflicto de interés sobrevenido (D3)
        # Una persona que pidió un trámite y DESPUÉS recibe membresía en la institución del trámite: la 012 solo lo impide al crearlo.
        conflicto = self._persona("conflicto")
        t_conflicto = self._token(conflicto)
        hc = lambda metodo, ruta, datos=None: self._http(metodo, ruta, t_conflicto, datos)  # noqa: E731
        r = hc("post", "/tramites/", {"tipo_tramite": tipo_mop.pk, "datos": datos_de_ejemplo(tipo_mop.formulario)})
        tx = r.json()["id"]
        h("post", f"/tramites/{tx}/estado/", func_mop, {"estado": "En Tramitacion"})  # En Tramitacion: la persona intentará decidirlo
        r = hc("post", "/tramites/", {"tipo_tramite": tipo_mop.pk, "datos": datos_de_ejemplo(tipo_mop.formulario)})
        ty = r.json()["id"]
        h("post", f"/tramites/{ty}/estado/", func_mop, {"estado": "En Tramitacion"})
        h("post", f"/tramites/{ty}/estado/", func_mop, {"estado": "En Subsanacion", "motivo": "Falta el plano firmado del terreno."})  # En Subsanacion
        Membresia.objects.create(usuario=conflicto, institucion=mop, rol="funcionario", asignado_por=super_mop)
        Usuario.objects.filter(pk=conflicto.pk).update(mfa_verificado_en=timezone.now() - timedelta(minutes=1))
        como_personal = lambda accion, motivo="Motivo suficientemente largo.": self._bd(conflicto, [mop.pk], accion, motivo)  # noqa: E731
        for destino in ("Aprobado", "Rechazado"):
            error, filas = como_personal(lambda: Tramite.objects.filter(pk=tx).update(estado=destino))
            self._paso(f"quien pidió el trámite y luego recibió membresía no puede pasarlo a {destino} (la base aplica las reglas del solicitante)",
                       self._dice(error, "solo puede responder") and tramite(tx).estado == "En Tramitacion", str(error)[:90])
        error, filas = como_personal(lambda: Tramite.objects.filter(pk=tx).update(funcionario_asignado_id=func_mop.pk, estado="Aprobado"))
        self._paso("ni asignárselo a alguien al decidirlo", self._dice(error, "solo puede responder") and tramite(tx).funcionario_asignado_id is None)
        error, _ = como_personal(lambda: Tramite.objects.filter(pk=ty).update(estado="En Tramitacion", funcionario_asignado_id=func_mop.pk))
        self._paso("ni al cerrar su subsanación elegir quién atiende el trámite", self._dice(error, "solo puede responder") and tramite(ty).estado == "En Subsanacion")
        error, _ = como_personal(lambda: Tramite.objects.filter(pk=tx).update(datos={"asunto": "Reescrito por el solicitante con membresía"}))
        self._paso("ni reescribir el contenido fuera de una subsanación", error is not None and tramite(tx).datos == datos_de_ejemplo(tipo_mop.formulario))
        self._paso("tampoco por la API: decidir su propio trámite da 403 (conflicto de interés)",
                   hc("post", f"/tramites/{tx}/estado/", {"estado": "Aprobado"}).status_code == 403)
        r = hc("post", f"/tramites/{ty}/subsanacion/", {"respuesta": "Adjunto el plano firmado del terreno."})
        self._paso("lo único que puede hacer es responder la subsanación (En Subsanacion -> En Tramitacion)",
                   r.status_code == 200 and r.json()["estado"] == "En Tramitacion" and tramite(ty).estado == "En Tramitacion", r.status_code)
        # El personal que NO es el solicitante sigue reasignando con normalidad
        error, filas = self._bd(func_mop, [mop.pk], lambda: Tramite.objects.filter(pk=tx).update(funcionario_asignado_id=super_mop.pk))
        self._paso("y la reasignación por el personal (que no es el solicitante) sigue funcionando", error is None and filas == 1 and tramite(tx).funcionario_asignado_id == super_mop.pk, str(error)[:90])

    def _recorrer(self):
        mop = Institucion.objects.get(nombre="MOP")
        minsa = Institucion.objects.get(nombre="MINSA")
        tipo_mop = TipoTramite.objects.get(institucion=mop, audiencia="ciudadania")
        tipo_minsa = TipoTramite.objects.get(institucion=minsa, audiencia="ciudadania")
        inter_mop = TipoTramite.objects.get(institucion=mop, audiencia="institucion")
        inter_minsa = TipoTramite.objects.get(institucion=minsa, audiencia="institucion")

        coord = self._persona("coord")
        ana, beto = self._persona("ana"), self._persona("beto")
        func_mop, super_mop, super_mop, func_minsa = (self._persona(n) for n in ("func_mop", "super_mop", "super_mop", "func_minsa"))
        operador = self._persona("operador", rol_plataforma="operador_infraestructura")
        for u, inst, rol in ((func_mop, mop, "funcionario"), (super_mop, mop, "funcionario"), (super_mop, mop, "supervisor"), (func_minsa, minsa, "funcionario")):
            Membresia.objects.create(usuario=u, institucion=inst, rol=rol, asignado_por=coord)
        t = {u.username: self._token(u) for u in (ana, beto, func_mop, super_mop, super_mop, func_minsa, operador)}
        tok = lambda u: t[u.username]  # noqa: E731

        def cuantos(persona):
            r = self._http("get", "/tramites/?limite=100", tok(persona))
            return len(r.json()["resultados"]) if r.status_code == 200 else f"HTTP {r.status_code}"

        # La base puede tener trámites de la demostración: se mide la línea base antes de crear los propios
        base_mop, base_minsa = cuantos(func_mop), cuantos(func_minsa)

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
        self._paso("el catálogo se filtra por institución", r.status_code == 200 and len(r.json()) == 2 and {t["audiencia"] for t in r.json()} == {"ciudadania", "institucion"})
        self._paso("un filtro inválido se rechaza", self._http("get", "/catalogo/tipos-tramite/?institucion=abc", tok(ana)).status_code == 400)

        # ---------------------------------------------------------------- crear
        r = self._http("post", "/tramites/", tok(ana), {"tipo_tramite": tipo_mop.pk, "datos": datos_de_ejemplo(tipo_mop.formulario)})
        cuerpo = r.json()
        self._paso("la ciudadana crea un trámite", r.status_code == 201 and cuerpo["estado"] == "Pendiente", r.status_code)
        tramite_ana = cuerpo["id"]
        self._paso("el plazo se calcula con el SLA del catálogo (10 días)", cuerpo["fecha_limite"] is not None and cuerpo["vencido"] is False)
        creado = datetime.fromisoformat(cuerpo["creado_en"])
        esperado = sumar_dias_habiles(creado, tipo_mop.sla_dias, feriados_entre(creado.date(), creado.date() + timedelta(days=90)))
        self._paso("el plazo cuenta días hábiles: sin fines de semana ni feriados de la tabla feriado",
                   abs(datetime.fromisoformat(cuerpo["fecha_limite"]) - esperado) < timedelta(seconds=5), cuerpo["fecha_limite"])
        self._paso("un trámite nuevo no está escalado", cuerpo["escalado"] is False)
        try:
            with transaction.atomic():
                with connection.cursor() as c:
                    c.execute("SELECT siget.escalar_vencidos()")
            self._paso("la aplicación (app_role) NO puede ejecutar el escalamiento", False)
        except DatabaseError:
            self._paso("la aplicación (app_role) NO puede ejecutar el escalamiento", True)
        try:
            with transaction.atomic():
                Tramite.objects.filter(pk=tramite_ana).update(escalado_en=timezone.now())
            self._paso("la aplicación (app_role) NO puede marcar un trámite como escalado", False)
        except DatabaseError:
            self._paso("la aplicación (app_role) NO puede marcar un trámite como escalado", True)
        self._paso("la ciudadana no ve datos de otras personas en su propio trámite", "solicitante_id" not in cuerpo and "funcionario_asignado_id" not in cuerpo and cuerpo["asignado"] is False)
        r = self._http("post", "/tramites/", tok(ana), {"tipo_tramite": tipo_mop.pk, "datos": datos_de_ejemplo(tipo_mop.formulario), "solicitante": beto.pk, "solicitante_id": beto.pk,
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
        r = self._http("post", "/tramites/", tok(beto), {"tipo_tramite": tipo_minsa.pk, "datos": datos_de_ejemplo(tipo_minsa.formulario)})
        tramite_beto_minsa = r.json()["id"]

        # ---------------------------------------------------------------- quién ve qué (RLS)
        self._paso("la ciudadana ve solo sus 2 trámites", cuantos(ana) == 2, cuantos(ana))
        self._paso("el funcionario del MOP ve 2 más (los de su institución), no el del MINSA", cuantos(func_mop) == base_mop + 2, f"{base_mop} + 2 esperado, hay {cuantos(func_mop)}")
        self._paso("el funcionario del MINSA ve 1 más (el del MINSA), no los del MOP", cuantos(func_minsa) == base_minsa + 1, f"{base_minsa} + 1 esperado, hay {cuantos(func_minsa)}")
        self._paso("la segunda ciudadana ve solo el suyo", cuantos(beto) == 1, cuantos(beto))
        # Gestionar personas no da acceso a los datos de los trámites (la RLS solo abre las instituciones donde se atiende)
        coordinador = self._persona("coordinador_mop")
        Membresia.objects.create(usuario=coordinador, institucion=mop, rol="coordinador_institucional", asignado_por=super_mop)
        t[coordinador.username] = self._token(coordinador)
        self._paso("el coordinador de la institución NO ve ningún trámite de ella (gestiona personas, no datos)", cuantos(coordinador) == 0, cuantos(coordinador))
        self._paso("ni siquiera uno concreto: para él no existe (404)", self._http("get", f"/tramites/{tramite_ana}/", tok(coordinador)).status_code == 404)
        self._paso("pero sí ve el equipo de su institución", self._http("get", "/equipo/", tok(coordinador)).status_code == 200)
        self._paso("y el personal sin rol de supervisión o coordinación no ve el equipo (403)", self._http("get", "/equipo/", tok(func_mop)).status_code == 403)
        r = self._http("get", "/tramites/", tok(func_mop))
        self._paso("el personal ve los datos internos; la ciudadana no", "solicitante_id" in r.json()["resultados"][0])

        self._paso("el solicitante ve el detalle de su trámite", self._http("get", f"/tramites/{tramite_ana}/", tok(ana)).status_code == 200)
        self._paso("otra ciudadana recibe 404 (no se revela que existe)", self._http("get", f"/tramites/{tramite_ana}/", tok(beto)).status_code == 404)
        self._paso("el personal de otra institución recibe 404", self._http("get", f"/tramites/{tramite_ana}/", tok(func_minsa)).status_code == 404)
        self._paso("el personal de la institución lo ve", self._http("get", f"/tramites/{tramite_ana}/", tok(func_mop)).status_code == 200)
        self._paso("un id enorme no rompe nada (404)", self._http("get", f"/tramites/{10**30}/", tok(ana)).status_code == 404)
        self._paso("una paginación inválida se rechaza", self._http("get", "/tramites/?limite=0", tok(ana)).status_code == 400 and self._http("get", "/tramites/?limite=1", tok(ana)).json()["limite"] == 1)
        r = self._http("get", "/tramites/?escalados=1&limite=100", tok(ana))
        self._paso("el filtro de escalados solo devuelve trámites escalados", r.status_code == 200 and all(t["escalado"] for t in r.json()["resultados"]))
        self._paso("un valor inválido del filtro de escalados se rechaza", self._http("get", "/tramites/?escalados=si", tok(ana)).status_code == 400)

        # ---------------------------------------------------------------- documentos adjuntos (PT-8)
        pdf = b"%PDF-1.7\n%verificacion SIGET\n%%EOF\n"
        with tempfile.TemporaryDirectory() as carpeta, override_settings(SIGET_DOCS_KEY=os.urandom(32), SIGET_DOCS_DIR=carpeta):
            def subir(token, nombre, contenido, tramite=tramite_ana):
                cab = dict(HOST, HTTP_AUTHORIZATION=f"Bearer {token}")
                r = self.cliente.post(f"/tramites/{tramite}/documentos/", {"archivo": SimpleUploadedFile(nombre, contenido)},
                                      format="multipart", secure=True, **cab)
                cache.clear()
                transaction.set_rollback(False)
                return r
            r = subir(tok(ana), "../../requisito.pdf", pdf)
            doc = r.json() if r.status_code == 201 else {}
            self._paso("la ciudadana adjunta un PDF a su trámite (el nombre se sanea)", r.status_code == 201 and doc.get("nombre") == "requisito.pdf", r.status_code)
            fila = Documento.objects.filter(pk=doc.get("id")).first()
            en_disco = (pathlib.Path(carpeta) / fila.ubicacion[:2] / fila.ubicacion).read_bytes() if fila else b""
            self._paso("en disco el archivo está cifrado (no aparece el contenido) y la ruta la generó el servidor",
                       fila is not None and pdf not in en_disco and en_disco.startswith(b"SGD1") and "requisito" not in fila.ubicacion)
            r = self._http("get", f"/tramites/{tramite_ana}/documentos/{doc.get('id')}/", tok(ana))
            self._paso("al descargarlo vuelve idéntico, como adjunto y sin que el navegador lo interprete",
                       r.status_code == 200 and r.content == pdf and r["Content-Disposition"].startswith("attachment")
                       and r["X-Content-Type-Options"] == "nosniff" and r["Cache-Control"] == "no-store", r.status_code)
            self._paso("un ejecutable con extensión .pdf se rechaza (415)", subir(tok(ana), "factura.pdf", b"MZ\x90\x00binario").status_code == 415)
            self._paso("un HTML o un SVG se rechazan (415)", subir(tok(ana), "x.html", b"<script>").status_code == subir(tok(ana), "x.svg", b"<svg>").status_code == 415)
            self._paso("otro ciudadano no ve ni adjunta en un trámite ajeno (404: para él no existe)",
                       self._http("get", f"/tramites/{tramite_ana}/documentos/", tok(beto)).status_code == 404 and subir(tok(beto), "a.pdf", pdf).status_code == 404)
            r = self._http("get", f"/tramites/{tramite_ana}/documentos/", tok(func_mop))
            self._paso("el personal de la institución ve los documentos (con la huella SHA-256)", r.status_code == 200 and len(r.json()["documentos"]) == 1 and "sha256" in r.json()["documentos"][0])
            self._paso("el personal no adjunta documentos en nombre de la persona (403)", subir(tok(func_mop), "a.pdf", pdf).status_code == 403)
            self._paso("el personal de otra institución no los ve (404)", self._http("get", f"/tramites/{tramite_ana}/documentos/{doc.get('id')}/", tok(func_minsa)).status_code == 404)
            # La seguridad por filas oculta el trámite antes de llegar al PDP: para el operador no existe (404, no 403)
            self._paso("un rol de plataforma no ve documentos (para él el trámite no existe: 404)",
                       self._http("get", f"/tramites/{tramite_ana}/documentos/", tok(operador)).status_code == 404)
            pathlib.Path(carpeta, fila.ubicacion[:2], fila.ubicacion).write_bytes(en_disco[:-1] + bytes([en_disco[-1] ^ 1]))
            r = self._http("get", f"/tramites/{tramite_ana}/documentos/{doc.get('id')}/", tok(ana))
            self._paso("un archivo alterado en disco no se entrega (falla la verificación de integridad)", r.status_code == 500 and r.json()["codigo"] == "documento_no_disponible")
            for operacion, accion in (("modificar", lambda: Documento.objects.filter(pk=fila.pk).update(nombre="otro.pdf")),
                                      ("borrar", lambda: Documento.objects.filter(pk=fila.pk).delete())):
                try:
                    with transaction.atomic():
                        accion()
                    self._paso(f"la aplicación no puede {operacion} un documento", False)
                except DatabaseError:
                    self._paso(f"la aplicación no puede {operacion} un documento", True)
            self._paso("el documento queda en el historial del trámite",
                       EventoAuditoria.objects.filter(tramite_id=tramite_ana, accion="documento_adjuntado").count() == 1)

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

        # quién inicia qué: el personal solo hacia otras instituciones y solo trámites interinstitucionales
        r = self._http("post", "/tramites/", tok(func_mop), {"tipo_tramite": tipo_mop.pk})
        self._paso("el personal del MOP no inicia un trámite en el MOP", r.status_code == 403)
        r = self._http("post", "/tramites/", tok(func_mop), {"tipo_tramite": inter_mop.pk})
        self._paso("ni siquiera la solicitud interinstitucional de su propia institución", r.status_code == 403)
        r = self._http("post", "/tramites/", tok(func_mop), {"tipo_tramite": tipo_minsa.pk})
        self._paso("el personal no inicia en otra institución un trámite pensado para la ciudadanía", r.status_code == 403)
        r = self._http("post", "/tramites/", tok(func_mop), {"tipo_tramite": inter_minsa.pk, "datos": datos_de_ejemplo(inter_minsa.formulario)})
        self._paso("el personal del MOP inicia una solicitud interinstitucional en el MINSA", r.status_code == 201, r.status_code)
        propio = r.json()["id"] if r.status_code == 201 else None
        self._paso("quien la inició la ve (es suya) y el personal del MINSA también",
                   self._http("get", f"/tramites/{propio}/", tok(func_mop)).status_code == 200 and self._http("get", f"/tramites/{propio}/", tok(func_minsa)).status_code == 200)
        r = self._http("post", f"/tramites/{propio}/estado/", tok(func_mop), {"estado": "En Tramitacion"})
        self._paso("quien la inició no la gestiona: pertenece a otra institución", r.status_code in (403, 404), r.status_code)
        r = self._http("post", "/tramites/", tok(ana), {"tipo_tramite": inter_minsa.pk})
        self._paso("la ciudadanía no inicia solicitudes interinstitucionales", r.status_code == 403)

        # ---------------------------------------------------------------- reasignación
        r = self._http("post", f"/tramites/{tramite_ana}/reasignar/", tok(func_mop), {"funcionario_id": super_mop.pk})
        self._paso("un funcionario no puede reasignar (solo el supervisor)", r.status_code == 403)
        for malo in ({"funcionario_id": func_minsa.pk}, {"funcionario_id": ana.pk}, {"funcionario_id": "x"}, {}):
            if self._http("post", f"/tramites/{tramite_ana}/reasignar/", tok(super_mop), malo).status_code != 400:
                self._paso(f"una reasignación inválida ({malo}) se rechaza", False)
                break
        else:
            self._paso("reasignar a otra institución, al solicitante o con datos inválidos se rechaza con 400", True)
        r = self._http("post", f"/tramites/{tramite_ana}/reasignar/", tok(super_mop), {"funcionario_id": super_mop.pk})
        self._paso("el supervisor reasigna a personal de su institución", r.status_code == 200 and r.json()["funcionario_asignado_id"] == super_mop.pk, r.status_code)
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
                   r.status_code == 200 and acciones == ["creacion", "documento_adjuntado", "cambio_estado", "reasignacion", "cambio_estado"], acciones)
        self._paso("pero sin saber quién actuó ni el detalle interno", all("actor_id" not in e and "atributos" not in e for e in eventos))
        r = self._http("get", f"/tramites/{tramite_ana}/historial/", tok(func_mop))
        self._paso("el personal ve quién actuó en cada paso", all("actor_id" in e for e in r.json()["eventos"])
                   and next(e for e in r.json()["eventos"] if e["accion"] == "cambio_estado")["actor_id"] == func_mop.pk)
        self._paso("otra ciudadana recibe 404 al pedir el historial", self._http("get", f"/tramites/{tramite_ana}/historial/", tok(beto)).status_code == 404)

        # ---------------------------------------------------------------- contenido del trámite (migración 017)
        self._contenido(mop, tipo_mop, ana, beto, func_mop, super_mop, func_minsa, operador, coordinador, tok)

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
