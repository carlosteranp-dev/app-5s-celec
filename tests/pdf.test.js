import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import vm from 'node:vm';
import { construirActa, limpiarTexto, nombreActa } from '../js/pdf.js';
import { nombreArchivo } from '../js/entrega.js';
import { sincronizarRespuestas, resultadoDeEvaluacion } from '../js/calc.js';

const ruta = (p) => new URL(`../${p}`, import.meta.url);
const INST = JSON.parse(readFileSync(ruta('instrumento_5S.json'), 'utf8'));
const bytes = (p) => new Uint8Array(readFileSync(ruta(p)));
const dataURL = (p, tipo) => `data:${tipo};base64,${readFileSync(ruta(p)).toString('base64')}`;

/** jsPDF y autotable se cargan como en el navegador (scripts UMD en un contexto aislado). */
function cargarJsPDF() {
  const sandbox = vm.createContext({ console, TextEncoder, TextDecoder, setTimeout, clearTimeout, atob, btoa, URL, Uint8Array });
  for (const f of ['lib/jspdf.umd.min.js', 'lib/jspdf.plugin.autotable.min.js']) vm.runInContext(readFileSync(ruta(f), 'utf8'), sandbox, { filename: f });
  sandbox.applyPlugin(sandbox.jspdf.jsPDF);
  return sandbox.jspdf.jsPDF;
}

function evaluacionDeEjemplo({ modulo = 'fisico', anulada = false } = {}) {
  const tipoArea = 'A';
  let respuestas = sincronizarRespuestas(INST, modulo, [], { tipoArea, esPrimera: false });
  const valores = { 'S1.1': 0, 'S1.2': 1, 'S1.4': 4, 'S1.5': 'NA', 'S2.1': 3, 'S2.4': 4, 'S3.1': 2, 'S3.4': 4, 'S3.5': 3, 'S4.1': 2, 'S4.3': 3, 'S4.4': 4, 'S4.5': 3, 'S5.1': 3, 'S5.2': 2, 'S5.3': 3, 'S5.4': 4, 'S5.5': 2 };
  respuestas = respuestas.map((r, i) => {
    if (r.na === 'automatico') return r;
    if (modulo === 'digital') return { ...r, valor: [4, 3, 2, 1, 0][i % 5] };
    const v = valores[r.codigo];
    if (v === 'NA') return { ...r, na: 'manual', na_justificacion: 'No hay residuos en la oficina' };
    return { ...r, valor: v ?? 3, observacion: r.codigo === 'S1.1' ? 'Hay cajas de archivo en desuso ≥ 6 meses 😀 junto a la ventana' : '' };
  });
  const ev = {
    id: 'ev-1', modulo, area_tipo: tipoArea, es_primera_evaluacion: false, fecha: '2026-10-14', fecha_cierre: '2026-10-14T16:30:00.000Z',
    evaluador: { nombre: 'Carlos Terán', cargo: 'Analista SGI' }, personas_presentes: 'Ana Torres, Luis Mora', estado: 'cerrada', anulada,
    respuestas, firmas: { evaluador: dataURL('tests/fixtures/firma.png', 'image/png'), responsable: null }, firmante_responsable: 'Ana Torres',
    firma_responsable_ausente: 'Se encontraba en comisión de servicios',
    ...(anulada ? { anulada_motivo: 'Se calificó el área equivocada', anulada_fecha: '2026-10-15T09:00:00.000Z' } : {}),
    ...(modulo === 'digital' ? { usuario_nombre: 'María López', usuario_cargo: 'Asistente', equipo_codigo: 'PC-0042', confidencialidad_aceptada: true } : {}),
  };
  ev.resultado = resultadoDeEvaluacion(INST, ev);
  return ev;
}

const datos = (ev) => ({
  inst: INST, ev, resultado: ev.resultado, generado: new Date('2026-10-14T17:00:00'),
  area: { nombre: 'Oficina administrativa', responsable: 'Ana Torres – Jefa administrativa' },
  sitio: { nombre: 'Central de Prueba' },
  acciones: [
    { codigo_item: 'S1.1', descripcion: 'Retirar las cajas de archivo en desuso y enviarlas a archivo pasivo', responsable: 'Ana Torres', fecha_compromiso: '2026-11-05', estado: 'abierta' },
    { codigo_item: 'S1.2', descripcion: 'Implementar tarjeta roja', responsable: 'Luis Mora', fecha_compromiso: '2026-11-20', estado: 'cerrada', fecha_cierre: '2026-11-18T10:00:00Z' },
  ],
  fotos: [
    { id: 'f1', codigo: 'S1.1', rotulo: 'S1.1 · nivel 0', bytes: bytes('tests/fixtures/foto1.jpg'), ancho: 800, alto: 600 },
    { id: 'f2', codigo: 'S1.2', rotulo: 'S1.2 · nivel 1', bytes: bytes('tests/fixtures/foto2.jpg'), ancho: 600, alto: 800 },
    { id: 'f3', codigo: 'S1.4', rotulo: 'S1.4 · nivel 4', bytes: bytes('tests/fixtures/foto3.jpg'), ancho: 800, alto: 450 },
    { id: 'f4', codigo: 'S2.4', rotulo: 'S2.4 · nivel 4', bytes: bytes('tests/fixtures/foto1.jpg'), ancho: 800, alto: 600 },
  ],
  radarPNG: dataURL('tests/fixtures/radar.png', 'image/png'),
  logo: { bytes: bytes('assets/logo.png'), ancho: 800, alto: 300 },
});

