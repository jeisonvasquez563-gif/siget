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

## Seguridad — no negociable

- Nunca commitear credenciales, tokens, ni archivos `config.php`/`.env` reales (están en `.gitignore`; usar los `*.example.*` como plantilla).
- Antes de cada PR a `develop` o `main`, revisar que no se coló ningún secreto (`git diff` completo, no solo el resumen).
- SELinux se mantiene en `enforcing` en las VMs — ningún cambio de infraestructura lo debe desactivar.
