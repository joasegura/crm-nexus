let LEADS = [];
async function loadLeads(){
  const res = await fetch('/api/leads');
  LEADS = await res.json();
}

/* ---------- estados ---------- */
const ESTADOS = [
  {k:'nuevo',   t:'Sin contactar', c:'#8B9AAC'},
  {k:'cont',    t:'Contactado',    c:'#0B5C9D'},
  {k:'resp',    t:'Respondió',     c:'#6D4AD6'},
  {k:'reunion', t:'Reunión',       c:'#C2740A'},
  {k:'prop',    t:'Propuesta',     c:'#C0316F'},
  {k:'cliente', t:'Cliente',       c:'#128B4F'},
  {k:'desc',    t:'No interesa',   c:'#C8323C'}
];
const EST = Object.fromEntries(ESTADOS.map(e=>[e.k,e]));

/* ---------- plantillas ---------- */
const TPL_DEF = {
  presenta: {
    nombre:'Presentación',
    txt:`Hola {nombre}, ¿cómo estás? Te escribo de ATOM Soluciones IT.

Trabajamos con comercios como {comercio} ordenando el stock, las ventas y la caja en un solo sistema. Se llama Nexus y está hecho para PyMEs argentinas: sabés qué se vende, qué te falta reponer y cuánta plata entra, sin planillas sueltas ni cuentas a mano.

Si querés te lo muestro funcionando en una videollamada de 15 minutos, sin compromiso.

¿Qué día de esta semana te queda cómodo?`
  },
  corto: {
    nombre:'Corto',
    txt:`Hola {nombre}, te escribo de ATOM Soluciones IT. Trabajamos con comercios como {comercio} ordenando stock, ventas y caja en un solo sistema propio, Nexus. ¿Te interesa que te muestre cómo funciona en 15 minutos?`
  },
  segui: {
    nombre:'Seguimiento',
    txt:`Hola {nombre}, ¿cómo va? Te había escrito por Nexus, el sistema de gestión que armamos en ATOM para comercios como {comercio}.

Te dejo la puerta abierta: si esta semana tenés 15 minutos, te lo muestro funcionando y vos decidís.

¿Te sirve algún día en particular?`
  },
  cierre: {
    nombre:'Cierre',
    txt:`Hola {nombre}, quedamos en que te mostraba Nexus funcionando en tu {comercio}.

Tengo lugar esta semana. ¿Te queda mejor mañana a la mañana o a la tarde?`
  }
};
let TPL = JSON.parse(JSON.stringify(TPL_DEF));
let tplActiva = 'presenta';

/* ---------- estado guardado ---------- */
let DB = {};          // { id: {e, n, f, t, w} }
const KEY = 'crm-nexus-v1';
let saveTimer = null;

async function load(){
  try{
    const r = await window.storage.get(KEY);
    if(r && r.value){
      const d = JSON.parse(r.value);
      DB = d.db || {};
      if(d.tpl) TPL = Object.assign(JSON.parse(JSON.stringify(TPL_DEF)), d.tpl);
    }
  }catch(e){ /* primera vez, sin datos guardados */ }
}
function save(){
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async ()=>{
    try{ await window.storage.set(KEY, JSON.stringify({db:DB, tpl:TPL})); }
    catch(e){ toast('No se pudo guardar. Exportá un respaldo por las dudas.'); }
  }, 400);
}
function rec(id){ if(!DB[id]) DB[id] = {e:'nuevo', n:'', f:'', t:'', w:0}; return DB[id]; }

/* ---------- helpers ---------- */
function toast(m){
  const t = document.getElementById('toast');
  t.textContent = m; t.classList.add('show');
  clearTimeout(t._h); t._h = setTimeout(()=>t.classList.remove('show'), 2200);
}
function primerNombre(l){
  const n = (l.n||'').trim();
  if(!n) return '';
  if(n.toLowerCase() === (l.c||'').toLowerCase()) return '';
  const p = n.split(' ')[0];
  return p.length > 2 ? p : n.split(' ').slice(0,2).join(' ');
}
function armarMensaje(l, clave){
  const pn = primerNombre(l);
  let t = TPL[clave||tplActiva].txt;
  t = pn ? t.replace(/\{nombre\}/g, pn)
         : t.replace(/\{nombre\}/g, '').replace(/ +,/g, ',').replace(/  +/g, ' ');
  t = t.replace(/\{comercio\}/g, l.c || 'tu comercio');
  t = t.replace(/\{ciudad\}/g, l.y || 'tu ciudad');
  return t;
}
function hoy(){ return new Date().toISOString().slice(0,10); }
function fechaCorta(f){ if(!f) return ''; const [a,m,d]=f.split('-'); return d+'/'+m; }

