# Especificación: trabajo pendiente de SIGET

**Responsable de la ejecución:** Andy Martínez · **Aprobador de todo cambio en las VMs:** Jeison Vásquez · **Fecha:** 21 de octubre de 2026
**Plan de ejecución (tareas, orden y fechas):** [`../../architecture/plan-pendientes-andy.md`](../../architecture/plan-pendientes-andy.md)

## 1. Contexto y objetivo

SIGET ya funciona de punta a punta: interfaz React, API Django, decisor de acceso (ABAC), PostgreSQL con RLS y auditoría inalterable, segundo factor obligatorio, 354 pruebas del backend, 130 del frontend y un ensayo de la demostración de 55 comprobaciones ([`historial-del-proyecto.md`](../../historial-del-proyecto.md)). **Esta especificación define lo que falta** para cerrar el proyecto con los 7 principios de Zero Trust cubiertos ([`zero-trust-cobertura.md`](../../zero-trust-cobertura.md)) y con todos los módulos del diseño ([`modulos.md`](../../modulos.md)).

**Objetivo:** completar los módulos pendientes, cerrar las brechas de seguridad conocidas y dejar la plataforma operable y verificable, sin degradar nada de lo que ya funciona.

## 2. Alcance

**Dentro:** los 14 paquetes de trabajo de la sección 5 y las tareas de limpieza de la sección 6.

**Fuera (declarado):** verificación de la identidad ciudadana contra el Registro Civil (punto de integración futuro); un SIEM; un servidor de correo (el laboratorio no tiene SMTP); postura de los dispositivos de los ciudadanos (límite de NIST SP 800-207).

## 3. Reglas que no se negocian

Heredadas del proyecto ([`CONTRIBUTING.md`](../../../CONTRIBUTING.md), [`organizacion-backend-frontend.md`](../../organizacion-backend-frontend.md)):

1. **Regla de oro:** nada se elimina ni se sobrescribe en las VMs sin aprobación explícita de Jeison, caso por caso. Todo cambio se documenta **antes** de ejecutarse y se respalda la base antes de migrarla.
2. **Zero Trust:** no existe un superusuario; ningún rol puede todo; deniega por defecto y ante fallos; cada capa se verifica sola. Todo rol o acción nueva se agrega a la matriz (una prueba falla si una `Accion` no está documentada).
3. **Cero credenciales en git.** Secretos solo como `podman secret`; nada en variables de entorno con valores, nada en el repositorio, nada en la documentación entregable. Las cuentas de demostración viven solo en `demo-local/` (ignorado).
4. **Definición de «terminado»** (backend y frontend), tal como está en [`organizacion-backend-frontend.md`](../../organizacion-backend-frontend.md): pruebas unitarias; si toca la base, un paso en `verificar_*` contra la base real (en una transacción que se revierte); la ruta nueva en la auditoría de rutas con un scope explícito; el PDP decide y registra; errores con el formato único; el contrato [`api.md`](../../api.md) actualizado; `CHANGELOG.md` y runbook actualizados; sin secretos en el diff.
5. **Un PR por frente**, desde `feature/backend-<tema>` o `feature/frontend-<tema>` hacia `develop`, con **revisión cruzada** (una persona del otro frente más una del propio). Nunca se sube directo a `develop` ni a `main`.
6. **Sin estilos ni scripts en línea** en la interfaz (CSP `default-src 'self'`).
7. **Ninguna mención de herramientas de IA** en documentos entregables.

## 4. Permisos reales y qué significan para el trabajo

| Recurso | Qué puede hacer Andy hoy | Consecuencia |
|---|---|---|
| Repositorio | Clonar, crear ramas y PR | Todo el código, las pruebas y la documentación los hace él |
| **VM1** (`app-backend`) | `sudo -u siget` (opera los contenedores del proyecto) y diagnósticos de solo lectura como root (`journalctl`, `systemctl status`, `ausearch -m avc`, `ss -tlnp`, `dnf check-update`/`info`) | Puede construir imágenes, ejecutar los `verificar_*` y revisar servicios. **No puede** instalar paquetes ni cambiar el sistema |
| **VM2** (`db-server`) | Cuenta sin `sudo` | **No puede** aplicar migraciones, hacer respaldos ni tocar la base. Cada migración y cada cambio de la base los aplica **Jeison**, con respaldo previo |
| Secretos (`podman secret`) | Crearlos como `siget` en VM1 sin mostrar el valor | En VM2 los crea Jeison |

