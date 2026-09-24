# frontend

React + Vite + Tailwind CSS + shadcn/ui (SPA). Pendiente de implementación — Fase 2 del proyecto.

## Stack definido

- React + Vite
- Tailwind CSS + shadcn/ui
- Consume la API de `backend/` vía DRF (CORS con allowlist exacta al origen, nunca `*`)
- Manejo de tokens: access token en memoria (nunca `localStorage`), refresh token en cookie `httpOnly`, `Secure`, `SameSite=Strict`
- Servido detrás de nginx (mismo pod que Django en VM1), con TLS termination y cabeceras HSTS/CSP/X-Frame-Options

## Estructura esperada (convención estándar Vite + React)

```
frontend/
├── package.json
├── vite.config.ts
├── src/
│   ├── components/
│   ├── pages/
│   ├── hooks/
│   ├── lib/          # cliente API, utilidades
│   └── App.tsx
└── public/
```

## Por qué no está el checkpoint PHP acá

El checkpoint de login/gestión de usuarios entregado hasta ahora es HTML+PHP server-rendered (sin frontend separado) — una solución rápida para un pedido puntual, no el frontend definitivo del proyecto. Este directorio es donde va la SPA real en React.
