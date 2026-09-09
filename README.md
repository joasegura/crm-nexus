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
js/storage.js       Sincronizacion con /api/state (notas, estados, plantillas)
js/app.js           Lógica de la app
data/leads.json      Datos reales de clientes (NO se versiona, ver abajo)
data/leads.sample.json  Datos de muestra (sí se versiona, para demo/fallback)
api/leads.js        Serverless: lista de prospectos (solo lectura)
api/state.js        Serverless: estado de gestion compartido (lectura y escritura)
api/_lib.js         Auth compartida + cliente de Sheets
assets/nexus-logo.png  Logo
scripts/            Utilidades de datos (ver abajo)
```

## Scripts

```bash
npm run extract-leads   # crm-nexus.html -> data/leads.json + CSV para Sheets
npm run verify-leads    # confirma que el CSV reconstruye los mismos datos
npm run check-sheets    # prueba la conexión con Google Sheets y diagnostica
npm test                # tests de /api/state contra una planilla falsa
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
   service account con permiso de **Editor**. (Con **Lector** alcanza si solo
   querés leer los prospectos, pero el estado compartido del equipo necesita
   escribir; ver "Trabajo en equipo" más abajo.)

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

## Trabajo en equipo (estado compartido)

El equipo de ventas trabaja desde el sitio y todo queda en la planilla: lo que
carga uno lo ve el resto. Un vendedor puede empezar a contactar un prospecto y
otro seguir desde donde quedó.

**Qué se comparte** (pestaña `Gestion`, se crea sola):

```
ID | Estado | Notas | Escrito | Volver | Plantilla | Quien | Cuando
```

Las plantillas de mensajes van en la pestaña `Config`, también compartidas.
Los datos del prospecto (nombre, teléfono, CUIT, email) siguen siendo **solo
lectura** desde el sitio: se editan en la planilla, así nadie rompe la base
sin querer.

**Quién hizo qué**: la primera vez, cada persona escribe su nombre. Queda
guardado en su navegador y se registra en cada prospecto que toca, visible
para todos como "Ana · hace 10 min".

### Requisitos adicionales

Además de lo de arriba, el estado compartido necesita dos cosas:

1. **La service account tiene que ser Editor**, no Lector. En la planilla:
   `Compartir` → el `client_email` → cambiar de Lector a **Editor**. Sin esto
   el sitio muestra "La service account necesita permiso de Editor".
2. **Una contraseña de equipo**, en Vercel:

   | Variable | Valor |
   |---|---|
   | `CRM_PASSWORD` | La clave que compartís con el equipo de ventas |

   Sin `CRM_PASSWORD` el sitio queda **abierto**: cualquiera con el link ve
   los datos de tus clientes y puede editarlos. La app no muestra login en ese
   caso, para no dejar al equipo frente a una pantalla que no puede pasar.

### Cómo se resuelven los choques

Se escribe **una fila por vez**: dos personas sobre prospectos distintos nunca
se pisan. Sobre el *mismo* prospecto gana el último que guarda, por eso cada
fila registra quién y cuándo.

El sitio se refresca solo cada 25 segundos (y al volver a la pestaña), pero
nunca pisa el prospecto que tengas abierto mientras lo editás.

Las notas se guardan al dejar de escribir, no en cada tecla: Google permite
unas 60 escrituras por minuto y así no se agota la cuota.

### Tests

```bash
npm test
```

Corre `/api/state` contra una planilla falsa en memoria: verifica que las
pestañas se creen solas, que editar un prospecto no toque las filas vecinas
(un error de índice ahí escribiría el estado de uno sobre otro), que el
import masivo mezcle bien altas y updates, y que sin contraseña no se pueda
leer ni escribir.

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
