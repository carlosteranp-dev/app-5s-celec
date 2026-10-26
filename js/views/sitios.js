// Sitios y áreas: alta, edición y desactivación (nunca se borran). Muestra último resultado y tendencia.
import * as db from '../db.js';
import { ctx } from '../contexto.js';
import { promedioDigitalArea, tendencia, formatoGlobal, sumarMeses } from '../calc.js';
import { esc, hoyLocal, fechaCorta, normalizarNombre } from '../util.js';
import { barraSuperior, chipNivel, dialogoFormulario, confirmar, toast } from '../ui.js';
import { areasDeLocalidad, asegurarArea, asegurarSitio, cargarCatalogo, dialogoElegirAreas, dialogoElegirLocalidades, localidadesDisponibles } from '../catalogo.js';

const MESES_DIGITAL = 12; // periodo del "resultado digital" en esta pantalla (decisión D7)
const FLECHA = { sube: '▲', baja: '▼', igual: '=' };

/** Último resultado físico (con tendencia) y promedio digital reciente de un área. */
async function resultadosDeArea(area) {
  const interp = ctx.instrumento.interpretacion;
  const fisicas = await db.cerradasDeArea(area.id, 'fisico');
  const ultima = fisicas[0] ?? null;
  const flecha = ultima ? tendencia(ultima.resultado?.global, fisicas[1]?.resultado?.global) : null;

  const desde = sumarMeses(hoyLocal(), -MESES_DIGITAL);
  const porEquipo = new Map(); // la más reciente por equipo (vienen ordenadas de la más nueva)
  for (const ev of (await db.cerradasDeArea(area.id, 'digital')).filter((e) => e.fecha >= desde)) {
    const clave = normalizarNombre(ev.equipo_codigo || ev.usuario_nombre || ev.id);
    if (!porEquipo.has(clave)) porEquipo.set(clave, ev.resultado);
  }
  const digital = porEquipo.size ? promedioDigitalArea([...porEquipo.values()], interp) : null;
  return { ultima, flecha, digital, interp };
}

function htmlResultados({ ultima, flecha, digital, interp }) {
  if (!ultima && !digital) return '<small>Sin evaluaciones cerradas</small>';
  const fisico = ultima
    ? `<div>Físico: <strong>${formatoGlobal(ultima.resultado?.global, interp)}</strong> ${chipNivel(ultima.resultado?.nivel, interp)}
        ${flecha ? `<span class="tendencia" title="Tendencia frente a la evaluación anterior">${FLECHA[flecha]}</span>` : ''}
        <small>(${fechaCorta(ultima.fecha)})</small></div>`
    : '';
  const dig = digital
    ? `<div>Digital: <strong>${formatoGlobal(digital.promedio, interp)}</strong> ${chipNivel(digital.nivel, interp)}
        <small>(${digital.evaluados} usuario${digital.evaluados === 1 ? '' : 's'}${digital.excluidos ? `, ${digital.excluidos} no evaluable${digital.excluidos === 1 ? '' : 's'} excluido${digital.excluidos === 1 ? '' : 's'}` : ''})</small></div>`
    : '';
  return fisico + dig;
}

const camposSitio = (s = {}) => `
  <label class="campo"><span>Nombre del sitio</span><input type="text" name="nombre" value="${esc(s.nombre)}" placeholder="Ej.: Central Hidroeléctrica …"></label>
  <label class="campo"><span>Ubicación</span><input type="text" name="ubicacion" value="${esc(s.ubicacion)}" placeholder="Provincia, cantón o referencia"></label>`;

function camposArea(a = {}, tieneEvaluaciones = false) {
  const tipos = ctx.instrumento.tipos_area;
  return `
  <label class="campo"><span>Nombre del área</span><input type="text" name="nombre" value="${esc(a.nombre)}" placeholder="Ej.: Casa de máquinas"></label>
  <label class="campo"><span>Tipo de área</span>
    <select name="tipo">
      <option value="">Seleccione…</option>
      ${tipos.map((t) => `<option value="${esc(t.codigo)}" ${a.tipo === t.codigo ? 'selected' : ''}>${esc(t.nombre)} (${esc(t.codigo)})</option>`).join('')}
    </select>
    <small>${tipos.map((t) => `<strong>${esc(t.nombre)}:</strong> ${esc(t.ejemplos)}`).join('<br>')}</small>
    ${tieneEvaluaciones ? '<small>Puede cambiarlo. Las evaluaciones ya cerradas conservan el tipo con el que se hicieron.</small>' : ''}
  </label>
  <label class="campo"><span>Responsable del área</span><input type="text" name="responsable" value="${esc(a.responsable)}" placeholder="Nombre y cargo"></label>`;
}

