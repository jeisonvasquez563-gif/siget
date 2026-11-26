"""Derechos de la persona sobre sus datos personales (Ley 81 de 2019) y aviso de privacidad. Lógica pura, sin base de datos.

La ley reconoce acceso, rectificación, cancelación, oposición y portabilidad, y exige responder en no más de 10 días hábiles y
sin costo. En SIGET:
- Acceso y portabilidad: la persona ve y descarga sus datos desde «Mis datos» (no hace falta pedirlo a nadie).
- Rectificación: corrige sola su correo, provincia y ciudad; nombre, apellidos, cédula y fecha de nacimiento van por una solicitud.
- Cancelación y oposición: solicitud que atiende el operador de identidades. NO se borra nada automáticamente: los trámites son
  expediente público con conservación obligatoria; la respuesta explica qué se puede borrar y qué no.
La Administración no necesita autorización para los datos que usa en el ejercicio de sus funciones (art. 8), pero sí debe informar:
de ahí el aviso de privacidad, que se muestra antes del registro y del que queda constancia (versión y hora) en el perfil.
"""
from datetime import datetime

from apps.tramites.serializacion import sumar_dias_habiles

PLAZO_DIAS_HABILES = 10
MAX_SOLICITUDES_ABIERTAS = 3
DETALLE_MIN, DETALLE_MAX = 10, 1000
RESPUESTA_MIN, RESPUESTA_MAX = 10, 2000

TIPOS_SOLICITUD = ("rectificacion", "cancelacion", "oposicion")
ESTADOS_SOLICITUD = ("recibida", "atendida", "rechazada")
RESOLUCIONES = ("atendida", "rechazada")

MENSAJE_ACEPTA_AVISO = "debes leer el aviso de privacidad y confirmarlo (acepta_aviso: true)"


# --------------------------------------------------------------------------- plazo en días hábiles

def vence_en(ahora: datetime, feriados=frozenset()) -> datetime:
    """Plazo de respuesta: 10 días hábiles de Panamá (lunes a viernes que no son feriado), a la misma hora."""
    return sumar_dias_habiles(ahora, PLAZO_DIAS_HABILES, feriados)


# --------------------------------------------------------------------------- solicitudes

def _texto(valor):
    return valor.strip() if isinstance(valor, str) else ""


def validar_solicitud(datos):
    """Devuelve ((tipo, detalle), errores). El detalle no es un formulario de datos nuevos: describe qué quiere la persona."""
    datos = datos if isinstance(datos, dict) else {}
    errores = []
    tipo, detalle = datos.get("tipo"), _texto(datos.get("detalle"))
    if not isinstance(tipo, str) or tipo not in TIPOS_SOLICITUD:
        errores.append("el tipo debe ser «rectificacion», «cancelacion» u «oposicion»")
    if not DETALLE_MIN <= len(detalle) <= DETALLE_MAX:
        errores.append(f"el detalle debe tener de {DETALLE_MIN} a {DETALLE_MAX} caracteres")
    return ((tipo, detalle), []) if not errores else (None, errores)


def validar_resolucion(datos):
    """Respuesta del operador: devuelve ((estado, respuesta), errores)."""
    datos = datos if isinstance(datos, dict) else {}
    errores = []
    estado, respuesta = datos.get("estado"), _texto(datos.get("respuesta"))
    if not isinstance(estado, str) or estado not in RESOLUCIONES:
        errores.append("el estado debe ser «atendida» o «rechazada»")
    if not RESPUESTA_MIN <= len(respuesta) <= RESPUESTA_MAX:
        errores.append(f"la respuesta debe tener de {RESPUESTA_MIN} a {RESPUESTA_MAX} caracteres")
    return ((estado, respuesta), []) if not errores else (None, errores)


def esta_vencida(estado, vence, ahora) -> bool:
    return estado == "recibida" and vence < ahora


# --------------------------------------------------------------------------- aviso de privacidad

AVISO_VERSION = "2026-11-17"
AVISO_VIGENTE_DESDE = "2026-11-17"

