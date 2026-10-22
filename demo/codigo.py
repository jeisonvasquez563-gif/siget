"""Muestra el código TOTP vigente de una cuenta de demostración.
Uso:  python demo/codigo.py fabio.mop        (sin argumento: lista todas con su contraseña y código)
Lee demo-local/siembra.local.txt (ignorado por git) (archivo ignorado por git: contiene credenciales)."""
import pathlib, sys, time
import pyotp

archivo = pathlib.Path(__file__).parent.parent / "demo-local" / "siembra.local.txt"
filas = [l.split("|") for l in archivo.read_text(encoding="utf-8").splitlines() if l and not l.startswith("#")]
buscado = sys.argv[1] if len(sys.argv) > 1 else None
restante = 30 - int(time.time()) % 30
for usuario, descripcion, clave, secreto in filas:
    if buscado and usuario != buscado:
        continue
    print(f"{usuario:18} {descripcion:30} {clave:28} {pyotp.TOTP(secreto).now()}  (cambia en {restante}s)")