/* ---------- filtros ---------- */
let filtro = {q:'', prov:'', lista:'', est:'', pend:false, sinTel:false};
let visibles = 60;

function pasa(l){
  const r = rec(l.i);
  if(filtro.est && r.e !== filtro.est) return false;
  if(filtro.prov && l.p !== filtro.prov) return false;
  if(filtro.lista && l.l !== filtro.lista) return false;
  if(filtro.sinTel && l.t.length) return false;
  if(filtro.pend){
    if(!r.f) return false;
    if(r.f > hoy()) return false;
  }
  if(filtro.q){
    const s = (l.c+' '+l.n+' '+l.y+' '+l.p+' '+l.d+' '+l.t.map(x=>x[0]).join(' ')).toLowerCase();
    if(!s.includes(filtro.q)) return false;
  }
  return true;
}

/* ---------- render ---------- */
const $list = document.getElementById('list');

function render(){
  const arr = LEADS.filter(pasa);
  document.getElementById('tot').textContent = arr.length + ' de ' + LEADS.length;
  document.getElementById('empty').hidden = arr.length > 0;
  const slice = arr.slice(0, visibles);
  $list.innerHTML = slice.map(fila).join('');
  const more = document.getElementById('more');
  more.hidden = arr.length <= visibles;
  more.textContent = 'Mostrar más (' + (arr.length - visibles) + ' restantes)';
  stats();
}

function fila(l){
  const r = rec(l.i), e = EST[r.e] || EST.nuevo;
  const abierto = l.i === abiertoId;
  const dudoso = l.t.some(t=>!t[2]);
  const linea2 = [l.y, l.p].filter(Boolean).join(', ');
  const tels = l.t.map(t=>t[1]).join(' · ');
  const pend = r.f ? ('<span class="tag">Volver el ' + fechaCorta(r.f) + '</span>') : '';
  const cont = r.t ? ('<span class="tag">Escrito el ' + fechaCorta(r.t) + '</span>') : '';

  let botones = '';
  if(l.t.length === 1){
    botones = '<button class="wa" data-wa="'+l.i+'" data-tel="'+l.t[0][0]+'">Enviar WhatsApp</button>';
  }else if(l.t.length > 1){
    botones = l.t.map((t,k)=>'<button class="wa multi" data-wa="'+l.i+'" data-tel="'+t[0]+'">WhatsApp '+(k+1)+'</button>').join('');
  }else{
    botones = '<span class="tag rev">Sin teléfono</span>';
  }
  const mail = l.m.length ? '<button class="mini" data-mail="'+l.i+'">Mail</button>' : '';

  return `
  <div class="row${r.e==='desc'?' done':''}">
    <div class="who">
      <div class="name"><span class="dot" style="background:${e.c}"></span>${esc(l.c)}</div>
      <div class="meta">${l.n && l.n!==l.c ? '<em>'+esc(l.n)+'</em> · ' : ''}${esc(linea2)}${tels ? ' · '+esc(tels) : ''}</div>
      <div class="tags">
        <span class="tag" style="color:${e.c};border-color:${e.c}55;background:${e.c}12">${e.t}</span>
        <span class="tag">${esc(l.l)}</span>
        ${cont}${pend}
        ${dudoso ? '<span class="tag rev">Revisar número</span>' : ''}
      </div>
    </div>
    <div class="acts">
      ${botones}${mail}
      <button class="mini${abierto?' on':''}" data-open="${l.i}">${abierto?'Cerrar':'Notas'}</button>
    </div>
    ${abierto ? panel(l, r) : ''}
  </div>`;
}

function panel(l, r){
  const sts = ESTADOS.map(s=>`<button class="st${r.e===s.k?' on':''}" data-st="${l.i}|${s.k}" style="${r.e===s.k?'background:'+s.c+';border-color:'+s.c:''}">${s.t}</button>`).join('');
  const tpls = Object.keys(TPL).map(k=>`<button class="chip${k===tplActiva?' on dim':''}" data-tpl2="${l.i}|${k}">${TPL[k].nombre}</button>`).join('');
  return `
  <div class="panel">
    <div>
      <div class="lbl">Estado</div>
      <div class="states">${sts}</div>
    </div>
    <div class="grid2">
      <div>
        <div class="lbl">Notas</div>
        <textarea data-nota="${l.i}" placeholder="Qué contestó, qué usa hoy, cuándo volver a llamar">${esc(r.n)}</textarea>
      </div>
      <div>
        <div class="lbl">Volver a escribirle</div>
        <input type="date" data-fecha="${l.i}" value="${r.f}">
        <div class="lbl" style="margin-top:12px">Mensaje a enviar</div>
        <div class="chips" style="padding:0">${tpls}</div>
      </div>
    </div>
    ${l.d ? '<div class="meta">'+esc(l.d)+(l.q?' · CUIT '+esc(l.q):'')+'</div>' : ''}
    ${l.m.length ? '<div class="meta">'+l.m.map(esc).join(' · ')+'</div>' : ''}
    <div class="prev">${esc(armarMensaje(l, r.tpl || tplActiva))}</div>
  </div>`;
}

