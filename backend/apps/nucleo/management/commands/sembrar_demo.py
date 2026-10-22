"""Siembra personas de demostración de cada rol y algunos trámites de ejemplo.

- Las cuentas se crean como las crearía el registro (Argon2) y con el segundo factor ya enrolado, para poder mostrar
  la plataforma sin escanear un QR por cada una. Los trámites se crean y se mueven POR LA API, con el PDP, la RLS y la
  auditoría reales: lo que se ve en la demo es lo que hace el sistema, no datos pegados.
- Es idempotente: una persona que ya existe no se toca (ni su contraseña ni su secreto) y no se le siembran trámites.
- Imprime una línea por persona nueva: usuario|descripcion|contrasena|secreto_totp. Esa salida es lo único que contiene
  las credenciales: no se guarda en ningún archivo del repositorio. Las cuentas son SOLO para el laboratorio.
"""
import secrets
from datetime import timedelta
from unittest import mock

from django.conf import settings
from django.core.cache import cache
from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone
from rest_framework.test import APIClient

from apps.autenticacion import contrasenas, mfa, tokens
from apps.autorizacion import permisos
from apps.autenticacion.models import Sesion
from apps.catalogo.models import Institucion, TipoTramite
from apps.identidad.models import Membresia, Usuario

PALABRAS = ["rio", "cobre", "faro", "canal", "ceiba", "tucan", "isla", "puente", "bahia", "selva", "cerro", "nube",
            "roble", "ancla", "brisa", "coral", "duna", "estero", "fuerte", "garza", "hamaca", "iguana", "jade",
            "kiosco", "laguna", "mango", "nispero", "orquidea", "palma", "quetzal", "ribera", "sendero"]

# (usuario, descripción, rol_plataforma, [(institución, rol)], nivel_aseguramiento)
PERSONAS = [
    ("ana.ciudadana", "Ciudadana", "ninguno", [], 1),
    ("beto.ciudadano", "Ciudadano", "ninguno", [], 1),
    ("fabio.mop", "Funcionario del MOP", "ninguno", [("MOP", "funcionario")], 2),
    ("flor.mop", "Funcionaria del MOP", "ninguno", [("MOP", "funcionario")], 2),
    ("saul.mop", "Supervisor del MOP", "ninguno", [("MOP", "supervisor")], 2),
    ("carla.mop", "Coordinadora del MOP", "ninguno", [("MOP", "coordinador_institucional")], 2),
    ("felix.minsa", "Funcionario del MINSA", "ninguno", [("MINSA", "funcionario")], 2),
    ("ines.infra", "Operadora de infraestructura", "operador_infraestructura", [], 2),
    ("ivan.identidades", "Operador de identidades", "operador_identidades", [], 2),
    ("cata.catalogo", "Operadora de catálogo", "operador_catalogo", [], 2),
    ("sergio.seguridad", "Operador de seguridad", "operador_seguridad", [], 2),
    ("silvia.secretos", "Custodia de secretos", "custodio_secretos", [], 2),
    ("aldo.auditor", "Auditor", "auditor", [], 3),
]

HOST = {"HTTP_HOST": "localhost", "HTTP_X_REAL_IP": "198.51.100.9"}


def _contrasena(usuario):
    while True:
        c = "-".join(secrets.choice(PALABRAS) for _ in range(3)) + f"-{secrets.randbelow(9000) + 1000}"
        if not contrasenas.errores_de_contrasena(c, usuario):
            return c


