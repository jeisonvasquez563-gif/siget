# Estructura de la plataforma SIGET

Explicación de cómo está organizada la plataforma: sus piezas, cómo se comunican, qué ocurre en cada petición y qué existe hoy frente a lo que se construye. Complementa el [diseño Zero Trust](./superpowers/specs/2026-10-08-arquitectura-zero-trust-design.md), los [módulos](./modulos.md) y los [roles y permisos de la base](./roles-permisos-bd.md).

![Estructura de la plataforma SIGET](./img/estructura-plataforma.svg)

*Teal: existía al diseñar el diagrama. Morado: se construía. **A 21 de octubre de 2026 las dos mitades existen** (ver la sección 4).*

## 1. La idea en una frase

SIGET son dos máquinas con una sola puerta de entrada: la primera atiende al usuario y decide si puede pasar, la segunda guarda los datos y los protege por su cuenta, y entre ambas todo viaja cifrado.

## 2. Las tres piezas

| Pieza | Dónde corre | Qué hace | Qué no hace |
|---|---|---|---|
| Navegador | Equipo del usuario | Muestra la interfaz (React) y se comunica por HTTPS | No decide nada de seguridad: lo que decida el navegador se puede manipular |
| Aplicación | VM1, en contenedores Podman sin root | `nginx` cifra, sirve la interfaz y es la única entrada; Django + DRF verifica identidad y decide el acceso; (planeado) un temporizador escala los trámites vencidos | No accede a la base como superusuario |
| Base de datos | VM2, PostgreSQL 16 | Guarda los datos, filtra las filas por institución y mantiene una auditoría inalterable | No acepta conexiones sin TLS ni del superusuario por red |

## 3. Qué pasa cuando una persona consulta su trámite

1. La persona entra por HTTPS a `nginx`, que pasa la petición a Django.
2. Django verifica su sesión y su segundo factor y arma su contexto: quién es, qué pide, de qué institución y desde dónde.
3. El decisor de acceso (PDP) evalúa las reglas con atributos. Si ninguna permite, se niega. Si el decisor falla, también se niega.
4. Se registra la decisión, sea permitida o negada, con los atributos usados.
5. Django consulta la base por TLS 1.3 verificando el certificado del servidor.
6. La base devuelve solo las filas que corresponden, aunque Django se equivocara: esa es la segunda barrera (RLS).
7. Si un funcionario cambia el estado, el cambio y su evento de auditoría se guardan en la misma transacción: se guardan los dos o ninguno.

Hay **dos barreras independientes**: el decisor de la aplicación y la base de datos. Si alguien vulnera la aplicación, la base sigue negando lo que no corresponde.

## 4. Qué existe hoy y qué no

| Parte | Estado | Detalle |
|---|---|---|
| Base de datos (VM2) | ✅ Existe | Esquema `siget`, roles sin superusuario, RLS, auditoría de solo inserción, TLS con la aplicación. **Corre en un contenedor Podman rootless** (desde el 20-oct); la instalación nativa antigua está apagada y deshabilitada desde el 20-oct (sus datos se conservan) |
| Aislamiento y acceso (las dos VMs) | ✅ Existe | Red interna, firewall, SELinux, SSH solo por clave, Tailscale, registro persistente |
| Podman rootless | ✅ En uso en las dos VMs | Usuario de servicio `siget`: en VM2 ejecuta PostgreSQL; en VM1, el pod con `nginx` y Django |
| `nginx` y el pod de VM1 | ✅ Existe | TLS 1.3, cabeceras de seguridad, límite de tasa; sirve la interfaz y reenvía solo las rutas de la API. Apache + PHP (el checkpoint, que se retira en la semana 6) sigue en el puerto 80 |
| Backend (Django + DRF) | ✅ Existe | Autenticación con segundo factor, decisor de acceso (ABAC), trámites, catálogo, equipo, auditoría, transparencia de roles y simulador |
| Frontend (React) | ✅ Existe | 10 módulos completos por rol, sistema de diseño propio, claro/oscuro, accesible |
| Plazos con escalamiento automático, documentos y notificaciones | ⏳ No existen | Pendientes (ver [`modulos.md`](./modulos.md)) |

Las dos mitades del diagrama existen; lo pendiente es lo que aparece como ⏳.

## 5. Dónde vive cada cosa en el repositorio

| Carpeta | Qué contiene |
|---|---|
| `backend/` | Django + DRF: autenticación, autorización (PDP), trámites, catálogo, identidad, auditoría; comandos de verificación |
| `frontend/` | React + Vite: pantallas por rol, sistema de diseño, pruebas y simulador de desarrollo |
| `infra/` | Unidades de Podman/Quadlet, `nginx.conf` y la CA pública de las VMs |
| `database/` | Esquema, roles, migraciones 002–007, pruebas y demo |
| `demo/` | Ensayo automático de la demostración y herramientas de apoyo |
| `checkpoints/` | El PHP intermedio, que se retira en la semana 6 |
| `docs/` | Toda la documentación |

## 6. Lo que sostiene todo

Franja inferior del diagrama: SELinux y firewall en las dos máquinas, secretos fuera del código (`podman secret`), un registro persistente de lo que ocurre y acceso del equipo solo por Tailscale y con clave. Todo está hecho.

## 7. Qué decir al profesor

- **Se puede afirmar con evidencia:** la plataforma funciona de punta a punta (interfaz, API, decisor de acceso, base de datos, auditoría) con 354 pruebas del backend, 130 del frontend, 6 verificaciones contra la base real y un ensayo de la demostración de 55 comprobaciones. Cómo abrirla: [`como-abrir-la-plataforma.md`](./como-abrir-la-plataforma.md).
- **No se debe afirmar:** que existan los plazos con escalamiento automático, los documentos adjuntos, las notificaciones ni las consolas de los operadores de plataforma (ver [`modulos.md`](./modulos.md)).
