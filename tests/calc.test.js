import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  calcularResultado, nivelPorRango, sincronizarRespuestas, problemasDeRespuesta, validarEvaluacion, avance,
  sumarMeses, promedioDigitalArea, tendencia, formatoGlobal, formatoPuntaje, descriptorNivel, itemsDelModulo, NIVEL_NO_EVALUABLE,
} from '../js/calc.js';

const INST = JSON.parse(readFileSync(new URL('../instrumento_5S.json', import.meta.url), 'utf8'));
const copia = () => structuredClone(INST);

/** Respuestas con el mismo valor en todos los ítems calificables. `valores` permite fijar ítems concretos ('NA' = N/A manual). */
function respuestas(inst, modulo, base, { tipoArea = 'O', esPrimera = false, valores = {} } = {}) {
  const sync = sincronizarRespuestas(inst, modulo, [], { tipoArea, esPrimera });
  return sync.map((r) => {
    if (r.na === 'automatico') return r;
    const v = r.codigo in valores ? valores[r.codigo] : base;
    return v === 'NA' ? { ...r, na: 'manual', na_justificacion: 'No existe en el área' } : { ...r, valor: v };
  });
}

/** Valores por ítem de una S para obtener un porcentaje exacto (5 ítems, 4 puntos cada uno = 20). */
const suma = (s, vals) => Object.fromEntries(vals.map((v, i) => [`${s}.${i + 1}`, v]));
const calc = (inst, modulo, resp, op = {}) => calcularResultado(inst, modulo, resp, { tipoArea: 'O', esPrimera: false, ...op });

test('todo 4 → 100 % y Sostenido', () => {
  const r = calc(INST, 'fisico', respuestas(INST, 'fisico', 4));
  assert.equal(r.global, 100);
  assert.equal(r.nivel, 'Sostenido');
  assert.equal(r.regla_s_debil_aplicada, false);
  assert.equal(r.parcial, false);
});

test('todo 0 → 0 % y Crítico', () => {
  const r = calc(INST, 'fisico', respuestas(INST, 'fisico', 0));
  assert.equal(r.global, 0);
  assert.equal(r.nivel, 'Crítico');
});

test('área administrativa: N/A automáticos y S2 evaluable con sus 2 ítems', () => {
  const resp = respuestas(INST, 'fisico', 4, { tipoArea: 'A' });
  const r = calc(INST, 'fisico', resp, { tipoArea: 'A' });
  const s2 = r.por_s.find((s) => s.id === 'S2');
  assert.equal(s2.n, 2);
  assert.equal(s2.na_automaticos, 3);
  assert.equal(s2.na_manuales, 0);
  assert.equal(s2.evaluable, true);
  assert.equal(r.global, 100);
  // Las automáticas se marcan solas en las respuestas
  assert.equal(resp.find((x) => x.codigo === 'S2.2').na, 'automatico');
});

test('área administrativa: un N/A manual en S2 la deja sin ítems suficientes', () => {
  const resp = respuestas(INST, 'fisico', 4, { tipoArea: 'A', valores: { 'S2.1': 'NA' } });
  const r = calc(INST, 'fisico', resp, { tipoArea: 'A' });
  assert.equal(r.por_s.find((s) => s.id === 'S2').evaluable, false);
  assert.equal(r.global, null);
});

test('3 N/A manuales en una S → no evaluable y sin resultado global', () => {
  const resp = respuestas(INST, 'fisico', 4, { valores: { 'S1.1': 'NA', 'S1.2': 'NA', 'S1.3': 'NA' } });
  const r = calc(INST, 'fisico', resp);
  const s1 = r.por_s.find((s) => s.id === 'S1');
  assert.equal(s1.evaluable, false);
  assert.match(s1.motivo_no_evaluable, /N\/A manuales/);
  assert.equal(r.global, null);
  assert.equal(r.nivel, NIVEL_NO_EVALUABLE);
  assert.equal(r.proxima_evaluacion, null);
});

test('2 N/A manuales sí se permiten (máximo del JSON)', () => {
  const resp = respuestas(INST, 'fisico', 4, { valores: { 'S1.1': 'NA', 'S1.2': 'NA' } });
  const r = calc(INST, 'fisico', resp);
  assert.equal(r.por_s.find((s) => s.id === 'S1').evaluable, true);
  assert.equal(r.global, 100);
});

