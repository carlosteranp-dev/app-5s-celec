// Motor de cálculo 5S: funciones puras, sin DOM ni acceso a IndexedDB.
// Todas las reglas, umbrales y pesos salen del instrumento recibido (instrumento_5S.json).

const EPS = 1e-9;
export const NIVEL_NO_EVALUABLE = 'No evaluable';

/** Redondea a 9 decimales para absorber el error de punto flotante antes de comparar con los límites. */
const limpiar = (x) => Math.round(x * 1e9) / 1e9;
const valorValido = (v) => Number.isInteger(v) && v >= 0 && v <= 4;

export function obtenerModulo(inst, moduloId) {
  const m = inst.modulos.find((x) => x.id === moduloId);
  if (!m) throw new Error(`El instrumento no tiene el módulo "${moduloId}".`);
  return m;
}

/** Todos los ítems de un módulo, con la S a la que pertenecen. */
export function itemsDelModulo(inst, moduloId) {
  return obtenerModulo(inst, moduloId).eses.flatMap((s) => s.items.map((item) => ({ item, ese: s })));
}

// ---------------------------------------------------------------------------
// N/A automático y respuestas
// ---------------------------------------------------------------------------

/**
 * Motivo del N/A automático de un ítem: 'tipo' (no aplica al tipo de área), 'primera'
 * (se omite en la primera evaluación) o null si el ítem se debe calificar.
 * Un ítem cuyo "aplica" no usa tipos de área (módulo digital) aplica a todas las áreas.
 */
export function motivoNaAutomatico(inst, item, tipoArea, esPrimera) {
  const codigosTipo = inst.tipos_area.map((t) => t.codigo);
  const usaTipos = item.aplica.some((c) => codigosTipo.includes(c));
  if (usaTipos && !item.aplica.includes(tipoArea)) return 'tipo';
  if (item.na_en_primera_evaluacion === true && esPrimera) return 'primera';
  return null;
}

export const esNaAutomatico = (inst, item, tipoArea, esPrimera) => motivoNaAutomatico(inst, item, tipoArea, esPrimera) !== null;

const respuestaVacia = (codigo) => ({ codigo, valor: null, na: null, na_justificacion: '', observacion: '', foto_ids: [] });

/**
 * Crea o ajusta la lista de respuestas: una por ítem del módulo, con el N/A automático
 * puesto o quitado según el tipo de área y si es la primera evaluación. No pierde datos del evaluador.
 */
export function sincronizarRespuestas(inst, moduloId, respuestas, { tipoArea, esPrimera }) {
  const previas = new Map((respuestas || []).map((r) => [r.codigo, r]));
  return itemsDelModulo(inst, moduloId).map(({ item }) => {
    const r = { ...respuestaVacia(item.codigo), ...(previas.get(item.codigo) || {}) };
    if (esNaAutomatico(inst, item, tipoArea, esPrimera)) {
      return { ...r, valor: null, na: 'automatico', na_justificacion: '' };
    }
    return r.na === 'automatico' ? { ...r, na: null } : r;
  });
}

// ---------------------------------------------------------------------------
// Niveles de interpretación
// ---------------------------------------------------------------------------

/**
 * Nivel de interpretación para un porcentaje. Se usa solo el límite inferior "min" de cada rango
 * (los "max" del JSON, como 39,99, dejan huecos que no deben dejar valores sin nivel).
 */
export function nivelPorRango(porcentaje, interpretacion) {
  const orden = [...interpretacion].sort((a, b) => a.min - b.min);
  const v = limpiar(porcentaje);
  let elegido = orden[0];
  for (const r of orden) if (v + EPS >= r.min) elegido = r;
  return elegido;
}

const infoNivel = (nombre, interpretacion) => interpretacion.find((r) => r.nivel === nombre);

/** Suma `meses` a una fecha AAAA-MM-DD recortando al fin de mes (31 ene + 1 mes = 28 feb). */
export function sumarMeses(fechaISO, meses) {
  const [a, m, d] = fechaISO.slice(0, 10).split('-').map(Number);
  const total = m - 1 + meses;
  const anio = a + Math.floor(total / 12);
  const mes = ((total % 12) + 12) % 12;
  const ultimoDia = new Date(Date.UTC(anio, mes + 1, 0)).getUTCDate();
  const p = (n) => String(n).padStart(2, '0');
  return `${anio}-${p(mes + 1)}-${p(Math.min(d, ultimoDia))}`;
}

