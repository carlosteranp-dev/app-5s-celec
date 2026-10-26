// Núcleo del respaldo y la consolidación: formato del archivo, validación y reglas de fusión (CLAUDE.md §8).
// Funciones puras: no tocan IndexedDB ni el DOM, así se prueban en Node.
import { normalizarNombre } from './util.js';

export const SCHEMA_VERSION = 1;
export const TIPO_ARCHIVO = 'respaldo_5s';
export const MAX_FOTOS_POR_ITEM_IMPORTADAS = 3;

const ID_VALIDO = /^[A-Za-z0-9_-]{8,64}$/;
const FECHA_VALIDA = /^\d{4}-\d{2}-\d{2}$/;
const FIRMA_VALIDA = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/;
const MODULOS = ['fisico', 'digital'];
const ESTADOS = ['borrador', 'cerrada'];

// ---------------------------------------------------------------------------
// Qué se exporta
// ---------------------------------------------------------------------------

/**
 * Evaluaciones cerradas con cambios sin exportar: nunca exportadas, modificadas después de exportarlas
 * o con alguna acción modificada después. Devuelve los ids.
 */
export function evaluacionesPendientes(evaluaciones, acciones) {
  const ultimaAccion = new Map();
  for (const a of acciones) if ((a.modificado ?? '') > (ultimaAccion.get(a.evaluacion_id) ?? '')) ultimaAccion.set(a.evaluacion_id, a.modificado);
  return evaluaciones
    .filter((e) => e.estado === 'cerrada' && (!e.exportado_en || e.modificado > e.exportado_en || (ultimaAccion.get(e.id) ?? '') > e.exportado_en))
    .map((e) => e.id);
}

/**
 * Evaluaciones que entran al respaldo según las opciones:
 *  - soloCatalogo: ninguna (solo sitios y áreas, para repartir el catálogo a los evaluadores);
 *  - soloPendientes: solo las cerradas con cambios sin exportar;
 *  - incluirBorradores: además, los borradores (respaldo completo del dispositivo).
 */
export function seleccionarParaExportar({ evaluaciones, acciones }, { soloPendientes = false, incluirBorradores = false, soloCatalogo = false } = {}) {
  if (soloCatalogo) return [];
  const pendientes = new Set(evaluacionesPendientes(evaluaciones, acciones));
  return evaluaciones
    .filter((e) => (e.estado === 'cerrada' ? !soloPendientes || pendientes.has(e.id) : incluirBorradores))
    .map((e) => e.id);
}

