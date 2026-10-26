import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { areasDeLocalidad, localidadesDisponibles, nombreAreaCatalogo, validarCatalogo } from '../js/catalogo.js';

const leer = (p) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'));
const INST = leer('instrumento_5S.json');
const CAT = leer('catalogo_sitios.json');
const TIPOS = INST.tipos_area.map((t) => t.codigo);

test('el catálogo del listado es válido: 6 localidades, 68 áreas, tipos que existen y nombres sin repetir', () => {
  assert.deepEqual(validarCatalogo(CAT, TIPOS), []);
  assert.equal(CAT.localidades.length, 6);
  assert.equal(CAT.localidades.reduce((n, l) => n + l.areas.length, 0), 68);
});

test('el nombre del área incluye el sector y no lo repite si es igual al nombre', () => {
  assert.equal(nombreAreaCatalogo({ sector: 'CASA DE MAQUINAS', nombre: 'OFICINAS' }), 'CASA DE MAQUINAS – OFICINAS');
  assert.equal(nombreAreaCatalogo({ sector: 'Bodega', nombre: 'bodega' }), 'bodega');
  assert.equal(nombreAreaCatalogo({ sector: '', nombre: 'Taller' }), 'Taller');
});

test('validarCatalogo detecta repetidos, nombres vacíos y tipos inexistentes', () => {
  const malo = { localidades: [
    { nombre: 'A', areas: [{ sector: 'S', nombre: 'X', tipo_sugerido: 'O' }, { sector: 's', nombre: 'x', tipo_sugerido: 'Z' }] },
    { nombre: 'a', areas: [] },
    { nombre: ' ', areas: [] },
  ] };
  const e = validarCatalogo(malo, TIPOS).join(' | ');
  assert.match(e, /área repetida/);
  assert.match(e, /tipo "Z" no existe/);
  assert.match(e, /Localidad repetida/);
  assert.match(e, /sin nombre/);
  assert.equal(validarCatalogo({ localidades: [] }, TIPOS).length, 1);
});

test('lo ya agregado se reconoce aunque cambien tildes o mayúsculas', () => {
  const nombres = CAT.localidades.map((l) => l.nombre);
  const alazan = nombres.find((n) => /alaz/i.test(n));
  const disponibles = localidadesDisponibles(CAT, [{ id: 's1', nombre: alazan.toUpperCase().replace('Á', 'A') }, { id: 's2', nombre: 'Un sitio propio' }]);
  assert.equal(disponibles.length, CAT.localidades.length);
  assert.equal(disponibles.find((l) => l.nombre === alazan).existente.id, 's1');
  assert.equal(disponibles.filter((l) => l.existente).length, 1);

  const loc = CAT.localidades[0];
  const primera = nombreAreaCatalogo(loc.areas[0]);
  const areas = areasDeLocalidad(CAT, loc.nombre.toUpperCase(), [{ id: 'a1', nombre: primera.toLowerCase() }]);
  assert.equal(areas.length, loc.areas.length);
  assert.equal(areas[0].existente.id, 'a1');
  assert.equal(areas.filter((a) => a.existente).length, 1);
  assert.deepEqual(areasDeLocalidad(CAT, 'Sitio que no está en el listado'), []);
});

test('tipos sugeridos coherentes: oficinas y archivos son administrativos, bodegas B, talleres operativos', () => {
  // Las áreas con varios usos ("A + B", "X Y Z") son ambiguas: la sugerencia es editable y no se prueba.
  const todas = CAT.localidades.flatMap((l) => l.areas.map((a) => ({ nombre: a.nombre, tipo: a.tipo_sugerido }))).filter((a) => !/ \+ | Y /.test(a.nombre));
  for (const a of todas.filter((x) => /archivo|cafeter|comedor/i.test(x.nombre))) assert.equal(a.tipo, 'A', a.nombre);
  for (const a of todas.filter((x) => /bodega/i.test(x.nombre) && !/oficina/i.test(x.nombre))) assert.equal(a.tipo, 'B', a.nombre);
  for (const a of todas.filter((x) => /taller/i.test(x.nombre) && !/oficina|bodega/i.test(x.nombre))) assert.equal(a.tipo, 'O', a.nombre);
});
