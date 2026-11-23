'use strict';
(() => {
const A = window.APP;
if (!A) return;
const { $, esc } = A;

/* Vehículos de viaje: los dos autos + taxi (solo valor) */
const TAXI_SVG = '<svg class="photo" viewBox="0 0 160 100" aria-hidden="true"><rect width="160" height="100" fill="#2b2f33"/><rect x="62" y="14" width="36" height="12" rx="3" fill="#ffd400"/><text x="80" y="23.5" font-size="9" font-weight="700" text-anchor="middle" fill="#1b1b1b" font-family="Barlow,sans-serif">TAXI</text><path d="M22 70v-12c0-5 3-8 8-9l18-4 14-15c2-2 4-3 7-3h26c3 0 5 1 7 3l14 15 14 3c6 1 9 5 9 10v12z" fill="#ffd400"/><path d="M58 46l10-11h14v11zM86 46V35h12l10 11z" fill="#2b3a44"/><path d="M24 60h113" stroke="#1b1b1b" stroke-width="3" stroke-dasharray="6 4"/><circle cx="48" cy="72" r="11" fill="#111"/><circle cx="48" cy="72" r="4.5" fill="#cfd8dc"/><circle cx="114" cy="72" r="11" fill="#111"/><circle cx="114" cy="72" r="4.5" fill="#cfd8dc"/></svg>';
const TV = A.VEH.map(v => ({ name: v.name, img: v.img, auto: true })).concat([{ name: 'Taxi', img: null, auto: false }]);
const TAXI = TV.length - 1;
const pic = i => TV[i].img ? `<img class="photo" src="${TV[i].img}" alt="">` : TAXI_SVG;

let trips = [], rol = null, cfg = { rend: {}, precio: '' }, selV = null, armDel = null, armEnd = false;
let gMes = null, gVeh = 0, kmEdit = null;
let map = null, line = null, marker = null, follow = true;
let map2 = null, line2 = null;
let watchId = null, buf = [], lastSend = 0, lastFix = null, wake = null, tick = null, sending = false;

const ls = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const lsSet = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} };
const pad = n => String(n).padStart(2, '0');
const isoDay = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const localDay = iso => isoDay(new Date(iso));
const tTime = d => new Date(d).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
const money = n => '$' + Math.round(n).toLocaleString('es-CL');
const kmTxt = k => k.toLocaleString('es-CL', { maximumFractionDigits: 1 }) + ' km';
const active = () => trips.find(t => t.estado === 'activo');
const isTaxi = t => t.vehiculo === 'Taxi';
const durMs = t => (t.fin ? new Date(t.fin) : new Date()) - new Date(t.inicio);
const hasTime = t => !isTaxi(t) && t.fin && t.fin !== t.inicio;
const fmtMin = min => { min = Math.round(min); const h = Math.floor(min / 60), m = min % 60; return h ? `${h} h ${m} min` : `${m} min`; };
const clock = ms => { const s = Math.max(0, Math.floor(ms / 1000)); return [Math.floor(s / 3600), Math.floor(s % 3600 / 60), s % 60].map(pad).join(':'); };
const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
const tracking = () => watchId != null;
const msg = (id, txt, err) => { const m = $(id); m.className = 'msg' + (err ? ' err' : ''); m.textContent = txt; };
const setGps = txt => { $('v-gps').textContent = txt; };
const num = x => (x === '' || x == null || isNaN(Number(x))) ? null : Number(x);
function dist(a, b) {
  const R = 6371000, r = x => x * Math.PI / 180;
  const dLa = r(b[0] - a[0]), dLo = r(b[1] - a[1]);
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(r(a[0])) * Math.cos(r(b[0])) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const routeKm = r => { let d = 0; for (let i = 1; i < (r || []).length; i++) d += dist(r[i - 1], r[i]); return d / 1000; };
const kmOf = t => t.estado === 'activo' ? routeKm(t.ruta) : num(t.km);
function cost(t) {
  if (isTaxi(t)) return num(t.valor);
  const km = kmOf(t), rend = num(cfg.rend[t.vehiculo]), pre = num(cfg.precio);
  if (km == null || !rend || !pre) return null;
  return km / rend * pre;
}

/* ---------- pestañas ---------- */
function setTab(t) {
  for (const b of document.querySelectorAll('.tabs button')) b.setAttribute('aria-selected', String(b.dataset.tab === t));
  $('tab-comb').hidden = t !== 'comb';
  $('tab-viajes').hidden = t !== 'viajes';
  lsSet('tab', t);
  if (t === 'viajes') setTimeout(() => { render(); if (map) map.invalidateSize(); }, 50);
}

/* ---------- mapa ---------- */
function newMap(el) {
  if (typeof L === 'undefined') return null;
  const m = L.map(el, { zoomControl: true }).setView([-33.45, -70.66], 11);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(m);
  return m;
}
function ensureMap() {
  if (map) return;
  map = newMap('v-map');
  if (!map) { $('v-map').textContent = 'No se pudo cargar el mapa.'; return; }
  line = L.polyline([], { color: '#ff6b1a', weight: 5, opacity: .9 }).addTo(map);
  marker = L.circleMarker([0, 0], { radius: 9, color: '#fff', weight: 3, fillColor: '#0b4f6c', fillOpacity: 1 });
  map.on('dragstart', () => { follow = false; $('v-center').hidden = false; });
}
function drawRoute(a) {
  const r = a.ruta || [];
  const pts = r.map(p => [p[0], p[1]]);
  if (map) {
    line.setLatLngs(pts);
    if (pts.length) {
      const last = pts[pts.length - 1];
      marker.setLatLng(last).addTo(map);
      if (follow) map.setView(last, Math.max(map.getZoom(), 15));
    }
  }
  $('v-pts').textContent = pts.length ? 'Última posición: ' + tTime(r[r.length - 1][2] * 1000) : 'Aún no hay posición del viaje.';
  const c = cost(a);
  $('v-lstats').textContent = kmTxt(routeKm(r)) + (c != null ? ' · ≈ ' + money(c) + ' en bencina' : '');
}

/* ---------- seguimiento GPS ---------- */
function startTracking(id) {
  if (!('geolocation' in navigator)) { setGps('Este navegador no permite compartir la ubicación.'); return; }
  lsSet('tripId', id);
  try { buf = JSON.parse(ls('tripBuf') || '[]'); } catch (e) { buf = []; }
  lastFix = null;
  watchId = navigator.geolocation.watchPosition(onPos, onErr, { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 });
  keepAwake();
  setGps('Buscando señal GPS…');
  render();
}
function stopTracking() {
  if (watchId != null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  if (wake) { wake.release().catch(() => {}); wake = null; }
}
function onPos(p) {
  const c = p.coords;
  if (c.accuracy > 150) return;
  const pt = [+c.latitude.toFixed(5), +c.longitude.toFixed(5), Math.round(p.timestamp / 1000)];
  if (lastFix && dist(lastFix, pt) < 15 && pt[2] - lastFix[2] < 60) return;
  lastFix = pt;
  if (!lastSend) setGps('GPS activo · enviando ubicación…');
  buf.push(pt);
  lsSet('tripBuf', JSON.stringify(buf));
  const a = active();
  if (a) { a.ruta = (a.ruta || []).concat([pt]); drawRoute(a); }
  if (Date.now() - lastSend > 25000) flush();
}
function onErr(e) {
  if (e.code !== 1 && lastFix && Date.now() / 1000 - lastFix[2] < 90) return;
  setGps(e.code === 1 ? 'Debes permitir la ubicación para que el viaje se vea en el mapa.' : 'No se pudo obtener la ubicación. Revisa que el GPS esté encendido.');
}
async function flush() {
  const id = ls('tripId');
  if (!id || !buf.length || sending) return;
  sending = true;
  const pts = buf.slice();
  try {
    const r = await A.api({ action: 'tripPing', id, pts });
    if (r.ok) {
      buf = buf.slice(pts.length); lsSet('tripBuf', JSON.stringify(buf)); lastSend = Date.now();
      setGps('Compartiendo ubicación · enviada a las ' + tTime(Date.now()));
    } else if (r.error === 'noactivo' || r.error === 'noexiste') { stopTracking(); lsSet('tripId', null); lsSet('tripBuf', null); buf = []; }
  } catch (e) { setGps('Sin conexión: la ubicación se enviará al recuperar señal.'); }
  finally { sending = false; }
}
async function keepAwake() {
  try { if ('wakeLock' in navigator && !wake) { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null; }); } } catch (e) {}
}
function startTick() {
  if (tick) return;
  tick = setInterval(() => {
    const a = active();
    if (!a) return;
    $('v-clock').textContent = clock(durMs(a));
    if (tracking() && Date.now() - lastSend > 30000) flush();
  }, 1000);
}
function stopTick() { clearInterval(tick); tick = null; }

