import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluacionesPendientes, seleccionarParaExportar, nombreRespaldo, validarArchivo, planificarImportacion, SCHEMA_VERSION } from '../js/respaldo.js';

const AHORA = '2026-10-14T20:00:00.000Z';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T = (dia) => `2026-09-${String(dia).padStart(2, '0')}T10:00:00.000Z`;
const JPEG = '/9j/4AAQSkZJRgABAQ'; // inicio de un JPEG en base64

const sitio = (n, nombre, mod = 5) => ({ id: id(n), creado: T(1), modificado: T(mod), dispositivo_id: id(900), nombre, ubicacion: 'Loja', activo: true });
const area = (n, sitioN, nombre, tipo = 'O', mod = 5) => ({ id: id(n), creado: T(1), modificado: T(mod), dispositivo_id: id(900), sitio_id: id(sitioN), nombre, tipo, responsable: 'R', activo: true });
const resp = (codigo, extra = {}) => ({ codigo, valor: 3, na: null, na_justificacion: '', observacion: '', foto_ids: [], ...extra });
const evaluacion = (n, areaN, extra = {}) => ({
  id: id(n), creado: T(2), modificado: T(10), dispositivo_id: id(900), area_id: id(areaN), area_tipo: 'O', modulo: 'fisico', fecha: '2026-09-10',
  evaluador: { nombre: 'Ana', cargo: 'Analista' }, instrumento_version: '1.0', instrumento_hash: 'abc', estado: 'cerrada', es_primera_evaluacion: false,
  personas_presentes: '', observacion_general: '', respuestas: [resp('S1.1'), resp('S1.2')], resultado: { global: 70, nivel: 'En desarrollo' },
  firmas: { evaluador: null, responsable: null }, firmante_responsable: 'R', fecha_cierre: T(10), anulada: false, exportado_en: null, ...extra,
});
const accion = (n, evN, extra = {}) => ({ id: id(n), creado: T(3), modificado: T(11), dispositivo_id: id(900), evaluacion_id: id(evN), codigo_item: 'S1.1', descripcion: 'Hacer algo', responsable: 'Luis', fecha_compromiso: '2026-10-01', estado: 'abierta', fecha_cierre: null, ...extra });
const foto = (n, evN, codigo = 'S1.1') => ({ id: id(n), creado: T(4), modificado: T(4), dispositivo_id: id(900), evaluacion_id: id(evN), codigo_item: codigo, ancho: 1280, alto: 853, fecha: T(4), blob_b64: JPEG, miniatura_b64: JPEG });
const instrumento = (clave, version = '1.0', hash = 'abc') => ({ clave, version, hash, json: { meta: { version } }, guardado: T(1) });

const archivo = (partes = {}) => ({
  tipo: 'respaldo_5s', schema_version: SCHEMA_VERSION, exportado_en: AHORA, dispositivo_id: id(900), sitios: [], areas: [], evaluaciones: [], acciones: [], fotos: [], instrumentos: [], ...partes,
});
const vacio = () => ({ sitios: [], areas: [], evaluaciones: [], acciones: [], fotoIds: new Set(), instrumentos: [] });
const plan = (a, local = vacio(), opciones = {}) => planificarImportacion(a, local, { ahora: AHORA, ...opciones });

/** Simula guardar el plan en el dispositivo local (para comprobar que importar dos veces no cambia nada). */
function aplicarEnMemoria(local, p) {
  const copia = { ...local, sitios: [...local.sitios], areas: [...local.areas], evaluaciones: [...local.evaluaciones], acciones: [...local.acciones], fotoIds: new Set(local.fotoIds), instrumentos: [...local.instrumentos] };
  const reemplazar = (lista, nuevos, clave = 'id') => nuevos.forEach((n) => { const i = lista.findIndex((x) => x[clave] === n[clave]); if (i >= 0) lista[i] = n; else lista.push(n); });
  reemplazar(copia.sitios, p.poner.sitios);
  reemplazar(copia.areas, p.poner.areas);
  reemplazar(copia.evaluaciones, p.poner.evaluaciones);
  reemplazar(copia.acciones, p.poner.acciones);
  reemplazar(copia.instrumentos, p.poner.instrumentos, 'clave');
  p.poner.fotos.forEach((f) => copia.fotoIds.add(f.id));
  return copia;
}

