# Inventario de controles de seguridad

**Etapa 5: Documentación** · Responsable: **Jorge Medina** · Revisa: **Gabriel González**

> Documentar los procesos y controles de seguridad y reunir la información para auditorías y revisiones. (Red Hat, *Seguridad en el ciclo de vida de desarrollo del software*.)

## Cómo se elaboró

1. Partimos de lo que está **desplegado en producción** (las VMs del laboratorio) y de lo que está escrito en el repositorio: el runbook (`docs/runbook.md`, en especial las secciones 14 a 37), el contrato de la API (`docs/api.md`), el `CHANGELOG.md`, la matriz de Zero Trust (`docs/zero-trust-cobertura.md`), las migraciones (`database/migraciones/README.md`), la infraestructura (`infra/podman/`), el informe del análisis estático y dinámico (`docs/analisis-seguridad/README.md`) y la configuración del CI (`.github/`).
2. Cada control tiene **dónde está documentado** (archivo y sección) y **cómo se verifica**: el comando `verificar_*` que lo prueba contra la base real (entre comillas, el nombre exacto del paso que imprime), la prueba automática, el paso del ensayo de la demostración (`demo/ensayo.py`) o la evidencia guardada en `docs/analisis-seguridad/despues/`. Comprobamos con búsquedas en el código que cada paso citado existe.
3. Los comandos `verificar_*` se ejecutan en VM1 con `ejecutar-comando.sh <comando>` (runbook 33.1 y 34.2): corren dentro de una transacción que se revierte, así que no dejan datos.
4. Los controles de plazos (runbook 35), invitaciones (runbook 36) y documentos adjuntos (runbook 37) están en producción desde el 12-nov-2026; su documentación y sus pruebas viven todavía en las ramas `feature/backend-plazos`, `feature/backend-registro-configurable` y `feature/backend-documentos`, pendientes de fusionar. El CI de seguridad, Dependabot y CODEOWNERS están en la rama `feature/sdlc-seguro`.
5. El **responsable** de cada control es quien responde por la etapa del SDLC a la que pertenece: Jeison Vásquez (infraestructura, despliegue, VMs y base de datos), Andy Martínez (desarrollo y CI), Bradley Morales (pruebas), Anyurie Sánchez (supervisión), Walter Sanjur (parches) y Joel Medina (diseño).
6. Cuando un control no tiene documento o verificación, lo decimos con **falta documentar** o **falta verificar**, y lo resumimos en «Lo que falta».

## Controles

### Identidad y acceso