class Command(BaseCommand):
    help = "Crea personas de demostración (una por rol) con segundo factor y trámites de ejemplo, por la API real."

    def add_arguments(self, parser):
        parser.add_argument("--ensayo", action="store_true", help="Hace todo dentro de una transacción que se revierte (no deja nada).")

    def handle(self, *args, **opciones):
        self.ensayo = opciones["ensayo"]
        if not self.ensayo:
            return self._sembrar()

        class _Revertir(Exception):
            pass

        try:  # las decisiones del PDP son de solo inserción: en el ensayo no se escriben
            with transaction.atomic(), mock.patch.object(permisos, "_registrar_decision", lambda *a, **k: None):
                self._sembrar()
                raise _Revertir()
        except _Revertir:
            self.stdout.write("# ENSAYO: todo se revirtió, no quedó ningún dato")

    def _sembrar(self):
        ahora = timezone.now()
        instituciones = {i.nombre: i for i in Institucion.objects.all()}
        # La primera coordinadora quien asigna (nadie se asigna a sí mismo: lo impone la base): una cuenta técnica sin acceso
        asignador, _ = Usuario.objects.get_or_create(username="siembra.tecnica", defaults={"password_hash": contrasenas.hashear(secrets.token_urlsafe(24)), "estado_cuenta": "suspendida"})
        nuevas = {}
        for usuario, descripcion, plataforma, membresias, nivel in PERSONAS:
            if Usuario.objects.filter(username=usuario).exists():
                continue
            clave, secreto = _contrasena(usuario), mfa.nuevo_secreto()
            u = Usuario.objects.create(username=usuario, password_hash=contrasenas.hashear(clave), rol_plataforma=plataforma,
                                       nivel_aseguramiento=nivel, mfa_activo=True, mfa_secreto=mfa.cifrar(settings.SIGET_MFA_KEY, secreto),
                                       mfa_verificado_en=ahora)
            for institucion, rol in membresias:
                Membresia.objects.create(usuario=u, institucion=instituciones[institucion], rol=rol, asignado_por=asignador)
            nuevas[usuario] = u
            self.stdout.write(f"{usuario}|{descripcion}|{clave}|{secreto}")
        self._tramites(nuevas, instituciones)

    # ------------------------------------------------------------------ trámites de ejemplo, por la API

    def _http(self, metodo, ruta, usuario, datos=None):
        ahora = timezone.now()
        sesion = Sesion.objects.create(usuario=usuario, refresh_hash=tokens.hash_refresh(tokens.nuevo_refresh()), expira_en=ahora + timedelta(minutes=10))
        token = tokens.emitir_access(settings.SIGET_JWT_KEY, usuario.pk, sesion.pk, tokens.SCOPE_COMPLETO, ahora, 300, settings.SIGET_EMISOR)
        Usuario.objects.filter(pk=usuario.pk).update(mfa_verificado_en=ahora)  # el personal exige segundo factor reciente
        cabeceras = dict(HOST, HTTP_AUTHORIZATION=f"Bearer {token}")
        cliente = APIClient()
        r = cliente.get(ruta, secure=True, **cabeceras) if metodo == "get" else cliente.post(ruta, datos, format="json", secure=True, **cabeceras)
        cache.clear()
        if self.ensayo:
            transaction.set_rollback(False)  # DRF marca la transacción al rechazar; en producción cada petición tiene la suya
        return r

    def _crear(self, usuario, institucion):
        tipo = TipoTramite.objects.filter(institucion__nombre=institucion).order_by("id").first()
        r = self._http("post", "/tramites/", usuario, {"tipo_tramite": tipo.pk})
        assert r.status_code == 201, (usuario, r.status_code, r.content[:200])
        return r.json()["id"]

    def _estado(self, usuario, tramite, estado):
        r = self._http("post", f"/tramites/{tramite}/estado/", usuario, {"estado": estado})
        assert r.status_code == 200, (usuario, tramite, estado, r.status_code, r.content[:200])

    def _asignar(self, usuario, tramite, destino):
        r = self._http("post", f"/tramites/{tramite}/reasignar/", usuario, {"funcionario_id": destino.pk})
        assert r.status_code == 200, (usuario, tramite, r.status_code, r.content[:200])

    def _tramites(self, n, instituciones):
        if not {"ana.ciudadana", "beto.ciudadano", "fabio.mop", "flor.mop", "saul.mop", "felix.minsa"} <= set(n):
            return  # solo se siembran trámites junto con las personas que los protagonizan
        ana, beto, fabio, flor, saul, felix = (n[k] for k in ("ana.ciudadana", "beto.ciudadano", "fabio.mop", "flor.mop", "saul.mop", "felix.minsa"))
        t1 = self._crear(ana, "MOP")          # termina aprobado
        t2 = self._crear(ana, "MINSA")        # queda pendiente
        t3 = self._crear(beto, "MOP")         # en subsanación, asignado a flor
        t4 = self._crear(beto, "MOP")         # pendiente
        t5 = self._crear(ana, "Alcaldía (Municipio de Panamá)")
        self._estado(fabio, t1, "En Tramitacion")
        self._estado(saul, t1, "Aprobado")
        self._estado(fabio, t3, "En Tramitacion")
        self._asignar(saul, t3, flor)
        self._estado(flor, t3, "En Subsanacion")
        self._estado(felix, t2, "En Tramitacion")
        self.stdout.write(f"# trámites de ejemplo: {t1} aprobado, {t2} en tramitación (MINSA), {t3} en subsanación, {t4} y {t5} pendientes")
