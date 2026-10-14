import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { armarRespaldo } from '../js/export.js';
import { validarArchivo, planificarImportacion } from '../js/respaldo.js';

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const jpeg = (nombre) => new Blob([readFileSync(new URL(`./fixtures/${nombre}`, import.meta.url))], { type: 'image/jpeg' });
const aBase64 = async (blob) => Buffer.from(await blob.arrayBuffer()).toString('base64');
const T = '2026-09-10T10:00:00.000Z';

function datosEjemplo() {
  const fotos = [
    { id: id(300), evaluacion_id: id(100), codigo_item: 'S1.1', creado: T, modificado: T, dispositivo_id: id(900), ancho: 800, alto: 600, fecha: T, blob: jpeg('foto1.jpg'), miniatura: jpeg('foto2.jpg') },
    { id: id(301), evaluacion_id: id(100), codigo_item: 'S1.2', creado: T, modificado: T, dispositivo_id: id(900), ancho: 600, alto: 800, fecha: T, blob: jpeg('foto2.jpg'), miniatura: null },
  ];
  return {
    sitios: [{ id: id(1), creado: T, modificado: T, dispositivo_id: id(900), nombre: 'Central Uno', ubicacion: 'Loja', activo: true }],
    areas: [{ id: id(10), creado: T, modificado: T, dispositivo_id: id(900), sitio_id: id(1), nombre: 'Bodega', tipo: 'B', responsable: 'Ana', activo: true }],
    evaluaciones: [{
      id: id(100), creado: T, modificado: T, dispositivo_id: id(900), area_id: id(10), area_tipo: 'B', modulo: 'fisico', fecha: '2026-09-10', evaluador: { nombre: 'Carlos Terán', cargo: 'Analista' },
      instrumento_version: '1.0', instrumento_hash: 'abc', estado: 'cerrada', es_primera_evaluacion: true, personas_presentes: '', observacion_general: 'Acentos: áéíóú ñ «comillas» 😀',
      respuestas: [{ codigo: 'S1.1', valor: 0, na: null, na_justificacion: '', observacion: '', foto_ids: [id(300)] }, { codigo: 'S1.2', valor: 4, na: null, na_justificacion: '', observacion: '', foto_ids: [id(301)] }],
      resultado: { global: 50 }, firmas: { evaluador: null, responsable: null }, anulada: false, exportado_en: null,
    }],
    acciones: [{ id: id(200), creado: T, modificado: T, dispositivo_id: id(900), evaluacion_id: id(100), codigo_item: 'S1.1', descripcion: 'Retirar chatarra', responsable: 'Luis', fecha_compromiso: '2026-11-01', estado: 'abierta', fecha_cierre: null }],
    instrumentos: [{ clave: '1.0|abc', version: '1.0', hash: 'abc', json: { meta: { version: '1.0' } }, guardado: T }],
    fotosDe: async (evId) => (evId === id(100) ? fotos : []),
  };
}

const armar = (datos = datosEjemplo(), extra = {}) =>
  armarRespaldo(datos, { perfil: { nombre: 'Carlos Terán', cargo: 'Analista' }, dispositivoId: id(900), opciones: { soloPendientes: true }, ahora: new Date(2026, 9, 14, 15, 30), convertir: aBase64, ...extra });

test('el respaldo se arma completo, con conteos, y pasa la validación', async () => {
  const { blob, conteos, nombre } = await armar();
  assert.equal(nombre, 'Respaldo_5S_Carlos_Teran_20261014-1530.json');
  assert.deepEqual(conteos, { sitios: 1, areas: 1, evaluaciones: 1, acciones: 1, fotos: 2, instrumentos: 1 });
  const archivo = JSON.parse(await blob.text());
  assert.equal(archivo.tipo, 'respaldo_5s');
  assert.equal(archivo.schema_version, 1);
  assert.equal(archivo.dispositivo_id, id(900));
  assert.equal(archivo.evaluador.nombre, 'Carlos Terán');
  assert.deepEqual(archivo.conteos, conteos);
  assert.equal(archivo.fotos.length, 2);
  assert.ok(archivo.fotos[0].blob_b64.startsWith('/9j/'));
  assert.equal(archivo.fotos[1].miniatura_b64, null);
  assert.equal(archivo.evaluaciones[0].observacion_general, 'Acentos: áéíóú ñ «comillas» 😀');
  assert.deepEqual(validarArchivo(archivo).errores, []);
});

test('ida y vuelta: lo exportado se importa completo en un dispositivo vacío y las fotos conservan sus bytes', async () => {
  const { blob } = await armar();
  const archivo = JSON.parse(await blob.text());
  const plan = planificarImportacion(archivo, { sitios: [], areas: [], evaluaciones: [], acciones: [], fotoIds: new Set(), instrumentos: [] });
  assert.deepEqual(plan.conflictos, []);
  assert.deepEqual(Object.fromEntries(Object.entries(plan.resumen).map(([k, v]) => [k, v.nuevos])), { sitios: 1, areas: 1, evaluaciones: 1, acciones: 1, fotos: 2, instrumentos: 1 });
  const original = readFileSync(new URL('./fixtures/foto1.jpg', import.meta.url));
  assert.equal(Buffer.from(plan.poner.fotos[0].blob_b64, 'base64').equals(original), true);
});

test('un archivo cortado a la mitad no se puede leer; con un registro menos, la validación lo detecta', async () => {
  const { blob } = await armar();
  const texto = await blob.text();
  assert.throws(() => JSON.parse(texto.slice(0, Math.floor(texto.length / 2))));
  const archivo = JSON.parse(texto);
  archivo.acciones = [];
  assert.match(validarArchivo(archivo).errores[0], /incompleto.*"acciones"/);
});

test('sin evaluaciones (solo catálogo) el respaldo lleva sitios y áreas', async () => {
  const datos = { ...datosEjemplo(), evaluaciones: [], acciones: [], instrumentos: [] };
  const { blob, conteos } = await armar(datos, { opciones: { soloCatalogo: true } });
  assert.deepEqual(conteos, { sitios: 1, areas: 1, evaluaciones: 0, acciones: 0, fotos: 0, instrumentos: 0 });
  assert.deepEqual(validarArchivo(JSON.parse(await blob.text())).errores, []);
});

test('el progreso se informa y las fotos se convierten de una en una', async () => {
  const pasos = [];
  let enParalelo = 0;
  let maximo = 0;
  const convertir = async (b) => {
    maximo = Math.max(maximo, ++enParalelo);
    const r = await aBase64(b);
    enParalelo--;
    return r;
  };
  await armar(datosEjemplo(), { onProgreso: (f, t) => pasos.push([f, t]), convertir });
  assert.ok(pasos.length >= 1);
  assert.equal(maximo, 1);
});
