# Modelo de amenazas STRIDE

**Etapa 3: Diseño** · Responsable: **Joel Medina** · Revisa: **Andy Martínez**

> Elaborar el modelo de amenazas e incluir la seguridad como parte integral de la arquitectura. (Red Hat, *Seguridad en el ciclo de vida de desarrollo del software*.)

## Cómo completarla

1. STRIDE son seis tipos de amenaza. Para cada pieza de SIGET preguntate si puede pasar cada una:
2. **S**uplantación (alguien se hace pasar por otro) · **T**ampering, alteración (alguien modifica datos) · **R**epudio (alguien niega haber hecho algo) · **I**nformación divulgada (alguien ve lo que no debe) · **D**enegación de servicio (alguien tumba el sistema) · **E**levación de privilegios (alguien obtiene más permisos de los que tiene).
3. La tabla del **backend** está resuelta como ejemplo.
4. Completá las demás piezas: navegador e interfaz, nginx, base de datos, temporizador de escalamiento y archivos de documentos.
5. Leé `docs/superpowers/specs/2026-10-08-arquitectura-zero-trust-design.md` para encontrar los controles.
6. Si una amenaza no tiene control, escribí **abierta**. Las que no tengas claras, revisalas con Andy.

## Componentes de SIGET

Navegador (interfaz React) → nginx (TLS 1.3, VM1) → backend Django (VM1) → PostgreSQL (VM2). Además: temporizador de escalamiento (VM1) y volumen de documentos cifrados (VM1).

## Ejemplo resuelto: backend Django

| STRIDE | Amenaza | Control en SIGET | Estado |
|---|---|---|---|
| S | Alguien usa un token robado de otra persona | Token de acceso de 10 minutos, sesiones revocables, segundo factor reciente para acciones sensibles | Mitigada |
| T | Alguien cambia el estado de un trámite saltándose las reglas | La base valida las transiciones con un trigger; el PDP decide antes | Mitigada |
| R | Un funcionario niega haber aprobado un trámite | Auditoría inalterable (`evento_auditoria`, sin UPDATE ni DELETE) | Mitigada |
| I | Un error muestra datos de otra institución | Seguridad por filas en la base además del PDP: dos barreras independientes | Mitigada |
| D | Una ráfaga de peticiones satura el inicio de sesión | Límites de tasa en nginx y en Django | Mitigada |
| E | Un ciudadano intenta actuar como funcionario | El PDP niega por defecto; ningún rol puede todo (matriz de permisos) | Mitigada |

## Navegador e interfaz

| STRIDE | Amenaza | Control en SIGET | Estado |
|---|---|---|---|
| S | [completar] |  |  |
| T | [completar] |  |  |
| R | [completar] |  |  |
| I | [completar] |  |  |
| D | [completar] |  |  |
| E | [completar] |  |  |

## nginx

| STRIDE | Amenaza | Control en SIGET | Estado |
|---|---|---|---|
| S | [completar] |  |  |
| T | [completar] |  |  |
| R | [completar] |  |  |
| I | [completar] |  |  |
| D | [completar] |  |  |
| E | [completar] |  |  |

## Base de datos PostgreSQL

| STRIDE | Amenaza | Control en SIGET | Estado |
|---|---|---|---|
| S | [completar] |  |  |
| T | [completar] |  |  |
| R | [completar] |  |  |
| I | [completar] |  |  |
| D | [completar] |  |  |
| E | [completar] |  |  |

## Temporizador de escalamiento

| STRIDE | Amenaza | Control en SIGET | Estado |
|---|---|---|---|
| S | [completar] |  |  |
| T | [completar] |  |  |
| R | [completar] |  |  |
| I | [completar] |  |  |
| D | [completar] |  |  |
| E | [completar] |  |  |

## Archivos de documentos

| STRIDE | Amenaza | Control en SIGET | Estado |
|---|---|---|---|
| S | [completar] |  |  |
| T | [completar] |  |  |
| R | [completar] |  |  |
| I | [completar] |  |  |
| D | [completar] |  |  |
| E | [completar] |  |  |
