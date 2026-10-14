// Capa de acceso a IndexedDB. Todos los stores se crean desde la versión 1 para evitar migraciones tempranas.
import { uuid, ahoraISO } from './util.js';
import { evaluacionesPendientes } from './respaldo.js';

const NOMBRE_DB = 'app5s-celec-sur';
const VERSION_DB = 1;

let db = null;
let dispositivoId = null;

/** Crea los stores. Cada bloque `if (anterior < N)` es una migración. */
function migrar(base, anterior) {
  if (anterior < 1) {
    base.createObjectStore('sitios', { keyPath: 'id' });
    base.createObjectStore('areas', { keyPath: 'id' }).createIndex('sitio_id', 'sitio_id');
    const ev = base.createObjectStore('evaluaciones', { keyPath: 'id' });
    ev.createIndex('area_id', 'area_id');
    ev.createIndex('estado', 'estado');
    base.createObjectStore('fotos', { keyPath: 'id' }).createIndex('evaluacion_id', 'evaluacion_id');
    base.createObjectStore('acciones', { keyPath: 'id' }).createIndex('evaluacion_id', 'evaluacion_id');
    base.createObjectStore('config', { keyPath: 'clave' });
    base.createObjectStore('instrumentos', { keyPath: 'clave' });
  }
}

const pedir = (rq) =>
  new Promise((ok, fallo) => {
    rq.onsuccess = () => ok(rq.result);
    rq.onerror = () => fallo(rq.error);
  });

/** Espera a que la transacción termine (datos realmente escritos). */
const terminar = (tx) =>
  new Promise((ok, fallo) => {
    tx.oncomplete = () => ok();
    tx.onerror = () => fallo(tx.error);
    tx.onabort = () => fallo(tx.error || new Error('Transacción cancelada'));
  });

export async function abrir() {
  if (db) return db;
  db = await new Promise((ok, fallo) => {
    const rq = indexedDB.open(NOMBRE_DB, VERSION_DB);
    rq.onupgradeneeded = (e) => migrar(rq.result, e.oldVersion);
    rq.onsuccess = () => ok(rq.result);
    rq.onerror = () => fallo(rq.error);
    rq.onblocked = () => fallo(new Error('La base de datos está bloqueada por otra pestaña de la app. Ciérrela e intente de nuevo.'));
  });
  db.onversionchange = () => db.close();
  dispositivoId = await obtenerConfig('dispositivo_id');
  if (!dispositivoId) {
    dispositivoId = uuid();
    await guardarConfig('dispositivo_id', dispositivoId);
  }
  return db;
}

export const idDispositivo = () => dispositivoId;

// --- Operaciones genéricas -------------------------------------------------

export const obtener = (store, id) => pedir(db.transaction(store).objectStore(store).get(id));
export const todos = (store) => pedir(db.transaction(store).objectStore(store).getAll());
export const porIndice = (store, indice, valor) => pedir(db.transaction(store).objectStore(store).index(indice).getAll(valor));

/** Crea una entidad con id, fechas y dispositivo (sin guardarla). */
export function crearEntidad(datos) {
  const ahora = ahoraISO();
  return { id: uuid(), creado: ahora, modificado: ahora, dispositivo_id: dispositivoId, ...datos };
}

/** Guarda (crea o reemplaza) una entidad y actualiza `modificado`. */
export async function guardar(store, entidad) {
  entidad.modificado = ahoraISO();
  if (!entidad.dispositivo_id) entidad.dispositivo_id = dispositivoId;
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).put(entidad);
  await terminar(tx);
  return entidad;
}

export async function eliminar(store, id) {
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).delete(id);
  await terminar(tx);
}

// --- Configuración (perfil, dispositivo, preferencias) ---------------------

export async function obtenerConfig(clave) {
  const fila = await obtener('config', clave);
  return fila ? fila.valor : null;
}

export async function guardarConfig(clave, valor) {
  const tx = db.transaction('config', 'readwrite');
  tx.objectStore('config').put({ clave, valor });
  await terminar(tx);
}

// --- Instrumentos (copia por versión+hash para interpretar evaluaciones antiguas) ---

/** Guarda la copia del instrumento si no existe y devuelve las versiones iguales con contenido distinto. */
export async function asegurarCopiaInstrumento({ instrumento, hash, clave }) {
  if (!(await obtener('instrumentos', clave))) {
    const tx = db.transaction('instrumentos', 'readwrite');
    tx.objectStore('instrumentos').put({ clave, version: instrumento.meta.version, hash, json: instrumento, guardado: ahoraISO() });
    await terminar(tx);
  }
  const copias = await todos('instrumentos');
  return copias.filter((c) => c.version === instrumento.meta.version && c.hash !== hash);
}

// --- Consultas del dominio -------------------------------------------------

const cerradaVigente = (e) => e.estado === 'cerrada' && !e.anulada;

/** Evaluaciones cerradas y no anuladas de un área, de la más reciente a la más antigua. */
export async function cerradasDeArea(areaId, modulo = null) {
  const lista = (await porIndice('evaluaciones', 'area_id', areaId)).filter(cerradaVigente);
  return lista
    .filter((e) => !modulo || e.modulo === modulo)
    .sort((a, b) => (b.fecha + b.creado).localeCompare(a.fecha + a.creado));
}

/** Es la primera evaluación del módulo en el área si no hay otra cerrada y vigente. */
export async function esPrimeraEvaluacion(areaId, modulo) {
  return (await cerradasDeArea(areaId, modulo)).length === 0;
}

