// Carga y validación de instrumento_5S.json. Nada del instrumento se codifica en la app.

const TOLERANCIA = 1e-9;
const NIVELES_ESCALA = [0, 1, 2, 3, 4];

export class ErrorInstrumento extends Error {
  constructor(errores) {
    super(`El instrumento 5S no es válido (${errores.length} problema${errores.length === 1 ? '' : 's'})`);
    this.name = 'ErrorInstrumento';
    this.errores = errores;
  }
}

const esTexto = (x) => typeof x === 'string' && x.trim() !== '';
const esNumero = (x) => typeof x === 'number' && Number.isFinite(x);

/**
 * Valida la estructura y las reglas del instrumento.
 * Devuelve la lista de problemas en español; vacía si es válido.
 */
export function validarInstrumento(inst) {
  const errores = [];
  const err = (m) => errores.push(m);

  if (!inst || typeof inst !== 'object') return ['El instrumento está vacío o no es un objeto JSON.'];

  validarMeta(inst.meta, err);
  validarEscala(inst.escala, err);
  const tipos = validarTipos(inst.tipos_area, err);
  validarInterpretacion(inst.interpretacion, err);
  validarReglas(inst.reglas, inst.interpretacion, err);
  validarModulos(inst.modulos, tipos, err);
  return errores;
}

function validarMeta(meta, err) {
  if (!meta) return err('Falta "meta".');
  for (const campo of ['titulo', 'organizacion', 'codigo_formato', 'version', 'fecha_version']) {
    if (!esTexto(meta[campo])) err(`meta.${campo} falta o está vacío.`);
  }
}

function validarEscala(escala, err) {
  if (!Array.isArray(escala)) return err('Falta "escala" (lista de niveles 0 a 4).');
  const niveles = escala.map((e) => e.nivel).sort();
  if (niveles.join() !== NIVELES_ESCALA.join()) err('La escala debe tener exactamente los niveles 0, 1, 2, 3 y 4.');
  for (const e of escala) {
    if (!esTexto(e.nombre) || !esTexto(e.criterio)) err(`Escala nivel ${e.nivel}: faltan nombre o criterio.`);
  }
}

function validarTipos(tipos, err) {
  if (!Array.isArray(tipos) || tipos.length === 0) {
    err('Falta "tipos_area".');
    return [];
  }
  const codigos = tipos.map((t) => t.codigo);
  if (new Set(codigos).size !== codigos.length) err('tipos_area: hay códigos repetidos.');
  for (const t of tipos) if (!esTexto(t.codigo) || !esTexto(t.nombre)) err('tipos_area: cada tipo necesita código y nombre.');
  return codigos;
}