test('primera evaluación: S5.2 y S5.3 son N/A automáticos y no cuentan para el máximo', () => {
  const resp = respuestas(INST, 'fisico', 4, { esPrimera: true });
  assert.equal(resp.find((x) => x.codigo === 'S5.2').na, 'automatico');
  assert.equal(resp.find((x) => x.codigo === 'S5.3').na, 'automatico');
  const r = calc(INST, 'fisico', resp, { esPrimera: true });
  const s5 = r.por_s.find((s) => s.id === 'S5');
  assert.equal(s5.n, 3);
  assert.equal(s5.na_automaticos, 2);
  assert.equal(s5.na_manuales, 0);
  assert.equal(r.global, 100);

  // Con 2 N/A manuales más, el máximo no se excede pero quedaría 1 ítem: no evaluable por mínimo de ítems
  const resp2 = respuestas(INST, 'fisico', 4, { esPrimera: true, valores: { 'S5.1': 'NA', 'S5.4': 'NA' } });
  const s5b = calc(INST, 'fisico', resp2, { esPrimera: true }).por_s.find((s) => s.id === 'S5');
  assert.equal(s5b.na_manuales, 2);
  assert.equal(s5b.evaluable, false);
  assert.match(s5b.motivo_no_evaluable, /Menos de 2/);

  // Con 1 N/A manual quedan 2 calificados: evaluable
  const resp3 = respuestas(INST, 'fisico', 4, { esPrimera: true, valores: { 'S5.1': 'NA' } });
  assert.equal(calc(INST, 'fisico', resp3, { esPrimera: true }).por_s.find((s) => s.id === 'S5').evaluable, true);
});

test('sincronizarRespuestas quita el N/A automático cuando deja de ser primera evaluación y conserva lo escrito', () => {
  let resp = sincronizarRespuestas(INST, 'fisico', [], { tipoArea: 'O', esPrimera: true });
  resp = resp.map((r) => (r.codigo === 'S5.1' ? { ...r, valor: 3, observacion: 'ok' } : r));
  const despues = sincronizarRespuestas(INST, 'fisico', resp, { tipoArea: 'O', esPrimera: false });
  assert.equal(despues.find((r) => r.codigo === 'S5.2').na, null);
  assert.equal(despues.find((r) => r.codigo === 'S5.1').valor, 3);
  assert.equal(despues.find((r) => r.codigo === 'S5.1').observacion, 'ok');
  assert.equal(despues.length, itemsDelModulo(INST, 'fisico').length);
});

test('promedio 85 % con una S en 55 % → En desarrollo, con la regla de la S más débil', () => {
  // S1 = 11/20 = 55 %; S2 = 100 %; S3 = 100 %; S4 = 90 %; S5 = 80 %  → (55 + 100 + 100 + 90 + 80) / 5 = 85
  const valores = {
    ...suma('S1', [3, 3, 3, 1, 1]),
    ...suma('S2', [4, 4, 4, 4, 4]),
    ...suma('S3', [4, 4, 4, 4, 4]),
    ...suma('S4', [4, 4, 4, 3, 3]),
    ...suma('S5', [4, 4, 3, 3, 2]),
  };
  const r = calc(INST, 'fisico', respuestas(INST, 'fisico', 0, { valores }));
  assert.equal(r.por_s.find((s) => s.id === 'S1').porcentaje, 55);
  assert.equal(r.global, 85);
  assert.equal(r.nivel_por_rango, 'Implementado');
  assert.equal(r.nivel, 'En desarrollo');
  assert.equal(r.regla_s_debil_aplicada, true);
  assert.deepEqual(r.s_debiles, ['S1']);
  assert.equal(r.reevaluar_meses, 3);
});

