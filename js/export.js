// Exportación e importación de respaldos (acceso a IndexedDB y armado de archivos). Las reglas están en respaldo.js.
import * as db from './db.js';
import { SCHEMA_VERSION, TIPO_ARCHIVO, nombreRespaldo, seleccionarParaExportar } from './respaldo.js';
import { claveInstrumento } from './instrumento.js';

const CAMPOS_FOTO = ['id', 'creado', 'modificado', 'dispositivo_id', 'evaluacion_id', 'codigo_item', 'ancho', 'alto', 'fecha'];
const MAX_REGISTRO_IMPORTACIONES = 10;
/** Tamaño de texto acumulado a partir del cual se pasa a un Blob (el navegador puede llevarlo a disco). */
const LIMITE_ACUMULADO = 6_000_000;

// ---------------------------------------------------------------------------
// Conversión de fotos
// ---------------------------------------------------------------------------

/** Blob → base64 (sin el prefijo data:). */
export const blobABase64 = (blob) =>
  new Promise((ok, fallo) => {
    const lector = new FileReader();
    lector.onload = () => ok(String(lector.result).split(',')[1] ?? '');
    lector.onerror = () => fallo(lector.error);
    lector.readAsDataURL(blob);
  });

/** base64 → Blob. */
export function base64ABlob(b64, tipo = 'image/jpeg') {
  const binario = atob(b64);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return new Blob([bytes], { type: tipo });
}

// ---------------------------------------------------------------------------
// Exportar
// ---------------------------------------------------------------------------

/**
 * Arma el archivo de respaldo por partes, convirtiendo las fotos de una en una para no
 * tener todo el texto en memoria a la vez.
 *
 * @param datos     { sitios, areas, evaluaciones, acciones, instrumentos, fotosDe(evaluacionId) → Promise<foto[]> }
 * @param contexto  { perfil, dispositivoId, opciones, ahora, convertir, onProgreso }
 */
export async function armarRespaldo(datos, { perfil, dispositivoId, opciones = {}, ahora = new Date(), convertir = blobABase64, onProgreso = () => {} }) {
  let piezas = [];
  let acumulado = 0;
  const agregar = (texto) => {
    piezas.push(texto);
    acumulado += texto.length;
    if (acumulado > LIMITE_ACUMULADO) {
      piezas = [new Blob(piezas)];
      acumulado = 0;
    }
  };

  agregar(
    `{"tipo":"${TIPO_ARCHIVO}","schema_version":${SCHEMA_VERSION},"app":"App 5S CELEC SUR","exportado_en":${JSON.stringify(ahora.toISOString())},` +
      `"dispositivo_id":${JSON.stringify(dispositivoId)},"evaluador":${JSON.stringify({ nombre: perfil?.nombre ?? '', cargo: perfil?.cargo ?? '' })},` +
      `"opciones":${JSON.stringify(opciones)},"sitios":${JSON.stringify(datos.sitios)},"areas":${JSON.stringify(datos.areas)},` +
      `"evaluaciones":${JSON.stringify(datos.evaluaciones)},"acciones":${JSON.stringify(datos.acciones)},"fotos":[`,
  );

  let fotos = 0;
  for (const [i, ev] of datos.evaluaciones.entries()) {
    onProgreso(0.05 + (0.9 * i) / Math.max(1, datos.evaluaciones.length), `Preparando evaluación ${i + 1} de ${datos.evaluaciones.length}…`);
    for (const f of await datos.fotosDe(ev.id)) {
      const registro = Object.fromEntries(CAMPOS_FOTO.map((c) => [c, f[c]]));
      registro.blob_b64 = await convertir(f.blob);
      registro.miniatura_b64 = f.miniatura ? await convertir(f.miniatura) : null;
      agregar(`${fotos ? ',' : ''}${JSON.stringify(registro)}`);
      fotos++;
    }
    await new Promise((ok) => setTimeout(ok)); // cede el hilo para pintar el progreso
  }

  const conteos = { sitios: datos.sitios.length, areas: datos.areas.length, evaluaciones: datos.evaluaciones.length, acciones: datos.acciones.length, fotos, instrumentos: datos.instrumentos.length };
  agregar(`],"instrumentos":${JSON.stringify(datos.instrumentos)},"conteos":${JSON.stringify(conteos)}}`);
  const blob = new Blob(piezas, { type: 'application/json' });
  return { blob, conteos, nombre: nombreRespaldo(perfil?.nombre, ahora) };
}