/** Nombre: Respaldo_5S_<evaluador>_<AAAAMMDD-HHmm>.json (sin tildes ni espacios). */
export function nombreRespaldo(nombreEvaluador, fecha = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  const sello = `${fecha.getFullYear()}${p(fecha.getMonth() + 1)}${p(fecha.getDate())}-${p(fecha.getHours())}${p(fecha.getMinutes())}`;
  const quien = String(nombreEvaluador ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'evaluador';
  return `Respaldo_5S_${quien}_${sello}.json`;
}

// ---------------------------------------------------------------------------
// Limpieza de registros (solo se copian los campos conocidos)
// ---------------------------------------------------------------------------

const base = (o) => ({ id: o.id, creado: o.creado, modificado: o.modificado, dispositivo_id: o.dispositivo_id });
const texto = (v) => (typeof v === 'string' ? v : '');

export const limpiarSitio = (o) => ({ ...base(o), nombre: texto(o.nombre), ubicacion: texto(o.ubicacion), activo: o.activo !== false });
export const limpiarArea = (o) => ({ ...base(o), sitio_id: o.sitio_id, nombre: texto(o.nombre), tipo: texto(o.tipo), responsable: texto(o.responsable), activo: o.activo !== false });

function limpiarRespuesta(r) {
  return {
    codigo: texto(r?.codigo),
    valor: Number.isInteger(r?.valor) ? r.valor : null,
    na: ['automatico', 'manual'].includes(r?.na) ? r.na : null,
    na_justificacion: texto(r?.na_justificacion),
    observacion: texto(r?.observacion),
    foto_ids: Array.isArray(r?.foto_ids) ? r.foto_ids.filter((id) => typeof id === 'string').slice(0, MAX_FOTOS_POR_ITEM_IMPORTADAS) : [],
    foto_na: Boolean(r?.foto_na),
  };
}

export function limpiarEvaluacion(o) {
  const limpia = {
    ...base(o),
    area_id: o.area_id,
    area_tipo: texto(o.area_tipo),
    modulo: o.modulo,
    fecha: o.fecha,
    evaluador: { nombre: texto(o.evaluador?.nombre), cargo: texto(o.evaluador?.cargo) },
    instrumento_version: texto(o.instrumento_version),
    instrumento_hash: texto(o.instrumento_hash),
    estado: o.estado,
    es_primera_evaluacion: Boolean(o.es_primera_evaluacion),
    personas_presentes: texto(o.personas_presentes),
    observacion_general: texto(o.observacion_general),
    respuestas: o.respuestas.map(limpiarRespuesta),
    resultado: o.resultado ? JSON.parse(JSON.stringify(o.resultado)) : null,
    firmas: { evaluador: FIRMA_VALIDA.test(o.firmas?.evaluador ?? '') ? o.firmas.evaluador : null, responsable: FIRMA_VALIDA.test(o.firmas?.responsable ?? '') ? o.firmas.responsable : null },
    firmante_responsable: texto(o.firmante_responsable),
    firma_responsable_ausente: o.firma_responsable_ausente ? texto(o.firma_responsable_ausente) : null,
    fecha_cierre: o.fecha_cierre ? texto(o.fecha_cierre) : null,
    anulada: Boolean(o.anulada),
    exportado_en: null,
  };
  if (o.anulada) Object.assign(limpia, { anulada_motivo: texto(o.anulada_motivo), anulada_fecha: texto(o.anulada_fecha) });
  if (o.modulo === 'digital') Object.assign(limpia, { usuario_nombre: texto(o.usuario_nombre), usuario_cargo: texto(o.usuario_cargo), equipo_codigo: texto(o.equipo_codigo), confidencialidad_aceptada: Boolean(o.confidencialidad_aceptada) });
  return limpia;
}

export const limpiarAccion = (o) => ({
  ...base(o),
  evaluacion_id: o.evaluacion_id,
  codigo_item: texto(o.codigo_item),
  descripcion: texto(o.descripcion),
  responsable: texto(o.responsable),
  fecha_compromiso: texto(o.fecha_compromiso),
  estado: o.estado === 'cerrada' ? 'cerrada' : 'abierta',
  fecha_cierre: o.fecha_cierre ? texto(o.fecha_cierre) : null,
});

export const limpiarFoto = (o) => ({ ...base(o), evaluacion_id: o.evaluacion_id, codigo_item: texto(o.codigo_item), ancho: Number(o.ancho) || 0, alto: Number(o.alto) || 0, fecha: texto(o.fecha) });

// ---------------------------------------------------------------------------
// Validación del archivo
// ---------------------------------------------------------------------------

const esISO = (s) => typeof s === 'string' && !Number.isNaN(Date.parse(s));

/** Revisa el archivo antes de planificar. Devuelve { errores } (si hay alguno no se puede importar). */
export function validarArchivo(a) {
  const errores = [];
  if (!a || typeof a !== 'object' || Array.isArray(a)) return { errores: ['El archivo no es un respaldo de la app 5S.'] };
  if (a.tipo !== TIPO_ARCHIVO) return { errores: ['El archivo no es un respaldo de la app 5S (falta el tipo "respaldo_5s").'] };
  if (!Number.isInteger(a.schema_version) || a.schema_version < 1) errores.push('El archivo no indica la versión de su formato.');
  else if (a.schema_version > SCHEMA_VERSION) errores.push(`El archivo se creó con una versión más nueva de la app (formato ${a.schema_version}). Actualice la app e intente de nuevo.`);
  if (errores.length) return { errores };

  const listas = ['sitios', 'areas', 'evaluaciones', 'acciones', 'fotos', 'instrumentos'];
  for (const n of listas) if (!Array.isArray(a[n])) errores.push(`Falta la lista "${n}" o no es válida.`);
  if (errores.length) return { errores };
  if (a.conteos) {
    for (const n of listas) if (Number.isInteger(a.conteos[n]) && a.conteos[n] !== a[n].length) errores.push(`El archivo está incompleto: "${n}" debía tener ${a.conteos[n]} registros y tiene ${a[n].length}.`);
  }

  const problema = (tipo, i, motivo) => errores.push(`${tipo} #${i + 1}: ${motivo}.`);
  const comun = (tipo, r, i) => {
    if (!r || typeof r !== 'object') return problema(tipo, i, 'no es un registro válido'), false;
    if (!ID_VALIDO.test(r.id ?? '')) return problema(tipo, i, 'identificador inválido'), false;
    if (!esISO(r.modificado)) return problema(tipo, i, 'fecha de modificación inválida'), false;
    return true;
  };
  a.sitios.forEach((s, i) => comun('Sitio', s, i) && !texto(s.nombre).trim() && problema('Sitio', i, 'sin nombre'));
  a.areas.forEach((x, i) => comun('Área', x, i) && (!texto(x.nombre).trim() ? problema('Área', i, 'sin nombre') : !ID_VALIDO.test(x.sitio_id ?? '') && problema('Área', i, 'sin sitio')));
  a.evaluaciones.forEach((e, i) => {
    if (!comun('Evaluación', e, i)) return;
    if (!MODULOS.includes(e.modulo)) problema('Evaluación', i, 'módulo desconocido');
    else if (!ESTADOS.includes(e.estado)) problema('Evaluación', i, 'estado desconocido');
    else if (!FECHA_VALIDA.test(e.fecha ?? '')) problema('Evaluación', i, 'fecha inválida');
    else if (!ID_VALIDO.test(e.area_id ?? '')) problema('Evaluación', i, 'sin área');
    else if (!Array.isArray(e.respuestas)) problema('Evaluación', i, 'sin respuestas');
  });
  a.acciones.forEach((x, i) => comun('Acción', x, i) && !ID_VALIDO.test(x.evaluacion_id ?? '') && problema('Acción', i, 'sin evaluación'));
  a.fotos.forEach((f, i) => {
    if (!comun('Foto', f, i)) return;
    if (typeof f.blob_b64 !== 'string' || !f.blob_b64.startsWith('/9j/')) problema('Foto', i, 'no es una imagen JPEG válida');
    else if (f.miniatura_b64 != null && (typeof f.miniatura_b64 !== 'string' || !f.miniatura_b64.startsWith('/9j/'))) problema('Foto', i, 'la miniatura no es un JPEG válido');
  });
  a.instrumentos.forEach((x, i) => (typeof x?.clave !== 'string' || typeof x?.json !== 'object' || !x.json?.meta ? problema('Instrumento', i, 'no es válido') : null));
  return { errores };
}

// ---------------------------------------------------------------------------
// Planificación de la importación
// ---------------------------------------------------------------------------

const ms = (iso) => Date.parse(iso) || 0;
const cuenta = () => ({ nuevos: 0, actualizados: 0, omitidos: 0, conflictos: 0 });

/**
 * Calcula qué se hará al importar, sin tocar nada.
 *
 * @param archivo  respaldo ya validado
 * @param local    { sitios, areas, evaluaciones, acciones, fotoIds:Set, instrumentos:[{clave, version, hash}] }
 * @param opciones { decisiones: { 'sitio:<id>'|'area:<id>': 'fusionar'|'separar' }, ahora: ISO }
 *
 * Reglas (CLAUDE.md §8): por id; si existe, gana el `modificado` más reciente; las evaluaciones cerradas nunca se
 * sobrescriben (salvo propagar una anulación); un borrador entrante no pisa nada local; las fotos no se modifican.
 * Un sitio o área con el mismo nombre pero distinto id se propone como duplicado (por defecto, fusionar).
 */
export function planificarImportacion(archivo, local, { decisiones = {}, ahora = new Date().toISOString() } = {}) {
  const resumen = { sitios: cuenta(), areas: cuenta(), evaluaciones: cuenta(), acciones: cuenta(), fotos: cuenta(), instrumentos: cuenta() };
  const conflictos = [];
  const avisos = [];
  const duplicados = [];
  const poner = { sitios: [], areas: [], evaluaciones: [], acciones: [], fotos: [], instrumentos: [] };
  const conflicto = (tipo, id, motivo) => {
    conflictos.push({ tipo, id, motivo });
    resumen[tipo].conflictos++;
  };

  // --- Instrumentos --------------------------------------------------------
  const clavesLocales = new Set(local.instrumentos.map((i) => i.clave));
  for (const i of archivo.instrumentos) {
    if (clavesLocales.has(i.clave)) {
      resumen.instrumentos.omitidos++;
      continue;
    }
    const mismaVersion = local.instrumentos.find((l) => l.version === i.version && l.hash !== i.hash);
    if (mismaVersion) avisos.push(`El instrumento versión ${i.version} del archivo tiene contenido distinto al de este dispositivo.`);
    poner.instrumentos.push({ clave: i.clave, version: i.version, hash: i.hash, json: i.json, guardado: i.guardado ?? ahora });
    resumen.instrumentos.nuevos++;
  }

  // --- Sitios ---------------------------------------------------------------
  const sitioLocalPorId = new Map(local.sitios.map((s) => [s.id, s]));
  const sitioLocalPorNombre = new Map(local.sitios.map((s) => [normalizarNombre(s.nombre), s]));
  const mapaSitio = new Map(); // id entrante → id efectivo
  for (const s of archivo.sitios) {
    const existente = sitioLocalPorId.get(s.id);
    if (existente) {
      mapaSitio.set(s.id, s.id);
      if (ms(s.modificado) > ms(existente.modificado)) {
        poner.sitios.push(limpiarSitio(s));
        resumen.sitios.actualizados++;
      } else resumen.sitios.omitidos++;
      continue;
    }
    const igualNombre = sitioLocalPorNombre.get(normalizarNombre(s.nombre));
    if (igualNombre) {
      const decision = decisiones[`sitio:${s.id}`] ?? 'fusionar';
      duplicados.push({ tipo: 'sitio', id: s.id, nombre: s.nombre, local: igualNombre.nombre, decision });
      if (decision === 'fusionar') {
        mapaSitio.set(s.id, igualNombre.id);
        resumen.sitios.omitidos++;
        continue;
      }
    }
    mapaSitio.set(s.id, s.id);
    poner.sitios.push(limpiarSitio(s));
    resumen.sitios.nuevos++;
  }
  const sitiosConocidos = new Set([...sitioLocalPorId.keys(), ...poner.sitios.map((s) => s.id)]);

  // --- Áreas ----------------------------------------------------------------
  const areaLocalPorId = new Map(local.areas.map((a) => [a.id, a]));
  const mapaArea = new Map();
  const areasConocidas = new Set(areaLocalPorId.keys());
  for (const a of archivo.areas) {
    const sitioId = mapaSitio.get(a.sitio_id) ?? a.sitio_id;
    if (!sitiosConocidos.has(sitioId)) {
      conflicto('areas', a.id, `El área "${a.nombre}" pertenece a un sitio que no está en el archivo ni en este dispositivo.`);
      continue;
    }
    const existente = areaLocalPorId.get(a.id);
    if (existente) {
      mapaArea.set(a.id, a.id);
      if (ms(a.modificado) > ms(existente.modificado)) {
        poner.areas.push({ ...limpiarArea(a), sitio_id: sitioId });
        resumen.areas.actualizados++;
      } else resumen.areas.omitidos++;
      continue;
    }
    const igualNombre = local.areas.find((l) => l.sitio_id === sitioId && normalizarNombre(l.nombre) === normalizarNombre(a.nombre));
    if (igualNombre) {
      const decision = decisiones[`area:${a.id}`] ?? 'fusionar';
      duplicados.push({ tipo: 'area', id: a.id, nombre: a.nombre, local: igualNombre.nombre, decision });
      if (decision === 'fusionar') {
        mapaArea.set(a.id, igualNombre.id);
        if (a.tipo && igualNombre.tipo && a.tipo !== igualNombre.tipo) avisos.push(`El área "${a.nombre}" tiene tipo distinto en el archivo (${a.tipo}) y en este dispositivo (${igualNombre.tipo}); se conserva el de este dispositivo.`);
        resumen.areas.omitidos++;
        continue;
      }
    }
    mapaArea.set(a.id, a.id);
    poner.areas.push({ ...limpiarArea(a), sitio_id: sitioId });
    areasConocidas.add(a.id);
    resumen.areas.nuevos++;
  }

  // --- Evaluaciones ---------------------------------------------------------
  const evalLocalPorId = new Map(local.evaluaciones.map((e) => [e.id, e]));
  const evalConocidas = new Set(evalLocalPorId.keys());
  const evalFinal = new Map(); // id → evaluación que quedará (para validar fotos y acciones)
  const fotosArchivo = new Set(archivo.fotos.map((f) => f.id));
  for (const e of archivo.evaluaciones) {
    const areaId = mapaArea.get(e.area_id) ?? e.area_id;
    const etiqueta = `${e.modulo === 'digital' ? 'Digital' : 'Físico'} del ${e.fecha}`;
    if (!areasConocidas.has(areaId)) {
      conflicto('evaluaciones', e.id, `La evaluación ${etiqueta} es de un área que no está en el archivo ni en este dispositivo.`);
      continue;
    }
    const existente = evalLocalPorId.get(e.id);
    const entrante = limpiarEvaluacion({ ...e, area_id: areaId });
    entrante.exportado_en = ahora; // vino de un archivo: no cuenta como pendiente de exportar

    if (!existente) {
      poner.evaluaciones.push(entrante);
      evalFinal.set(e.id, entrante);
      evalConocidas.add(e.id);
      resumen.evaluaciones.nuevos++;
      continue;
    }
    evalFinal.set(e.id, existente);
    if (existente.estado === 'cerrada') {
      // Una cerrada local nunca se sobrescribe; solo se propaga una anulación hecha en otro dispositivo.
      if (entrante.estado === 'cerrada' && entrante.anulada && !existente.anulada) {
        const anulada = { ...existente, anulada: true, anulada_motivo: entrante.anulada_motivo, anulada_fecha: entrante.anulada_fecha, modificado: e.modificado };
        poner.evaluaciones.push(anulada);
        evalFinal.set(e.id, anulada);
        resumen.evaluaciones.actualizados++;
      } else if (ms(e.modificado) > ms(existente.modificado)) {
        conflicto('evaluaciones', e.id, `La evaluación cerrada ${etiqueta} ya existe aquí y no se sobrescribe (las cerradas no se editan).`);
      } else resumen.evaluaciones.omitidos++;
    } else if (entrante.estado === 'cerrada' || ms(e.modificado) > ms(existente.modificado)) {
      // Borrador local: lo reemplaza la evaluación cerrada o un borrador más reciente.
      poner.evaluaciones.push(entrante);
      evalFinal.set(e.id, entrante);
      resumen.evaluaciones.actualizados++;
    } else resumen.evaluaciones.omitidos++;
  }

  // Las referencias a fotos que no existirán se quitan de las evaluaciones que se guardan.
  const fotosLocales = local.fotoIds;
  for (const e of poner.evaluaciones) {
    for (const r of e.respuestas) r.foto_ids = r.foto_ids.filter((id) => fotosLocales.has(id) || fotosArchivo.has(id));
  }

  // --- Acciones -------------------------------------------------------------
  const accionLocalPorId = new Map(local.acciones.map((a) => [a.id, a]));
  for (const a of archivo.acciones) {
    if (!evalConocidas.has(a.evaluacion_id)) {
      conflicto('acciones', a.id, `La acción de ${a.codigo_item || 'un ítem'} es de una evaluación que no está en el archivo ni en este dispositivo.`);
      continue;
    }
    const existente = accionLocalPorId.get(a.id);
    if (!existente) {
      poner.acciones.push(limpiarAccion(a));
      resumen.acciones.nuevos++;
    } else if (ms(a.modificado) > ms(existente.modificado)) {
      poner.acciones.push(limpiarAccion(a));
      resumen.acciones.actualizados++;
    } else resumen.acciones.omitidos++;
  }

  // --- Fotos ----------------------------------------------------------------
  for (const f of archivo.fotos) {
    if (local.fotoIds.has(f.id)) {
      resumen.fotos.omitidos++;
      continue;
    }
    const ev = evalFinal.get(f.evaluacion_id);
    const referenciada = ev?.respuestas.some((r) => r.codigo === f.codigo_item && r.foto_ids.includes(f.id));
    if (!ev || !referenciada) {
      resumen.fotos.omitidos++; // foto huérfana: su evaluación no se importa o no la referencia
      continue;
    }
    poner.fotos.push({ ...limpiarFoto(f), blob_b64: f.blob_b64, miniatura_b64: f.miniatura_b64 ?? null });
    resumen.fotos.nuevos++;
  }

  // --- Avisos de consolidación (decisión G5) -------------------------------
  const vigentes = [...local.evaluaciones.filter((e) => !poner.evaluaciones.some((p) => p.id === e.id)), ...poner.evaluaciones].filter((e) => e.estado === 'cerrada' && !e.anulada && e.es_primera_evaluacion);
  const porAreaModulo = new Map();
  for (const e of vigentes) porAreaModulo.set(`${e.area_id}|${e.modulo}`, (porAreaModulo.get(`${e.area_id}|${e.modulo}`) ?? 0) + 1);
  const variasPrimeras = [...porAreaModulo.values()].filter((n) => n > 1).length;
  if (variasPrimeras) avisos.push(`${variasPrimeras} área${variasPrimeras === 1 ? '' : 's'} tiene${variasPrimeras === 1 ? '' : 'n'} más de una evaluación marcada como "primera" (se hicieron en dispositivos distintos). Las evaluaciones cerradas no se recalculan.`);
  const borradores = poner.evaluaciones.filter((e) => e.estado === 'borrador').length;
  if (borradores) avisos.push(`${borradores} borrador${borradores === 1 ? '' : 'es'} del archivo se agregará${borradores === 1 ? '' : 'n'} como borrador${borradores === 1 ? '' : 'es'} en este dispositivo.`);

  const cambios = Object.values(poner).reduce((n, l) => n + l.length, 0);
  return { poner, resumen, duplicados, conflictos, avisos, hayCambios: cambios > 0 };
}