test('la regla de la S más débil no cambia niveles que no están bloqueados', () => {
  // Global 50 % (Inicial) con una S en 0 %: sigue Inicial
  const valores = { ...suma('S1', [0, 0, 0, 0, 0]), ...suma('S2', [4, 4, 4, 4, 4]), ...suma('S3', [4, 4, 4, 4, 4]), ...suma('S4', [2, 2, 2, 2, 2]), ...suma('S5', [0, 0, 0, 0, 0]) };
  const r = calc(INST, 'fisico', respuestas(INST, 'fisico', 0, { valores }));
  assert.equal(r.global, 50);
  assert.equal(r.nivel, 'Inicial');
  assert.equal(r.regla_s_debil_aplicada, false);
});

test('límites exactos de los rangos', () => {
  const caso = (valor, esperado) => assert.equal(nivelPorRango(valor, INST.interpretacion).nivel, esperado, `valor ${valor}`);
  caso(0, 'Crítico');
  caso(39.99, 'Crítico');
  caso(39.995, 'Crítico'); // cae en el hueco entre 39,99 y 40
  caso(40, 'Inicial');
  caso(59.99, 'Inicial');
  caso(59.995, 'Inicial');
  caso(60, 'En desarrollo');
  caso(79.99, 'En desarrollo');
  caso(80, 'Implementado');
  caso(89.99, 'Implementado');
  caso(90, 'Sostenido');
  caso(100, 'Sostenido');
});

test('límites exactos de nivel de punta a punta (sin error de punto flotante)', () => {
  // Cada S con 5 ítems: 20 puntos = 100 %; 8 → 40 %; 12 → 60 %; 16 → 80 %; 18 → 90 %
  const casos = [[[2, 2, 2, 2, 0], 'Inicial', 40], [[3, 3, 3, 3, 0], 'En desarrollo', 60], [[4, 4, 4, 4, 0], 'Implementado', 80], [[4, 4, 4, 3, 3], 'Sostenido', 90]];
  for (const [vals, nivel, pct] of casos) {
    const valores = Object.fromEntries(['S1', 'S2', 'S3', 'S4', 'S5'].flatMap((s) => Object.entries(suma(s, vals))));
    const r = calc(INST, 'fisico', respuestas(INST, 'fisico', 0, { valores }));
    assert.equal(r.global, pct);
    assert.equal(r.nivel, nivel);
  }
});

test('pesos distintos de 0,2', () => {
  const inst = copia();
  inst.modulos[0].pesos = { S1: 0.4, S2: 0.3, S3: 0.1, S4: 0.1, S5: 0.1 };
  // S1 = 100 %, el resto 0 % → 40 %
  const valores = suma('S1', [4, 4, 4, 4, 4]);
  const r = calc(inst, 'fisico', respuestas(inst, 'fisico', 0, { valores }));
  assert.equal(r.global, 40);
  assert.equal(r.nivel, 'Inicial');
  // S2 = 100 %, el resto 0 % → 30 %
  const r2 = calc(inst, 'fisico', respuestas(inst, 'fisico', 0, { valores: suma('S2', [4, 4, 4, 4, 4]) }));
  assert.equal(r2.global, 30);
  assert.equal(r2.nivel, 'Crítico');
});

test('un cambio de umbral o de nombre de nivel en el JSON se refleja sin tocar el código', () => {
  const inst = copia();
  inst.reglas.regla_s_mas_debil.umbral_porcentaje = 50;
  const valores = { ...suma('S1', [3, 3, 3, 1, 1]), ...suma('S2', [4, 4, 4, 4, 4]), ...suma('S3', [4, 4, 4, 4, 4]), ...suma('S4', [4, 4, 4, 3, 3]), ...suma('S5', [4, 4, 3, 3, 2]) };
  const r = calc(inst, 'fisico', respuestas(inst, 'fisico', 0, { valores }));
  assert.equal(r.global, 85);
  assert.equal(r.nivel, 'Implementado'); // 55 % ya no está por debajo del umbral de 50 %
});

test('ítems sin responder dan resultado provisional', () => {
  const resp = respuestas(INST, 'fisico', 4).map((r) => (r.codigo === 'S3.1' ? { ...r, valor: null } : r));
  const r = calc(INST, 'fisico', resp);
  assert.equal(r.parcial, true);
  assert.equal(r.pendientes, 1);
  assert.equal(r.por_s.find((s) => s.id === 'S3').n, 5);
});