| Control | Qué protege | Dónde está documentado | Cómo se verifica | Responsable |
|---|---|---|---|---|
| Contraseñas con Argon2 y política de contraseñas | Que una contraseña robada de la base no se pueda usar, y que no se acepten contraseñas débiles o comunes | `docs/runbook.md` §25; `docs/api.md` (Autenticación) | `verificar_autenticacion`: «la contraseña quedó con hash Argon2 (nunca en claro)», «rechaza una contraseña común aunque sea larga»; `backend/tests/test_autenticacion.py` | Andy Martínez |
| Segundo factor TOTP obligatorio, con secreto cifrado y anti-repetición | Que la contraseña sola no alcance para entrar | `docs/runbook.md` §25 y §32.2 (punto 3); `docs/zero-trust-cobertura.md` (principio 6) | `verificar_autenticacion`: «el secreto TOTP está CIFRADO en la base», «con el segundo factor activo, la contraseña sola ya no basta», «el mismo código no sirve dos veces (anti-repetición)»; ensayo, sección 7 (MFA) | Andy Martínez |
| Acceso en dos pasos sin enumeración de usuarios | Que nadie descubra qué cuentas existen o cuáles tienen segundo factor | `docs/runbook.md` §33.2 | `verificar_autenticacion`: «usuario inexistente y contraseña mala dan la MISMA respuesta (no se enumera)», «no permite repetir la cédula, y responde igual que un usuario repetido» | Andy Martínez |
| Bloqueo progresivo por intentos fallidos (5, 15 y 60 minutos) | Las cuentas frente a la adivinación de contraseñas y códigos | `docs/runbook.md` §33.3; `CHANGELOG.md` (bloqueo progresivo, 22-oct) | `verificar_autenticacion`: «el primer bloqueo dura 5 minutos», «el segundo bloqueo seguido dura 15 minutos», «el tercer bloqueo seguido dura 60 minutos», «el bloqueo no se distingue de una contraseña mala» | Andy Martínez |
| Sesiones cortas: acceso de 10 minutos y refresco rotatorio con detección de reuso | Que un token robado sirva poco tiempo y que su reuso cierre todas las sesiones | `docs/runbook.md` §25; `docs/api.md` (Autenticación); `docs/zero-trust-cobertura.md` (principio 3) | `verificar_autenticacion`: «el token de acceso vence a los 10 minutos», «el token de refresco rota en cada uso», «reusar un refresco ya gastado se rechaza», «y revoca TODAS las sesiones de la persona» | Andy Martínez |
| Cookie de refresco protegida y cabecera anti-CSRF | Que el refresco no lo lea un script ni lo use otro sitio | `docs/api.md` (Autenticación) | `verificar_autenticacion`: «el refresco viaja en una cookie HttpOnly, Secure y SameSite=Strict, y no en el cuerpo», «la cookie solo se envía a /auth/», «el refresco exige la cabecera de verificación (anti-CSRF)» | Andy Martínez |
| Cierre por inactividad y duración máxima de la sesión | Una sesión abierta en un equipo descuidado | `docs/runbook.md` §33.1; `backend/apps/autenticacion/politica_sesion.py` | `verificar_autenticacion`: «tras más de 15 minutos sin actividad, el refresco se rechaza», «la renovación hereda el vencimiento: la sesión no se puede prolongar renovándola»; `backend/tests/test_politica_sesion.py` | Andy Martínez |
| Recuperación de contraseña con código de un solo uso | Que nadie se apropie de una cuenta por la recuperación | `docs/runbook.md` §34; `docs/api.md` (Recuperación de contraseña) | `verificar_plataforma`: «un código vencido (16 minutos) se rechaza igual que uno inválido», «emitir un código nuevo invalida el anterior (solo uno vigente)», «ningún evento contiene el código ni la contraseña» | Andy Martínez |
| Registro configurable con invitaciones | Que, si se decide, solo se creen cuentas con una invitación válida | `docs/runbook.md` §36 (rama `feature/backend-registro-configurable`) | `verificar_plataforma`: «en la base solo queda el hash de la invitación, y vence en los días configurados», «con registro por invitación, sin código o con uno falso no se crea la cuenta (misma respuesta)» | Andy Martínez |
| Puertas de entrada separadas (ciudadanía, personal por institución y plataforma) | Que el personal y los operadores no entren por la puerta pública ni por otra institución | `docs/api.md` (Puertas de entrada); `CHANGELOG.md` (acceso por puertas, 22-oct) | `verificar_autenticacion`: «el personal entra por SU institución», «el personal no usa la puerta pública», «equivocarse de puerta no cuenta como intento fallido ni bloquea la cuenta» | Joel Medina |

### Autorización