/* ---------- acciones ---------- */
function setTrips(r) { trips = r.trips || []; A.trips = trips; }
async function start() {
  const o = $('v-orig').value.trim(), d = $('v-dest').value.trim();
  if (selV == null) { msg('v-msg', 'Elige en qué vas.', true); return; }
  if (!o || !d) { msg('v-msg', 'Escribe el origen y el destino.', true); return; }
  const t = { id: 'V' + Date.now().toString(36), vehiculo: TV[selV].name, origen: o, destino: d, inicio: new Date().toISOString() };
  $('v-start').disabled = true; msg('v-msg', 'Iniciando viaje…');
  try {
    const r = await A.api({ action: 'tripStart', trip: t });
    if (!r.ok) throw new Error(r.error);
    setTrips(r);
    lsSet('tripBuf', null); buf = []; lastSend = 0; follow = true;
    msg('v-msg', '');
    startTracking(t.id);
  } catch (e) {
    msg('v-msg', e.message === 'activo' ? 'Ya hay un viaje en curso.' : e.message === 'pin' ? 'Tu PIN no permite registrar viajes.' : 'No se pudo iniciar. Revisa tu conexión.', true);
  } finally { $('v-start').disabled = false; }
}
async function saveTaxi() {
  const o = $('v-orig').value.trim(), d = $('v-dest').value.trim(), val = num($('v-valor').value);
  if (!o || !d) { msg('v-msg', 'Escribe el origen y el destino.', true); return; }
  if (!val || val <= 0) { msg('v-msg', 'Ingresa el valor del viaje.', true); return; }
  const day = $('v-tfecha').value || isoDay(new Date());
  const [y, m, dd] = day.split('-').map(Number);
  const when = day === isoDay(new Date()) ? new Date() : new Date(y, m - 1, dd, 12, 0);
  $('v-taxisave').disabled = true; msg('v-msg', 'Guardando…');
  try {
    const r = await A.api({ action: 'tripAdd', trip: { id: 'T' + Date.now().toString(36), vehiculo: 'Taxi', origen: o, destino: d, inicio: when.toISOString(), valor: val } });
    if (!r.ok) throw new Error(r.error);
    setTrips(r); $('v-valor').value = '';
    gVeh = TAXI; gMes = day.slice(0, 7);
    render();
    msg('v-msg', `Viaje en taxi guardado: ${money(val)}.`);
  } catch (e) { msg('v-msg', e.message === 'pin' ? 'Tu PIN no permite registrar viajes.' : 'No se pudo guardar. Revisa tu conexión.', true); }
  finally { $('v-taxisave').disabled = false; }
}
async function end() {
  const a = active(); if (!a) return;
  if (!armEnd) {
    armEnd = true; $('v-end').textContent = '¿Terminar? Toca de nuevo';
    setTimeout(() => { armEnd = false; $('v-end').textContent = 'Terminar viaje'; }, 4000);
    return;
  }
  armEnd = false; $('v-end').disabled = true; msg('v-msg2', 'Guardando…');
  try {
    const r = await A.api({ action: 'tripEnd', id: a.id, fin: new Date().toISOString(), pts: buf });
    if (!r.ok) throw new Error(r.error);
    stopTracking(); buf = []; lsSet('tripBuf', null); lsSet('tripId', null);
    setTrips(r);
    const t = trips.find(x => x.id === a.id);
    gVeh = Math.max(0, TV.findIndex(v => v.name === a.vehiculo)); gMes = localDay(a.inicio).slice(0, 7);
    render();
    if (t) { const c = cost(t); msg('v-msg', `Viaje guardado: ${fmtMin(durMs(t) / 60000)}${num(t.km) != null ? ', ' + kmTxt(num(t.km)) : ''}${c != null ? ', ≈ ' + money(c) : ''}.`); }
  } catch (e) { msg('v-msg2', 'No se pudo terminar el viaje. Inténtalo de nuevo.', true); }
  finally { $('v-end').disabled = false; $('v-end').textContent = 'Terminar viaje'; }
}
async function borrar(id) {
  try { const r = await A.api({ action: 'tripDelete', id }); if (!r.ok) throw new Error(r.error); setTrips(r); armDel = null; render(); }
  catch (e) { msg('g-note', 'No se pudo eliminar. Inténtalo de nuevo.', true); }
}
async function saveKm(id) {
  const km = num($('km-' + id).value);
  if (km == null || km < 0) return;
  try { const r = await A.api({ action: 'tripKm', id, km }); if (!r.ok) throw new Error(r.error); setTrips(r); kmEdit = null; render(); }
  catch (e) { msg('g-note', 'No se pudieron guardar los km.', true); }
}
async function saveCfg() {
  const body = { action: 'config', rend: { Toyota: $('c-toy').value, Swift: $('c-swi').value }, precio: $('c-pre').value };
  msg('c-msg', 'Guardando…');
  try { const r = await A.api(body); if (!r.ok) throw new Error(r.error); cfg = r.cfg; render(); msg('c-msg', 'Guardado. Los gastos se recalcularon.'); }
  catch (e) { msg('c-msg', 'No se pudo guardar.', true); }
}
async function verRuta(id) {
  const t = trips.find(x => x.id === id); if (!t) return;
  $('v-sheet').hidden = false; document.body.style.overflow = 'hidden';
  $('v-stitle').textContent = `${t.origen} → ${t.destino}`;
  const c = cost(t);
  $('v-sinfo').textContent = `${t.vehiculo} · ${new Date(t.inicio).toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long' })} · ${tTime(t.inicio)}–${tTime(t.fin)} · ${fmtMin(durMs(t) / 60000)}${num(t.km) != null ? ' · ' + kmTxt(num(t.km)) : ''}${c != null ? ' · ≈ ' + money(c) : ''}`;
  $('v-smsg').textContent = 'Cargando ruta…';
  if (!map2) { map2 = newMap('v-map2'); if (map2) line2 = L.polyline([], { color: '#ff6b1a', weight: 5 }).addTo(map2); }
  setTimeout(() => map2 && map2.invalidateSize(), 60);
  try {
    const r = await (await fetch(A.apiUrl + '?pin=' + encodeURIComponent(A.getPin()) + '&ruta=' + encodeURIComponent(id) + '&t=' + Date.now())).json();
    const pts = (r.ruta || []).map(p => [p[0], p[1]]);
    if (!map2) { $('v-smsg').textContent = 'No se pudo cargar el mapa.'; return; }
    line2.setLatLngs(pts);
    if (pts.length > 1) { map2.fitBounds(line2.getBounds(), { padding: [24, 24] }); $('v-smsg').textContent = ''; }
    else if (pts.length === 1) { map2.setView(pts[0], 15); $('v-smsg').textContent = ''; }
    else $('v-smsg').textContent = 'Este viaje no tiene ruta guardada.';
  } catch (e) { $('v-smsg').textContent = 'No se pudo cargar la ruta.'; }
}
function cerrarRuta() { $('v-sheet').hidden = true; document.body.style.overflow = ''; }

