// Nueva evaluación: sitio → área → módulo (en digital, datos del usuario y confidencialidad).
import * as db from '../db.js';
import { ctx } from '../contexto.js';
import { obtenerModulo, sincronizarRespuestas } from '../calc.js';
import { esc, hoyLocal } from '../util.js';
import { barraSuperior } from '../ui.js';

export async function render(cont, _params, query) {
  const perfil = await db.obtenerConfig('perfil');
  if (!perfil) {
    location.replace('#/perfil');
    return;
  }
  const inst = ctx.instrumento;
  const [sitiosTodos, areasTodas] = await Promise.all([db.todos('sitios'), db.todos('areas')]);
  const areasActivas = areasTodas.filter((a) => a.activo);
  const sitios = sitiosTodos
    .filter((s) => s.activo && areasActivas.some((a) => a.sitio_id === s.id))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));

  if (sitios.length === 0) {
    cont.innerHTML = `
      ${barraSuperior('Nueva evaluación', '#/')}
      <div class="contenido pila"><div class="tarjeta">
        <h2>Primero cree un sitio y un área</h2>
        <p>Para evaluar se necesita al menos un sitio con un área activa.</p>
        <a class="btn btn--primario btn--bloque" href="#/sitios">Ir a Sitios y áreas</a>
      </div></div>`;
    return;
  }

  const areaInicial = areasActivas.find((a) => a.id === query.area);
  const sitioInicial = areaInicial?.sitio_id ?? sitios[0].id;
  const digital = obtenerModulo(inst, 'digital');
  const modulos = inst.modulos;

  cont.innerHTML = `
    ${barraSuperior('Nueva evaluación', '#/')}
    <form class="contenido pila" novalidate>
      <div class="tarjeta">
        <label class="campo"><span>Sitio</span>
          <select name="sitio">${sitios.map((s) => `<option value="${esc(s.id)}" ${s.id === sitioInicial ? 'selected' : ''}>${esc(s.nombre)}</option>`).join('')}</select>
        </label>
        <label class="campo"><span>Área</span><select name="area"></select></label>
        <div class="campo"><span>Módulo</span>
          <div class="opciones">
            ${modulos.map((m, i) => `<label class="opcion"><input type="radio" name="modulo" value="${esc(m.id)}" ${i === 0 ? 'checked' : ''}><span>${esc(m.nombre)}</span></label>`).join('')}
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
  const bloqueDigital = cont.querySelector('[data-digital]');
  const error = cont.querySelector('.mensaje-error');

  function cargarAreas() {
    const deSitio = areasActivas.filter((a) => a.sitio_id === form.sitio.value).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    form.area.innerHTML = deSitio
      .map((a) => `<option value="${esc(a.id)}" ${a.id === areaInicial?.id ? 'selected' : ''}>${esc(a.nombre)} (${esc(inst.tipos_area.find((t) => t.codigo === a.tipo)?.nombre ?? a.tipo)})</option>`)
      .join('');
  }
  const alternarDigital = () => bloqueDigital.classList.toggle('oculto', form.modulo.value !== 'digital');

  form.sitio.addEventListener('change', cargarAreas);
  form.addEventListener('change', (e) => e.target.name === 'modulo' && alternarDigital());
  cargarAreas();
  alternarDigital();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const moduloId = form.modulo.value;
    const problemas = [];
    if (!form.area.value) problemas.push('Seleccione el área.');
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

    const area = areasActivas.find((a) => a.id === form.area.value);
    const esPrimera = await db.esPrimeraEvaluacion(area.id, moduloId);
    const ev = db.crearEntidad({
      area_id: area.id,
      area_tipo: area.tipo, // se congela: define qué ítems aplican
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