// --- Qué se exporta ----------------------------------------------------------

test('pendientes de exportar: nunca exportada, modificada después, o con una acción modificada después', () => {
  const evs = [
    evaluacion(1, 10, { exportado_en: null }),
    evaluacion(2, 10, { modificado: T(10), exportado_en: T(12) }), // al día
    evaluacion(3, 10, { modificado: T(15), exportado_en: T(12) }), // modificada después
    evaluacion(4, 10, { modificado: T(10), exportado_en: T(12) }), // al día, pero su acción cambió
    evaluacion(5, 10, { estado: 'borrador' }), // los borradores no cuentan
  ];
  const acc = [accion(50, 4, { modificado: T(20) }), accion(51, 2, { modificado: T(11) })];
  assert.deepEqual(evaluacionesPendientes(evs, acc).sort(), [id(1), id(3), id(4)].sort());
});

test('selección para exportar: solo pendientes, con borradores o solo catálogo', () => {
  const evs = [evaluacion(1, 10), evaluacion(2, 10, { exportado_en: T(25) }), evaluacion(3, 10, { estado: 'borrador' })];
  const sel = (o) => seleccionarParaExportar({ evaluaciones: evs, acciones: [] }, o).sort();
  assert.deepEqual(sel({}), [id(1), id(2)].sort()); // todas las cerradas, sin borradores
  assert.deepEqual(sel({ soloPendientes: true }), [id(1)]);
  assert.deepEqual(sel({ incluirBorradores: true }), [id(1), id(2), id(3)].sort());
  assert.deepEqual(sel({ soloPendientes: true, incluirBorradores: true }), [id(1), id(3)].sort());
  assert.deepEqual(sel({ soloCatalogo: true, incluirBorradores: true }), []);
});

test('nombre del respaldo sin tildes ni espacios', () => {
  assert.equal(nombreRespaldo('José Núñez Pérez', new Date(2026, 9, 14, 8, 5)), 'Respaldo_5S_Jose_Nunez_Perez_20261014-0805.json');
  assert.equal(nombreRespaldo('', new Date(2026, 0, 2, 23, 59)), 'Respaldo_5S_evaluador_20260102-2359.json');
});

// --- Validación ----------------------------------------------------------------

test('validación: un archivo correcto no tiene errores', () => {
  const a = archivo({ sitios: [sitio(1, 'S')], areas: [area(10, 1, 'A')], evaluaciones: [evaluacion(100, 10)], acciones: [accion(200, 100)], fotos: [foto(300, 100)], instrumentos: [instrumento('1.0|abc')],
    conteos: { sitios: 1, areas: 1, evaluaciones: 1, acciones: 1, fotos: 1, instrumentos: 1 } });
  assert.deepEqual(validarArchivo(a).errores, []);
});

test('validación: archivos que no son un respaldo, de esquema más nuevo, incompletos o con datos inválidos', () => {
  assert.match(validarArchivo(null).errores[0], /no es un respaldo/);
  assert.match(validarArchivo({ hola: 1 }).errores[0], /no es un respaldo/);
  assert.match(validarArchivo(archivo({ schema_version: SCHEMA_VERSION + 1 })).errores[0], /versión más nueva/);
  assert.match(validarArchivo(archivo({ schema_version: undefined })).errores[0], /versión de su formato/);
  const sinLista = archivo(); delete sinLista.fotos;
  assert.match(validarArchivo(sinLista).errores[0], /"fotos"/);
  assert.match(validarArchivo(archivo({ conteos: { evaluaciones: 3 }, evaluaciones: [evaluacion(1, 10)] })).errores[0], /incompleto.*3 registros y tiene 1/);
  assert.match(validarArchivo(archivo({ sitios: [{ ...sitio(1, 'S'), id: 'x' }] })).errores[0], /identificador inválido/);
  assert.match(validarArchivo(archivo({ sitios: [{ ...sitio(1, 'S'), modificado: 'ayer' }] })).errores[0], /fecha de modificación/);
  assert.match(validarArchivo(archivo({ evaluaciones: [{ ...evaluacion(1, 10), modulo: 'otro' }] })).errores[0], /módulo desconocido/);
  assert.match(validarArchivo(archivo({ evaluaciones: [{ ...evaluacion(1, 10), fecha: '14/10/2026' }] })).errores[0], /fecha inválida/);
  assert.match(validarArchivo(archivo({ fotos: [{ ...foto(300, 100), blob_b64: 'AAAA' }] })).errores[0], /JPEG/);
  assert.match(validarArchivo(archivo({ instrumentos: [{ clave: 'x', json: null }] })).errores[0], /Instrumento/);
});

