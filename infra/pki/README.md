# PKI interna de SIGET

`siget-ca.crt` es el **certificado público** de la autoridad certificadora interna del proyecto. Sirve para que un equipo confíe en los certificados que emite (nginx, PostgreSQL). **No es un secreto**; la clave privada de la CA vive solo en VM2 (`/root/siget-ca/`, accesible solo por root) y nunca se sube al repositorio.

## Para qué se usa

| Quién | Qué verifica |
|---|---|
| La aplicación (Django) | El certificado de PostgreSQL, con `verify-full` |
| El navegador del usuario | El certificado de nginx (HTTPS) |

## Cómo confiar en la CA en tu equipo (para ver la aplicación sin avisos del navegador)

**Windows:** doble clic en `siget-ca.crt`, *Instalar certificado*, *Equipo local* (o *Usuario actual*), elegir *Colocar todos los certificados en el siguiente almacén* y seleccionar **Entidades de certificación raíz de confianza**.

**Linux:** `sudo cp siget-ca.crt /etc/pki/ca-trust/source/anchors/ && sudo update-ca-trust`.

**Comprobar la huella antes de confiar** (debe coincidir con la que figura en el runbook, sección 24; SHA-256 `F4:F4:15:F6:E5:4F:93:A7:77:7B:83:16:E3:97:87:17:31:AB:3B:08:6B:88:B9:C4:AD:77:C7:78:AD:8A:CC:E0`):

```bash
openssl x509 -in siget-ca.crt -noout -fingerprint -sha256
```

Instalar una CA en el equipo es una decisión de confianza: solo se hace con la huella verificada por otro canal (por ejemplo, preguntándole a Jeison).

## Certificados emitidos

| Certificado | Para | Vence |
|---|---|---|
| PostgreSQL (`db-server`) | VM2, puerto 5433 | octubre de 2027 |
| nginx (`app-backend`) | VM1, puerto 8443 | octubre de 2027 |
