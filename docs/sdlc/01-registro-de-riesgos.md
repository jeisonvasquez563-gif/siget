# Registro de riesgos de SIGET

**Etapa 1: Planificación** · Responsable: **Simna De Gracia** · Revisa: **Jeison Vásquez**

> Evaluar los riesgos y el panorama de amenazas de SIGET y el impacto que tendría un incidente de seguridad. (Red Hat, *Seguridad en el ciclo de vida de desarrollo del software*.)

## Cómo se elaboró

- **Panorama de amenazas:** los incidentes reales en instituciones públicas de Panamá (Minsa, MEF, CSS, Contraloría, Metro) y el aumento de ataques informado por la AIG, en `docs/antecedentes.md` (sección 5).
- **Riesgos ya identificados por el equipo:** sección 7 («Riesgos») y sección 8 («Decisiones abiertas») de `docs/superpowers/specs/2026-10-21-pendientes-design.md`; desvíos de `docs/zero-trust-cobertura.md` (sección 5); riesgos de `docs/abrir-a-internet.md` (sección 2).
- **Estado real de la plataforma:** `CHANGELOG.md`, `docs/runbook.md`, el informe de análisis estático y dinámico (`docs/analisis-seguridad/README.md`) y el informe de mantenimiento (`docs/mantenimiento/README.md`, rama `docs/analisis-mantenimiento`).
- **Funcionalidad nueva ya desplegada en producción:** plazos y escalamiento (rama `feature/backend-plazos`, migración 013, runbook 35), registro configurable (rama `feature/backend-registro-configurable`, migración 014, runbook 36) y documentos cifrados (rama `feature/backend-documentos`, migración 015, runbook 37).
- **Regla de cálculo:** probabilidad e impacto en **Baja / Media / Alta**; el nivel es el mayor de los dos (si alguno es Alta, el nivel es Alto).
- Cada control se comprobó en el repositorio: el archivo, la prueba o la sección citada existe. Cuando el control está en otra rama, se indica la rama. Las correcciones del análisis de seguridad (`docs/analisis-seguridad/`, `nginx.conf` con nombres de host permitidos) están en la rama `fix/analisis-estatico-dinamico`, y el escaneo automático (`.github/workflows/security-scan.yml`, `.github/dependabot.yml`) en la rama `feature/sdlc-seguro`. Si no hay control, dice **pendiente**.

## Matriz de riesgos

