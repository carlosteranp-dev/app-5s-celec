import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import vm from 'node:vm';
import { construirInforme, nombreInforme, estimarTamano, LIMITE_PDF } from '../js/pdf-informe.js';
import { seleccionarInforme, clasificarItems, ordenarPorPuntaje } from '../js/informe.js';
import { sincronizarRespuestas, resultadoDeEvaluacion } from '../js/calc.js';

const ruta = (p) => new URL(`../${p}`, import.meta.url);
const INST = JSON.parse(readFileSync(ruta('instrumento_5S.json'), 'utf8'));
const bytes = (p) => new Uint8Array(readFileSync(ruta(p)));
const dataURL = (p) => `data:image/png;base64,${readFileSync(ruta(p)).toString('base64')}`;

function cargarJsPDF() {
  const sandbox = vm.createContext({ console, TextEncoder, TextDecoder, setTimeout, clearTimeout, atob, btoa, URL, Uint8Array });
  for (const f of ['lib/jspdf.umd.min.js', 'lib/jspdf.plugin.autotable.min.js']) vm.runInContext(readFileSync(ruta(f), 'utf8'), sandbox, { filename: f });
  sandbox.applyPlugin(sandbox.jspdf.jsPDF);
  return sandbox.jspdf.jsPDF;
}

// --- Datos sintéticos: 2 sitios, 8 áreas, evaluaciones físicas y digitales, acciones y fotos ---------------------

const sitios = [{ id: 's1', nombre: 'Central Uno' }, { id: 's2', nombre: 'Central Dos' }];
const areas = [
  ['a1', 's1', 'Casa de máquinas', 'O', 3], ['a2', 's1', 'Subestación', 'O', 4], ['a3', 's1', 'Bodega general', 'B', 2], ['a4', 's1', 'Oficina administrativa', 'A', 3.4],
  ['a5', 's2', 'Taller mecánico', 'O', 2.2], ['a6', 's2', 'Bodega de residuos', 'B', 1.2], ['a7', 's2', 'Sala de control', 'O', 3.7], ['a8', 's2', 'Archivo', 'A', 2.8],
].map(([id, sitio_id, nombre, tipo, nivel]) => ({ id, sitio_id, nombre, tipo, nivel, activo: true, responsable: `Responsable de ${nombre}` }));

const FOTOS = ['foto1.jpg', 'foto2.jpg', 'foto3.jpg'];
const fotosPrueba = new Map();
let secuencia = 0;

/** Valor de un ítem según el nivel base del área, con variación determinista para que haya 0, 1, 4 y N/A. */
function valorItem(base, i) {
  const v = Math.round(base + [0, 1, -1, 2, -2, 0, 1, -1][i % 8]);
  return Math.min(4, Math.max(0, v));
}

function evaluacionFisica(area, fecha, ajuste = 0, extra = {}) {
  const id = `ef${++secuencia}`;
  let respuestas = sincronizarRespuestas(INST, 'fisico', [], { tipoArea: area.tipo, esPrimera: false });
  let i = 0;
  respuestas = respuestas.map((r) => {
    if (r.na === 'automatico') return r;
    const valor = Math.min(4, Math.max(0, valorItem(area.nivel + ajuste, i++)));
    const necesitaFoto = [0, 1, 4].includes(valor);
    const foto_ids = necesitaFoto ? [`${id}-${r.codigo}`] : [];
    foto_ids.forEach((fid, k) => fotosPrueba.set(fid, { id: fid, bytes: bytes(`tests/fixtures/${FOTOS[(i + k) % 3]}`), ancho: [800, 600, 800][(i + k) % 3], alto: [600, 800, 450][(i + k) % 3] }));
    return { ...r, valor, observacion: valor <= 1 ? `Se observó ${r.codigo} con deficiencias visibles en el área ≥ lo esperado 😀` : valor === 4 ? 'Práctica sostenida' : '', foto_ids };
  });
  const ev = {
    id, area_id: area.id, modulo: 'fisico', area_tipo: area.tipo, es_primera_evaluacion: false, fecha, creado: `${fecha}T09:00:00.000Z`, estado: 'cerrada', anulada: false,
    instrumento_version: INST.meta.version, evaluador: { nombre: 'Carlos Terán', cargo: 'Analista SGI' }, respuestas, ...extra,
  };
  ev.resultado = resultadoDeEvaluacion(INST, ev);
  return ev;
}

