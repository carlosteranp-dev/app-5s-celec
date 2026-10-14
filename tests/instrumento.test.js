import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validarInstrumento, hashTexto, claveInstrumento } from '../js/instrumento.js';

const INST = JSON.parse(readFileSync(new URL('../instrumento_5S.json', import.meta.url), 'utf8'));
const copia = () => structuredClone(INST);
const errores = (inst) => validarInstrumento(inst).join(' | ');

test('el instrumento real es válido', () => {
  assert.deepEqual(validarInstrumento(INST), []);
});

test('detecta pesos que no suman 1', () => {
  const i = copia();
  i.modulos[0].pesos.S1 = 0.3;
  assert.match(errores(i), /suman 1[0-9.]*, deben sumar 1/);
});

test('detecta pesos faltantes o sobrantes', () => {
  const i = copia();
  delete i.modulos[1].pesos.D5;
  assert.match(errores(i), /una entrada por cada S/);
});

test('detecta códigos de ítem repetidos', () => {
  const i = copia();
  i.modulos[0].eses[0].items[1].codigo = 'S1.1';
  assert.match(errores(i), /Código de ítem repetido: S1\.1/);
});

test('detecta descriptores 0/2/4 faltantes', () => {
  for (const nivel of ['0', '2', '4']) {
    const i = copia();
    delete i.modulos[0].eses[2].items[0].descriptores[nivel];
    assert.match(errores(i), new RegExp(`falta el descriptor del nivel ${nivel}`));
  }
});

test('detecta tipos de área inexistentes en "aplica"', () => {
  const i = copia();
  i.modulos[0].eses[0].items[0].aplica = ['O', 'X'];
  assert.match(errores(i), /tipos de área inexistentes/);
});

test('detecta código de ítem que no corresponde a su S', () => {
  const i = copia();
  i.modulos[0].eses[0].items[0].codigo = 'S2.9';
  assert.match(errores(i), /debe empezar por "S1\."/);
});

test('detecta rangos de interpretación traslapados o con huecos grandes', () => {
  const traslape = copia();
  traslape.interpretacion[1].min = 39;
  assert.match(errores(traslape), /se traslapa/);
  const hueco = copia();
  hueco.interpretacion[2].min = 70;
  assert.match(errores(hueco), /hueco mayor a 1 punto/);
});

test('detecta una regla de S más débil que apunta a un nivel inexistente', () => {
  const i = copia();
  i.reglas.regla_s_mas_debil.nivel_asignado = 'Inventado';
  assert.match(errores(i), /nivel_asignado "Inventado" no existe/);
});

test('detecta escala incompleta y módulos faltantes', () => {
  const i = copia();
  i.escala.pop();
  i.modulos = i.modulos.filter((m) => m.id !== 'digital');
  const e = errores(i);
  assert.match(e, /niveles 0, 1, 2, 3 y 4/);
  assert.match(e, /Falta el módulo "digital"/);
});

test('el módulo digital necesita reglas de confidencialidad', () => {
  const i = copia();
  delete i.modulos[1].reglas_confidencialidad;
  assert.match(errores(i), /reglas_confidencialidad/);
});

test('entradas que no son un instrumento no rompen el validador', () => {
  assert.ok(validarInstrumento(null).length > 0);
  assert.ok(validarInstrumento({}).length > 0);
});

test('hash y clave: cambian con el contenido', () => {
  const a = hashTexto(JSON.stringify(INST));
  const i = copia();
  i.modulos[0].pesos = { S1: 0.4, S2: 0.15, S3: 0.15, S4: 0.15, S5: 0.15 };
  assert.notEqual(a, hashTexto(JSON.stringify(i)));
  assert.equal(a, hashTexto(JSON.stringify(copia())));
  assert.equal(claveInstrumento('1.0', 'abc'), '1.0|abc');
});
