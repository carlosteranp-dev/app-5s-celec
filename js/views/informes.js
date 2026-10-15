// Informes: elegir sitios, periodo y módulos, y generar el informe PDF por sitios.
import * as db from '../db.js';
import { ctx } from '../contexto.js';
import { seleccionarInforme } from '../informe.js';
import { esc, fechaCorta, hoyLocal } from '../util.js';
import { barraSuperior, toast } from '../ui.js';
import { dialogoEntrega, dialogoExceso, dialogoProgreso } from '../entrega.js';
import { sumarMeses } from '../calc.js';

const CLAVE_PREFERENCIAS = 'informes_preferencias';

/** "1 evaluación" / "2 evaluaciones": el plural no siempre se forma agregando "es" (evaluación → evaluaciones). */
const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;
const LIMITE_MB = 15;

/** Preferencias de interfaz (última selección). localStorage puede no estar disponible: se ignora el error. */
const leerPreferencias = () => {
  try {
    return JSON.parse(localStorage.getItem(CLAVE_PREFERENCIAS) ?? '{}');
  } catch {
    return {};
  }
};
const guardarPreferencias = (p) => {
  try {
    localStorage.setItem(CLAVE_PREFERENCIAS, JSON.stringify(p));
  } catch {
    /* sin almacenamiento de preferencias */
  }
};