test('módulo digital: todos los ítems aplican y se calcula igual', () => {
  const resp = respuestas(INST, 'digital', 4, { tipoArea: 'A' });
  assert.ok(resp.every((r) => r.na === null));
  const r = calc(INST, 'digital', resp, { tipoArea: 'A', esPrimera: true });
  assert.equal(r.global, 100);
  assert.equal(r.por_s.length, 5);
  // Con 4 ítems por S, 2 N/A manuales dejan 2 calificados: sigue evaluable
  const r2 = calc(INST, 'digital', respuestas(INST, 'digital', 4, { valores: { 'D1.1': 'NA', 'D1.2': 'NA' } }));
  assert.equal(r2.por_s[0].evaluable, true);
});

test('próxima evaluación: fecha + meses del nivel obtenido', () => {
  const r = calc(INST, 'fisico', respuestas(INST, 'fisico', 4), { fecha: '2026-10-14' });
  assert.equal(r.reevaluar_meses, 6);
  assert.equal(r.proxima_evaluacion, '2027-04-14');
  assert.equal(sumarMeses('2026-01-31', 1), '2026-02-28');
  assert.equal(sumarMeses('2024-01-31', 1), '2024-02-29');
  assert.equal(sumarMeses('2026-11-30', 3), '2027-02-28');
  assert.equal(sumarMeses('2026-10-14', 12), '2027-10-14');
});

test('validaciones por ítem: pendiente, foto, acción y justificación de N/A', () => {
  const base = { codigo: 'S1.1', valor: null, na: null, na_justificacion: '', observacion: '', foto_ids: [] };
  const p = (r, extra) => problemasDeRespuesta(INST, { ...base, ...r }, extra);
  assert.deepEqual(p({}), ['pendiente']);
  assert.deepEqual(p({ valor: 0 }), ['falta_foto', 'falta_accion']);
  assert.deepEqual(p({ valor: 0, foto_ids: ['f'] }, { accionesDelItem: 1 }), []);
  assert.deepEqual(p({ valor: 1, foto_ids: ['f'] }), ['falta_accion']);
  assert.deepEqual(p({ valor: 2 }), []);
  assert.deepEqual(p({ valor: 3 }), []);
  assert.deepEqual(p({ valor: 4 }), ['falta_foto']);
  assert.deepEqual(p({ valor: 4, foto_ids: ['f'] }), []);
  assert.deepEqual(p({ na: 'manual' }), ['na_sin_justificacion']);
  assert.deepEqual(p({ na: 'manual', na_justificacion: '  ' }), ['na_sin_justificacion']);
  assert.deepEqual(p({ na: 'manual', na_justificacion: 'No hay químicos' }), []);
  assert.deepEqual(p({ na: 'automatico' }), []);
});

test('validarEvaluacion y avance ignoran los N/A automáticos', () => {
  const ev = { modulo: 'fisico', area_tipo: 'A', es_primera_evaluacion: true, respuestas: respuestas(INST, 'fisico', 2, { tipoArea: 'A', esPrimera: true }) };
  assert.equal(validarEvaluacion(INST, ev).completo, true);
  const a = avance(INST, ev);
  assert.equal(a.total, 16); // 18 ítems de administrativa menos S5.2 y S5.3
  assert.equal(a.hechos, 16);
  ev.respuestas = ev.respuestas.map((r) => (r.codigo === 'S1.1' ? { ...r, valor: null } : r));
  const v = validarEvaluacion(INST, ev);
  assert.equal(v.completo, false);
  assert.deepEqual(Object.keys(v.porItem), ['S1.1']);
  assert.equal(avance(INST, ev).hechos, 15);
});

test('cantidad de ítems calificables por tipo de área coincide con el JSON', () => {
  const conteo = (tipo, primera) => avance(INST, { modulo: 'fisico', area_tipo: tipo, es_primera_evaluacion: primera, respuestas: [] }).total;
  assert.equal(conteo('O', false), 25);
  assert.equal(conteo('B', false), 23);
  assert.equal(conteo('A', false), 18);
  assert.equal(conteo('O', true), 23);
});