// ---------------------------------------------------------------------------
// Resultado de una evaluación
// ---------------------------------------------------------------------------

/**
 * Calcula puntajes por S, resultado global, nivel y regla de la S más débil.
 *
 * @param inst        instrumento (el de la versión con la que se hizo la evaluación)
 * @param moduloId    'fisico' | 'digital'
 * @param respuestas  respuestas[] de la evaluación
 * @param opciones    { tipoArea, esPrimera, fecha } (fecha AAAA-MM-DD para la próxima evaluación)
 *
 * Si quedan ítems sin responder el resultado es provisional (`parcial: true`) y se calcula con lo respondido.
 */
export function calcularResultado(inst, moduloId, respuestas, { tipoArea, esPrimera = false, fecha = null }) {
  const modulo = obtenerModulo(inst, moduloId);
  const { max_na_por_s: maxNa, min_items_calificados_por_s: minItems } = inst.reglas;
  const porCodigo = new Map((respuestas || []).map((r) => [r.codigo, r]));

  const porS = modulo.eses.map((ese) => {
    const s = { id: ese.id, nombre: ese.nombre, traduccion: ese.traduccion, peso: modulo.pesos[ese.id] };
    Object.assign(s, { total_items: ese.items.length, na_automaticos: 0, na_manuales: 0, calificados: 0, pendientes: 0, suma: 0 });
    for (const item of ese.items) {
      if (esNaAutomatico(inst, item, tipoArea, esPrimera)) {
        s.na_automaticos++;
        continue;
      }
      const r = porCodigo.get(item.codigo);
      if (r?.na === 'manual') s.na_manuales++;
      else if (valorValido(r?.valor)) {
        s.calificados++;
        s.suma += r.valor;
      } else s.pendientes++;
    }
    s.n = s.calificados + s.pendientes; // ítems aplicables sin ningún N/A
    s.porcentaje = s.calificados > 0 ? limpiar((s.suma / (4 * s.calificados)) * 100) : null;
    const motivo = s.na_manuales > maxNa ? `Más de ${maxNa} N/A manuales` : s.n < minItems ? `Menos de ${minItems} ítems calificados` : null;
    s.evaluable = motivo === null;
    s.motivo_no_evaluable = motivo;
    return s;
  });

  const pendientes = porS.reduce((a, s) => a + s.pendientes, 0);
  const todasEvaluables = porS.every((s) => s.evaluable && s.porcentaje !== null);
  const global = todasEvaluables ? limpiar(porS.reduce((a, s) => a + s.peso * s.porcentaje, 0)) : null;

  return { modulo: moduloId, instrumento_version: inst.meta.version, por_s: porS, pendientes, parcial: pendientes > 0, global, ...clasificar(inst, global, porS, fecha) };
}

/** Nivel final de una evaluación: rango, regla de la S más débil y próxima evaluación sugerida. */
function clasificar(inst, global, porS, fecha) {
  if (global === null) {
    return { nivel: NIVEL_NO_EVALUABLE, nivel_por_rango: NIVEL_NO_EVALUABLE, color: null, respuesta: null, regla_s_debil_aplicada: false, s_debiles: [], reevaluar_meses: null, proxima_evaluacion: null };
  }
  const { regla_s_mas_debil: regla } = inst.reglas;
  const porRango = nivelPorRango(global, inst.interpretacion);
  const debiles = porS.filter((s) => s.porcentaje < regla.umbral_porcentaje - EPS).map((s) => s.id);
  const aplicada = regla.niveles_bloqueados.includes(porRango.nivel) && debiles.length > 0;
  const final = aplicada ? infoNivel(regla.nivel_asignado, inst.interpretacion) : porRango;
  return {
    nivel: final.nivel,
    nivel_por_rango: porRango.nivel,
    color: final.color,
    respuesta: final.respuesta,
    regla_s_debil_aplicada: aplicada,
    s_debiles: debiles,
    reevaluar_meses: final.reevaluar_meses,
    proxima_evaluacion: fecha ? sumarMeses(fecha, final.reevaluar_meses) : null,
  };
}

// ---------------------------------------------------------------------------
// Validaciones por ítem y avance
// ---------------------------------------------------------------------------

