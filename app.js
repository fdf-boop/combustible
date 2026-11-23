'use strict';
(() => {
const API = window.API_URL || '';
const VEH = [
  { name: 'Toyota', mode: 'num', img: 'rav4.jpg' },
  { name: 'Swift', mode: 'bar', img: 'swift.jpg' }
];
const FR = ['Vacío', '1/8', '1/4', '3/8', '1/2', '5/8', '3/4', '7/8', 'Lleno'];
const SEGC = ['#e5483a', '#e5483a', '#ff6b1a', '#ff6b1a', '#f2a516', '#2f86b0', '#1f6f97', '#0b4f6c'];
const $ = id => document.getElementById(id);
const pad = n => String(n).padStart(2, '0');
const now = new Date();
const iso = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const today = iso(now);
const dObj = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const fmtDay = s => dObj(s).toLocaleDateString('es-CL', { weekday: 'short', day: 'numeric', month: 'short' });
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const lvl = (v, m) => v == null ? '—' : m === 'num' ? Number(v).toLocaleString('es-CL') : FR[v];
const byDateDesc = (a, b) => b.d.localeCompare(a.d);

let S = { entries: [] }, ROL = null, PIN = '', lastJSON = '';
let F = { v: null, in: null, out: null }, mes = today.slice(0, 7), delArm = null, busy = false, M = null;
try { PIN = localStorage.getItem('pin') || ''; } catch (e) {}

/* ---------- servidor (Google Sheets) ---------- */
async function apiGet() {
  const r = await fetch(API + '?pin=' + encodeURIComponent(PIN) + '&t=' + Date.now());
  return r.json();
}
async function apiPost(body) {
  const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(Object.assign({ pin: PIN }, body)) });
  return r.json();
}
function fromSrv(e) {
  const v = VEH.findIndex(x => x.name === e.vehiculo);
  const m = e.tipo || (VEH[v] ? VEH[v].mode : 'bar');
  const p = x => { if (x === '' || x == null) return null; if (m === 'bar') { const i = FR.indexOf(String(x)); return i < 0 ? null : i; } const n = Number(String(x).replace(',', '.')); return isNaN(n) ? null : n; };
  return { d: e.fecha, v, m, in: p(e.recibido), out: p(e.entregado), note: e.nota || '' };
}
function toSrv(e) {
  const f = x => x == null ? '' : (e.m === 'bar' ? FR[x] : x);
  return { fecha: e.d, vehiculo: VEH[e.v].name, tipo: e.m, recibido: f(e.in), entregado: f(e.out), nota: e.note || '' };
}
function setEntries(list) {
  const j = JSON.stringify(list);
  if (j === lastJSON) return false;
  lastJSON = j;
  S.entries = list.map(fromSrv).filter(e => e.v >= 0 && /^\d{4}-\d{2}-\d{2}$/.test(e.d));
  return true;
}
function pushTrips(r) { window.APP.trips = (r && r.trips) || []; window.APP.cfg = (r && r.cfg) || null; if (window.Viajes) window.Viajes.update(window.APP.trips, ROL, window.APP.cfg); }
function stamp(txt) { $('sync').textContent = txt || 'Actualizado ' + new Date().toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' }); }

/* ---------- acceso ---------- */
function errMsg(r) {
  if (r.error === 'bloqueado') return 'Demasiados intentos fallidos. La app quedó bloqueada por 15 minutos.';
  if (r.error === 'pin') return 'El PIN no es correcto.' + (r.quedan ? ` Te ${r.quedan === 1 ? 'queda 1 intento' : 'quedan ' + r.quedan + ' intentos'}.` : '');
  return 'La planilla respondió con un error.';
}
function showLogin(msg) {
  $('main').hidden = true; $('login').hidden = false;
  const l = $('lmsg'); l.className = 'msg' + (msg ? ' err' : ''); l.textContent = msg || '';
}
function showMain() { $('login').hidden = true; $('main').hidden = false; }
function applyRole() {
  const ro = ROL !== 'editar';
  document.documentElement.classList.toggle('ro', ro);
  $('t-reg').textContent = ro ? 'Vehículos' : 'Registro del día';
  const a = $('aviso'); a.hidden = !ro;
  if (ro) a.textContent = 'Vista de solo lectura. Se actualiza sola cuando hay registros nuevos.';
}
async function entrar() {
  const p = $('pin').value.trim();
  if (!p) { showLogin('Escribe tu PIN.'); return; }
  $('entrar').disabled = true; $('lmsg').className = 'msg'; $('lmsg').textContent = 'Verificando…';
  PIN = p;
  try {
    const r = await apiGet();
    if (!r.ok) { PIN = ''; showLogin(errMsg(r)); return; }
    try { localStorage.setItem('pin', PIN); } catch (e) {}
    ROL = r.rol; lastJSON = ''; setEntries(r.entries || []);
    $('pin').value = ''; showMain(); applyRole(); drawAll(); pushTrips(r); stamp();
  } catch (e) { PIN = ''; showLogin('No se pudo conectar. Revisa tu internet o la dirección en config.js.'); }
  finally { $('entrar').disabled = false; }
}
function salir() { PIN = ''; ROL = null; try { localStorage.removeItem('pin'); } catch (e) {} pushTrips(null); showLogin(''); }
async function refresh() {
  if (!PIN || busy || M) return;
  try {
    const r = await apiGet();
    if (!r.ok) { if (r.error === 'pin') salir(); else if (r.error === 'bloqueado') stamp('Bloqueada 15 min por intentos fallidos'); return; }
    if (r.rol !== ROL) { ROL = r.rol; applyRole(); }
    if (setEntries(r.entries || [])) { drawVeh(); drawMes(); drawResumen(); drawHist(); }
    pushTrips(r); stamp();
  } catch (e) { stamp('Sin conexión'); }
}

/* ---------- formulario ---------- */
const curMode = () => F.v != null ? VEH[F.v].mode : 'bar';
const findEntry = d => S.entries.find(e => e.d === d);
const lastOf = i => S.entries.filter(e => e.v === i).sort(byDateDesc)[0];
const lastVehicle = () => { const s = [...S.entries].sort(byDateDesc); return s.length ? s[0].v : null; };

function arcPath(i) {
  const r = 78, cx = 100, cy = 100, a0 = Math.PI - i * Math.PI / 8 - 0.03, a1 = Math.PI - (i + 1) * Math.PI / 8 + 0.03;
  const p = a => (cx + r * Math.cos(a)).toFixed(1) + ' ' + (cy - r * Math.sin(a)).toFixed(1);
  return 'M' + p(a0) + 'A' + r + ' ' + r + ' 0 0 1 ' + p(a1);
}
function arcSVG(k) {
  const v = F[k];
  const segs = Array.from({ length: 8 }, (_, i) => `<path d="${arcPath(i)}" class="seg" data-g="${k}" data-l="${i + 1}" role="button" tabindex="0" aria-label="${FR[i + 1]}" stroke="${v != null && i < v ? SEGC[i] : 'var(--line)'}"/>`).join('');
  const needle = v != null ? `<g transform="rotate(${v * 22.5} 100 100)" class="needle"><line x1="100" y1="100" x2="40" y2="100"/></g>` : '';
  return `<svg viewBox="0 0 200 118" class="arc" role="group" aria-label="${k === 'in' ? 'Nivel al recibir' : 'Nivel al entregar'}">${segs}<text x="22" y="116" class="ax" text-anchor="middle">E</text><text x="178" y="116" class="ax" text-anchor="middle">F</text>${needle}<circle cx="100" cy="100" r="7" class="hub"/></svg>`;
}
function setB(k, m) { const b = $('v-' + k); b.textContent = F[k] == null ? 'Sin registrar' : lvl(F[k], m); b.className = 'gv' + (F[k] == null ? ' empty' : ''); }
function loadForm() {
  const e = findEntry($('fecha').value);
  F = e ? { v: e.v, in: e.in, out: e.out } : { v: F.v ?? lastVehicle(), in: null, out: null };
  $('nota').value = e ? e.note || '' : '';
  $('guardar').textContent = e ? 'Actualizar registro' : 'Guardar registro';
  drawForm();
}
function drawVeh() {
  $('veh').innerHTML = VEH.map((x, i) => { const l = lastOf(i); return `<button type="button" role="radio" aria-checked="${F.v === i}" data-v="${i}"><img class="photo" src="${x.img}" alt=""><span class="vn">${esc(x.name)}</span><span class="vl">${l ? 'Último: ' + fmtDay(l.d) : 'Sin registros aún'}</span></button>`; }).join('');
  $('manual').textContent = F.v != null ? 'Ingreso manual del ' + VEH[F.v].name : 'Ingreso manual';
}
function drawForm() {
  drawVeh();
  const m = curMode();
  for (const k of ['in', 'out']) {
    $('g-' + k).classList.toggle('num', m === 'num');
    $('arc-' + k).innerHTML = arcSVG(k);
    $('num-' + k).value = F[k] ?? '';
    setB(k, m);
  }
}
function months() { const set = new Set(S.entries.map(e => e.d.slice(0, 7))); set.add(today.slice(0, 7)); set.add(mes); return [...set].sort().reverse(); }
function drawMes() {
  $('mes').innerHTML = months().map(m => { const [y, mm] = m.split('-').map(Number); const t = new Date(y, mm - 1, 1).toLocaleDateString('es-CL', { month: 'long', year: 'numeric' }); return `<option value="${m}" ${m === mes ? 'selected' : ''}>${t}</option>`; }).join('');
}
function drawResumen() {
  const es = S.entries.filter(e => e.d.startsWith(mes)), tot = es.length;
  const tiles = VEH.map((x, i) => { const c = es.filter(e => e.v === i).length; return `<div class="tile"><img class="photo" src="${x.img}" alt=""><span class="n">${c}</span><span class="k">${c === 1 ? 'día' : 'días'} en ${esc(x.name)}</span><div class="bar"><i style="width:${tot ? Math.round(c / tot * 100) : 0}%"></i></div></div>`; }).join('');
  const pend = es.filter(e => e.in == null || e.out == null).length;
  $('resumen').innerHTML = `<div class="tiles">${tiles}</div>` + (pend ? `<p class="pend">${pend} ${pend === 1 ? 'día tiene' : 'días tienen'} un nivel sin registrar.</p>` : '');
}
function drawHist() {
  $('t-his').textContent = F.v != null ? 'Historial del ' + VEH[F.v].name : 'Historial';
  if (F.v == null) { $('hist').innerHTML = '<li class="e"><p class="emptyst">Toca un vehículo arriba para ver su historial.</p></li>'; return; }
  const es = S.entries.filter(e => e.d.startsWith(mes) && e.v === F.v).sort(byDateDesc);
  if (!es.length) { $('hist').innerHTML = `<li class="e"><p class="emptyst">Aún no hay registros del ${esc(VEH[F.v].name)} en este mes.</p></li>`; return; }
  $('hist').innerHTML = es.map(e => {
    const d = dObj(e.d);
    const mini = e.m === 'num' ? '' : `<div class="mini" aria-hidden="true"><span><i style="width:${(e.in ?? 0) / 8 * 100}%"></i></span><span><i class="o" style="width:${(e.out ?? 0) / 8 * 100}%"></i></span></div>`;
    const acts = delArm === e.d ? `<button class="link danger" type="button" data-del="${e.d}">Sí, eliminar</button><button class="link" type="button" data-cancel="1">Cancelar</button>` : `<button class="link" type="button" data-edit="${e.d}">Editar</button><button class="link danger" type="button" data-arm="${e.d}">Eliminar</button>`;
    return `<li><div class="dd"><b>${d.getDate()}</b><span>${d.toLocaleDateString('es-CL', { weekday: 'short' }).replace('.', '')}</span></div><div><div class="lv">${lvl(e.in, e.m)}<span>→</span>${lvl(e.out, e.m)}</div>${mini}${e.note ? `<p class="note">${esc(e.note)}</p>` : ''}</div><div class="acts">${acts}</div></li>`;
  }).join('');
}
function drawAll() { loadForm(); drawMes(); drawResumen(); drawHist(); }
function pick(k, l) { F[k] = l; drawForm(); }

/* ---------- guardar ---------- */
async function saveEntries(list, okMsg, msgId) {
  const msg = $(msgId || 'msg');
  busy = true; msg.className = 'msg'; msg.textContent = 'Guardando…';
  $('guardar').disabled = true; $('msave').disabled = true;
  try {
    const r = await apiPost({ action: 'save', entries: list.map(toSrv) });
    if (!r.ok) throw new Error(r.error || 'error');
    lastJSON = ''; setEntries(r.entries || []);
    msg.textContent = okMsg; stamp();
    return true;
  } catch (e) {
    msg.className = 'msg err';
    msg.textContent = String(e.message) === 'pin' ? 'Tu PIN no permite registrar.' : 'No se pudo guardar. Revisa tu conexión e inténtalo de nuevo.';
    return false;
  } finally { busy = false; $('guardar').disabled = false; $('msave').disabled = false; }
}
async function borrar(d) {
  busy = true;
  try {
    const r = await apiPost({ action: 'delete', fecha: d });
    if (!r.ok) throw new Error(r.error);
    lastJSON = ''; setEntries(r.entries || []); delArm = null; drawAll(); stamp();
  } catch (e) { const m = $('msg'); m.className = 'msg err'; m.textContent = 'No se pudo eliminar. Inténtalo de nuevo.'; }
  finally { busy = false; }
}

/* ---------- ingreso manual ---------- */
function mfield(s, k, v, mode) {
  const lab = (k === 'in' ? 'Recibí' : 'Entregué') + ' el ' + s;
  if (mode === 'num') return `<input type="number" inputmode="decimal" step="any" min="0" data-mf="${k}" data-md="${s}" value="${v ?? ''}" placeholder="—" aria-label="${lab}">`;
  return `<select data-mf="${k}" data-md="${s}" aria-label="${lab}"><option value="">—</option>${FR.map((f, i) => `<option value="${i}" ${v === i ? 'selected' : ''}>${f}</option>`).join('')}</select>`;
}
function drawManual() {
  const v = F.v, mode = VEH[v].mode;
  $('mtitle').textContent = 'Ingreso manual · ' + VEH[v].name;
  const first = new Date(M.y, M.m, 1), days = new Date(M.y, M.m + 1, 0).getDate(), off = (first.getDay() + 6) % 7;
  $('mmes').textContent = first.toLocaleDateString('es-CL', { month: 'long', year: 'numeric' });
  $('mnext').disabled = M.y > now.getFullYear() || (M.y === now.getFullYear() && M.m >= now.getMonth());
  let cells = '<span></span>'.repeat(off);
  for (let d = 1; d <= days; d++) {
    const s = iso(new Date(M.y, M.m, d)), e = findEntry(s), on = M.sel.has(s);
    const cls = (on ? ' sel' : '') + (e ? (e.v === v ? ' mine' : ' other') : '');
    cells += `<button type="button" class="day${cls}" data-day="${s}" aria-pressed="${on}" ${s > today ? 'disabled' : ''}>${d}</button>`;
  }
  $('mcal').innerHTML = cells;
  const keys = [...M.sel.keys()].sort();
  $('mrows').innerHTML = keys.length ? `<div class="mrow h"><span>Día</span><span>Lo recibí con</span><span>Lo entregué con</span></div>` + keys.map(s => { const o = M.sel.get(s); return `<div class="mrow"><span class="md">${fmtDay(s)}</span>${mfield(s, 'in', o.in, mode)}${mfield(s, 'out', o.out, mode)}</div>`; }).join('') : '';
  const n = keys.length;
  $('msave').disabled = !n;
  $('msave').textContent = n ? `Guardar ${n} ${n === 1 ? 'día' : 'días'}` : 'Elige días';
}
function openManual() {
  if (F.v == null) { const m = $('msg'); m.className = 'msg err'; m.textContent = 'Primero toca el vehículo que quieres registrar.'; return; }
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  M = { y: d.getFullYear(), m: d.getMonth(), sel: new Map() };
  $('mmsg').textContent = '';
  $('sheet').hidden = false; document.body.style.overflow = 'hidden'; drawManual();
}
function closeManual() { $('sheet').hidden = true; document.body.style.overflow = ''; M = null; }
function toggleDay(s) {
  if (M.sel.has(s)) M.sel.delete(s);
  else { const e = findEntry(s); M.sel.set(s, e && e.v === F.v ? { in: e.in, out: e.out } : { in: null, out: null }); }
  drawManual();
}
async function saveManual() {
  const n = M.sel.size; if (!n) return;
  const v = F.v, mode = VEH[v].mode;
  const list = [...M.sel].map(([s, o]) => { const old = findEntry(s); return { d: s, v, m: mode, in: o.in, out: o.out, note: old && old.v === v ? old.note || '' : '' }; });
  const lastDay = [...M.sel.keys()].sort().pop();
  const ok = await saveEntries(list, `Se guardaron ${n} ${n === 1 ? 'día' : 'días'}.`, 'mmsg');
  if (ok) { closeManual(); $('fecha').value = lastDay; mes = lastDay.slice(0, 7); drawAll(); const m = $('msg'); m.className = 'msg'; m.textContent = `Se guardaron ${n} ${n === 1 ? 'día' : 'días'}.`; }
}

/* ---------- eventos ---------- */
document.addEventListener('click', ev => {
  if (ev.target.id === 'sheet') { closeManual(); return; }
  const t = ev.target.closest('button,.seg'); if (!t) return;
  const ds = t.dataset;
  if (t.id === 'entrar') { entrar(); return; }
  if (t.id === 'salir') { salir(); return; }
  if (t.id === 'manual') { openManual(); return; }
  if (t.id === 'mclose' || t.id === 'mcancel') { closeManual(); return; }
  if (t.id === 'msave') { saveManual(); return; }
  if (ds.day) { toggleDay(ds.day); return; }
  if (ds.mnav) { const d = new Date(M.y, M.m + Number(ds.mnav), 1); M.y = d.getFullYear(); M.m = d.getMonth(); drawManual(); return; }
  if (ds.v != null) { const nv = Number(ds.v); if (VEH[nv].mode !== curMode()) { F.in = null; F.out = null; } F.v = nv; delArm = null; drawForm(); drawHist(); return; }
  if (ds.l) { pick(ds.g, Number(ds.l)); return; }
  if (ds.set) { pick(ds.g, ds.set === 'x' ? null : Number(ds.set)); return; }
  if (ds.edit) { $('fecha').value = ds.edit; loadForm(); drawHist(); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
  if (ds.arm) { delArm = ds.arm; drawHist(); return; }
  if (ds.cancel) { delArm = null; drawHist(); return; }
  if (ds.del) { borrar(ds.del); return; }
});
document.addEventListener('keydown', ev => {
  const t = ev.target;
  if (ev.key === 'Escape' && M) { closeManual(); return; }
  if (t.id === 'pin' && ev.key === 'Enter') { entrar(); return; }
  if (t.classList && t.classList.contains('seg') && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); const g = t.dataset.g, l = t.dataset.l; pick(g, Number(l)); $('arc-' + g).querySelector(`[data-l="${l}"]`)?.focus(); }
});
for (const evn of ['input', 'change']) document.addEventListener(evn, e => {
  const t = e.target; if (!M || !t.dataset || !t.dataset.mf) return;
  const o = M.sel.get(t.dataset.md); if (!o) return;
  const val = t.value; o[t.dataset.mf] = val === '' || isNaN(Number(val)) ? null : Number(val);
});
for (const k of ['in', 'out']) $('num-' + k).addEventListener('input', e => { const v = e.target.value; F[k] = v === '' || isNaN(Number(v)) ? null : Number(v); setB(k, curMode()); });
$('fecha').addEventListener('change', () => { if (!$('fecha').value) $('fecha').value = today; mes = $('fecha').value.slice(0, 7); delArm = null; loadForm(); drawMes(); drawResumen(); drawHist(); });
$('mes').addEventListener('change', e => { mes = e.target.value; delArm = null; drawResumen(); drawHist(); });
$('guardar').addEventListener('click', () => {
  const msg = $('msg');
  if (F.v == null) { msg.className = 'msg err'; msg.textContent = 'Elige en qué vehículo andas.'; return; }
  if (F.in == null && F.out == null) { msg.className = 'msg err'; msg.textContent = 'Ingresa al menos un nivel de combustible.'; return; }
  const d = $('fecha').value || today;
  mes = d.slice(0, 7);
  saveEntries([{ d, v: F.v, m: VEH[F.v].mode, in: F.in, out: F.out, note: $('nota').value.trim() }], 'Registro guardado.').then(ok => { if (ok) { drawAll(); $('msg').textContent = 'Registro guardado.'; } });
});
$('copiar').addEventListener('click', async () => {
  const es = S.entries.filter(e => e.d.startsWith(mes) && (F.v == null || e.v === F.v)).sort((a, b) => a.d.localeCompare(b.d));
  const txt = ['Fecha\tVehículo\tRecibido\tEntregado\tNota'].concat(es.map(e => [e.d, VEH[e.v].name, lvl(e.in, e.m), lvl(e.out, e.m), e.note || ''].join('\t'))).join('\n');
  try { await navigator.clipboard.writeText(txt); $('copiar').textContent = '¡Copiado!'; setTimeout(() => $('copiar').textContent = 'Copiar como tabla', 2000); }
  catch (e) { $('copiar').textContent = 'No se pudo copiar'; }
});

/* ---------- compartido con viajes.js ---------- */
window.APP = {
  VEH, $, esc, trips: [],
  getPin: () => PIN, getRol: () => ROL, apiUrl: API,
  api: apiPost, refresh: () => refresh()
};

/* ---------- inicio ---------- */
$('hoy').textContent = now.toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
$('fecha').value = today;
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
setInterval(() => { if (!document.hidden) refresh(); }, 15000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });

if (!API || API.indexOf('PEGA_AQUI') >= 0) {
  showLogin('Falta configurar la dirección de la planilla en config.js.');
} else if (!PIN) {
  showLogin('');
} else {
  (async () => {
    showMain(); stamp('Cargando…');
    try {
      const r = await apiGet();
      if (!r.ok) { if (r.error === 'bloqueado') { showLogin(errMsg(r)); return; } salir(); showLogin(errMsg(r)); return; }
      ROL = r.rol; applyRole(); setEntries(r.entries || []); drawAll(); pushTrips(r); stamp();
    } catch (e) { drawAll(); stamp('Sin conexión'); }
  })();
}
})();