| Control | Qué protege | Dónde está documentado | Cómo se verifica | Responsable |
|---|---|---|---|---|
| Motor de decisiones (PDP, ABAC) que niega por defecto y ante fallos | Que solo se haga lo que la política permite, sin ningún rol que pueda todo | `docs/superpowers/specs/2026-10-20-motor-abac-design.md`; `docs/zero-trust-cobertura.md` (principio 4) | `backend/tests/test_pdp.py` y `backend/tests/test_matriz.py`; `verificar_politicas`: «la matriz confirma que no existe un superusuario» | Joel Medina |
| Reautenticación escalonada (segundo factor reciente) | Las acciones sensibles: cambiar trámites, leer la auditoría | `docs/runbook.md` §25 y §32.2 | `verificar_autenticacion`: «la reautenticación renueva la vigencia del segundo factor»; `verificar_auditoria`: «un auditor con el segundo factor vencido recibe 403 y se le sugiere reautenticar» | Andy Martínez |
| Seguridad por filas (RLS) entre instituciones | Que una institución no vea los trámites ni la auditoría de otra | `docs/runbook.md` §27; `docs/roles-permisos-bd.md`; `docs/zero-trust-cobertura.md` §2 | `verificar_tramites`: «el funcionario del MINSA ve 1 más (el del MINSA), no los del MOP», «el personal de otra institución recibe 404»; `verificar_integracion`: «otra institución no ve la auditoría del MOP (RLS)» | Jeison Vásquez |
| Control dual para altas sensibles | Que una sola persona no pueda crear coordinadores ni instituciones | `docs/runbook.md` §19 y §34 | `verificar_plataforma`: «QUIEN PROPONE NO APRUEBA: el motor de decisiones lo niega (403)», «aunque se saltara el backend, la base rechaza que el mismo operador apruebe lo que propuso» | Joel Medina |
| Separación de funciones en la plataforma (cinco roles) | Que nadie acumule poderes que juntos permiten tomar una cuenta | `docs/runbook.md` §19; `docs/zero-trust-cobertura.md` §2 | `verificar_plataforma`: «quien emitió el código no puede además restablecer el segundo factor de la misma cuenta (409)», «una cuenta de plataforma no puede ser coordinadora (400)» | Joel Medina |
| Segunda barrera en la base para iniciar trámites (migración 012) | Que el personal no inicie trámites en su propia institución aunque alguien salte el PDP | `CHANGELOG.md` (quién puede iniciar qué trámite, 22-oct); `database/migraciones/012-tramites-entre-instituciones.sql` | `verificar_tramites`: «el personal del MOP no inicia un trámite en el MOP», «el personal no inicia en otra institución un trámite pensado para la ciudadanía» | Jeison Vásquez |
| Mínimo privilegio de los roles de la base de datos | Que la aplicación, el auditor y pgAdmin solo puedan lo justo | `docs/runbook.md` §17, §28 y §33.2 (migración 009); `docs/roles-permisos-bd.md` | `verificar_politicas`: «ningún rol de la aplicación es superusuario ni omite la seguridad por filas», «app_role no borra nada en ninguna tabla», «auditor_role solo lee: sin insertar, alterar ni borrar nada» | Jeison Vásquez |
| Sudo de mínimo privilegio en las VMs | Que una cuenta del equipo no pueda ejecutar cualquier cosa como root | `docs/runbook.md` §20 | `sudo -l -U andy_martinez` lista solo los comandos acotados (runbook 20) | Jeison Vásquez |

### Datos

