#!/usr/bin/env node
/* Verifica que el CSV que subimos a Google Sheets, leído con la misma lógica
   que usa api/leads.js, reconstruya exactamente los mismos prospectos que
   data/leads.json. Sirve para detectar pérdidas de datos en el viaje
   HTML -> CSV -> Sheets -> API.

   Uso: node scripts/verify-roundtrip.js */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const csvPath = path.join(root, '..', 'prospectos-para-google-sheets.csv');
const jsonPath = path.join(root, 'data', 'leads.json');

// --- mismas funciones que api/leads.js ---
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

// Parser de CSV con comillas y separador ";" (lo que produce extract-leads).
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ';') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (ch !== '\r') field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const text = fs.readFileSync(csvPath, 'utf8').replace(/^﻿/, '');
const rows = parseCsv(text).slice(1); // sin encabezado

const fromCsv = rows.filter(r => r[1]).map((r, idx) => ({
  i: r[0] || ('R' + (idx + 2)),
  c: r[1] || '', n: r[2] || '', q: r[3] || '', d: r[4] || '',
  y: r[5] || '', p: r[6] || '', l: r[7] || '', g: r[8] || '',
  t: parsePhones(r[9]), m: parseEmails(r[10]),
}));

const original = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

// El original puede no traer todas las claves; normalizamos igual que arriba.
const norm = l => ({
  i: l.i || '', c: l.c || '', n: l.n || '', q: l.q || '', d: l.d || '',
  y: l.y || '', p: l.p || '', l: l.l || '', g: l.g || '',
  t: (l.t || []).map(t => [t[0], t[1], t[2]]), m: l.m || [],
});

let diffs = 0;
if (fromCsv.length !== original.length) {
  console.error(`Cantidad distinta: CSV ${fromCsv.length} vs JSON ${original.length}`);
  diffs++;
}
const n = Math.min(fromCsv.length, original.length);
for (let k = 0; k < n; k++) {
  const a = JSON.stringify(norm(original[k]));
  const b = JSON.stringify(norm(fromCsv[k]));
  if (a !== b && diffs < 10) {
    console.error('\nDiferencia en fila ' + (k + 2) + ':');
    console.error('  original: ' + a);
    console.error('  desde CSV: ' + b);
    diffs++;
  }
}

if (diffs === 0) {
  console.log('OK: los ' + original.length + ' prospectos sobreviven el viaje CSV -> API sin cambios.');
} else {
  console.error('\n' + diffs + ' diferencia(s) encontradas.');
  process.exit(1);
}
