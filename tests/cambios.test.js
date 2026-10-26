// Cambios de octubre: "N/A foto", tipo de área corregible, S1.4 sin lo digital y residuos de oficina en áreas administrativas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { calcularResultado, esNaAutomatico, itemsDelModulo, problemasDeRespuesta, sincronizarRespuestas } from '../js/calc.js';

const INST = JSON.parse(readFileSync(new URL('../instrumento_5S.json', import.meta.url), 'utf8'));

const base = { codigo: 'S1.1', valor: null, na: null, na_justificacion: '', observacion: '', foto_ids: [], foto_na: false };
const problemas = (r, accionesDelItem = 0) => problemasDeRespuesta(INST, { ...base, ...r }, { accionesDelItem });

test('"N/A foto": no se pide foto en 0, 1 ni 4, pero la acción de 0 y 1 sigue siendo obligatoria', () => {
  assert.deepEqual(problemas({ valor: 0, foto_na: true }), ['falta_accion']);
  assert.deepEqual(problemas({ valor: 0, foto_na: true }, 1), []);
  assert.deepEqual(problemas({ valor: 1, foto_na: true }, 1), []);
  assert.deepEqual(problemas({ valor: 4, foto_na: true }), []);
  assert.deepEqual(problemas({ valor: 4, foto_na: false }), ['falta_foto']);
  assert.deepEqual(problemas({ valor: 0, foto_na: false }, 1), ['falta_foto']);
  assert.deepEqual(problemas({ valor: 2 }), []);
});

test('N/A (manual o automático) no pide foto ni acción, aunque el ítem tuviera una calificación guardada', () => {
  const manual = { valor: 0, na: 'manual', na_justificacion: 'No existe' };
  assert.deepEqual(problemas(manual), []);
  assert.deepEqual(problemas({ ...manual, na: 'automatico' }), []);
  assert.deepEqual(problemas({ ...manual, na_justificacion: '' }), ['na_sin_justificacion']);
});

test('corregir el tipo de área no pierde lo calificado: al volver al tipo anterior se recupera', () => {
  let resp = sincronizarRespuestas(INST, 'fisico', [], { tipoArea: 'O', esPrimera: false });
  resp = resp.map((r) => (r.codigo === 'S2.2' ? { ...r, valor: 3, observacion: 'Tablero incompleto', foto_ids: ['f1'] } : r));

  const adm = sincronizarRespuestas(INST, 'fisico', resp, { tipoArea: 'A', esPrimera: false });
  const enAdm = adm.find((r) => r.codigo === 'S2.2');
  assert.equal(enAdm.na, 'automatico');
  assert.equal(enAdm.valor, 3);
  assert.deepEqual(enAdm.foto_ids, ['f1']);
  // mientras es N/A automático no cuenta en el resultado
  const rAdm = calcularResultado(INST, 'fisico', adm, { tipoArea: 'A', esPrimera: false });
  assert.equal(rAdm.por_s.find((s) => s.id === 'S2').calificados, 0);

  const deNuevo = sincronizarRespuestas(INST, 'fisico', adm, { tipoArea: 'O', esPrimera: false }).find((r) => r.codigo === 'S2.2');
  assert.equal(deNuevo.na, null);
  assert.equal(deNuevo.valor, 3);
  assert.equal(deNuevo.observacion, 'Tablero incompleto');
});

test('S1.4 es solo de documentos físicos; en la S1 administrativa los residuos de oficina (S1.6) reemplazan a los de chatarra (S1.5)', () => {
  const porCodigo = Object.fromEntries(itemsDelModulo(INST, 'fisico').map(({ item }) => [item.codigo, item]));
  assert.ok(!/digital/i.test(porCodigo['S1.4'].texto), 'lo digital va solo en 5S Digital');
  assert.deepEqual(porCodigo['S1.5'].aplica, ['O', 'B']);
  assert.deepEqual(porCodigo['S1.6'].aplica, ['A']);
  assert.match(porCodigo['S1.6'].texto, /oficina/i);
  assert.ok(!/chatarra/i.test(porCodigo['S1.6'].texto));

  const aplicables = (tipo) => itemsDelModulo(INST, 'fisico')
    .filter(({ item }) => item.codigo.startsWith('S1.') && !esNaAutomatico(INST, item, tipo, false))
    .map(({ item }) => item.codigo);
  assert.ok(aplicables('A').includes('S1.6') && !aplicables('A').includes('S1.5'));
  assert.ok(aplicables('O').includes('S1.5') && !aplicables('O').includes('S1.6'));
  assert.ok(aplicables('B').includes('S1.5') && !aplicables('B').includes('S1.6'));
  // la cantidad de ítems calificables por tipo no cambia con la nueva versión
  const total = (tipo) => itemsDelModulo(INST, 'fisico').filter(({ item }) => !esNaAutomatico(INST, item, tipo, false)).length;
  assert.deepEqual([total('O'), total('B'), total('A')], [25, 23, 18]);
});
