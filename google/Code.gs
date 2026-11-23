/**
 * Bitácora de combustible — servidor en Google Sheets
 *
 * 1) Ejecuta una vez la función "configurar" (menú Ejecutar).
 * 2) Cambia los PIN en "Configuración del proyecto > Propiedades del script":
 *      PIN_REGISTRO  -> solo tú (puede registrar, editar y borrar)
 *      PIN_LECTURA   -> para la persona que solo mira
 * 3) Implementar > Nueva implementación > Aplicación web
 *      Ejecutar como: Yo   ·   Quién tiene acceso: Cualquier usuario
 */

const HOJA = 'Registros';
const ENCABEZADOS = ['Fecha', 'Vehículo', 'Tipo', 'Recibido', 'Entregado', 'Nota', 'Actualizado'];

function configurar() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(HOJA);
  if (!sh) sh = ss.insertSheet(HOJA);
  sh.getRange('A:F').setNumberFormat('@'); // texto plano: evita que "3/4" se convierta en fecha
  sh.getRange(1, 1, 1, ENCABEZADOS.length).setValues([ENCABEZADOS]).setFontWeight('bold');
  sh.setFrozenRows(1);
  const p = PropertiesService.getScriptProperties();
  if (!p.getProperty('PIN_REGISTRO')) p.setProperty('PIN_REGISTRO', '1234');
  if (!p.getProperty('PIN_LECTURA')) p.setProperty('PIN_LECTURA', '0000');
}

function rol_(pin) {
  const p = PropertiesService.getScriptProperties();
  pin = String(pin || '');
  if (pin && pin === p.getProperty('PIN_REGISTRO')) return 'editar';
  if (pin && pin === p.getProperty('PIN_LECTURA')) return 'ver';
  return null;
}

