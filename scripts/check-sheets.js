#!/usr/bin/env node
/* Prueba la conexión con Google Sheets y diagnostica qué falta o qué falla.

   Tres formas de darle las credenciales, de más cómoda a menos:

   1) Apuntando al JSON de la service account (no hay que copiar la clave):
        node scripts/check-sheets.js ../mi-clave.json <GOOGLE_SHEET_ID>

   2) Con un archivo .env en la raíz del proyecto (lo que baja
      `vercel env pull .env` si algún día instalás el CLI).

   3) Con variables de entorno sueltas, igual que en Vercel:
        GOOGLE_SHEET_ID, GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY

   Ojo: las variables cargadas en Vercel NO están en tu máquina. Este script
   corre local, así que necesita alguna de las tres opciones de arriba. */
const fs = require('fs');
const path = require('path');

/* Parser de .env que soporta valores entre comillas repartidos en varias
   líneas (así escribe `vercel env pull` una clave privada con saltos
   reales). No interpreta escapes: deja el valor tal cual, que es lo que
   necesitamos para una private_key con "\n" literales. */
function loadEnvFile(file) {
  const text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  let i = 0;
  while (i < text.length) {
    const nl = text.indexOf('\n', i);
    const lineEnd = nl === -1 ? text.length : nl;
    const line = text.slice(i, lineEnd);
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) { i = lineEnd + 1; continue; }
    const key = m[1];
    const rest = m[2];
    const quote = rest[0];
    let value;
    if (quote === '"' || quote === "'") {
      const start = i + line.indexOf(quote) + 1;
      const close = text.indexOf(quote, start);
      const end = close === -1 ? text.length : close;
      value = text.slice(start, end);
      const after = text.indexOf('\n', end);
      i = after === -1 ? text.length : after + 1;
    } else {
      value = rest.replace(/\s+#.*$/, '').trim();
      i = lineEnd + 1;
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

const root = path.join(__dirname, '..');
const args = process.argv.slice(2);

// Un argumento que termina en .json son las credenciales; el otro, el ID.
const jsonArg = args.find(a => a.toLowerCase().endsWith('.json'))
  || process.env.GOOGLE_APPLICATION_CREDENTIALS;
const idArg = args.find(a => a !== jsonArg);

const envPath = path.join(root, '.env');
if (fs.existsSync(envPath)) {
  loadEnvFile(envPath);
  console.log('(leyendo variables de .env)');
}

if (jsonArg) {
  const p = path.resolve(process.cwd(), jsonArg);
  if (!fs.existsSync(p)) {
    console.error('No encuentro el JSON de credenciales en: ' + p);
    process.exit(1);
  }
  let cred;
  try {
    cred = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    console.error('El archivo no es JSON válido: ' + e.message);
    process.exit(1);
  }
  if (!cred.client_email || !cred.private_key) {
    console.error('Ese JSON no parece una clave de service account:');
    console.error('le faltan "client_email" y/o "private_key".');
    process.exit(1);
  }
  process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = cred.client_email;
  process.env.GOOGLE_PRIVATE_KEY = cred.private_key;
  console.log('(credenciales desde ' + path.basename(p) + ')');
}
if (idArg) process.env.GOOGLE_SHEET_ID = idArg;

const faltan = ['GOOGLE_SHEET_ID', 'GOOGLE_SERVICE_ACCOUNT_EMAIL', 'GOOGLE_PRIVATE_KEY']
  .filter(k => !process.env[k]);
if (faltan.length) {
  console.error('\nFaltan: ' + faltan.join(', '));
  console.error('\nLas variables que cargaste en Vercel viven allá, no en tu máquina:');
  console.error('este script corre local y no las ve. La forma más simple de probar:');
  console.error('\n  node scripts/check-sheets.js ruta/al/clave.json <GOOGLE_SHEET_ID>\n');
  process.exit(1);
}

const { google } = require('googleapis');

function normalizeRange(range) {
  const cut = range.lastIndexOf('!');
  if (cut === -1) return range;
  const sheet = range.slice(0, cut);
  const cells = range.slice(cut + 1);
  if (sheet.startsWith("'") || !/\s/.test(sheet)) return range;
  return "'" + sheet.replace(/'/g, "''") + "'!" + cells;
}

const range = normalizeRange(process.env.GOOGLE_SHEET_RANGE || "'Hoja 1'!A2:K");

(async () => {
  const auth = new google.auth.JWT(
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    null,
    (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    ['https://www.googleapis.com/auth/spreadsheets.readonly']
  );
  const sheets = google.sheets({ version: 'v4', auth });

  // 1) Metadatos: confirma que la service account tiene acceso al archivo.
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    fields: 'properties.title,sheets.properties.title',
  });
  const hojas = meta.data.sheets.map(s => s.properties.title);
  console.log('\nPlanilla: ' + meta.data.properties.title);
  console.log('Hojas: ' + hojas.map(t => '"' + t + '"').join(', '));
  console.log('Rango usado: ' + range);

  // Avisamos antes de leer si el nombre de hoja del rango no existe.
  const hojaDelRango = range.includes('!')
    ? range.slice(0, range.lastIndexOf('!')).replace(/^'|'$/g, '').replace(/''/g, "'")
    : null;
  if (hojaDelRango && !hojas.includes(hojaDelRango)) {
    console.error('\nOjo: no existe una hoja llamada "' + hojaDelRango + '".');
    console.error('Renombrá la pestaña, o cargá GOOGLE_SHEET_RANGE con una de las de arriba.');
  }

  // 2) Los datos en sí.
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range,
  });
  const rows = (data.values || []).filter(r => r[1]);
  console.log('\nFilas con Comercio: ' + rows.length);
  if (!rows.length) {
    console.log('No vino ninguna fila: revisá que el rango apunte a la hoja correcta.');
    process.exit(1);
  }
  console.log('Primera: ' + rows[0].slice(0, 3).join(' | '));
  console.log('Última:  ' + rows[rows.length - 1].slice(0, 3).join(' | '));
  console.log('\nConexión OK.');
})().catch(err => {
  console.error('\nFalló: ' + err.message);
  if (/Unable to parse range/i.test(err.message)) {
    console.error('El nombre de hoja del rango no coincide, o tiene espacios sin');
    console.error("comillas simples. Ej: 'Hoja 1'!A2:K");
  } else if (/not found/i.test(err.message)) {
    console.error('Revisá GOOGLE_SHEET_ID (la parte de la URL entre /d/ y /edit).');
  } else if (/permission|forbidden|403/i.test(err.message)) {
    console.error('Compartí la planilla con ' + process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL);
    console.error('como Lector (botón "Compartir" arriba a la derecha).');
  } else if (/invalid_grant|DECODER|PEM|private key|unregistered callers/i.test(err.message)) {
    console.error('La autenticación no salió: la clave privada está mal copiada,');
    console.error('incompleta o fue revocada. Probá generando una clave nueva.');
  } else if (/API has not been used|disabled/i.test(err.message)) {
    console.error('Habilitá la Google Sheets API en el proyecto de Google Cloud.');
  }
  process.exit(1);
});
