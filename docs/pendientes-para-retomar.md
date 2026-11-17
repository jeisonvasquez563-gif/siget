# Pendientes para retomar SIGET

Estado al **17 de noviembre de 2026**. Este documento dice dónde quedó cada cosa y por dónde seguir. Plazo acordado para terminar la plataforma: **2 semanas** (hasta el 1 de diciembre de 2026).

## 1. Cómo quedó todo

- **`develop` tiene todo lo que corre en producción**: el análisis estático y dinámico, el CI de seguridad, PT-3 (plazos y escalamiento), PT-2 (registro por invitación) y PT-8 (documentos cifrados), más la documentación del SDLC seguro (PR #14, #15, #17 y #18, fusionados).
- El backend de `develop` es idéntico, archivo por archivo, al que corre en VM1. Pruebas: 555 del backend y 206 del frontend.
- **Producción** (17-nov): `verificar_tramites` 77/77, `verificar_plataforma` 91/91, `verificar_autenticacion` 84/84 y ensayo 101/101.
- **Entorno**:
  - Rocky Linux 9.9 con 0 avisos pendientes.
  - Checkpoint PHP y pgAdmin web retirados; puerto 80 cerrado (runbook §38).
  - Copia de la clave de documentos fuera de VM1.
- **Único PR abierto**: #6 (`develop` → `main`). Se fusiona el día de la entrega.
- El repositorio lo usa solo Jeison: los PR se fusionan como administrador (`gh pr merge N --admin --merge`) **solo con el CI de seguridad en verde**.

## 2. PT-15: derechos sobre los datos personales (Ley 81) — implementado, sin revisar ni integrar

**Qué es:** cumplir los requisitos RS-09 y RS-22 («No cumple» en `docs/sdlc/02-requisitos-de-seguridad.md`).
- La persona puede ver, corregir y exportar sus datos.
- Puede pedir rectificación, cancelación u oposición, con respuesta en 10 días hábiles.
- Se agrega un aviso de privacidad, que hay que aceptar al registrarse.

**Dónde está:**
- Carpeta: `C:\Users\jeiva\Desktop\siget-derechos`.
- Backend: `feature/backend-derechos-datos` (`b26b252`).
- Frontend: `feature/frontend-derechos-datos` (`a3247e4`).
- Las dos ramas están **solo en local**: sin push y sin PR.

**Contenido:**
- Migración `016-derechos-datos.sql`.
- Rutas `/auth/mis-datos/` y `/auth/aviso-privacidad/`.
- Consola del operador de identidades para responder solicitudes.
- Pantallas «Mis datos» y «Aviso de privacidad».
- Tres acciones nuevas del PDP (`corregir_mis_datos`, `consultar_solicitudes_datos`, `responder_solicitud_datos`).
- Pruebas: 618 del backend y 230 de 231 del frontend. La que falla es del simulador, por tiempo de espera, y ya fallaba antes.

**Lo que falta, en orden:**
1. **Revisión crítica de seguridad.** Hay que leer `git diff 14d3bd6..a3247e4` por partes. Se intentó dos veces con un subagente y la primera se trabó, así que conviene dividirla en encargos chicos. Qué mirar:
   - permisos de la migración 016 (UPDATE solo de correo, provincia y ciudad; nadie borra; nadie responde su propia solicitud);
   - acceso a datos de otra persona (IDOR);
   - respuestas que delaten si una cuenta o una solicitud existe;
   - qué sale en la exportación (que no incluya hashes ni la huella de la cédula);
   - que los eventos lleven nombres de campos, nunca valores;
   - XSS en las pantallas.
2. **Integrar con `develop`.** Las ramas salen del `develop` viejo (`14d3bd6`). Al combinar:
   - **Runbook:** su sección dice 35 y hay que pasarla a la **39** (35–38 ya están tomadas).
   - **Plazo de 10 días hábiles:** hoy solo salta sábados y domingos; hay que usar `sumar_dias_habiles` de PT-3 (feriados de Panamá).
   - **`Acceso.jsx`:** la casilla del aviso de privacidad tiene que convivir con el campo de invitación de PT-2.
   - **`Plataforma.jsx`:** el panel de solicitudes va junto al de invitaciones.
   - **Conteos:** acciones del PDP (21), módulos (16) y `test_modelos.py`.
   - Comprobar que la 016 no le dé nada a `escalador_role`.
3. **Regenerar** `docs/diagrama-roles-modulos.svg` y `docs/modulos.md`, que tienen los conteos viejos.
4. **Push y PR**, con el CI de seguridad en verde.
5. **Aplicar en producción** (necesita OK de Jeison):
   - respaldo verificado;
   - ensayo de la 016 con `ROLLBACK` y después la migración real;
   - reconstruir el backend y la interfaz;
   - correr los `verificar_*`.

   **Ojo:** la migración 016 y los pasos nuevos de `verificar_autenticacion`, `verificar_plataforma` y `verificar_politicas` **nunca se corrieron contra PostgreSQL**. Es lo primero que puede fallar.

## 3. Lo que le falta a la plataforma (auditoría del 17-nov)

### Funcionalidades
| Pendiente | Impacto | Esfuerzo |
|---|---|---|
| **El trámite no tiene contenido**: solo guarda tipo, estado y plazo. Faltan los datos del formulario de cada tipo, el motivo al rechazar o pedir subsanación, y que la ciudadanía responda una subsanación | Alto | 4+ días |
| Notificaciones dentro de la plataforma (PT-9) | Medio | 2–3 días |
| Perfil y cambio de contraseña desde la sesión | Medio | 2–3 días |
| Gestión de los tipos de trámite por institución: la acción del PDP existe, la ruta no | Medio | 2–3 días |
| Catálogo de demostración más rico (hoy 6 instituciones y 6 trámites) | Medio | 1 día |

### Seguridad
| Pendiente | Impacto | Quién decide |
|---|---|---|
| Alertas ante patrones sospechosos y exportación firmada de la auditoría (PT-10, ZT-8, RS-24) | Alto | Se puede hacer |
| Segunda copia de la clave de documentos fuera del PC anfitrión (R6) | Alto | Jeison (USB o gestor de contraseñas) |
| Copia de los respaldos de la base fuera de VM2 (R7) | Alto | Jeison: dónde guardarla |
| Una sola persona con sudo en VM2 (R9) | Alto | Jeison: a quién dárselo |
| Rotación de claves JWT y Fernet (PT-6) | Medio | Jeison crea los secretos |
| CA interna sin `keyUsage` (PT-7) | Medio | Jeison, en una ventana acordada |
| `app_role` lee `usuario` y `sesion` completas | Medio | Migración |
| El bloqueo de cuentas se puede usar para bloquear a otros; no hay bloqueo por IP | Medio | Se puede hacer |
| Aviso de brecha a los afectados y política de conservación (Ley 81) | Medio | Se puede hacer |
| Retirar la excepción de `picomatch` en el CI cuando salga el parche (GHSA-fc5q-39xc-vjpf) | Bajo | Dependabot avisa |

### Frontend (profesional)
- Pruebas de punta a punta con Playwright y contraste AA medido (PT-12).
- Paginación: hoy la bandeja corta en 100 (`Tramites.jsx`).
- Pantalla de error global (`ErrorBoundary`).
- Panel de indicadores para supervisión y coordinación.
- Revisar el comportamiento en celular.

### Infraestructura
- **Aviso si falla el temporizador de escalamiento (R12).**
- **Inactividad de 2 minutos solo en VM1, por la demo (R21):** volver a 10 después de la presentación.
- **IP real del cliente en nginx:** solo hace falta si se abre a internet (PT-14).
- **Consolidar los discos de las VMs en VMware (Manage → Clean Up Disks):** solo se puede con las VMs apagadas.
  - La carpeta `C:\Users\jeiva\Documents\Virtual Machines\_bloqueos-respaldo-2026-11-17` se puede borrar cuando las VMs arranquen bien.
- **Desinstalar los paquetes de Apache, PHP y pgAdmin de VM1:** hoy están apagados y deshabilitados. Hacerlo después de la entrega.

### Documentación desactualizada
- `docs/modulos.md` y `runbook.md` todavía dicen que las consolas son «próximamente».
- `docs/zero-trust-cobertura.md` dice que no hay respaldos automáticos y cita conteos viejos de pruebas.
- `docs/architecture/plan*.md` tienen tareas sin marcar que ya están hechas.
- El guion y los manuales citan «55 de 55»; el ensayo actual es 101/101.
- Al final hay que regenerar todos los `.docx`:
  - informe final;
  - guía de defensa;
  - plantillas y organización.

### Lo que no conviene prometer en 2 semanas
- **Correo real:** no hay servidor de correo. Alternativa: notificaciones dentro de la plataforma.
- **Verificación de identidad contra el Registro Civil:** depende de un tercero. Se declara como límite.
- **Alta disponibilidad:** todo corre en un solo PC.
- **Cambiar la navegación a direcciones con ruta:** revierte una decisión de seguridad.

## 4. Orden sugerido

**Semana 1**
1. Terminar PT-15: revisión, integración y PR.
2. Contenido del trámite, en el backend y en el frontend.
3. Cambio de contraseña.
4. Pantalla de error global y paginación.
5. Corregir la documentación desactualizada.

**Semana 2**
1. Notificaciones y gestión del catálogo.
2. Alertas (PT-10).
3. Playwright y contraste.
4. Aviso si falla el escalamiento.
5. Al final: aplicar en producción, correr el ensayo completo, regenerar los `.docx` y fusionar el PR #6 a `main`.

## 5. Herramientas y comandos útiles

- **Capturas de evidencia:** `docs/analisis-seguridad/herramientas/captura.py cmd <carpeta> <nombre> "<título>" -- <comando>`, con el venv `C:\Users\jeiva\.herramientas-siget\venv`.
- **Verificaciones contra la base real:** se copia `infra/podman/vm1-app-backend/scripts/ejecutar-comando.sh` a `/tmp` de VM1 y se corre `bash /tmp/ejecutar-comando.sh /tmp/<v>.out <v>` para cada `verificar_*`; después se borra la salida con `shred -u`.
- **Ensayo:** `backend/.venv/Scripts/python.exe demo/ensayo.py` desde la carpeta del proyecto.
- **Despliegue:** el procedimiento de cada cambio está en el runbook, secciones 35 a 38. Siempre:
  1. respaldo verificado;
  2. ensayo de la migración con `ROLLBACK`;
  3. migración real;
  4. imagen con respaldo;
  5. verificaciones;
  6. ensayo.
- **Generadores de los `.docx`:** están en `docs/sdlc/generadores/` y necesitan el paquete `docx` de npm en `NODE_PATH`.
