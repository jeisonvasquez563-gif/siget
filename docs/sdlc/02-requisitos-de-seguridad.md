# Requisitos de seguridad y cumplimiento

**Etapa 2: Análisis de requisitos** · Responsable: **Gabriel González** · Revisa: **Simna De Gracia**

> Incluir los requisitos de seguridad desde el principio y entender los requisitos de cumplimiento normativo. (Red Hat, *Seguridad en el ciclo de vida de desarrollo del software*.)

## Cómo completarla

1. Las filas de **Autenticación** están resueltas como ejemplo.
2. Completá las otras áreas: autorización, protección de datos personales, auditoría, cifrado, disponibilidad y registro de cuentas (al menos 3 requisitos por área).
3. En «Evidencia en SIGET» poné el archivo, la prueba o la sección del documento que lo demuestra. Buscá en `docs/api.md`, `docs/modulos.md`, `docs/runbook.md` y `CHANGELOG.md`.
4. Estado: **Cumple / Parcial / No cumple**.
5. Para la sección legal, buscá en Legispan (Asamblea Nacional) la ley panameña de protección de datos personales. **Copiá el número de ley y del artículo tal como aparecen**: no los escribas de memoria.

## Matriz de requisitos

| ID | Área | Requisito | Evidencia en SIGET | Estado |
|---|---|---|---|---|
| RS-01 | Autenticación | Las contraseñas se guardan con un algoritmo resistente (nunca en texto plano) | Argon2 (`backend/config/settings.py`, `PASSWORD_HASHERS`) | Cumple |
| RS-02 | Autenticación | El personal y los operadores usan segundo factor | TOTP obligatorio (`apps/autenticacion/mfa.py`, `verificar_autenticacion`) | Cumple |
| RS-03 | Autenticación | Los intentos fallidos bloquean la cuenta de forma progresiva | 5, 15 y 60 minutos (CHANGELOG, «bloqueo progresivo») | Cumple |
| RS-04 | Autorización | [completar] |  |  |
| RS-05 | Autorización | [completar] |  |  |
| RS-06 | Autorización | [completar] |  |  |
| RS-07 | Datos personales | [completar] |  |  |
| RS-08 | Datos personales | [completar] |  |  |
| RS-09 | Datos personales | [completar] |  |  |
| RS-10 | Auditoría | [completar] |  |  |
| RS-11 | Auditoría | [completar] |  |  |
| RS-12 | Auditoría | [completar] |  |  |
| RS-13 | Cifrado | [completar] |  |  |
| RS-14 | Cifrado | [completar] |  |  |
| RS-15 | Cifrado | [completar] |  |  |
| RS-16 | Disponibilidad | [completar] |  |  |
| RS-17 | Disponibilidad | [completar] |  |  |
| RS-18 | Disponibilidad | [completar] |  |  |
| RS-19 | Registro de cuentas | [completar] |  |  |
| RS-20 | Registro de cuentas | [completar] |  |  |
| RS-21 | Registro de cuentas | [completar] |  |  |

## Cumplimiento normativo

| Norma (número exacto) | Artículo | Qué exige (en tus palabras) | Cómo lo cumple SIGET | Estado |
|---|---|---|---|---|
| Ley 83 de 2012 (gobierno electrónico) | Art. 4, num. 8 | Que la persona sepa en qué fase está su trámite y qué unidad lo atiende | Seguimiento del trámite y su historial (`docs/api.md`, «Trámites») | Cumple |
| [completar] |  |  |  |  |
| [completar] |  |  |  |  |
| [completar] |  |  |  |  |
