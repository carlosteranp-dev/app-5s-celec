import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { crc32, crearZip, crearXlsx, letraColumna, serieExcel, xmlSeguro, xmlHoja, nombreHoja } from '../js/xlsx.js';
import { construirHojas } from '../js/excel.js';
import { sincronizarRespuestas, resultadoDeEvaluacion } from '../js/calc.js';

const INST = JSON.parse(readFileSync(new URL('../instrumento_5S.json', import.meta.url), 'utf8'));

/** Lector mínimo de zips "stored": devuelve { nombre → texto } y comprueba los CRC. */
function leerZip(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const fin = bytes.length - 22;
  assert.equal(v.getUint32(fin, true), 0x06054b50, 'falta el fin del directorio central');
  const total = v.getUint16(fin + 10, true);
  let pos = v.getUint32(fin + 16, true);
  const salida = {};
  for (let i = 0; i < total; i++) {
    assert.equal(v.getUint32(pos, true), 0x02014b50);
    const crc = v.getUint32(pos + 16, true);
    const tamano = v.getUint32(pos + 20, true);
    const largoNombre = v.getUint16(pos + 28, true);
    const local = v.getUint32(pos + 42, true);
    const nombre = new TextDecoder().decode(bytes.subarray(pos + 46, pos + 46 + largoNombre));
    assert.equal(v.getUint32(local, true), 0x04034b50);
    const largoLocal = v.getUint16(local + 26, true);
    const datos = bytes.subarray(local + 30 + largoLocal, local + 30 + largoLocal + tamano);
    assert.equal(crc32(datos), crc, `CRC incorrecto en ${nombre}`);
    salida[nombre] = new TextDecoder().decode(datos);
    pos += 46 + largoNombre;
  }
  return salida;
}