| # | Riesgo (qué puede pasar) | Afecta a | Probabilidad | Impacto | Nivel | Control en SIGET (dónde se ve) |
|---|---|---|---|---|---|---|
| R1 | Alguien adivina o roba la contraseña de un funcionario | Trámites de su institución | Media | Alta | Alto | Segundo factor obligatorio para el personal; bloqueo progresivo tras 3 fallos (`verificar_autenticacion`) |
| R2 | Un funcionario del MOP intenta ver un trámite del MINSA | Confidencialidad entre instituciones | Media | Alta | Alto | Seguridad por filas en PostgreSQL y PDP (`verificar_tramites`, «quién ve qué») |
| R3 | Se pierde la base de datos (falla del disco, error humano) | Todos los trámites y la auditoría | Baja | Alta | Alto | Respaldo diario con restauración probada (runbook 33.4) |
| R4 | Un ciudadano sube un ejecutable disfrazado de PDF | Funcionarios que lo descarguen | Media | Media | Medio | Validación por contenido y descarga siempre como adjunto (PT-8) |
| R5 | No se aplican los parches de seguridad del sistema | Las dos VMs | Baja | Alta | Alto | **Mitigado (16-nov-2026)**: `dnf update` en las dos VMs con respaldo e instantáneas previas; 0 avisos críticos y 0 actualizaciones pendientes, y la bitácora semanal mantiene la regla de 7 días (`docs/sdlc/07-revision-del-entorno.md`; evidencia `evidencia/09_vm1_actualizacion.txt`, `09_vm2_actualizacion.txt`, `10_parches_despues.txt`). El nivel sigue «Alto» solo porque el impacto de un fallo de este tipo es Alto; la probabilidad bajó de Alta a Baja |
| R6 | Se pierde la clave que cifra los documentos adjuntos (`siget-docs-key`). Hoy existe solo en VM1: si VM1 se daña, los archivos quedan ilegibles para siempre | Documentos adjuntos de todos los trámites | Media | Alta | Alto | Parcial (17-nov-2026): copia de la clave fuera de VM1, en el equipo anfitrión, con permisos solo para el administrador y verificada por su huella SHA-256, sin mostrar el valor (`evidencia/13_*`; la copia no está en el repositorio). **pendiente**: llevar una segunda copia fuera del equipo anfitrión (memoria USB o gestor de contraseñas), porque las dos VMs corren en el mismo PC |
| R7 | Los respaldos de la base quedan en la misma VM2. Si se pierde VM2 o el PC que la aloja, se pierden la base y sus respaldos a la vez | Todos los trámites y la auditoría | Baja | Alta | Alto | Parcial: respaldo diario verificado (`infra/podman/vm2-db-server/respaldo/`). **pendiente**: copia fuera de VM2 (runbook 33.4; decisión abierta 2 de la spec de pendientes) |
| R8 | El checkpoint PHP antiguo sirve su inicio de sesión por HTTP (puerto 80, sin cifrar). Alguien en la misma red podría leer usuario y contraseña | Cuentas del checkpoint | Media | Media | Medio | **Mitigado (17-nov-2026)**: checkpoint PHP y pgAdmin web retirados (Apache y php-fpm detenidos y deshabilitados), servicio `http` fuera del cortafuegos y el rol `checkpoint_app` sin inicio de sesión, así que la contraseña que guardaba su configuración ya no sirve. Respaldo en `/root/respaldo-pt13-2026-11-17` (`evidencia/13_puerto80_*`, `13_checkpoint_app_nologin`) |
| R9 | Una sola persona (Jeison) tiene sudo completo en VM2 y aplica las migraciones. Si no está disponible, nadie puede restaurar, parchar ni migrar; y un error suyo afecta a todo | Operación de toda la plataforma | Media | Alta | Alto | Parcial: procedimientos escritos paso a paso (runbook 33 a 37) y sudo acotado de Andy en VM1 (runbook 20). **pendiente**: decisión abierta 1 de la spec de pendientes (sección 8) |
| R10 | Software que se queda sin soporte: Rocky 9.7 no recibía parches desde el 28-may-2026 y Python 3.12 se retira en abril de 2027 | Las dos VMs y el backend | Baja | Media | Medio | Parcial: la parte de Rocky quedó **mitigada el 16-nov-2026** (las dos VMs en Rocky Linux 9.9, la última versión menor publicada; `evidencia/09_vm1_actualizacion.txt`, `09_vm2_actualizacion.txt`) y el calendario de fin de soporte queda en `docs/sdlc/08-bitacora-parches.md`. **pendiente**: migrar Python antes de abr-2027, según el plan con fechas del informe de mantenimiento (`docs/mantenimiento/README.md`, rama `docs/analisis-mantenimiento`) |
| R11 | Las cuentas de demostración tienen contraseñas de laboratorio. Si la plataforma se abre a internet, cualquiera podría bloquearlas a propósito con 3 intentos fallidos | Demostración y cuentas de prueba | Media | Media | Medio | Parcial: el segundo factor impide robarlas; sus credenciales viven solo en `demo-local/`, excluida por `.gitignore`. **pendiente**: rotarlas o suspenderlas antes de abrir a internet (`docs/abrir-a-internet.md`, sección 2, punto 2) |
| R12 | Falla el temporizador de escalamiento (VM1 apagada, contenedor que no arranca, clave del rol rotada) y los trámites vencidos no llegan a supervisión | Plazos y derechos de la ciudadanía | Media | Media | Medio | Parcial: `Persistent=true` corre lo atrasado al encender, la función es idempotente y `escalador_role` solo puede ejecutarla (`siget-escalar.timer`, migración 013, `test_escalamiento.py`, rama `feature/backend-plazos`). **pendiente**: aviso automático cuando una corrida falla (PT-10) |
| R13 | Una contraseña o clave queda guardada en el repositorio de git | Base de datos, tokens y segundo factor | Media | Alta | Alto | Gitleaks revisa todo el historial en cada cambio y cada semana (`.github/workflows/security-scan.yml`); `.gitignore` excluye `.env`, respaldos y `demo-local/`; los secretos viven como `podman secret`; el ensayo genera su propia contraseña de prueba (commit `73c39e7`) |
| R14 | Un ataque automatizado prueba miles de contraseñas o satura el servidor con peticiones | Disponibilidad y cuentas | Alta | Media | Alto | Límite de tasa en nginx que responde 429 (`limit_req` en `infra/podman/vm1-app-backend/nginx.conf`) y bloqueo progresivo de 5, 15 y 60 minutos con tope de una hora (`backend/apps/autenticacion/bloqueo.py`, pruebas en `test_autenticacion.py`) |
| R15 | Inyección SQL u otra inyección a través de la API | Toda la base de datos | Media | Alta | Alto | Consultas a través del ORM de Django; Bandit y Semgrep en cada cambio (`security-scan.yml`); la alerta de ZAP sobre inyección SQL se verificó a mano como falso positivo (`docs/analisis-seguridad/herramientas/verificar_sqli.py`); la seguridad por filas es una segunda barrera |
| R16 | Un funcionario se equivoca o cambia un trámite a propósito (estado indebido, trámite propio) | Integridad de los trámites | Media | Media | Medio | La base rechaza transiciones de estado inválidas (trigger `tramite_valida_transicion`) y la auditoría no se puede modificar ni borrar (trigger `auditoria_inmutable`), ambos en `database/diseno-roles-permisos.sql`; el PDP exige segundo factor reciente y niega el conflicto de interés (`backend/apps/autorizacion/pdp.py`) |
| R17 | Se cae VM2 (la base) o el PC que aloja las dos VMs: toda la plataforma deja de funcionar | Disponibilidad de todo el servicio | Media | Alta | Alto | Parcial: los servicios arrancan solos y las correcciones siguen vigentes al reiniciar (`docs/analisis-seguridad/despues/19_tras_reinicio.txt`); respaldo diario (R3). **pendiente**: no hay segunda base ni otro anfitrión (`docs/abrir-a-internet.md`, sección 2, punto 5) |
| R18 | Alguien envía un nombre de host falso para redirigir a las personas a otro sitio (redirección abierta) | Personas usuarias (phishing) | Baja | Media | Medio | nginx solo acepta los nombres de la plataforma y responde 421 a los demás (`map $host $host_permitido` en `nginx.conf`, commit `a91c0ea`; evidencia `docs/analisis-seguridad/despues/14_host_header_8443.txt`) |
| R19 | Al abrir SIGET a internet detrás de un proxy, todas las personas llegan con la misma IP: un solo atacante provoca errores 429 o bloqueos a todos | Disponibilidad | Media | Media | Medio | **pendiente**: leer la IP real del cliente; el bloque está escrito pero comentado en `nginx.conf` hasta conocer el proxy (rama `feature/backend-registro-configurable`; `docs/abrir-a-internet.md`, sección 2, punto 1) |
| R20 | Con el registro abierto, cualquiera crea cuentas falsas que quedan para siempre en la auditoría inalterable | Calidad de los datos y de la auditoría | Media | Baja | Medio | `SIGET_REGISTRO` permite pasar a `invitacion` o `cerrado` sin tocar código; las invitaciones son de un solo uso y se guardan como hash (migración 014, `test_registro_configurable.py`, runbook 36, rama `feature/backend-registro-configurable`) |
| R21 | Lo que corre en producción no coincide con el repositorio (por ejemplo, la inactividad de 2 minutos de la demo solo está en VM1). Un despliegue desde el repositorio deshace ajustes sin que nadie lo note | Configuración de seguridad | Media | Media | Medio | Parcial: regla de comparar la unidad con la de producción antes de copiarla (runbook 37.2, punto 3). **pendiente**: revertir el ajuste de la demo o llevarlo al repositorio (CHANGELOG, «Cambiado (solo en VM1, temporal)») |
| R22 | No hay alertas automáticas: un ataque en curso solo se ve si alguien abre la consola de auditoría | Detección y respuesta a incidentes | Alta | Media | Alto | Parcial: todo queda registrado (decisiones del PDP, eventos de seguridad) y se consulta en la consola de auditoría (runbook 28). **pendiente**: alertas ante patrones y exportación firmada (ZT-8 / PT-10) |
| R23 | Una dependencia o imagen de contenedor trae una vulnerabilidad conocida (cadena de suministro) | Backend, frontend y contenedores | Media | Alta | Alto | Parcial: pip-audit y npm audit en cada cambio (`security-scan.yml`) y Dependabot para pip, npm, GitHub Actions y Docker (`.github/dependabot.yml`). **pendiente**: la imagen de nginx no se reconstruye y PostgreSQL usa una imagen de docker.io fuera del ciclo de Red Hat (informe de mantenimiento) |
| R24 | VM1 tenía habilitados seis repositorios externos de PostgreSQL (`pgdg-common` y `pgdg14` a `pgdg18`) con firma GPG inválida. Si algún día dnf los aceptara o alguien forzara la instalación, entrarían paquetes sin verificar; mientras tanto obligan a desactivarlos con `--disablerepo` para medir los parches | VM1 | Baja | Baja | Bajo | **Mitigado el 17-nov-2026:** los seis quedaron deshabilitados (`dnf config-manager --set-disabled "pgdg*"`), con respaldo del archivo original; `dnf` actualiza sin errores de firma (`docs/sdlc/evidencia/11_vm1_repos_pgdg.png`). Desde ahí solo se habían instalado `libpq5` y `pgdg-redhat-repo` |

