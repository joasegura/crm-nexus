/* Estado de gestión compartido por el equipo, guardado en Google Sheets.

   GET  /api/state          -> { db, tpl, quienes }
   POST /api/state          -> guarda UNA cosa por vez:
        { op:'lead', id, rec, quien }   una fila de la pestaña Gestion
        { op:'tpl',  tpl, quien }       las plantillas de mensajes

   Se escribe por fila a propósito: dos vendedores trabajando sobre leads
   distintos no se pisan. Sobre el MISMO lead, gana el último que guarda; por
   eso cada fila registra quién y cuándo. */
const L = require('./_lib.js');

// Columnas: ID, Estado, Notas, Escrito, Volver, Plantilla, Quien, Cuando
function filaARec(r) {
  return {
    e: r[1] || 'nuevo',
    n: r[2] || '',
    t: r[3] || '',
    f: r[4] || '',
    tpl: r[5] || '',
    by: r[6] || '',
    at: r[7] || '',
  };
}

function recAFila(id, rec, quien) {
  return [
    id,
    rec.e || 'nuevo',
    rec.n || '',
    rec.t || '',
    rec.f || '',
    rec.tpl || '',
    quien || '',
    new Date().toISOString(),
  ];
}

function leerBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch (e) { return null; }
  }
  return new Promise(resolve => {
    let raw = '';
    req.on('data', c => { raw += c; });
    req.on('end', () => { try { resolve(JSON.parse(raw)); } catch (e) { resolve(null); } });
  });
}

async function cargar(sheets) {
  const gestion = L.quoteTab(L.TAB_GESTION);
  const config = L.quoteTab(L.TAB_CONFIG);
  const { data } = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: L.SHEET_ID,
    ranges: [gestion + '!A2:H', config + '!A2:D'],
  });
  const filasGestion = (data.valueRanges[0] || {}).values || [];
  const filasConfig = (data.valueRanges[1] || {}).values || [];

  const db = {};
  const quienes = new Set();
  for (const r of filasGestion) {
    if (!r[0]) continue;
    db[r[0]] = filaARec(r);
    if (r[6]) quienes.add(r[6]);
  }

  let tpl = null;
  for (const r of filasConfig) {
    if (r[0] === 'tpl' && r[1]) {
      try { tpl = JSON.parse(r[1]); } catch (e) { /* config corrupta, la ignoramos */ }
    }
  }
  return { db, tpl, quienes: [...quienes].sort() };
}

/* Busca en qué fila está el ID y actualiza esa sola; si no está, la agrega.
   Dos llamadas a la API (leer la columna de IDs + escribir), que es el precio
   de no reescribir la planilla entera en cada cambio. */
async function guardarFila(sheets, tab, clave, valores) {
  const t = L.quoteTab(tab);
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId: L.SHEET_ID,
    range: t + '!A2:A',
  });
  const ids = (data.values || []).map(r => r[0]);
  const idx = ids.indexOf(clave);

  if (idx === -1) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: L.SHEET_ID,
      range: t + '!A2',
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [valores] },
    });
    return { fila: ids.length + 2, nueva: true };
  }
  const fila = idx + 2; // +1 por el encabezado, +1 porque las filas arrancan en 1
  await sheets.spreadsheets.values.update({
    spreadsheetId: L.SHEET_ID,
    range: t + '!A' + fila,
    valueInputOption: 'RAW',
    requestBody: { values: [valores] },
  });
  return { fila, nueva: false };
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  if (!L.autorizado(req, res)) return;

  if (!L.SHEET_ID) {
    return res.status(503).json({
      error: 'sin-sheet',
      mensaje: 'Falta GOOGLE_SHEET_ID: el estado compartido necesita la planilla.',
    });
  }

  try {
    const sheets = L.getSheets({ write: true });
    await L.asegurarTabs(sheets, [
      { title: L.TAB_GESTION, cols: L.COLS_GESTION },
      { title: L.TAB_CONFIG, cols: L.COLS_CONFIG },
    ]);

    if (req.method === 'GET') {
      const estado = await cargar(sheets);
      return res.status(200).json(Object.assign({ ok: true }, estado));
    }

    if (req.method === 'POST') {
      const body = await leerBody(req);
      if (!body || !body.op) {
        return res.status(400).json({ error: 'body', mensaje: 'Falta "op" en el cuerpo.' });
      }
      const quien = String(body.quien || '').slice(0, 60);

      if (body.op === 'lead') {
        if (!body.id) return res.status(400).json({ error: 'body', mensaje: 'Falta "id".' });
        const r = await guardarFila(
          sheets, L.TAB_GESTION, String(body.id), recAFila(String(body.id), body.rec || {}, quien)
        );
        return res.status(200).json({ ok: true, id: body.id, quien, at: new Date().toISOString(), fila: r.fila });
      }

      /* Importar un respaldo toca cientos de leads. Una petición por lead
         reventaría la cuota de Google (~60 escrituras/minuto), así que
         resolvemos todo en dos llamadas: un batchUpdate para las filas que ya
         existen y un append para las nuevas. */
      if (body.op === 'bulk') {
        const db = body.db || {};
        const ids = Object.keys(db);
        if (!ids.length) return res.status(200).json({ ok: true, escritos: 0 });

        const t = L.quoteTab(L.TAB_GESTION);
        const { data } = await sheets.spreadsheets.values.get({
          spreadsheetId: L.SHEET_ID,
          range: t + '!A2:A',
        });
        const existentes = (data.values || []).map(r => r[0]);
        const posicion = new Map(existentes.map((id, k) => [id, k + 2]));

        const actualizar = [];
        const agregar = [];
        for (const id of ids) {
          const valores = recAFila(id, db[id] || {}, quien);
          if (posicion.has(id)) actualizar.push({ range: t + '!A' + posicion.get(id), values: [valores] });
          else agregar.push(valores);
        }

        if (actualizar.length) {
          await sheets.spreadsheets.values.batchUpdate({
            spreadsheetId: L.SHEET_ID,
            requestBody: { valueInputOption: 'RAW', data: actualizar },
          });
        }
        if (agregar.length) {
          await sheets.spreadsheets.values.append({
            spreadsheetId: L.SHEET_ID,
            range: t + '!A2',
            valueInputOption: 'RAW',
            insertDataOption: 'INSERT_ROWS',
            requestBody: { values: agregar },
          });
        }
        return res.status(200).json({
          ok: true, escritos: ids.length,
          actualizados: actualizar.length, agregados: agregar.length,
        });
      }

      if (body.op === 'tpl') {
        await guardarFila(sheets, L.TAB_CONFIG, 'tpl', [
          'tpl', JSON.stringify(body.tpl || {}), quien, new Date().toISOString(),
        ]);
        return res.status(200).json({ ok: true, quien });
      }

      return res.status(400).json({ error: 'op', mensaje: 'op desconocida: ' + body.op });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'metodo', mensaje: 'Usá GET o POST.' });
  } catch (err) {
    console.error('Error en /api/state:', err.message);
    const permisos = /permission|forbidden|403|The caller does not have permission/i.test(err.message);
    return res.status(500).json({
      error: permisos ? 'permisos' : 'sheets',
      mensaje: permisos
        ? 'La service account necesita permiso de Editor en la planilla (hoy es Lector).'
        : String(err.message).slice(0, 300),
    });
  }
};
