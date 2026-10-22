# frontend

SPA de SIGET en **React 18 + Vite** (JavaScript y CSS propios). Se compila a archivos estáticos que sirve el mismo nginx del pod de VM1, así que API y interfaz comparten origen (sin CORS).

## Reglas de seguridad que cumple

- El token de acceso vive **solo en memoria** (nunca `localStorage`); el de refresco va en una cookie `HttpOnly; Secure; SameSite=Strict` que JavaScript no puede leer. La renovación es de un solo uso, por eso se serializa (`src/api.js`) y no se usa `StrictMode`.
- **Sin estilos en línea ni scripts en línea**: la CSP de nginx es `default-src 'self'`.
- La interfaz solo *muestra* módulos y botones; cada acción la vuelve a autorizar el servidor (PDP + RLS). Un botón mostrado de más no abre ningún acceso.
- Las acciones sensibles piden un código reciente del segundo factor (modal de reautenticación).

## Estructura

```
src/
├── api.js          # cliente: token en memoria, renovación única, errores tipados
├── App.jsx         # sesión, menú por módulos y navegación
├── Acceso.jsx      # login, registro y enrolamiento del segundo factor (QR)
├── Tramites.jsx    # mis trámites, nuevo, bandeja/supervisión, detalle con historial
├── Otras.jsx       # inicio, equipo, mi seguridad, acceso a trámites, «próximamente»
├── comun.jsx       # etiquetas, estados, reautenticación
└── estilos.css
```

## Desarrollo y construcción

```bash
npm install
npm run dev      # http://localhost:5173, con proxy a https://192.168.159.137:8443 (SIGET_API para cambiarlo)
npm run build    # genera dist/, que se copia a /home/siget/frontend en VM1 (runbook sección 27.6)
```

## Por qué no está el checkpoint PHP acá

El checkpoint de login/gestión de usuarios entregado hasta ahora es HTML+PHP server-rendered: una solución intermedia que se retira en la semana 6. Esta SPA es el frontend definitivo.
