#!/usr/bin/env node
/* Extrae los prospectos embebidos en el crm-nexus.html original y genera:
     data/leads.json                     -> fallback local (NO se versiona)
     prospectos-para-google-sheets.csv   -> para importar en Google Sheets

   Uso:  node scripts/extract-leads.js [ruta-al-crm-nexus.html]
   Por defecto busca ../crm-nexus.html (al lado de la carpeta del proyecto). */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const source = process.argv[2] || path.join(root, '..', 'crm-nexus.html');

if (!fs.existsSync(source)) {
  console.error('No encuentro el HTML original en: ' + source);
  process.exit(1);
}

const html = fs.readFileSync(source, 'utf8');
const match = html.match(/<script id="data" type="application\/json">([\s\S]*?)<\/script>/);
if (!match) {
  console.error('No encontré el bloque <script id="data"> en ' + source);
  process.exit(1);
}

const leads = JSON.parse(match[1]);

// data/leads.json: mismo formato que consume api/leads.js como fallback.
const outJson = path.join(root, 'data', 'leads.json');
fs.writeFileSync(outJson, JSON.stringify(leads, null, 0) + '\n', 'utf8');

/* CSV para Sheets. Las columnas tienen que coincidir con lo que parsea
   api/leads.js: ID, Comercio, Contacto, CUIT, Direccion, Ciudad, Provincia,
   Lista, Grupo, Telefonos, Emails. */
const HEAD = ['ID', 'Comercio', 'Contacto', 'CUIT', 'Direccion', 'Ciudad',
  'Provincia', 'Lista', 'Grupo', 'Telefonos', 'Emails'];

// Un teléfono es [raw, formateado, ok]; ok=0 se exporta con " ?" al final.
function phones(list) {
  return (list || []).map(t => (Array.isArray(t) ? t : [t, t, 1]))
    .map(([, formatted, ok]) => (ok ? formatted : formatted + ' ?'))
    .join(' / ');
}

const rows = [HEAD].concat(leads.map(l => [
  l.i || '', l.c || '', l.n || '', l.q || '', l.d || '', l.y || '',
  l.p || '', l.l || '', l.g || '', phones(l.t), (l.m || []).join(' / '),
]));

// BOM + separador ";" para que Sheets/Excel en es-AR lo abran bien.
const csv = '﻿' + rows
  .map(r => r.map(c => '"' + String(c == null ? '' : c).replace(/"/g, '""') + '"').join(';'))
  .join('\n');

const outCsv = path.join(root, '..', 'prospectos-para-google-sheets.csv');
fs.writeFileSync(outCsv, csv, 'utf8');

const conTel = leads.filter(l => (l.t || []).length).length;
const conMail = leads.filter(l => (l.m || []).length).length;
console.log('Prospectos extraídos: ' + leads.length);
console.log('  con teléfono: ' + conTel + '   con email: ' + conMail);
console.log('Escrito: ' + outJson);
console.log('Escrito: ' + outCsv);