Regla práctica: Andy diseña, programa, prueba y deja **un comando listo** para cada paso privilegiado; Jeison lo revisa y lo ejecuta. Si Jeison decide ampliar el `sudo` de Andy, se registra en [`acceso-equipo.md`](../../acceso-equipo.md) y en el CHANGELOG.

## 5. Paquetes de trabajo

Cada paquete (PT) indica el objetivo, el diseño propuesto, los criterios de aceptación y quién aplica lo privilegiado. Los diseños son propuestas que Andy confirma al iniciar cada paquete (decisión registrada en el PR).

### PT-1 · Respaldos automáticos con restauración probada — *prioridad P0*

**Por qué:** hoy no hay copias automáticas de la base viva (solo respaldos manuales verificados; runbook 32.2). Perderla obliga a resembrar las cuentas de demostración con credenciales nuevas.

**Diseño:** `systemd timer` diario (usuario `siget` en VM2) que ejecuta `pg_dump -Fc` dentro del contenedor hacia `/var/backups/siget/` con permisos 600, más los roles (`pg_dumpall --globals-only`); retención de 14 diarios y 8 semanales; copia fuera de la VM (al PC del responsable o a un almacenamiento aparte, **cifrada** con `age` o similar y con la clave fuera de la VM); registro del resultado en el journal. Un segundo timer semanal **restaura el último volcado en una base temporal** y compara conteos de filas y esquema (`verificar_esquema`).

**Aceptación:** existe el temporizador y su última ejecución es exitosa; hay un volcado nuevo cada día y se respeta la retención; la prueba de restauración pasa y se documenta con su salida; el procedimiento de recuperación completo está en el runbook; ningún respaldo contiene secretos en claro fuera de `/var/backups/siget` (600).
**Aplica:** Jeison en VM2 (Andy entrega scripts, unidades y pruebas).

### PT-2 · Endurecimiento previo a internet y registro configurable — *P0*

**Por qué:** es el requisito de [`abrir-a-internet.md`](../../abrir-a-internet.md) y también mejora el sistema hoy.

**Diseño:**
1. **IP real del cliente en nginx:** `set_real_ip_from` (solo el proxy conocido) y `real_ip_header` para que los límites de tasa y el bloqueo por intentos se calculen por la IP del visitante y no del proxy.
2. **Registro configurable:** variable `SIGET_REGISTRO` con tres valores (`cerrado`, `invitacion`, `abierto`); con invitación, un código de un solo uso con vencimiento (tabla `invitacion`, creado por el operador de identidades, entregado fuera de banda). Por defecto: `abierto` hoy, para no cambiar el comportamiento.
3. `SIGET_ALLOWED_HOSTS` ya es configurable; documentar el procedimiento para agregar un nombre.
4. Aviso visible de «demostración académica» en la interfaz, activable por configuración.

**Aceptación:** pruebas del registro en los tres modos; una prueba de nginx (en contenedor) que demuestra que dos IPs distintas tienen cupos de tasa distintos; ensayo en 55 de 55 sin cambios; el modo `abierto` se comporta como hoy.
**Aplica:** Jeison reinicia el pod; Andy hace todo lo demás en VM1.

### PT-3 · Plazos en días hábiles y escalamiento automático — *P1*

**Por qué:** es el corazón del negocio (vencimientos exigibles). Hoy el plazo es en días calendario y nada escala solo.

**Diseño:**
- Tabla `feriado` (fecha, descripción) con el calendario de feriados nacionales de Panamá, **cargado y verificado con una fuente oficial** (decisión: lista inicial por migración, mantenida por el operador de catálogo).
- Función pura `sumar_dias_habiles(inicio, dias, feriados)` en `apps/tramites/serializacion.py` (lunes a viernes sin feriados), con pruebas de bordes (fin de semana, feriados consecutivos, cambio de año). `fecha_limite` pasa a usarla; los trámites existentes conservan su plazo (migración de datos explícita y revisable).
- **Escalamiento:** columna `tramite.escalado_en` y evento `escalamiento` en `evento_auditoria`. Un temporizador (systemd timer en VM1) ejecuta `manage.py escalar_vencidos`. Para respetar el mínimo privilegio, el trabajo **no usa `app_role`**: se crea `escalador_role` (sin superusuario, sin `BYPASSRLS`) con solo `EXECUTE` sobre una función `siget.escalar_vencidos()` (`SECURITY DEFINER`, propiedad de `siget_owner`) que marca los vencidos y escribe el evento en la misma transacción; el actor del evento es el sistema (nulo) y la decisión queda registrada. El PDP ya tiene la acción `escalar_tramite` para el supervisor.
- Interfaz: indicador «escalado» en la bandeja y el detalle; filtro «Escalados» en supervisión.