// --- Planificación: casos básicos ------------------------------------------------

test('con un dispositivo vacío todo es nuevo y lo importado no cuenta como pendiente de exportar', () => {
  const a = archivo({ sitios: [sitio(1, 'Central Uno')], areas: [area(10, 1, 'Bodega')], evaluaciones: [evaluacion(100, 10, { respuestas: [resp('S1.1', { foto_ids: [id(300)] }), resp('S1.2')] })],
    acciones: [accion(200, 100)], fotos: [foto(300, 100)], instrumentos: [instrumento('1.0|abc')] });
  const p = plan(a);
  assert.deepEqual(Object.fromEntries(Object.entries(p.resumen).map(([k, v]) => [k, v.nuevos])), { sitios: 1, areas: 1, evaluaciones: 1, acciones: 1, fotos: 1, instrumentos: 1 });
  assert.equal(p.poner.evaluaciones[0].exportado_en, AHORA);
  assert.equal(p.hayCambios, true);
  assert.deepEqual(p.conflictos, []);
});

test('importar dos veces el mismo archivo no duplica ni cambia nada', () => {
  const a = archivo({ sitios: [sitio(1, 'Central Uno')], areas: [area(10, 1, 'Bodega')], evaluaciones: [evaluacion(100, 10, { respuestas: [resp('S1.1', { foto_ids: [id(300)] })] })],
    acciones: [accion(200, 100)], fotos: [foto(300, 100)], instrumentos: [instrumento('1.0|abc')] });
  const local1 = aplicarEnMemoria(vacio(), plan(a));
  const p2 = plan(a, local1);
  assert.equal(p2.hayCambios, false);
  assert.deepEqual(p2.conflictos, []);
  for (const [tabla, r] of Object.entries(p2.resumen)) assert.deepEqual([r.nuevos, r.actualizados], [0, 0], tabla);
  assert.equal(local1.evaluaciones.length, 1);
});

test('sitios, áreas y acciones: gana el modificado más reciente; igual o más antiguo se omite', () => {
  const local = { ...vacio(), sitios: [sitio(1, 'Central Uno', 10)], areas: [area(10, 1, 'Bodega', 'O', 10)], evaluaciones: [evaluacion(100, 10)], acciones: [accion(200, 100, { modificado: T(10) })] };
  const nuevo = plan(archivo({ sitios: [{ ...sitio(1, 'Central Uno RENOMBRADA', 20), ubicacion: 'Zamora' }], areas: [area(10, 1, 'Bodega Nueva', 'O', 20)], evaluaciones: [evaluacion(100, 10)], acciones: [accion(200, 100, { modificado: T(20), estado: 'cerrada', fecha_cierre: T(20) })] }), local);
  assert.equal(nuevo.poner.sitios[0].nombre, 'Central Uno RENOMBRADA');
  assert.equal(nuevo.poner.areas[0].nombre, 'Bodega Nueva');
  assert.equal(nuevo.poner.acciones[0].estado, 'cerrada');
  assert.equal(nuevo.resumen.sitios.actualizados + nuevo.resumen.areas.actualizados + nuevo.resumen.acciones.actualizados, 3);

  const viejo = plan(archivo({ sitios: [sitio(1, 'Antiguo', 5)], areas: [area(10, 1, 'Antigua', 'O', 5)], evaluaciones: [evaluacion(100, 10)], acciones: [accion(200, 100, { modificado: T(5) })] }), local);
  assert.equal(viejo.hayCambios, false);
  assert.equal(viejo.resumen.sitios.omitidos, 1);
});

// --- Evaluaciones ----------------------------------------------------------------