export async function render(cont) {
  const inst = ctx.instrumento;
  const [sitios, areas, evaluaciones, acciones] = await Promise.all([db.todos('sitios'), db.todos('areas'), db.todos('evaluaciones'), db.todos('acciones')]);
  const hoy = hoyLocal();
  const prefs = leerPreferencias();
  // Las fechas NO se recuerdan entre visitas: un "hasta" guardado de ayer dejaría fuera lo evaluado hoy.
  // Por defecto: los últimos 12 meses hasta hoy (o hasta la última evaluación, si su fecha es posterior a hoy).
  const cerradas = evaluaciones.filter((e) => e.estado === 'cerrada' && !e.anulada);
  const ultimaFecha = cerradas.map((e) => e.fecha).sort().at(-1);
  const desdePorDefecto = sumarMeses(hoy, -12);
  const hastaPorDefecto = ultimaFecha && ultimaFecha > hoy ? ultimaFecha : hoy;
  const ordenados = [...sitios].sort((a, b) => Number(b.activo) - Number(a.activo) || a.nombre.localeCompare(b.nombre, 'es'));
  const idsPrevios = new Set(prefs.sitioIds ?? sitios.filter((s) => s.activo).map((s) => s.id));

  if (!sitios.length) {
    cont.innerHTML = `${barraSuperior('Informes', '#/')}<div class="contenido"><div class="tarjeta"><p>Aún no hay sitios ni evaluaciones. Cree un sitio y cierre al menos una evaluación para generar informes.</p><a class="btn btn--primario btn--bloque" href="#/sitios">Sitios y áreas</a></div></div>`;
    return;
  }

  cont.innerHTML = `
    ${barraSuperior('Informes', '#/')}
    <form class="contenido pila" novalidate>
      <section class="tarjeta">
        <h2>Sitios</h2>
        ${ordenados.map((s) => `<label class="casilla"><input type="checkbox" name="sitio" value="${esc(s.id)}" ${idsPrevios.has(s.id) ? 'checked' : ''}> ${esc(s.nombre)}${s.activo ? '' : ' <small>(inactivo)</small>'}</label>`).join('')}
      </section>
      <section class="tarjeta">
        <h2>Periodo</h2>
        <label class="campo"><span>Desde</span><input type="date" name="desde" value="${esc(desdePorDefecto)}"></label>
        <label class="campo"><span>Hasta</span><input type="date" name="hasta" value="${esc(hastaPorDefecto)}"></label>
        <small>Se usa la última evaluación cerrada de cada área dentro del periodo.</small>
      </section>
      <section class="tarjeta">
        <h2>Módulos</h2>
        ${inst.modulos.map((m) => `<label class="casilla"><input type="checkbox" name="modulo" value="${esc(m.id)}" ${(prefs.modulos ?? inst.modulos.map((x) => x.id)).includes(m.id) ? 'checked' : ''}> ${esc(m.nombre)}</label>`).join('')}
        <label class="casilla"><input type="checkbox" name="anonimo" ${prefs.anonimo ? 'checked' : ''}> Anonimizar usuarios de 5S Digital</label>
      </section>
      <section class="tarjeta" data-vista-previa aria-live="polite"></section>
      <p class="mensaje-error oculto" role="alert"></p>
      <button type="submit" class="btn btn--primario btn--bloque">Generar informe PDF</button>
    </form>`;

  const form = cont.querySelector('form');
  const vista = cont.querySelector('[data-vista-previa]');
  const aviso = cont.querySelector('.mensaje-error');
  const boton = form.querySelector('[type=submit]');

  const leerFiltro = () => ({
    sitioIds: [...form.querySelectorAll('[name=sitio]:checked')].map((x) => x.value),
    desde: form.desde.value,
    hasta: form.hasta.value,
    modulos: [...form.querySelectorAll('[name=modulo]:checked')].map((x) => x.value),
  });

  /** Valida el formulario y devuelve un mensaje de error, o null. */
  function validar(f) {
    if (!f.sitioIds.length) return 'Seleccione al menos un sitio.';
    if (!f.modulos.length) return 'Seleccione al menos un módulo.';
    if (!f.desde || !f.hasta) return 'Indique el periodo (desde y hasta).';
    if (f.desde > f.hasta) return 'La fecha "desde" no puede ser posterior a "hasta".';
    return null;
  }

  /** Explica por qué no hay nada que informar: casi siempre es el periodo (las evaluaciones cerradas caen fuera de las fechas). */
  function sinResultados(f) {
    const idsAreas = new Set(areas.filter((a) => f.sitioIds.includes(a.sitio_id)).map((a) => a.id));
    const fechas = cerradas.filter((e) => idsAreas.has(e.area_id) && f.modulos.includes(e.modulo)).map((e) => e.fecha).sort();
    if (fechas.length) {
      return `Hay ${plural(fechas.length, 'evaluación cerrada', 'evaluaciones cerradas')} en estos sitios con fechas entre <strong>${fechaCorta(fechas[0])}</strong> y <strong>${fechaCorta(fechas.at(-1))}</strong>, fuera del periodo elegido. Ajuste "Desde" y "Hasta" para incluirlas.`;
    }
    return 'No hay evaluaciones cerradas en los sitios y módulos seleccionados. Solo cuentan las evaluaciones cerradas: los borradores no entran en el informe.';
  }

  function actualizarVista() {
    const f = leerFiltro();
    const error = validar(f);
    guardarPreferencias({ sitioIds: f.sitioIds, modulos: f.modulos, anonimo: form.anonimo.checked });
    aviso.classList.toggle('oculto', !error);
    aviso.textContent = error ?? '';
    if (error) {
      vista.innerHTML = '';
      boton.disabled = true;
      return;
    }
    const informe = seleccionarInforme({ sitios, areas, evaluaciones, acciones }, { ...f, hoy, interpretacion: inst.interpretacion });
    const filas = informe.sitios.flatMap((s) => s.areas);
    const fisicas = filas.filter((x) => x.fisico).length;
    const digitales = filas.reduce((a, x) => a + (x.digital?.evaluaciones.length ?? 0), 0);
    const noEvaluables = filas.filter((x) => x.fisico && x.fisico.resultado?.global == null).length;
    boton.disabled = informe.sitios.length === 0;
    vista.innerHTML = informe.sitios.length
      ? `<h2>Contenido del informe</h2>
         <ul>
           <li><strong>${informe.sitios.length}</strong> sitio${informe.sitios.length === 1 ? '' : 's'} y <strong>${filas.length}</strong> área${filas.length === 1 ? '' : 's'} con evaluaciones</li>
           <li>${plural(fisicas, 'evaluación física', 'evaluaciones físicas')}${noEvaluables ? ` (${plural(noEvaluables, 'no evaluable', 'no evaluables')})` : ''} y ${plural(digitales, 'evaluación digital', 'evaluaciones digitales')}</li>
           <li>${plural(informe.plan.length, 'acción abierta', 'acciones abiertas')} en el plan de acción</li>
         </ul>
         ${informe.sinEvaluar.length ? `<p class="aviso"><strong>${informe.sinEvaluar.length} área${informe.sinEvaluar.length === 1 ? '' : 's'} activa${informe.sinEvaluar.length === 1 ? '' : 's'} sin evaluación en el periodo:</strong> ${informe.sinEvaluar.map((x) => `${esc(x.area.nombre)} (${esc(x.sitio.nombre)})`).join(', ')}.</p>` : ''}`
      : `<h2>Contenido del informe</h2><p class="aviso">${sinResultados(f)}</p>`;
  }

  form.addEventListener('change', actualizarVista);
  actualizarVista();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const filtro = leerFiltro();
    if (validar(filtro)) return;
    boton.disabled = true;
    const progreso = dialogoProgreso('Generando informe PDF');
    try {
      const { generarInforme } = await import('../pdf-informe.js');
      const resultado = await generarInforme(filtro, {
        anonimo: form.anonimo.checked,
        onProgreso: (fraccion, texto) => progreso.actualizar(fraccion, texto), // `progreso` se reemplaza tras el diálogo de tamaño
        decidirExceso: async (estimadoMB) => {
          progreso.cerrar(); // el diálogo de decisión necesita la pantalla libre
          const decision = await dialogoExceso({ estimadoMB, limiteMB: LIMITE_MB });
          if (decision !== 'cancelar') Object.assign(progreso, dialogoProgreso('Generando informe PDF'));
          return decision;
        },
      });
      progreso.cerrar();
      if (resultado) {
        const seg = resultado.segundos.toFixed(1).replace('.', ',');
        dialogoEntrega({ blob: resultado.blob, nombre: resultado.nombre, detalle: `generado en ${seg} s` });
      }
    } catch (err) {
      console.error(err);
      progreso.cerrar();
      toast(`No se pudo generar el informe: ${err.message}`, 8000);
    } finally {
      boton.disabled = false;
    }
  });
}