**Aceptación:** pruebas de la función de días hábiles; `verificar_tramites` ampliado con un trámite vencido que el job escala una sola vez (idempotente); el supervisor ve los escalados y el funcionario no los reasigna; la interfaz muestra el estado; el temporizador figura en el runbook.
**Aplica:** Jeison aplica la migración y crea `escalador_role` y su secreto; Andy crea las unidades de systemd de VM1.

### PT-4 · Consolas de los operadores de plataforma con control dual real — *P1*

**Por qué:** son los módulos «próximamente» y materializan la separación de poderes.

**Diseño:** un conjunto de endpoints bajo `/plataforma/…` y una consola por rol, **sin ver nunca datos de trámites**:
- **Identidades:** proponer, aprobar y rechazar el alta de coordinadores (`aprobacion` con `alta_coordinador`); restablecer el segundo factor de alguien (acción `restablecer_mfa`, con control dual y registro).
- **Catálogo:** proponer y aprobar el alta de instituciones y de tipos de trámite (`alta_institucion`), con su SLA.
- **Seguridad:** bloquear cuentas y revocar sesiones (acciones `bloquear_cuenta` y `revocar_sesion`).
- **Secretos:** registro de rotaciones (metadatos: qué, cuándo, quién; **nunca el valor**) y recordatorio de vencimientos (certificado de nginx: 20-oct-2027).
- **Infraestructura:** estado de salud de los servicios (el pod, la base) de solo lectura.

La base ya impone que quien propone no aprueba y que nadie se asigna un rol; el backend reutiliza esas garantías y las prueba. Cada consola se publica en `modulos.py` (de «próximamente» a «disponible»), en `docs/modulos.md` y en el simulador/matriz (ya generados por el PDP).

**Aceptación:** por cada flujo, pruebas unitarias y pasos en un nuevo `verificar_plataforma` contra la base real: el mismo operador no aprueba su propia propuesta; el rol equivocado recibe 403; todo queda en auditoría; ninguna consola devuelve trámites. Interfaz con pruebas de pantalla y accesibilidad (axe).
**Aplica:** migraciones, si las hay, las aplica Jeison.

### PT-5 · Recuperación de contraseña asistida — *P2*

**Por qué:** hoy no existe. El laboratorio no tiene SMTP, por lo que se diseña un flujo **asistido y con control**, que se puede cambiar a correo más adelante.

**Diseño:** el operador de identidades emite un **código de restablecimiento de un solo uso** (aleatorio, solo se guarda su hash, vence en 15 minutos) que entrega a la persona por un canal externo; la persona lo usa para fijar una contraseña nueva cumpliendo la política (`errores_de_contrasena`); se revocan todas sus sesiones y el segundo factor sigue exigiéndose. Nueva acción `restablecer_contrasena` en el PDP (y en la matriz, por la prueba que lo obliga). Eventos de seguridad para cada paso; límite de tasa y mensajes genéricos (no revelar si la cuenta existe).

**Aceptación:** pruebas del ciclo completo, de vencimiento, de reuso del código (rechazado) y de enumeración de usuarios (respuesta idéntica); paso en `verificar_autenticacion`; pantalla en la interfaz.

### PT-6 · Rotación de claves JWT y Fernet — *P2*

**Diseño:** soportar un **anillo de claves** (la actual y la anterior): los JWT llevan `kid` y se verifican con la clave que corresponde; los secretos TOTP se cifran con `MultiFernet` (se descifra con cualquiera, se cifra con la primera). Procedimiento de rotación sin cortar sesiones: agregar la nueva, esperar a que venza la vida del token (10 minutos) y retirar la vieja; los secretos TOTP se re-cifran con un comando. Los secretos son `podman secret` (`siget-jwt-key`, `siget-mfa-key`).

**Aceptación:** pruebas de verificación con ambas claves y de rechazo de una clave retirada; un ensayo de rotación contra la base real que no invalida ninguna cuenta; runbook con el procedimiento y la frecuencia recomendada.
**Aplica:** Jeison crea los secretos nuevos (nunca se muestran).

### PT-7 · Reemisión de la CA interna con `keyUsage` — *P2*

**Por qué:** la CA actual no trae la extensión `keyUsage` y los clientes estrictos (como Python 3.14) la rechazan.

