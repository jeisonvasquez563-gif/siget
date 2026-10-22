"""Consolas de plataforma, control dual y recuperación de contraseña contra la base real, en una transacción que se revierte.

Las peticiones pasan por todo el camino real (autenticación, PDP, permisos, servicios, RLS y triggers de PostgreSQL). Las decisiones
del PDP se capturan en memoria (la tabla es inalterable y esto no debe dejar nada). No deja ningún dato.
"""
import json
from datetime import timedelta
from unittest import mock

from django.conf import settings
from django.core.cache import cache
from django.core.management.base import BaseCommand, CommandError
from django.db import DatabaseError, connection, transaction
from django.utils import timezone
from rest_framework.test import APIClient

from apps.autenticacion import contrasenas, mfa, tokens
from apps.autenticacion.models import EventoSeguridad, Restablecimiento, Sesion
from apps.autorizacion import permisos
from apps.catalogo.models import Institucion
from apps.identidad.models import Aprobacion, Membresia, Usuario
from apps.plataforma.models import RotacionSecreto

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
        self._paso("una persona de la ciudadanía NO entra a ninguna consola (403)", all(self._llamar(ana, "get", f"/plataforma/{x}/").status_code == 403 for x in ("personas", "aprobaciones", "secretos", "infraestructura", "eventos")))
        self._paso("ninguna consola devuelve trámites: /tramites/ le está vedado a los 5 operadores (403)",
                   all(self._llamar(o, "get", "/tramites/").status_code == 403 for o in (ida, ca, seg, sec, inf)))
        sin_factor = self._persona("vp_sin_factor", "operador_identidades")
        Usuario.objects.filter(pk=sin_factor.pk).update(mfa_verificado_en=ahora - timedelta(hours=2))
        sesion = Sesion.objects.create(usuario=sin_factor, refresh_hash=tokens.hash_refresh(tokens.nuevo_refresh()), expira_en=ahora + timedelta(minutes=10))
        token = tokens.emitir_access(settings.SIGET_JWT_KEY, sin_factor.pk, sesion.pk, tokens.SCOPE_COMPLETO, ahora, 300, settings.SIGET_EMISOR)
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
        r = self._publica("/auth/restablecer/", {"username": "vp_ana", "codigo": codigo, "password": "corta"})
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

        # ------------------------------------------------------------ privilegios en la base y registro
        with connection.cursor() as c:
            c.execute("""select r.rolname, has_table_privilege(r.rolname,'siget.restablecimiento','SELECT'), has_table_privilege(r.rolname,'siget.rotacion_secreto','SELECT'),
                         has_table_privilege(r.rolname,'siget.restablecimiento','DELETE'), has_table_privilege(r.rolname,'siget.rotacion_secreto','UPDATE')
                         from pg_roles r where r.rolname in ('app_role','auditor_role','pgadmin_lectura','checkpoint_app')""")
            permisos_bd = {f[0]: f[1:] for f in c.fetchall()}
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
