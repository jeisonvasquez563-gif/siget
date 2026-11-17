# Plan de ejecución: trabajo pendiente de SIGET (responsable: Andy Martínez)
> **Actualización del 22-oct:** los paquetes **PT-4** (consolas de los operadores de plataforma con control dual) y **PT-5** (recuperación de contraseña asistida) ya están construidos, probados y desplegados por Jeison; ver [`runbook.md` §34](../runbook.md). Quedan para Andy el resto de los paquetes.


**Especificación (qué se construye, diseño y criterios de aceptación):** [`../superpowers/specs/2026-10-21-pendientes-design.md`](../superpowers/specs/2026-10-21-pendientes-design.md). Este documento dice **en qué orden, cuándo y cómo** se hace. Aprobador de todo lo que toque las VMs: **Jeison Vásquez**. Semana 1 = 12 de octubre de 2026.

## 1. Cómo se trabaja (léelo antes de empezar)

| Regla | Detalle |
|---|---|
| **Ramas y PR** | `feature/backend-<tema>` o `feature/frontend-<tema>` desde `develop`. Un PR por frente, hacia `develop`, con **revisión cruzada**. Nunca se sube directo a `develop` ni a `main` |
| **Commits** | [Conventional Commits](https://www.conventionalcommits.org/) en minúsculas, sin atribución de herramientas |
| **Definición de «terminado»** | La de la sección 3 de la especificación: pruebas, `verificar_*` contra la base real si toca la base, ruta en la auditoría de rutas, PDP, contrato `api.md`, `CHANGELOG.md`, runbook, sin secretos |
| **Antes de cada PR** | `cd backend && python -m pytest -q` · `cd frontend && npm run verificar` · `python demo/ensayo.py` debe seguir en **55 de 55** (pídele a Jeison las credenciales locales de demostración; no se comparten por chat ni por git) |
| **Lo privilegiado** | Andy deja **un comando listo y probado** (migración, unidad de systemd, secreto) y Jeison lo revisa y lo ejecuta, con **respaldo previo** de la base. En VM2 Andy no tiene `sudo` |
| **Migraciones** | Archivo numerado en `database/migraciones/` (siguiente: `008`), con su prueba, **sin contraseñas** y documentado en el README de migraciones. Se prueba primero contra una **copia restaurada** de la base |
| **Seguridad** | Nada de credenciales en el repositorio ni en la documentación; todo secreto es `podman secret`; revisa el diff antes de subir |
| **Cadencia** | Resumen corto cada viernes a Jeison: qué se terminó, qué se bloqueó y qué necesita de él (aprobaciones, comandos a ejecutar) |

## 2. Cronograma

| Semana | Fechas | Paquetes | Meta de la semana |
|---|---|---|---|
| **S3** | 26 oct – 1 nov | **PT-0** puesta en marcha · **PT-1** respaldos · **PT-2** endurecimiento y registro | Nunca más estar a un fallo de perder la base; la plataforma lista para exponerse |
| **S4** | 2 – 8 nov | **PT-3** plazos en días hábiles y escalamiento | Los vencimientos escalan solos |
| **S5** | 9 – 15 nov | **PT-4a** consolas de identidades y catálogo · **PT-6** rotación de claves | Control dual real de punta a punta |
| **S6** | 16 – 22 nov | **PT-5** recuperación de contraseña · **PT-4b** consolas de seguridad, secretos e infraestructura · **PT-13** retiro del PHP | Sin el checkpoint PHP |
| **S7** | 23 – 29 nov | **PT-8** documentos adjuntos · **PT-7** reemisión de la CA (ventana con el equipo) | Adjuntos cifrados y la CA corregida |
| **S8** | 30 nov – 6 dic | **PT-9** notificaciones · **PT-10** alertas y exportación firmada | La plataforma avisa y se puede auditar con evidencia firmada |
| **S9** | 7 – 13 dic | **PT-11** inventario y postura · **PT-12** calidad del frontend · **PT-14** internet (si hay decisión) | Verificable y pulida |
| **S10** | 14 – 20 dic | **ZT-10** verificación final · entregables `.docx` · cierre | Los 7 principios con evidencia |

Los paquetes están ordenados por riesgo y por dependencias (PT-5 antes de PT-13; PT-2 antes de PT-14; PT-3 antes de las notificaciones de escalamiento). **Una sola persona no abarca todo**: las columnas «Se puede repartir» de cada paquete marcan lo que pueden tomar otros integrantes (frontend, documentación, pruebas) sin esperar a Andy. Si en alguna semana la carga no cabe, se mueve de abajo hacia arriba (primero P3, luego P2), nunca los P0.

## 3. Paquetes y tareas

Cada tarea es una casilla; al terminarla se marca en el PR. «Evidencia» es lo que se pega en la descripción del PR.

### PT-0 · Puesta en marcha (S3, días 1–2)

| ☐ | Tarea | Evidencia |
|---|---|---|
| ☐ | Leer [`historial-del-proyecto.md`](../historial-del-proyecto.md), [`como-abrir-la-plataforma.md`](../como-abrir-la-plataforma.md), [`api.md`](../api.md), [`organizacion-backend-frontend.md`](../organizacion-backend-frontend.md) y la sección 3 de la especificación | — |
| ☐ | Clonar el repositorio, crear el entorno (`backend/.venv`, `npm install`) y correr `pytest` (354) y `npm run verificar` (130) | Salida de las dos |
| ☐ | Ver las pantallas con `npm run dev` y `http://localhost:5173/?mock=saul.mop` | — |
| ☐ | Entrar a VM1 por Tailscale (`ssh andy_martinez@100.104.206.118`) y comprobar `sudo -u siget podman ps` y `sudo systemctl --no-pager status` | Salida |
| ☐ | **Versionar y probar los scripts operativos** [`infra/podman/vm1-app-backend/scripts/`](../../infra/podman/vm1-app-backend/scripts/) (hoy solo existían en `/tmp` de la VM): adaptar `desplegar.sh` para que funcione con solo `sudo -u siget` y verificar `ejecutar-comando.sh verificar_esquema` | PR con los scripts y su documentación |
| ☐ | Ejecutar con Jeison el ensayo `python demo/ensayo.py` y entender cada sección | «55 de 55» |

### PT-1 · Respaldos automáticos con restauración probada (S3) — P0

| ☐ | Tarea | Evidencia |
|---|---|---|
| ☐ | Decidir con Jeison **dónde** va la copia fuera de la VM (decisión abierta 2 de la especificación) y cómo se cifra (`age` u otro; la clave **no** vive en la VM) | Decisión en el PR |
| ☐ | Script de respaldo: `pg_dump -Fc` + `pg_dumpall --globals-only` desde el contenedor, permisos 600, retención 14 diarios y 8 semanales, registro en el journal | Script y prueba en un directorio temporal |
| ☐ | Unidad `systemd timer` (usuario `siget`, VM2) y su servicio; **comando de instalación listo para Jeison** | Archivos en `infra/podman/vm2-db-server/` |
| ☐ | Script de **prueba de restauración**: restaurar el último volcado en una base temporal, comparar esquema y conteos (`verificar_esquema`) y borrarla | Salida de una ejecución real |
| ☐ | Procedimiento de recuperación completa (de cero a plataforma funcionando) en el runbook, probado una vez | Sección nueva del runbook |
| ☐ | Jeison instala el temporizador; Andy confirma la primera ejecución y la primera restauración | Capturas del journal |

**Se puede repartir:** la redacción del procedimiento de recuperación (documentación).

### PT-2 · Endurecimiento previo a internet y registro configurable (S3) — P0

| ☐ | Tarea | Evidencia |
|---|---|---|
| ☐ | nginx: `set_real_ip_from` (solo el proxy) y `real_ip_header`; los límites de tasa por la IP real | Prueba con dos IPs distintas que muestra cupos separados |
| ☐ | Variable `SIGET_REGISTRO` (`cerrado`, `invitacion`, `abierto`), por defecto `abierto`; pruebas de los tres modos | `pytest` |
| ☐ | Modo `invitacion`: tabla `invitacion` (código de un solo uso con vencimiento, solo el hash) y alta por el operador de identidades | Migración `008` + `verificar_autenticacion` ampliado |
| ☐ | Aviso opcional de «demostración académica» en la interfaz, por configuración, con su prueba y accesibilidad | `npm run verificar` |
| ☐ | Documentar cómo agregar un nombre a `SIGET_ALLOWED_HOSTS` | Runbook |
| ☐ | Ensayo en 55 de 55 con el modo `abierto` (sin cambio de comportamiento) | Salida |

**Se puede repartir:** el aviso de la interfaz (frontend).

### PT-3 · Plazos en días hábiles y escalamiento (S4) — P1

| ☐ | Tarea | Evidencia |
|---|---|---|
| ☐ | Calendario de feriados nacionales de Panamá **verificado con una fuente oficial** y migración de la tabla `feriado` | Fuente citada en el PR |
| ☐ | `sumar_dias_habiles` y sus pruebas de bordes; `fecha_limite` la usa; migración **explícita** de los plazos ya existentes (decidir con Jeison si se conservan) | `pytest` |
| ☐ | Migración: `tramite.escalado_en`, función `siget.escalar_vencidos()` (`SECURITY DEFINER`) y `escalador_role` sin superusuario ni `BYPASSRLS` | Migración `009` probada en una copia |
| ☐ | Comando `escalar_vencidos` idempotente y su `systemd timer` en VM1 | Dos ejecuciones seguidas no duplican |
| ☐ | `verificar_tramites` ampliado: un trámite vencido que el job escala una sola vez, con su evento y su decisión | Salida |
| ☐ | Interfaz: indicador «escalado» y filtro «Escalados» en supervisión; pruebas de pantalla | `npm run verificar` |
| ☐ | Jeison aplica la migración y crea el secreto de `escalador_role` | — |

**Se puede repartir:** la parte de interfaz (frontend).

### PT-4a / PT-4b · Consolas de plataforma con control dual (S5 y S6) — P1

| ☐ | Tarea | Evidencia |
|---|---|---|
| ☐ | **Identidades:** proponer, aprobar y rechazar el alta de coordinadores; restablecer el segundo factor (control dual) | `verificar_plataforma` |
| ☐ | **Catálogo:** proponer y aprobar altas de instituciones y de tipos de trámite con su SLA | ídem |
| ☐ | **Seguridad:** bloquear cuentas y revocar sesiones | ídem |
| ☐ | **Secretos:** registro de rotaciones (solo metadatos, nunca el valor) y recordatorio de vencimientos | ídem |
| ☐ | **Infraestructura:** estado de los servicios, solo lectura | ídem |
| ☐ | Nuevo comando `verificar_plataforma` contra la base real: el mismo operador no aprueba lo suyo; el rol equivocado recibe 403; todo queda en auditoría; ninguna consola devuelve trámites | Salida |
| ☐ | `modulos.py`: cada consola pasa de «próximamente» a «disponible»; actualizar `docs/modulos.md` | PR |
| ☐ | Una pantalla por consola con pruebas de pantalla, accesibilidad (axe) y datos de ejemplo en `mock.js` | `npm run verificar` |

**Se puede repartir:** las pantallas (frontend), una consola por persona.

### PT-6 · Rotación de claves JWT y Fernet (S5) — P2

| ☐ | Tarea | Evidencia |
|---|---|---|
| ☐ | Anillo de claves JWT con `kid` (actual + anterior) y `MultiFernet` para los secretos TOTP | `pytest` |
| ☐ | Comando que re-cifra los secretos TOTP con la clave nueva | Prueba |
| ☐ | **Ensayo de rotación contra la base real** que no invalida ninguna cuenta | Salida |
| ☐ | Procedimiento y frecuencia en el runbook; Jeison crea los secretos nuevos | Runbook |

### PT-5 · Recuperación de contraseña asistida (S6) — P2

| ☐ | Tarea | Evidencia |
|---|---|---|
| ☐ | Acción `restablecer_contrasena` en el PDP **y en la matriz** (una prueba lo exige) | `pytest` |
| ☐ | Código de un solo uso (solo su hash, vence a los 15 minutos) emitido por el operador de identidades | Migración `010` |
| ☐ | Fijar la contraseña nueva con la política vigente; revocar todas las sesiones; el segundo factor sigue vigente | Pruebas |
| ☐ | Pruebas de reuso del código, vencimiento y enumeración de usuarios (respuesta idéntica); paso en `verificar_autenticacion` | Salida |
| ☐ | Pantalla de restablecimiento y de emisión del código | `npm run verificar` |

### PT-13 · Retiro del checkpoint PHP (S6, fin de semana) — requiere aprobación

| ☐ | Tarea | Evidencia |
|---|---|---|
| ☐ | Comprobar que la plataforma cubre registro, login, restablecimiento, segundo factor y bloqueo | Lista de equivalencias |
| ☐ | **Respaldo previo** de la base y de `checkpoints/` | Hash del respaldo |
| ☐ | Comandos listos para Jeison: apagar `php-fpm`/Apache de la app, quitar `/gestion/`, revocar `checkpoint_app`, cerrar el puerto 80 | Runbook |
| ☐ | Ensayo en 55 de 55 y matriz de Zero Trust con el desvío del HTTP cerrado | Salida y `zero-trust-cobertura.md` |

### PT-8 · Documentos adjuntos (S7) — P2

| ☐ | Tarea | Evidencia |
|---|---|---|
| ☐ | Migración `documento` con RLS como `tramite` y sin borrado; volumen y secreto de cifrado (Jeison) | Migración y comandos |
| ☐ | Almacenamiento cifrado por archivo (AES-GCM); ruta que nunca viene del cliente | Prueba |
| ☐ | Validación: lista cerrada (PDF, PNG, JPEG), contenido real, máximo 5 MB, nombre saneado | Pruebas con archivos hostiles |
| ☐ | `POST /tramites/<id>/documentos/` (solo esa vista admite `multipart`) y descarga con `attachment` y `nosniff` | `api.md` y pruebas |
| ☐ | `verificar_documentos` contra la base real (otro ciudadano recibe 404; el archivo no se lee en claro en disco) | Salida |
| ☐ | Pantalla de carga y listado con accesibilidad; (opcional) análisis con ClamAV | `npm run verificar` |

### PT-7 · Reemisión de la CA con `keyUsage` (S7) — con ventana acordada

| ☐ | Tarea | Evidencia |
|---|---|---|
| ☐ | Procedimiento: CA nueva (`CA:TRUE`, `keyCertSign, cRLSign`), reemitir nginx y PostgreSQL, conservar la anterior durante la transición, plan de vuelta atrás | Runbook |
| ☐ | Acordar la ventana con el equipo y avisarles que deberán reinstalar la CA | Mensaje al equipo |
| ☐ | Jeison ejecuta (la CA vive en VM2); actualizar `infra/pki/siget-ca.crt` y la huella en la guía de acceso | PR |
| ☐ | `verificar_*` y `demo/ensayo.py` pasan **sin** relajar `VERIFY_X509_STRICT` (quitar ese relajamiento de los scripts) | Salida |

### PT-9 · Notificaciones (S8) — P3

| ☐ | Tarea | Evidencia |
|---|---|---|
| ☐ | Migración `notificacion` con RLS (solo la propia persona) | Migración |
| ☐ | Generarlas al cambiar de estado, reasignar, escalar o pedir subsanación | Pruebas |
| ☐ | Campana con contador en la barra superior, sin sondeos agresivos | `npm run verificar` |

### PT-10 · Alertas y exportación firmada (S8) — P3

| ☐ | Tarea | Evidencia |
|---|---|---|
| ☐ | `detectar_anomalias` con reglas explicables y su temporizador; tabla `alerta_seguridad`; sin bloqueo automático | Pruebas positivas y negativas |
| ☐ | Alertas visibles en la consola de auditoría | Pantalla |
| ☐ | `/auditoria/exportar/`: CSV + manifiesto SHA-256 firmado (Ed25519, clave como secreto) y cómo verificarlo fuera del sistema | Verificación independiente documentada |

### PT-11 · Inventario y postura (S9) — P3

| ☐ | Tarea | Evidencia |
|---|---|---|
| ☐ | Tabla de inventario de recursos (ZT-1) enlazada desde `zero-trust-cobertura.md` | PR |
| ☐ | Reporte semanal de parches y AIDE con su temporizador y alerta (los instala Jeison) | Unidades y comandos |

### PT-12 · Calidad del frontend (S9) — P3

| ☐ | Tarea | Evidencia |
|---|---|---|
| ☐ | Playwright contra `?mock` (sin credenciales) y un recorrido opcional contra producción; en el CI | CI en verde |
| ☐ | Contraste AA con `@axe-core/playwright` en navegador real; corregir lo que salga | Cero violaciones en las pantallas clave |
| ☐ | Ilustraciones de estados vacíos; catálogo de textos para es/en | Pantallas |

**Se puede repartir por completo:** este paquete es de frontend y puede tomarlo otra persona.

### PT-14 · Abrir a internet (S9, si hay decisión)

Seguir [`abrir-a-internet.md`](../abrir-a-internet.md), sección 3. Depende de PT-2 y de las cuatro decisiones de Jeison.

### Cierre (S10)

| ☐ | Tarea | Evidencia |
|---|---|---|
| ☐ | ZT-10: la matriz de [`zero-trust-cobertura.md`](../zero-trust-cobertura.md) con todos los principios en ✅ y la evidencia enlazada | PR |
| ☐ | Runbook, historial, módulos y estructura al día; regenerar los `.docx` | Entregables |
| ☐ | Ensayo final en 55 de 55 (o el número nuevo) y reporte de cierre a Jeison | Salida |

## 4. Comandos de referencia

```bash
# Pruebas locales
cd backend  && python -m pytest -q
cd frontend && npm run verificar

# En VM1 (cuenta que pueda operar como siget): reconstruir la imagen y correr una verificación contra la base real
bash infra/podman/vm1-app-backend/scripts/ejecutar-comando.sh /tmp/salida.out verificar_tramites
cat /tmp/ejec.log        # termina en FIN
grep -E "FALLA|pasos correctos" /tmp/salida.out; shred -u /tmp/salida.out

# Ensayo completo de la demostración (necesita las credenciales locales de Jeison)
backend/.venv/Scripts/python.exe demo/ensayo.py     # → 55 de 55 comprobaciones correctas
```

## 5. Qué hacer si algo se bloquea

| Situación | Qué hacer |
|---|---|
| Falta un permiso en una VM | Preparar el comando exacto y pedírselo a Jeison; no intentar rodear la restricción |
| Una migración falla en la copia | Corregirla y repetir en la copia; **nunca** probarla primero en la base viva |
| Se rompe el ensayo (≠ 55 de 55) | No fusionar; buscar el cambio que lo causó y corregirlo en el mismo PR |
| Una decisión abierta frena un paquete | Registrarla en el PR, avisar a Jeison el viernes y pasar al siguiente paquete |
| Se sospecha que se filtró una credencial | Avisar de inmediato; se rota el secreto y se documenta (ya ocurrió una vez: runbook 17.8) |
