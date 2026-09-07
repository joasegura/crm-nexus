const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const SHEET_RANGE = process.env.GOOGLE_SHEET_RANGE || 'Hoja 1!A2:K';

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

async function fetchFromSheet() {
  const auth = new google.auth.JWT(
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    null,
    (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    ['https://www.googleapis.com/auth/spreadsheets.readonly']
  );
  const sheets = google.sheets({ version: 'v4', auth });
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: SHEET_RANGE,
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

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (!SHEET_ID) {
    return res.status(200).json(fallback());
  }
  try {
    res.status(200).json(await fetchFromSheet());
  } catch (err) {
    console.error('Error leyendo Google Sheets, usando fallback local:', err.message);
    res.status(200).json(fallback());
  }
};
