"""Consolas de plataforma, control dual y recuperación de contraseña contra la base real, en una transacción que se revierte.

Las peticiones pasan por todo el camino real (autenticación, PDP, permisos, servicios, RLS y triggers de PostgreSQL). Las decisiones
del PDP se capturan en memoria (la tabla es inalterable y esto no debe dejar nada). No deja ningún dato.
"""
# Las contraseñas marcadas con «nosec B105» son inválidas a propósito: se envían para comprobar que la API las
# rechaza (pruebas negativas). Bandit las señala como contraseñas escritas en el código; es un falso positivo revisado.
import json
from datetime import timedelta
from unittest import mock

from django.conf import settings
from django.core.cache import cache
from django.core.management.base import BaseCommand, CommandError
from django.test import override_settings
from django.db import DatabaseError, connection, transaction
from django.utils import timezone
from rest_framework.test import APIClient

from apps.autenticacion import contrasenas, mfa, tokens
from apps.autenticacion.models import EventoSeguridad, Invitacion, Restablecimiento, Sesion
from apps.autorizacion import permisos
from apps.catalogo.models import Institucion
from apps.identidad.models import Aprobacion, Membresia, SolicitudDerecho, Usuario
from apps.nucleo.contexto import fijar_contexto
from apps.plataforma.models import AlertaSeguridad, RotacionSecreto

HOST = {"HTTP_HOST": "localhost", "HTTP_X_REAL_IP": "198.51.100.21"}
CLAVE = "una-frase-larga-y-poco-comun-6402"


class _Revertir(Exception):
    pass