/** Cantidad de evaluaciones cerradas con cambios (propios o de sus acciones) posteriores a su última exportación. */
export async function contarPendientesExportar() {
  const [evaluaciones, acciones] = await Promise.all([todos('evaluaciones'), todos('acciones')]);
  return evaluacionesPendientes(evaluaciones, acciones).length;
}

// --- Fotos y acciones --------------------------------------------------------

export const fotosDeEvaluacion = (evaluacionId) => porIndice('fotos', 'evaluacion_id', evaluacionId);
export const accionesDeEvaluacion = (evaluacionId) => porIndice('acciones', 'evaluacion_id', evaluacionId);

/** Elimina una foto y su referencia en la respuesta (el llamador guarda la evaluación). */
export async function eliminarFoto(foto, ev) {
  await eliminar('fotos', foto.id);
  const r = ev.respuestas.find((x) => x.codigo === foto.codigo_item);
  if (r) r.foto_ids = r.foto_ids.filter((id) => id !== foto.id);
}

/**
 * Reconecta fotos guardadas cuya referencia no llegó a escribirse en la respuesta
 * (la app se cerró entre guardar la foto y la evaluación). Devuelve true si cambió algo.
 */
export async function reconciliarFotos(ev, maximo) {
  const fotos = await fotosDeEvaluacion(ev.id);
  let cambio = false;
  for (const f of fotos.sort((a, b) => a.fecha.localeCompare(b.fecha))) {
    const r = ev.respuestas.find((x) => x.codigo === f.codigo_item);
    if (!r) {
      await eliminar('fotos', f.id);
    } else if (!r.foto_ids.includes(f.id)) {
      if (r.foto_ids.length < maximo) {
        r.foto_ids.push(f.id);
        cambio = true;
      } else await eliminar('fotos', f.id);
    }
  }
  return cambio;
}

/** Todas las evaluaciones de un área, de la más reciente a la más antigua. */
export async function evaluacionesDeArea(areaId) {
  return (await porIndice('evaluaciones', 'area_id', areaId)).sort((a, b) => (b.fecha + b.creado).localeCompare(a.fecha + a.creado));
}

/** Acciones de las evaluaciones cerradas y vigentes de un área (con su evaluación). */
export async function accionesDeArea(areaId) {
  const vigentes = (await evaluacionesDeArea(areaId)).filter(cerradaVigente);
  const grupos = await Promise.all(vigentes.map(async (ev) => (await accionesDeEvaluacion(ev.id)).map((accion) => ({ accion, ev }))));
  return grupos.flat();
}

/** Anula una evaluación cerrada. Es el único cambio permitido sobre una cerrada. */
export async function anularEvaluacion(ev, motivo) {
  if (ev.estado !== 'cerrada' || ev.anulada) throw new Error('Solo se puede anular una evaluación cerrada que no esté anulada.');
  ev.anulada = true;
  ev.anulada_motivo = motivo;
  ev.anulada_fecha = ahoraISO();
  return guardar('evaluaciones', ev);
}

/** Uso de almacenamiento y estado de persistencia (para el indicador del inicio). */
export async function infoAlmacenamiento() {
  const info = { usado: null, cuota: null, persistente: null };
  try {
    if (navigator.storage?.estimate) {
      const { usage, quota } = await navigator.storage.estimate();
      Object.assign(info, { usado: usage, cuota: quota });
    }
    if (navigator.storage?.persisted) info.persistente = await navigator.storage.persisted();
  } catch {
    /* sin información disponible */
  }
  return info;
}

/** Pide al navegador que no borre los datos de la app al faltar espacio. */
export async function solicitarPersistencia() {
  try {
    if (navigator.storage?.persist) return (await navigator.storage.persisted()) || (await navigator.storage.persist());
  } catch {
    /* no soportado */
  }
  return false;
}

// --- Respaldo e importación ----------------------------------------------------

export const claves = (store) => pedir(db.transaction(store).objectStore(store).getAllKeys());

/** Guarda muchos registros en UNA transacción: o se escribe todo o no se escribe nada. Cada operación es [store, registro]. */
export async function escribirVarios(operaciones) {
  const stores = [...new Set(operaciones.map(([s]) => s))];
  if (!stores.length) return;
  const tx = db.transaction(stores, 'readwrite');
  for (const [store, registro] of operaciones) tx.objectStore(store).put(registro);
  await terminar(tx);
}

/** Marca evaluaciones como exportadas SIN cambiar `modificado` (exportar no es modificar la evaluación). */
export async function marcarExportadas(ids, cuando = ahoraISO()) {
  const tx = db.transaction('evaluaciones', 'readwrite');
  const almacen = tx.objectStore('evaluaciones');
  for (const id of ids) {
    const rq = almacen.get(id);
    rq.onsuccess = () => rq.result && almacen.put({ ...rq.result, exportado_en: cuando });
  }
  await terminar(tx);
}

/** Lo que ya existe en este dispositivo, en la forma que necesita `planificarImportacion`. */
export async function instantaneaLocal() {
  const [sitios, areas, evaluaciones, acciones, fotoIds, instrumentos] = await Promise.all([
    todos('sitios'), todos('areas'), todos('evaluaciones'), todos('acciones'), claves('fotos'), todos('instrumentos'),
  ]);
  return { sitios, areas, evaluaciones, acciones, fotoIds: new Set(fotoIds), instrumentos: instrumentos.map(({ clave, version, hash }) => ({ clave, version, hash })) };
}