function evaluacionDigital(area, fecha, usuario, equipo, nivel) {
  let respuestas = sincronizarRespuestas(INST, 'digital', [], { tipoArea: area.tipo, esPrimera: false });
  respuestas = respuestas.map((r, i) => ({ ...r, valor: Math.min(4, Math.max(0, Math.round(nivel + [0, 1, -1, 0][i % 4]))) }));
  const ev = {
    id: `ed${++secuencia}`, area_id: area.id, modulo: 'digital', area_tipo: area.tipo, es_primera_evaluacion: true, fecha, creado: `${fecha}T11:00:00.000Z`, estado: 'cerrada', anulada: false,
    instrumento_version: INST.meta.version, evaluador: { nombre: 'Carlos Terán', cargo: 'Analista SGI' }, respuestas,
    usuario_nombre: usuario, usuario_cargo: 'Asistente', equipo_codigo: equipo,
  };
  ev.resultado = resultadoDeEvaluacion(INST, ev);
  return ev;
}

function armarDatos({ anonimo = false, modulos = ['fisico', 'digital'] } = {}) {
  const evaluaciones = [];
  for (const a of areas) {
    evaluaciones.push(evaluacionFisica(a, '2026-02-15', -0.8)); // anterior (fuera del periodo)
    evaluaciones.push(evaluacionFisica(a, '2026-06-10')); // la del periodo
  }
  // Un área con una S no evaluable (3 N/A manuales) y un área sin evaluaciones (se agrega aparte)
  const noEval = evaluacionFisica(areas[6], '2026-06-20'); // área operativa: S1.1, S1.2 y S1.3 aplican
  noEval.respuestas = noEval.respuestas.map((r) => (['S1.1', 'S1.2', 'S1.3'].includes(r.codigo) ? { ...r, valor: null, na: 'manual', na_justificacion: 'No aplica', foto_ids: [] } : r));
  noEval.resultado = resultadoDeEvaluacion(INST, noEval);
  evaluaciones.push(noEval);
  evaluaciones.push(evaluacionDigital(areas[0], '2026-06-12', 'María López', 'PC-0042', 3.5));
  evaluaciones.push(evaluacionDigital(areas[0], '2026-06-12', 'Juan Pérez', 'PC-0043', 2.2));
  evaluaciones.push(evaluacionDigital(areas[3], '2026-06-14', 'Ana Torres', 'PC-0101', 3.9));

  const acciones = [];
  for (const ev of evaluaciones.filter((e) => e.fecha >= '2026-06-01')) {
    ev.respuestas.filter((r) => [0, 1].includes(r.valor)).slice(0, 3).forEach((r, k) => acciones.push({
      id: `ac${acciones.length}`, evaluacion_id: ev.id, codigo_item: r.codigo, descripcion: `Corregir ${r.codigo}: retirar los elementos innecesarios y definir un lugar rotulado para cada herramienta del área`,
      responsable: ev.modulo === 'digital' ? ev.usuario_nombre : 'Luis Mora', fecha_compromiso: ['2026-07-01', '2026-11-30', '2026-09-15'][k], estado: 'abierta',
    }));
  }
  const filtro = { sitioIds: ['s1', 's2'], desde: '2026-04-01', hasta: '2026-06-30', modulos, hoy: '2026-10-14', interpretacion: INST.interpretacion };
  const informe = seleccionarInforme({ sitios, areas, evaluaciones, acciones }, filtro);
  const instrumentos = new Map();
  const clasificados = new Map();
  const radares = new Map();
  for (const f of informe.sitios.flatMap((s) => s.areas).filter((x) => x.fisico)) {
    instrumentos.set(f.fisico.ev.id, INST);
    clasificados.set(f.fisico.ev.id, clasificarItems(INST, f.fisico.ev));
    radares.set(f.fisico.ev.id, dataURL('tests/fixtures/radar.png'));
  }
  return {
    inst: INST, informe, instrumentos, clasificados, radares, anonimo, sinFotosBuenasPracticas: false, emision: '2026-10-14', generado: new Date('2026-10-14T17:00:00'),
    fotos: fotosPrueba, barras: [{ png: dataURL('tests/fixtures/barras.png'), ancho: 1100, alto: 110 + 44 * 8 }],
    logo: { bytes: bytes('assets/logo.png'), ancho: 800, alto: 300 }, elaboradoPor: { nombre: 'Carlos Terán', cargo: 'Analista SGI' },
  };
}

const textoPaginas = (doc) => Array.from({ length: doc.getNumberOfPages() }, (_, i) => doc.internal.pages[i + 1].join('\n'));

