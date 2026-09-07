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

## Google Sheets

`api/leads.js` ya sabe leer la lista de prospectos desde una Google Sheet. Si
no configurás nada, sigue funcionando como antes (lee `data/leads.json` o
`data/leads.sample.json` local). El front-end no cambia: siempre pide
`fetch('/api/leads')`.

### 1. Armar la planilla

Se generó `prospectos-para-google-sheets.csv` (en el Escritorio, al lado de
esta carpeta) con tus 530 registros reales, en las columnas que espera el
código:

```
ID | Comercio | Contacto | CUIT | Direccion | Ciudad | Provincia | Lista | Grupo | Telefonos | Emails
```

- **Telefonos**: varios números separados por `/`, cada uno con formato
  `+549...`. Un `?` al final de un número (ej. `+5491100000000 ?`) lo marca
  como "revisar" (dudoso).
- **Emails**: varios separados por `/`.
- **ID**: identificador estable (ej. `C000`). Si agregás una fila nueva a
  mano, dejalo vacío: el código genera uno automáticamente. No reordenes
  filas con ID ya asignado, porque las notas guardadas en el navegador están
  atadas a ese ID.

En Google Sheets: `Archivo → Importar → Subir` ese CSV, como hoja nueva o
reemplazando el contenido de una hoja llamada "Hoja 1" (el nombre de la hoja
tiene que coincidir con `GOOGLE_SHEET_RANGE`, ver abajo).

### 2. Crear la service account

1. En [Google Cloud Console](https://console.cloud.google.com/), creá un
   proyecto (o usá uno existente) y habilitá la **Google Sheets API**.
2. `IAM y administración → Cuentas de servicio → Crear cuenta de servicio`.
   No necesita ningún rol de proyecto.
3. Generá una clave: `Claves → Agregar clave → JSON` y descargala. Ahí
   adentro está `client_email` y `private_key`.
4. Abrí la Google Sheet, tocá "Compartir" y agregá el `client_email` de la
   service account con permiso de **Lector**.

### 3. Variables de entorno en Vercel

En `Project Settings → Environment Variables` del proyecto en Vercel:

| Variable | Valor |
|---|---|
| `GOOGLE_SHEET_ID` | El ID de la planilla (la parte de la URL entre `/d/` y `/edit`) |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | El `client_email` del JSON de la service account |
| `GOOGLE_PRIVATE_KEY` | El `private_key` del JSON, tal cual (con los `\n`) |
| `GOOGLE_SHEET_RANGE` | Opcional. Por defecto `Hoja 1!A2:K` |

Volvé a desplegar (o esperá el próximo push) para que tomen efecto. Si algo
falla al leer la Sheet, `api/leads.js` cae de vuelta a los datos locales y
loguea el error en Vercel (`Deployments → Functions → Logs`), en vez de
romper el sitio.

### Notas y estado de cada prospecto

Por ahora siguen guardándose en `localStorage` del navegador de cada
persona (vía `js/storage.js`), no en Sheets. Si más adelante varias personas
necesitan ver el mismo progreso, se puede sumar un endpoint de escritura
(`api/state.js`) y otra hoja para eso — es un paso aparte porque implica
manejar escrituras concurrentes.

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