/* Bloqueo: después de 3 PIN incorrectos, nadie puede entrar durante 15 minutos */
const MAX_INTENTOS = 3, BLOQUEO_SEG = 15 * 60;
function acceso_(pin) {
  const c = CacheService.getScriptCache();
  if (c.get('bloqueo')) return { error: 'bloqueado' };
  const rol = rol_(pin);
  if (rol) { c.remove('fallos'); return { rol: rol }; }
  const n = Number(c.get('fallos') || 0) + 1;
  if (n >= MAX_INTENTOS) { c.put('bloqueo', '1', BLOQUEO_SEG); c.remove('fallos'); return { error: 'bloqueado' }; }
  c.put('fallos', String(n), BLOQUEO_SEG);
  return { error: 'pin', quedan: MAX_INTENTOS - n };
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function hoja_() {
  const sh = SpreadsheetApp.getActive().getSheetByName(HOJA);
  if (!sh) throw new Error('Falta ejecutar "configurar"');
  return sh;
}

/* ---------- Viajes ---------- */
const HOJA_V = 'Viajes';
const ENC_V = ['ID', 'Vehículo', 'Origen', 'Destino', 'Inicio', 'Fin', 'Duración (min)', 'Estado', 'Ruta', 'Km', 'Valor ($)'];

function hojaV_() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(HOJA_V);
  if (!sh) {
    sh = ss.insertSheet(HOJA_V);
    sh.getRange('A:F').setNumberFormat('@');
    sh.getRange('H:I').setNumberFormat('@');
    sh.getRange(1, 1, 1, ENC_V.length).setValues([ENC_V]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  if (sh.getLastColumn() < ENC_V.length) sh.getRange(1, 1, 1, ENC_V.length).setValues([ENC_V]).setFontWeight('bold');
  return sh;
}

function dist_(a, b) {
  const R = 6371000, t = x => x * Math.PI / 180;
  const dLa = t(b[0] - a[0]), dLo = t(b[1] - a[1]);
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(t(a[0])) * Math.cos(t(b[0])) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function km_(r) { let d = 0; for (let i = 1; i < r.length; i++) d += dist_(r[i - 1], r[i]); return Math.round(d / 100) / 10; }

function cfg_() {
  const p = PropertiesService.getScriptProperties();
  if (p.getProperty('REND_Toyota') === null) p.setProperty('REND_Toyota', '15.4');
  if (p.getProperty('PRECIO_LITRO') === null) p.setProperty('PRECIO_LITRO', '1606');
  return { rend: { Toyota: p.getProperty('REND_Toyota') || '', Swift: p.getProperty('REND_Swift') || '' }, precio: p.getProperty('PRECIO_LITRO') || '' };
}

function filaV_(sh, id) {
  const n = sh.getLastRow();
  if (n < 2) return -1;
  const ids = sh.getRange(2, 1, n - 1, 1).getDisplayValues().map(r => r[0]);
  const i = ids.indexOf(String(id));
  return i < 0 ? -1 : i + 2;
}

function ruta_(txt) { try { const r = JSON.parse(txt || '[]'); return Array.isArray(r) ? r : []; } catch (e) { return []; } }

function leerV_() {
  const sh = hojaV_();
  const n = sh.getLastRow();
  if (n < 2) return [];
  const raw = sh.getRange(2, 10, n - 1, 2).getValues(); // números sin formato (evita "25,5" con coma)
  const txt = v => (v === '' || v == null) ? '' : String(v);
  return sh.getRange(2, 1, n - 1, 11).getDisplayValues().map((r, i) => [r, raw[i]]).filter(([r]) => r[0]).map(([r, w]) => {
    const t = { id: r[0], vehiculo: r[1], origen: r[2], destino: r[3], inicio: r[4], fin: r[5], estado: r[7], km: txt(w[0]), valor: txt(w[1]) };
    if (t.estado === 'activo') t.ruta = ruta_(r[8]);
    return t;
  });
}

function agregarPuntos_(sh, fila, pts) {
  if (!pts || !pts.length) return;
  const celda = sh.getRange(fila, 9);
  let r = ruta_(celda.getValue()).concat(pts.filter(p => Array.isArray(p) && p.length === 3));
  // Una celda admite ~50.000 caracteres: si la ruta crece mucho, se aligera (se conservan los últimos puntos).
  while (JSON.stringify(r).length > 45000 && r.length > 40) {
    r = r.slice(0, -20).filter((p, i) => i % 2 === 0).concat(r.slice(-20));
  }
  celda.setValue(JSON.stringify(r));
}

function accionViaje_(b) {
  const sh = hojaV_();
  if (b.action === 'tripStart') {
    const t = b.trip || {};
    if (leerV_().some(x => x.estado === 'activo')) return { ok: false, error: 'activo' };
    sh.appendRow([String(t.id), String(t.vehiculo), String(t.origen), String(t.destino), String(t.inicio), '', '', 'activo', '[]', '', '']);
    return { ok: true, trips: leerV_() };
  }
  if (b.action === 'tripAdd') { // viaje en taxi: solo valor
    const t = b.trip || {};
    const valor = Number(t.valor);
    if (!(valor > 0)) return { ok: false, error: 'valor' };
    sh.appendRow([String(t.id), 'Taxi', String(t.origen), String(t.destino), String(t.inicio), String(t.inicio), '', 'terminado', '[]', '', valor]);
    return { ok: true, trips: leerV_() };
  }
  const fila = filaV_(sh, b.id);
  if (fila < 0) return { ok: false, error: 'noexiste' };
  if (b.action === 'tripPing') {
    if (sh.getRange(fila, 8).getDisplayValue() !== 'activo') return { ok: false, error: 'noactivo' };
    agregarPuntos_(sh, fila, b.pts);
    return { ok: true };
  }
  if (b.action === 'tripEnd') {
    agregarPuntos_(sh, fila, b.pts);
    const inicio = new Date(sh.getRange(fila, 5).getDisplayValue());
    const fin = new Date(b.fin);
    sh.getRange(fila, 6).setValue(String(b.fin));
    sh.getRange(fila, 7).setValue(Math.max(0, Math.round((fin - inicio) / 60000)));
    sh.getRange(fila, 8).setValue('terminado');
    sh.getRange(fila, 10).setValue(km_(ruta_(sh.getRange(fila, 9).getValue())));
    return { ok: true, trips: leerV_() };
  }
  if (b.action === 'tripKm') {
    const km = Number(b.km);
    if (!(km >= 0)) return { ok: false, error: 'km' };
    sh.getRange(fila, 10).setValue(km);
    return { ok: true, trips: leerV_() };
  }
  if (b.action === 'tripDelete') {
    sh.deleteRow(fila);
    return { ok: true, trips: leerV_() };
  }
  return { ok: false, error: 'accion' };
}

function leer_() {
  const sh = hoja_();
  const n = sh.getLastRow();
  if (n < 2) return [];
  return sh.getRange(2, 1, n - 1, 6).getDisplayValues()
    .filter(r => r[0])
    .map(r => ({ fecha: r[0], vehiculo: r[1], tipo: r[2], recibido: r[3], entregado: r[4], nota: r[5] }));
}

function doGet(e) {
  try {
    const acc = acceso_(e.parameter.pin);
    if (!acc.rol) return json_({ ok: false, error: acc.error, quedan: acc.quedan });
    const rol = acc.rol;
    if (e.parameter.ruta) {
      const sh = hojaV_(), fila = filaV_(sh, e.parameter.ruta);
      return json_({ ok: true, ruta: fila < 0 ? [] : ruta_(sh.getRange(fila, 9).getValue()) });
    }
    return json_({ ok: true, rol: rol, entries: leer_(), trips: leerV_(), cfg: cfg_() });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

function doPost(e) {
  let b;
  try { b = JSON.parse(e.postData.contents); } catch (x) { return json_({ ok: false, error: 'formato' }); }
  const acc = acceso_(b.pin);
  if (!acc.rol) return json_({ ok: false, error: acc.error, quedan: acc.quedan });
  if (acc.rol !== 'editar') return json_({ ok: false, error: 'pin' });
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    if (b.action === 'config') {
      const p = PropertiesService.getScriptProperties();
      const num = x => (x === '' || x == null || isNaN(Number(x))) ? '' : String(Number(x));
      p.setProperty('REND_Toyota', num(b.rend && b.rend.Toyota));
      p.setProperty('REND_Swift', num(b.rend && b.rend.Swift));
      p.setProperty('PRECIO_LITRO', num(b.precio));
      return json_({ ok: true, cfg: cfg_() });
    }
    if (String(b.action).indexOf('trip') === 0) {
      const res = accionViaje_(b);
      SpreadsheetApp.flush();
      return json_(res);
    }
    const sh = hoja_();
    const n = sh.getLastRow();
    const fechas = n > 1 ? sh.getRange(2, 1, n - 1, 1).getDisplayValues().map(r => r[0]) : [];
    if (b.action === 'save') {
      (b.entries || []).forEach(en => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(en.fecha))) return;
        const fila = [en.fecha, en.vehiculo, en.tipo, String(en.recibido ?? ''), String(en.entregado ?? ''), String(en.nota || ''), new Date()];
        const i = fechas.indexOf(en.fecha);
        if (i >= 0) sh.getRange(i + 2, 1, 1, fila.length).setValues([fila]);
        else { sh.appendRow(fila); fechas.push(en.fecha); }
      });
    } else if (b.action === 'delete') {
      const i = fechas.indexOf(String(b.fecha));
      if (i >= 0) sh.deleteRow(i + 2);
    }
    SpreadsheetApp.flush();
    return json_({ ok: true, rol: 'editar', entries: leer_() });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}