**Diseño:** emitir una CA nueva (`basicConstraints CA:TRUE`, `keyUsage keyCertSign, cRLSign`) y reemitir los certificados de nginx y de PostgreSQL; mantener la CA anterior confiable durante la transición. Actualizar `infra/pki/siget-ca.crt`, la huella publicada en [`como-abrir-la-plataforma.md`](../../como-abrir-la-plataforma.md) y los secretos `siget-ca`, `siget-nginx-*` y `siget-pg-tls-*`. Todos los usuarios deberán instalar la CA nueva.
**Aceptación:** `verificar_*` y `demo/ensayo.py` pasan **sin** relajar `VERIFY_X509_STRICT`; la huella nueva está documentada; se acuerda una ventana con el equipo.
**Aplica:** Jeison (la CA privada vive en VM2, `/root/siget-ca`).

### PT-8 · Documentos adjuntos — *P2*

**Diseño:** tabla `documento` (id, trámite, institución, subido_por, nombre, tipo MIME, tamaño, SHA-256, ubicación, creado_en), con RLS igual que `tramite` y **sin borrado** (se marca reemplazado). Almacenamiento en un volumen de Podman, **cifrado por archivo** (AES-GCM con una clave aparte como `podman secret`). Validación estricta: lista cerrada de tipos (PDF, PNG, JPEG), comprobación del contenido real (no solo la extensión), tamaño máximo de 5 MB, nombre saneado y ruta que nunca viene del cliente. Endpoint `POST /tramites/<id>/documentos/` (solo esta vista admite `multipart`; el resto sigue en JSON) y descarga con `Content-Disposition: attachment` y `X-Content-Type-Options: nosniff`. El PDP ya tiene `adjuntar_documento` y `ver_documento`. Opcional: análisis con ClamAV en un contenedor aparte.

**Aceptación:** pruebas de archivos hostiles (extensión doble, contenido que no corresponde, enorme, nombre con `../`), de acceso (otro ciudadano → 404) y de cifrado en disco; `verificar_documentos` contra la base real; pantalla de carga y listado con accesibilidad.
**Aplica:** Jeison aplica la migración y crea el secreto y el volumen.

### PT-9 · Notificaciones — *P3*

**Diseño:** tabla `notificacion` (persona, tipo, trámite, creada_en, leída_en); se generan cuando cambia el estado, se reasigna, se escala o falta información (subsanación). **En la aplicación** (campana en la barra superior con contador); correo queda como extensión futura cuando exista un SMTP. Solo la propia persona lee sus notificaciones (RLS).

**Aceptación:** pruebas de generación y de privacidad; `verificar_*`; la campana con accesibilidad y sin sondeos agresivos (intervalo razonable).

### PT-10 · Alertas ante patrones y exportación firmada de la auditoría (ZT-8) — *P3*

**Diseño:** un comando `detectar_anomalias` (temporizador) con reglas simples y explicables: ráfagas de `login_fallido` por IP, varias denegaciones de una misma persona en poco tiempo, `refresh_reuso`, bloqueos repetidos. Escribe alertas en una tabla propia (`alerta_seguridad`) y la consola de auditoría las muestra; **no bloquea automáticamente** (decisión humana del operador de seguridad). Exportación: `/auditoria/exportar/` entrega CSV y un manifiesto con SHA-256 firmado (Ed25519, clave como `podman secret`); instrucciones de verificación para un tercero. Opcional: cadena de hashes diaria que haga evidente cualquier alteración del registro.

**Aceptación:** pruebas de cada regla con casos positivos y negativos; la firma se verifica fuera del sistema; ninguna alerta contiene secretos.

### PT-11 · Inventario de recursos y postura de los activos (ZT-1 y ZT-7) — *P3*

**Diseño:** ZT-1: tabla en `docs/` con cada recurso (trámites, auditoría, decisiones, catálogo, secretos, VMs, contenedores), su dueño, su sensibilidad y quién accede, enlazada desde [`zero-trust-cobertura.md`](../../zero-trust-cobertura.md). ZT-7: reporte semanal de parches pendientes (`dnf updateinfo`) y AIDE (integridad de archivos) con un temporizador y una alerta si cambia un archivo vigilado.
**Aplica:** Jeison (instalar AIDE y los temporizadores en las VMs). Andy redacta el inventario y entrega las unidades.

### PT-12 · Calidad del frontend: Playwright, contraste, estados vacíos, i18n — *P3*