/* ---------- dibujo ---------- */
function drawNew() {
  $('v-veh').innerHTML = TV.map((x, i) => `<button type="button" role="radio" aria-checked="${selV === i}" data-vv="${i}">${pic(i)}<span class="vn">${esc(x.name)}</span></button>`).join('');
  const taxi = selV === TAXI;
  $('v-taxi').hidden = !taxi; $('v-taxisave').hidden = !taxi; $('v-start').hidden = taxi;
  if (taxi && !$('v-tfecha').value) $('v-tfecha').value = isoDay(new Date());
  const places = [...new Set(trips.flatMap(t => [t.origen, t.destino]).map(s => s.trim()).filter(Boolean))].sort();
  $('v-places').innerHTML = places.map(p => `<option value="${esc(p)}">`).join('');
  const last = trips.filter(t => t.estado === 'terminado').sort((a, b) => b.inicio.localeCompare(a.inicio))[0];
  $('v-chips').innerHTML = last ? `<button type="button" class="chip" data-q="rep">Repetir: ${esc(last.origen)} → ${esc(last.destino)}</button><button type="button" class="chip" data-q="vuelta">Vuelta: ${esc(last.destino)} → ${esc(last.origen)}</button>` : '';
}
function periodTrips() {
  const done = trips.filter(t => t.estado === 'terminado');
  return gMes === 'todo' ? done : done.filter(t => localDay(t.inicio).startsWith(gMes));
}
function drawGastos() {
  const now = isoDay(new Date()).slice(0, 7);
  if (!gMes) gMes = now;
  const months = [...new Set(trips.map(t => localDay(t.inicio).slice(0, 7)).concat([now, gMes === 'todo' ? now : gMes]))].sort().reverse();
  $('g-mes').innerHTML = months.map(m => { const [y, mm] = m.split('-').map(Number); return `<option value="${m}" ${m === gMes ? 'selected' : ''}>${new Date(y, mm - 1, 1).toLocaleDateString('es-CL', { month: 'long', year: 'numeric' })}</option>`; }).join('') + `<option value="todo" ${gMes === 'todo' ? 'selected' : ''}>Todo</option>`;
  const list = periodTrips();
  let total = 0, missing = 0, kmTot = 0;
  const per = TV.map((v, i) => {
    const l = list.filter(t => t.vehiculo === v.name);
    let sum = 0, km = 0;
    l.forEach(t => { const c = cost(t); if (c == null) { if (!isTaxi(t)) missing++; } else sum += c; if (!isTaxi(t) && num(t.km) != null) km += num(t.km); });
    total += sum; kmTot += km;
    return { i, n: l.length, sum, km };
  });
  $('g-total').textContent = money(total);
  $('g-sub').textContent = `${list.length} ${list.length === 1 ? 'viaje' : 'viajes'} · ${kmTxt(kmTot)} en auto`;
  $('g-tiles').innerHTML = per.map(p => `<button type="button" data-gv="${p.i}" aria-pressed="${gVeh === p.i}"><small>${esc(TV[p.i].name)}</small><strong>${money(p.sum)}</strong><span>${p.n} ${p.n === 1 ? 'viaje' : 'viajes'}${TV[p.i].auto ? ' · ' + kmTxt(p.km) : ''}</span></button>`).join('');
  const noRend = TV.filter(v => v.auto && !num(cfg.rend[v.name])).map(v => v.name);
  $('g-note').className = 'legend';
  $('g-note').textContent = missing ? `${missing} ${missing === 1 ? 'viaje no suma' : 'viajes no suman'} al total: ${noRend.length ? 'falta el rendimiento de ' + noRend.join(' y ') : 'faltan sus kilómetros'}.` : '';
  const v = TV[gVeh];
  $('g-rtitle').textContent = 'Registro del ' + v.name;
  const rows = list.filter(t => t.vehiculo === v.name).sort((a, b) => b.inicio.localeCompare(a.inicio));
  if (!rows.length) { $('g-list').innerHTML = `<li class="e"><p class="emptyst">No hay viajes en ${esc(v.name)} en este período.</p></li>`; return; }
  const ed = rol === 'editar';
  $('g-list').innerHTML = rows.map(t => {
    const d = new Date(t.inicio), c = cost(t), km = num(t.km);
    const meta = isTaxi(t) ? 'Taxi' : `${tTime(t.inicio)}–${tTime(t.fin)} · ${fmtMin(durMs(t) / 60000)}${km != null ? ' · ' + kmTxt(km) : ''}`;
    const amt = c != null ? `<div class="amt">${money(c)}</div>` : `<div class="amt na">${!isTaxi(t) && km == null ? 'Sin km' : 'Falta rendimiento'}</div>`;
    const kmFix = ed && !isTaxi(t) && km == null ? (kmEdit === t.id ? `<div class="kmrow"><input id="km-${t.id}" type="number" inputmode="decimal" min="0" step="0.1" placeholder="km"><button class="link" type="button" data-kmsave="${t.id}">Guardar</button></div>` : `<button class="link" type="button" data-kmedit="${t.id}">Agregar km</button>`) : '';
    const del = !ed ? '' : armDel === t.id ? `<button class="link danger" type="button" data-vdel="${t.id}">Sí, eliminar</button><button class="link" type="button" data-vcancel="1">Cancelar</button>` : `<button class="link danger" type="button" data-varm="${t.id}">Eliminar</button>`;
    return `<li><div class="dd"><b>${d.getDate()}</b><span>${d.toLocaleDateString('es-CL', { weekday: 'short' }).replace('.', '')}</span></div><div><div class="tv-r">${esc(t.origen)} → ${esc(t.destino)}</div><div class="tv-m">${meta}</div>${amt}</div><div class="vacts">${isTaxi(t) ? '' : `<button class="link" type="button" data-vr="${t.id}">Ver ruta</button>`}${kmFix}${del}</div></li>`;
  }).join('');
}
function drawPairs() {
  const done = trips.filter(t => t.estado === 'terminado');
  if (!done.length) { $('v-stats').innerHTML = '<p class="emptyst">Cuando registres viajes verás aquí cuánto te demoras y cuánto gastas en cada recorrido, de ida y de vuelta.</p>'; return; }
  const low = s => s.trim().toLowerCase();
  const g = {};
  done.forEach(t => { const k = [low(t.origen), low(t.destino)].sort().join('|'); (g[k] = g[k] || { a: t.origen.trim(), b: t.destino.trim(), list: [] }).list.push(t); });
  $('v-stats').innerHTML = Object.values(g).sort((x, y) => y.list.length - x.list.length).map(p => {
    const dir = (from, to, label) => {
      const l = p.list.filter(t => low(t.origen) === low(from) && low(t.destino) === low(to));
      if (!l.length) return { html: `<div class="dir"><small>${label}</small><b>${esc(from)} → ${esc(to)}</b><p>Sin viajes aún.</p></div>`, c: null };
      const ts = l.filter(hasTime).map(t => durMs(t) / 60000);
      const autos = l.filter(t => !isTaxi(t)).map(cost).filter(x => x != null);
      const cs = autos.length ? autos : l.map(cost).filter(x => x != null); // el monto grande es el promedio en auto; si solo hubo taxi, el del taxi
      const perV = TV.map(v => { const c = l.filter(t => t.vehiculo === v.name).map(cost).filter(x => x != null); return c.length ? `${v.name} ${money(avg(c))}` : null; }).filter(Boolean).join(' · ');
      const c = cs.length ? avg(cs) : null;
      return { c, html: `<div class="dir"><small>${label} · ${l.length} ${l.length === 1 ? 'viaje' : 'viajes'}</small><b>${esc(from)} → ${esc(to)}</b><span class="big">${c != null ? money(c) : '—'}</span><p>${ts.length ? `Tiempo promedio ${fmtMin(avg(ts))} (${fmtMin(Math.min(...ts))} a ${fmtMin(Math.max(...ts))})` : 'Sin tiempos (solo taxi)'}</p>${perV ? `<p>Promedio por vehículo: ${esc(perV)}</p>` : ''}</div>` };
    };
    const ida = dir(p.a, p.b, 'Ida'), vuelta = dir(p.b, p.a, 'Vuelta');
    const both = ida.c != null && vuelta.c != null ? `Ida y vuelta ≈ ${money(ida.c + vuelta.c)}` : '';
    return `<div class="pair"><div class="pair-h"><b>${esc(p.a)} ⇄ ${esc(p.b)}</b><span>${both}</span></div><div class="dirs">${ida.html}${vuelta.html}</div></div>`;
  }).join('');
}
function drawCfg() {
  if (document.activeElement && document.activeElement.closest && document.activeElement.closest('#v-cfg')) return;
  $('c-toy').value = cfg.rend.Toyota ?? '';
  $('c-swi').value = cfg.rend.Swift ?? '';
  $('c-pre').value = cfg.precio ?? '';
}
function render() {
  const a = active(), ed = rol === 'editar';
  $('v-new').hidden = !ed || !!a;
  $('v-live').hidden = !a;
  $('v-dotab').hidden = !a;
  if (a) {
    $('v-ltitle').textContent = `${a.origen} → ${a.destino}`;
    $('v-lsub').textContent = `${a.vehiculo} · salió a las ${tTime(a.inicio)}`;
    $('v-clock').textContent = clock(durMs(a));
    $('v-end').hidden = !ed;
    $('v-track').hidden = !ed || tracking();
    $('v-hint').hidden = !ed;
    if (!ed) setGps('Ubicación en vivo de quien maneja.');
    else if (!tracking()) setGps('Este celular no está compartiendo la ubicación del viaje.');
    ensureMap();
    setTimeout(() => map && map.invalidateSize(), 60);
    drawRoute(a);
    startTick();
  } else {
    stopTick();
    if (tracking()) stopTracking();
  }
  drawNew(); drawGastos(); drawPairs(); drawCfg();
}