| Control | Qué protege | Dónde está documentado | Cómo se verifica | Responsable |
|---|---|---|---|---|
| Cédula cifrada (Fernet) con huella HMAC y claves derivadas por HKDF | Los datos personales de la ciudadanía si se filtra la base | `docs/runbook.md` §33.2; `database/migraciones/README.md` (008) | `verificar_autenticacion`: «la cédula NO está en claro: solo cifrada y como huella», «la cédula cifrada se puede recuperar con la clave del servidor» | Andy Martínez |
| Documentos adjuntos cifrados con AES-256-GCM y tipo de archivo validado | Los archivos de los trámites en disco y la subida de ejecutables disfrazados | `docs/runbook.md` §37 (rama `feature/backend-documentos`) | `verificar_tramites` (sección de documentos): «en disco el archivo está cifrado (no aparece el contenido) y la ruta la generó el servidor», «un ejecutable con extensión .pdf se rechaza (415)» | Andy Martínez |
| Secretos fuera del código (`podman secret`) y registro de rotaciones | Las claves de JWT, segundo factor, documentos y base de datos | `docs/runbook.md` §34, §35.3 (punto 4) y §37; `database/migraciones/README.md` (Reglas) | `verificar_plataforma`: «ninguna respuesta contiene valores de secretos», «el registro de rotaciones es de solo inserción en la base»; Gitleaks en el CI (`docs/analisis-seguridad/despues/09_gitleaks_historial.txt`) | Jeison Vásquez |
| Bitácoras sin datos personales, secretos ni tokens en claro | Que los registros no se conviertan en una fuga | `docs/zero-trust-cobertura.md` (principio 7); **falta documentar** la regla en un solo lugar | `verificar_autenticacion`: «la bitácora de seguridad no lleva cédula, correo ni nombre», «ningún evento contiene contraseñas, códigos ni tokens», «el token de refresco no está en claro en la base (solo su hash)» | Andy Martínez |

### Red y transporte

| Control | Qué protege | Dónde está documentado | Cómo se verifica | Responsable |
|---|---|---|---|---|
| TLS 1.3 en el borde (nginx) con HSTS y cabeceras de seguridad | El tráfico entre el navegador y la plataforma | `docs/runbook.md` §24; `docs/zero-trust-cobertura.md` (ZT-3) | Ensayo, sección 0: «se negocia TLS 1.3» y «cabecera de seguridad …» para `strict-transport-security`, `content-security-policy`, `x-content-type-options` y `x-frame-options`; `docs/analisis-seguridad/despues/10_nmap_puertos_tls.txt` | Jeison Vásquez |
| TLS 1.3 entre la aplicación y la base, con verificación del certificado | Las consultas y credenciales dentro de la red interna | `docs/runbook.md` §18; `docs/zero-trust-cobertura.md` (ZT-2) | `verificar_integracion`: «conecta como app_role, sin superusuario, por TLS»; `verificar_plataforma`: «la conexión a la base va cifrada con TLS 1.3» | Jeison Vásquez |
| nginx solo acepta los nombres de host de la plataforma (421) | Redirecciones abiertas y abuso de la cabecera `Host` | `docs/analisis-seguridad/README.md`; `CHANGELOG.md` (Seguridad, 8 al 12-nov) | `docs/analisis-seguridad/despues/13_host_header_8080.txt` y `14_host_header_8443.txt` (un `Host` falso recibe `421 Misdirected Request`) | Jeison Vásquez |
| Límite de tasa en el borde y en el login | Ráfagas de inicios de sesión y abuso de la API | `docs/runbook.md` §24 y §33.1 (caché compartida entre procesos) | `verificar_autenticacion`: «el límite de tasa corta una ráfaga de logins (429)» | Jeison Vásquez |
| SSH solo por clave, firewall restrictivo y SELinux en Enforcing | El acceso administrativo a las VMs | `docs/endurecimiento-vms.md`; `docs/runbook.md` §14 y §33.5 | `sshd -t` y reconexión probada (runbook 33.5); `getenforce` devuelve `Enforcing` (runbook 14) | Jeison Vásquez |
| Endurecimiento del checkpoint PHP heredado (Apache y cookie de sesión) | La aplicación antigua mientras no se retire | `docs/analisis-seguridad/README.md` (Aplicado en producción) | `docs/analisis-seguridad/despues/15_apache_trace.txt` (TRACE deshabilitado) y `16_php_cookie_sesion.txt` (cookie `HttpOnly` y `SameSite=Strict`) | Jeison Vásquez |

### Auditoría y supervisión