/** Texto de todas las páginas, para comprobar contenido sin abrir el PDF. */
const textoPaginas = (doc) => Array.from({ length: doc.getNumberOfPages() }, (_, i) => doc.internal.pages[i + 1].join('\n'));

test('el acta se genera con pie "Página X de Y", encabezado desde la página 2 y contenido esperado', () => {
  const jsPDF = cargarJsPDF();
  const doc = construirActa(datos(evaluacionDeEjemplo()), jsPDF);
  const total = doc.getNumberOfPages();
  assert.ok(total >= 2, `se esperaban varias páginas, hubo ${total}`);
  const paginas = textoPaginas(doc);
  paginas.forEach((p, i) => assert.ok(p.includes(`Página ${i + 1} de ${total}`), `falta el pie de la página ${i + 1}`));
  assert.ok(!paginas[0].includes('Acta de Evaluación 5S ·'), 'la página 1 no lleva el encabezado de continuación');
  assert.ok(paginas[1].includes('Acta de Evaluación 5S'), 'la página 2 lleva encabezado');
  const todo = paginas.join('\n');
  for (const esperado of ['POR-ASIGNAR', '1.0-borrador', 'Puntajes por S', 'Detalle de ítems', 'Evidencia fotográfica', 'Acciones correctivas', 'Firmas', 'No estuvo presente']) {
    assert.ok(todo.includes(esperado), `falta "${esperado}"`);
  }
  assert.ok(!todo.includes('😀'), 'el emoji se debe limpiar');
  const archivo = Buffer.from(doc.output('arraybuffer'));
  assert.equal(archivo.subarray(0, 5).toString(), '%PDF-');
  if (process.env.ACTA_SALIDA) writeFileSync(process.env.ACTA_SALIDA, archivo);
});

test('un acta anulada lo indica con el motivo', () => {
  const doc = construirActa(datos(evaluacionDeEjemplo({ anulada: true })), cargarJsPDF());
  const todo = textoPaginas(doc).join('\n');
  assert.ok(todo.includes('EVALUACIÓN ANULADA'));
  assert.ok(todo.includes('Se calificó el área equivocada'));
});

test('acta digital: usuario, equipo y confidencialidad; firma del usuario', () => {
  const ev = evaluacionDeEjemplo({ modulo: 'digital' });
  const d = { ...datos(ev), fotos: [], acciones: [] };
  const doc = construirActa(d, cargarJsPDF());
  const todo = textoPaginas(doc).join('\n');
  for (const esperado of ['María López', 'PC-0042', 'Reglas aceptadas por el usuario', 'Usuario del equipo', 'No se registraron acciones']) assert.ok(todo.includes(esperado), `falta "${esperado}"`);
  assert.ok(!todo.includes('Evidencia fotográfica'));
});

test('limpiarTexto conserva acentos y quita emojis o símbolos que Helvetica no dibuja', () => {
  assert.equal(limpiarTexto('Ñandú ≥ 6 meses 😀 ✓ ok'), 'Ñandú >= 6 meses ok');
  assert.equal(limpiarTexto('«así debe verse» – "ok"'), '«así debe verse» – "ok"');
  assert.equal(limpiarTexto(null), '');
});

test('nombres de archivo sin espacios ni tildes', () => {
  const area = { nombre: 'Casa de máquinas Nº 2' };
  assert.equal(nombreActa({ modulo: 'fisico', fecha: '2026-10-14' }, area), 'Acta_5S_Casa_de_maquinas_N_2_20261014.pdf');
  assert.equal(nombreActa({ modulo: 'digital', fecha: '2026-10-14', equipo_codigo: 'PC 0042/B' }, area), 'Acta_5S_Digital_Casa_de_maquinas_N_2_PC_0042_B_20261014.pdf');
  assert.equal(nombreArchivo(['Informe', '5S', 'Consolidado'], '2026-10-14'), 'Informe_5S_Consolidado_20261014.pdf');
});