/* ---------- datos desde app.js ---------- */
function update(list, r, c) {
  rol = r;
  if (c) cfg = { rend: c.rend || {}, precio: c.precio };
  const a0 = active();
  trips = (list || []).map(t => {
    if (t.estado === 'activo' && a0 && a0.id === t.id && buf.length) t.ruta = (t.ruta || []).concat(buf.filter(p => !(t.ruta || []).some(q => q[2] === p[2])));
    return t;
  });
  const a = active();
  if (!r) stopTracking();
  else if (a && r === 'editar' && ls('tripId') === a.id && !tracking()) startTracking(a.id);
  else if (!a && ls('tripId')) { lsSet('tripId', null); lsSet('tripBuf', null); buf = []; }
  if (selV == null) { const last = trips.filter(t => !isTaxi(t)).sort((x, y) => y.inicio.localeCompare(x.inicio))[0]; if (last) selV = TV.findIndex(v => v.name === last.vehiculo); if (selV < 0) selV = null; }
  $('v-dotab').hidden = !a;
  if (!$('tab-viajes').hidden && !kmEdit) render();
}

/* ---------- eventos ---------- */
document.addEventListener('click', ev => {
  if (ev.target.id === 'v-sheet') { cerrarRuta(); return; }
  const t = ev.target.closest('button'); if (!t) return;
  const ds = t.dataset;
  if (ds.tab) { setTab(ds.tab); return; }
  if (ds.vv != null) { selV = Number(ds.vv); msg('v-msg', ''); drawNew(); return; }
  if (ds.q) {
    const last = trips.filter(x => x.estado === 'terminado').sort((a, b) => b.inicio.localeCompare(a.inicio))[0]; if (!last) return;
    $('v-orig').value = ds.q === 'rep' ? last.origen : last.destino;
    $('v-dest').value = ds.q === 'rep' ? last.destino : last.origen;
    selV = TV.findIndex(v => v.name === last.vehiculo); if (selV < 0) selV = null; drawNew(); return;
  }
  if (ds.gv != null) { gVeh = Number(ds.gv); armDel = null; drawGastos(); return; }
  if (t.id === 'v-swap') { const o = $('v-orig').value; $('v-orig').value = $('v-dest').value; $('v-dest').value = o; return; }
  if (t.id === 'v-start') { start(); return; }
  if (t.id === 'v-taxisave') { saveTaxi(); return; }
  if (t.id === 'v-end') { end(); return; }
  if (t.id === 'v-track') { const a = active(); if (a) startTracking(a.id); return; }
  if (t.id === 'v-center') { follow = true; t.hidden = true; const a = active(); if (a) drawRoute(a); return; }
  if (t.id === 'v-sclose') { cerrarRuta(); return; }
  if (t.id === 'c-save') { saveCfg(); return; }
  if (ds.vr) { verRuta(ds.vr); return; }
  if (ds.kmedit) { kmEdit = ds.kmedit; drawGastos(); const i = $('km-' + kmEdit); if (i) i.focus(); return; }
  if (ds.kmsave) { saveKm(ds.kmsave); return; }
  if (ds.varm) { armDel = ds.varm; drawGastos(); return; }
  if (ds.vcancel) { armDel = null; drawGastos(); return; }
  if (ds.vdel) { borrar(ds.vdel); return; }
});
$('g-mes').addEventListener('change', e => { gMes = e.target.value; armDel = null; drawGastos(); });
document.addEventListener('keydown', ev => { if (ev.key === 'Escape' && !$('v-sheet').hidden) cerrarRuta(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden && tracking()) { keepAwake(); flush(); } });

window.Viajes = { update };
setTab(ls('tab') === 'viajes' ? 'viajes' : 'comb');
update(A.trips, A.getRol(), A.cfg);
})();
