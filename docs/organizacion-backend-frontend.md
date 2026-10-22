# Organización del trabajo: backend y frontend

El proyecto se divide en **dos frentes con una frontera clara**: el [contrato de la API](./api.md). Cada frente es dueño de su carpeta, de su calidad y de su verificación; el contrato es lo único que comparten.

| | Backend (`backend/`, `database/`, `infra/`) | Frontend (`frontend/`) |
|---|---|---|
| **Meta** | Sólido y seguro: que nada pase sin autenticar, autorizar y quedar registrado | Detallado y hermoso: que se entienda, se vea profesional y funcione para todas las personas |
| **Es dueño de** | Django/DRF, PDP (ABAC), base de datos (RLS, triggers, roles), contenedores, nginx, secretos | React, sistema de diseño, accesibilidad, flujos de usuario |
| **No toca** | Estilos ni pantallas | Reglas de autorización: la interfaz solo *muestra*, el servidor decide |
| **Verifica con** | `pytest` (274), `verificar_*` contra la base real (11 + 51 + 34 pasos), `backend-ci` | `npm run build`, prueba visual con cada cuenta, `frontend-ci` |
| **Entrega al otro** | El contrato `docs/api.md` y las cuentas de demostración | Retroalimentación sobre lo que falta o estorba en la API |

## Cómo se trabaja

- Ramas: `feature/backend-<tema>` y `feature/frontend-<tema>`, desde `develop` (GitFlow de [`CONTRIBUTING.md`](../CONTRIBUTING.md)). Un PR toca **un solo frente**; si un cambio necesita ambos, son dos PR enlazados, y el contrato (`docs/api.md`) va en el primero.
- Cada frente tiene su CI (`.github/workflows/`): corre solo cuando cambia su carpeta.
- Revisión: cada PR lo revisa una persona **del otro frente además de una del propio**: el contrato se prueba mejor cuando alguien lo lee desde el otro lado.
- Todo cambio actualiza `CHANGELOG.md` y, si toca infraestructura, el runbook (regla de siempre).
- Nunca se suben credenciales: las cuentas de demostración y sus códigos viven solo en `demo-local/` (ignorado por git).

## Definición de «terminado»

**Backend:** pruebas unitarias; si toca la base, un paso en `verificar_*` contra la base real (en una transacción que se revierte); la ruta nueva entra en la auditoría de rutas (privada y con scope explícito); el PDP decide y registra; errores con el formato único; contrato actualizado; sin secretos en el diff.

**Frontend:** funciona con las 13 cuentas de demostración (cada rol ve solo lo suyo); estados de carga, vacío y error; se maneja el `403` con `reautenticacion_sugerida`; sin estilos ni scripts en línea (CSP); teclado y lector de pantalla; se ve bien en móvil y en pantalla de proyector.

## Hoja de ruta del backend (sólido y seguro)

| Prioridad | Tarea | Por qué |
|---|---|---|
| Alta | Consolas de los 5 roles de plataforma con **control dual real** (altas de instituciones y de coordinadores) | Son los módulos «próximamente»; materializan la separación de poderes |
| Alta | Plazos en días hábiles y **escalamiento automático** (temporizador de systemd) | Es el corazón del negocio: trazabilidad y vencimientos |
| Alta | Recuperación de contraseña y **lista de sesiones activas con revocación** | Cierra el ciclo de vida de la identidad |
| Alta | Documentos adjuntos (almacenamiento cifrado, tipo y tamaño validados) y notificaciones | Módulos de la arquitectura aún sin construir |
| Media | Rotación de claves JWT y Fernet con identificador de clave; reemisión de la CA interna con `keyUsage` | Higiene criptográfica |
| Media | Cadena de hashes en el registro de auditoría (evidencia de manipulación) y exportación firmada | Auditoría verificable más allá de los permisos |
| Media | Pruebas de seguridad automáticas: `pip-audit`, `bandit`/`semgrep`, pruebas de la matriz de permisos generadas desde el PDP, fuzzing de la API contra un OpenAPI | Que nada dependa de la memoria de quien programó |
| Media | Respaldos automáticos con **restauración probada**, logs estructurados y alertas (reuso de token, ráfagas de denegaciones) | Operación confiable |
| Baja | Passkeys (WebAuthn) como alternativa al TOTP; escaneo y firma de imágenes | Defensa en profundidad |

## Hoja de ruta del frontend (detallado y hermoso)

| Prioridad | Tarea | Por qué |
|---|---|---|
| Alta | **Sistema de diseño**: tokens (color, tipografía, espacio, sombras, radios), componentes base (botón, campo, tabla, insignia, tarjeta, modal, pestañas) y modo claro/oscuro | Consistencia y velocidad para todo lo demás |
| Alta | Pulido visual de las 4 pantallas clave: login, inicio por rol, bandeja y detalle del trámite (línea de tiempo) | Es lo que se proyecta |
| Alta | Estados completos: *skeletons* de carga, vacíos con ilustración y mensaje útil, errores amables, avisos (*toasts*) y confirmaciones | Se siente producto, no prototipo |
| Alta | Accesibilidad AA (contraste, foco, teclado, `aria-*`, reducir movimiento) y responsive real | Funciona para todas las personas |
| Media | Bandeja tipo tablero (columnas por estado) con búsqueda, orden y filtros guardados | Productividad del funcionario |
| Media | Gráficos de auditoría más ricos (tendencias por hora, mapa de calor de denegaciones) | Valor para el rol auditor |
| Media | Tipografía y gráficos **propios** (autohospedados): la CSP no permite CDNs ni estilos en línea | Mantener Zero Trust también en el cliente |
| Media | Pruebas: ESLint, Vitest + Testing Library para los flujos, Playwright para el recorrido por rol | Que lo bonito no se rompa |
| Baja | Internacionalización (es/en), impresión del trámite, atajos de teclado | Detalle |

**Decisión técnica pendiente (frontend):** la intención inicial era Tailwind + shadcn/ui. Esas librerías suelen inyectar estilos en línea (posicionamiento), lo que choca con la CSP estricta de nginx (`default-src 'self'`). Recomendación: **mantener un sistema de diseño propio con variables CSS** (ya hay una base en `src/estilos.css`) y, si hace falta, usar primitivas sin estilo (p. ej. Radix) vestidas con esas variables; relajar la CSP con `unsafe-inline` queda descartado porque debilita justo lo que defendemos.

## Reparto del equipo

| Frente | Responsables | Alcance sugerido |
|---|---|---|
| Backend: núcleo y seguridad | _por asignar_ | Consolas de plataforma, control dual, rotación de claves, pruebas de seguridad |
| Backend: negocio y operación | _por asignar_ | Plazos y escalamiento, documentos, notificaciones, respaldos |
| Frontend: sistema de diseño y flujos | _por asignar_ | Componentes, login, inicio, bandeja, detalle |
| Frontend: auditoría y calidad | _por asignar_ | Gráficos, accesibilidad, pruebas |

> Pendiente de Jeison: confirmar quién va en cada fila (9 integrantes). Mientras tanto, cualquier persona puede tomar una tarea de las tablas de arriba abriendo una rama `feature/backend-…` o `feature/frontend-…`.