/**
 * Problemas pendientes de un ítem según las reglas del instrumento:
 * 'pendiente', 'na_sin_justificacion', 'falta_foto', 'falta_accion'.
 * `accionesDelItem` es la cantidad de acciones completas registradas para el ítem.
 */
export function problemasDeRespuesta(inst, respuesta, { accionesDelItem = 0 } = {}) {
  if (!respuesta || respuesta.na === 'automatico') return [];
  if (respuesta.na === 'manual') return respuesta.na_justificacion?.trim() ? [] : ['na_sin_justificacion'];
  if (!valorValido(respuesta.valor)) return ['pendiente'];
  const problemas = [];
  const { foto_obligatoria_en_niveles: fotos, accion_obligatoria_en_niveles: acciones } = inst.reglas;
  if (fotos.includes(respuesta.valor) && !(respuesta.foto_ids?.length > 0)) problemas.push('falta_foto');
  if (acciones.includes(respuesta.valor) && accionesDelItem < 1) problemas.push('falta_accion');
  return problemas;
}

/** Problemas de todos los ítems calificables de la evaluación (clave = código de ítem). */
export function validarEvaluacion(inst, ev, { accionesPorItem = {} } = {}) {
  const porItem = {};
  const porCodigo = new Map(ev.respuestas.map((r) => [r.codigo, r]));
  for (const { item } of itemsDelModulo(inst, ev.modulo)) {
    if (esNaAutomatico(inst, item, ev.area_tipo, ev.es_primera_evaluacion)) continue;
    const p = problemasDeRespuesta(inst, porCodigo.get(item.codigo), { accionesDelItem: accionesPorItem[item.codigo] || 0 });
    if (p.length) porItem[item.codigo] = p;
  }
  return { completo: Object.keys(porItem).length === 0, porItem };
}

/** Ítems resueltos (calificados o con N/A manual) sobre ítems calificables, en total y por S. */
export function avance(inst, ev) {
  const porCodigo = new Map(ev.respuestas.map((r) => [r.codigo, r]));
  const porS = obtenerModulo(inst, ev.modulo).eses.map((ese) => {
    let total = 0;
    let hechos = 0;
    for (const item of ese.items) {
      if (esNaAutomatico(inst, item, ev.area_tipo, ev.es_primera_evaluacion)) continue;
      total++;
      const r = porCodigo.get(item.codigo);
      if (r && (r.na === 'manual' || valorValido(r.valor))) hechos++;
    }
    return { id: ese.id, total, hechos };
  });
  return { total: porS.reduce((a, s) => a + s.total, 0), hechos: porS.reduce((a, s) => a + s.hechos, 0), porS };
}

/** Texto del nivel 0–4 de un ítem: 0, 2 y 4 desde sus descriptores; 1 y 3 con el criterio general de la escala. */
export function descriptorNivel(inst, item, nivel) {
  const esc = inst.escala.find((e) => e.nivel === nivel);
  const propio = item.descriptores[String(nivel)];
  return { nivel, nombre: esc.nombre, texto: propio ?? esc.criterio, general: propio === undefined };
}

// ---------------------------------------------------------------------------
// Agregados por área y presentación
// ---------------------------------------------------------------------------

/**
 * Resultado digital del área: promedio de los P_global de los usuarios evaluados.
 * Excluye los no evaluables (global null) y los cuenta aparte. Nunca se combina con el físico.
 */
export function promedioDigitalArea(resultados, interpretacion) {
  const validos = resultados.filter((r) => r && r.global !== null && r.global !== undefined);
  const excluidos = resultados.length - validos.length;
  if (validos.length === 0) return { promedio: null, evaluados: 0, excluidos, nivel: NIVEL_NO_EVALUABLE, color: null };
  const promedio = limpiar(validos.reduce((a, r) => a + r.global, 0) / validos.length);
  const n = nivelPorRango(promedio, interpretacion);
  return { promedio, evaluados: validos.length, excluidos, nivel: n.nivel, color: n.color };
}

/** Tendencia frente a la evaluación anterior: 'sube', 'baja', 'igual' (|Δ| < tolerancia) o null si falta un dato. */
export function tendencia(actual, anterior, tolerancia = 1) {
  if (actual == null || anterior == null) return null;
  const d = actual - anterior;
  return Math.abs(d) < tolerancia ? 'igual' : d > 0 ? 'sube' : 'baja';
}

const coma = (n, dec) => n.toFixed(dec).replace('.', ',');