class Command(BaseCommand):
    help = "Prueba de integración de las consolas de plataforma contra la base real (se revierte al final)."

    def _paso(self, nombre, ok, detalle=""):
        self.resultados.append(bool(ok))
        marca = self.style.SUCCESS("PASA ") if ok else self.style.ERROR("FALLA")
        self.stdout.write(f"{marca} {nombre}{(' - ' + str(detalle)) if detalle else ''}")

    def handle(self, *args, **opciones):
        self.resultados, self.decisiones = [], []
        try:
            with transaction.atomic(), mock.patch.object(permisos, "_registrar_decision", lambda actor, accion, recurso, decision: self.decisiones.append((actor, accion.value, decision.permitido))):
                self._recorrer()
                raise _Revertir()
        except _Revertir:
            pass
        total, fallas = len(self.resultados), self.resultados.count(False)
        self.stdout.write(f"\n{total - fallas} de {total} pasos correctos; no quedó ningún dato (transacción revertida).")
        if fallas:
            raise CommandError(f"{fallas} paso(s) fallaron")

    # ------------------------------------------------------------------ ayudas
    def _persona(self, username, rol_plataforma="ninguno", mfa_activo=True):
        ahora = timezone.now()
        return Usuario.objects.create(username=username, password_hash=contrasenas.hashear(CLAVE), rol_plataforma=rol_plataforma, nivel_aseguramiento=2,
                                      mfa_activo=mfa_activo, mfa_secreto=mfa.cifrar(settings.SIGET_MFA_KEY, mfa.nuevo_secreto()) if mfa_activo else None,
                                      mfa_verificado_en=ahora)

    def _llamar(self, usuario, metodo, ruta, datos=None, ahora=None):
        ahora = ahora or timezone.now()
        sesion = Sesion.objects.create(usuario=usuario, refresh_hash=tokens.hash_refresh(tokens.nuevo_refresh()), expira_en=ahora + timedelta(minutes=10))
        token = tokens.emitir_access(settings.SIGET_JWT_KEY, usuario.pk, sesion.pk, tokens.SCOPE_COMPLETO, ahora, 300, settings.SIGET_EMISOR)
        Usuario.objects.filter(pk=usuario.pk).update(mfa_verificado_en=ahora)
        cliente = APIClient()
        cab = dict(HOST, HTTP_AUTHORIZATION=f"Bearer {token}")
        r = cliente.get(ruta, secure=True, **cab) if metodo == "get" else cliente.post(ruta, datos or {}, format="json", secure=True, **cab)
        cache.clear()
        transaction.set_rollback(False)  # DRF marca la transacción al rechazar; en producción cada petición tiene la suya
        return r

    def _publica(self, ruta, datos):
        r = APIClient().post(ruta, datos, format="json", secure=True, **HOST)
        cache.clear()
        transaction.set_rollback(False)
        return r

    def _eventos(self, actor):
        return set(EventoSeguridad.objects.filter(actor=actor).values_list("evento", flat=True))

    # ------------------------------------------------------------------ recorrido
    def _recorrer(self):
        ahora = timezone.now()
        ida, idb = self._persona("vp_ident_a", "operador_identidades"), self._persona("vp_ident_b", "operador_identidades")
        ca, cb = self._persona("vp_cat_a", "operador_catalogo"), self._persona("vp_cat_b", "operador_catalogo")
        seg, sec, inf = self._persona("vp_seg", "operador_seguridad"), self._persona("vp_sec", "custodio_secretos"), self._persona("vp_inf", "operador_infraestructura")
        ana, fer = self._persona("vp_ana"), self._persona("vp_fer")
        inst = Institucion.objects.order_by("id").first()

        # ------------------------------------------------------------ quién entra a cada consola
        r = self._llamar(ida, "get", "/plataforma/personas/")
        cuerpo = r.json() if r.status_code == 200 else {}
        crudo = json.dumps(cuerpo)
        self._paso("identidades lista las personas", r.status_code == 200 and any(p["usuario"] == "vp_ana" for p in cuerpo.get("personas", [])), r.status_code)
        self._paso("la lista nunca trae hashes, secretos ni datos personales", all(x not in crudo for x in ("password", "argon2", "mfa_secreto", "cedula", "correo", "nombre")))
        self._paso("seguridad también lista las personas (para bloquear)", self._llamar(seg, "get", "/plataforma/personas/").status_code == 200)
        self._paso("infraestructura NO ve las personas (403)", self._llamar(inf, "get", "/plataforma/personas/").status_code == 403)
        self._paso("una persona de la ciudadanía NO entra a ninguna consola (403)", all(self._llamar(ana, "get", f"/plataforma/{x}/").status_code == 403 for x in ("personas", "aprobaciones", "secretos", "infraestructura", "eventos", "solicitudes-datos")))
        self._paso("ninguna consola devuelve trámites: /tramites/ le está vedado a los 5 operadores (403)",
                   all(self._llamar(o, "get", "/tramites/").status_code == 403 for o in (ida, ca, seg, sec, inf)))
        sin_factor = self._persona("vp_sin_factor", "operador_identidades")
        Usuario.objects.filter(pk=sin_factor.pk).update(mfa_verificado_en=ahora - timedelta(hours=2))
        sesion = Sesion.objects.create(usuario=sin_factor, refresh_hash=tokens.hash_refresh(tokens.nuevo_refresh()), expira_en=timezone.now() + timedelta(minutes=10))
        token = tokens.emitir_access(settings.SIGET_JWT_KEY, sin_factor.pk, sesion.pk, tokens.SCOPE_COMPLETO, timezone.now(), 300, settings.SIGET_EMISOR)
        r = APIClient().get("/plataforma/personas/", secure=True, **dict(HOST, HTTP_AUTHORIZATION=f"Bearer {token}"))
        cache.clear(); transaction.set_rollback(False)
        self._paso("sin segundo factor reciente se niega y se sugiere reautenticar", r.status_code == 403 and r.json().get("reautenticacion_sugerida") is True, r.status_code)

        # ------------------------------------------------------------ recuperación de contraseña
        r = self._llamar(ida, "post", f"/plataforma/personas/{ana.pk}/restablecer-contrasena/")
        codigo = r.json().get("codigo_restablecimiento")
        self._paso("el operador emite un código de restablecimiento", r.status_code == 201 and len(codigo or "") == 14, r.status_code)
        self._paso("la respuesta que lleva el código no se guarda en cachés", r.headers.get("Cache-Control") == "no-store")
        fila = Restablecimiento.objects.get(usuario=ana, usado_en__isnull=True)
        self._paso("en la base solo queda el hash del código, nunca el código", codigo.replace("-", "") not in fila.codigo_hash and len(fila.codigo_hash) == 64)
        self._paso("el código vence a los 15 minutos", timedelta(minutes=14) < fila.vence_en - fila.creado_en <= timedelta(minutes=15, seconds=1))
        r = self._llamar(ida, "post", f"/plataforma/personas/{ida.pk}/restablecer-contrasena/")
        self._paso("un operador no se emite un código a sí mismo (409; la base también lo impide)", r.status_code == 409, r.status_code)
        self._paso("el rol equivocado no emite códigos (403)", self._llamar(seg, "post", f"/plataforma/personas/{ana.pk}/restablecer-contrasena/").status_code == 403)

        mala = self._publica("/auth/restablecer/", {"username": "vp_ana", "codigo": "AAAA-BBBB-CCCC", "password": CLAVE + "x"})
        inexistente = self._publica("/auth/restablecer/", {"username": "nadie_existe", "codigo": codigo, "password": CLAVE + "x"})
        ajeno = self._publica("/auth/restablecer/", {"username": "vp_fer", "codigo": codigo, "password": CLAVE + "x"})
        self._paso("un código incorrecto, uno de otra persona y un usuario inexistente responden IGUAL (no se enumera)",
                   mala.status_code == inexistente.status_code == ajeno.status_code == 400 and mala.json() == inexistente.json() == ajeno.json(), mala.json())
        r = self._publica("/auth/restablecer/", {"username": "vp_ana", "codigo": codigo, "password": "corta"})  # nosec B105
        self._paso("una contraseña débil se rechaza diciendo por qué", r.status_code == 400 and r.json().get("errores"), r.status_code)
        self._paso("y el código NO se gasta (se puede corregir y reintentar)", Restablecimiento.objects.get(pk=fila.pk).usado_en is None)
        sesion_ana = Sesion.objects.create(usuario=ana, refresh_hash=tokens.hash_refresh(tokens.nuevo_refresh()), expira_en=ahora + timedelta(hours=1))
        Usuario.objects.filter(pk=ana.pk).update(intentos_fallidos=2, bloqueado_hasta=ahora + timedelta(minutes=30))
        con_reloj = mock.patch("django.utils.timezone.now", return_value=ahora + timedelta(minutes=14))
        with con_reloj:
            r = self._publica("/auth/restablecer/", {"username": "VP_Ana ", "codigo": codigo.lower(), "password": CLAVE + "NUEVA"})
        self._paso("con el código vigente y una contraseña válida se restablece (acepta mayúsculas, espacios y guiones)", r.status_code == 200, r.status_code)
        ana.refresh_from_db()
        self._paso("la contraseña nueva funciona y la vieja ya no", contrasenas.verificar(CLAVE + "NUEVA", ana.password_hash) and not contrasenas.verificar(CLAVE, ana.password_hash))
        self._paso("se revocan todas sus sesiones y se levanta el bloqueo", Sesion.objects.get(pk=sesion_ana.pk).revocada and ana.intentos_fallidos == 0 and ana.bloqueado_hasta is None)
        self._paso("el segundo factor sigue activo: restablecer la contraseña no lo desactiva", ana.mfa_activo is True)
        r = self._publica("/auth/restablecer/", {"username": "vp_ana", "codigo": codigo, "password": CLAVE + "OTRA"})
        self._paso("un código ya usado no sirve otra vez", r.status_code == 400 and r.json() == mala.json())
        r = self._llamar(ida, "post", f"/plataforma/personas/{ana.pk}/restablecer-contrasena/")
        codigo2 = r.json().get("codigo_restablecimiento")
        with mock.patch("django.utils.timezone.now", return_value=ahora + timedelta(minutes=16)):
            r = self._publica("/auth/restablecer/", {"username": "vp_ana", "codigo": codigo2, "password": CLAVE + "TARDE"})
        self._paso("un código vencido (16 minutos) se rechaza igual que uno inválido", r.status_code == 400 and r.json() == mala.json())
        self._llamar(ida, "post", f"/plataforma/personas/{ana.pk}/restablecer-contrasena/")
        self._paso("emitir un código nuevo invalida el anterior (solo uno vigente)", Restablecimiento.objects.filter(usuario=ana, usado_en__isnull=True).count() == 1)

        # ------------------------------------------------------------ invitaciones para crear cuenta (registro por invitación)
        r = self._llamar(ida, "post", "/plataforma/invitaciones/", {"nota": "verificación"})
        invitacion = r.json().get("codigo_invitacion")
        self._paso("el operador de identidades emite una invitación (se muestra una sola vez, sin caché)",
                   r.status_code == 201 and len(invitacion or "") == 14 and r.headers.get("Cache-Control") == "no-store", r.status_code)
        fila_inv = Invitacion.objects.get(pk=r.json()["id"])
        self._paso("en la base solo queda el hash de la invitación, y vence en los días configurados",
                   invitacion.replace("-", "") not in fila_inv.codigo_hash and len(fila_inv.codigo_hash) == 64
                   # creado_en lo fija Django al insertar, milisegundos después de calcular el vencimiento: margen de un minuto
                   and abs(fila_inv.vence_en - fila_inv.creado_en - timedelta(days=settings.SIGET_INVITACION_DIAS)) < timedelta(minutes=1),
                   fila_inv.vence_en - fila_inv.creado_en)
        r = self._llamar(ida, "get", "/plataforma/invitaciones/")
        self._paso("la lista de invitaciones muestra su estado y NUNCA el código",
                   r.status_code == 200 and invitacion not in json.dumps(r.json()) and any(i["estado"] == "vigente" for i in r.json()["invitaciones"]))
        self._paso("otro rol de plataforma no emite invitaciones (403)", self._llamar(seg, "post", "/plataforma/invitaciones/", {}).status_code == 403)
        datos_nuevo = {"username": "vp_invitada", "password": CLAVE, "nombre": "Invitada", "apellidos": "Prueba", "cedula": "8-901-2345",
                       "fecha_nacimiento": "1991-03-04", "provincia": "Panamá", "ciudad": "Panamá", "correo": "vp_invitada@ejemplo.com",
                       "acepta_aviso": True}
        with override_settings(SIGET_REGISTRO="cerrado"):
            r = self._publica("/auth/registro/", datos_nuevo)
        self._paso("con el registro cerrado no se crea ninguna cuenta (403)", r.status_code == 403 and not Usuario.objects.filter(username="vp_invitada").exists(), r.status_code)
        with override_settings(SIGET_REGISTRO="invitacion"):
            sin = self._publica("/auth/registro/", datos_nuevo)
            mala = self._publica("/auth/registro/", {**datos_nuevo, "invitacion": "AAAA-BBBB-CCCC"})
            self._paso("con registro por invitación, sin código o con uno falso no se crea la cuenta (misma respuesta)",
                       sin.status_code == mala.status_code == 400 and sin.json() == mala.json() and not Usuario.objects.filter(username="vp_invitada").exists())
            r = self._publica("/auth/registro/", {**datos_nuevo, "password": "corta", "invitacion": invitacion})  # nosec B105: inválida a propósito
            self._paso("un error en los datos NO gasta la invitación", r.status_code == 400 and Invitacion.objects.get(pk=fila_inv.pk).usada_en is None)
            r = self._publica("/auth/registro/", {**datos_nuevo, "invitacion": invitacion})
            nueva = Usuario.objects.filter(username="vp_invitada").first()
            self._paso("con una invitación vigente se crea la cuenta y la invitación queda gastada por esa persona",
                       r.status_code == 201 and nueva is not None and Invitacion.objects.get(pk=fila_inv.pk).usada_por_id == nueva.pk, r.status_code)
            r = self._publica("/auth/registro/", {**datos_nuevo, "username": "vp_otra", "cedula": "8-901-2346", "correo": "vp_otra@ejemplo.com",
                                                  "invitacion": invitacion})
            self._paso("una invitación ya usada no sirve otra vez", r.status_code == 400 and r.json() == mala.json())
            vieja = self._llamar(ida, "post", "/plataforma/invitaciones/", {}).json()["codigo_invitacion"]
            with mock.patch("django.utils.timezone.now", return_value=ahora + timedelta(days=settings.SIGET_INVITACION_DIAS, minutes=1)):
                r = self._publica("/auth/registro/", {**datos_nuevo, "username": "vp_tarde", "cedula": "8-901-2347", "correo": "vp_tarde@ejemplo.com",
                                                      "invitacion": vieja})
            self._paso("una invitación vencida se rechaza igual que una inválida", r.status_code == 400 and r.json() == mala.json())
        try:
            with transaction.atomic():
                Invitacion.objects.filter(pk=fila_inv.pk).update(vence_en=ahora + timedelta(days=365))
            self._paso("la aplicación no puede alargar la vigencia de una invitación", False)
        except DatabaseError:
            self._paso("la aplicación no puede alargar la vigencia de una invitación", True)
        try:
            with transaction.atomic():
                Invitacion.objects.filter(pk=fila_inv.pk).delete()
            self._paso("la aplicación no puede borrar invitaciones", False)
        except DatabaseError:
            self._paso("la aplicación no puede borrar invitaciones", True)

        # ------------------------------------------------------------ separación de funciones sobre el segundo factor
        r = self._llamar(ida, "post", f"/plataforma/personas/{ana.pk}/restablecer-mfa/")
        self._paso("quien emitió el código no puede además restablecer el segundo factor de la misma cuenta (409)", r.status_code == 409 and r.json()["codigo"] == "conflicto_de_funciones", r.status_code)
        s_ana = Sesion.objects.create(usuario=ana, refresh_hash=tokens.hash_refresh(tokens.nuevo_refresh()), expira_en=ahora + timedelta(hours=1))
        r = self._llamar(idb, "post", f"/plataforma/personas/{ana.pk}/restablecer-mfa/")
        ana.refresh_from_db()
        self._paso("otro operador sí lo restablece", r.status_code == 200 and ana.mfa_activo is False and ana.mfa_secreto is None, r.status_code)
        self._paso("y sus sesiones se revocan", Sesion.objects.get(pk=s_ana.pk).revocada)
        r = self._llamar(idb, "post", f"/plataforma/personas/{ana.pk}/restablecer-mfa/")
        self._paso("no se restablece lo que no está activo (409)", r.status_code == 409, r.status_code)
        r = self._llamar(idb, "post", f"/plataforma/personas/{ana.pk}/restablecer-contrasena/")
        self._paso("quien restableció el segundo factor no puede emitir el código de esa cuenta (409)", r.status_code == 409 and r.json()["codigo"] == "conflicto_de_funciones", r.status_code)

        # ------------------------------------------------------------ control dual: alta de coordinador (identidades)
        r = self._llamar(ida, "post", "/plataforma/aprobaciones/", {"usuario": "vp_fer", "institucion_id": inst.pk})
        alta = r.json().get("id")
        self._paso("identidades propone el alta de una coordinadora", r.status_code == 201 and alta, r.status_code)
        r = self._llamar(ida, "post", "/plataforma/aprobaciones/", {"usuario": "vp_fer", "institucion_id": inst.pk})
        self._paso("no se repite una propuesta pendiente igual (400)", r.status_code == 400, r.status_code)
        r = self._llamar(ida, "post", "/plataforma/aprobaciones/", {"usuario": "no_existe", "institucion_id": inst.pk})
        self._paso("no se propone el alta de alguien que no existe (400)", r.status_code == 400, r.status_code)
        r = self._llamar(ida, "post", "/plataforma/aprobaciones/", {"usuario": "vp_seg", "institucion_id": inst.pk})
        self._paso("una cuenta de plataforma no puede ser coordinadora (400): lo impone la separación de poderes", r.status_code == 400, r.status_code)
        r = self._llamar(ida, "post", f"/plataforma/aprobaciones/{alta}/resolver/", {"decision": "aprobar"})
        self._paso("QUIEN PROPONE NO APRUEBA: el motor de decisiones lo niega (403)", r.status_code == 403, r.status_code)
        self._paso("el operador de catálogo tampoco aprueba altas de coordinadores (403)", self._llamar(ca, "post", f"/plataforma/aprobaciones/{alta}/resolver/", {"decision": "aprobar"}).status_code == 403)
        try:
            with transaction.atomic():
                Aprobacion.objects.filter(pk=alta).update(estado="aprobada", aprobado_por=ida, resuelto_en=ahora)
            self._paso("aunque se saltara el backend, la base rechaza que el mismo operador apruebe lo que propuso", False)
        except DatabaseError:
            self._paso("aunque se saltara el backend, la base rechaza que el mismo operador apruebe lo que propuso", True)
        self._paso("sin aprobar todavía no existe la membresía", not Membresia.objects.filter(usuario=fer, institucion=inst, rol="coordinador_institucional").exists())
        r = self._llamar(idb, "post", f"/plataforma/aprobaciones/{alta}/resolver/", {"decision": "aprobar"})
        self._paso("otra persona de identidades aprueba y el alta se aplica", r.status_code == 200 and Membresia.objects.filter(usuario=fer, institucion=inst, rol="coordinador_institucional", asignado_por=idb).exists(), r.status_code)
        self._paso("la aprobación queda con quién propuso y quién aprobó", Aprobacion.objects.get(pk=alta).propuesto_por_id == ida.pk and Aprobacion.objects.get(pk=alta).aprobado_por_id == idb.pk)
        self._paso("una propuesta ya resuelta no se resuelve otra vez (409)", self._llamar(idb, "post", f"/plataforma/aprobaciones/{alta}/resolver/", {"decision": "aprobar"}).status_code == 409)
        r = self._llamar(ida, "post", "/plataforma/aprobaciones/", {"usuario": "vp_ana", "institucion_id": inst.pk})
        otra = r.json().get("id")
        r = self._llamar(idb, "post", f"/plataforma/aprobaciones/{otra}/resolver/", {"decision": "rechazar"})
        self._paso("rechazar una propuesta no aplica nada", r.status_code == 200 and not Membresia.objects.filter(usuario=ana, institucion=inst, rol="coordinador_institucional").exists() and Aprobacion.objects.get(pk=otra).estado == "rechazada")
        self._paso("la decisión debe ser «aprobar» o «rechazar» (400)", self._llamar(idb, "post", f"/plataforma/aprobaciones/{self._llamar(ida, 'post', '/plataforma/aprobaciones/', {'usuario': 'vp_ana', 'institucion_id': inst.pk}).json().get('id')}/resolver/", {"decision": "quizas"}).status_code == 400)

        # ------------------------------------------------------------ control dual: alta de institución (catálogo)
        r = self._llamar(ca, "post", "/plataforma/aprobaciones/", {"nombre": "Institución de verificación", "tipo": "demostracion"})
        alta_i = r.json().get("id")
        self._paso("catálogo propone una institución nueva", r.status_code == 201 and alta_i, r.status_code)
        self._paso("quien propone no la aprueba (403)", self._llamar(ca, "post", f"/plataforma/aprobaciones/{alta_i}/resolver/", {"decision": "aprobar"}).status_code == 403)
        self._paso("identidades no aprueba altas de instituciones (403)", self._llamar(ida, "post", f"/plataforma/aprobaciones/{alta_i}/resolver/", {"decision": "aprobar"}).status_code == 403)
        self._paso("no existe hasta que se aprueba", not Institucion.objects.filter(nombre="Institución de verificación").exists())
        r = self._llamar(cb, "post", f"/plataforma/aprobaciones/{alta_i}/resolver/", {"decision": "aprobar"})
        self._paso("otra persona de catálogo aprueba y la institución se crea", r.status_code == 200 and Institucion.objects.filter(nombre="Institución de verificación", tipo="demostracion").exists(), r.status_code)
        r = self._llamar(ca, "post", "/plataforma/aprobaciones/", {"nombre": "institución DE verificación", "tipo": "real"})
        self._paso("no se propone una institución que ya existe, sin distinguir mayúsculas (400)", r.status_code == 400, r.status_code)
        r = self._llamar(ca, "get", "/plataforma/aprobaciones/")
        self._paso("el listado muestra solo las altas de su tipo", r.status_code == 200 and all(a["accion"] == "alta_institucion" for a in r.json()["aprobaciones"]) and r.json()["aprobaciones"])

        # ------------------------------------------------------------ seguridad: bloquear y revocar
        s_fer = Sesion.objects.create(usuario=fer, refresh_hash=tokens.hash_refresh(tokens.nuevo_refresh()), expira_en=ahora + timedelta(hours=1))
        self._paso("bloquear exige un motivo (400)", self._llamar(seg, "post", f"/plataforma/personas/{fer.pk}/bloquear/", {"motivo": "x"}).status_code == 400)
        r = self._llamar(seg, "post", f"/plataforma/personas/{fer.pk}/bloquear/", {"motivo": "Actividad sospechosa en la cuenta"})
        fer.refresh_from_db()
        self._paso("seguridad bloquea una cuenta", r.status_code == 200 and fer.estado_cuenta == "bloqueada", r.status_code)
        self._paso("y su sesión deja de servir de inmediato", Sesion.objects.get(pk=s_fer.pk).revocada)
        self._paso("una cuenta bloqueada no puede iniciar sesión", self._publica("/auth/login/", {"username": "vp_fer", "password": CLAVE}).status_code == 401)
        self._paso("nadie bloquea su propia cuenta (409)", self._llamar(seg, "post", f"/plataforma/personas/{seg.pk}/bloquear/", {"motivo": "me bloqueo solo"}).status_code == 409)
        self._paso("identidades no bloquea cuentas (403)", self._llamar(ida, "post", f"/plataforma/personas/{ana.pk}/bloquear/", {"motivo": "no me corresponde"}).status_code == 403)
        r = self._llamar(seg, "post", f"/plataforma/personas/{fer.pk}/desbloquear/")
        fer.refresh_from_db()
        self._paso("seguridad desbloquea", r.status_code == 200 and fer.estado_cuenta == "activa")
        self._paso("no desbloquea lo que no está bloqueado (409)", self._llamar(seg, "post", f"/plataforma/personas/{fer.pk}/desbloquear/").status_code == 409)
        Usuario.objects.filter(pk=fer.pk).update(estado_cuenta="suspendida")
        self._paso("una cuenta suspendida no la reactiva este rol (409)", self._llamar(seg, "post", f"/plataforma/personas/{fer.pk}/desbloquear/").status_code == 409)
        Usuario.objects.filter(pk=fer.pk).update(estado_cuenta="activa")
        Sesion.objects.create(usuario=fer, refresh_hash=tokens.hash_refresh(tokens.nuevo_refresh()), expira_en=ahora + timedelta(hours=1))
        Sesion.objects.create(usuario=fer, refresh_hash=tokens.hash_refresh(tokens.nuevo_refresh()), expira_en=ahora + timedelta(hours=1))
        r = self._llamar(seg, "post", f"/plataforma/personas/{fer.pk}/revocar-sesiones/")
        self._paso("seguridad revoca las sesiones de alguien", r.status_code == 200 and r.json()["cuantas"] == 2 and not Sesion.objects.filter(usuario=fer, revocada=False).exists(), r.json())
        r = self._llamar(seg, "get", "/plataforma/eventos/")
        self._paso("seguridad ve los eventos recientes", r.status_code == 200 and len(r.json()["eventos"]) > 0)

        # ------------------------------------------------------------ secretos
        r = self._llamar(sec, "get", "/plataforma/secretos/")
        estados = {s["id"]: s["estado"] for s in r.json().get("secretos", [])}
        self._paso("el custodio ve el estado de sus 8 secretos", r.status_code == 200 and len(estados) == 8)
        r = self._llamar(sec, "post", "/plataforma/secretos/", {"secreto": "jwt", "nota": "Rotación de verificación"})
        self._paso("registra una rotación (solo metadatos)", r.status_code == 201, r.status_code)
        estados = {s["id"]: s["estado"] for s in self._llamar(sec, "get", "/plataforma/secretos/").json()["secretos"]}
        self._paso("tras registrarla, ese secreto queda al día", estados["jwt"] == "al_dia")
        self._paso("un secreto desconocido se rechaza (400)", self._llamar(sec, "post", "/plataforma/secretos/", {"secreto": "todo"}).status_code == 400)
        self._paso("la nota no puede pasar de 300 caracteres (400)", self._llamar(sec, "post", "/plataforma/secretos/", {"secreto": "mfa", "nota": "x" * 301}).status_code == 400)
        self._paso("identidades no ve los secretos (403)", self._llamar(ida, "get", "/plataforma/secretos/").status_code == 403)
        crudo = json.dumps(self._llamar(sec, "get", "/plataforma/secretos/").json())
        self._paso("ninguna respuesta contiene valores de secretos", settings.SIGET_JWT_KEY not in crudo and settings.SIGET_MFA_KEY not in crudo and settings.SECRET_KEY not in crudo)
        try:
            with transaction.atomic():
                RotacionSecreto.objects.filter(secreto="jwt").update(nota="borrada")
            self._paso("el registro de rotaciones es de solo inserción en la base", False)
        except DatabaseError:
            self._paso("el registro de rotaciones es de solo inserción en la base", True)

        # ------------------------------------------------------------ infraestructura
        r = self._llamar(inf, "get", "/plataforma/infraestructura/")
        cuerpo = r.json() if r.status_code == 200 else {}
        self._paso("infraestructura ve la salud de la base", r.status_code == 200 and cuerpo["base"]["ok"] is True and cuerpo["base"]["latencia_ms"] >= 0, r.status_code)
        self._paso("la conexión a la base va cifrada con TLS 1.3", cuerpo.get("base", {}).get("tls") == "TLSv1.3", cuerpo.get("base", {}).get("tls"))
        self._paso("muestra el vencimiento del certificado", cuerpo.get("certificado", {}).get("dias_restantes", -1) > 0)
        self._paso("seguridad no ve la infraestructura (403)", self._llamar(seg, "get", "/plataforma/infraestructura/").status_code == 403)

        # ------------------------------------------------------------ solicitudes sobre datos personales (PT-15, Ley 81)
        r = self._llamar(ana, "post", "/auth/mis-datos/solicitudes/", {"tipo": "cancelacion", "detalle": "Quiero que borren mi cuenta y mis datos."})
        sol_ana = r.json().get("id") if r.status_code == 201 else None
        self._paso("(preparación) una persona de la ciudadanía envía una solicitud de cancelación", sol_ana is not None, r.status_code)
        sol_fer = SolicitudDerecho.objects.create(usuario=fer, tipo="rectificacion", detalle="Mi apellido está mal escrito en mi perfil.", vence_en=ahora + timedelta(days=14))
        sol_propia = SolicitudDerecho.objects.create(usuario=ida, tipo="oposicion", detalle="Solicitud propia del operador de identidades.", vence_en=ahora + timedelta(days=14))
        r = self._llamar(ida, "get", "/plataforma/solicitudes-datos/")
        cuerpo = r.json() if r.status_code == 200 else {}
        self._paso("identidades lista las solicitudes sobre datos personales", r.status_code == 200 and {sol_ana, sol_fer.pk} <= {x["id"] for x in cuerpo.get("solicitudes", [])}, r.status_code)
        claves = {"id", "tipo", "detalle", "estado", "creada_en", "vence_en", "vencida", "respondida_en", "respuesta", "persona", "respondida_por"}
        self._paso("cada una trae quién pide solo por identificador y usuario, nunca nombre, cédula, correo ni datos de trámites",
                   all(set(x) == claves and set(x["persona"]) == {"id", "usuario"} for x in cuerpo.get("solicitudes", [])) and cuerpo.get("solicitudes"))
        self._paso("la respuesta que lleva el detalle no se guarda en cachés", r.headers.get("Cache-Control") == "no-store")
        self._paso("el resumen cuenta las abiertas", cuerpo.get("resumen", {}).get("recibidas", 0) >= 3, cuerpo.get("resumen"))
        with mock.patch("django.utils.timezone.now", return_value=ahora + timedelta(days=20)):
            r = self._llamar(ida, "get", "/plataforma/solicitudes-datos/?estado=recibida")
        propias_abiertas = [x for x in r.json().get("solicitudes", []) if x["id"] in {sol_ana, sol_fer.pk, sol_propia.pk}] if r.status_code == 200 else []
        self._paso("pasado el plazo (20 días después) las abiertas se marcan como vencidas y el resumen las cuenta",
                   len(propias_abiertas) == 3 and all(x["vencida"] for x in propias_abiertas) and r.json()["resumen"]["vencidas"] >= 3)
        r = self._llamar(ida, "get", "/plataforma/solicitudes-datos/?estado=recibida")
        self._paso("se puede filtrar por estado", r.status_code == 200 and all(x["estado"] == "recibida" for x in r.json()["solicitudes"]))
        self._paso("un estado que no existe se rechaza (400)", self._llamar(ida, "get", "/plataforma/solicitudes-datos/?estado=cualquiera").status_code == 400)
        self._paso("solo identidades las ve: el resto de operadores y la ciudadanía reciben 403",
                   all(self._llamar(o, "get", "/plataforma/solicitudes-datos/").status_code == 403 for o in (ca, seg, sec, inf, ana)))
        self._paso("tampoco las responden (403)", all(self._llamar(o, "post", f"/plataforma/solicitudes-datos/{sol_ana}/responder/", {"estado": "atendida", "respuesta": "No me corresponde esto."}).status_code == 403 for o in (ca, seg, sec, inf, ana)))
        Usuario.objects.filter(pk=sin_factor.pk).update(mfa_verificado_en=ahora - timedelta(hours=2))
        sesion = Sesion.objects.create(usuario=sin_factor, refresh_hash=tokens.hash_refresh(tokens.nuevo_refresh()), expira_en=timezone.now() + timedelta(minutes=10))
        token = tokens.emitir_access(settings.SIGET_JWT_KEY, sin_factor.pk, sesion.pk, tokens.SCOPE_COMPLETO, timezone.now(), 300, settings.SIGET_EMISOR)
        r = APIClient().get("/plataforma/solicitudes-datos/", secure=True, **dict(HOST, HTTP_AUTHORIZATION=f"Bearer {token}"))
        cache.clear(); transaction.set_rollback(False)
        self._paso("sin segundo factor reciente se niega y se sugiere reautenticar", r.status_code == 403 and r.json().get("reautenticacion_sugerida") is True, r.status_code)
        ruta = f"/plataforma/solicitudes-datos/{sol_ana}/responder/"
        for malo, motivo in (({"estado": "recibida", "respuesta": "Respuesta de prueba larga."}, "un estado que no es una resolución"), ({"estado": "borrar", "respuesta": "Respuesta de prueba larga."}, "un estado inventado"),
                             ({"estado": "atendida", "respuesta": "ok"}, "una respuesta demasiado corta"), ({"estado": "atendida"}, "sin respuesta"), ({}, "un cuerpo vacío")):
            self._paso(f"responder con {motivo} se rechaza (400)", self._llamar(ida, "post", ruta, malo).status_code == 400)
        self._paso("lo rechazado no cambió la solicitud", SolicitudDerecho.objects.get(pk=sol_ana).estado == "recibida")
        self._paso("una solicitud que no existe da 404", self._llamar(ida, "post", "/plataforma/solicitudes-datos/999999999/responder/", {"estado": "atendida", "respuesta": "Respuesta de prueba larga."}).status_code == 404)
        r = self._llamar(ida, "post", f"/plataforma/solicitudes-datos/{sol_propia.pk}/responder/", {"estado": "atendida", "respuesta": "Me respondo a mí mismo, que no corresponde."})
        self._paso("nadie responde su propia solicitud (409; la base también lo impide)", r.status_code == 409 and r.json()["codigo"] == "no_a_si_mismo" and SolicitudDerecho.objects.get(pk=sol_propia.pk).estado == "recibida", r.status_code)
        respuesta_texto = "Corregimos lo que corresponde. Los trámites son expediente público con conservación obligatoria y no se pueden borrar."
        r = self._llamar(ida, "post", ruta, {"estado": "rechazada", "respuesta": respuesta_texto})
        fila_ana = SolicitudDerecho.objects.get(pk=sol_ana)
        self._paso("identidades responde: queda con el estado, quién respondió, cuándo y la respuesta",
                   r.status_code == 200 and fila_ana.estado == "rechazada" and fila_ana.respondida_por_id == ida.pk and fila_ana.respondida_en is not None and fila_ana.respuesta == respuesta_texto, r.status_code)
        self._paso("responder no borra ni modifica nada de la persona (solo la solicitud)", Usuario.objects.filter(pk=ana.pk).exists() and Usuario.objects.get(pk=ana.pk).estado_cuenta == "activa")
        r = self._llamar(idb, "post", ruta, {"estado": "atendida", "respuesta": "Intento responder otra vez la misma solicitud."})
        self._paso("una solicitud ya respondida no se responde otra vez, ni por otro operador (409)", r.status_code == 409 and r.json()["codigo"] == "ya_resuelta" and SolicitudDerecho.objects.get(pk=sol_ana).respuesta == respuesta_texto, r.status_code)
        r = self._llamar(idb, "post", f"/plataforma/solicitudes-datos/{sol_fer.pk}/responder/", {"estado": "atendida", "respuesta": "Ya corregimos tu apellido; puedes verlo en Mis datos."})
        self._paso("otra persona de identidades atiende otra solicitud", r.status_code == 200 and SolicitudDerecho.objects.get(pk=sol_fer.pk).estado == "atendida", r.status_code)
        def rechazada_por_la_base(sql, parametros=()):
            try:
                with transaction.atomic(), connection.cursor() as c:
                    c.execute(sql, parametros)
                return False
            except DatabaseError:
                return True

        # D2: solo un operador de identidades responde (la base lo exige aunque la aplicación fallara)
        sol_d2 = SolicitudDerecho.objects.create(usuario=fer, tipo="rectificacion", detalle="Solicitud para probar quién puede responder.", vence_en=timezone.now() + timedelta(days=14))
        responder = "update siget.solicitud_derecho set estado = 'atendida', respondida_por = %s, respuesta = 'Respuesta de prueba larga.' where id = %s"
        self._paso("la base rechaza una respuesta de quien no es operador de identidades (ciudadanía u otro operador de plataforma)",
                   rechazada_por_la_base(responder, [ana.pk, sol_d2.pk]) and rechazada_por_la_base(responder, [seg.pk, sol_d2.pk]) and rechazada_por_la_base(responder, [ca.pk, sol_d2.pk])
                   and SolicitudDerecho.objects.get(pk=sol_d2.pk).estado == "recibida")
        self._paso("y acepta la de un operador de identidades", not rechazada_por_la_base(responder, [ida.pk, sol_d2.pk]) and SolicitudDerecho.objects.get(pk=sol_d2.pk).estado == "atendida")
        # D1: una solicitud nace siempre «recibida» y sin respuesta, aunque se intente otra cosa
        with transaction.atomic():
            falsa = SolicitudDerecho.objects.create(usuario=fer, tipo="oposicion", detalle="Solicitud que intenta nacer atendida.", estado="atendida", respondida_por=ida,
                                                    respondida_en=ahora - timedelta(days=400), respuesta="Respuesta que nadie dio.", vence_en=timezone.now() + timedelta(days=14))
        falsa = SolicitudDerecho.objects.get(pk=falsa.pk)
        self._paso("una solicitud no puede nacer «atendida» ni con respuesta: la base la deja «recibida», sin respuesta y con la creación fechada por ella",
                   falsa.estado == "recibida" and falsa.respondida_en is None and falsa.respondida_por_id is None and falsa.respuesta is None
                   and abs((falsa.creada_en - timezone.now()).total_seconds()) < 600)
        self._paso("tampoco nace con un plazo a 10 años, ya vencido o de 5 días (debe vencer entre 10 y 30 días)",
                   all(rechazada_por_la_base("insert into siget.solicitud_derecho (usuario_id, tipo, detalle, vence_en) values (%s, 'oposicion', 'Con un plazo fuera de rango.', " + plazo + ")", [fer.pk])  # nosec B608 - plazos fijos de la verificacion
                       for plazo in ("now() + interval '3650 days'", "now() - interval '1 day'", "now() + interval '5 days'")))
        r = self._llamar(ida, "get", "/plataforma/solicitudes-datos/?estado=rechazada")
        self._paso("en el filtro de cerradas aparece quién respondió", r.status_code == 200 and any(x["id"] == sol_ana and x["respondida_por"]["usuario"] == "vp_ident_a" for x in r.json()["solicitudes"]))
        r = self._llamar(ana, "get", "/auth/mis-datos/solicitudes/")
        propias = r.json().get("solicitudes", []) if r.status_code == 200 else []
        self._paso("la persona ve la respuesta a su solicitud, sin el nombre de quien la respondió", any(x["id"] == sol_ana and x["respuesta"] == respuesta_texto and x["estado"] == "rechazada" for x in propias)
                   and "respondida_por" not in json.dumps(propias))
        self._paso("las consolas de plataforma siguen sin ver trámites (403 en /tramites/ también para identidades)", self._llamar(ida, "get", "/tramites/").status_code == 403)
        eventos_solicitud = list(EventoSeguridad.objects.filter(evento="solicitud_derecho_respondida", actor__in=[ida, idb]).values_list("detalle", flat=True))
        self._paso("cada respuesta queda en los eventos de seguridad con quién, a quién y el resultado, sin el texto de la respuesta ni el detalle",
                   len(eventos_solicitud) == 2 and all(set(d) == {"solicitud", "tipo", "estado", "objetivo"} for d in eventos_solicitud) and "expediente" not in json.dumps(eventos_solicitud))
        self._paso("las decisiones del PDP sobre las solicitudes quedaron registradas, también las negadas",
                   any(d[1] == "responder_solicitud_datos" and d[2] is True for d in self.decisiones) and any(d[1] == "responder_solicitud_datos" and d[2] is False for d in self.decisiones)
                   and any(d[1] == "consultar_solicitudes_datos" and d[2] is False for d in self.decisiones))

        # ------------------------------------------------------------ privilegios en la base y registro
        with connection.cursor() as c:
            c.execute("""select r.rolname, has_table_privilege(r.rolname,'siget.restablecimiento','SELECT'), has_table_privilege(r.rolname,'siget.rotacion_secreto','SELECT'),
                         has_table_privilege(r.rolname,'siget.restablecimiento','DELETE'), has_table_privilege(r.rolname,'siget.rotacion_secreto','UPDATE')
                         from pg_roles r where r.rolname in ('app_role','auditor_role','pgadmin_lectura','checkpoint_app')""")
            permisos_bd = {f[0]: f[1:] for f in c.fetchall()}
        with connection.cursor() as c:
            c.execute("""select r.rolname, has_table_privilege(r.rolname,'siget.solicitud_derecho','SELECT'), has_table_privilege(r.rolname,'siget.solicitud_derecho','DELETE'),
                         has_table_privilege(r.rolname,'siget.solicitud_derecho','INSERT'), has_table_privilege(r.rolname,'siget.solicitud_derecho','UPDATE'),
                         has_any_column_privilege(r.rolname,'siget.solicitud_derecho','SELECT'), has_any_column_privilege(r.rolname,'siget.solicitud_derecho','INSERT'),
                         has_any_column_privilege(r.rolname,'siget.solicitud_derecho','UPDATE')
                         from pg_roles r where r.rolname in ('app_role','auditor_role','pgadmin_lectura','checkpoint_app','escalador_role')""")
            sobre_solicitudes = {f[0]: f[1:] for f in c.fetchall()}
        self._paso("ni el auditor, ni pgadmin_lectura, ni el checkpoint, ni el escalador tienen nada sobre las solicitudes sobre datos personales (ni por tabla ni por columna)",
                   not any(any(sobre_solicitudes[rol]) for rol in ("auditor_role", "pgadmin_lectura", "checkpoint_app", "escalador_role")))
        self._paso("la aplicación lee, inserta y actualiza (por columnas) las solicitudes pero no las borra", sobre_solicitudes["app_role"] == (True, False, True, False, True, True, True))
        self._paso("ni el auditor ni pgadmin_lectura leen los códigos de restablecimiento", not permisos_bd["auditor_role"][0] and not permisos_bd["pgadmin_lectura"][0] and not permisos_bd["checkpoint_app"][0])
        self._paso("el auditor sí ve las rotaciones (son metadatos)", permisos_bd["auditor_role"][1] is True)
        self._paso("la aplicación no puede borrar códigos ni editar rotaciones", not permisos_bd["app_role"][2] and not permisos_bd["app_role"][3])
        esperados = {"restablecimiento_emitido", "mfa_restablecido", "alta_propuesta", "alta_aprobada", "alta_rechazada", "cuenta_bloqueada_por_operador",
                     "cuenta_desbloqueada_por_operador", "sesiones_revocadas_por_operador", "rotacion_registrada"}
        hechos = set(EventoSeguridad.objects.filter(actor__in=[ida, idb, ca, cb, seg, sec]).values_list("evento", flat=True))
        self._paso("todo quedó en los eventos de seguridad", esperados <= hechos, esperados - hechos)
        self._paso("también el restablecimiento de la contraseña y los intentos rechazados", {"contrasena_restablecida"} <= self._eventos(ana) and EventoSeguridad.objects.filter(evento="restablecimiento_rechazado").exists())
        crudos = " ".join(json.dumps(d) for d in EventoSeguridad.objects.values_list("detalle", flat=True))
        self._paso("ningún evento contiene el código ni la contraseña", codigo.replace("-", "") not in crudos and CLAVE not in crudos and "NUEVA" not in crudos)
        negadas = [d for d in self.decisiones if d[2] is False]
        self._paso("las denegaciones pasaron por el motor de decisiones y quedaron registradas", len(negadas) >= 15 and any(d[1] == "aprobar_alta" for d in negadas), len(negadas))
        with connection.cursor() as c:
            c.execute("select current_user, (select rolsuper from pg_roles where rolname = current_user)")
            usuario_bd, es_super = c.fetchone()
        self._paso("todo se ejecutó como app_role, sin superusuario", usuario_bd == "app_role" and es_super is False, usuario_bd)
        self._alertas(ana, ida, ca, sec, inf, seg)

    # ------------------------------------------------------------------ alertas de seguridad (migración 019, PT-10)
    def _alertas(self, ana, ida, ca, sec, inf, seg):
        """Las alertas por la API y por la base, como app_role. `app_role` no puede insertar alertas (solo lo hace siget.detectar_anomalias()
        como detector_role, que aquí no se ejecuta): lo que depende de que haya una alerta usa una real si existe (todo se revierte) y, si no hay
        ninguna abierta, lo dice. Que el detector detecte lo correcto lo prueba database/pruebas-alertas.sql."""
        def rechazada_por_la_base(sql, parametros=()):
            try:
                with transaction.atomic(), connection.cursor() as c:
                    c.execute(sql, parametros)
                return False
            except DatabaseError:
                return True

        seg2 = self._persona("vp_seg_dos", "operador_seguridad")
        aud = self._persona("vp_aud", "auditor")
        Usuario.objects.filter(pk=aud.pk).update(nivel_aseguramiento=3)  # el auditor exige nivel 3
        n0 = len(self.decisiones)

        # ------------------------------------------------------------ quién las ve y cómo
        r = self._llamar(seg, "get", "/plataforma/alertas/")
        cuerpo = r.json() if r.status_code == 200 else {}
        self._paso("seguridad lista las alertas, con el total, las abiertas y la paginación",
                   r.status_code == 200 and {"resultados", "total", "abiertas", "limite", "desplazamiento"} <= set(cuerpo) and isinstance(cuerpo.get("resultados"), list), r.status_code)
        self._paso("la respuesta de las alertas no se guarda en cachés", r.headers.get("Cache-Control") == "no-store")
        crudo = json.dumps(cuerpo)
        self._paso("cada alerta trae la persona por su usuario, la IP y contadores, y nunca cédula, correo ni credenciales",
                   all(set(a) == {"id", "regla", "severidad", "persona", "ip", "conteo", "primera_vez", "ultima_vez", "detalle", "estado", "revisada_por", "revisada_en", "nota"}
                       and (a["persona"] is None or set(a["persona"]) == {"id", "usuario"}) for a in cuerpo.get("resultados", []))
                   and all(x not in crudo for x in ("password", "argon2", "mfa_secreto", "cedula", "correo")))
        r = self._llamar(seg, "get", "/plataforma/alertas/?estado=abierta&limite=5&desplazamiento=0")
        self._paso("el filtro por estado y la paginación funcionan",
                   r.status_code == 200 and r.json()["limite"] == 5 and all(a["estado"] == "abierta" for a in r.json()["resultados"]) and len(r.json()["resultados"]) <= 5, r.status_code)
        self._paso("un estado o una paginación inválidos dan 400",
                   all(self._llamar(seg, "get", f"/plataforma/alertas/?{q}").status_code == 400 for q in ("estado=cerrada", "limite=0", "limite=101", "desplazamiento=-1", "limite=abc")))
        r = self._llamar(aud, "get", "/plataforma/alertas/")
        self._paso("el auditor también las ve (por su conexión de solo lectura)", r.status_code == 200 and {"resultados", "total", "abiertas"} <= set(r.json()), r.status_code)
        self._paso("nadie más las ve: ni la ciudadanía ni los otros cuatro operadores (403)",
                   all(self._llamar(x, "get", "/plataforma/alertas/").status_code == 403 for x in (ana, ida, ca, sec, inf)))
        sin_factor = self._persona("vp_seg_sin_factor", "operador_seguridad")
        sesion = Sesion.objects.create(usuario=sin_factor, refresh_hash=tokens.hash_refresh(tokens.nuevo_refresh()), expira_en=timezone.now() + timedelta(minutes=10))
        Usuario.objects.filter(pk=sin_factor.pk).update(mfa_verificado_en=timezone.now() - timedelta(hours=2))
        token = tokens.emitir_access(settings.SIGET_JWT_KEY, sin_factor.pk, sesion.pk, tokens.SCOPE_COMPLETO, timezone.now(), 300, settings.SIGET_EMISOR)
        r = APIClient().get("/plataforma/alertas/", secure=True, **dict(HOST, HTTP_AUTHORIZATION=f"Bearer {token}"))
        cache.clear()
        transaction.set_rollback(False)
        self._paso("el operador sin segundo factor reciente no las ve y se le sugiere reautenticar", r.status_code == 403 and r.json().get("reautenticacion_sugerida") is True, r.status_code)

        # ------------------------------------------------------------ quién las revisa
        revisar = {"estado": "revisada", "nota": "Revisada por la verificación de integración."}
        self._paso("solo el operador de seguridad revisa: el auditor, la ciudadanía y los otros operadores reciben 403, existan o no",
                   all(self._llamar(x, "post", f"/plataforma/alertas/{i}/revisar/", revisar).status_code == 403 for x in (aud, ana, ida, ca, sec, inf) for i in (1, 999999999)))
        r = self._llamar(seg, "post", "/plataforma/alertas/999999999/revisar/", revisar)
        self._paso("revisar una alerta que no existe da 404", r.status_code == 404, r.status_code)
        self._paso("el PDP registró las decisiones sobre las alertas, también las negadas",
                   any(d[1] == "ver_alertas" and d[2] is True for d in self.decisiones[n0:]) and any(d[1] == "ver_alertas" and d[2] is False for d in self.decisiones[n0:])
                   and any(d[1] == "revisar_alerta" and d[2] is False for d in self.decisiones[n0:]))

        # ------------------------------------------------------------ la base: seguridad por filas y permisos
        fijar_contexto(ana.pk)
        self._paso("con el contexto de una persona que no es operador de seguridad, la base no muestra ninguna alerta", AlertaSeguridad.objects.count() == 0)
        fijar_contexto(sec.pk)
        self._paso("ni con el de otro operador de plataforma", AlertaSeguridad.objects.count() == 0)
        with connection.cursor() as c:
            c.execute("""select r.rolname, has_table_privilege(r.rolname,'siget.alerta_seguridad','INSERT'), has_table_privilege(r.rolname,'siget.alerta_seguridad','DELETE'),
                         has_column_privilege(r.rolname,'siget.alerta_seguridad','estado','UPDATE'), has_column_privilege(r.rolname,'siget.alerta_seguridad','nota','UPDATE'),
                         has_column_privilege(r.rolname,'siget.alerta_seguridad','conteo','UPDATE'), has_column_privilege(r.rolname,'siget.alerta_seguridad','detalle','UPDATE'),
                         has_any_column_privilege(r.rolname,'siget.alerta_seguridad','SELECT'), has_function_privilege(r.rolname,'siget.detectar_anomalias()','EXECUTE')
                         from pg_roles r where r.rolname in ('app_role','auditor_role','pgadmin_lectura','checkpoint_app','escalador_role','detector_role')""")
            privilegios = {f[0]: f[1:] for f in c.fetchall()}
        self._paso("existen los seis roles (detector_role lo crea la migración 019)", len(privilegios) == 6, sorted(privilegios))
        app, aud_bd = privilegios.get("app_role"), privilegios.get("auditor_role")
        self._paso("app_role lee las alertas y solo actualiza estado y nota (por columna): ni inserta, ni borra, ni toca el conteo ni el detalle",
                   app == (False, False, True, True, False, False, True, False), app)
        self._paso("auditor_role solo las lee, y no ejecuta el detector", aud_bd == (False, False, False, False, False, False, True, False), aud_bd)
        self._paso("ni pgadmin_lectura, ni el checkpoint, ni el escalador, ni el propio detector_role leen las alertas ni ejecutan lo que no es suyo",
                   all(privilegios.get(rol, (True,))[:7] == (False,) * 7 for rol in ("pgadmin_lectura", "checkpoint_app", "escalador_role", "detector_role"))
                   and all(privilegios.get(rol, (None,) * 8)[7] is False for rol in ("pgadmin_lectura", "checkpoint_app", "escalador_role")))
        self._paso("solo detector_role ejecuta siget.detectar_anomalias() (y la aplicación no)", privilegios.get("detector_role", (None,) * 8)[7] is True and app[7] is False)
        self._paso("app_role no puede insertar una alerta",
                   rechazada_por_la_base("insert into siget.alerta_seguridad (regla, severidad, conteo, primera_vez, ultima_vez) values ('bloqueos_repetidos', 'alta', 2, now(), now())"))
        self._paso("ni borrarlas ni vaciar la tabla", rechazada_por_la_base("delete from siget.alerta_seguridad where id = -1") and rechazada_por_la_base("truncate siget.alerta_seguridad"))
        self._paso("ni cambiar el conteo, el detalle o la regla", rechazada_por_la_base("update siget.alerta_seguridad set conteo = 1 where id = -1")
                   and rechazada_por_la_base("update siget.alerta_seguridad set detalle = '{}'::jsonb where id = -1")
                   and rechazada_por_la_base("update siget.alerta_seguridad set regla = 'reuso_token_refresco' where id = -1"))
        self._paso("ni ejecutar el detector", rechazada_por_la_base("select siget.detectar_anomalias()"))

        # ------------------------------------------------------------ la revisión, sobre una alerta real si la hay (todo se revierte)
        fijar_contexto(seg.pk)
        abierta = AlertaSeguridad.objects.filter(estado="abierta").order_by("id").first()
        if abierta is None:
            self._paso("(no hay ninguna alerta abierta en esta base: la revisión de punta a punta queda cubierta por database/pruebas-alertas.sql)", True)
            return
        ruta = f"/plataforma/alertas/{abierta.pk}/revisar/"
        r = self._llamar(seg, "post", ruta, {"estado": "revisada"})
        self._paso("revisar sin nota da 400 y la alerta sigue abierta", r.status_code == 400 and AlertaSeguridad.objects.get(pk=abierta.pk).estado == "abierta", r.status_code)
        r = self._llamar(seg, "post", ruta, {"estado": "abierta", "nota": "Reabrir una alerta no es una revisión."})
        self._paso("tampoco se puede «revisar» con un estado que no es revisada ni descartada", r.status_code == 400 and AlertaSeguridad.objects.get(pk=abierta.pk).estado == "abierta", r.status_code)
        fijar_contexto(seg.pk)
        actualizar = "update siget.alerta_seguridad set estado = 'revisada', revisada_por = %s, nota = %s where id = %s"
        self._paso("la base rechaza una revisión sin nota, con la nota vacía, a nombre de otro operador o de quien no es operador de seguridad",
                   rechazada_por_la_base(actualizar, [seg.pk, None, abierta.pk]) and rechazada_por_la_base(actualizar, [seg.pk, "   ", abierta.pk])
                   and rechazada_por_la_base(actualizar, [seg2.pk, "Otro operador figura como revisor.", abierta.pk])
                   and rechazada_por_la_base(actualizar, [ana.pk, "Una persona sin ese rol no revisa.", abierta.pk])
                   and AlertaSeguridad.objects.get(pk=abierta.pk).estado == "abierta")
        r = self._llamar(seg, "post", ruta, revisar)
        fijar_contexto(seg.pk)
        hecha = AlertaSeguridad.objects.get(pk=abierta.pk)
        self._paso("el operador la revisa con su nota: queda a su nombre y con la hora de la base",
                   r.status_code == 200 and r.json()["codigo"] == "alerta_revisada" and hecha.estado == "revisada" and hecha.revisada_por_id == seg.pk
                   and hecha.nota == revisar["nota"] and hecha.revisada_en is not None and hecha.revisada_en <= timezone.now(), r.status_code)
        evento = EventoSeguridad.objects.filter(evento="alerta_revisada", actor=seg).values_list("detalle", flat=True).first() or {}
        self._paso("quedó en los eventos de seguridad con la alerta, la regla y el resultado, sin la nota",
                   set(evento) == {"alerta", "regla", "estado"} and evento["alerta"] == abierta.pk and revisar["nota"] not in json.dumps(evento))
        r = self._llamar(seg2, "post", ruta, {"estado": "descartada", "nota": "Otro operador intenta cambiarla."})
        self._paso("una alerta ya revisada no se revisa otra vez, ni por otro operador (409)", r.status_code == 409 and r.json()["codigo"] == "ya_revisada", r.status_code)
        fijar_contexto(seg.pk)
        self._paso("la base tampoco deja reabrirla ni cambiar su nota ni su resultado",
                   rechazada_por_la_base("update siget.alerta_seguridad set estado = 'abierta', revisada_por = null, revisada_en = null, nota = null where id = %s", [abierta.pk])
                   and rechazada_por_la_base("update siget.alerta_seguridad set nota = 'Nota cambiada después.' where id = %s", [abierta.pk])
                   and rechazada_por_la_base("update siget.alerta_seguridad set estado = 'descartada' where id = %s", [abierta.pk])
                   and AlertaSeguridad.objects.get(pk=abierta.pk).estado == "revisada")
