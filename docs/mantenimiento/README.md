# Mantenimiento de SIGET y ciclo de vida de Red Hat

Respaldo del informe [`../SIGET_Analisis_Mantenimiento_Ciclo_de_Vida.docx`](../SIGET_Analisis_Mantenimiento_Ciclo_de_Vida.docx) (12 de noviembre de 2026): las cuatro fases del ciclo de vida de RHEL 9 aplicadas al estado real de SIGET.

| Fase de RHEL 9 | Fechas | Qué significa para SIGET |
|---|---|---|
| 1. Soporte completo | 18-may-2022 a 31-may-2027 | Fase actual: actualizar a 9.8, reconstruir imágenes y migrar Python 3.12 antes de abr-2027 |
| 2. Soporte de mantenimiento | 1-jun-2027 a 31-may-2032 | Solo parches: Django 5.2, nginx 1.26 y PostgreSQL 16 vencen en 2028 |
| 3. Ciclo de vida extendido (de pago) | 1-jun-2032 a 31-may-2036 | Rocky no lo tiene: migrar a Rocky/RHEL 10 antes del 31-may-2032 |
| 4. Fase de vida extendida | desde 1-jun-2036 | Sin parches: no se llega |

**Hallazgos principales (medidos el 12-nov-2026, sin cambiar nada):** ninguna actualización completa del sistema desde la instalación; 170 (VM1) y 177 (VM2) avisos de seguridad pendientes, 2 críticos en cada una; Rocky 9.7, versión menor sin soporte desde que salió la 9.8 (28-may-2026); la imagen de nginx sigue en UBI 9.7; PostgreSQL en una imagen Debian de docker.io (fuera del ciclo de Red Hat); el PostgreSQL nativo sigue instalado sin usarse.

- [`evidencia/`](./evidencia/): salida completa (`.txt`) y captura (`.png`) de cada comando de solo lectura.
- [`generar-informe.js`](./generar-informe.js): genera el `.docx` (docx-js) a partir de la evidencia.
