# Política de seguridad de SIGET

SIGET es un proyecto académico (Ciberseguridad 5, Universidad Tecnológica de Panamá) que sigue el ciclo de vida de desarrollo seguro descrito en [`docs/sdlc/`](./docs/sdlc/README.md).

## Versiones con soporte

| Versión | Soporte |
|---|---|
| Rama `develop` (lo desplegado en las VMs del laboratorio) | Sí |
| Ramas de funcionalidades sin fusionar | No |

## Cómo reportar una vulnerabilidad

**No abras un issue público ni la publiques en un PR.** Reportala de forma privada:

1. **Canal principal:** por **GitHub**, pestaña *Security* → *Report a vulnerability* (aviso privado de seguridad del repositorio). Solo lo ven quienes mantienen el repositorio.
2. Si no podés usar ese canal, avisá en privado al responsable de la infraestructura (Jeison Vásquez) por el grupo interno del equipo, **sin detalles técnicos**, y él te abre el aviso privado en GitHub para continuar ahí.

Incluí, si podés: qué componente afecta, cómo reproducirla, qué impacto tiene y, si la tenés, una propuesta de corrección. **No incluyas contraseñas, claves ni datos personales reales** en el reporte.

## Qué pasa después

| Paso | Plazo |
|---|---|
| Confirmamos que recibimos el reporte | 2 días hábiles |
| Evaluamos la severidad (CVSS) y lo registramos | 5 días hábiles desde el acuse |
| Corrección de una vulnerabilidad crítica o alta | 7 días desde la evaluación |
| Corrección de una vulnerabilidad media | 30 días desde la evaluación |
| Corrección de una vulnerabilidad baja | En la siguiente entrega planificada |
| Aviso a quien la reportó cuando esté corregida | Al publicar la corrección |

Cada corrección entra por pull request, con prueba que la cubre, revisión de otra persona y paso por el CI de seguridad (`.github/workflows/security-scan.yml`), y queda registrada en el [`CHANGELOG.md`](./CHANGELOG.md).

## Alcance

Dentro: el código de este repositorio y la plataforma desplegada en las VMs del laboratorio. Fuera: servicios de terceros (GitHub, Tailscale) y ataques de denegación de servicio o de ingeniería social contra integrantes del equipo.