/** Lee de IndexedDB lo que entra al respaldo según las opciones. */
export async function reunirDatosDeExportacion(opciones) {
  const [sitios, areas, evaluaciones, acciones, instrumentos] = await Promise.all([db.todos('sitios'), db.todos('areas'), db.todos('evaluaciones'), db.todos('acciones'), db.todos('instrumentos')]);
  const ids = new Set(seleccionarParaExportar({ evaluaciones, acciones }, opciones));
  const elegidas = evaluaciones.filter((e) => ids.has(e.id));
  const claves = new Set(elegidas.map((e) => claveInstrumento(e.instrumento_version, e.instrumento_hash)));
  return {
    sitios,
    areas,
    evaluaciones: elegidas,
    acciones: acciones.filter((a) => ids.has(a.evaluacion_id)),
    instrumentos: instrumentos.filter((i) => claves.has(i.clave)),
    fotosDe: db.fotosDeEvaluacion,
  };
}

/** Cuánto pesaría el respaldo (las fotos van en base64: ~37 % más). Los Blob guardados en IndexedDB no se cargan para medirlos. */
export async function estimarRespaldo(opciones) {
  const datos = await reunirDatosDeExportacion(opciones);
  let fotos = 0;
  let bytes = 0;
  for (const ev of datos.evaluaciones) {
    for (const f of await datos.fotosDe(ev.id)) {
      fotos++;
      bytes += (f.blob?.size ?? 0) + (f.miniatura?.size ?? 0);
    }
  }
  const texto = JSON.stringify([datos.sitios, datos.areas, datos.evaluaciones, datos.acciones, datos.instrumentos]).length;
  return { evaluaciones: datos.evaluaciones.length, fotos, bytes: Math.round(bytes * 1.37) + texto };
}

/** Genera el respaldo con lo guardado en este dispositivo. Devuelve { blob, nombre, conteos, evaluacionIds }. */
export async function exportarRespaldo(opciones, { onProgreso } = {}) {
  const [datos, perfil] = await Promise.all([reunirDatosDeExportacion(opciones), db.obtenerConfig('perfil')]);
  const resultado = await armarRespaldo(datos, { perfil, dispositivoId: db.idDispositivo(), opciones, onProgreso });
  return { ...resultado, evaluacionIds: datos.evaluaciones.filter((e) => e.estado === 'cerrada').map((e) => e.id) };
}

/** Después de confirmar que el archivo se guardó o envió: marca como exportadas las cerradas incluidas. */
export async function registrarExportacion(evaluacionIds) {
  const ahora = new Date().toISOString();
  await db.marcarExportadas(evaluacionIds, ahora);
  await db.guardarConfig('ultima_exportacion', ahora);
}

// ---------------------------------------------------------------------------
// Importar
// ---------------------------------------------------------------------------

/** Lee y analiza un archivo de respaldo. Lanza Error con un mensaje claro si no se puede leer. */
export async function leerArchivoRespaldo(archivo) {
  let texto;
  try {
    texto = await archivo.text();
  } catch {
    throw new Error('No se pudo leer el archivo. Si es muy grande, pida al evaluador que exporte solo las evaluaciones no exportadas.');
  }
  try {
    return JSON.parse(texto);
  } catch {
    throw new Error('El archivo no es un respaldo válido (el contenido está dañado o incompleto).');
  }
}

/** Escribe el plan de importación en una sola transacción y deja constancia en el registro. */
export async function aplicarImportacion(plan, { archivo, origen }) {
  const operaciones = [];
  const { poner } = plan;
  for (const tabla of ['sitios', 'areas', 'evaluaciones', 'acciones', 'instrumentos']) for (const r of poner[tabla]) operaciones.push([tabla, r]);
  for (const f of poner.fotos) {
    const { blob_b64: b64, miniatura_b64: mini, ...meta } = f;
    const blob = base64ABlob(b64);
    operaciones.push(['fotos', { ...meta, blob, miniatura: mini ? base64ABlob(mini) : blob }]);
  }
  await db.escribirVarios(operaciones);

  const registro = (await db.obtenerConfig('importaciones')) ?? [];
  registro.unshift({
    fecha: new Date().toISOString(),
    archivo,
    dispositivo_id: origen?.dispositivo_id ?? null,
    evaluador: origen?.evaluador?.nombre ?? '',
    resumen: Object.fromEntries(Object.entries(plan.resumen).map(([k, v]) => [k, { nuevos: v.nuevos, actualizados: v.actualizados }])),
  });
  await db.guardarConfig('importaciones', registro.slice(0, MAX_REGISTRO_IMPORTACIONES));
}
