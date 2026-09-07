# CRM Nexus

CRM de prospectos y clientes para ATOM Soluciones IT. Antes vivía como un único
archivo HTML (`crm-nexus.html`, con los datos reales de clientes embebidos
inline); esta es la versión reestructurada para desplegar en Vercel.
`crm-nexus.html` sigue en el disco por las dudas, pero está en `.gitignore`
porque tiene la misma información sensible que `data/leads.json`.

## Estructura

```
index.html         Markup de la app
css/styles.css      Estilos
js/storage.js       Persistencia local (notas, estados, plantillas)
js/app.js           Lógica de la app
data/leads.json      Datos reales de clientes (NO se versiona, ver abajo)
data/leads.sample.json  Datos de muestra (sí se versiona, para demo/fallback)
api/leads.js        Función serverless que sirve la lista de prospectos
assets/nexus-logo.png  Logo
```

## Datos de clientes

`data/leads.json` contiene información real (nombres, teléfonos, CUIT,
emails) y está en `.gitignore`: nunca se sube al repositorio. Para desarrollo
local, generá o copiá ese archivo con el mismo formato que
`data/leads.sample.json`.

Si ese archivo no existe (por ejemplo, en un deploy fresco desde GitHub),
`api/leads.js` sirve `data/leads.sample.json` como fallback para que el sitio
no se rompa.

## Conectar Google Sheets (próximo paso)

El único lugar que hay que tocar es `api/leads.js`: hoy lee un archivo local,
más adelante debería llamar a la API de Google Sheets (paquete `googleapis`)
usando credenciales de una service account guardadas como variables de
entorno en Vercel (`Project Settings → Environment Variables`), nunca en el
repo. El front-end (`js/app.js`) ya pide los datos con
`fetch('/api/leads')`, así que no necesita cambios.

Si más adelante también querés que las notas/estados de cada prospecto vivan
en Sheets (hoy quedan en `localStorage` del navegador vía `js/storage.js`),
se puede sumar un endpoint similar (`api/state.js`) y actualizar `js/storage.js`
para llamarlo en vez de `localStorage`.

## Desarrollo local

```bash
npm install -g vercel   # una sola vez
vercel dev
```

`vercel dev` sirve `index.html` y ejecuta `api/leads.js` como función
serverless, igual que en producción.

## Deploy

1. Crear un repositorio en GitHub y pushear este proyecto (sin
   `data/leads.json`, que queda excluido).
2. Importar el repo en [vercel.com/new](https://vercel.com/new). Vercel
   detecta `index.html` y la carpeta `api/` automáticamente, sin
   configuración adicional.
3. Cada push a la rama principal dispara un deploy nuevo.
