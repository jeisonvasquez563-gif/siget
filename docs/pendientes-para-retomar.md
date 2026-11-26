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

## 2. PT-15: derechos sobre los datos personales (Ley 81) — HECHO (24-nov)

Revisado (3 revisiones de seguridad, 0 críticos o altos, 14 hallazgos corregidos), integrado con `develop` (PR #20) y **aplicado en producción el 24-nov** (PR #21, runbook 39.10): migración 016, 8 verificaciones en verde contra la base real y ensayo 101/101. RS-09 y RS-22 pasan a «Cumple».

Queda como riesgo aceptado (runbook 39.9): sin seguridad por filas en `perfil` ni en `solicitud_derecho`.

## 3. Lo que le falta a la plataforma (auditoría del 17-nov)

### Funcionalidades
| Pendiente | Impacto | Esfuerzo |
|---|---|---|
| ~~El trámite no tiene contenido~~ **HECHO el 24-nov** (PR #22 y #23, runbook 40.9): formulario por tipo, motivo obligatorio en la base y respuesta de la ciudadanía a la subsanación; ensayo 112/112 | — | — |
| ~~Notificaciones dentro de la plataforma (PT-9)~~ **HECHO el 24-nov** (PR #27 y #28, runbook 42.9; ensayo 113/113) | — | — |
| ~~Cambio de contraseña desde la sesión~~ **HECHO el 24-nov** (PR #25 y #26, runbook 41.6) | — | — |
| Gestión de los tipos de trámite por institución: la acción del PDP existe, la ruta no | Medio | 2–3 días |
| Catálogo de demostración más rico (hoy 6 instituciones y 6 trámites) | Medio | 1 día |

### Seguridad
| Pendiente | Impacto | Quién decide |
|---|---|---|
| ~~Alertas ante patrones sospechosos (PT-10, ZT-8, RS-24)~~ **HECHO el 26-nov** (PR #29 y #30, runbook 43.10; ensayo 116/116). Queda la exportación firmada de la auditoría | Bajo | Se puede hacer |
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
- ~~Paginación~~ hecha el 24-nov (de a 20; en el navegador: límite conocido, runbook 41.5).
- ~~Pantalla de error global~~ hecha el 24-nov.
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
1. ~~Terminar PT-15~~ (hecho el 24-nov).
2. ~~Contenido del trámite~~ (hecho el 24-nov).
3. ~~Cambio de contraseña~~ (hecho el 24-nov).
4. ~~Pantalla de error global y paginación~~ (hecho el 24-nov).
5. ~~Corregir la documentación desactualizada~~ (hecho el 24-nov, PR #24).

**Semana 2**
1. ~~Notificaciones~~ (hecho el 24-nov) y gestión del catálogo.
2. ~~Alertas (PT-10)~~ (hecho el 26-nov).
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