function validarInterpretacion(interp, err) {
  if (!Array.isArray(interp) || interp.length === 0) return err('Falta "interpretacion".');
  const orden = [...interp].sort((a, b) => a.min - b.min);
  const nombres = new Set();
  orden.forEach((r, i) => {
    const etiqueta = `interpretacion "${r.nivel ?? i}"`;
    if (!esTexto(r.nivel)) err(`${etiqueta}: falta el nombre del nivel.`);
    if (nombres.has(r.nivel)) err(`${etiqueta}: nombre de nivel repetido.`);
    nombres.add(r.nivel);
    if (!esNumero(r.min) || !esNumero(r.max) || r.min > r.max) err(`${etiqueta}: rango min/max inválido.`);
    if (!/^#[0-9a-fA-F]{6}$/.test(r.color || '')) err(`${etiqueta}: el color debe ser hexadecimal (#RRGGBB).`);
    if (!esNumero(r.reevaluar_meses) || r.reevaluar_meses <= 0) err(`${etiqueta}: reevaluar_meses debe ser un número positivo.`);
    if (i > 0 && r.min <= orden[i - 1].max) err(`${etiqueta}: el rango se traslapa con "${orden[i - 1].nivel}".`);
    // Se tolera un hueco de hasta 1 punto (p. ej., 39,99 → 40): el nivel se decide solo con "min".
    if (i > 0 && r.min - orden[i - 1].max > 1) err(`${etiqueta}: hay un hueco mayor a 1 punto respecto a "${orden[i - 1].nivel}".`);
  });
  if (orden[0].min !== 0) err('interpretacion: el primer rango debe empezar en 0.');
  if (orden[orden.length - 1].max < 100) err('interpretacion: el último rango debe llegar hasta 100.');
}

function validarReglas(reglas, interp, err) {
  if (!reglas) return err('Falta "reglas".');
  if (!Number.isInteger(reglas.max_na_por_s) || reglas.max_na_por_s < 0) err('reglas.max_na_por_s debe ser un entero ≥ 0.');
  if (!Number.isInteger(reglas.min_items_calificados_por_s) || reglas.min_items_calificados_por_s < 1) {
    err('reglas.min_items_calificados_por_s debe ser un entero ≥ 1.');
  }
  for (const campo of ['foto_obligatoria_en_niveles', 'accion_obligatoria_en_niveles']) {
    const v = reglas[campo];
    if (!Array.isArray(v) || v.some((n) => !NIVELES_ESCALA.includes(n))) err(`reglas.${campo} debe ser una lista de niveles entre 0 y 4.`);
  }
  const d = reglas.regla_s_mas_debil;
  if (!d) return err('Falta reglas.regla_s_mas_debil.');
  const nombres = new Set((interp || []).map((r) => r.nivel));
  if (!esNumero(d.umbral_porcentaje) || d.umbral_porcentaje < 0 || d.umbral_porcentaje > 100) err('regla_s_mas_debil.umbral_porcentaje debe estar entre 0 y 100.');
  if (!nombres.has(d.nivel_asignado)) err(`regla_s_mas_debil.nivel_asignado "${d.nivel_asignado}" no existe en interpretacion.`);
  if (!Array.isArray(d.niveles_bloqueados) || d.niveles_bloqueados.some((n) => !nombres.has(n))) {
    err('regla_s_mas_debil.niveles_bloqueados contiene niveles que no existen en interpretacion.');
  }
}

function validarModulos(modulos, tipos, err) {
  if (!Array.isArray(modulos) || modulos.length === 0) return err('Falta "modulos".');
  const ids = modulos.map((m) => m.id);
  if (new Set(ids).size !== ids.length) err('modulos: hay ids repetidos.');
  for (const requerido of ['fisico', 'digital']) {
    if (!ids.includes(requerido)) err(`Falta el módulo "${requerido}".`);
  }
  const codigosVistos = new Set();
  for (const m of modulos) validarModulo(m, tipos, codigosVistos, err);
  const digital = modulos.find((m) => m.id === 'digital');
  if (digital && (!Array.isArray(digital.reglas_confidencialidad) || digital.reglas_confidencialidad.length === 0)) {
    err('El módulo digital necesita "reglas_confidencialidad".');
  }
}

function validarModulo(m, tipos, codigosVistos, err) {
  const p = `Módulo "${m.id}"`;
  if (!esTexto(m.nombre)) err(`${p}: falta el nombre.`);
  if (!Array.isArray(m.eses) || m.eses.length === 0) return err(`${p}: no tiene S definidas.`);

  const idsS = m.eses.map((s) => s.id);
  if (new Set(idsS).size !== idsS.length) err(`${p}: hay ids de S repetidos.`);

  // Pesos: una clave por S y suma exactamente 1.
  const pesos = m.pesos || {};
  const clavesPesos = Object.keys(pesos);
  if (clavesPesos.length !== idsS.length || idsS.some((id) => !(id in pesos))) err(`${p}: "pesos" debe tener exactamente una entrada por cada S (${idsS.join(', ')}).`);
  const suma = clavesPesos.reduce((a, k) => a + Number(pesos[k]), 0);
  if (clavesPesos.some((k) => !esNumero(pesos[k]) || pesos[k] < 0)) err(`${p}: los pesos deben ser números ≥ 0.`);
  else if (Math.abs(suma - 1) > TOLERANCIA) err(`${p}: los pesos suman ${suma}, deben sumar 1.`);

  // Un ítem que no aplica a ningún tipo de área (p. ej. "D") aplica a todas: solo el módulo digital lo usa.
  for (const s of m.eses) {
    if (!Array.isArray(s.items) || s.items.length === 0) err(`${p}, ${s.id}: no tiene ítems.`);
    for (const it of s.items || []) validarItem(it, s, p, tipos, codigosVistos, err, m.id);
  }
}

function validarItem(it, s, p, tipos, codigosVistos, err, moduloId) {
  const c = it.codigo;
  if (!esTexto(c)) return err(`${p}, ${s.id}: hay un ítem sin código.`);
  if (codigosVistos.has(c)) err(`Código de ítem repetido: ${c}.`);
  codigosVistos.add(c);
  if (!c.startsWith(`${s.id}.`)) err(`Ítem ${c}: el código debe empezar por "${s.id}.".`);
  if (!esTexto(it.texto)) err(`Ítem ${c}: falta el texto.`);
  if (!Array.isArray(it.aplica) || it.aplica.length === 0) err(`Ítem ${c}: "aplica" debe ser una lista no vacía.`);
  else if (moduloId === 'digital') {
    if (it.aplica.some((t) => tipos.includes(t))) err(`Ítem ${c}: en el módulo digital "aplica" no debe usar tipos de área.`);
  } else if (it.aplica.some((t) => !tipos.includes(t))) {
    err(`Ítem ${c}: "aplica" contiene tipos de área inexistentes (${it.aplica.join(', ')}).`);
  }
  if (it.na_en_primera_evaluacion !== undefined && typeof it.na_en_primera_evaluacion !== 'boolean') {
    err(`Ítem ${c}: na_en_primera_evaluacion debe ser true o false.`);
  }
  for (const nivel of ['0', '2', '4']) {
    if (!esTexto(it.descriptores?.[nivel])) err(`Ítem ${c}: falta el descriptor del nivel ${nivel}.`);
  }
}

/** Hash FNV-1a de 32 bits (hex): detecta cambios del instrumento sin depender de crypto.subtle (solo HTTPS). */
export function hashTexto(texto) {
  let h = 0x811c9dc5;
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** Clave única de una versión del instrumento: la versión declarada más el hash de su contenido. */
export const claveInstrumento = (version, hash) => `${version}|${hash}`;

/** Lee, valida y devuelve el instrumento junto con su hash y clave. Lanza ErrorInstrumento si falla. */
export async function cargarInstrumento(url = 'instrumento_5S.json') {
  let texto;
  try {
    const r = await fetch(url, { cache: 'no-cache' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    texto = await r.text();
  } catch (e) {
    throw new ErrorInstrumento([`No se pudo leer ${url}: ${e.message}`]);
  }
  let json;
  try {
    json = JSON.parse(texto);
  } catch (e) {
    throw new ErrorInstrumento([`${url} no es un JSON válido: ${e.message}`]);
  }
  const errores = validarInstrumento(json);
  if (errores.length) throw new ErrorInstrumento(errores);
  const hash = hashTexto(JSON.stringify(json));
  return { instrumento: json, hash, clave: claveInstrumento(json.meta.version, hash) };
}