| Control | Qué protege | Dónde está documentado | Cómo se verifica | Responsable |
|---|---|---|---|---|
| Auditoría inalterable | Que nadie borre ni cambie lo que pasó con un trámite | `docs/api.md` (Historial); migración en `database/` | `verificar_integracion` (UPDATE y DELETE fallan) | Jeison Vásquez |
| Registro de todas las decisiones del PDP, también las negadas, por una conexión aparte | Que un intento negado no desaparezca aunque la petición se revierta | `docs/runbook.md` §28; `docs/zero-trust-cobertura.md` (principio 7) | `verificar_tramites`: «cada decisión del PDP, permitida o negada, quedó registrada», «las decisiones usan una conexión distinta, en autocommit y fuera de toda transacción» | Anyurie Sánchez |
| Consola de auditoría con un rol de base de datos propio de solo lectura | Que el auditor no pueda alterar lo que revisa, y que su consulta también quede registrada | `docs/runbook.md` §28; `docs/api.md` (Auditoría) | `verificar_auditoria`: «la consola se conecta como auditor_role, sin superusuario ni BYPASSRLS», «quién audita al auditor: su consulta quedó registrada como una decisión permitida» | Anyurie Sánchez |
| Registro de eventos de seguridad de solo inserción | Los inicios de sesión, bloqueos, reusos de tokens y cierres de sesión | `docs/runbook.md` §25; `docs/zero-trust-cobertura.md` (principio 7) | `verificar_autenticacion`: «la base no deja modificar el registro de seguridad»; `verificar_politicas`: «ningún rol que se conecta puede alterar ni borrar … (registro inalterable)» | Anyurie Sánchez |
| Hora de los servidores sincronizada | Que la auditoría, los vencimientos y el segundo factor tengan una hora confiable | `docs/runbook.md` §22 | Ensayo, sección 0: «la hora de VM1 coincide con la del PC (el segundo factor depende de ella)» | Jeison Vásquez |

### Disponibilidad

| Control | Qué protege | Dónde está documentado | Cómo se verifica | Responsable |
|---|---|---|---|---|
| Respaldo diario de la base con prueba de restauración | La pérdida de datos por fallo o error | `docs/runbook.md` §33.4; `infra/podman/vm2-db-server/respaldo/README.md` | `siget-respaldo.sh` restaura cada volcado en una base desechable y lo compara con la viva; `systemctl list-timers siget-respaldo.timer` y `systemctl is-failed siget-respaldo.service` | Jeison Vásquez |
| Migraciones con respaldo previo y ensayo con `ROLLBACK` | Que un cambio de esquema no rompa la base en producción | `database/migraciones/README.md`; `docs/runbook.md` §35.3, §36.2 y §37.2 | Ensayo de cada migración en una transacción terminada en `ROLLBACK` (por ejemplo, `database/pruebas-escalamiento.sql`: todas deben decir `PASA`) | Jeison Vásquez |
| Escalamiento automático de trámites vencidos con un rol mínimo (`escalador_role`) | Que ningún trámite quede olvidado, sin dar al temporizador acceso a los datos | `docs/runbook.md` §35 (rama `feature/backend-plazos`) | `database/pruebas-escalamiento.sql`; `backend/tests/test_escalamiento.py`; `journalctl --user -u siget-escalar -n 5` | Jeison Vásquez |
| Servicios en contenedores rootless con arranque automático | Que la plataforma vuelva sola tras un reinicio, sin privilegios de root | `docs/runbook.md` §21 y §24; `infra/podman/README.md` | `docs/analisis-seguridad/despues/19_tras_reinicio.txt` (todo siguió vigente tras reiniciar las VMs) | Jeison Vásquez |

### Desarrollo seguro