function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

/* ---------- stats ---------- */
function stats(){
  const c = {nuevo:0,cont:0,resp:0,reunion:0,prop:0,cliente:0,desc:0};
  LEADS.forEach(l=>{ c[rec(l.i).e]++; });
  document.getElementById('s-nuevo').textContent = c.nuevo;
  document.getElementById('s-cont').textContent  = c.cont;
  document.getElementById('s-resp').textContent  = c.resp;
  document.getElementById('s-reu').textContent   = c.reunion + c.prop;
  document.getElementById('s-cli').textContent   = c.cliente;
  document.getElementById('s-desc').textContent  = c.desc;
  const tot = LEADS.length;
  document.getElementById('bar').innerHTML = ESTADOS.map(s=>{
    const w = (c[s.k]/tot*100);
    return w ? `<i style="width:${w}%;background:${s.k==='nuevo'?'#DDE4EC':s.c}"></i>` : '';
  }).join('');
}

/* ---------- eventos ---------- */
let abiertoId = null;

document.addEventListener('click', e=>{
  const b = e.target.closest('button');
  if(!b) return;

  if(b.dataset.wa){
    const l = LEADS.find(x=>x.i===b.dataset.wa);
    const r = rec(l.i);
    const txt = armarMensaje(l, r.tpl || tplActiva);
    window.open('https://wa.me/' + b.dataset.tel + '?text=' + encodeURIComponent(txt), '_blank');
    if(r.e === 'nuevo'){ r.e = 'cont'; }
    r.w = 1; r.t = hoy();
    save(); render();
    return;
  }
  if(b.dataset.mail){
    const l = LEADS.find(x=>x.i===b.dataset.mail);
    const r = rec(l.i);
    const txt = armarMensaje(l, r.tpl || tplActiva);
    location.href = 'mailto:' + l.m.join(',') + '?subject=' + encodeURIComponent('Nexus · sistema de gestión para ' + (l.c||'tu comercio')) + '&body=' + encodeURIComponent(txt);
    if(r.e === 'nuevo'){ r.e = 'cont'; r.t = hoy(); }
    save(); render();
    return;
  }
  if(b.dataset.open){
    abiertoId = (abiertoId === b.dataset.open) ? null : b.dataset.open;
    render(); return;
  }
  if(b.dataset.st){
    const [id,k] = b.dataset.st.split('|');
    const r = rec(id); r.e = k;
    if(k!=='nuevo' && !r.t) r.t = hoy();
    save(); render(); return;
  }
  if(b.dataset.tpl2){
    const [id,k] = b.dataset.tpl2.split('|');
    rec(id).tpl = k; save(); render(); return;
  }
  if(b.dataset.chip !== undefined){
    const v = b.dataset.chip;
    if(v==='pend'){ filtro.pend = !filtro.pend; filtro.est=''; filtro.sinTel=false; }
    else if(v==='sintel'){ filtro.sinTel = !filtro.sinTel; filtro.pend=false; filtro.est=''; }
    else { filtro.est = (filtro.est===v ? '' : v); filtro.pend=false; filtro.sinTel=false; }
    visibles = 60; chips(); render(); return;
  }
  if(b.id==='more'){ visibles += 60; render(); return; }
});

document.addEventListener('input', e=>{
  const t = e.target;
  if(t.dataset.nota){ rec(t.dataset.nota).n = t.value; save(); }
  if(t.dataset.fecha){ rec(t.dataset.fecha).f = t.value; save(); }
});

document.addEventListener('change', e=>{
  if(e.target.dataset.fecha){ rec(e.target.dataset.fecha).f = e.target.value; save(); render(); }
});

document.getElementById('q').addEventListener('input', e=>{
  filtro.q = e.target.value.trim().toLowerCase(); visibles = 60; render();
});

