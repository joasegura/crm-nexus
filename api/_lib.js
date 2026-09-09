/* Utilidades compartidas por los endpoints. Vercel ignora como ruta a los
   archivos de api/ que empiezan con "_", así que esto no queda expuesto. */
const crypto = require('crypto');
const { google } = require('googleapis');

const SHEET_ID = process.env.GOOGLE_SHEET_ID;

// Pestaña de prospectos (solo lectura) y pestañas de trabajo compartido.
const TAB_GESTION = process.env.GOOGLE_SHEET_TAB_GESTION || 'Gestion';
const TAB_CONFIG = process.env.GOOGLE_SHEET_TAB_CONFIG || 'Config';

const COLS_GESTION = ['ID', 'Estado', 'Notas', 'Escrito', 'Volver', 'Plantilla', 'Quien', 'Cuando'];
const COLS_CONFIG = ['Clave', 'Valor', 'Quien', 'Cuando'];

/* En notación A1 un nombre de hoja con espacios va entre comillas simples.
   Sin eso la API responde "Unable to parse range". */
function quoteTab(title) {
  return /^[A-Za-z0-9_]+$/.test(title) ? title : "'" + String(title).replace(/'/g, "''") + "'";
}

function normalizeRange(range) {
  const cut = range.lastIndexOf('!');
  if (cut === -1) return range;
  const sheet = range.slice(0, cut);
  const cells = range.slice(cut + 1);
  if (sheet.startsWith("'") || !/\s/.test(sheet)) return range;
  return quoteTab(sheet) + '!' + cells;
}

/* Contraseña compartida del equipo. Si CRM_PASSWORD no está configurada, el
   sitio queda abierto: lo avisamos en la respuesta para que no pase
   inadvertido. */
function passwordConfigurada() {
  return !!(process.env.CRM_PASSWORD && process.env.CRM_PASSWORD.length);
}

function comparaSegura(a, b) {
  const A = Buffer.from(String(a || ''), 'utf8');
  const B = Buffer.from(String(b || ''), 'utf8');
  // timingSafeEqual exige el mismo largo; comparamos hashes para no filtrarlo.
  const ha = crypto.createHash('sha256').update(A).digest();
  const hb = crypto.createHash('sha256').update(B).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/* Devuelve true si la petición puede seguir. Si no, ya respondió 401. */
function autorizado(req, res) {
  if (!passwordConfigurada()) return true;
  const enviada = req.headers['x-crm-auth'] || '';
  if (enviada && comparaSegura(enviada, process.env.CRM_PASSWORD)) return true;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.status(401).json({ error: 'auth', mensaje: 'Contraseña incorrecta o faltante.' });
  return false;
}

function getSheets({ write } = {}) {
  /* Ojo: la forma posicional new JWT(email, null, key, scopes) no funciona en
     google-auth-library 10.x — devuelve un cliente sin credenciales y la
     petición sale sin autenticar. Hay que usar el objeto. */
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    scopes: [write
      ? 'https://www.googleapis.com/auth/spreadsheets'
      : 'https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  return google.sheets({ version: 'v4', auth });
}

/* Crea la pestaña con sus encabezados si todavía no existe, para que el
   equipo no tenga que armarlas a mano. Devuelve los títulos existentes. */
async function asegurarTabs(sheets, tabs) {
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: SHEET_ID,
    fields: 'sheets.properties.title',
  });
  const existentes = meta.data.sheets.map(s => s.properties.title);
  const faltantes = tabs.filter(t => !existentes.includes(t.title));
  if (!faltantes.length) return existentes;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: {
      requests: faltantes.map(t => ({ addSheet: { properties: { title: t.title } } })),
    },
  });
  // Encabezados, en una sola llamada.
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: {
      valueInputOption: 'RAW',
      data: faltantes.map(t => ({
        range: quoteTab(t.title) + '!A1',
        values: [t.cols],
      })),
    },
  });
  return existentes.concat(faltantes.map(t => t.title));
}

module.exports = {
  SHEET_ID, TAB_GESTION, TAB_CONFIG, COLS_GESTION, COLS_CONFIG,
  quoteTab, normalizeRange, autorizado, passwordConfigurada, getSheets, asegurarTabs,
};
