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
        elif metodo == "patch":
            r = self.cliente.patch(ruta, datos, format="json", secure=True, **cabeceras)
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

    # ------------------------------------------------------------------ notificaciones (migración 018)

    @staticmethod
    def _sqlstate(error):
        causa = getattr(error, "__cause__", None)
        return getattr(causa, "sqlstate", None)

    def _cuenta_filas(self, consulta, parametros):
        """Ejecuta un comando directo y devuelve las filas afectadas (para `_bd`)."""
        with connection.cursor() as c:
            c.execute(consulta, parametros)
            return c.rowcount

    def _notificaciones(self, mop, tipo_mop, coord, super_mop, ana, operador):
        """Las genera la base al cambiar el trámite (disparador) y cada persona ve solo las suyas (seguridad por filas).
        Personas NUEVAS (lola, nando): su lista parte vacía y cada paso se compara con la lista completa. Todo ocurre en una sola
        transacción: todas las notificaciones comparten `creada_en`, por eso el orden es por id. `escalar_vencidos()` no se puede
        ejecutar desde aquí (app_role no tiene permiso): su aviso a la supervisión lo prueba database/pruebas-notificaciones.sql."""
        lola, nando = self._persona("nota_lola"), self._persona("nota_nando")
        Membresia.objects.create(usuario=nando, institucion=mop, rol="funcionario", asignado_por=coord)
        Usuario.objects.filter(pk=super_mop.pk).update(mfa_verificado_en=timezone.now() - timedelta(minutes=1))
        t_lola, t_nando, t_super, t_ana, t_op = (self._token(p) for p in (lola, nando, super_mop, ana, operador))
        h = lambda metodo, ruta, token, datos=None: self._http(metodo, ruta, token, datos)  # noqa: E731

        def leer_sql(persona, consulta, parametros=()):
            """Una consulta directa a la base como `persona` (su contexto de seguridad por filas, sin pasar por la API)."""
            fijar_contexto(persona.pk, [])
            with connection.cursor() as c:
                c.execute(consulta, parametros)
                return c.fetchall()

        def tipos(persona):
            return [f[0] for f in leer_sql(persona, "SELECT tipo FROM siget.notificacion ORDER BY id")]

        def nueva_solicitud():
            r = h("post", "/tramites/", t_lola, {"tipo_tramite": tipo_mop.pk, "datos": datos_de_ejemplo(tipo_mop.formulario)})
            return r.json()["id"]

        def estado(pk, destino, motivo=None):
            cuerpo = {"estado": destino} if motivo is None else {"estado": destino, "motivo": motivo}
            return h("post", f"/tramites/{pk}/estado/", t_nando, cuerpo)

        MOTIVO = "Falta el plano firmado del terreno."
        RESPUESTA = "Adjunto el plano firmado del terreno."

        # ---------------------------------------------------------------- una cuenta nueva no tiene nada, y crear un trámite no notifica
        self._paso("una cuenta nueva no tiene notificaciones", tipos(lola) == [] and tipos(nando) == [])
        t1 = nueva_solicitud()
        self._paso("crear un trámite no genera ninguna (solo notifican los cambios de un trámite ya creado)", tipos(lola) == [] and tipos(nando) == [])

        # ---------------------------------------------------------------- cada transición avisa a quien corresponde
        self._paso("el personal toma el trámite: el solicitante recibe «tramite_en_atencion»", estado(t1, "En Tramitacion").status_code == 200 and tipos(lola) == ["tramite_en_atencion"])
        self._paso("y quien actuó no recibe nada de su propio cambio", tipos(nando) == [])
        self._paso("el personal pide una subsanación: el solicitante recibe «subsanacion_pedida»",
                   estado(t1, "En Subsanacion", MOTIVO).status_code == 200 and tipos(lola) == ["tramite_en_atencion", "subsanacion_pedida"])
        columnas = leer_sql(lola, "SELECT column_name FROM information_schema.columns WHERE table_schema = 'siget' AND table_name = 'notificacion' ORDER BY ordinal_position")
        self._paso("la notificación no lleva el motivo ni datos de nadie: solo tipo, trámite y fechas",
                   columnas == [("id",), ("usuario_id",), ("tipo",), ("tramite_id",), ("creada_en",), ("leida_en",)], columnas)
        r = h("post", f"/tramites/{t1}/reasignar/", t_super, {"funcionario_id": nando.pk})
        self._paso("reasignar el trámite no genera notificaciones (no cambia el estado)",
                   r.status_code == 200 and tipos(lola) == ["tramite_en_atencion", "subsanacion_pedida"] and tipos(nando) == [], r.status_code)
        r = h("post", f"/tramites/{t1}/subsanacion/", t_lola, {"respuesta": RESPUESTA})
        self._paso("el solicitante responde la subsanación: el funcionario asignado recibe «subsanacion_respondida»", r.status_code == 200 and tipos(nando) == ["subsanacion_respondida"], r.status_code)
        self._paso("y el solicitante, que fue quien actuó, no recibe nada nuevo", tipos(lola) == ["tramite_en_atencion", "subsanacion_pedida"])
        self._paso("se pide otra subsanación y el solicitante la recibe",
                   estado(t1, "En Subsanacion", MOTIVO).status_code == 200 and tipos(lola)[-1] == "subsanacion_pedida" and len(tipos(lola)) == 3)
        r = estado(t1, "En Tramitacion", "La persona no respondió; se retoma el trámite.")
        self._paso("si cierra la subsanación el personal (no el solicitante), no se avisa al asignado ni al solicitante",
                   r.status_code == 200 and tipos(nando) == ["subsanacion_respondida"] and len(tipos(lola)) == 3)
        self._paso("el personal aprueba: el solicitante recibe «tramite_aprobado»", estado(t1, "Aprobado").status_code == 200 and tipos(lola)[-1] == "tramite_aprobado" and len(tipos(lola)) == 4)

        t2 = nueva_solicitud()
        estado(t2, "En Tramitacion")
        self._paso("el personal rechaza (con motivo): el solicitante recibe «tramite_rechazado»",
                   estado(t2, "Rechazado", "No cumple con los requisitos del trámite.").status_code == 200 and tipos(lola)[-2:] == ["tramite_en_atencion", "tramite_rechazado"])
        t3 = nueva_solicitud()
        estado(t3, "En Tramitacion")
        estado(t3, "En Subsanacion", MOTIVO)
        antes = tipos(nando)
        r = h("post", f"/tramites/{t3}/subsanacion/", t_lola, {"respuesta": RESPUESTA})
        self._paso("responder una subsanación en un trámite sin funcionario asignado no avisa al personal", r.status_code == 200 and tipos(nando) == antes, r.status_code)
        self._paso("lola acumuló exactamente las notificaciones esperadas, en orden",
                   tipos(lola) == ["tramite_en_atencion", "subsanacion_pedida", "subsanacion_pedida", "tramite_aprobado", "tramite_en_atencion", "tramite_rechazado",
                                   "tramite_en_atencion", "subsanacion_pedida"], tipos(lola))

        # ---------------------------------------------------------------- una transición que la base rechaza no deja notificación (misma transacción)
        antes = tipos(lola)
        error, _ = self._bd(nando, [mop.pk], lambda: Tramite.objects.filter(pk=t1).update(estado="En Tramitacion"), "Motivo suficientemente largo.")
        self._paso("un cambio de estado que la base rechaza (Aprobado -> En Tramitacion) no deja ninguna notificación", error is not None and tipos(lola) == antes)

        # ---------------------------------------------------------------- por la API: lista, total, no leídas, paginación y formato
        r = h("get", "/notificaciones/", t_lola)
        cuerpo = r.json()
        self._paso("lola lista sus 8 notificaciones, las más recientes primero, con el total y las no leídas",
                   r.status_code == 200 and cuerpo["total"] == 8 and cuerpo["no_leidas"] == 8 and len(cuerpo["resultados"]) == 8
                   and [n["tipo"] for n in cuerpo["resultados"]] == list(reversed(tipos(lola))), r.status_code)
        primera = cuerpo["resultados"][0]
        self._paso("cada una lleva el trámite con el nombre del tipo y la institución, que ella ya ve",
                   primera["tramite_id"] == t3 and primera["tramite"] == {"tipo_tramite": tipo_mop.nombre, "institucion": "MOP"} and primera["leida"] is False
                   and set(primera) == {"id", "tipo", "tramite_id", "tramite", "creada_en", "leida"}, primera)
        r = h("get", "/notificaciones/?limite=3&desplazamiento=3", t_lola)
        self._paso("se pagina (limite y desplazamiento) sin perder el total",
                   r.status_code == 200 and r.json()["total"] == 8 and [n["id"] for n in r.json()["resultados"]] == [n["id"] for n in cuerpo["resultados"][3:6]])
        fallas = [consulta for consulta in ("limite=0", "limite=101", "limite=x", "desplazamiento=-1", "solo_no_leidas=0", "solo_no_leidas=si")
                  if h("get", f"/notificaciones/?{consulta}", t_lola).status_code != 400]
        self._paso("una paginación o un filtro inválido se rechaza con 400", not fallas, fallas)
        r = h("get", "/notificaciones/", t_nando)
        self._paso("nando ve solo la suya (una), no las de lola", r.status_code == 200 and r.json()["total"] == 1 and r.json()["resultados"][0]["tipo"] == "subsanacion_respondida")
        self._paso("la respuesta no se guarda en caché", r["Cache-Control"] == "no-store")

        # ---------------------------------------------------------------- una persona no ve ni marca las de otra
        ajena = primera["id"]
        r = h("get", "/notificaciones/", t_ana)
        self._paso("otra ciudadana no ve ninguna de las de lola en su lista",
                   r.status_code == 200 and ajena not in {n["id"] for n in r.json()["resultados"]} and all(n["tramite_id"] not in {t1, t2, t3} for n in r.json()["resultados"]))
        self._paso("ni por la base directamente (la seguridad por filas): cuenta 0 filas de lola", leer_sql(ana, "SELECT count(*) FROM siget.notificacion WHERE usuario_id = %s", [lola.pk]) == [(0,)])
        self._paso("marcar la notificación de lola como otra persona da 404 (ciudadana y personal)",
                   h("post", f"/notificaciones/{ajena}/leida/", t_ana).status_code == 404 and h("post", f"/notificaciones/{ajena}/leida/", t_nando).status_code == 404)
        self._paso("una notificación inexistente también (404)", h("post", "/notificaciones/999999999/leida/", t_lola).status_code == 404)
        r = h("post", "/notificaciones/leer-todas/", t_ana)
        self._paso("«leer todas» de otra persona no toca las de lola", r.status_code == 200 and h("get", "/notificaciones/?solo_no_leidas=1", t_lola).json()["total"] == 8)
        error, filas = self._bd(ana, [], lambda: self._cuenta_filas("UPDATE siget.notificacion SET leida_en = now() WHERE id = %s", [ajena]))
        self._paso("ni con un UPDATE directo: la base no le muestra la fila (0 filas) y la de lola sigue sin leer",
                   error is None and filas == 0 and leer_sql(lola, "SELECT leida_en FROM siget.notificacion WHERE id = %s", [ajena]) == [(None,)], str(error)[:80])
        r = h("get", "/notificaciones/", t_op)
        self._paso("un rol de plataforma tiene su propia lista (vacía) y no las de nadie", r.status_code == 200 and r.json()["total"] == 0 and r.json()["resultados"] == [], r.status_code)
        self._paso("sin token se responde 401", self._http("get", "/notificaciones/").status_code == 401)
        self._paso("un token de enrolamiento no sirve (403)", self._http("get", "/notificaciones/", self._token(lola, tokens.SCOPE_ENROLAR_MFA)).status_code == 403)

        # ---------------------------------------------------------------- marcar como leída
        r = h("post", f"/notificaciones/{ajena}/leida/", t_lola)
        self._paso("lola marca una como leída y recibe las que le quedan", r.status_code == 200 and r.json() == {"id": ajena, "leida": True, "no_leidas": 7}, r.json())
        r = h("post", f"/notificaciones/{ajena}/leida/", t_lola)
        self._paso("marcarla otra vez no falla ni cambia nada (idempotente)", r.status_code == 200 and r.json()["no_leidas"] == 7, r.status_code)
        self._paso("la lista con solo_no_leidas trae 7 y el total general sigue en 8",
                   h("get", "/notificaciones/?solo_no_leidas=1", t_lola).json()["total"] == 7 and h("get", "/notificaciones/", t_lola).json()["total"] == 8)
        self._paso("la base fijó la hora de lectura (la de la transacción)", leer_sql(lola, "SELECT leida_en = now() FROM siget.notificacion WHERE id = %s", [ajena]) == [(True,)])

        # ---------------------------------------------------------------- lo que la base impone a app_role
        propia_sin_leer = next(n["id"] for n in cuerpo["resultados"] if n["id"] != ajena)
        error, _ = self._bd(lola, [], lambda: self._cuenta_filas("INSERT INTO siget.notificacion (usuario_id, tipo, tramite_id) VALUES (%s, 'tramite_aprobado', %s)", [lola.pk, t1]))
        self._paso("app_role no puede insertar una notificación (ni para sí misma): solo el disparador", self._sqlstate(error) == "42501", str(error)[:80])
        error, _ = self._bd(lola, [], lambda: self._cuenta_filas("DELETE FROM siget.notificacion WHERE id = %s", [ajena]))
        self._paso("ni borrarla", self._sqlstate(error) == "42501", str(error)[:80])
        error, _ = self._bd(lola, [], lambda: self._cuenta_filas("UPDATE siget.notificacion SET tipo = 'tramite_aprobado' WHERE id = %s", [propia_sin_leer]))
        self._paso("ni cambiarle el tipo (solo se le concede leida_en)", self._sqlstate(error) == "42501", str(error)[:80])
        error, _ = self._bd(lola, [], lambda: self._cuenta_filas("UPDATE siget.notificacion SET leida_en = NULL WHERE id = %s", [ajena]))
        self._paso("ni desmarcar una ya leída (la base lo rechaza)",
                   self._dice(error, "desmarca") and leer_sql(lola, "SELECT leida_en IS NOT NULL FROM siget.notificacion WHERE id = %s", [ajena]) == [(True,)], str(error)[:80])
        error, _ = self._bd(lola, [], lambda: self._cuenta_filas("UPDATE siget.notificacion SET leida_en = now() + interval '1 day' WHERE id = %s", [ajena]))
        self._paso("ni volver a marcarla con otra hora", self._dice(error, "desmarca"), str(error)[:80])
        error, filas = self._bd(lola, [], lambda: self._cuenta_filas("UPDATE siget.notificacion SET leida_en = '2000-01-01' WHERE id = %s", [propia_sin_leer]))
        self._paso("al marcar una pendiente con una hora inventada, la base pone la suya y no la que mande la aplicación",
                   error is None and filas == 1 and leer_sql(lola, "SELECT leida_en = now() FROM siget.notificacion WHERE id = %s", [propia_sin_leer]) == [(True,)], str(error)[:80])
        with connection.cursor() as c:
            c.execute("""select r.rolname, has_table_privilege(r.rolname, 'siget.notificacion', 'SELECT'), has_table_privilege(r.rolname, 'siget.notificacion', 'INSERT'),
                         has_table_privilege(r.rolname, 'siget.notificacion', 'UPDATE'), has_table_privilege(r.rolname, 'siget.notificacion', 'DELETE'),
                         has_any_column_privilege(r.rolname, 'siget.notificacion', 'SELECT'), has_any_column_privilege(r.rolname, 'siget.notificacion', 'INSERT'),
                         has_any_column_privilege(r.rolname, 'siget.notificacion', 'UPDATE'), has_column_privilege(r.rolname, 'siget.notificacion', 'leida_en', 'UPDATE'),
                         has_column_privilege(r.rolname, 'siget.notificacion', 'tipo', 'UPDATE'), has_sequence_privilege(r.rolname, 'siget.notificacion_id_seq', 'USAGE')
                         from pg_roles r where r.rolname in ('app_role', 'auditor_role', 'pgadmin_lectura', 'checkpoint_app', 'escalador_role')""")
            privilegios = {f[0]: f[1:] for f in c.fetchall()}
        app = privilegios["app_role"]
        # posiciones: 0-3 tabla (SELECT, INSERT, UPDATE, DELETE), 4-6 alguna columna (SELECT, INSERT, UPDATE), 7 leida_en UPDATE, 8 tipo UPDATE, 9 secuencia
        self._paso("app_role: lee, marca solo leida_en, no inserta, no borra y no usa la secuencia",
                   app[0] and app[6] and app[7] and not (app[1] or app[2] or app[3] or app[5] or app[8] or app[9]), app)
        self._paso("ni el auditor, ni pgadmin_lectura, ni el checkpoint, ni el escalador tienen nada sobre las notificaciones, ni por tabla ni por columna",
                   not any(any(privilegios[rol]) for rol in ("auditor_role", "pgadmin_lectura", "checkpoint_app", "escalador_role")))

        # ---------------------------------------------------------------- leer todas, y lo nuevo vuelve a contar
        r = h("post", "/notificaciones/leer-todas/", t_lola)
        self._paso("«leer todas» marca las pendientes de lola y deja la cuenta en cero", r.status_code == 200 and r.json() == {"marcadas": 6, "no_leidas": 0}, r.json())
        self._paso("y la lista confirma que ya no queda ninguna sin leer", h("get", "/notificaciones/?solo_no_leidas=1", t_lola).json()["total"] == 0)
        estado(nueva_solicitud(), "En Tramitacion")  # un cuarto trámite: el personal lo toma y lola recibe una nueva
        r = h("get", "/notificaciones/", t_lola)
        self._paso("una notificación nueva vuelve a contar como no leída", r.json()["no_leidas"] == 1 and r.json()["total"] == 9 and r.json()["resultados"][0]["leida"] is False, r.json()["no_leidas"])
        self._paso("las de nando no se tocaron por lo que hizo lola", h("get", "/notificaciones/", t_nando).json()["no_leidas"] == 1)

        # ---------------------------------------------------------------- sin acceso o con la cuenta no activa no se avisa al personal; al solicitante sí
        rita, sara = self._persona("nota_rita"), self._persona("nota_sara")
        for p in (rita, sara):
            Membresia.objects.create(usuario=p, institucion=mop, rol="funcionario", asignado_por=coord)

        def subsanacion_para(asignado):
            """Un trámite de lola en subsanación, reasignado a `asignado` por la supervisión (la reasignación no notifica)."""
            pk = nueva_solicitud()
            estado(pk, "En Tramitacion")
            estado(pk, "En Subsanacion", MOTIVO)
            return pk, h("post", f"/tramites/{pk}/reasignar/", t_super, {"funcionario_id": asignado.pk}).status_code

        t_rita, reasignado = subsanacion_para(rita)
        Membresia.objects.filter(usuario=rita, institucion=mop, rol="funcionario").update(revocada_en=timezone.now(), revocada_por=coord)
        r = h("post", f"/tramites/{t_rita}/subsanacion/", t_lola, {"respuesta": RESPUESTA})
        self._paso("a una funcionaria asignada a quien se le revocó el acceso NO le llega «subsanacion_respondida»",
                   reasignado == 200 and r.status_code == 200 and tipos(rita) == [], (reasignado, r.status_code, tipos(rita)))
        t_sara, reasignado = subsanacion_para(sara)
        Usuario.objects.filter(pk=sara.pk).update(estado_cuenta="suspendida")
        r = h("post", f"/tramites/{t_sara}/subsanacion/", t_lola, {"respuesta": RESPUESTA})
        self._paso("ni a una asignada con la cuenta suspendida (aunque su membresía siga vigente)",
                   reasignado == 200 and r.status_code == 200 and tipos(sara) == [], (reasignado, r.status_code, tipos(sara)))
        self._paso("y sí sigue llegando a nando, asignado con acceso y cuenta activa (la regla no cambió para él)", tipos(nando) == ["subsanacion_respondida"])
        # El aviso de escalamiento a la supervisión con la cuenta suspendida no se puede probar aquí (app_role no escribe escalado_en): lo cubre pruebas-notificaciones.sql
        antes = len(tipos(lola))
        Usuario.objects.filter(pk=lola.pk).update(estado_cuenta="bloqueada")
        r = estado(t3, "Aprobado")  # t3 (de lola) sigue en trámite: lo aprueba nando mientras la cuenta de lola está bloqueada
        Usuario.objects.filter(pk=lola.pk).update(estado_cuenta="activa")
        self._paso("a la persona solicitante con la cuenta bloqueada SÍ se le avisa: lo encuentra al volver",
                   r.status_code == 200 and len(tipos(lola)) == antes + 1 and tipos(lola)[-1] == "tramite_aprobado", (r.status_code, tipos(lola)[-2:]))

        # ---------------------------------------------------------------- la consulta de fondo no deja decisiones «permitidas»; las escrituras sí
        n0 = len(DECISIONES)
        h("get", "/notificaciones/", t_lola)
        self._paso("la consulta de la campana (GET) no registra decisiones permitidas en el PDP", DECISIONES[n0:] == [], DECISIONES[n0:])
        h("post", "/notificaciones/leer-todas/", t_lola)
        self._paso("pero marcar como leídas (escritura) sí registra la decisión, con su política",
                   DECISIONES[n0:] == [(lola.pk, "ver_mis_notificaciones", True, "titular_ve_sus_notificaciones")], DECISIONES[n0:])

    # ------------------------------------------------------------------ reasignar solo a personal con acceso vigente

    def _reasignacion_a_revocado(self, mop, tipo_mop, coord, super_mop, ana, func_minsa):
        """A quien se le quitó el acceso (membresía revocada) no se le puede asignar un trámite; el rechazo es el de cualquier destino inválido."""
        rosa = self._persona("reasig_rosa")
        Membresia.objects.create(usuario=rosa, institucion=mop, rol="funcionario", asignado_por=coord)
        Usuario.objects.filter(pk=super_mop.pk).update(mfa_verificado_en=timezone.now() - timedelta(minutes=1))
        t_ana, t_super = self._token(ana), self._token(super_mop)
        pk = self._http("post", "/tramites/", t_ana, {"tipo_tramite": tipo_mop.pk, "datos": datos_de_ejemplo(tipo_mop.formulario)}).json()["id"]

        def reasignar(destino):
            return self._http("post", f"/tramites/{pk}/reasignar/", t_super, {"funcionario_id": destino})

        def asignado_y_eventos():
            fijar_contexto(super_mop.pk, [mop.pk])
            return (Tramite.objects.get(pk=pk).funcionario_asignado_id,
                    EventoAuditoria.objects.filter(tramite_id=pk, accion="reasignacion").count())

        r = reasignar(rosa.pk)
        self._paso("la supervisión reasigna el trámite a personal con la membresía vigente", r.status_code == 200 and asignado_y_eventos() == (rosa.pk, 1), r.status_code)
        r = reasignar(None)
        self._paso("y lo deja en cola", r.status_code == 200 and asignado_y_eventos() == (None, 2), r.status_code)
        Membresia.objects.filter(usuario=rosa, institucion=mop, rol="funcionario").update(revocada_en=timezone.now(), revocada_por=coord)
        self._paso("la membresía de la funcionaria queda revocada", not Membresia.objects.filter(usuario=rosa, institucion=mop).exists()
                   and Membresia.todas.filter(usuario=rosa, institucion=mop, revocada_en__isnull=False).exists())
        r = reasignar(rosa.pk)
        rechazo = r.json()
        self._paso("reasignar el trámite a quien ya no tiene acceso se rechaza (400 destinatario_invalido)",
                   r.status_code == 400 and rechazo["codigo"] == "destinatario_invalido", r.status_code)
        self._paso("y no se asigna ni se audita nada: el trámite sigue en cola, sin una reasignación nueva", asignado_y_eventos() == (None, 2))
        r = reasignar(func_minsa.pk)
        self._paso("la respuesta es la misma que para cualquier destino inválido (personal de otra institución)", r.status_code == 400 and r.json() == rechazo, r.status_code)

    # ------------------------------------------------------------------ trámites de la ciudadanía (migración 021)

    def _ciudadania(self, mop, tipo_mop, coordinador, ana, beto, func_mop, super_mop, func_minsa, operador):
        """Requisitos antes de iniciar, constancia de presentación y desistir. Ana desiste de trámites PROPIOS que crea aquí; nada de lo que ya
        existía se toca. El escalamiento de un desistido (`escalar_vencidos()`, que app_role no puede ejecutar) lo prueba
        database/pruebas-ciudadania.sql. Todo se revierte con la transacción de la prueba."""
        reciente = lambda: timezone.now() - timedelta(minutes=1)  # noqa: E731
        Usuario.objects.filter(pk__in=[ana.pk, beto.pk, func_mop.pk, super_mop.pk, coordinador.pk]).update(mfa_verificado_en=reciente())
        t = {u.pk: self._token(u) for u in (ana, beto, func_mop, super_mop, coordinador, func_minsa, operador)}
        h = lambda metodo, ruta, persona, datos=None: self._http(metodo, ruta, t[persona.pk], datos)  # noqa: E731
        MOTIVO = "Ya no necesito este trámite."

        def tramite(pk):
            fijar_contexto(func_mop.pk, [mop.pk])
            return Tramite.objects.get(pk=pk)

        def eventos(pk):
            fijar_contexto(func_mop.pk, [mop.pk])
            return list(EventoAuditoria.objects.filter(tramite_id=pk).order_by("id"))

        def leer_sql(persona, consulta, parametros=()):
            """Una consulta directa a la base como `persona` (su contexto de seguridad por filas, sin pasar por la API)."""
            fijar_contexto(persona.pk, [])
            with connection.cursor() as c:
                c.execute(consulta, parametros)
                return c.fetchall()

        def crear():
            return h("post", "/tramites/", ana, {"tipo_tramite": tipo_mop.pk, "datos": datos_de_ejemplo(tipo_mop.formulario)}).json()["id"]

        def llevar(pk, estado):
            """El funcionario lleva el trámite hasta `estado` (En Tramitacion, En Subsanacion o Aprobado)."""
            h("post", f"/tramites/{pk}/estado/", func_mop, {"estado": "En Tramitacion"})
            if estado != "En Tramitacion":
                cuerpo = {"estado": estado, "motivo": "Falta el plano firmado del terreno."} if estado == "En Subsanacion" else {"estado": estado}
                h("post", f"/tramites/{pk}/estado/", func_mop, cuerpo)

        # ---------------------------------------------------------------- requisitos antes de iniciar
        ruta_tipo = f"/catalogo/institucion/{mop.pk}/tipos/{tipo_mop.pk}/"
        r = h("get", f"/catalogo/tipos-tramite/?institucion={mop.pk}", ana)
        publico = r.json() if r.status_code == 200 else []
        self._paso("el catálogo público lleva los requisitos de cada trámite (un objeto)",
                   r.status_code == 200 and len(publico) > 0 and all(isinstance(x.get("requisitos"), dict) for x in publico), r.status_code)
        sembrado = next((x.get("requisitos") for x in publico if x["id"] == tipo_mop.pk), {})
        self._paso("el trámite de demostración sembrado por la 021 trae la descripción, los documentos y qué pasa después",
                   bool(isinstance(sembrado.get("descripcion"), str) and sembrado["descripcion"] and isinstance(sembrado.get("documentos"), list)
                        and sembrado["documentos"] and isinstance(sembrado.get("despues"), str) and sembrado["despues"]), sembrado)
        nuevos = {"descripcion": "Prueba de requisitos.", "documentos": ["Cédula", "Croquis de la zona"], "despues": "Se revisa y se avisa aquí."}
        actual = TipoTramite.objects.get(pk=tipo_mop.pk)
        r = h("patch", ruta_tipo, coordinador, {"requisitos": nuevos, "version": actual.version})
        self._paso("la coordinación de la institución cambia los requisitos de su trámite y la versión sube",
                   r.status_code == 200 and r.json()["requisitos"] == nuevos and r.json()["version"] == actual.version + 1, r.status_code)
        r = h("get", f"/catalogo/tipos-tramite/?institucion={mop.pk}", ana)
        self._paso("y el catálogo público ya muestra los requisitos nuevos",
                   r.status_code == 200 and next((x["requisitos"] for x in r.json() if x["id"] == tipo_mop.pk), None) == nuevos)
        r = h("get", f"/catalogo/institucion/{mop.pk}/cambios/?limite=1", coordinador)
        ultimo = r.json()["resultados"][0] if r.status_code == 200 and r.json()["resultados"] else {}
        self._paso("el historial del catálogo anota el cambio, con solo los requisitos y a nombre de la coordinación",
                   ultimo.get("accion") == "cambio" and ultimo.get("despues") == {"requisitos": nuevos} and (ultimo.get("actor") or {}).get("usuario") == coordinador.username, ultimo)
        r = h("patch", ruta_tipo, coordinador, {"requisitos": {"documentos": ["", "Cédula"]}, "version": actual.version + 1})
        self._paso("requisitos mal formados se rechazan con 400 y el error por campo",
                   r.status_code == 400 and "requisitos.documentos.0" in r.json().get("errores", {}), r.status_code)
        r = h("patch", ruta_tipo, coordinador, {"requisitos": {"nada": 1}, "version": actual.version + 1})
        self._paso("una clave desconocida en los requisitos también", r.status_code == 400 and "requisitos" in r.json().get("errores", {}), r.status_code)
        r = h("patch", ruta_tipo, coordinador, {"requisitos": nuevos, "version": actual.version})
        self._paso("con una versión vieja se responde 409 y no se pisa lo que otra persona cambió", r.status_code == 409, r.status_code)
        self._paso("el personal de la institución no cambia requisitos (403)", h("patch", ruta_tipo, func_mop, {"requisitos": nuevos, "version": actual.version + 1}).status_code == 403)
        self._paso("ni la supervisión (403): solo la coordinación gestiona el catálogo",
                   h("patch", ruta_tipo, super_mop, {"requisitos": nuevos, "version": actual.version + 1}).status_code == 403)
        error, _ = self._bd(coordinador, [], lambda: TipoTramite.objects.filter(pk=tipo_mop.pk).update(requisitos={"otra": 1}))
        self._paso("la base rechaza requisitos mal formados aunque la aplicación fallara (P0001)", self._dice(error, "requisitos invalidos") and self._sqlstate(error) == "P0001", str(error)[:80])
        for nombre, persona, instituciones in (("el personal", func_mop, [mop.pk]), ("la ciudadanía", ana, [])):
            error, _ = self._bd(persona, instituciones, lambda: TipoTramite.objects.filter(pk=tipo_mop.pk).update(requisitos=nuevos))
            self._paso(f"la base no deja a {nombre} escribir los requisitos (42501)", error is not None and self._sqlstate(error) == "42501", str(error)[:80])

        # ---------------------------------------------------------------- constancia de presentación
        pdf = b"%PDF-1.7\n%constancia SIGET\n%%EOF\n"
        datos1 = datos_de_ejemplo(tipo_mop.formulario)
        esperadas = [f["etiqueta"] for f in tipo_mop.formulario if f["id"] in datos1]
        t1 = crear()
        with tempfile.TemporaryDirectory() as carpeta, override_settings(SIGET_DOCS_KEY=os.urandom(32), SIGET_DOCS_DIR=carpeta):
            def subir(pk):
                cab = dict(HOST, HTTP_AUTHORIZATION=f"Bearer {t[ana.pk]}")
                resp = self.cliente.post(f"/tramites/{pk}/documentos/", {"archivo": SimpleUploadedFile("croquis.pdf", pdf)}, format="multipart", secure=True, **cab)
                cache.clear()
                transaction.set_rollback(False)
                return resp
            adjunto = subir(t1)
            doc_id = adjunto.json().get("id") if adjunto.status_code == 201 else None
            self._paso("la ciudadana adjunta un documento a su trámite (para la constancia)", adjunto.status_code == 201, adjunto.status_code)
            r = h("get", f"/tramites/{t1}/constancia/", ana)
            c = r.json() if r.status_code == 200 else {}
            self._paso("la ciudadana obtiene la constancia de su trámite y no se guarda en caché (no-store)", r.status_code == 200 and r["Cache-Control"] == "no-store", r.status_code)
            self._paso("lleva el número, el tipo, la institución, el estado y las tres fechas",
                       c.get("numero") == t1 and (c.get("tipo_tramite") or {}).get("id") == tipo_mop.pk and (c.get("institucion") or {}).get("id") == mop.pk
                       and c.get("estado") == "Pendiente" and all(c.get(k) for k in ("presentado_en", "fecha_limite", "emitida_en")), c)
            self._paso("los datos enviados van con las etiquetas de la copia del formulario del trámite",
                       bool(esperadas) and [d["etiqueta"] for d in c.get("datos", [])] == esperadas and all(d["valor"] == datos1[d["id"]] for d in c.get("datos", []) if d["tipo"] in ("texto", "texto_largo", "seleccion")))
            self._paso("y los nombres de los documentos adjuntos, y nada más de ellos", c.get("documentos") == [{"id": doc_id, "nombre": "croquis.pdf"}], c.get("documentos"))
            self._paso("no lleva datos de otras personas (ni quién atiende, ni la sensibilidad, ni el identificador de la persona)",
                       not {"solicitante_id", "funcionario_asignado_id", "sensibilidad", "asignado"} & set(c))
            self._paso("otra ciudadana recibe 404 al pedir la constancia ajena (para ella el trámite no existe)", h("get", f"/tramites/{t1}/constancia/", beto).status_code == 404)
            self._paso("el personal de otra institución también (404)", h("get", f"/tramites/{t1}/constancia/", func_minsa).status_code == 404)
            self._paso("y un rol de plataforma (404: la seguridad por filas lo oculta antes del PDP)", h("get", f"/tramites/{t1}/constancia/", operador).status_code == 404)
            r = h("get", f"/tramites/{t1}/constancia/", func_mop)
            self._paso("el personal de la institución NO recibe la constancia: es solo de quien presentó el trámite (403)", r.status_code == 403, r.status_code)
            self._paso("sin sesión se responde 401", self._http("get", f"/tramites/{t1}/constancia/").status_code == 401)
            self._paso("un trámite que no existe, o un número que no lo es, da 404",
                       h("get", "/tramites/99999999/constancia/", ana).status_code == 404 and h("get", "/tramites/abc/constancia/", ana).status_code == 404)
            self._paso("la constancia solo responde a GET (405)", h("post", f"/tramites/{t1}/constancia/", ana, {}).status_code == 405)

            # ------------------------------------------------------------ desistir
            antes_de_desistir = len(DECISIONES)  # solo las de aquí: el resto de la prueba cuenta con las anteriores
            t2 = crear()
            Usuario.objects.filter(pk=ana.pk).update(mfa_verificado_en=timezone.now() - timedelta(minutes=20))
            r = h("post", f"/tramites/{t2}/desistir/", ana, {"motivo": MOTIVO})
            self._paso("con el segundo factor vencido (20 min) no desiste y se sugiere reautenticar", r.status_code == 403 and r.json().get("reautenticacion_sugerida") is True, r.status_code)
            Usuario.objects.filter(pk=ana.pk).update(mfa_verificado_en=reciente())
            self._paso("otra ciudadana recibe 404 al desistir de un trámite ajeno", h("post", f"/tramites/{t2}/desistir/", beto, {"motivo": MOTIVO}).status_code == 404)
            self._paso("un rol de plataforma también (404)", h("post", f"/tramites/{t2}/desistir/", operador, {"motivo": MOTIVO}).status_code == 404)
            self._paso("el personal y la supervisión de la institución no desisten del trámite de otra persona (403)",
                       h("post", f"/tramites/{t2}/desistir/", func_mop, {"motivo": MOTIVO}).status_code == 403
                       and h("post", f"/tramites/{t2}/desistir/", super_mop, {"motivo": MOTIVO}).status_code == 403)
            self._paso("y nada cambió: el trámite sigue Pendiente", tramite(t2).estado == "Pendiente")
            fallas = []
            for cuerpo in ({}, {"motivo": None}, {"motivo": ""}, {"motivo": "   "}, {"motivo": "corto"}, {"motivo": "x" * 2001}, {"motivo": 123456789012}, {"motivo": ["Ya no"]}):
                r = h("post", f"/tramites/{t2}/desistir/", ana, cuerpo)
                if r.status_code != 400 or "motivo" not in r.json().get("errores", {}):
                    fallas.append(cuerpo)
            self._paso("sin motivo, o con uno corto, enorme o que no es texto, se rechaza con 400 y el error en el campo", not fallas, fallas)
            self._paso("y el trámite sigue Pendiente", tramite(t2).estado == "Pendiente")
            r = h("post", f"/tramites/{t2}/desistir/", ana, {"motivo": f"  {MOTIVO}  ", "estado": "Aprobado", "solicitante_id": beto.pk})
            self._paso("la ciudadana desiste de su trámite Pendiente, con motivo (lo demás del cuerpo se ignora)",
                       r.status_code == 200 and r.json()["estado"] == "Desistido" and r.json()["vencido"] is False, r.status_code)
            cambio = [e for e in eventos(t2) if e.accion == "cambio_estado"][-1]
            self._paso("queda en el historial: Pendiente a Desistido, a nombre de ella y con el motivo sin espacios de los bordes",
                       cambio.estado_anterior == "Pendiente" and cambio.estado_nuevo == "Desistido" and cambio.actor_id == ana.pk and cambio.atributos.get("motivo") == MOTIVO)
            r = h("get", f"/tramites/{t2}/historial/", ana)
            self._paso("ella lee su propio motivo en el historial, sin saber quién del personal actuó",
                       r.status_code == 200 and r.json()["eventos"][-1]["motivo"] == MOTIVO and "actor_id" not in r.json()["eventos"][-1])
            propias = [d for d in DECISIONES[antes_de_desistir:] if d[1] == "desistir_tramite"]
            self._paso("las decisiones del PDP quedaron registradas: la de ella permitida y las del personal negadas",
                       (ana.pk, "desistir_tramite", True, "solicitante_desiste") in propias
                       and (func_mop.pk, "desistir_tramite", False, "sin_regla_que_permita") in propias
                       and (super_mop.pk, "desistir_tramite", False, "sin_regla_que_permita") in propias, propias)
            r = h("post", f"/tramites/{t2}/desistir/", ana, {"motivo": MOTIVO})
            self._paso("desistir de nuevo, con el trámite ya resuelto, responde 409", r.status_code == 409 and r.json()["codigo"] == "tramite_resuelto", r.status_code)
            r = h("get", f"/tramites/{t2}/", ana)
            self._paso("el detalle muestra el estado Desistido y que no corre contra el reloj", r.status_code == 200 and r.json()["estado"] == "Desistido" and r.json()["vencido"] is False)
            r = h("get", f"/tramites/{t2}/constancia/", ana)
            self._paso("la constancia de un trámite desistido también se emite y muestra el estado", r.status_code == 200 and r.json()["estado"] == "Desistido")
            self._paso("la lista de la ciudadana incluye el desistido, con su estado",
                       any(x["id"] == t2 and x["estado"] == "Desistido" for x in h("get", "/tramites/?limite=100", ana).json()["resultados"]))
            r = subir(t2)
            self._paso("un trámite desistido no admite documentos (409)", r.status_code == 409 and r.json()["codigo"] == "tramite_cerrado", r.status_code)
            error, _ = self._bd(ana, [], lambda: Documento.objects.create(tramite_id=t2, institucion_id=mop.pk, subido_por=ana, nombre="otro.pdf", tipo_mime="application/pdf",
                                                                           tamano=10, sha256="a" * 64, ubicacion="c" * 32))
            self._paso("y la base tampoco, aunque la aplicación fallara", self._dice(error, "no admite documentos"), str(error)[:80])
        r = h("post", f"/tramites/{t2}/estado/", func_mop, {"estado": "En Tramitacion"})
        self._paso("el personal no reabre un trámite desistido (Desistido es final: 403)", r.status_code == 403, r.status_code)

        # Desde En Tramitacion, con quien lo atiende y su aviso
        t3 = crear()
        llevar(t3, "En Tramitacion")
        r = h("post", f"/tramites/{t3}/reasignar/", super_mop, {"funcionario_id": func_mop.pk})
        self._paso("la supervisión asigna el trámite a un funcionario", r.status_code == 200 and tramite(t3).funcionario_asignado_id == func_mop.pk, r.status_code)
        r = h("post", f"/tramites/{t3}/desistir/", ana, {"motivo": MOTIVO})
        self._paso("la ciudadana desiste de un trámite En Tramitacion", r.status_code == 200 and r.json()["estado"] == "Desistido", r.status_code)
        avisos = [f[0] for f in leer_sql(func_mop, "SELECT tipo FROM siget.notificacion WHERE tramite_id = %s ORDER BY id", [t3])]
        self._paso("el funcionario asignado recibe el aviso «tramite_desistido»", avisos == ["tramite_desistido"], avisos)
        avisos_ana = [f[0] for f in leer_sql(ana, "SELECT tipo FROM siget.notificacion WHERE tramite_id = %s ORDER BY id", [t3])]
        self._paso("y ella no se avisa a sí misma (solo recibió el de que lo tomaron)", "tramite_desistido" not in avisos_ana and avisos_ana == ["tramite_en_atencion"], avisos_ana)

        # Desde En Subsanacion
        t4 = crear()
        llevar(t4, "En Subsanacion")
        self._paso("el trámite quedó En Subsanacion", tramite(t4).estado == "En Subsanacion")
        r = h("post", f"/tramites/{t4}/desistir/", ana, {"motivo": MOTIVO})
        self._paso("la ciudadana desiste de un trámite En Subsanacion", r.status_code == 200 and r.json()["estado"] == "Desistido", r.status_code)
        r = h("post", f"/tramites/{t4}/subsanacion/", ana, {"respuesta": "Adjunto el plano firmado del terreno."})
        self._paso("y ya no puede responder esa subsanación (409)", r.status_code == 409 and r.json()["codigo"] == "no_en_subsanacion", r.status_code)

        # El personal no pone Desistido, ni por la API ni por la base
        t5 = crear()
        r = h("post", f"/tramites/{t5}/estado/", func_mop, {"estado": "Desistido", "motivo": MOTIVO})
        self._paso("el personal no pone Desistido por la API de cambio de estado (403) y el trámite sigue Pendiente", r.status_code == 403 and tramite(t5).estado == "Pendiente", r.status_code)
        error, _ = self._bd(func_mop, [mop.pk], lambda: Tramite.objects.filter(pk=t5).update(estado="Desistido"), motivo=MOTIVO)
        self._paso("y la base lo rechaza si lo intentara con un UPDATE directo: solo la persona solicitante desiste",
                   self._dice(error, "solo la persona que solicito") and self._sqlstate(error) == "P0001", str(error)[:80])
        error, filas = self._bd(beto, [], lambda: Tramite.objects.filter(pk=t5).update(estado="Desistido"), motivo=MOTIVO)
        self._paso("otra persona no ve una fila que pueda desistir: ni error ni cambio", error is None and filas == 0 and tramite(t5).estado == "Pendiente", (error, filas))
        error, _ = self._bd(ana, [], lambda: Tramite.objects.filter(pk=t5).update(estado="Desistido"))
        self._paso("sin motivo la base no deja desistir ni a la propia persona solicitante (P0001)", self._dice(error, "exige un motivo") and tramite(t5).estado == "Pendiente", str(error)[:80])
        error, _ = self._bd(ana, [], lambda: Tramite.objects.filter(pk=t5).update(estado="Desistido", funcionario_asignado_id=func_mop.pk), motivo=MOTIVO)
        self._paso("ni desistir y de paso cambiar a quien atiende el trámite", self._sqlstate(error) == "P0001" and tramite(t5).estado == "Pendiente", str(error)[:80])
        error, _ = self._bd(ana, [], lambda: Tramite.objects.filter(pk=t5).update(estado="En Tramitacion"), motivo=MOTIVO)
        self._paso("la persona solicitante solo puede desistir o responder una subsanación: tomar su propio trámite se rechaza", self._sqlstate(error) == "P0001", str(error)[:80])

        # Desde un estado final no se desiste
        t6 = crear()
        llevar(t6, "Aprobado")
        self._paso("el trámite quedó Aprobado", tramite(t6).estado == "Aprobado")
        r = h("post", f"/tramites/{t6}/desistir/", ana, {"motivo": MOTIVO})
        self._paso("desistir de un trámite Aprobado responde 409", r.status_code == 409 and r.json()["codigo"] == "tramite_resuelto", r.status_code)
        error, filas = self._bd(ana, [], lambda: Tramite.objects.filter(pk=t6).update(estado="Desistido"), motivo=MOTIVO)
        self._paso("y la base no le deja ninguna fila que desistir (seguridad por filas): sigue Aprobado", error is None and filas == 0 and tramite(t6).estado == "Aprobado", (error, filas))

        # La copia del formulario mantiene la constancia aunque la coordinación cambie el formulario después
        actual = TipoTramite.objects.get(pk=tipo_mop.pk)
        nuevo_formulario = [{"id": "campo_nuevo", "etiqueta": "Etiqueta nueva", "tipo": "texto", "obligatorio": False, "max": 50}]
        r = h("patch", ruta_tipo, coordinador, {"formulario": nuevo_formulario, "version": actual.version})
        self._paso("la coordinación cambia el formulario del trámite", r.status_code == 200, r.status_code)
        r = h("get", f"/tramites/{t1}/constancia/", ana)
        self._paso("la constancia de un trámite ya presentado sigue con las etiquetas del formulario con el que nació",
                   r.status_code == 200 and [d["etiqueta"] for d in r.json()["datos"]] == esperadas, r.status_code)

    def _recorrer(self):
        mop = Institucion.objects.get(nombre="MOP")
        minsa = Institucion.objects.get(nombre="MINSA")
        tipo_mop = TipoTramite.objects.get(institucion=mop, audiencia="ciudadania")
        tipo_minsa = TipoTramite.objects.get(institucion=minsa, audiencia="ciudadania")
        inter_mop = TipoTramite.objects.get(institucion=mop, audiencia="institucion")
        inter_minsa = TipoTramite.objects.get(institucion=minsa, audiencia="institucion")

        coord = self._persona("coord")
        ana, beto = self._persona("ana"), self._persona("beto")
        func_mop, func2_mop, super_mop, func_minsa = (self._persona(n) for n in ("func_mop", "func2_mop", "super_mop", "func_minsa"))
        operador = self._persona("operador", rol_plataforma="operador_infraestructura")
        for u, inst, rol in ((func_mop, mop, "funcionario"), (func2_mop, mop, "funcionario"), (super_mop, mop, "supervisor"), (func_minsa, minsa, "funcionario")):
            Membresia.objects.create(usuario=u, institucion=inst, rol=rol, asignado_por=coord)
        t = {u.username: self._token(u) for u in (ana, beto, func_mop, func2_mop, super_mop, func_minsa, operador)}
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
        for nombre_persona, persona_listada in (("la ciudadana", ana), ("otra ciudadana", beto), ("el personal de otra institución", func_minsa)):
            pagina_uno = self._http("get", "/tramites/?limite=1", tok(persona_listada)).json()
            todos = self._http("get", "/tramites/?limite=100", tok(persona_listada)).json()
            fuera = self._http("get", f"/tramites/?limite=1&desplazamiento={todos['total']}", tok(persona_listada)).json()
            self._paso(f"el listado de {nombre_persona} trae `total` (lo que ve, no solo la página) y paginar no lo cambia",
                       pagina_uno["total"] == todos["total"] == len(todos["resultados"]) and len(pagina_uno["resultados"]) == min(1, todos["total"])
                       and fuera["resultados"] == [] and fuera["total"] == todos["total"], (pagina_uno["total"], todos["total"]))
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
                   r.status_code == 200 and acciones == ["creacion", "documento_adjuntado", "cambio_estado", "reasignacion", "cambio_estado"], acciones)
        self._paso("pero sin saber quién actuó ni el detalle interno", all("actor_id" not in e and "atributos" not in e for e in eventos))
        r = self._http("get", f"/tramites/{tramite_ana}/historial/", tok(func_mop))
        self._paso("el personal ve quién actuó en cada paso", all("actor_id" in e for e in r.json()["eventos"])
                   and next(e for e in r.json()["eventos"] if e["accion"] == "cambio_estado")["actor_id"] == func_mop.pk)
        self._paso("otra ciudadana recibe 404 al pedir el historial", self._http("get", f"/tramites/{tramite_ana}/historial/", tok(beto)).status_code == 404)

        # ---------------------------------------------------------------- contenido del trámite (migración 017)
        self._contenido(mop, tipo_mop, ana, beto, func_mop, super_mop, func_minsa, operador, coordinador, tok)

        # ---------------------------------------------------------------- notificaciones (migración 018)
        self._notificaciones(mop, tipo_mop, coord, super_mop, ana, operador)

        # ---------------------------------------------------------------- reasignar a personal con la membresía revocada (se rechaza)
        self._reasignacion_a_revocado(mop, tipo_mop, coord, super_mop, ana, func_minsa)

        # ---------------------------------------------------------------- trámites de la ciudadanía (migración 021)
        self._ciudadania(mop, tipo_mop, coordinador, ana, beto, func_mop, super_mop, func_minsa, operador)

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