test('crc32 coincide con el valor conocido', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

test('el zip contiene los archivos con su contenido y CRC correctos (incluidos acentos)', () => {
  const zip = leerZip(crearZip([{ nombre: 'a.txt', contenido: 'Hola ñandú' }, { nombre: 'dir/b.xml', contenido: new Uint8Array([1, 2, 3]) }]));
  assert.deepEqual(Object.keys(zip), ['a.txt', 'dir/b.xml']);
  assert.equal(zip['a.txt'], 'Hola ñandú');
});

test('utilidades: letras de columna, fechas de Excel, XML seguro y nombres de hoja', () => {
  assert.deepEqual([0, 25, 26, 27, 51, 52, 701, 702].map(letraColumna), ['A', 'Z', 'AA', 'AB', 'AZ', 'BA', 'ZZ', 'AAA']);
  assert.equal(serieExcel('1900-03-01'), 61);
  assert.equal(serieExcel('2026-10-14'), 46309);
  assert.equal(xmlSeguro('a & b < c > "d" \u0001\u0007x'), 'a &amp; b &lt; c &gt; &quot;d&quot; x');
  assert.equal(nombreHoja('Resumen: [2026]/A?'), 'Resumen   2026  A');
  assert.equal(nombreHoja('x'.repeat(40)).length, 31);
});

test('la hoja usa texto en línea, números, fechas y deja vacías las celdas sin valor', () => {
  const xml = xmlHoja({ columnas: [{ titulo: 'Área' }, { titulo: 'Valor', tipo: 'numero' }, { titulo: 'Fecha', tipo: 'fecha' }], filas: [['Casa <A>', 71.25, '2026-10-14'], ['B', null, null]] });
  assert.match(xml, /<t xml:space="preserve">Casa &lt;A&gt;<\/t>/);
  assert.match(xml, /<c r="B2" s="2"><v>71.25<\/v><\/c>/);
  assert.match(xml, /<c r="C2" s="3"><v>46309<\/v><\/c>/);
  assert.doesNotMatch(xml, /r="B3"/);
  assert.match(xml, /<autoFilter ref="A1:C3"\/>/);
});

// --- Hojas del informe de Excel -----------------------------------------------------------

const T = '2026-09-10T10:00:00.000Z';
function evaluacion(n, areaId, modulo, tipo, fecha, base, extra = {}) {
  let respuestas = sincronizarRespuestas(INST, modulo, [], { tipoArea: tipo, esPrimera: false });
  respuestas = respuestas.map((r, i) => (r.na === 'automatico' ? r : i === 1 ? { ...r, na: 'manual', na_justificacion: 'No hay' } : { ...r, valor: Math.min(4, Math.max(0, Math.round(base + (i % 3) - 1))) }));
  const ev = { id: `ev-${n}`, creado: T, area_id: areaId, area_tipo: tipo, modulo, fecha, estado: 'cerrada', anulada: false, es_primera_evaluacion: n === 1, instrumento_version: '1.0-borrador', evaluador: { nombre: 'Carlos Terán', cargo: 'Analista' }, respuestas, ...extra };
  ev.resultado = resultadoDeEvaluacion(INST, ev);
  return ev;
}

const datos = () => ({
  inst: INST,
  sitios: [{ id: 's1', nombre: 'Central Uno' }, { id: 's2', nombre: 'Central Dos' }],
  areas: [{ id: 'a1', sitio_id: 's1', nombre: 'Casa de máquinas' }, { id: 'a2', sitio_id: 's2', nombre: 'Oficina' }],
  evaluaciones: [
    evaluacion(1, 'a1', 'fisico', 'O', '2026-09-10', 3),
    evaluacion(2, 'a2', 'fisico', 'A', '2026-08-01', 2),
    evaluacion(3, 'a1', 'fisico', 'O', '2026-09-15', 1, { anulada: true }),
    evaluacion(4, 'a1', 'fisico', 'O', '2026-09-20', 1, { estado: 'borrador', resultado: null }),
    evaluacion(5, 'a1', 'digital', 'O', '2026-09-12', 3, { usuario_nombre: 'María López', usuario_cargo: 'Asistente', equipo_codigo: 'PC-0042' }),
  ],
});

test('una hoja por módulo más una de leyenda; solo evaluaciones cerradas y vigentes, ordenadas', () => {
  const hojas = construirHojas(datos());
  assert.deepEqual(hojas.map((h) => h.nombre), ['Físico', 'Digital', 'Ítems']);
  assert.equal(hojas[0].filas.length, 2); // sin la anulada ni el borrador
  assert.equal(hojas[1].filas.length, 1);
  assert.deepEqual(hojas[0].filas.map((f) => f[0]), ['Central Dos', 'Central Uno']);
  assert.equal(hojas[2].filas.length, 26 + 20); // 26 ítems físicos (S1.5 y S1.6 se reparten por tipo de área) + 20 digitales
});

test('columnas por S y por ítem tomadas del instrumento, y valores coherentes con el resultado', () => {
  const [fisico, digital] = construirHojas(datos());
  const titulos = fisico.columnas.map((c) => c.titulo);
  for (const esperado of ['Sitio', 'Área', 'Tipo de área', 'Resultado global (%)', 'Nivel', 'S1 Seiri (%)', 'S5 Shitsuke (%)', 'S1.1', 'S5.5', 'Versión del instrumento']) assert.ok(titulos.includes(esperado), `falta la columna ${esperado}`);
  assert.equal(titulos.filter((t) => /^S\d\.\d$/.test(t)).length, 26);
  assert.ok(digital.columnas.map((c) => c.titulo).includes('Equipo'));
  assert.equal(digital.columnas.filter((c) => /^D\d\.\d$/.test(c.titulo)).length, 20);
  // Cada fila tiene tantas celdas como columnas.
  for (const h of [fisico, digital]) for (const f of h.filas) assert.equal(f.length, h.columnas.length);
  const fila = fisico.filas.find((f) => f[0] === 'Central Uno');
  const col = (t) => fisico.columnas.findIndex((c) => c.titulo === t);
  assert.equal(fila[col('Tipo de área')], 'Operativa');
  assert.equal(fila[col('Primera evaluación')], 'Sí');
  assert.equal(typeof fila[col('Resultado global (%)')], 'number');
  assert.equal(fila[col('S1.2')], 'N/A'); // el segundo ítem se marcó N/A manual
  assert.equal(fila[col('S1.1')], 2);
});

test('el libro se genera como un zip válido con sus hojas y estilos', () => {
  return crearXlsx(construirHojas(datos())).arrayBuffer().then((buffer) => {
    const zip = leerZip(new Uint8Array(buffer));
    for (const n of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml', 'xl/worksheets/sheet3.xml']) assert.ok(zip[n], `falta ${n}`);
    assert.match(zip['xl/workbook.xml'], /<sheet name="Físico" sheetId="1"/);
    assert.match(zip['xl/workbook.xml'], /<sheet name="Ítems" sheetId="3"/);
    if (process.env.XLSX_SALIDA) writeFileSync(process.env.XLSX_SALIDA, Buffer.from(buffer));
  });
});

test('hojas con el mismo nombre no chocan', async () => {
  const col = [{ titulo: 'A' }];
  const zip = leerZip(new Uint8Array(await crearXlsx([{ nombre: 'Datos', columnas: col, filas: [] }, { nombre: 'datos', columnas: col, filas: [] }]).arrayBuffer()));
  assert.match(zip['xl/workbook.xml'], /name="Datos"[\s\S]*name="datos 2"/);
});