# Para qué se pide cada dato (finalidad). Si un dato no tiene finalidad aquí, no se debe pedir.
FINALIDAD_DE_LOS_DATOS = [
    {"dato": "Nombre y apellidos", "para_que": "Identificarte como la persona que presenta cada trámite ante las instituciones."},
    {"dato": "Número de cédula", "para_que": "Identidad única: evitar que una misma persona tenga dos cuentas y que alguien se haga pasar por otra. Se guarda cifrada."},
    {"dato": "Fecha de nacimiento", "para_que": "Comprobar que eres mayor de edad para crear una cuenta. No se usa para nada más."},
    {"dato": "Provincia y ciudad", "para_que": "Saber de dónde presentas los trámites y orientar a la institución que te atiende."},
    {"dato": "Correo electrónico", "para_que": "Dato de contacto de tu cuenta. Todavía no se verifica ni se envían correos desde SIGET."},
    {"dato": "Usuario y contraseña", "para_que": "Entrar a tu cuenta. La contraseña nunca se guarda: solo una huella irreversible."},
    {"dato": "Actividad de seguridad (inicios de sesión, segundo factor, bloqueos)", "para_que": "Proteger tu cuenta y detectar accesos extraños. Tú también la ves en «Mi seguridad». No lleva tu cédula ni tu correo."},
]

_SECCIONES = [
    ("Quién trata tus datos",
     "SIGET es la plataforma de trámites con la que las instituciones del Estado atienden a la ciudadanía. "
     "Los datos los trata SIGET y, para cada trámite, la institución a la que lo diriges. Para cualquier asunto sobre tus datos, escribe una "
     "solicitud desde «Mis datos»: la atiende el operador de identidades de la plataforma."),
    ("Por qué podemos usarlos",
     "Una institución pública no necesita tu autorización para usar los datos que requiere para cumplir sus funciones (Ley 81 de 2019, art. 8), "
     "pero sí debe informarte con claridad. Este aviso es esa información: marcar que lo leíste no es una autorización adicional."),
    ("Quién puede verlos",
     "Tú ves todo lo tuyo desde «Mis datos». El personal de una institución ve solo los trámites de su institución, no tu perfil completo. "
     "Las cuentas de la plataforma (operadores, custodio de secretos, auditoría) no ven trámites. La auditoría lee acciones, no identidades civiles: "
     "ni ella ni la consulta técnica de la base leen tu cédula, tu correo ni tus solicitudes."),
    ("Cuánto tiempo los conservamos",
     "Tu perfil se conserva mientras tu cuenta exista. Los trámites son expediente público y tienen conservación obligatoria: no se borran, ni a "
     "pedido tuyo. El registro de seguridad y el de auditoría son inalterables por diseño; por eso no llevan cédula, correo ni nombre."),
    ("Tus derechos (Ley 81 de 2019)",
     "Acceso: ves tu perfil completo en «Mis datos». Portabilidad: lo descargas en un archivo JSON. Rectificación: corriges tú mismo tu correo, "
     "tu provincia y tu ciudad (se pide el segundo factor); nombre, apellidos, cédula y fecha de nacimiento se corrigen con una solicitud. "
     "Cancelación y oposición: las pides con una solicitud; la respuesta explica qué datos se pueden borrar y cuáles no deben borrarse por ley. "
     "Ejercer tus derechos no cuesta nada."),
    ("Cómo ejercerlos y en cuánto tiempo",
     "Entra a «Mis datos» y usa «Solicitudes sobre mis datos personales». Respondemos en no más de 10 días hábiles. "
     "Si no te responden a tiempo, la solicitud aparece como vencida para el operador."),
]


def aviso_vigente() -> dict:
    """El aviso que se muestra antes del registro. `texto` es la misma información en una sola cadena (para leerla o archivarla)."""
    secciones = [{"titulo": titulo, "texto": texto} for titulo, texto in _SECCIONES]
    partes = [f"Aviso de privacidad de SIGET (versión {AVISO_VERSION})"]
    partes += [f"{s['titulo']}\n{s['texto']}" for s in secciones]
    partes.append("Datos que pedimos y para qué\n" + "\n".join(f"- {f['dato']}: {f['para_que']}" for f in FINALIDAD_DE_LOS_DATOS))
    return {
        "version": AVISO_VERSION, "vigente_desde": AVISO_VIGENTE_DESDE, "titulo": "Aviso de privacidad",
        "base_legal": "Ley 81 de 2019, de Protección de Datos Personales (Panamá)",
        "plazo_respuesta_dias_habiles": PLAZO_DIAS_HABILES,
        "secciones": secciones, "datos": FINALIDAD_DE_LOS_DATOS, "derechos": ["acceso", "rectificacion", "cancelacion", "oposicion", "portabilidad"],
        "texto": "\n\n".join(partes),
    }
