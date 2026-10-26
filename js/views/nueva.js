// Nueva evaluación: sitio → área → tipo → módulo (en digital, datos del usuario y confidencialidad).
// Sitios y áreas salen de los que ya existen, del listado (catalogo_sitios.json) o se escriben ("otro").
import * as db from '../db.js';
import { ctx } from '../contexto.js';
import { obtenerModulo, sincronizarRespuestas } from '../calc.js';
import { areasDeLocalidad, asegurarArea, asegurarSitio, cargarCatalogo, localidadesDisponibles } from '../catalogo.js';
import { esc, hoyLocal } from '../util.js';
import { barraSuperior } from '../ui.js';

const NUEVO_SITIO = '__nuevo__';
const NUEVA_AREA = '__nueva__';

/** ¿Los ítems del módulo dependen del tipo de área? (el módulo digital no) */
function moduloUsaTipos(inst, moduloId) {
  const codigos = inst.tipos_area.map((t) => t.codigo);
  return obtenerModulo(inst, moduloId).eses.some((s) => s.items.some((i) => i.aplica.some((c) => codigos.includes(c))));
}

export async function render(cont, _params, query) {
  const perfil = await db.obtenerConfig('perfil');
  if (!perfil) {
    location.replace('#/perfil');
    return;
  }
  const inst = ctx.instrumento;
  const [catalogo, sitiosTodos, areasTodas] = await Promise.all([cargarCatalogo(), db.todos('sitios'), db.todos('areas')]);
  const sitiosDB = sitiosTodos.filter((s) => s.activo).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  const areasActivas = areasTodas.filter((a) => a.activo);
  const delListado = localidadesDisponibles(catalogo, sitiosTodos).filter((l) => !l.existente);
  const digital = obtenerModulo(inst, 'digital');
  const areaInicial = areasActivas.find((a) => a.id === query.area);

  cont.innerHTML = `
    ${barraSuperior('Nueva evaluación', '#/')}
    <form class="contenido pila" novalidate>
      <div class="tarjeta">
        <label class="campo"><span>Sitio</span><select name="sitio"></select></label>
        <label class="campo oculto" data-sitio-nuevo><span>Nombre del sitio</span><input type="text" name="sitio_nuevo" autocomplete="off" placeholder="Escriba el nombre del sitio"></label>
        <label class="campo"><span>Área</span><select name="area"></select></label>
        <label class="campo oculto" data-area-nueva><span>Nombre del área</span><input type="text" name="area_nueva" autocomplete="off" placeholder="Escriba el nombre del área"></label>
        <label class="campo" data-tipo><span>Tipo de área</span>
          <select name="tipo">${inst.tipos_area.map((t) => `<option value="${esc(t.codigo)}">${esc(t.nombre)} (${esc(t.codigo)})</option>`).join('')}</select>
          <small data-tipo-nota></small>
        </label>
        <div class="campo"><span>Módulo</span>
          <div class="opciones">
            ${inst.modulos.map((m, i) => `<label class="opcion"><input type="radio" name="modulo" value="${esc(m.id)}" ${i === 0 ? 'checked' : ''}><span>${esc(m.nombre)}</span></label>`).join('')}
          </div>
        </div>
        <label class="campo"><span>Fecha de la evaluación</span><input type="date" name="fecha" value="${hoyLocal()}"></label>
        <label class="campo"><span>Personas presentes (opcional)</span><input type="text" name="personas" placeholder="Nombres de quienes acompañan la evaluación"></label>
      </div>

      <div class="tarjeta oculto" data-digital>
        <h2>Usuario del equipo</h2>
        <label class="campo"><span>Nombre del usuario</span><input type="text" name="usuario_nombre" autocomplete="off"></label>
        <label class="campo"><span>Cargo del usuario</span><input type="text" name="usuario_cargo" autocomplete="off"></label>
        <label class="campo"><span>Código del equipo</span><input type="text" name="equipo_codigo" autocomplete="off" placeholder="Código de inventario o nombre del equipo"></label>
        <div class="aviso" style="margin-top:.85rem">
          <h3>Reglas de confidencialidad</h3>
          <ul>${digital.reglas_confidencialidad.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
        </div>
        <label class="casilla"><input type="checkbox" name="confidencialidad"> El usuario y yo hemos leído y aceptamos estas reglas</label>
      </div>

      <p class="mensaje-error oculto" role="alert"></p>
      <button class="btn btn--primario btn--bloque" type="submit">Comenzar evaluación</button>
    </form>`;

  const form = cont.querySelector('form');
  const q = (s) => cont.querySelector(s);
  const error = q('.mensaje-error');

  // --- Sitio -----------------------------------------------------------------------
  const opcionesSitio = [
    sitiosDB.length ? `<optgroup label="Mis sitios">${sitiosDB.map((s) => `<option value="db:${esc(s.id)}">${esc(s.nombre)}</option>`).join('')}</optgroup>` : '',
    delListado.length ? `<optgroup label="Del listado">${delListado.map((l) => `<option value="cat:${esc(l.nombre)}">${esc(l.nombre)}</option>`).join('')}</optgroup>` : '',
    `<option value="${NUEVO_SITIO}">+ Otro sitio (escribir)…</option>`,
  ];
  form.sitio.innerHTML = opcionesSitio.join('');
  form.sitio.value = areaInicial ? `db:${areaInicial.sitio_id}` : form.sitio.options[0].value;

  /** Datos del sitio elegido: nombre y áreas ya creadas. */
  function sitioElegido() {
    const v = form.sitio.value;
    if (v === NUEVO_SITIO) return { nuevo: true, nombre: form.sitio_nuevo.value.trim(), areasDB: [] };
    if (v.startsWith('cat:')) return { nombre: v.slice(4), areasDB: [] };
    const s = sitiosDB.find((x) => x.id === v.slice(3));
    return { sitio: s, nombre: s?.nombre ?? '', areasDB: areasActivas.filter((a) => a.sitio_id === s?.id).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')) };
  }

  // --- Área ------------------------------------------------------------------------
  let areasCatalogo = []; // áreas del listado que se ofrecen para el sitio elegido

  function cargarAreas(seleccion = null) {
    const { areasDB, nombre, nuevo } = sitioElegido();
    areasCatalogo = nuevo ? [] : areasDeLocalidad(catalogo, nombre, areasDB).filter((a) => !a.existente);
    const tipoNombre = (c) => inst.tipos_area.find((t) => t.codigo === c)?.nombre ?? c;
    form.area.innerHTML = [
      areasDB.length ? `<optgroup label="Mis áreas">${areasDB.map((a) => `<option value="db:${esc(a.id)}">${esc(a.nombre)} (${esc(tipoNombre(a.tipo))})</option>`).join('')}</optgroup>` : '',
      areasCatalogo.length ? `<optgroup label="Del listado">${areasCatalogo.map((a, i) => `<option value="cat:${i}">${esc(a.nombre)}</option>`).join('')}</optgroup>` : '',
      `<option value="${NUEVA_AREA}">+ Otra área (escribir)…</option>`,
    ].join('');
    form.area.value = seleccion && [...form.area.options].some((o) => o.value === seleccion) ? seleccion : form.area.options[0].value;
    actualizarCampos();
  }

  /** Muestra u oculta los campos "otro" y ajusta el tipo de área al del área elegida. */
  function actualizarCampos(cambiaArea = true) {
    q('[data-sitio-nuevo]').classList.toggle('oculto', form.sitio.value !== NUEVO_SITIO);
    q('[data-area-nueva]').classList.toggle('oculto', form.area.value !== NUEVA_AREA);
    const usaTipos = moduloUsaTipos(inst, form.modulo.value);
    q('[data-tipo]').classList.toggle('oculto', !usaTipos);
    const v = form.area.value;
    let nota = 'Elija el tipo que corresponde: define qué ítems le aplican.';
    if (cambiaArea) {
      if (v.startsWith('db:')) form.tipo.value = areasActivas.find((a) => a.id === v.slice(3))?.tipo ?? form.tipo.value;
      else if (v.startsWith('cat:')) form.tipo.value = areasCatalogo[Number(v.slice(4))]?.tipo_sugerido ?? form.tipo.value;
    }
    if (v.startsWith('db:')) nota = 'Si lo cambia, se actualiza también el tipo del área.';
    else if (v.startsWith('cat:')) nota = 'El tipo es una sugerencia del listado: cámbielo si no corresponde.';
    q('[data-tipo-nota]').textContent = nota;
  }

  const alternarDigital = () => q('[data-digital]').classList.toggle('oculto', form.modulo.value !== 'digital');

  form.sitio.addEventListener('change', () => cargarAreas());
  form.area.addEventListener('change', () => actualizarCampos());
  form.addEventListener('change', (e) => {
    if (e.target.name === 'modulo') {
      alternarDigital();
      actualizarCampos(false);
    }
  });
  cargarAreas(areaInicial ? `db:${areaInicial.id}` : null);
  alternarDigital();

  // --- Crear la evaluación -----------------------------------------------------------
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const moduloId = form.modulo.value;
    const problemas = [];
    if (form.sitio.value === NUEVO_SITIO && !form.sitio_nuevo.value.trim()) problemas.push('Escriba el nombre del sitio.');
    if (form.area.value === NUEVA_AREA && !form.area_nueva.value.trim()) problemas.push('Escriba el nombre del área.');
    if (!form.fecha.value) problemas.push('Indique la fecha de la evaluación.');
    if (moduloId === 'digital') {
      for (const [campo, texto] of [['usuario_nombre', 'el nombre del usuario'], ['usuario_cargo', 'el cargo del usuario'], ['equipo_codigo', 'el código del equipo']]) {
        if (!form[campo].value.trim()) problemas.push(`Escriba ${texto}.`);
      }
      if (!form.confidencialidad.checked) problemas.push('Debe aceptarse las reglas de confidencialidad para comenzar.');
    }
    if (problemas.length) {
      error.innerHTML = problemas.map(esc).join('<br>');
      error.classList.remove('oculto');
      return;
    }

    // Se crea lo que falte (sitio y área del listado o escritos) y se actualiza el tipo del área si cambió.
    const elegido = sitioElegido();
    const sitio = elegido.sitio ?? (await asegurarSitio(form.sitio.value === NUEVO_SITIO ? form.sitio_nuevo.value : elegido.nombre));
    const tipo = form.tipo.value;
    const v = form.area.value;
    let area;
    if (v.startsWith('db:')) area = areasActivas.find((a) => a.id === v.slice(3));
    else if (v.startsWith('cat:')) area = await asegurarArea(sitio.id, { nombre: areasCatalogo[Number(v.slice(4))].nombre, tipo });
    else area = await asegurarArea(sitio.id, { nombre: form.area_nueva.value, tipo });
    if (area.tipo !== tipo) await db.guardar('areas', Object.assign(area, { tipo }));

    const esPrimera = await db.esPrimeraEvaluacion(area.id, moduloId);
    const ev = db.crearEntidad({
      area_id: area.id,
      area_tipo: area.tipo, // se congela en la evaluación: define qué ítems aplican (se puede corregir mientras es borrador)
      modulo: moduloId,
      fecha: form.fecha.value,
      evaluador: { nombre: perfil.nombre, cargo: perfil.cargo },
      instrumento_version: inst.meta.version,
      instrumento_hash: ctx.hash,
      estado: 'borrador',
      es_primera_evaluacion: esPrimera,
      personas_presentes: form.personas.value.trim(),
      observacion_general: '',
      respuestas: sincronizarRespuestas(inst, moduloId, [], { tipoArea: area.tipo, esPrimera }),
      resultado: null,
      firmas: { evaluador: null, responsable: null },
      exportado_en: null,
      anulada: false,
      ...(moduloId === 'digital'
        ? {
            usuario_nombre: form.usuario_nombre.value.trim(),
            usuario_cargo: form.usuario_cargo.value.trim(),
            equipo_codigo: form.equipo_codigo.value.trim(),
            confidencialidad_aceptada: true,
          }
        : {}),
    });
    await db.guardar('evaluaciones', ev);
    location.hash = `#/eval/${ev.id}/s/1`;
  });
}
