# Identidad visual de SIGET

## La idea

SIGET es la puerta por la que la ciudadanía panameña llega a sus trámites. La identidad sale de un objeto propio de Panamá y no de un cliché de portal de gobierno: la **mola**, el arte textil del pueblo guna, hecha de capas superpuestas y de contornos que se repiten como un eco. Esa técnica dice lo mismo que el producto: **un trámite avanza por capas y cada capa deja su huella**.

- **Portada:** la bandera de Panamá bordada como una mola. Cuatro campos con contornos en eco, dos estrellas y una franja de dientes en el borde. Al cargar, los contornos se dibujan uno tras otro (se respeta «reducir movimiento»).
- **Logo:** una estrella (la de la bandera) con contornos en eco, sobre el azul petróleo de la plataforma.

> La mola es un patrimonio vivo del pueblo guna. La portada la cita como inspiración y lo dice en pantalla («Inspirada en la mola, el arte textil del pueblo guna»); no reproduce ningún diseño tradicional concreto.

## Archivos

| Archivo | Para qué |
|---|---|
| `logo-siget.svg` | Marca sola (estrella), cuadrada. Para avatares, favicon y cualquier lugar pequeño |
| `logo-siget-horizontal.svg` | Marca con el nombre y el lema. Para documentos y presentaciones (usa las fuentes Archivo y Public Sans si están instaladas) |
| `../../frontend/src/assets/mola-panama.svg` | La bandera en mola de la portada |
| `../../frontend/src/assets/favicon.svg` | Icono de la pestaña |
| `generar_identidad.py` | Genera todo lo anterior. `python docs/identidad/generar_identidad.py` |

## Color

| Nombre | Hex | Uso |
|---|---|---|
| Azul petróleo | `#0f4c5c` | Fondo de la marca y color principal de la plataforma |
| Naranja boya | `#f26b21` | La estrella del logo y el acento de la interfaz |
| Amarillo mola | `#f6b81f` | Contornos y detalles |
| Crema | `#f4ead2` | Campos claros y contornos del logo |
| Rojo bandera | `#d2203f` | Estrella y campo rojo de la bandera (no es el rojo de error) |
| Azul bandera | `#1b57a5` | Estrella y campo azul de la bandera |

Los rojos y azules de la bandera aparecen **solo en la ilustración**. En la interfaz el rojo sigue significando error y el naranja, acento.

## Tipografía

Archivo (titulares, ancho expandido, peso 800), Public Sans (texto) e IBM Plex Mono (etiquetas y datos). Las tres se sirven desde el propio servidor: la política de seguridad no permite CDN.

## Uso del logo

- Espacio libre alrededor: al menos un cuarto del ancho de la marca.
- Tamaño mínimo: 16 px en pantalla (el favicon). Por debajo, la estrella pierde sus contornos y queda solo la silueta, que es lo esperado.
- No girar, no cambiar los colores, no poner sombra, no estirar y no usar sobre fondos que compitan con el azul petróleo.