## Riesgos pendientes para Jeison

Ordenados del nivel más alto al más bajo. Dentro del mismo nivel, primero lo que no tiene ningún control. Desde el 16-nov-2026 R5 (parches) ya no figura aquí porque está mitigado, y R10 bajó a Medio porque solo falta migrar Python. R24 apareció al actualizar y se mitigó el 17-nov. Quedan **12** con algo pendiente (6 de nivel Alto y 6 de nivel Medio).

| Nivel | # | Qué falta | Dónde está planificado |
|---|---|---|---|
| Alto | R6 | Llevar la copia de `siget-docs-key` (ya fuera de VM1 desde el 17-nov) también fuera del equipo anfitrión | Runbook 37.2, punto 2 |
| Alto | R7 | Copia de los respaldos fuera de VM2 | Runbook 33.4; decisión abierta 2 |
| Alto | R9 | Decidir si otra persona puede operar VM2 (al menos restaurar) | Decisión abierta 1 de la spec de pendientes |
| Alto | R17 | Alternativa si se cae VM2 o el PC anfitrión | Sin plan todavía |
| Alto | R22 | Alertas automáticas y exportación firmada de la auditoría | ZT-8 / PT-10 |
| Alto | R23 | Reconstruir la imagen de nginx y revisar el origen de la de PostgreSQL | Informe de mantenimiento |
| Medio | R19 | Leer la IP real del cliente antes de abrir a internet | `docs/abrir-a-internet.md`, paso 3 |
| Medio | R11 | Rotar o suspender las cuentas de demostración antes de abrir a internet | `docs/abrir-a-internet.md` |
| Medio | R10 | Migrar Python 3.12 antes de abril de 2027 (la parte de Rocky ya quedó resuelta) | Informe de mantenimiento (plan con fechas) |
| Medio | R12 | Aviso automático si el escalamiento falla | PT-10 |
| Medio | R21 | Alinear la unidad del backend de VM1 con el repositorio | Runbook 37.2, punto 3 |

