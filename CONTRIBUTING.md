# Cómo trabajar en este repo

## Ramas (GitFlow)

- `main` — estable, lo que se muestra/entrega.
- `develop` — integración.
- `feature/<nombre-corto>` — un bloque de trabajo, sale de `develop`.
- `release/<version>` — estabiliza una entrega antes de pasar a `main`.
- `hotfix/<nombre>` — arreglo urgente sobre `main`.

Nunca se commitea directo a `main`. Nunca se commitea directo a `develop` para trabajo que no sea trivial (un typo en un README sí, una feature no).

```bash
git checkout develop
git pull
git checkout -b feature/mi-bloque-de-trabajo
# ... trabajo, commits ...
git push -u origin feature/mi-bloque-de-trabajo
# Pull Request feature/mi-bloque-de-trabajo -> develop
```

## Mensajes de commit

Formato [Conventional Commits](https://www.conventionalcommits.org/):

```
<tipo>: <resumen corto en imperativo>

<cuerpo opcional, explicando el POR QUÉ, no el qué>
```

Tipos usados en este proyecto: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `security`.

Ejemplos:
```
feat: agregar endpoint de creación de trámites
fix: corregir validación de transición de estado en Tramite
security: mover credenciales de BD a config.php fuera de git
docs: actualizar runbook con pasos de Podman
```

## Documentación — obligatoria, no opcional

**Ningún cambio se considera terminado si no está documentado.** Esto no es una sugerencia — es un requisito para que un Pull Request se pueda mergear.

Reglas concretas:

1. **Todo PR a `develop` o `main` debe actualizar la documentación relevante en `docs/` junto con el código/infra.** Si tocaste algo y no hay ningún `.md` que lo mencione, el PR está incompleto.
2. **Toda entrada nueva o modificada va también al `CHANGELOG.md`** de la raíz del repo, con fecha y una línea clara de qué cambió y por qué.
3. Guía de qué documento actualizar según el tipo de cambio:

   | Cambiaste... | Actualizá... |
   |---|---|
   | Infraestructura de una VM (paquetes, red, firewall, SELinux) | `docs/runbook.md` (el paso nuevo) + `CHANGELOG.md` |
   | Una decisión de arquitectura o de stack | `docs/architecture/spec.md` + `CHANGELOG.md` |
   | El orden de trabajo, una fase completada, algo que quedó pendiente | `docs/architecture/plan.md` + `CHANGELOG.md` |
   | Estado general del proyecto, riesgos, decisiones tomadas en el momento | `docs/informe-avance.md` + `CHANGELOG.md` |
   | Config del repo (branch protection, CI, estructura de carpetas) | `README.md` y/o `CONTRIBUTING.md` + `CHANGELOG.md` |
   | Un incidente (bug, credencial expuesta, error de configuración) | el documento más relevante de la tabla de arriba, explicando qué pasó y cómo se resolvió + `CHANGELOG.md` |

4. Un commit de código sin su documentación correspondiente se trata como un commit incompleto, aunque el código funcione. "Funciona" no es lo mismo que "está listo".
5. Esto aplica también a quien lo hizo — no es una regla solo para "explicarle a otros", es la forma en que el propio equipo recuerda por qué se hizo algo, dentro de tres semanas, cuando ya nadie se acuerda de memoria.

## Seguridad — no negociable

- Nunca commitear credenciales, tokens, ni archivos `config.php`/`.env` reales (están en `.gitignore`; usar los `*.example.*` como plantilla).
- Antes de cada PR a `develop` o `main`, revisar que no se coló ningún secreto (`git diff` completo, no solo el resumen).
- SELinux se mantiene en `enforcing` en las VMs — ningún cambio de infraestructura lo debe desactivar.