test('promedio digital del área excluye los no evaluables y los cuenta aparte', () => {
  const p = promedioDigitalArea([{ global: 80 }, { global: 90 }, { global: null }], INST.interpretacion);
  assert.equal(p.promedio, 85);
  assert.equal(p.evaluados, 2);
  assert.equal(p.excluidos, 1);
  assert.equal(p.nivel, 'Implementado');
  assert.equal(promedioDigitalArea([{ global: null }], INST.interpretacion).nivel, NIVEL_NO_EVALUABLE);
});

test('tendencia', () => {
  assert.equal(tendencia(70, 60), 'sube');
  assert.equal(tendencia(60, 70), 'baja');
  assert.equal(tendencia(60.4, 60), 'igual');
  assert.equal(tendencia(null, 60), null);
});

test('formato: 1 decimal; 2 decimales truncados si el redondeo cruzaría un nivel', () => {
  assert.equal(formatoPuntaje(55), '55,0 %');
  assert.equal(formatoGlobal(85, INST.interpretacion), '85,0 %');
  assert.equal(formatoGlobal(79.96, INST.interpretacion), '79,96 %');
  assert.equal(formatoGlobal(39.995, INST.interpretacion), '39,99 %');
  assert.equal(formatoGlobal(80, INST.interpretacion), '80,0 %');
  assert.equal(formatoGlobal(null, INST.interpretacion), '—');
});

test('descriptores: 0, 2 y 4 del ítem; 1 y 3 con el criterio general', () => {
  const item = INST.modulos[0].eses[0].items[0];
  assert.equal(descriptorNivel(INST, item, 0).texto, item.descriptores['0']);
  assert.equal(descriptorNivel(INST, item, 4).general, false);
  assert.equal(descriptorNivel(INST, item, 1).texto, INST.escala[1].criterio);
  assert.equal(descriptorNivel(INST, item, 3).general, true);
});

// ---------------------------------------------------------------------------
// Fase 2: acciones, cierre y atraso
// ---------------------------------------------------------------------------
import { accionCompleta, accionVacia, accionesPorItem, validarCierre, diasDeAtraso, resumenAccionesPrevias, resultadoDeEvaluacion } from '../js/calc.js';

const evaluacionCompleta = (base = 4, opciones = {}) => ({
  modulo: 'fisico', area_tipo: 'O', es_primera_evaluacion: false, fecha: '2026-10-14',
  respuestas: respuestas(INST, 'fisico', base, opciones).map((r) => (r.na === 'automatico' ? r : { ...r, foto_ids: ['f1'] })),
  firmas: { evaluador: 'data:image/png;base64,AAA', responsable: 'data:image/png;base64,BBB' },
});

test('una acción está completa solo con descripción, responsable y fecha', () => {
  const ok = { descripcion: 'Retirar chatarra', responsable: 'Juan', fecha_compromiso: '2026-11-01' };
  assert.equal(accionCompleta(ok), true);
  assert.equal(accionCompleta({ ...ok, descripcion: '  ' }), false);
  assert.equal(accionCompleta({ ...ok, responsable: '' }), false);
  assert.equal(accionCompleta({ ...ok, fecha_compromiso: '' }), false);
  assert.equal(accionCompleta(null), false);
  // la fecha de compromiso no puede ser anterior a la de la evaluación
  assert.equal(accionCompleta(ok, '2026-10-14'), true);
  assert.equal(accionCompleta(ok, '2026-12-01'), false);
  assert.equal(accionVacia({ descripcion: ' ', fecha_compromiso: '' }), true);
  assert.equal(accionVacia(ok), false);
});

test('accionesPorItem cuenta solo las completas', () => {
  const c = accionesPorItem([
    { codigo_item: 'S1.1', descripcion: 'a', responsable: 'b', fecha_compromiso: '2026-11-01' },
    { codigo_item: 'S1.1', descripcion: 'a', responsable: 'b', fecha_compromiso: '2026-11-02' },
    { codigo_item: 'S1.2', descripcion: 'a', responsable: '', fecha_compromiso: '2026-11-01' },
  ]);
  assert.deepEqual(c, { 'S1.1': 2 });
});

