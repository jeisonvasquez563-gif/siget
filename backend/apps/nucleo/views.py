from django.db import transaction
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response


@transaction.non_atomic_requests  # con ATOMIC_REQUESTS cada petición abriría la base: esta no debe tocarla
@api_view(["GET"])
@permission_classes([AllowAny])  # única vista pública: no accede a datos ni a la base
def salud(request):
    return Response({"estado": "ok"})