## Preguntas que puede hacer el profesor

**1. ¿Qué es la etapa de planificación en el SDLC seguro de Red Hat?**
Es la primera etapa. Antes de construir o cambiar algo, evaluamos qué puede salir mal, quién nos podría atacar y cuánto daño haría un incidente. En SIGET el resultado es este registro: una lista de riesgos con su nivel y lo que hacemos con cada uno.

**2. ¿Qué es un riesgo?**
Es algo malo que puede pasar, combinado con cuánto daño causaría. No es un ataque que ya ocurrió: es una posibilidad. Por ejemplo, «perder la clave que cifra los documentos» es un riesgo aunque nunca haya pasado.

**3. ¿Cuál es la diferencia entre amenaza, vulnerabilidad y riesgo?**
La amenaza es quien o qué puede causar daño (un atacante, una falla del disco, un error humano). La vulnerabilidad es la debilidad que aprovecha (por ejemplo, el checkpoint PHP que envía la contraseña sin cifrar). El riesgo es la combinación: la probabilidad de que la amenaza use la debilidad y el daño que causaría.

**4. ¿Cómo calculan el nivel de cada riesgo?**
Ponemos la probabilidad y el impacto en Baja, Media o Alta. El nivel es el mayor de los dos: si alguno es Alta, el riesgo es Alto. Elegimos esta regla simple a propósito, para no subestimar un riesgo que pasa poco pero hace mucho daño, como perder la base de datos.