/** Puntaje de una S con 1 decimal. */
export const formatoPuntaje = (v) => (v == null ? '—' : `${coma(Math.round(v * 10) / 10, 1)} %`);

/**
 * Resultado global con 1 decimal. Si el redondeo cruzaría un límite de nivel (79,96 → "80,0 %"
 * pero el nivel es En desarrollo) se muestran 2 decimales truncados para que el número y el nivel coincidan.
 */
export function formatoGlobal(v, interpretacion) {
  if (v == null) return '—';
  const redondeado = Math.round(v * 10) / 10;
  if (nivelPorRango(redondeado, interpretacion).nivel !== nivelPorRango(v, interpretacion).nivel) {
    return `${coma(Math.floor(v * 100 + EPS) / 100, 2)} %`;
  }
  return `${coma(redondeado, 1)} %`;
}

// ---------------------------------------------------------------------------
// Acciones, cierre y resultado de una evaluación
// ---------------------------------------------------------------------------

/**
 * Una acción está completa con descripción, responsable y fecha de compromiso.
 * Si se indica `fechaMinima` (la fecha de la evaluación), el compromiso no puede ser anterior.
 */
export const accionCompleta = (a, fechaMinima = null) =>
  Boolean(a?.descripcion?.trim() && a?.responsable?.trim() && a?.fecha_compromiso && (!fechaMinima || a.fecha_compromiso >= fechaMinima));

/** Una acción sin descripción ni fecha es un borrador vacío que se puede descartar. */
export const accionVacia = (a) => !a?.descripcion?.trim() && !a?.fecha_compromiso;

/** Cantidad de acciones completas por código de ítem. */
export function accionesPorItem(acciones, fechaMinima = null) {
  const cuenta = {};
  for (const a of acciones || []) if (accionCompleta(a, fechaMinima)) cuenta[a.codigo_item] = (cuenta[a.codigo_item] || 0) + 1;
  return cuenta;
}

/** Resultado de la evaluación con sus propios datos (tipo de área congelado y si fue la primera). */
export const resultadoDeEvaluacion = (inst, ev) =>
  calcularResultado(inst, ev.modulo, ev.respuestas, { tipoArea: ev.area_tipo, esPrimera: ev.es_primera_evaluacion, fecha: ev.fecha });

/**
 * ¿Se puede cerrar? Devuelve `puede` y las causas pendientes:
 * 'items' (con detalle en `items`), 'firma_evaluador' y 'firma_responsable'
 * (se acepta como alternativa a la firma un motivo escrito de ausencia del responsable).
 */
export function validarCierre(inst, ev, { acciones = [] } = {}) {
  const v = validarEvaluacion(inst, ev, { accionesPorItem: accionesPorItem(acciones, ev.fecha) });
  const pendientes = [];
  if (!v.completo) pendientes.push('items');
  if (!ev.firmas?.evaluador) pendientes.push('firma_evaluador');
  if (!ev.firmas?.responsable && !ev.firma_responsable_ausente?.trim()) pendientes.push('firma_responsable');
  return { puede: pendientes.length === 0, pendientes, items: v.porItem };
}

/** Días de atraso de una fecha de compromiso (AAAA-MM-DD) respecto a `hoy`; 0 si no está vencida. */
export function diasDeAtraso(fechaCompromiso, hoy) {
  if (!fechaCompromiso || !hoy) return 0;
  const dia = (iso) => Date.UTC(...iso.slice(0, 10).split('-').map((n, i) => (i === 1 ? Number(n) - 1 : Number(n))));
  return Math.max(0, Math.round((dia(hoy) - dia(fechaCompromiso)) / 86400000));
}

/**
 * Pista informativa para S5.3: de las acciones previas cuyo plazo ya venció o que se cerraron,
 * cuántas se cerraron a tiempo. No puntúa nada por sí sola.
 */
export function resumenAccionesPrevias(acciones, hoy) {
  const base = (acciones || []).filter((a) => a.estado === 'cerrada' || (a.fecha_compromiso && a.fecha_compromiso < hoy));
  const aTiempo = base.filter((a) => a.estado === 'cerrada' && a.fecha_cierre && a.fecha_cierre.slice(0, 10) <= a.fecha_compromiso).length;
  return { total: base.length, a_tiempo: aTiempo, porcentaje: base.length ? limpiar((aTiempo / base.length) * 100) : null };
}