| Control | Qué protege | Dónde está documentado | Cómo se verifica | Responsable |
|---|---|---|---|---|
| CI de seguridad: Bandit, Semgrep, pip-audit, npm audit y Gitleaks | Que no entre código vulnerable, dependencias con fallos ni secretos | `.github/workflows/README.md`; `.github/workflows/security-scan.yml` (rama `feature/sdlc-seguro`) | El flujo `security-scan` falla ante cualquier hallazgo (en cada PR, cada push a `develop`/`main` y cada lunes); salidas en `docs/analisis-seguridad/despues/` | Andy Martínez |
| Pruebas automáticas en el CI (backend y frontend) | Que una corrección no rompa un control que ya funcionaba | `.github/workflows/README.md`; `docs/runbook.md` §30 | `backend-ci.yml` (`python -m pytest -q`) y `frontend-ci.yml` (`npm run lint` y `npm test`) | Bradley Morales |
| Análisis estático y dinámico con evidencia antes y después | Encontrar vulnerabilidades que las pruebas no buscan | `docs/analisis-seguridad/README.md`; `docs/Informe_Analisis_Estatico_Dinamico_SIGET.docx` | Mismas herramientas y parámetros en `antes/` y `despues/`; ZAP en `despues/11_zap_escaneo.txt`; ensayo 101 de 101 en `despues/16_ensayo_demo.txt` | Bradley Morales |
| Revisión obligatoria por CODEOWNERS en lo que toca seguridad | Que un cambio en infraestructura, base o CI no entre sin la revisión de su responsable | `.github/workflows/README.md`; `.github/CODEOWNERS` (rama `feature/sdlc-seguro`); `CONTRIBUTING.md` (revisión cruzada) | **Falta verificar** que la protección de la rama exija la aprobación de CODEOWNERS; faltan las cuentas de los frentes de backend y frontend | Bradley Morales |
| Actualización de dependencias con Dependabot | Que las librerías vulnerables se actualicen a tiempo | `.github/workflows/README.md`; `.github/dependabot.yml` (rama `feature/sdlc-seguro`) | PRs semanales de pip, npm e imagen base, y mensuales de las acciones de GitHub; cada PR pasa por el CI de seguridad | Walter Sanjur |
| Parches del sistema operativo de las VMs (Rocky Linux 9) | Las vulnerabilidades del sistema base | **Falta documentar** el procedimiento (hoy es manual con `dnf`; `docs/zero-trust-cobertura.md` lo deja pendiente como ZT-7) | **Falta verificar**: no hay reporte periódico de parches pendientes; cada aplicación debe quedar en `08-bitacora-parches.md` | Walter Sanjur |

**Total: 43 controles** (10 de identidad y acceso, 8 de autorización, 4 de datos, 6 de red y transporte, 5 de auditoría y supervisión, 4 de disponibilidad y 6 de desarrollo seguro), incluido el de ejemplo.

## Lo que falta

| Control | Qué falta | Responsable |
|---|---|---|
| Parches del sistema operativo | Documentar el procedimiento y tener un reporte periódico de parches pendientes (ZT-7) | Walter Sanjur |
| Revisión por CODEOWNERS | Confirmar que la protección de la rama la exige y agregar las cuentas de backend y frontend | Bradley Morales |
| Bitácoras sin datos sensibles | Reunir la regla en un solo documento (hoy está en las pruebas y en la matriz de Zero Trust) | Andy Martínez |
| Respaldos | Copia fuera de VM2 (runbook 33.4) y respaldo de la clave de documentos fuera de VM1, separada de los archivos (runbook 37.2) | Jeison Vásquez |
| Controles todavía no implementados | Integridad de archivos con AIDE (ZT-7), alertas automáticas ante patrones anómalos (ZT-8) y retiro del checkpoint PHP, que sigue en HTTP (ZT-9) | Anyurie Sánchez (alertas) y Jeison Vásquez (AIDE y checkpoint) |

## Preguntas que puede hacer el profesor

**1. ¿Qué es la etapa de documentación según Red Hat?**
Es la etapa en la que dejamos por escrito los procesos y los controles de seguridad del sistema y reunimos la información que necesita una auditoría o una revisión. No es escribir manuales por escribir: es que cualquier persona pueda saber qué protege el sistema, dónde está explicado y cómo se comprueba, sin depender de la memoria de quien lo construyó.

