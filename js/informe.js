// Datos del informe por sitios: qué evaluaciones entran, promedios, tendencias, hallazgos y plan de acción.
// Funciones puras (sin DOM ni IndexedDB): reciben los registros ya leídos.
import { diasDeAtraso, motivoNaAutomatico, nivelPorRango, NIVEL_NO_EVALUABLE, promedioDigitalArea, tendencia } from './calc.js';
import { normalizarNombre } from './util.js';

const vigente = (e) => e.estado === 'cerrada' && !e.anulada;
/** Clave de orden de una evaluación: fecha y, a igual fecha, momento de creación. */
const clave = (e) => `${e.fecha}|${e.creado}`;
const masReciente = (lista) => lista.reduce((a, b) => (!a || clave(b) > clave(a) ? b : a), null);
const promedio = (valores) => (valores.length ? Math.round((valores.reduce((a, v) => a + v, 0) / valores.length) * 1e9) / 1e9 : null);

/** Equipo del que trata una evaluación digital (si falta el código, el nombre del usuario o el id). */
const claveEquipo = (e) => normalizarNombre(e.equipo_codigo || e.usuario_nombre || e.id);

/** Etiqueta del usuario en la tabla digital: nombre, o "Usuario N" si el informe es anónimo. */
export const etiquetaUsuario = (ev, indice, anonimo) => (anonimo ? `Usuario ${indice + 1}` : ev.usuario_nombre || '—');

/**
 * Selecciona lo que entra al informe.
 *
 * @param datos  { sitios, areas, evaluaciones, acciones } registros de IndexedDB
 * @param filtro { sitioIds, desde, hasta (AAAA-MM-DD), modulos: ['fisico','digital'], hoy, interpretacion }
 *
 * Reglas: físico = última evaluación cerrada y vigente (no anulada) de cada área dentro del periodo;
 * digital = última por equipo dentro del periodo; la tendencia compara con la anterior del mismo área y módulo
 * aunque quede fuera del periodo.
 */
export function seleccionarInforme({ sitios, areas, evaluaciones, acciones }, { sitioIds, desde, hasta, modulos, hoy, interpretacion }) {
  const incluirFisico = modulos.includes('fisico');
  const incluirDigital = modulos.includes('digital');
  const enPeriodo = (e) => e.fecha >= desde && e.fecha <= hasta;
  const vigentes = evaluaciones.filter(vigente);

  const sitiosElegidos = sitios.filter((s) => sitioIds.includes(s.id)).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  const resultado = { periodo: { desde, hasta }, modulos, sitios: [], sinEvaluar: [], plan: [], versiones: [] };

  for (const sitio of sitiosElegidos) {
    const deSitio = areas.filter((a) => a.sitio_id === sitio.id).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    const filas = [];
    for (const area of deSitio) {
      const deArea = vigentes.filter((e) => e.area_id === area.id);

      let fisico = null;
      if (incluirFisico) {
        const todas = deArea.filter((e) => e.modulo === 'fisico');
        const ev = masReciente(todas.filter(enPeriodo));
        if (ev) {
          const anterior = masReciente(todas.filter((e) => clave(e) < clave(ev)));
          fisico = { ev, resultado: ev.resultado, anterior, tendencia: tendencia(ev.resultado?.global, anterior?.resultado?.global) };
        }
      }

      let digital = null;
      if (incluirDigital) {
        const porEquipo = new Map();
        for (const e of deArea.filter((x) => x.modulo === 'digital' && enPeriodo(x))) {
          const k = claveEquipo(e);
          if (!porEquipo.has(k) || clave(e) > clave(porEquipo.get(k))) porEquipo.set(k, e);
        }
        const evs = [...porEquipo.values()].sort((a, b) => claveEquipo(a).localeCompare(claveEquipo(b), 'es'));
        if (evs.length) digital = { evaluaciones: evs, promedio: promedioDigitalArea(evs.map((e) => e.resultado), interpretacion) };
      }

      if (fisico || digital) filas.push({ sitio, area, fisico, digital });
      else if (area.activo) resultado.sinEvaluar.push({ sitio, area });
    }
    if (filas.length) resultado.sitios.push({ sitio, areas: filas, resumen: resumenSitio(filas, interpretacion) });
  }

  // Plan de acción: acciones abiertas de evaluaciones vigentes de los sitios elegidos, hasta el fin del periodo.
  const idsArea = new Set(areas.filter((a) => sitioIds.includes(a.sitio_id)).map((a) => a.id));
  const evPlan = new Map(vigentes.filter((e) => idsArea.has(e.area_id) && e.fecha <= hasta && modulos.includes(e.modulo)).map((e) => [e.id, e]));
  const porArea = new Map(areas.map((a) => [a.id, a]));
  const porSitio = new Map(sitios.map((s) => [s.id, s]));
  resultado.plan = acciones
    .filter((a) => a.estado === 'abierta' && a.descripcion?.trim() && evPlan.has(a.evaluacion_id))
    .map((accion) => {
      const ev = evPlan.get(accion.evaluacion_id);
      const area = porArea.get(ev.area_id);
      return { sitio: porSitio.get(area?.sitio_id), area, ev, accion, atraso: diasDeAtraso(accion.fecha_compromiso, hoy) };
    })
    .sort((a, b) => b.atraso - a.atraso || a.accion.fecha_compromiso.localeCompare(b.accion.fecha_compromiso));

  // Versiones del instrumento usadas por las evaluaciones incluidas (para el anexo).
  const usadas = new Set();
  for (const s of resultado.sitios) for (const f of s.areas) {
    if (f.fisico) usadas.add(f.fisico.ev.instrumento_version);
    f.digital?.evaluaciones.forEach((e) => usadas.add(e.instrumento_version));
  }
  resultado.versiones = [...usadas].filter(Boolean).sort();
  return resultado;
}

