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
scripts/            Utilidades de datos (ver abajo)
```

## Scripts

```bash
npm run extract-leads   # crm-nexus.html -> data/leads.json + CSV para Sheets
npm run verify-leads    # confirma que el CSV reconstruye los mismos datos
npm run check-sheets    # prueba la conexión con Google Sheets y diagnostica
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

`npm run extract-leads` lee los datos embebidos en el `crm-nexus.html`
original y escribe dos archivos:

- `data/leads.json` — fallback local (no se versiona).
- `prospectos-para-google-sheets.csv` — en el Escritorio, al lado de esta
  carpeta: los 530 registros reales para importar en Sheets.

Después, `npm run verify-leads` confirma que ese CSV, leído con la misma
lógica que usa `api/leads.js`, reconstruye exactamente los mismos 530
prospectos (nada se pierde en el viaje HTML → CSV → Sheets → API).

Las columnas son las que espera el código:

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
tiene que coincidir con `GOOGLE_SHEET_RANGE`, ver abajo). El CSV usa `;` como
separador y viene con BOM, así que Sheets lo detecta solo; si pregunta, elegí
"Detectar automáticamente" o punto y coma.

### 2. Crear la service account

1. En [Google Cloud Console](https://console.cloud.google.com/), creá un
   proyecto (o usá uno existente) y habilitá la **Google Sheets API**.
2. `IAM y administración → Cuentas de servicio → Crear cuenta de servicio`.
   No necesita ningún rol de proyecto.
3. Generá la clave. Ojo: **no** es la pantalla `APIs y servicios →
   Credenciales`, que sirve para claves de API y OAuth; la clave de una
   service account está en una pestaña dentro de la cuenta misma:
   - `IAM y administración → Cuentas de servicio`
   - Clic en el **email de la cuenta de servicio** del paso 2 (abre su ficha)
   - Pestaña **Claves** → `Agregar clave → Crear clave nueva → JSON → Crear`
   - Se descarga un `.json`: adentro están `client_email` y `private_key`

   Ese JSON se descarga **una sola vez** (si lo perdés, generá una clave
   nueva y borrá la vieja) y es un secreto: guardalo fuera de esta carpeta.
4. Abrí la Google Sheet, tocá "Compartir" y agregá el `client_email` de la
   service account con permiso de **Lector**.

### 3. Variables de entorno en Vercel

En `Project Settings → Environment Variables` del proyecto en Vercel:

| Variable | Valor |
|---|---|
| `GOOGLE_SHEET_ID` | El ID de la planilla (la parte de la URL entre `/d/` y `/edit`) |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | El `client_email` del JSON de la service account |
| `GOOGLE_PRIVATE_KEY` | El `private_key` del JSON, tal cual (con los `\n`) |
| `GOOGLE_SHEET_RANGE` | Opcional. Por defecto `'Hoja 1'!A2:K` |

Ojo con `GOOGLE_SHEET_RANGE`: es el **nombre de la variable**, no algo que
se escribe en la planilla. Su **valor** es un rango en notación A1, con la
forma `NombreDeLaHoja!A2:K` (el `A2` saltea la fila de encabezados; la `K`
es la última columna, Emails). Ejemplo, si la pestaña se llama `Prospectos`:

```
GOOGLE_SHEET_RANGE = Prospectos!A2:K
```

Conviene ponerle a la pestaña un nombre **sin espacios**: en notación A1 un
nombre con espacios va entre comillas simples (`'Hoja 1'!A2:K`) y sin ellas
la API responde "Unable to parse range". El código corrige ese caso solo,
pero es un problema menos.

Volvé a desplegar (o esperá el próximo push) para que tomen efecto. Si algo
falla al leer la Sheet, `api/leads.js` cae de vuelta a los datos locales y
loguea el error en Vercel (`Deployments → Functions → Logs`), en vez de
romper el sitio.

### 4. Comprobar que la sync anda

**Las variables que cargás en Vercel viven en Vercel, no en tu máquina.**
`check-sheets` corre local, así que no las ve: hay que darle las credenciales
aparte. Lo más simple es apuntarlo al JSON de la service account, así no
copiás la clave privada a ningún lado:

```powershell
node scripts/check-sheets.js ..\mi-clave.json TU_GOOGLE_SHEET_ID
```

También acepta un `.env` en la raíz del proyecto (está en `.gitignore`), o
las variables sueltas en el entorno, si preferís alguna de esas.

Te dice el nombre de la planilla, qué hojas tiene, cuántas filas leyó y, si
falla, cuál de los cinco problemas típicos es (ID mal, planilla no
compartida, rango mal escrito, clave privada mal copiada, API sin habilitar).

Ya desplegado, la respuesta de `/api/leads` trae una cabecera
`X-Leads-Source` que dice de dónde salieron los datos: `sheet` (leyó la
planilla), `local` (no hay `GOOGLE_SHEET_ID`) o `local-error` (intentó leer y
falló; el motivo va en `X-Leads-Error`). Sirve para no confundir un fallback
silencioso con una sync que funciona:

```powershell
curl.exe -sI https://TU-PROYECTO.vercel.app/api/leads | findstr /i X-Leads
```

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