test('una evaluación cerrada local nunca se sobrescribe, aunque la entrante sea más reciente', () => {
  const local = { ...vacio(), sitios: [sitio(1, 'S')], areas: [area(10, 1, 'A')], evaluaciones: [evaluacion(100, 10, { modificado: T(10) })] };
  const p = plan(archivo({ sitios: [sitio(1, 'S')], areas: [area(10, 1, 'A')], evaluaciones: [evaluacion(100, 10, { modificado: T(25), observacion_general: 'distinta' })] }), local);
  assert.equal(p.poner.evaluaciones.length, 0);
  assert.equal(p.resumen.evaluaciones.conflictos, 1);
  assert.match(p.conflictos[0].motivo, /no se sobrescribe/);
});

test('la anulación hecha en otro dispositivo se propaga, una sola vez', () => {
  const local = { ...vacio(), sitios: [sitio(1, 'S')], areas: [area(10, 1, 'A')], evaluaciones: [evaluacion(100, 10, { modificado: T(10) })] };
  const a = archivo({ sitios: [sitio(1, 'S')], areas: [area(10, 1, 'A')], evaluaciones: [evaluacion(100, 10, { modificado: T(22), anulada: true, anulada_motivo: 'Área equivocada', anulada_fecha: T(22) })] });
  const p = plan(a, local);
  assert.equal(p.resumen.evaluaciones.actualizados, 1);
  const guardada = p.poner.evaluaciones[0];
  assert.equal(guardada.anulada, true);
  assert.equal(guardada.anulada_motivo, 'Área equivocada');
  assert.equal(guardada.estado, 'cerrada');
  assert.equal(guardada.modificado, T(22));
  // Segunda importación: ya está anulada, no hay cambios ni conflictos.
  const p2 = plan(a, aplicarEnMemoria(local, p));
  assert.equal(p2.hayCambios, false);
  assert.deepEqual(p2.conflictos, []);
});

test('si aquí ya está anulada y el archivo trae la versión sin anular, se omite', () => {
  const local = { ...vacio(), sitios: [sitio(1, 'S')], areas: [area(10, 1, 'A')], evaluaciones: [evaluacion(100, 10, { modificado: T(30), anulada: true })] };
  const p = plan(archivo({ sitios: [sitio(1, 'S')], areas: [area(10, 1, 'A')], evaluaciones: [evaluacion(100, 10, { modificado: T(10) })] }), local);
  assert.equal(p.hayCambios, false);
  assert.equal(p.resumen.evaluaciones.omitidos, 1);
});

test('borradores: uno entrante no pisa una cerrada local; la cerrada entrante reemplaza al borrador local', () => {
  const base = { sitios: [sitio(1, 'S')], areas: [area(10, 1, 'A')] };
  const cerradaLocal = { ...vacio(), ...base, evaluaciones: [evaluacion(100, 10)] };
  const p1 = plan(archivo({ ...base, evaluaciones: [evaluacion(100, 10, { estado: 'borrador', modificado: T(28), resultado: null })] }), cerradaLocal);
  assert.equal(p1.poner.evaluaciones.length, 0);
  assert.equal(p1.resumen.evaluaciones.conflictos, 1);

  const borradorLocal = { ...vacio(), ...base, evaluaciones: [evaluacion(100, 10, { estado: 'borrador', modificado: T(28), resultado: null })] };
  const p2 = plan(archivo({ ...base, evaluaciones: [evaluacion(100, 10, { modificado: T(10) })] }), borradorLocal);
  assert.equal(p2.poner.evaluaciones[0].estado, 'cerrada');
  assert.equal(p2.resumen.evaluaciones.actualizados, 1);

  // Dos borradores: gana el más reciente.
  const p3 = plan(archivo({ ...base, evaluaciones: [evaluacion(100, 10, { estado: 'borrador', modificado: T(12), resultado: null, observacion_general: 'vieja' })] }), borradorLocal);
  assert.equal(p3.hayCambios, false);
});