**5. ¿Cuál es el riesgo más grave y por qué?**
La clave de documentos (R6): si se pierde, el daño no se puede revertir, porque los archivos cifrados quedan ilegibles para siempre, y hoy existe solo en VM1. El riesgo que era el más grave, las VMs sin parches (R5, con 2 críticos por VM), lo mitigamos el 16-nov-2026: actualizamos las dos máquinas a Rocky 9.9 y quedaron en 0 críticos y 0 pendientes.

**6. Denos un ejemplo concreto de un riesgo que ya está controlado.**
La filtración de secretos en git (R13). Gitleaks revisa todo el historial del repositorio en cada cambio y cada semana. Además, las claves viven como secretos de Podman, fuera del código. Aprendimos de casos reales del proyecto: una clave compartida por chat se revocó y una contraseña impresa por error se anuló.

**7. ¿Qué hacen con los riesgos marcados como «pendiente»?**
No los escondemos. Los listamos en «Riesgos pendientes para Jeison», ordenados por nivel y con el plan donde están previstos. Así quien decide sabe qué atender primero. Un pendiente declarado es mejor que un control que aparenta existir y no existe.

**8. ¿Por qué incluyen riesgos de personas y de procesos, no solo técnicos?**
Porque muchos incidentes empiezan por ahí. En SIGET una sola persona tiene sudo completo en la VM de la base (R9): si no está disponible, nadie puede restaurar. También un funcionario puede equivocarse (R16); por eso la base rechaza cambios de estado inválidos y la auditoría no se puede borrar.

**9. ¿Por qué les importan los incidentes de otras instituciones de Panamá?**
Porque muestran el panorama de amenazas real. En 2025 y 2026 hubo exposición de contraseñas y cédulas en el Minsa, un caso de ransomware en el MEF e incidentes en la CSS y el Metro, y la AIG reportó aumentos de ataques de hasta 500 %. SIGET maneja trámites del Estado, así que es un blanco del mismo tipo.

**10. ¿Este registro se hace una sola vez?**
No. Se actualiza cada vez que cambia la plataforma. Por ejemplo, al agregar documentos adjuntos apareció el riesgo de perder su clave (R6), y al planear abrir SIGET a internet aparecieron los de la IP compartida (R19) y las cuentas de demostración (R11). También al revés: al actualizar las VMs el 16-nov-2026 se cerró R5 y apareció R24 (repositorios con firma inválida).