**2. ¿Para qué sirve un inventario de controles en una auditoría?**
Un auditor no puede revisar todo el código; necesita la lista de lo que afirmamos que funciona. El inventario le dice, para cada control, qué riesgo cubre, dónde está documentado, con qué prueba lo puede comprobar y quién responde por él. Así la auditoría pasa de «confíen en nosotros» a «ejecuten este comando y vean el resultado».

**3. ¿Cómo demuestran que un control funciona y no solo que existe?**
Cada control tiene una verificación ejecutable: los comandos `verificar_*` recorren la API y la base real dentro de una transacción que se revierte, el ensayo de la demostración prueba por HTTPS lo que se ve desde fuera y las pruebas del CI corren en cada cambio. Por ejemplo, para la auditoría inalterable no decimos que «no se puede borrar»: intentamos el UPDATE y el DELETE y comprobamos que la base los rechaza.

**4. ¿Qué es `SECURITY.md` y por qué una vulnerabilidad no se reporta en un issue público?**
Es la política de seguridad del repositorio: qué versiones tienen soporte, cómo reportar una vulnerabilidad y en qué plazos respondemos. Un issue público expone la falla a cualquiera antes de que esté corregida, y le regala a un atacante el tiempo que necesitamos para arreglarla. Por eso el canal es el aviso privado de seguridad de GitHub, y la falla se da a conocer cuando la corrección ya está desplegada.

**5. ¿Qué es el runbook y para qué lo usan?**
Es el libro de operaciones de la plataforma: cada cambio en las VMs con los comandos exactos, el respaldo previo, cómo volver atrás y los problemas que encontramos. Si otra persona tiene que aplicar una migración o restaurar un respaldo, lo puede hacer siguiéndolo. También es evidencia: muestra cuándo y cómo se aplicó cada control en producción.

**6. ¿Y el CHANGELOG?**
Registra qué cambió en cada versión, separado en añadido, cambiado, corregido y seguridad. Sirve para saber cuándo entró una corrección y qué hallazgo resolvió; por ejemplo, que `npm audit` pasó de 7 vulnerabilidades a 0 o que nginx empezó a rechazar nombres de host ajenos. Es la traza entre un hallazgo, su corrección y su despliegue.

**7. ¿Por qué cada control tiene un responsable?**
Porque un control sin dueño se degrada sin que nadie lo note. Asignamos cada control a quien responde por su etapa del SDLC: la base y las VMs a infraestructura, el código de autenticación a desarrollo, el CI de pruebas a pruebas, la auditoría a supervisión, y las dependencias y el sistema operativo a parches. Si una verificación falla, sabemos a quién le toca.

**8. ¿Qué controles faltan documentar o verificar?**
Los parches del sistema operativo no tienen procedimiento escrito ni reporte periódico; la revisión obligatoria por CODEOWNERS todavía no está confirmada en la protección de la rama; y la regla de bitácoras sin datos sensibles no está reunida en un solo documento. Además declaramos controles que todavía no existen: integridad de archivos con AIDE, alertas automáticas y la copia de los respaldos fuera de la VM.

**9. ¿Por qué algunos controles se imponen en dos barreras, en el backend y en la base?**
Porque no queremos que un solo error en el código abra los datos. El PDP decide en el backend, pero la base también impone la seguridad por filas, el control dual y la regla de quién inicia qué trámite. Las pruebas lo demuestran: `verificar_plataforma` comprueba que, aunque alguien saltara el backend, la base rechaza que el mismo operador apruebe lo que propuso.

**10. ¿Cómo mantienen el inventario al día?**
Cada pull request que agrega o cambia un control tiene que actualizar su fila: el documento, la verificación y el responsable. Como cada verificación es un comando o una prueba concreta, si alguien la renombra o la borra lo detectamos al revisar el inventario contra el código.