test('un borrador entrante sin copia local se agrega como borrador y se avisa', () => {
  const p = plan(archivo({ sitios: [sitio(1, 'S')], areas: [area(10, 1, 'A')], evaluaciones: [evaluacion(100, 10, { estado: 'borrador', resultado: null })] }));
  assert.equal(p.poner.evaluaciones[0].estado, 'borrador');
  assert.ok(p.avisos.some((a) => /borrador/.test(a)));
});

test('evaluación de un área desconocida: conflicto y se omite junto con sus acciones y fotos', () => {
  const p = plan(archivo({ evaluaciones: [evaluacion(100, 99)], acciones: [accion(200, 100)], fotos: [foto(300, 100)] }));
  assert.equal(p.resumen.evaluaciones.conflictos, 1);
  assert.equal(p.resumen.acciones.conflictos, 1);
  assert.equal(p.poner.fotos.length, 0);
  assert.equal(p.hayCambios, false);
});

// --- Duplicados por nombre ---------------------------------------------------------

test('el mismo sitio y área creados en otro dispositivo (otro id) se fusionan por nombre, sin importar tildes ni mayúsculas', () => {
  const local = { ...vacio(), sitios: [sitio(1, 'Central Mazar')], areas: [area(10, 1, 'Casa de máquinas')] };
  const a = archivo({ sitios: [sitio(2, 'CENTRAL  mazar')], areas: [area(20, 2, 'Casa de maquinas')], evaluaciones: [evaluacion(100, 20)] });
  const p = plan(a, local);
  assert.deepEqual(p.duplicados.map((d) => [d.tipo, d.decision]), [['sitio', 'fusionar'], ['area', 'fusionar']]);
  assert.equal(p.poner.sitios.length + p.poner.areas.length, 0);
  assert.equal(p.poner.evaluaciones[0].area_id, id(10)); // la evaluación queda en el área local
  // Importar de nuevo: no hay cambios (la evaluación ya existe con su id).
  const p2 = plan(a, aplicarEnMemoria(local, p));
  assert.equal(p2.hayCambios, false);
  assert.deepEqual(p2.conflictos, []);
});

test('si se decide mantener separados, el sitio y el área entrantes se crean nuevos', () => {
  const local = { ...vacio(), sitios: [sitio(1, 'Central Mazar')], areas: [area(10, 1, 'Casa de máquinas')] };
  const a = archivo({ sitios: [sitio(2, 'Central Mazar')], areas: [area(20, 2, 'Casa de máquinas')], evaluaciones: [evaluacion(100, 20)] });
  const p = plan(a, local, { decisiones: { [`sitio:${id(2)}`]: 'separar' } });
  assert.equal(p.poner.sitios.length, 1);
  assert.equal(p.poner.areas.length, 1);
  assert.equal(p.poner.evaluaciones[0].area_id, id(20));
});

test('área con el mismo nombre pero en otro sitio no es duplicado; área con tipo distinto avisa', () => {
  const local = { ...vacio(), sitios: [sitio(1, 'Uno'), sitio(2, 'Dos')], areas: [area(10, 1, 'Bodega', 'B')] };
  const otroSitio = plan(archivo({ sitios: [sitio(2, 'Dos')], areas: [area(30, 2, 'Bodega', 'B')] }), local);
  assert.equal(otroSitio.duplicados.length, 0);
  assert.equal(otroSitio.poner.areas.length, 1);
  const tipo = plan(archivo({ sitios: [sitio(1, 'Uno')], areas: [area(31, 1, 'Bodega', 'O')] }), local);
  assert.ok(tipo.avisos.some((a) => /tipo distinto/.test(a)));
});

test('un área cuyo sitio no está en ningún lado es un conflicto', () => {
  const p = plan(archivo({ areas: [area(10, 99, 'Huérfana')] }));
  assert.equal(p.resumen.areas.conflictos, 1);
  assert.match(p.conflictos[0].motivo, /sitio que no está/);
});

// --- Acciones y fotos ----------------------------------------------------------------

test('las acciones de una evaluación cerrada local se actualizan (cerrar una acción en otro dispositivo)', () => {
  const local = { ...vacio(), sitios: [sitio(1, 'S')], areas: [area(10, 1, 'A')], evaluaciones: [evaluacion(100, 10)], acciones: [accion(200, 100, { modificado: T(11) })] };
  const p = plan(archivo({ sitios: [sitio(1, 'S')], areas: [area(10, 1, 'A')], evaluaciones: [evaluacion(100, 10)], acciones: [accion(200, 100, { modificado: T(26), estado: 'cerrada', fecha_cierre: T(26) })] }), local);
  assert.equal(p.poner.acciones[0].estado, 'cerrada');
  assert.equal(p.poner.evaluaciones.length, 0);
});