export async function render(cont) {
  let mostrarInactivos = false;

  const dibujar = async () => {
    const [sitios, areas] = await Promise.all([db.todos('sitios'), db.todos('areas')]);
    const visibles = sitios.filter((s) => mostrarInactivos || s.activo).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));

    const bloques = await Promise.all(
      visibles.map(async (s) => {
        const deSitio = areas.filter((a) => a.sitio_id === s.id && (mostrarInactivos || a.activo)).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
        const filas = await Promise.all(
          deSitio.map(async (a) => {
            const tipo = ctx.instrumento.tipos_area.find((t) => t.codigo === a.tipo);
            const res = await resultadosDeArea(a);
            const puedeEvaluar = a.activo && s.activo;
            return `
            <li class="area ${a.activo ? '' : 'area--inactiva'}">
              <div class="fila fila--entre">
                <strong class="crece">${esc(a.nombre)}</strong>
                <span class="chip">${esc(tipo?.nombre ?? a.tipo)}</span>
                ${a.activo ? '' : '<span class="chip chip--aviso">Inactiva</span>'}
              </div>
              ${a.responsable ? `<small>Responsable: ${esc(a.responsable)}</small>` : ''}
              <div>${htmlResultados(res)}</div>
              <div class="acciones-fila">
                ${puedeEvaluar ? `<a class="btn btn--primario btn--chico" href="#/nueva?area=${esc(a.id)}">Evaluar</a>` : ''}
                <a class="btn btn--chico" href="#/area/${esc(a.id)}">Historial y acciones</a>
                <button class="btn btn--chico" data-editar-area="${esc(a.id)}">Editar</button>
                <button class="btn btn--chico" data-activo-area="${esc(a.id)}">${a.activo ? 'Desactivar' : 'Reactivar'}</button>
              </div>
            </li>`;
          }),
        );
        return `
        <section class="tarjeta">
          <div class="fila fila--entre">
            <div class="crece"><h2>${esc(s.nombre)}</h2>${s.ubicacion ? `<small>${esc(s.ubicacion)}</small>` : ''}</div>
            ${s.activo ? '' : '<span class="chip chip--aviso">Inactivo</span>'}
          </div>
          <ul class="lista" style="margin-top:.75rem">${filas.join('') || '<li><small>Este sitio aún no tiene áreas.</small></li>'}</ul>
          <div class="acciones-fila">
            <button class="btn btn--chico btn--primario" data-nueva-area="${esc(s.id)}">+ Área</button>
            <button class="btn btn--chico" data-areas-listado="${esc(s.id)}">Áreas del listado</button>
            <button class="btn btn--chico" data-editar-sitio="${esc(s.id)}">Editar sitio</button>
            <button class="btn btn--chico" data-activo-sitio="${esc(s.id)}">${s.activo ? 'Desactivar' : 'Reactivar'}</button>
          </div>
        </section>`;
      }),
    );

    cont.innerHTML = `
      ${barraSuperior('Sitios y áreas', '#/')}
      <div class="contenido pila">
        <button class="btn btn--primario btn--bloque" data-nuevo-sitio>+ Nuevo sitio</button>
        <button class="btn btn--bloque" data-sitios-listado>Agregar sitios del listado</button>
        <label class="casilla"><input type="checkbox" data-inactivos ${mostrarInactivos ? 'checked' : ''}> Mostrar inactivos</label>
        ${bloques.join('') || '<div class="tarjeta"><p>Aún no hay sitios. Cree el primero con “Nuevo sitio”.</p></div>'}
      </div>`;
  };

  // --- Altas y ediciones -------------------------------------------------

  async function formularioSitio(sitio = null) {
    const otros = (await db.todos('sitios')).filter((s) => s.id !== sitio?.id);
    const v = await dialogoFormulario({
      titulo: sitio ? 'Editar sitio' : 'Nuevo sitio',
      camposHTML: camposSitio(sitio ?? {}),
      validar: (x) => (!x.nombre ? 'Escriba el nombre del sitio.' : otros.some((o) => normalizarNombre(o.nombre) === normalizarNombre(x.nombre)) ? 'Ya existe un sitio con ese nombre.' : null),
    });
    if (!v) return;
    await db.guardar('sitios', sitio ? Object.assign(sitio, v) : db.crearEntidad({ ...v, activo: true }));
    toast('Sitio guardado');
  }

  async function formularioArea(sitioId, area = null) {
    const hermanas = (await db.porIndice('areas', 'sitio_id', sitioId)).filter((a) => a.id !== area?.id);
    const tieneEvaluaciones = area ? (await db.porIndice('evaluaciones', 'area_id', area.id)).length > 0 : false;
    const v = await dialogoFormulario({
      titulo: area ? 'Editar área' : 'Nueva área',
      camposHTML: camposArea(area ?? {}, tieneEvaluaciones),
      validar: (x) => {
        if (!x.nombre) return 'Escriba el nombre del área.';
        if (!x.tipo) return 'Seleccione el tipo de área.';
        if (hermanas.some((h) => normalizarNombre(h.nombre) === normalizarNombre(x.nombre))) return 'Ya existe un área con ese nombre en este sitio.';
        return null;
      },
    });
    if (!v) return;
    await db.guardar('areas', area ? Object.assign(area, v) : db.crearEntidad({ ...v, sitio_id: sitioId, activo: true }));
    toast('Área guardada');
  }

  /** Agrega sitios (localidades) del listado; los que ya existen se omiten. */
  async function agregarSitiosDelListado() {
    const catalogo = await cargarCatalogo();
    const disponibles = localidadesDisponibles(catalogo, await db.todos('sitios'));
    if (!disponibles.length) return toast('El listado de sitios no está disponible en este momento.');
    const elegidos = await dialogoElegirLocalidades(disponibles);
    if (!elegidos?.length) return;
    for (const nombre of elegidos) await asegurarSitio(nombre);
    toast(`${elegidos.length} sitio${elegidos.length === 1 ? '' : 's'} agregado${elegidos.length === 1 ? '' : 's'}`);
  }

  /** Agrega áreas del listado a un sitio (con el tipo sugerido, que se puede cambiar). */
  async function agregarAreasDelListado(sitioId) {
    const sitio = await db.obtener('sitios', sitioId);
    const catalogo = await cargarCatalogo();
    const areas = areasDeLocalidad(catalogo, sitio.nombre, await db.porIndice('areas', 'sitio_id', sitioId));
    if (!areas.length) return toast('Este sitio no tiene áreas en el listado. Use “+ Área” para crearlas.', 5000);
    const elegidas = await dialogoElegirAreas({ localidad: sitio.nombre, areas, tipos: ctx.instrumento.tipos_area });
    if (!elegidas?.length) return;
    for (const a of elegidas) await asegurarArea(sitioId, { nombre: a.nombre, tipo: a.tipo_sugerido });
    toast(`${elegidas.length} área${elegidas.length === 1 ? '' : 's'} agregada${elegidas.length === 1 ? '' : 's'}`);
  }

  async function alternarActivo(store, id, etiqueta) {
    const entidad = await db.obtener(store, id);
    if (entidad.activo) {
      const ok = await confirmar({
        titulo: `Desactivar ${etiqueta}`,
        mensaje: `“${entidad.nombre}” ya no aparecerá para nuevas evaluaciones. Sus evaluaciones anteriores se conservan y puede reactivarlo cuando quiera.`,
        aceptar: 'Desactivar',
      });
      if (!ok) return;
    }
    entidad.activo = !entidad.activo;
    await db.guardar(store, entidad);
  }

  cont.addEventListener('click', async (e) => {
    const t = (clave) => e.target.closest(`[data-${clave}]`)?.dataset[clave.replace(/-(\w)/g, (_, c) => c.toUpperCase())];
    if (e.target.closest('[data-nuevo-sitio]')) await formularioSitio();
    else if (e.target.closest('[data-sitios-listado]')) await agregarSitiosDelListado();
    else if (t('areas-listado')) await agregarAreasDelListado(t('areas-listado'));
    else if (t('nueva-area')) await formularioArea(t('nueva-area'));
    else if (t('editar-sitio')) await formularioSitio(await db.obtener('sitios', t('editar-sitio')));
    else if (t('editar-area')) {
      const a = await db.obtener('areas', t('editar-area'));
      await formularioArea(a.sitio_id, a);
    } else if (t('activo-sitio')) await alternarActivo('sitios', t('activo-sitio'), 'sitio');
    else if (t('activo-area')) await alternarActivo('areas', t('activo-area'), 'área');
    else return;
    dibujar();
  });
  cont.addEventListener('change', (e) => {
    if (e.target.matches('[data-inactivos]')) {
      mostrarInactivos = e.target.checked;
      dibujar();
    }
  });

  await dibujar();
}