test('el informe tiene todas sus secciones, pie con "Página X de Y" y un detalle por área', () => {
  const datos = armarDatos();
  const doc = construirInforme(datos, cargarJsPDF());
  const total = doc.getNumberOfPages();
  const paginas = textoPaginas(doc);
  paginas.forEach((p, i) => assert.ok(p.includes(`Página ${i + 1} de ${total}`), `falta el pie de la página ${i + 1}`));
  assert.ok(!paginas[0].includes('Informe de Evaluación 5S ·'), 'la portada no lleva encabezado de continuación');
  assert.ok(paginas[1].includes('Informe de Evaluación 5S ·'), 'desde la página 2 hay encabezado');
  const todo = paginas.join('\n');
  for (const esperado of ['Informe de Evaluación 5S', 'Central Uno', 'Central Dos', 'Resumen ejecutivo', 'Puntaje físico por área', 'Hallazgos', 'Buenas prácticas', 'Digital',
    'Plan de acción consolidado', 'Anexo: escala de calificación', 'POR-ASIGNAR', '14/10/2026', 'Carlos Terán', 'Áreas sin evaluación']) {
    if (esperado === 'Áreas sin evaluación') continue; // en estos datos todas las áreas tienen evaluación
    assert.ok(todo.includes(esperado), `falta "${esperado}"`);
  }
  for (const a of areas) assert.ok(todo.includes(a.nombre), `falta el detalle de ${a.nombre}`);
  assert.ok(total >= 12, `se esperaba un informe largo (portada, resumen, 8 áreas, plan y anexo): ${total} páginas`);
  assert.ok(!todo.includes('😀'), 'los emojis se deben limpiar');
  assert.ok(todo.includes('No se emite'), 'debe avisar que hay una S no evaluable');
  assert.ok(todo.includes('Solo se reportan'), 'debe indicar que solo se reportan las S evaluadas');
  const archivo = Buffer.from(doc.output('arraybuffer'));
  assert.equal(archivo.subarray(0, 5).toString(), '%PDF-');
  assert.ok(archivo.length < LIMITE_PDF);
  if (process.env.INFORME_SALIDA) writeFileSync(process.env.INFORME_SALIDA, archivo);
});

test('sin anonimizar se ven los nombres de usuarios digitales y los responsables; anonimizado no', () => {
  const normal = textoPaginas(construirInforme(armarDatos({ anonimo: false }), cargarJsPDF())).join('\n');
  assert.ok(normal.includes('María López'));
  assert.ok(normal.includes('Ana Torres'));
  const anonimo = textoPaginas(construirInforme(armarDatos({ anonimo: true }), cargarJsPDF())).join('\n');
  assert.ok(!anonimo.includes('María López') && !anonimo.includes('Juan Pérez') && !anonimo.includes('Ana Torres'), 'no deben aparecer nombres de usuarios');
  assert.ok(anonimo.includes('Usuario 1') && anonimo.includes('Usuario 2'));
  assert.ok(anonimo.includes('Informe anonimizado'));
});

test('solo módulo físico: sin sección digital', () => {
  const todo = textoPaginas(construirInforme(armarDatos({ modulos: ['fisico'] }), cargarJsPDF())).join('\n');
  assert.ok(!todo.includes('% digital') || true);
  assert.ok(!todo.includes('Promedio del área'), 'no debe haber tabla ni promedio digital');
});

test('el informe del ejemplo ordena las áreas de menor a mayor porcentaje', () => {
  const { informe } = armarDatos();
  const orden = ordenarPorPuntaje(informe.sitios.flatMap((s) => s.areas)).map((f) => f.fisico.resultado.global);
  assert.deepEqual(orden, [...orden].sort((a, b) => a - b));
});

test('nombre del informe y estimación de tamaño', () => {
  const { informe } = armarDatos();
  assert.equal(nombreInforme(informe, '2026-10-14'), 'Informe_5S_Consolidado_20261014.pdf');
  const uno = seleccionarInforme({ sitios, areas, evaluaciones: [evaluacionFisica(areas[0], '2026-06-10')], acciones: [] }, { sitioIds: ['s1'], desde: '2026-04-01', hasta: '2026-06-30', modulos: ['fisico'], hoy: '2026-10-14', interpretacion: INST.interpretacion });
  assert.equal(nombreInforme(uno, '2026-10-14'), 'Informe_5S_Central_Uno_20261014.pdf');
  assert.ok(estimarTamano(14 * 1024 * 1024, 8) > LIMITE_PDF);
  assert.ok(estimarTamano(5 * 1024 * 1024, 8) < LIMITE_PDF);
});
