#!/usr/bin/env node
/* Test de /api/state contra una planilla falsa en memoria.

   Lo que más importa verificar acá es la aritmética de filas del upsert: un
   error de índice no rompe nada visible, simplemente escribe el estado de un
   prospecto sobre la fila de otro.

   Uso: npm test */
const path = require('path');
const Module = require('module');

let fallos = 0;
let pruebas = 0;
function ok(cond, msg) {
  pruebas++;
  if (cond) { console.log('  ok   ' + msg); }
  else { console.log('  FALLA ' + msg); fallos++; }
}
function igual(a, b, msg) {
  const A = JSON.stringify(a), B = JSON.stringify(b);
  ok(A === B, msg + (A === B ? '' : '\n         esperado: ' + B + '\n         obtenido: ' + A));
}

/* ---------- planilla falsa ---------- */
function crearPlanilla(tabs) {
  const hojas = JSON.parse(JSON.stringify(tabs));
  const col = c => c.charCodeAt(0) - 65;

  function parseRange(range) {
    const m = range.match(/^'?([^'!]+)'?!([A-Z])(\d+)?(?::([A-Z])(\d*))?$/);
    if (!m) throw new Error('rango no soportado en el fake: ' + range);
    return { tab: m[1], c1: col(m[2]), f1: m[3] ? +m[3] : 1, c2: m[4] ? col(m[4]) : null };
  }
  function leer(range) {
    const r = parseRange(range);
    const filas = hojas[r.tab] || [];
    const out = [];
    for (let i = r.f1 - 1; i < filas.length; i++) {
      const fila = filas[i] || [];
      out.push(r.c2 === null ? fila.slice(r.c1, r.c1 + 1) : fila.slice(r.c1, r.c2 + 1));
    }
    while (out.length && out[out.length - 1].every(v => v === '' || v == null)) out.pop();
    return out;
  }
  function escribir(range, values) {
    const r = parseRange(range);
    if (!hojas[r.tab]) hojas[r.tab] = [];
    values.forEach((fila, k) => {
      const idx = r.f1 - 1 + k;
      while (hojas[r.tab].length <= idx) hojas[r.tab].push([]);
      hojas[r.tab][idx] = fila.slice();
    });
  }

  const api = {
    spreadsheets: {
      get: async ({ fields }) => ({
        data: {
          properties: { title: 'Planilla de prueba' },
          sheets: Object.keys(hojas).map(t => ({ properties: { title: t } })),
        },
      }),
      batchUpdate: async ({ requestBody }) => {
        for (const req of requestBody.requests || []) {
          if (req.addSheet) hojas[req.addSheet.properties.title] = [];
        }
        return { data: {} };
      },
      values: {
        get: async ({ range }) => ({ data: { values: leer(range) } }),
        batchGet: async ({ ranges }) => ({ data: { valueRanges: ranges.map(r => ({ values: leer(r) })) } }),
        update: async ({ range, requestBody }) => { escribir(range, requestBody.values); return { data: {} }; },
        batchUpdate: async ({ requestBody }) => {
          for (const d of requestBody.data) escribir(d.range, d.values);
          return { data: {} };
        },
        append: async ({ range, requestBody }) => {
          const r = parseRange(range);
          if (!hojas[r.tab]) hojas[r.tab] = [];
          for (const fila of requestBody.values) hojas[r.tab].push(fila.slice());
          return { data: {} };
        },
      },
    },
  };
  return { api, hojas };
}

/* ---------- carga state.js con googleapis mockeado ---------- */
function cargarHandler(planilla) {
  const real = Module._load;
  Module._load = function (pedido, padre, esMain) {
    if (pedido === 'googleapis') {
      return { google: { sheets: () => planilla.api, auth: { JWT: function () {} } } };
    }
    return real.apply(this, arguments);
  };
  for (const k of Object.keys(require.cache)) {
    if (k.includes('api') && (k.includes('state') || k.includes('_lib'))) delete require.cache[k];
  }
  const h = require(path.join(__dirname, '..', 'api', 'state.js'));
  Module._load = real;
  return h;
}

