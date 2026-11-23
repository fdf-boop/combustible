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

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function hoja_() {
  const sh = SpreadsheetApp.getActive().getSheetByName(HOJA);
  if (!sh) throw new Error('Falta ejecutar "configurar"');
  return sh;
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
    const rol = rol_(e.parameter.pin);
    if (!rol) return json_({ ok: false, error: 'pin' });
    return json_({ ok: true, rol: rol, entries: leer_() });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

function doPost(e) {
  let b;
  try { b = JSON.parse(e.postData.contents); } catch (x) { return json_({ ok: false, error: 'formato' }); }
  if (rol_(b.pin) !== 'editar') return json_({ ok: false, error: 'pin' });
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
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
