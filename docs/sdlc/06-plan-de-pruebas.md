# Plan de pruebas de seguridad y revisión de código

**Etapa 6: Pruebas** · Responsable: **Bradley Morales** · Revisa: **Joel Medina**

> Implementar procesos de revisión de código y realizar pruebas estáticas y dinámicas de seguridad. (Red Hat, *Seguridad en el ciclo de vida de desarrollo del software*.)

## Cómo se elaboró

1. Partimos de la tabla de pruebas que ya existían en SIGET y corrimos de nuevo las dos primeras el 16-nov-2026, sobre la rama `feature/sdlc-seguro` (la del PR #16):
   - Backend: en la carpeta `backend/`, con el entorno virtual del proyecto ya instalado, `pytest -q`.
   - Frontend: en la carpeta `frontend/`, con las dependencias ya instaladas (`npm ci`), `npx vitest run`.
2. Revisamos el estado del flujo de seguridad en GitHub Actions con `gh pr checks 16 --repo jeisonvasquez563-gif/siget`.
3. Armamos la lista de revisión de código a partir de los controles que ya tiene SIGET (PDP, seguridad por filas, secretos con `podman secret`, CSP estricta, migraciones con respaldo).
4. Aplicamos la lista a dos PR abiertos (#12 y #10) leyendo su diff con `gh pr diff <n>` y su estado con `gh pr checks <n>`. Las observaciones quedaron anotadas en este documento; no se publicaron comentarios en GitHub.

## Pruebas existentes

| Prueba | Qué cubre | Dónde corre | Resultado (fecha y captura) |
|---|---|---|---|
| Backend (pytest) | PDP, autenticación, plazos, documentos, registro | Tu computadora y CI | **463 de 463 pasan** (16-nov-2026, rama `feature/sdlc-seguro`, 6,9 s). Un solo aviso, esperado: la prueba que rechaza un algoritmo distinto del fijado firma con una clave corta a propósito |
| Frontend (Vitest) | Pantallas por rol, accesibilidad, seguridad del código | Tu computadora y CI | **191 de 191 pasan en 11 archivos** (16-nov-2026, rama `feature/sdlc-seguro`, 22,7 s). En el CI de los PR #10 y #12 falla 1 de 191: `simulador.prueba.jsx`, «el control dual se explica y una cuenta bloqueada no puede nada», porque espera el texto `cuenta_no_activa` que esas ramas todavía no muestran; lo corrige el PR #7 |
| `verificar_*` | Contra la base real: seguridad por filas, permisos, auditoría | VM1 (Jeison) | 77/77, 91/91, 84/84 (12-nov-2026) |
| Ensayo de la demostración | Recorrido completo contra producción | Jeison | 101/101 (12-nov-2026) |
| CI de seguridad | Bandit, Semgrep, pip-audit, npm audit, Gitleaks | GitHub Actions | **Los 5 trabajos del flujo `security-scan` pasan en el PR #16** (16-nov-2026): Bandit 14 s, Gitleaks 10 s, Semgrep 26 s, npm audit 7 s, pip-audit 16 s. También pasan `pruebas` y `verificar`. Ninguno queda pendiente |
| Análisis dinámico | OWASP ZAP, Nmap, pruebas manuales | Informe de noviembre | 0 alertas altas, medias ni bajas |

## Tipos de prueba

| Tipo | Qué es, en simple | Qué usamos en SIGET | Dónde está |
|---|---|---|---|
| Unitarias | Prueban una pieza chica por separado (una función, una regla del PDP, una pantalla) con datos de prueba. Son rápidas y se corren en cada cambio | pytest (backend) y Vitest con Testing Library y axe (frontend) | `backend/tests/` y `frontend/src/pruebas/` |
| De integración contra la base real | Prueban que la aplicación y PostgreSQL juntas respetan las reglas: seguridad por filas, permisos de cada rol de base de datos, triggers y auditoría | Comandos `verificar_tramites`, `verificar_plataforma` y `verificar_autenticacion` | `backend/apps/nucleo/management/commands/` |
| De extremo a extremo | Recorren la plataforma como lo haría una persona, de la entrada a la resolución del trámite, contra el sistema desplegado | Ensayo de la demostración, con 101 comprobaciones | `demo/ensayo.py` |
| SAST (análisis estático) | Leen el código sin ejecutarlo y buscan patrones peligrosos (consultas armadas a mano, funciones inseguras, criptografía débil) | Bandit (Python) y Semgrep (todo el código) | Flujo `security-scan` en GitHub Actions; informe en `docs/analisis-seguridad/` |
| SCA (análisis de dependencias) | Revisan las bibliotecas de terceros contra bases de vulnerabilidades conocidas | pip-audit (backend) y npm audit (frontend), más Dependabot | Flujo `security-scan`; informe en `docs/analisis-seguridad/` |
| Secretos | Buscan claves, contraseñas o tokens que se hayan subido al repositorio, en todo el historial | Gitleaks | Flujo `security-scan`; informe en `docs/analisis-seguridad/` |
| DAST (análisis dinámico) | Atacan la aplicación en ejecución desde afuera, como lo haría un atacante, sin mirar el código | OWASP ZAP (aplicación web) y Nmap (puertos y servicios expuestos), más pruebas manuales | Informe y evidencia en `docs/analisis-seguridad/` |

## Lista de revisión de código

| # | Qué revisar en cada PR | Por qué |
|---|---|---|
| 1 | ¿Toda ruta nueva pasa por el PDP (`autorizar(...)` con su `Accion`) y exige permisos? Si la ruta es pública (`AllowAny`), ¿está declarada en la auditoría de rutas? | Denegar por defecto: una ruta sin control queda abierta |
| 2 | ¿Todo identificador que llega del cliente se valida con `entero_positivo` o con un convertidor `<int:...>` antes de usarse, y los valores de configuración se validan al arrancar? | Una entrada sin validar es la puerta de inyecciones y errores 500 que filtran información |
| 3 | ¿Cada tabla nueva tiene seguridad por filas (`ENABLE ROW LEVEL SECURITY` y sus políticas) o una justificación escrita de por qué no? ¿Los `GRANT` a `app_role` son los mínimos? | El PDP es la primera barrera y la base de datos la segunda: si el código falla, la base igual no entrega filas ajenas |
| 4 | ¿No hay secretos en el código, en las pruebas ni en la documentación? Las claves se leen de `podman secret` y las contraseñas de prueba se generan al ejecutarse | Un secreto subido a git queda en el historial para siempre; Gitleaks lo detecta, pero la revisión lo evita antes |
| 5 | ¿El cambio trae pruebas nuevas (unitarias y, si toca la base, pasos en `verificar_*`), incluidos los casos de rechazo? | Sin prueba, nada impide que el control se rompa en el próximo cambio |
| 6 | ¿Se actualizaron `CHANGELOG.md` y `docs/api.md` (rutas, códigos de respuesta y errores)? | Quien opera o integra la plataforma necesita saber qué cambió y cómo responde cada ruta |
| 7 | Si hay migración: ¿se ejecuta como `siget_owner` dentro de `BEGIN ... COMMIT`, y el runbook pide respaldo verificado y un ensayo terminado en `ROLLBACK` antes de aplicarla? | Una migración mal hecha en producción puede perder datos; el respaldo y el ensayo permiten volver atrás |
| 8 | ¿El frontend no agrega estilos ni scripts en línea (`style=`, `<script>` embebido) que obliguen a aflojar la CSP? | La CSP sin `unsafe-inline` es la defensa principal contra XSS; un estilo en línea obligaría a debilitarla |
| 9 | ¿El PR atiende un solo frente (backend o frontend, un solo pendiente) y no arrastra cambios de otras ramas? | Un PR chico y enfocado se revisa bien; uno mezclado esconde cambios que nadie mira |
| 10 | ¿Pasan los controles del CI (`pruebas`, `verificar` y `security-scan`) antes de aprobar? | Si el CI falla, el cambio no está listo; aprobar en rojo normaliza ignorar las alarmas |

## PR revisados

| PR | Fecha | Comentarios hechos |
|---|---|---|
| #12 `feature/backend-documentos` (documentos adjuntos cifrados, PT-8) | 16-nov-2026 | **Cumple:** 1 (las rutas de documentos llaman a `autorizar` con `VER_DOCUMENTO` y `ADJUNTAR_DOCUMENTO`); 2 (rutas con `<int:pk>` y `<int:documento_id>`, y además `entero_positivo(documento_id)`); 3 (la migración 015 activa seguridad por filas con políticas de ver y adjuntar, y solo da `SELECT, INSERT` a `app_role`); 4 (la clave `siget-docs-key` se lee como secreto y el runbook la crea sin mostrarla); 5 (24 pruebas nuevas, entre ellas archivos hostiles, cifrado y almacén, y pasos nuevos en `verificar_tramites`); 6 (`CHANGELOG.md` y `docs/api.md` actualizados); 7 (migración en transacción como `siget_owner`; el runbook registra respaldo verificado y ensayo con `ROLLBACK`); 8 (no agrega `style=` ni scripts en línea). **Observaciones:** (a) No cumple 9: el PR de backend trae también cambios de frontend (`App.jsx`, `Tramites.jsx`, `mock.js`, datos del simulador) y la migración 012, que vienen de dos commits compartidos con el PR #10; conviene separarlos en su propio PR o integrar uno primero y rebasar el otro. (b) No cumple 10: el trabajo `verificar` falla por la prueba del simulador (`cuenta_no_activa`) que corrige el PR #7, y el flujo `security-scan` todavía no corrió en esta rama porque se abrió antes del PR #16. (c) Un documento alterado responde 500 y deja evento de seguridad; está bien que no se entregue, pero conviene documentar ese código en `docs/api.md` junto a los demás. (d) El runbook deja pendiente respaldar la clave de documentos fuera de VM1: sin ella los archivos no se pueden descifrar |
| #10 `feature/backend-registro-configurable` (registro configurable con invitaciones, PT-2) | 16-nov-2026 | **Cumple:** 1 (emitir y listar invitaciones pasa por `autorizar` con `EMITIR_INVITACION`, solo para el operador de identidades con segundo factor reciente; `GET /auth/configuracion/` es pública y está declarada en la auditoría de rutas); 2 (`SIGET_REGISTRO` y `SIGET_INVITACION_DIAS` se validan al arrancar y un valor inválido no deja iniciar el backend; los datos del registro devuelven qué campo falla); 4 (solo se guarda el hash del código de invitación; las pruebas generan su contraseña al ejecutarse); 5 (16 pruebas nuevas y pasos nuevos en `verificar_plataforma`); 6 (`CHANGELOG.md` y `docs/api.md` actualizados); 7 (migración 014 en transacción como `siget_owner`, con respaldo verificado y ensayo con `ROLLBACK` registrados); 8 (no agrega estilos en línea). **Observaciones:** (a) Ítem 3 parcial: la tabla `siget.invitacion` no tiene seguridad por filas; los permisos son mínimos (`UPDATE` solo de `usada_en` y `usada_por`, trigger de un solo uso, el auditor no ve el hash), pero falta dejar escrita la justificación o agregar una política. (b) No cumple 9: comparte con el PR #12 los dos commits de la migración 012 y los cambios de frontend en `NuevoTramite`. (c) No cumple 10: `verificar` falla por la misma prueba del simulador que corrige el PR #7, y `security-scan` no corrió en esta rama. (d) El bloque de nginx para la IP real detrás de un proxy queda comentado a propósito; hay que revisarlo de nuevo antes de activarlo |

## Preguntas que puede hacer el profesor

**1. ¿Cuál es la diferencia entre análisis estático y dinámico?**
El estático lee el código sin ejecutarlo: Bandit y Semgrep buscan patrones peligrosos y pip-audit, npm audit y Gitleaks revisan dependencias y secretos. El dinámico ataca la aplicación ya en ejecución, desde afuera, como lo haría un atacante: usamos OWASP ZAP y Nmap. Se complementan: el estático encuentra problemas temprano y el dinámico confirma cómo se comporta el sistema desplegado.

**2. ¿Qué es un falso positivo y cómo trataron el de inyección SQL de ZAP?**
Un falso positivo es una alerta que la herramienta marca pero que no es una vulnerabilidad real. ZAP (regla 40018) creyó ver inyección SQL en `/auth/*` porque las respuestas cambiaban entre `OR 1=1` y `AND 1=1`. Repetimos esos mismos pares con un script propio (`verificar_sqli.py`): el login respondió idéntico a las tres variantes y en registro y restablecimiento todo daba 429, porque el escaneo había agotado el límite de peticiones por IP; ese cambio de 400 a 429 fue lo que ZAP confundió. Además la contraseña nunca llega a una consulta SQL y las consultas a mano usan parámetros. Lo marcamos como falso positivo en el plan de ZAP del «después», citando la verificación, sin quitar el límite de peticiones.

**3. ¿Qué es una revisión de código y por qué la hace otra persona?**
Es leer el cambio de un compañero antes de integrarlo, con una lista de controles concretos. La hace otra persona porque quien escribió el código tiene sus mismas suposiciones y no ve sus propios errores. En SIGET además lo exige CODEOWNERS: cada etapa tiene un responsable y alguien distinto que revisa.

**4. ¿Qué cubre el ensayo de la demostración?**
Son 101 comprobaciones que recorren la plataforma de punta a punta contra el sistema desplegado: ingreso con segundo factor, creación y gestión de trámites, permisos por rol, aislamiento entre instituciones, control dual y rechazos de lo que no se debe permitir. Lo usamos como prueba de regresión después de cada despliegue. Genera su contraseña de prueba al ejecutarse, así que no guarda secretos. La última corrida dio 101 de 101 el 12-nov-2026.

**5. ¿Qué pasa si el CI de seguridad falla?**
El PR no se integra hasta que se corrija. Primero miramos el hallazgo: si es real, se arregla en el mismo PR; si es un falso positivo, se justifica por escrito y se excluye de forma puntual, nunca apagando la herramienta entera. Por ejemplo, en los PR #10 y #12 el trabajo `verificar` falla, y por eso no los damos por aprobados.

**6. ¿Por qué tienen pruebas contra la base real además de las unitarias?**
Porque las unitarias usan una base de prueba y no pueden comprobar la seguridad por filas ni los permisos de cada rol de PostgreSQL tal como están en producción. Los comandos `verificar_*` se conectan a la base real con el rol de la aplicación y comprueban que la base, por sí sola, rechaza lo que el código no debería poder hacer.

**7. ¿Qué es la seguridad por filas y por qué la revisan en cada PR?**
Es una regla de PostgreSQL que filtra las filas según quién consulta, por ejemplo que el personal solo vea los trámites de su institución. La revisamos porque es nuestra segunda barrera: si un error en el código saltara el PDP, la base igual no entregaría datos ajenos. Por eso en el PR #10 pedimos justificar o agregar una política para la tabla de invitaciones.

**8. ¿Por qué validan las entradas con `entero_positivo`?**
Porque todo lo que llega del cliente puede estar manipulado. Si un identificador no es un entero positivo, respondemos 404 antes de tocar la base. Así evitamos errores 500 que filtran información y cortamos de raíz los intentos de inyección por parámetros.

**9. ¿Por qué una prueba falla en el CI de algunos PR pero pasa en la computadora?**
Porque se corren sobre ramas distintas. En nuestra computadora corrimos la rama del PR #16, donde pasan 191 de 191. Los PR #10 y #12 salieron antes de la corrección del simulador que trae el PR #7, y por eso allí falla una prueba que espera el mensaje `cuenta_no_activa`. Cuando se integre el PR #7 y se actualicen esas ramas, debería pasar.

**10. ¿Por qué no permiten estilos en línea en el frontend?**
Porque nuestra política de seguridad de contenido (CSP) no acepta `unsafe-inline`. Eso impide que un atacante que logre inyectar HTML ejecute scripts o estilos propios. Si un PR agregara un `style=`, tendríamos que aflojar la CSP para toda la aplicación, y eso no lo aceptamos.