function llamar(handler, { method = 'GET', body = null, pass = null } = {}) {
  return new Promise(resolve => {
    const req = { method, headers: {}, body };
    if (pass !== null) req.headers['x-crm-auth'] = pass;
    const res = {
      _code: 0, _json: null, _headers: {},
      setHeader(k, v) { this._headers[k.toLowerCase()] = v; },
      status(c) { this._code = c; return this; },
      json(d) { this._json = d; resolve({ code: this._code, body: d, headers: this._headers }); return this; },
    };
    handler(req, res);
  });
}

(async () => {
  process.env.GOOGLE_SHEET_ID = 'fake';
  process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = 'x@y.iam.gserviceaccount.com';
  process.env.GOOGLE_PRIVATE_KEY = 'fake';
  delete process.env.CRM_PASSWORD;

  console.log('\n== Las pestañas se crean solas ==');
  {
    const p = crearPlanilla({ 'Hoja 1': [['ID', 'Comercio']] });
    const h = cargarHandler(p);
    const r = await llamar(h);
    ok(r.code === 200, 'GET responde 200 con la planilla vacía');
    ok(!!p.hojas['Gestion'], 'creó la pestaña Gestion');
    ok(!!p.hojas['Config'], 'creó la pestaña Config');
    igual(p.hojas['Gestion'][0], ['ID', 'Estado', 'Notas', 'Escrito', 'Volver', 'Plantilla', 'Quien', 'Cuando'],
      'Gestion tiene los encabezados correctos');
    igual(r.body.db, {}, 'db arranca vacío');
  }

  console.log('\n== Guardar un lead nuevo y releerlo ==');
  {
    const p = crearPlanilla({ 'Hoja 1': [['ID']], Gestion: [['ID', 'Estado', 'Notas', 'Escrito', 'Volver', 'Plantilla', 'Quien', 'Cuando']], Config: [['Clave', 'Valor']] });
    const h = cargarHandler(p);
    await llamar(h, { method: 'POST', body: { op: 'lead', id: 'C007', rec: { e: 'cont', n: 'Llamé, pidió mail', t: '2026-09-08' }, quien: 'Sofía' } });
    igual(p.hojas['Gestion'][1].slice(0, 5), ['C007', 'cont', 'Llamé, pidió mail', '2026-09-08', ''], 'la fila quedó en la posición 2');
    ok(p.hojas['Gestion'][1][6] === 'Sofía', 'guardó quién editó');
    const r = await llamar(h);
    ok(r.body.db.C007.e === 'cont', 'al releer vuelve el estado');
    ok(r.body.db.C007.by === 'Sofía', 'al releer vuelve el autor');
    igual(r.body.quienes, ['Sofía'], 'lista de personas del equipo');
  }

  console.log('\n== Editar un lead existente no toca a los vecinos ==');
  {
    const p = crearPlanilla({
      'Hoja 1': [['ID']],
      Gestion: [
        ['ID', 'Estado', 'Notas', 'Escrito', 'Volver', 'Plantilla', 'Quien', 'Cuando'],
        ['C001', 'cont', 'nota uno', '', '', '', 'Ana', ''],
        ['C002', 'resp', 'nota dos', '', '', '', 'Ana', ''],
        ['C003', 'nuevo', 'nota tres', '', '', '', 'Ana', ''],
      ],
      Config: [['Clave', 'Valor']],
    });
    const h = cargarHandler(p);
    await llamar(h, { method: 'POST', body: { op: 'lead', id: 'C002', rec: { e: 'cliente', n: 'CERRADO' }, quien: 'Bruno' } });
    igual(p.hojas['Gestion'][1].slice(0, 3), ['C001', 'cont', 'nota uno'], 'la fila de arriba quedó intacta');
    igual(p.hojas['Gestion'][2].slice(0, 3), ['C002', 'cliente', 'CERRADO'], 'se actualizó la fila correcta');
    igual(p.hojas['Gestion'][3].slice(0, 3), ['C003', 'nuevo', 'nota tres'], 'la fila de abajo quedó intacta');
    ok(p.hojas['Gestion'].length === 4, 'no se agregaron filas de más');
  }

  console.log('\n== Import masivo: mezcla actualizar y agregar ==');
  {
    const p = crearPlanilla({
      'Hoja 1': [['ID']],
      Gestion: [
        ['ID', 'Estado', 'Notas', 'Escrito', 'Volver', 'Plantilla', 'Quien', 'Cuando'],
        ['C001', 'cont', 'vieja', '', '', '', '', ''],
      ],
      Config: [['Clave', 'Valor']],
    });
    const h = cargarHandler(p);
    const r = await llamar(h, { method: 'POST', body: { op: 'bulk', quien: 'Ana', db: {
      C001: { e: 'cliente', n: 'nueva' },
      C009: { e: 'resp', n: 'agregado' },
    } } });
    ok(r.body.actualizados === 1 && r.body.agregados === 1, 'reporta 1 actualizado y 1 agregado');
    igual(p.hojas['Gestion'][1].slice(0, 3), ['C001', 'cliente', 'nueva'], 'actualizó el existente');
    igual(p.hojas['Gestion'][2].slice(0, 3), ['C009', 'resp', 'agregado'], 'agregó el nuevo al final');
  }

  console.log('\n== Plantillas compartidas ==');
  {
    const p = crearPlanilla({ 'Hoja 1': [['ID']], Gestion: [['ID']], Config: [['Clave', 'Valor', 'Quien', 'Cuando']] });
    const h = cargarHandler(p);
    await llamar(h, { method: 'POST', body: { op: 'tpl', tpl: { corto: { nombre: 'Corto', txt: 'Hola {nombre}' } }, quien: 'Ana' } });
    const r = await llamar(h);
    ok(r.body.tpl && r.body.tpl.corto.txt === 'Hola {nombre}', 'la plantilla vuelve al releer');
  }

  console.log('\n== Contraseña compartida ==');
  {
    process.env.CRM_PASSWORD = 'secreta123';
    const p = crearPlanilla({ 'Hoja 1': [['ID']], Gestion: [['ID']], Config: [['Clave']] });
    const h = cargarHandler(p);
    ok((await llamar(h, { pass: null })).code === 401, 'sin contraseña -> 401');
    ok((await llamar(h, { pass: 'otra' })).code === 401, 'contraseña incorrecta -> 401');
    ok((await llamar(h, { pass: 'secreta123' })).code === 200, 'contraseña correcta -> 200');
    ok((await llamar(h, { method: 'POST', pass: 'mala', body: { op: 'lead', id: 'X', rec: {} } })).code === 401,
      'no se puede escribir sin la contraseña');
    delete process.env.CRM_PASSWORD;
  }

  console.log('\n== Entradas inválidas ==');
  {
    const p = crearPlanilla({ 'Hoja 1': [['ID']], Gestion: [['ID']], Config: [['Clave']] });
    const h = cargarHandler(p);
    ok((await llamar(h, { method: 'POST', body: { op: 'lead', rec: {} } })).code === 400, 'POST lead sin id -> 400');
    ok((await llamar(h, { method: 'POST', body: {} })).code === 400, 'POST sin op -> 400');
    ok((await llamar(h, { method: 'POST', body: { op: 'inventada' } })).code === 400, 'op desconocida -> 400');
    ok((await llamar(h, { method: 'DELETE' })).code === 405, 'DELETE -> 405');
  }

  console.log('\n' + (fallos ? fallos + ' de ' + pruebas + ' FALLARON' : 'Las ' + pruebas + ' pruebas pasaron'));
  process.exit(fallos ? 1 : 0);
})();