test('validarCierre: todo completo se puede cerrar', () => {
  const r = validarCierre(INST, evaluacionCompleta(4));
  assert.equal(r.puede, true);
  assert.deepEqual(r.pendientes, []);
});

test('validarCierre: ítems pendientes, 0 sin acción y 4 sin foto bloquean el cierre', () => {
  const ev = evaluacionCompleta(4);
  ev.respuestas = ev.respuestas.map((r) => (r.codigo === 'S1.1' ? { ...r, valor: null } : r.codigo === 'S1.2' ? { ...r, valor: 0 } : r.codigo === 'S1.3' ? { ...r, foto_ids: [] } : r));
  const r = validarCierre(INST, ev);
  assert.equal(r.puede, false);
  assert.ok(r.pendientes.includes('items'));
  assert.deepEqual(r.items['S1.1'], ['pendiente']);
  assert.deepEqual(r.items['S1.2'], ['falta_accion']); // tiene foto, falta la acción
  assert.deepEqual(r.items['S1.3'], ['falta_foto']);
  // con la acción completa del S1.2 y la foto de S1.3 ya no bloquean
  ev.respuestas = ev.respuestas.map((x) => (x.codigo === 'S1.1' ? { ...x, valor: 3 } : x.codigo === 'S1.3' ? { ...x, foto_ids: ['f'] } : x));
  const acciones = [{ codigo_item: 'S1.2', descripcion: 'x', responsable: 'y', fecha_compromiso: '2026-11-01' }];
  assert.equal(validarCierre(INST, ev, { acciones }).puede, true);
});

test('validarCierre: firmas obligatorias; el responsable puede justificar su ausencia', () => {
  const sinFirmas = { ...evaluacionCompleta(4), firmas: { evaluador: null, responsable: null } };
  assert.deepEqual(validarCierre(INST, sinFirmas).pendientes, ['firma_evaluador', 'firma_responsable']);
  const ausente = { ...sinFirmas, firmas: { evaluador: 'x', responsable: null }, firma_responsable_ausente: 'Estaba de vacaciones' };
  assert.equal(validarCierre(INST, ausente).puede, true);
  const ausenteVacio = { ...ausente, firma_responsable_ausente: '  ' };
  assert.deepEqual(validarCierre(INST, ausenteVacio).pendientes, ['firma_responsable']);
});

test('validarCierre: una S no evaluable no impide cerrar si todo está respondido', () => {
  const ev = evaluacionCompleta(4, { valores: { 'S1.1': 'NA', 'S1.2': 'NA', 'S1.3': 'NA' } });
  ev.respuestas = ev.respuestas.map((r) => (r.na === 'manual' ? { ...r, foto_ids: [] } : r));
  assert.equal(validarCierre(INST, ev).puede, true);
  assert.equal(resultadoDeEvaluacion(INST, ev).global, null);
});

test('diasDeAtraso', () => {
  assert.equal(diasDeAtraso('2026-10-01', '2026-10-14'), 13);
  assert.equal(diasDeAtraso('2026-10-14', '2026-10-14'), 0);
  assert.equal(diasDeAtraso('2026-11-01', '2026-10-14'), 0);
  assert.equal(diasDeAtraso('2026-02-27', '2026-03-02'), 3);
});

test('resumenAccionesPrevias: cerradas a tiempo sobre las vencidas o cerradas', () => {
  const acciones = [
    { estado: 'cerrada', fecha_compromiso: '2026-09-10', fecha_cierre: '2026-09-09T10:00:00Z' }, // a tiempo
    { estado: 'cerrada', fecha_compromiso: '2026-09-10', fecha_cierre: '2026-09-20T10:00:00Z' }, // tarde
    { estado: 'abierta', fecha_compromiso: '2026-09-30', fecha_cierre: null }, // vencida abierta
    { estado: 'abierta', fecha_compromiso: '2026-12-30', fecha_cierre: null }, // aún en plazo: no cuenta
  ];
  const r = resumenAccionesPrevias(acciones, '2026-10-14');
  assert.deepEqual(r, { total: 3, a_tiempo: 1, porcentaje: 33.333333333 });
  assert.equal(resumenAccionesPrevias([], '2026-10-14').porcentaje, null);
});
