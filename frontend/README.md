# frontend

SPA de SIGET en **React 18 + Vite** (JavaScript y CSS propios). Se compila a archivos estáticos que sirve el mismo nginx del pod de VM1, así que API y interfaz comparten origen (sin CORS). El contrato con el backend está en [`docs/api.md`](../docs/api.md).

## Dirección de diseño: «el Canal»

Un trámite recorre etapas como un buque cruza las esclusas del Canal. De ahí salen la identidad y la pieza firma:

- **Pieza firma — el recorrido por esclusas** (`Esclusas` en `src/ui.jsx`): tres cámaras (Recepción, Tramitación, Resolución) y un dique lateral para la subsanación. El agua llena las etapas cumplidas, una boya naranja marca dónde está el trámite y, al resolverse, aparece el sello APROBADO o RECHAZADO. Es el estado del trámite hecho imagen, en el detalle y en la pantalla de acceso.
- **Paleta** (`src/estilos/tokens.css`): agua de Miraflores (`#0f4c5c`), hormigón frío, **boya naranja** `#f26b21` solo para «dónde está» y los plazos, verde y rojo de sello solo para resolver. Modo claro y «noche de puerto» (oscuro), que sigue la preferencia del sistema y se puede cambiar.
- **Tipografía autohospedada** (la CSP no permite CDN): **Archivo** en ancho expandido para títulos (rotulado de casco), **Public Sans** (la del sector público) para texto, **IBM Plex Mono** para números de trámite y políticas. Todas con licencia OFL, empaquetadas con la SPA.

## Reglas de seguridad que cumple

- El token de acceso vive **solo en memoria** (nunca `localStorage`); el de refresco va en una cookie `HttpOnly; Secure; SameSite=Strict`. La renovación es de un solo uso, por eso se serializa (`src/api.js`) y no se usa `StrictMode`.
- **Sin estilos ni scripts en línea** (la CSP de nginx es `default-src 'self'`): todo es CSS con clases; los valores dinámicos van en atributos SVG o en elementos nativos (`<progress>`). `frontend-ci` lo vigila.
- La interfaz solo *muestra* módulos y botones; cada acción la vuelve a autorizar el servidor (PDP + RLS).
- Las acciones sensibles piden un código reciente del segundo factor (modal de reautenticación).

## Estructura

```
src/
├── api.js              # cliente: token en memoria, renovación única, errores tipados
├── App.jsx             # sesión, armazón (menú lateral, barra superior) y navegación
├── Acceso.jsx          # login, registro y alta del segundo factor (QR)
├── Tramites.jsx        # mis trámites, nuevo, bandeja (lista y tablero), detalle con esclusas e historial
├── Otras.jsx           # inicio, equipo, mi seguridad (credencial), acceso a trámites, «próximamente»
├── Auditoria.jsx       # resumen con gráfico, decisiones, eventos de seguridad, actuaciones
├── Permisos.jsx        # roles y módulos, matriz de permisos, permisos de la base de datos, capas de defensa
├── Mfa.jsx             # segundo factor: cómo funciona, prueba en vivo (incluye reuso) y actividad propia
├── ui.jsx              # iconos propios, logo, esclusas, insignias, avisos, confirmaciones, esqueletos, estados vacíos, tema
├── comun.jsx           # etiquetas, estados, plazos, reautenticación
├── modulos.js          # cómo se agrupan y dibujan los módulos que manda el servidor
├── mock.js             # servidor de mentira SOLO para desarrollo (no entra en producción)
├── mock-datos/         # capturas REALES de /politicas/* (matriz y base de datos) para el simulador
├── pruebas/            # Vitest: api, comun, ui, pantallas por rol, permisos/MFA y seguridad del código
└── estilos/            # tokens.css, base.css, componentes.css, layout.css, pantallas.css
```

## Desarrollo

```bash
npm install
npm run dev      # http://localhost:5173 (proxy a https://192.168.159.137:8443; SIGET_API para cambiarlo)
npm run build    # genera dist/, que se copia a /home/siget/frontend en VM1 (runbook sección 27.6)
```

## Pruebas

```bash
npm test            # 113 pruebas (Vitest + Testing Library + axe), sin VM ni credenciales
npm run lint        # ESLint (hooks, `style=` prohibido por la CSP, sin eval)
npm run verificar   # lint + pruebas + build
```

Qué cubren: el cliente de la API y la sesión, el menú y los datos que ve cada rol, las acciones sobre un trámite (reautenticación, confirmación de estados finales, conflicto de interés), la matriz de permisos y los permisos de la base (con una captura real), el segundo factor, la accesibilidad con **axe** y la **seguridad del código** (CSP, sin token en el navegador, sin el simulador en producción). Si tocas una pantalla, agrega o ajusta su prueba en `src/pruebas/`.

Para refrescar la captura real de la matriz y de la base: `python demo-local/capturar_fixtures.py` (necesita las VMs encendidas y las cuentas de demostración).

### Ver cada pantalla sin la VM: modo de ejemplo

Con `npm run dev`, agrega `?mock` a la dirección y la interfaz usa datos de ejemplo (`src/mock.js`), sin backend ni credenciales:

| Dirección | Qué muestra |
|---|---|
| `http://localhost:5173/?mock` | Pantalla de acceso |
| `/?mock=ana.ciudadana` | Ciudadana: sus trámites y el flujo de nuevo trámite |
| `/?mock=fabio.mop` · `flor.mop` | Funcionario del MOP: bandeja, detalle, cambio de estado (pide código; `000000` lo rechaza) |
| `/?mock=saul.mop` | Supervisor: supervisión, tablero, reasignar, equipo |
| `/?mock=carla.mop` | Coordinadora: equipo, sin trámites |
| `/?mock=aldo.auditor` | Auditor: consola de auditoría |
| `/?mock=ines.infra` (y los demás roles de plataforma) | Consola «próximamente» y la prueba de acceso negado |
| `/?mock=enrolar` | Alta del segundo factor |
| Cualquier cuenta → «Roles y permisos» / «Segundo factor (MFA)» | Matriz de permisos, base de datos y prueba de MFA |

Es un servidor de mentira: no valida nada. El único que decide es el backend. Al editar un archivo, el recarga en caliente reinicia la sesión de ejemplo.

## Por qué no está el checkpoint PHP acá

El checkpoint de login/gestión de usuarios entregado hasta ahora es HTML+PHP server-rendered: una solución intermedia que se retira en la semana 6. Esta SPA es el frontend definitivo.
