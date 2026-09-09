const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
// Ojo: en notación A1, un nombre de hoja con espacios va entre comillas
// simples ('Hoja 1'!A2:K). Sin comillas la API responde "Unable to parse
// range" y caíamos al fallback local como si todo estuviera bien.
const SHEET_RANGE = process.env.GOOGLE_SHEET_RANGE || "'Hoja 1'!A2:K";

// La columna "Telefonos" guarda cada número formateado (+549...), separados
// por " / "; un " ?" al final de un número marca "revisar" (dudoso).
function parsePhones(cell) {
  if (!cell) return [];
  return cell.split('/').map(s => s.trim()).filter(Boolean).map(entry => {
    const dudoso = entry.endsWith('?');
    const formatted = (dudoso ? entry.slice(0, -1) : entry).trim();
    const raw = formatted.replace(/^\+/, '');
    return [raw, formatted, dudoso ? 0 : 1];
  });
}

function parseEmails(cell) {
  if (!cell) return [];
  return cell.split('/').map(s => s.trim()).filter(Boolean);
}

// Si el rango viene de la env var con un nombre de hoja con espacios y sin
// comillas ("Hoja 1!A2:K"), lo arreglamos en vez de fallar.
function normalizeRange(range) {
  const cut = range.lastIndexOf('!');
  if (cut === -1) return range;
  const sheet = range.slice(0, cut);
  const cells = range.slice(cut + 1);
  if (sheet.startsWith("'") || !/\s/.test(sheet)) return range;
  return "'" + sheet.replace(/'/g, "''") + "'!" + cells;
}

async function fetchFromSheet() {
  /* Ojo: la forma posicional new JWT(email, null, key, scopes) dejó de
     funcionar en google-auth-library 10.x. No tira error: devuelve un cliente
     sin email ni clave, la petición sale sin autenticar y Google responde
     "Method doesn't allow unregistered callers". Hay que usar el objeto. */
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const sheets = google.sheets({ version: 'v4', auth });
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: normalizeRange(SHEET_RANGE),
  });
  const rows = data.values || [];
  // Columnas: ID, Comercio, Contacto, CUIT, Direccion, Ciudad, Provincia, Lista, Grupo, Telefonos, Emails
  return rows.filter(r => r[1]).map((r, idx) => ({
    i: r[0] || ('R' + (idx + 2)),
    c: r[1] || '',
    n: r[2] || '',
    q: r[3] || '',
    d: r[4] || '',
    y: r[5] || '',
    p: r[6] || '',
    l: r[7] || '',
    g: r[8] || '',
    t: parsePhones(r[9]),
    m: parseEmails(r[10]),
  }));
}

function fallback() {
  const realPath = path.join(process.cwd(), 'data', 'leads.json');
  const samplePath = path.join(process.cwd(), 'data', 'leads.sample.json');
  const file = fs.existsSync(realPath) ? realPath : samplePath;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/* Describe la FORMA de las variables de entorno, nunca su contenido: sirve
   para diagnosticar un fallo de auth sin exponer la clave privada. */
function diagnostico() {
  const partes = [];

  partes.push('id=' + (SHEET_ID ? 'ok' : 'FALTA'));

  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '';
  partes.push('email=' + (!email ? 'FALTA'
    : /^[^@\s"']+@[^@\s"']+\.iam\.gserviceaccount\.com$/.test(email) ? 'ok'
    : 'FORMATO-RARO'));

  const key = process.env.GOOGLE_PRIVATE_KEY || '';
  if (!key) {
    partes.push('key=FALTA');
  } else {
    const k = [];
    k.push('len' + key.length);
    if (/^["']|["']$/.test(key.trim())) k.push('CON-COMILLAS');
    if (!key.includes('BEGIN PRIVATE KEY')) k.push('SIN-BEGIN');
    if (!key.includes('END PRIVATE KEY')) k.push('SIN-END');
    // Tiene que haber saltos reales o "\n" literales; si no hay ninguno de
    // los dos, la clave llegó en una sola línea y no va a poder parsearse.
    if (!key.includes('\n') && !key.includes('\\n')) k.push('SIN-SALTOS');
    partes.push('key=' + k.join('/'));
  }

  partes.push('range=' + (process.env.GOOGLE_SHEET_RANGE ? 'puesto' : 'default'));
  return partes.join(' ');
}

/* La cabecera X-Leads-Source dice de dónde salieron los datos:
     sheet         -> se leyó la Google Sheet
     local         -> no hay GOOGLE_SHEET_ID configurado
     local-error   -> se intentó leer la Sheet y falló (ver X-Leads-Error)
   Así un fallback silencioso se nota, en vez de parecer que la sync anda. */
module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (!SHEET_ID) {
    res.setHeader('X-Leads-Source', 'local');
    return res.status(200).json(fallback());
  }
  try {
    const leads = await fetchFromSheet();
    res.setHeader('X-Leads-Source', 'sheet');
    res.status(200).json(leads);
  } catch (err) {
    console.error('Error leyendo Google Sheets, usando fallback local:', err.message);
    res.setHeader('X-Leads-Source', 'local-error');
    res.setHeader('X-Leads-Error', String(err.message).replace(/[^\x20-\x7E]/g, ' ').slice(0, 200));
    res.setHeader('X-Leads-Vars', diagnostico());
    res.status(200).json(fallback());
  }
};
