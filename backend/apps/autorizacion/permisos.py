"""Clases de permiso de DRF."""
from rest_framework.permissions import BasePermission


class DenegarPorDefecto(BasePermission):
    """Permiso por defecto de toda la API: niega. Una vista debe declarar explícitamente cómo se autoriza."""

    message = "Acceso denegado: ninguna política lo permite."

    def has_permission(self, request, view):
        return False