/** Resumen de un sitio: áreas evaluadas, promedios y nivel (por rango, sin la regla de la S más débil). */
export function resumenSitio(filas, interpretacion) {
  const fisicos = filas.map((f) => f.fisico?.resultado?.global).filter((g) => g != null);
  const conFisico = filas.filter((f) => f.fisico).length;
  const digitales = filas.map((f) => f.digital?.promedio?.promedio).filter((g) => g != null);
  const promedioFisico = promedio(fisicos);
  const promedioDigital = promedio(digitales);
  // El nivel del sitio es el del promedio físico; si solo se evaluó el módulo digital, el del promedio digital.
  const base = promedioFisico ?? (conFisico === 0 ? promedioDigital : null);
  const nivel = base == null ? NIVEL_NO_EVALUABLE : nivelPorRango(base, interpretacion);
  return {
    areas: filas.length,
    fisicasNoEvaluables: conFisico - fisicos.length,
    promedioFisico,
    promedioDigital,
    nivel: base == null ? NIVEL_NO_EVALUABLE : nivel.nivel,
    color: base == null ? null : nivel.color,
  };
}

/** Filas con resultado físico evaluable, ordenadas de menor a mayor porcentaje (para el gráfico de barras). */
export function ordenarPorPuntaje(filas) {
  return filas
    .filter((f) => f.fisico?.resultado?.global != null)
    .sort((a, b) => a.fisico.resultado.global - b.fisico.resultado.global || a.area.nombre.localeCompare(b.area.nombre, 'es'));
}

/**
 * Ítems de una evaluación física para el detalle del área.
 * Hallazgos: calificados en los niveles que exigen acción (0 y 1). Buenas prácticas: niveles que exigen foto
 * y no acción (4). Ambos salen de las reglas del instrumento y se ordenan como en el instrumento.
 */
export function clasificarItems(inst, ev) {
  const nivelesAccion = inst.reglas.accion_obligatoria_en_niveles;
  const nivelesBuena = inst.reglas.foto_obligatoria_en_niveles.filter((n) => !nivelesAccion.includes(n));
  const modulo = inst.modulos.find((m) => m.id === ev.modulo);
  const porCodigo = new Map(ev.respuestas.map((r) => [r.codigo, r]));
  const hallazgos = [];
  const buenasPracticas = [];
  for (const ese of modulo.eses) {
    for (const item of ese.items) {
      if (motivoNaAutomatico(inst, item, ev.area_tipo, ev.es_primera_evaluacion)) continue;
      const r = porCodigo.get(item.codigo);
      if (!r || r.na === 'manual' || !Number.isInteger(r.valor)) continue;
      const fila = { item, ese, valor: r.valor, observacion: r.observacion ?? '', fotoIds: r.foto_ids ?? [] };
      if (nivelesAccion.includes(r.valor)) hallazgos.push(fila);
      else if (nivelesBuena.includes(r.valor)) buenasPracticas.push(fila);
    }
  }
  return { hallazgos, buenasPracticas };
}

/**
 * Fotos que entran al informe: una por ítem (la primera) de hallazgos y buenas prácticas.
 * Con `sinBuenasPracticas` se omiten las de buenas prácticas. Devuelve [{ id, codigo, tipo, evaluacionId }].
 */
export function fotosDelInforme(informe, clasificados, { sinBuenasPracticas = false } = {}) {
  const fotos = [];
  for (const sitio of informe.sitios) {
    for (const fila of sitio.areas) {
      const c = clasificados.get(fila.fisico?.ev.id);
      if (!c) continue;
      const agregar = (lista, tipo) => lista.forEach((x) => x.fotoIds[0] && fotos.push({ id: x.fotoIds[0], codigo: x.item.codigo, tipo, evaluacionId: fila.fisico.ev.id }));
      agregar(c.hallazgos, 'hallazgo');
      if (!sinBuenasPracticas) agregar(c.buenasPracticas, 'buena');
    }
  }
  return fotos;
}

/** Nombre del archivo del informe (sin extensión de fecha): un sitio o consolidado. */
export function partesNombreInforme(informe) {
  return informe.sitios.length === 1 ? ['Informe', '5S', informe.sitios[0].sitio.nombre] : ['Informe', '5S', 'Consolidado'];
}