**Diseño:** recorrido automático con Playwright contra el servidor de desarrollo con el modo de ejemplo (`?mock`, sin credenciales) y un recorrido opcional contra producción; revisión de contraste AA con `@axe-core/playwright` en el navegador real (jsdom no calcula colores); ilustraciones propias para los estados vacíos de cada pantalla; textos extraídos a un catálogo para internacionalizar (es/en). Todo respeta la CSP.
**Aceptación:** el recorrido corre en el CI; cero violaciones de contraste AA en las pantallas clave; las pruebas existentes siguen en verde.

### PT-13 · Retiro del checkpoint PHP (ZT-9) — *semana 6*

**Qué:** apagar la aplicación PHP (`/gestion/`), quitarla de Apache, revocar `checkpoint_app` y cerrar el puerto 80, **solo cuando** la plataforma nueva cubra registro, login, restablecimiento de contraseña (PT-5), segundo factor y bloqueo. Es irreversible para el checkpoint, así que requiere aprobación explícita de Jeison y un respaldo previo; se documenta en el runbook.
**Aceptación:** Apache sin la app PHP; el rol `checkpoint_app` revocado; el ensayo en 55 de 55; la matriz de Zero Trust con el desvío del HTTP cerrado.
**Aplica:** Jeison.

### PT-14 · Abrir la plataforma a internet — *depende de decisiones*

Ver [`abrir-a-internet.md`](../../abrir-a-internet.md). Depende de PT-2 y de las cuatro decisiones pendientes de Jeison (opción, ventana, registro y cuentas de demostración). Andy prepara el código y las pruebas; Jeison habilita Funnel (o el túnel) en la consola correspondiente.

## 6. Limpieza y decisiones del proyecto (de Jeison, con apoyo de Andy)

| Tarea | Quién |
|---|---|
| Fusionar el PR 6 (`develop → main`): la protección de `main` exige una aprobación | Jeison (o un compañero que apruebe) |
| Aplicar las actualizaciones pendientes de ambas VMs y reiniciarlas, comprobando que todo arranca solo (con respaldo previo, después de la presentación) | Jeison; Andy verifica con `dnf check-update` y los `verificar_*` |
| Apagar y desinstalar el PostgreSQL nativo, cerrar la regla del puerto 5432 en el firewall y apuntar (o retirar) pgAdmin al puerto 5433 con SSL y el usuario `pgadmin_lectura` | Jeison |
| Repartir al equipo en los cuatro frentes y cargar las llaves SSH de los compañeros | Jeison |
| Decidir si el segundo factor de la ciudadanía es obligatorio (hoy lo es) | Jeison |
| Suspender las cuentas de demostración tras la presentación | Jeison (operador de seguridad) |
| Decidir si se reescribe la historia para quitar trailers de coautoría anteriores al 15 de octubre | Jeison |

## 7. Riesgos

| Riesgo | Mitigación |
|---|---|
| **Una sola persona no abarca los 14 paquetes** en el tiempo disponible | El plan los ordena por prioridad (P0–P3) y marca cuáles pueden repartirse con el resto del equipo (frontend, documentación, pruebas). Se revisa la carga cada semana |
| Una migración mal aplicada daña la base viva | Respaldo previo obligatorio, migración probada primero contra una copia restaurada, y Jeison como único que la aplica |
| Cambios de seguridad que rompen la demostración | Cada cambio pasa el ensayo (`demo/ensayo.py`, 55 de 55) antes de fusionarse y no se despliega durante una presentación |
| Rotar la CA o las claves deja a los usuarios sin acceso | Ventana acordada, claves anterior y nueva en paralelo, y procedimiento de vuelta atrás documentado |
| Un paquete amplía el poder de un rol sin querer | La matriz y el simulador se generan del PDP y una prueba exige que ningún rol pueda todo; se revisan en cada PR |
| Se filtran credenciales | Escaneo del diff en cada PR, `.gitignore` y revisión cruzada |

## 8. Decisiones abiertas

1. ¿Se amplía el `sudo` de Andy (por ejemplo, solo lectura de la base en VM2) o se mantiene con Jeison como único operador de las migraciones?
2. ¿Dónde se guardan las copias de respaldo fuera de la VM (PC de Jeison, disco externo, almacenamiento en la nube)? Condiciona PT-1.
3. ¿Qué ventana de mantenimiento se acuerda con el equipo para la rotación de la CA (PT-7)?
4. ¿La recuperación de contraseña seguirá siendo asistida (PT-5) o se contratará un SMTP de pruebas?
5. Las cuatro decisiones de [`abrir-a-internet.md`](../../abrir-a-internet.md).