test('fotos: las existentes se omiten; las huérfanas o no referenciadas no se importan; las referenciadas sí', () => {
  const local = { ...vacio(), fotoIds: new Set([id(301)]) };
  const a = archivo({
    sitios: [sitio(1, 'S')], areas: [area(10, 1, 'A')],
    evaluaciones: [evaluacion(100, 10, { respuestas: [resp('S1.1', { foto_ids: [id(300), id(301)] }), resp('S1.2')] })],
    fotos: [foto(300, 100), foto(301, 100), foto(302, 100, 'S1.1'), foto(303, 555)],
  });
  const p = plan(a, local);
  assert.deepEqual(p.poner.fotos.map((f) => f.id), [id(300)]);
  assert.equal(p.resumen.fotos.nuevos, 1);
  assert.equal(p.resumen.fotos.omitidos, 3);
  // Las referencias a fotos que no llegan ni existen se quitan de la respuesta.
  const b = plan(archivo({ sitios: [sitio(1, 'S')], areas: [area(10, 1, 'A')], evaluaciones: [evaluacion(100, 10, { respuestas: [resp('S1.1', { foto_ids: [id(777)] })] })] }));
  assert.deepEqual(b.poner.evaluaciones[0].respuestas[0].foto_ids, []);
});

// --- Seguridad y avisos --------------------------------------------------------------

test('solo se copian los campos conocidos y las firmas deben ser PNG', () => {
  const sucia = { ...evaluacion(100, 10), campoRaro: 'x', __proto_falso__: { a: 1 }, firmas: { evaluador: 'javascript:alert(1)', responsable: 'data:image/png;base64,AAAA' }, respuestas: [{ ...resp('S1.1'), extra: 'x', foto_ids: ['a', 'b', 'c', 'd', 'e'] }] };
  const p = plan(archivo({ sitios: [{ ...sitio(1, 'S'), basura: 1 }], areas: [area(10, 1, 'A')], evaluaciones: [sucia] }));
  const ev = p.poner.evaluaciones[0];
  assert.equal('campoRaro' in ev, false);
  assert.equal(ev.firmas.evaluador, null);
  assert.equal(ev.firmas.responsable, 'data:image/png;base64,AAAA');
  assert.equal('extra' in ev.respuestas[0], false);
  assert.equal('basura' in p.poner.sitios[0], false);
});

test('avisos: instrumento con la misma versión y otro contenido, y varias evaluaciones marcadas como primera', () => {
  const local = { ...vacio(), sitios: [sitio(1, 'S')], areas: [area(10, 1, 'A')], evaluaciones: [evaluacion(100, 10, { es_primera_evaluacion: true })], instrumentos: [instrumento('1.0|abc')] };
  const p = plan(archivo({ sitios: [sitio(1, 'S')], areas: [area(10, 1, 'A')], evaluaciones: [evaluacion(101, 10, { es_primera_evaluacion: true, fecha: '2026-09-12' })], instrumentos: [instrumento('1.0|zzz', '1.0', 'zzz')] }), local);
  assert.ok(p.avisos.some((a) => /contenido distinto/.test(a)));
  assert.ok(p.avisos.some((a) => /más de una evaluación marcada como "primera"/.test(a)));
  assert.equal(p.resumen.instrumentos.nuevos, 1);
});

test('la opción "N/A foto" se conserva al importar', () => {
  const ev = evaluacion(100, 10, { respuestas: [resp('S1.1', { foto_na: true }), resp('S1.2')] });
  const p = plan(archivo({ sitios: [sitio(1, 'S')], areas: [area(10, 1, 'A')], evaluaciones: [ev] }));
  assert.equal(p.poner.evaluaciones[0].respuestas[0].foto_na, true);
  assert.equal(p.poner.evaluaciones[0].respuestas[1].foto_na, false);
});
