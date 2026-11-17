"""Manejo de errores de la API.

DRF convierte a TEXTO todos los valores del `detail` de una excepción (un `True` llega como "True"), lo que
rompe el contrato de la API: una interfaz que haga `if (respuesta.reautenticacion_sugerida)` trataría "False"
como verdadero. `AccesoDenegado` lleva su cuerpo ya armado y el manejador lo devuelve tal cual, con los tipos reales.
"""
from rest_framework.exceptions import PermissionDenied


class AccesoDenegado(PermissionDenied):
    def __init__(self, cuerpo):
        super().__init__(detail=cuerpo.get("detalle"))
        self.cuerpo = cuerpo


def manejador(exc, contexto):
    # Import diferido: `rest_framework.views` carga los permisos por defecto, que importan este módulo (ciclo)
    from rest_framework.views import exception_handler

    # La función de DRF también marca la transacción para revertirla: se conserva ese comportamiento
    respuesta = exception_handler(exc, contexto)
    if respuesta is not None and isinstance(exc, AccesoDenegado):
        respuesta.data = exc.cuerpo
    return respuesta
