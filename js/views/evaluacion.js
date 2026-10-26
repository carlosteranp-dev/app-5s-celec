// Evaluación S por S: tarjetas por ítem con fotos y acciones, guardado automático y validaciones del instrumento.
import * as db from '../db.js';
import { instrumentoDe } from '../contexto.js';
import {
  accionVacia, accionesPorItem, avance, descriptorNivel, motivoNaAutomatico, obtenerModulo, problemasDeRespuesta,
  resumenAccionesPrevias, sincronizarRespuestas, validarEvaluacion,
} from '../calc.js';
import { agregarFoto, avisoAlmacenamiento } from '../photos.js';
import { MAX_FOTOS_POR_ITEM } from '../config.js';
import { diferido, esc, hoyLocal } from '../util.js';
import { confirmar, toast, visorFoto } from '../ui.js';

/** S "intentadas" por evaluación: se marcan en rojo los ítems con problemas de las S que el evaluador ya dejó atrás. */
const intentadas = new Map();
const marcadas = (evId) => intentadas.get(evId) ?? intentadas.set(evId, new Set()).get(evId);

const NIVELES = [0, 1, 2, 3, 4];
const ROTULO_PROBLEMA = { falta_foto: 'Requiere foto', falta_accion: 'Requiere acción' };

export async function render(cont, { id, s }, query) {
  const ev = await db.obtener('evaluaciones', id);
  if (!ev) {
    toast('No se encontró la evaluación');
    location.replace('#/');
    return;
  }
  if (ev.estado !== 'borrador') {
    location.replace(`#/eval/${id}/resumen`);
    return;
  }
  const inst = await instrumentoDe(ev);
  const modulo = obtenerModulo(inst, ev.modulo);
  const idx = Math.min(Math.max(Number(s) - 1, 0), modulo.eses.length - 1);
  const ese = modulo.eses[idx];

  await refrescarPrimeraEvaluacion(ev, inst, modulo);
  if (await db.reconciliarFotos(ev, MAX_FOTOS_POR_ITEM)) await db.guardar('evaluaciones', ev);

  const area = await db.obtener('areas', ev.area_id);
  const tipo = inst.tipos_area.find((t) => t.codigo === ev.area_tipo);
  const fotos = new Map((await db.fotosDeEvaluacion(ev.id)).map((f) => [f.id, f]));
  const acciones = await db.accionesDeEvaluacion(ev.id);
  const previas = !ev.es_primera_evaluacion && ese.items.some((i) => i.na_en_primera_evaluacion) ? resumenAccionesPrevias((await db.accionesDeArea(ev.area_id)).map((x) => x.accion), hoyLocal()) : null;

  const usaTipos = modulo.eses.some((e) => e.items.some((i) => i.aplica.some((c) => inst.tipos_area.some((t) => t.codigo === c))));
  const resp = (codigo) => ev.respuestas.find((r) => r.codigo === codigo);
  const itemDe = (codigo) => ese.items.find((i) => i.codigo === codigo);
  const resaltarEsta = () => marcadas(ev.id).has(ese.id);
  const nivelesAccion = inst.reglas.accion_obligatoria_en_niveles;
  const nivelesFoto = inst.reglas.foto_obligatoria_en_niveles;
  if (query.resaltar) marcadas(ev.id).add(ese.id);

  // --- Guardado automático ----------------------------------------------------
  const accionesSucias = new Set();
  const guardador = diferido(async () => {
    await db.guardar('evaluaciones', ev);
    for (const accionId of [...accionesSucias]) {
      accionesSucias.delete(accionId);
      const a = acciones.find((x) => x.id === accionId);
      if (a) await db.guardar('acciones', a);
    }
    const el = cont.querySelector('.guardado');
    if (el) el.textContent = 'Guardado ✓';
  });
  const cambio = () => {
    const el = cont.querySelector('.guardado');
    if (el) el.textContent = 'Guardando…';
    guardador.programar();
  };
  const alOcultar = () => document.visibilityState === 'hidden' && guardador.vaciar();
  document.addEventListener('visibilitychange', alOcultar);
  window.addEventListener('pagehide', alOcultar);

  // Las miniaturas se muestran con URLs de objeto que se liberan al salir.
  const urlsMiniatura = new Map();
  const urlMiniatura = (f) => urlsMiniatura.get(f.id) ?? urlsMiniatura.set(f.id, URL.createObjectURL(f.miniatura)).get(f.id);

  // --- Estado de cada ítem ----------------------------------------------------
  const cuentaAcciones = () => accionesPorItem(acciones, ev.fecha);
  const problemasItem = (r) => problemasDeRespuesta(inst, r, { accionesDelItem: cuentaAcciones()[r.codigo] || 0 });

  function claseEstado(r) {
    if (problemasItem(r).length === 0) return 'item--hecho';
    return resaltarEsta() ? 'item--incompleto' : '';
  }

  const requiereAccion = (r) => r.na !== 'manual' && nivelesAccion.includes(r.valor);

  // --- Dibujo ---------------------------------------------------------------

  function htmlFotos(item, r) {
    const lista = r.foto_ids.map((fid) => fotos.get(fid)).filter(Boolean);
    const lleno = lista.length >= MAX_FOTOS_POR_ITEM;
    const obligatoria = r.na !== 'manual' && nivelesFoto.includes(r.valor);
    return `
      <div class="fotos">
        <div class="fotos__lista">${lista
          .map((f, i) => `<button type="button" class="miniatura" data-ver-foto="${esc(f.id)}" aria-label="Ver foto ${i + 1} de ${esc(item.codigo)}"><img src="${urlMiniatura(f)}" alt=""></button>`)
          .join('')}</div>
        <div class="fotos__botones">
          <button type="button" class="btn btn--chico" data-foto="camara" ${lleno ? 'disabled' : ''}>Tomar foto</button>
          <button type="button" class="btn btn--chico" data-foto="galeria" ${lleno ? 'disabled' : ''}>Galería</button>
          ${obligatoria ? `<button type="button" class="btn btn--chico ${r.foto_na ? 'btn--activo' : ''}" data-foto-na aria-pressed="${Boolean(r.foto_na)}" title="Use esta opción cuando no hay nada que fotografiar o no se puede evidenciar">${r.foto_na ? '✓ ' : ''}N/A foto</button>` : ''}
          <small>${lista.length}/${MAX_FOTOS_POR_ITEM} fotos${obligatoria && !r.foto_na && !lista.length ? ' · obligatoria' : ''}${r.foto_na && !lista.length ? ' · sin foto: no se evidencia' : ''}</small>
        </div>
      </div>`;
  }

  function htmlAcciones(item, r) {
    const lista = acciones.filter((a) => a.codigo_item === item.codigo);
    const requerida = requiereAccion(r);
    if (!requerida && lista.length === 0) return '';
    return `
      <div class="acciones-item">
        <h3>Acción correctiva${requerida ? ' (obligatoria)' : ''}</h3>
        ${lista
          .map((a) => {
            const anterior = a.fecha_compromiso && a.fecha_compromiso < ev.fecha;
            return `
          <div class="accion" data-accion="${esc(a.id)}">
            <label class="campo"><span>Descripción</span><textarea data-af="descripcion" placeholder="Qué se hará para corregirlo">${esc(a.descripcion)}</textarea></label>
            <label class="campo"><span>Responsable</span><input type="text" data-af="responsable" value="${esc(a.responsable)}" placeholder="Nombre de quien la ejecuta"></label>
            <label class="campo ${anterior ? 'campo--invalido' : ''}"><span>Fecha de compromiso</span><input type="date" data-af="fecha_compromiso" min="${esc(ev.fecha)}" value="${esc(a.fecha_compromiso)}">
              ${anterior ? '<small class="mensaje-error">No puede ser anterior a la fecha de la evaluación.</small>' : ''}</label>
            ${lista.length > 1 || !accionVacia(a) ? '<button type="button" class="btn btn--chico btn--peligro" data-accion-quitar>Quitar acción</button>' : ''}
          </div>`;
          })
          .join('')}
        <button type="button" class="btn btn--chico" data-accion-nueva style="margin-top:.6rem">+ Otra acción</button>
      </div>`;
  }

  function htmlAvisos(r) {
    return problemasItem(r)
      .filter((p) => ROTULO_PROBLEMA[p])
      .map((p) => `<span class="chip chip--aviso">${ROTULO_PROBLEMA[p]}</span>`)
      .join('');
  }

  function htmlItem(item) {
    const motivo = motivoNaAutomatico(inst, item, ev.area_tipo, ev.es_primera_evaluacion);
    if (motivo) {
      const texto = motivo === 'tipo' ? `No aplica a áreas de tipo ${tipo?.nombre ?? ev.area_tipo}` : 'No se evalúa en la primera evaluación del área';
      return `<article class="item item--auto" data-codigo="${esc(item.codigo)}"><span class="item__cod">${esc(item.codigo)}</span> · N/A automático — ${esc(texto)}.<br><small>${esc(item.texto)}</small></article>`;
    }
    const r = resp(item.codigo);
    const manual = r.na === 'manual';
    const calificado = Number.isInteger(r.valor) && !manual;
    const respondido = calificado || manual;

    const botones = NIVELES.map((n) => {
      const d = descriptorNivel(inst, item, n);
      return `<button type="button" role="radio" data-nivel="${n}" aria-checked="${calificado && r.valor === n}" aria-label="Nivel ${n}: ${esc(d.nombre)}">${n}</button>`;
    }).join('');
    const desc = calificado ? descriptorNivel(inst, item, r.valor) : null;

    return `
    <article class="item ${claseEstado(r)}" data-codigo="${esc(item.codigo)}" id="item-${esc(item.codigo)}">
      <div class="item__cab"><span class="item__cod">${esc(item.codigo)}</span></div>
      <p class="item__texto">${esc(item.texto)}</p>
      <div class="niveles" role="radiogroup" aria-label="Calificación de ${esc(item.codigo)}">
        ${botones}<button type="button" role="radio" data-na aria-checked="${manual}" aria-label="No aplica">N/A</button>
      </div>
      ${desc ? `<p class="descriptor"><strong>${desc.nivel} · ${esc(desc.nombre)}:</strong> ${esc(desc.texto)}</p>` : ''}
      <details class="criterios"><summary>Ver criterios de 0 a 4</summary>
        <dl>${NIVELES.map((n) => {
          const d = descriptorNivel(inst, item, n);
          return `<dt>${n} · ${esc(d.nombre)}</dt><dd>${esc(d.texto)}</dd>`;
        }).join('')}</dl>
      </details>
      ${
        manual
          ? `<label class="campo"><span>Justificación del N/A (obligatoria)</span>
              <textarea data-campo="na_justificacion" placeholder="Explique por qué este elemento no existe en el área">${esc(r.na_justificacion)}</textarea>
              <small>Solo si el elemento no existe en el área. Cada S admite como máximo ${inst.reglas.max_na_por_s} N/A manuales.</small></label>`
          : ''
      }
      <label class="campo"><span>Observación</span><textarea data-campo="observacion" placeholder="Qué se observó (opcional)">${esc(r.observacion)}</textarea></label>
      ${manual ? '' : htmlFotos(item, r)}
      ${htmlAcciones(item, r)}
      ${respondido ? '<button type="button" class="btn btn--chico quitar" data-quitar>Quitar calificación</button>' : ''}
      <div class="avisos">${htmlAvisos(r)}</div>
    </article>`;
  }

  function htmlEncabezado() {
    const av = avance(inst, ev);
    const problemas = validarEvaluacion(inst, ev, { accionesPorItem: cuentaAcciones() }).porItem;
    const pasos = modulo.eses
      .map((e, i) => {
        const completa = av.porS[i].total > 0 && e.items.every((it) => !problemas[it.codigo]);
        return `<a href="#/eval/${esc(ev.id)}/s/${i + 1}" ${i === idx ? 'aria-current="step"' : ''} class="${completa ? 'completa' : ''}" aria-label="${esc(e.id)} ${esc(e.nombre)}">${esc(e.id)}</a>`;
      })
      .join('');
    return { av, pasos: `${pasos}<a href="#/eval/${esc(ev.id)}/resumen" aria-label="Resumen">Σ</a>` };
  }

  function pintarEncabezado() {
    const { av, pasos } = htmlEncabezado();
    cont.querySelector('.avance').textContent = `${ese.id} · ${idx + 1} de ${modulo.eses.length} · ${av.hechos}/${av.total} ítems`;
    const barra = cont.querySelector('progress');
    barra.value = av.hechos;
    barra.max = av.total || 1;
    cont.querySelector('.pasos').innerHTML = pasos;
  }

  const ultima = idx === modulo.eses.length - 1;
  const { av, pasos } = htmlEncabezado();
  cont.innerHTML = `
    <header class="eval-cab">
      <div class="eval-cab__fila">
        <a class="salir" href="#/" aria-label="Salir al inicio (se guarda automáticamente)">←</a>
        <h1>${esc(ese.nombre)} <small>${esc(ese.traduccion)}</small></h1>
        <span class="guardado" aria-live="polite">Guardado ✓</span>
      </div>
      ${ese.proposito ? `<p class="proposito">${esc(ese.proposito)}</p>` : ''}
      <p class="avance">${esc(ese.id)} · ${idx + 1} de ${modulo.eses.length} · ${av.hechos}/${av.total} ítems</p>
      <progress value="${av.hechos}" max="${av.total || 1}"></progress>
      <nav class="pasos" aria-label="Secciones">${pasos}</nav>
    </header>
    <div class="items">
      <div class="tarjeta">
        <small>${esc(area?.nombre ?? '')} · ${esc(modulo.nombre)}${ev.usuario_nombre ? ` · ${esc(ev.usuario_nombre)}` : ''}</small>
        ${usaTipos ? `<label class="campo"><span>Tipo de área de esta evaluación</span>
          <select data-tipo-area>${inst.tipos_area.map((t) => `<option value="${esc(t.codigo)}" ${t.codigo === ev.area_tipo ? 'selected' : ''}>${esc(t.nombre)} (${esc(t.codigo)})</option>`).join('')}</select>
          <small>Si no corresponde, cámbielo aquí: los ítems que no aplican pasan solos a N/A y también se actualiza el área.</small></label>` : ''}
        ${ese.proposito ? `<p>${esc(ese.proposito)}</p>` : ''}
        <p class="nota-duda"><strong>Si duda entre dos niveles:</strong> ${esc(inst.reglas.duda_entre_niveles)}</p>
        ${previas ? `<p class="nota-duda"><strong>Acciones previas del área:</strong> ${previas.total ? `${previas.a_tiempo} de ${previas.total} cerradas a tiempo (${Math.round(previas.porcentaje)} %)` : 'sin acciones con plazo vencido ni cerradas'}.</p>` : ''}
        ${modulo.reglas_confidencialidad ? `<details class="criterios"><summary>Reglas de confidencialidad (fotos y datos)</summary><ul>${modulo.reglas_confidencialidad.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></details>` : ''}
      </div>
      ${ese.items.map(htmlItem).join('')}
    </div>
    <input type="file" id="in-camara" accept="image/*" capture="environment" hidden>
    <input type="file" id="in-galeria" accept="image/*" multiple hidden>
    <nav class="navegacion" aria-label="Navegación entre S">
      ${idx > 0 ? `<a class="btn" href="#/eval/${esc(ev.id)}/s/${idx}">← Anterior</a>` : '<a class="btn" aria-disabled="true">← Anterior</a>'}
      <a class="btn btn--primario" href="${ultima ? `#/eval/${esc(ev.id)}/resumen` : `#/eval/${esc(ev.id)}/s/${idx + 2}`}">${ultima ? 'Ver resumen →' : 'Siguiente →'}</a>
    </nav>`;

  // --- Utilidades de redibujo -------------------------------------------------

  const tarjeta = (codigo) => cont.querySelector(`#item-${CSS.escape(codigo)}`);

  /** Redibuja una tarjeta completa y el encabezado; devuelve el elemento nuevo. */
  function redibujar(codigo) {
    const item = itemDe(codigo);
    tarjeta(codigo).outerHTML = htmlItem(item);
    pintarEncabezado();
    return tarjeta(codigo);
  }

  /** Cambia solo colores y avisos (no redibuja, para no perder el foco del teclado). */
  function refrescarEstado(codigo) {
    const card = tarjeta(codigo);
    const r = resp(codigo);
    card.classList.remove('item--hecho', 'item--incompleto');
    const clase = claseEstado(r);
    if (clase) card.classList.add(clase);
    card.querySelector('.avisos').innerHTML = htmlAvisos(r);
    pintarEncabezado();
  }

  // --- Acciones ---------------------------------------------------------------

  async function crearAccion(codigo) {
    const a = db.crearEntidad({
      evaluacion_id: ev.id, codigo_item: codigo, descripcion: '', responsable: area?.responsable ?? '',
      fecha_compromiso: '', estado: 'abierta', fecha_cierre: null,
    });
    acciones.push(a);
    await db.guardar('acciones', a);
    return a;
  }

  async function quitarAccion(accion) {
    acciones.splice(acciones.indexOf(accion), 1);
    accionesSucias.delete(accion.id);
    await db.eliminar('acciones', accion.id);
  }

  /** Con nivel 0 o 1 debe haber al menos un bloque de acción; si el nivel ya no la exige, se descartan los bloques vacíos. */
  async function ajustarAcciones(codigo) {
    const r = resp(codigo);
    const lista = acciones.filter((a) => a.codigo_item === codigo);
    if (requiereAccion(r)) {
      if (lista.length === 0) await crearAccion(codigo);
    } else {
      for (const a of lista.filter(accionVacia)) await quitarAccion(a);
    }
  }

  // Los ítems ya calificados 0/1 sin bloque de acción (p. ej., borradores de la Fase 1) lo reciben al abrir la S.
  for (const item of ese.items) if (!motivoNaAutomatico(inst, item, ev.area_tipo, ev.es_primera_evaluacion)) await ajustarAcciones(item.codigo);
  ese.items.forEach((item) => tarjeta(item.codigo) && redibujar(item.codigo));

  // --- Fotos ------------------------------------------------------------------

  const entradas = { camara: cont.querySelector('#in-camara'), galeria: cont.querySelector('#in-galeria') };
  let codigoFoto = null;

  async function procesarArchivos(codigo, archivos) {
    const card = tarjeta(codigo);
    card.classList.add('item--ocupado');
    try {
      for (const archivo of archivos) {
        if (resp(codigo).foto_ids.length >= MAX_FOTOS_POR_ITEM) {
          toast(`Cada ítem admite como máximo ${MAX_FOTOS_POR_ITEM} fotos.`);
          break;
        }
        try {
          const f = await agregarFoto(ev, codigo, archivo);
          resp(codigo).foto_na = false; // ya hay evidencia
          fotos.set(f.id, f);
          await db.guardar('evaluaciones', ev); // se guarda enseguida: la foto ya está en disco
        } catch (e) {
          toast(e.message, 5000);
        }
      }
    } finally {
      redibujar(codigo);
      const aviso = await avisoAlmacenamiento();
      if (aviso) toast(aviso, 6000);
    }
  }

  for (const modo of ['camara', 'galeria']) {
    entradas[modo].addEventListener('change', () => {
      const archivos = [...entradas[modo].files];
      entradas[modo].value = ''; // permite elegir de nuevo el mismo archivo
      if (codigoFoto && archivos.length) procesarArchivos(codigoFoto, archivos);
    });
  }

  // --- Eventos ----------------------------------------------------------------

  cont.addEventListener('click', async (e) => {
    const card = e.target.closest('.item[data-codigo]');
    if (!card || card.classList.contains('item--auto')) return;
    const codigo = card.dataset.codigo;
    const r = resp(codigo);

    const nivel = e.target.closest('[data-nivel]');
    const foto = e.target.closest('[data-foto]');
    const ver = e.target.closest('[data-ver-foto]');
    const quitarAcc = e.target.closest('[data-accion-quitar]');

    if (nivel) {
      const nuevoValor = Number(nivel.dataset.nivel);
      Object.assign(r, { valor: nuevoValor, na: null, na_justificacion: '', foto_na: r.valor === nuevoValor ? r.foto_na : false });
      cambio();
      await ajustarAcciones(codigo);
      redibujar(codigo).querySelector(`[data-nivel="${nivel.dataset.nivel}"]`).focus();
    } else if (e.target.closest('[data-na]')) {
      Object.assign(r, { valor: null, na: 'manual', foto_na: false });
      cambio();
      await ajustarAcciones(codigo);
      redibujar(codigo).querySelector('[data-campo="na_justificacion"]')?.focus();
    } else if (e.target.closest('[data-quitar]')) {
      Object.assign(r, { valor: null, na: null, na_justificacion: '', foto_na: false });
      cambio();
      await ajustarAcciones(codigo);
      redibujar(codigo);
    } else if (e.target.closest('[data-foto-na]')) {
      r.foto_na = !r.foto_na;
      cambio();
      redibujar(codigo);
    } else if (foto) {
      codigoFoto = codigo;
      entradas[foto.dataset.foto].click();
    } else if (ver) {
      const f = fotos.get(ver.dataset.verFoto);
      if (!f) return;
      const n = r.foto_ids.indexOf(f.id) + 1;
      const resultado = await visorFoto({ blob: f.blob, titulo: `${codigo} · foto ${n}`, puedeEliminar: true });
      if (resultado === 'eliminar') {
        await db.eliminarFoto(f, ev);
        fotos.delete(f.id);
        URL.revokeObjectURL(urlsMiniatura.get(f.id));
        urlsMiniatura.delete(f.id);
        await db.guardar('evaluaciones', ev);
        redibujar(codigo);
      }
    } else if (e.target.closest('[data-accion-nueva]')) {
      await crearAccion(codigo);
      cambio();
      redibujar(codigo);
    } else if (quitarAcc) {
      const accion = acciones.find((a) => a.id === quitarAcc.closest('.accion').dataset.accion);
      const ok = accion && (accionVacia(accion) || (await confirmar({ titulo: 'Quitar acción', mensaje: 'Se eliminará esta acción correctiva.', aceptar: 'Quitar', peligro: true })));
      if (ok) {
        await quitarAccion(accion);
        await ajustarAcciones(codigo);
        cambio();
        redibujar(codigo);
      }
    }
  });

  // Corregir el tipo de área: los ítems que no aplican pasan a N/A automático (sin perder lo ya calificado) y se actualiza el área.
  cont.addEventListener('change', async (e) => {
    if (!e.target.matches('[data-tipo-area]')) return;
    const nuevo = e.target.value;
    if (nuevo === ev.area_tipo) return;
    ev.area_tipo = nuevo;
    ev.respuestas = sincronizarRespuestas(inst, ev.modulo, ev.respuestas, { tipoArea: nuevo, esPrimera: ev.es_primera_evaluacion });
    if (area && area.tipo !== nuevo) {
      area.tipo = nuevo;
      await db.guardar('areas', area);
    }
    await guardador.vaciar();
    await db.guardar('evaluaciones', ev);
    toast('Tipo de área actualizado: los ítems que no aplican pasan a N/A automático.', 5000);
    window.dispatchEvent(new HashChangeEvent('hashchange')); // vuelve a dibujar esta pantalla con los ítems del nuevo tipo
  });

  cont.addEventListener('input', (e) => {
    const card = e.target.closest('.item[data-codigo]');
    if (!card) return;
    const codigo = card.dataset.codigo;
    const campo = e.target.dataset?.campo;
    const campoAccion = e.target.dataset?.af;
    if (campo) {
      resp(codigo)[campo] = e.target.value;
    } else if (campoAccion) {
      const accion = acciones.find((a) => a.id === e.target.closest('.accion').dataset.accion);
      if (!accion) return;
      accion[campoAccion] = e.target.value;
      accionesSucias.add(accion.id);
      if (campoAccion === 'fecha_compromiso') {
        const invalida = e.target.value && e.target.value < ev.fecha;
        e.target.closest('.campo').classList.toggle('campo--invalido', Boolean(invalida));
      }
    } else return;
    cambio();
    refrescarEstado(codigo);
  });

  // Al venir del resumen con "ir", se lleva al ítem pendiente.
  if (query.ir) tarjeta(query.ir)?.scrollIntoView({ block: 'center' });

  // --- Salida: guarda lo pendiente y marca los ítems con problemas de esta S ---
  return async () => {
    document.removeEventListener('visibilitychange', alOcultar);
    window.removeEventListener('pagehide', alOcultar);
    const problemas = validarEvaluacion(inst, ev, { accionesPorItem: cuentaAcciones() }).porItem;
    if (ese.items.some((i) => problemas[i.codigo])) marcadas(ev.id).add(ese.id);
    await guardador.vaciar();
    urlsMiniatura.forEach((url) => URL.revokeObjectURL(url));
  };
}

/**
 * Si desde que se creó el borrador cambió si el área tiene evaluaciones cerradas (p. ej., por una importación),
 * se actualizan los N/A automáticos conservando todo lo que el evaluador ya escribió.
 */
async function refrescarPrimeraEvaluacion(ev, inst, modulo) {
  const primera = await db.esPrimeraEvaluacion(ev.area_id, ev.modulo);
  const respuestas = sincronizarRespuestas(inst, modulo.id, ev.respuestas, { tipoArea: ev.area_tipo, esPrimera: primera });
  const cambioPrimera = primera !== ev.es_primera_evaluacion;
  if (cambioPrimera || JSON.stringify(respuestas) !== JSON.stringify(ev.respuestas)) {
    ev.es_primera_evaluacion = primera;
    ev.respuestas = respuestas;
    await db.guardar('evaluaciones', ev);
    if (cambioPrimera) toast(primera ? 'Esta es la primera evaluación del área.' : 'El área ya tiene evaluaciones previas: se actualizaron los N/A automáticos.', 5000);
  }
}
