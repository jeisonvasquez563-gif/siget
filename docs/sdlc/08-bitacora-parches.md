# Bitácora de parches y calendario de fin de soporte

**Etapa 8: Mantenimiento (parches y dependencias)** · Responsable: **Walter Sanjur** · Revisa: **Jeison Vásquez**

> Eliminar los puntos vulnerables que se descubran y mantener el sistema actualizado. (Red Hat, *Seguridad en el ciclo de vida de desarrollo del software*.)

## Cómo completarla

1. Cada lunes revisá en GitHub los PR de Dependabot y el resultado del CI de seguridad.
2. Pedile a Jeison la salida de `sudo dnf updateinfo summary` de las dos VMs y anotá los números.
3. Regla: ningún aviso **crítico** puede quedar más de 7 días sin aplicar.
4. Revisá el calendario de fin de soporte y avisá con un mes de anticipación.

## Bitácora semanal

| Semana | Avisos críticos VM1 / VM2 | Importantes VM1 / VM2 | PR de Dependabot | CI de seguridad | Acción |
|---|---|---|---|---|---|
| Línea base: 12-nov-2026 | 2 / 2 | 93 / 96 | — | — | Plan de actualización a 9.8 |
| [completar] |  |  |  |  |  |
| [completar] |  |  |  |  |  |
| [completar] |  |  |  |  |  |

## Calendario de fin de soporte (del informe de mantenimiento)

| Componente | Fin de soporte | Avisar el | Estado |
|---|---|---|---|
| Python 3.12 (Application Stream de RHEL 9) | Abril de 2027 | Marzo de 2027 | Pendiente |
| Rocky Linux 9: soporte activo | 31-may-2027 | Abril de 2027 | Pendiente |
| Django 5.2 | Abril de 2028 | Marzo de 2028 | Pendiente |
| nginx 1.26 | Mayo de 2028 | Abril de 2028 | Pendiente |
| PostgreSQL 16 | 9-nov-2028 | Octubre de 2028 | Pendiente |
| Rocky Linux 9: soporte de seguridad | 31-may-2032 | Migrar antes | Pendiente |