/* ---------- chips y selects ---------- */
function chips(){
  const cont = document.getElementById('chips');
  const base = ESTADOS.map(s=>`<button class="chip${filtro.est===s.k?' on':''}" data-chip="${s.k}">${s.t}</button>`).join('');
  cont.innerHTML = base +
    `<button class="chip${filtro.pend?' on':''}" data-chip="pend">Para hoy</button>` +
    `<button class="chip${filtro.sinTel?' on':''}" data-chip="sintel">Sin teléfono</button>`;
}
function selects(){
  const provs = [...new Set(LEADS.map(l=>l.p).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'es'));
  const listas = [...new Set(LEADS.map(l=>l.l))];
  const fp = document.getElementById('f-prov');
  fp.innerHTML = '<option value="">Todas las provincias</option>' + provs.map(p=>`<option>${esc(p)}</option>`).join('');
  fp.onchange = ()=>{ filtro.prov = fp.value; visibles=60; render(); };
  const fl = document.getElementById('f-lista');
  fl.innerHTML = '<option value="">Todas las listas</option>' + listas.map(p=>`<option>${esc(p)}</option>`).join('');
  fl.onchange = ()=>{ filtro.lista = fl.value; visibles=60; render(); };
}

/* ---------- modal mensajes ---------- */
const modal = document.getElementById('modal');
document.getElementById('btn-msg').onclick = ()=>{ modal.classList.add('open'); pintaTpl(); };
modal.addEventListener('click', e=>{ if(e.target===modal) modal.classList.remove('open'); });
function pintaTpl(){
  document.getElementById('tpl-tabs').innerHTML = Object.keys(TPL).map(k=>
    `<button class="chip${k===tplActiva?' on':''}" data-tab="${k}">${TPL[k].nombre}</button>`).join('');
  document.getElementById('tpl-text').value = TPL[tplActiva].txt;
  previewTpl();
}
function previewTpl(){
  const l = LEADS.find(x=>x.n && x.c) || LEADS[0];
  const pn = primerNombre(l);
  let t = document.getElementById('tpl-text').value;
  t = (pn ? t.replace(/\{nombre\}/g, pn) : t.replace(/\{nombre\}/g,'').replace(/ +,/g,',').replace(/  +/g,' '))
        .replace(/\{comercio\}/g, l.c).replace(/\{ciudad\}/g, l.y||'');
  document.getElementById('tpl-prev').textContent = 'Vista previa con ' + l.c + ':\n\n' + t;
}
document.getElementById('tpl-text').addEventListener('input', previewTpl);
document.getElementById('tpl-tabs').addEventListener('click', e=>{
  const b = e.target.closest('[data-tab]'); if(!b) return;
  TPL[tplActiva].txt = document.getElementById('tpl-text').value;
  tplActiva = b.dataset.tab; pintaTpl();
});
document.getElementById('tpl-save').onclick = ()=>{
  TPL[tplActiva].txt = document.getElementById('tpl-text').value;
  save(); modal.classList.remove('open'); render(); toast('Mensaje guardado');
};
document.getElementById('tpl-reset').onclick = ()=>{
  TPL[tplActiva].txt = TPL_DEF[tplActiva].txt; pintaTpl(); toast('Mensaje restaurado');
};

/* ---------- exportar / importar ---------- */
document.getElementById('btn-exp').onclick = ()=>{
  const filas = [['Comercio','Contacto','Ciudad','Provincia','Telefonos','Emails','Lista','Estado','Escrito','Volver','Notas']];
  LEADS.forEach(l=>{
    const r = rec(l.i);
    filas.push([l.c,l.n,l.y,l.p,l.t.map(t=>t[1]).join(' / '),l.m.join(' / '),l.l,(EST[r.e]||EST.nuevo).t,r.t||'',r.f||'',(r.n||'').replace(/\n/g,' ')]);
  });
  const csv = '﻿' + filas.map(f=>f.map(c=>'"'+String(c==null?'':c).replace(/"/g,'""')+'"').join(';')).join('\n');
  baja(new Blob([csv],{type:'text/csv;charset=utf-8'}), 'prospectos-nexus-'+hoy()+'.csv');
  baja(new Blob([JSON.stringify({db:DB,tpl:TPL},null,1)],{type:'application/json'}), 'respaldo-crm-nexus-'+hoy()+'.json');
  toast('Descargué el CSV y el respaldo');
};
function baja(blob, nombre){
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = nombre; a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href), 4000);
}
document.getElementById('btn-imp').onclick = ()=>document.getElementById('file').click();
document.getElementById('file').onchange = e=>{
  const f = e.target.files[0]; if(!f) return;
  const rd = new FileReader();
  rd.onload = ()=>{
    try{
      const d = JSON.parse(rd.result);
      DB = Object.assign(DB, d.db||{});
      if(d.tpl) TPL = Object.assign(TPL, d.tpl);
      save(); render(); toast('Respaldo importado');
    }catch(err){ toast('Ese archivo no es un respaldo válido'); }
  };
  rd.readAsText(f);
};

/* ---------- arranque ---------- */
(async ()=>{
  await loadLeads();
  await load();
  chips(); selects(); render();
})();
