// Resumen de la evaluación: resultado, radar, pendientes, firmas, cierre, acta PDF y anulación.
import * as db from '../db.js';
import { instrumentoDe } from '../contexto.js';
import {
  accionVacia, accionesPorItem, esNaAutomatico, formatoGlobal, formatoPuntaje, itemsDelModulo, obtenerModulo,
  problemasDeRespuesta, resultadoDeEvaluacion, sincronizarRespuestas, validarCierre,
} from '../calc.js';
import { diferido, esc, fechaCorta, ahoraISO } from '../util.js';
import { barraSuperior, chipNivel, confirmar, dialogoFormulario, toast } from '../ui.js';
import { dialogoFirma } from '../firmas.js';
import { dialogoEntrega, dialogoProgreso } from '../entrega.js';

const MOTIVOS = {
  pendiente: 'sin calificar',
  na_sin_justificacion: 'N/A sin justificación',
  falta_foto: 'falta foto',
  falta_accion: 'falta acción',
};

export async function render(cont, { id }) {
  let ev = await db.obtener('evaluaciones', id);
  if (!ev) {
    toast('No se encontró la evaluación');
    location.replace('#/');
    return;
  }
  const inst = await instrumentoDe(ev);
  const modulo = obtenerModulo(inst, ev.modulo);
  const interp = inst.interpretacion;
  const area = await db.obtener('areas', ev.area_id);
  const sitio = area ? await db.obtener('sitios', area.sitio_id) : null;
  const tipo = inst.tipos_area.find((t) => t.codigo === ev.area_tipo);
  const esDigital = ev.modulo === 'digital';
  const rolResponsable = esDigital ? 'Usuario del equipo' : 'Responsable del área';
  let grafico = null;

  const guardador = diferido(() => db.guardar('evaluaciones', ev));

  async function pintar() {
    grafico?.destroy();
    grafico = null;
    ev = (await db.obtener('evaluaciones', id)) ?? ev;
    const borrador = ev.estado === 'borrador';
    const acciones = await db.accionesDeEvaluacion(ev.id);
    const fotos = await db.fotosDeEvaluacion(ev.id);
    const res = ev.resultado ?? resultadoDeEvaluacion(inst, ev);
    const noEvaluables = res.por_s.filter((s) => !s.evaluable);
    const cierre = borrador ? validarCierre(inst, ev, { acciones }) : null;
    const provisional = borrador || res.parcial;

    // Ítems con problemas, en el orden del instrumento.
    const indiceS = new Map(modulo.eses.map((s, i) => [s.id, i + 1]));
    const cuenta = accionesPorItem(acciones, ev.fecha);
    const porCodigo = new Map(ev.respuestas.map((r) => [r.codigo, r]));
    const pendientes = [];
    if (borrador) {
      for (const { item, ese } of itemsDelModulo(inst, ev.modulo)) {
        if (esNaAutomatico(inst, item, ev.area_tipo, ev.es_primera_evaluacion)) continue;
        const p = problemasDeRespuesta(inst, porCodigo.get(item.codigo), { accionesDelItem: cuenta[item.codigo] || 0 });
        if (p.length) pendientes.push({ item, ese, motivos: p.map((x) => MOTIVOS[x]).join(', ') });
      }
    }
    const accionesConTexto = acciones.filter((a) => !accionVacia(a));
    const almacen = await db.infoAlmacenamiento();

    const firmaEvaluador = ev.firmas?.evaluador;
    const firmaResponsable = ev.firmas?.responsable;
    const bloqueFirma = (rol, nombre, imagen, accion, extra = '') => `
      <div class="campo">
        <span>${esc(rol)}${nombre ? ` — ${esc(nombre)}` : ''}</span>
        ${imagen ? `<img class="firma-imagen" src="${imagen}" alt="Firma de ${esc(rol)}">` : extra}
        ${borrador ? `<button type="button" class="btn btn--chico" data-firmar="${accion}" style="margin-top:.4rem">${imagen ? 'Firmar de nuevo' : 'Firmar'}</button>` : ''}
      </div>`;
    const ausenteHTML = ev.firma_responsable_ausente
      ? `<p class="aviso">No estuvo presente. Motivo: ${esc(ev.firma_responsable_ausente)}${borrador ? ' <button type="button" class="btn btn--chico" data-quitar-ausente>Quitar</button>' : ''}</p>`
      : '';

    cont.innerHTML = `
    ${barraSuperior('Resumen', borrador ? `#/eval/${esc(ev.id)}/s/1` : `#/area/${esc(ev.area_id)}`)}
    <div class="contenido pila">
      ${ev.anulada ? `<div class="marca-anulada" role="status">EVALUACIÓN ANULADA<br><small>${fechaCorta(ev.anulada_fecha)} · ${esc(ev.anulada_motivo)}</small></div>` : ''}
      <section class="tarjeta">
        <h2>${esc(sitio?.nombre ?? '—')} · ${esc(area?.nombre ?? '—')}</h2>
        <p class="suave">
          ${esc(modulo.nombre)} · Área ${esc(tipo?.nombre ?? ev.area_tipo)} · ${fechaCorta(ev.fecha)}<br>
          Evaluador: ${esc(ev.evaluador?.nombre)} (${esc(ev.evaluador?.cargo)})
          ${esDigital ? `<br>Usuario: ${esc(ev.usuario_nombre)} · ${esc(ev.usuario_cargo)} · Equipo ${esc(ev.equipo_codigo)}` : ''}
          ${ev.es_primera_evaluacion ? '<br><span class="chip chip--aviso">Primera evaluación del área</span>' : ''}
          ${!borrador ? `<br><span class="chip">Cerrada el ${fechaCorta(ev.fecha_cierre)}</span>` : ''}
        </p>
      </section>

      <section class="global" aria-live="polite">
        ${provisional ? '<div class="chip chip--aviso">Resultado provisional</div>' : ''}
        ${
          noEvaluables.length
            ? `<div class="valor">—</div>${chipNivel(res.nivel, interp)}`
            : res.global === null
              ? '<p class="suave">Califique ítems para ver el resultado.</p>'
              : `<div class="valor">${formatoGlobal(res.global, interp)}</div>${chipNivel(res.nivel, interp)}`
        }
      </section>

      ${
        noEvaluables.length
          ? `<div class="aviso aviso--error"><strong>No se emite resultado global.</strong>
              ${noEvaluables.map((s) => `<br>${esc(s.id)} ${esc(s.nombre)}: ${esc(s.motivo_no_evaluable)}.`).join('')}
              <br>Solo se reportan las S evaluadas.</div>`
          : ''
      }
      ${
        res.regla_s_debil_aplicada
          ? `<div class="aviso"><strong>Se aplicó la regla de la S más débil.</strong>
              Por su porcentaje (${formatoGlobal(res.global, interp)}) el nivel sería “${esc(res.nivel_por_rango)}”, pero ${res.s_debiles.length === 1 ? 'la S' : 'las S'} ${esc(res.s_debiles.join(', '))}
              ${res.s_debiles.length === 1 ? 'está' : 'están'} por debajo de ${inst.reglas.regla_s_mas_debil.umbral_porcentaje} %, por lo que el nivel pasa a “${esc(res.nivel)}”.</div>`
          : ''
      }

      <section class="tarjeta">
        <h2>Gráfico por S</h2>
        <div class="grafico-radar"><canvas data-radar aria-label="Gráfico radar del puntaje de cada S" role="img"></canvas></div>
      </section>

      <section class="tarjeta">
        <h2>Puntaje por S</h2>
        <table class="tabla">
          <thead><tr><th>S</th><th>Puntaje</th><th class="num">Ítems</th><th class="num">N/A</th></tr></thead>
          <tbody>
            ${res.por_s
              .map((s) => {
                const debil = s.evaluable && s.porcentaje !== null && s.porcentaje < inst.reglas.regla_s_mas_debil.umbral_porcentaje;
                return `<tr>
                  <td><strong>${esc(s.id)}</strong> ${esc(s.nombre)}<br><small>${esc(s.traduccion)}</small></td>
                  <td>${
                    s.evaluable
                      ? `${s.porcentaje === null ? '—' : `<strong>${formatoPuntaje(s.porcentaje)}</strong>`}<div class="barra-s" role="img" aria-label="${formatoPuntaje(s.porcentaje)}"><i class="${debil ? 'debil' : ''}" style="width:${s.porcentaje ?? 0}%"></i></div>`
                      : '<span class="chip chip--no-evaluable">No evaluable</span>'
                  }</td>
                  <td class="num">${s.calificados}/${s.n}</td>
                  <td class="num" title="Manuales / automáticos">${s.na_manuales} / ${s.na_automaticos}</td>
                </tr>`;
              })
              .join('')}
          </tbody>
        </table>
        <p><small>Ítems: calificados / aplicables. N/A: manuales / automáticos.</small></p>
        ${esDigital ? `<p><small>${esc(modulo.agregacion_area ?? '')}</small></p>` : ''}
      </section>

      ${
        res.proxima_evaluacion
          ? `<section class="tarjeta"><h2>Próxima evaluación sugerida</h2>
              <p><strong>${fechaCorta(res.proxima_evaluacion)}</strong> (en ${res.reevaluar_meses} ${res.reevaluar_meses === 1 ? 'mes' : 'meses'})<br><small>${esc(res.respuesta)}</small></p></section>`
          : ''
      }

      ${
        accionesConTexto.length
          ? `<section class="tarjeta"><h2>Acciones <span class="insignia-sec">${accionesConTexto.length}</span></h2>
              <ul class="lista">${accionesConTexto
                .map((a) => `<li><strong>${esc(a.codigo_item)}</strong> · ${esc(a.descripcion)}<br><small>${esc(a.responsable)} · compromiso ${fechaCorta(a.fecha_compromiso)} · ${a.estado === 'cerrada' ? `cerrada ${fechaCorta(a.fecha_cierre)}` : 'abierta'}</small></li>`)
                .join('')}</ul></section>`
          : ''
      }

      ${
        borrador
          ? `<section class="tarjeta pendientes">
              <h2>${pendientes.length ? 'Pendientes para cerrar' : 'Todo completo'}</h2>
              ${
                pendientes.length
                  ? `<p>${pendientes.length} ítem${pendientes.length === 1 ? '' : 's'} por completar:</p>${pendientes
                      .map((p) => `<a href="#/eval/${esc(ev.id)}/s/${indiceS.get(p.ese.id)}?resaltar=1&ir=${esc(p.item.codigo)}"><strong>${esc(p.item.codigo)}</strong> · ${esc(p.motivos)}</a>`)
                      .join('')}`
                  : '<p>Todos los ítems tienen su calificación, foto y acción requeridas.</p>'
              }
            </section>`
          : ''
      }

      <section class="tarjeta">
        <h2>Datos generales</h2>
        <label class="campo"><span>Personas presentes</span><input type="text" data-campo="personas_presentes" value="${esc(ev.personas_presentes)}" ${borrador ? '' : 'disabled'}></label>
        <label class="campo"><span>Observación general</span><textarea data-campo="observacion_general" ${borrador ? '' : 'disabled'}>${esc(ev.observacion_general)}</textarea></label>
        <p><small>${fotos.length} foto${fotos.length === 1 ? '' : 's'} guardada${fotos.length === 1 ? '' : 's'} en esta evaluación${almacen.usado != null ? ` · Almacenamiento del dispositivo: ${(almacen.usado / 1048576).toFixed(1).replace('.', ',')} MB usados` : ''}.</small></p>
      </section>

      <section class="tarjeta">
        <h2>Firmas</h2>
        ${bloqueFirma('Evaluador', ev.evaluador?.nombre, firmaEvaluador, 'evaluador')}
        <label class="campo"><span>Nombre de quien firma como ${esc(rolResponsable.toLowerCase())}</span>
          <input type="text" data-campo="firmante_responsable" value="${esc(ev.firmante_responsable ?? (esDigital ? ev.usuario_nombre : area?.responsable) ?? '')}" ${borrador ? '' : 'disabled'}></label>
        ${bloqueFirma(rolResponsable, '', firmaResponsable, 'responsable', ausenteHTML)}
        ${borrador && !firmaResponsable && !ev.firma_responsable_ausente ? '<button type="button" class="btn btn--chico" data-ausente style="margin-top:.5rem">El responsable no estuvo presente</button>' : ''}
      </section>

      <div class="pila">
        ${
          borrador
            ? `<a class="btn btn--bloque" href="#/eval/${esc(ev.id)}/s/1">Volver a la evaluación</a>
               <button class="btn btn--primario btn--bloque" data-cerrar ${cierre.puede ? '' : 'disabled'}>Cerrar evaluación</button>
               ${cierre.puede ? '' : `<p class="suave" style="text-align:center"><small>Para cerrar falta: ${[
                 cierre.pendientes.includes('items') ? 'completar los ítems pendientes' : '',
                 cierre.pendientes.includes('firma_evaluador') ? 'la firma del evaluador' : '',
                 cierre.pendientes.includes('firma_responsable') ? `la firma del ${rolResponsable.toLowerCase()} (o el motivo de su ausencia)` : '',
               ].filter(Boolean).join(', ')}.</small></p>`}`
            : `<button class="btn btn--primario btn--bloque" data-acta>Descargar acta PDF</button>
               ${ev.anulada ? `<a class="btn btn--bloque" href="#/nueva?area=${esc(ev.area_id)}">Nueva evaluación en esta área</a>` : '<button class="btn btn--peligro btn--bloque" data-anular>Anular evaluación</button>'}
               <a class="btn btn--bloque" href="#/area/${esc(ev.area_id)}">Historial del área</a>`
        }
      </div>
    </div>`;

    // Radar (Chart.js se carga solo aquí); si no está disponible, la tarjeta se oculta.
    const canvas = cont.querySelector('[data-radar]');
    try {
      const { dibujarRadar } = await import('../charts.js');
      grafico = await dibujarRadar(canvas, inst, res);
    } catch (e) {
      console.warn('Gráfico no disponible', e);
      canvas.closest('section').classList.add('oculto');
    }
  }

  // --- Acciones del usuario ---------------------------------------------------

  async function firmar(quien) {
    const esEvaluador = quien === 'evaluador';
    const png = await dialogoFirma({
      titulo: esEvaluador ? 'Firma del evaluador' : `Firma: ${rolResponsable.toLowerCase()}`,
      firmante: esEvaluador ? ev.evaluador?.nombre : ev.firmante_responsable || (esDigital ? ev.usuario_nombre : area?.responsable),
    });
    if (!png) return;
    ev.firmas = { ...(ev.firmas ?? {}), [quien]: png };
    if (!esEvaluador) ev.firma_responsable_ausente = null; // firmó: ya no se justifica su ausencia
    await guardador.vaciar();
    await db.guardar('evaluaciones', ev);
    pintar();
  }

  async function responsableAusente() {
    const v = await dialogoFormulario({
      titulo: `${rolResponsable} ausente`,
      camposHTML: `<label class="campo"><span>Motivo por el que no firma</span><textarea name="motivo" placeholder="Por qué no estuvo presente"></textarea></label>`,
      aceptar: 'Aceptar',
      validar: (x) => (x.motivo ? null : 'Escriba el motivo.'),
    });
    if (!v) return;
    ev.firma_responsable_ausente = v.motivo;
    ev.firmas = { ...(ev.firmas ?? {}), responsable: null };
    await db.guardar('evaluaciones', ev);
    pintar();
  }

  async function cerrar() {
    await guardador.vaciar();
    ev = await db.obtener('evaluaciones', id);
    const ok = await confirmar({
      titulo: 'Cerrar evaluación',
      mensaje: 'Al cerrarla se congela el resultado y ya no se podrá editar. Si después hay que corregirla, deberá anularla y crear una nueva.',
      aceptar: 'Cerrar evaluación',
    });
    if (!ok) return;

    // Otra evaluación pudo cerrarse mientras tanto (p. ej., por una importación): se recalcula si es la primera.
    const primera = await db.esPrimeraEvaluacion(ev.area_id, ev.modulo);
    if (primera !== ev.es_primera_evaluacion) {
      ev.es_primera_evaluacion = primera;
      ev.respuestas = sincronizarRespuestas(inst, ev.modulo, ev.respuestas, { tipoArea: ev.area_tipo, esPrimera: primera });
      await db.guardar('evaluaciones', ev);
      toast('Cambió si es la primera evaluación del área: revise los ítems pendientes.', 6000);
      return pintar();
    }
    // Se descartan los bloques de acción vacíos y se vuelve a validar con lo que queda.
    const acciones = await db.accionesDeEvaluacion(ev.id);
    for (const a of acciones.filter(accionVacia)) await db.eliminar('acciones', a.id);
    const restantes = acciones.filter((a) => !accionVacia(a));
    if (!validarCierre(inst, ev, { acciones: restantes }).puede) {
      toast('Todavía faltan datos para cerrar.');
      return pintar();
    }
    // Se congela quién firma por el responsable: el responsable del área puede cambiar después.
    ev.firmante_responsable = ev.firmante_responsable?.trim() || (esDigital ? ev.usuario_nombre : area?.responsable) || '';
    ev.resultado = { ...resultadoDeEvaluacion(inst, ev), calculado_en: ahoraISO() };
    ev.estado = 'cerrada';
    ev.fecha_cierre = ahoraISO();
    await db.guardar('evaluaciones', ev);
    toast('Evaluación cerrada');
    await pintar();
    window.scrollTo(0, 0);
  }

  async function descargarActa() {
    const progreso = dialogoProgreso('Generando acta PDF');
    try {
      const { generarActa } = await import('../pdf.js');
      const { blob, nombre } = await generarActa(ev, { onProgreso: progreso.actualizar });
      progreso.cerrar();
      dialogoEntrega({ blob, nombre });
    } catch (e) {
      console.error(e);
      progreso.cerrar();
      toast(`No se pudo generar el acta: ${e.message}`, 7000);
    }
  }

  async function anular() {
    const v = await dialogoFormulario({
      titulo: 'Anular evaluación',
      camposHTML: `<p>La evaluación quedará en el historial como anulada y dejará de contar para resultados, tendencias e informes. Esta acción no se puede deshacer.</p>
        <label class="campo"><span>Motivo de la anulación</span><textarea name="motivo" placeholder="Por qué se anula"></textarea></label>`,
      aceptar: 'Anular',
      validar: (x) => (x.motivo ? null : 'Escriba el motivo de la anulación.'),
    });
    if (!v) return;
    await db.anularEvaluacion(ev, v.motivo);
    toast('Evaluación anulada');
    pintar();
  }

  cont.addEventListener('click', (e) => {
    const firma = e.target.closest('[data-firmar]');
    if (firma) firmar(firma.dataset.firmar);
    else if (e.target.closest('[data-ausente]')) responsableAusente();
    else if (e.target.closest('[data-quitar-ausente]')) {
      ev.firma_responsable_ausente = null;
      db.guardar('evaluaciones', ev).then(pintar);
    } else if (e.target.closest('[data-cerrar]')) cerrar();
    else if (e.target.closest('[data-acta]')) descargarActa();
    else if (e.target.closest('[data-anular]')) anular();
  });

  // Los campos de texto solo se pueden editar mientras es borrador.
  cont.addEventListener('input', (e) => {
    const campo = e.target.dataset?.campo;
    if (!campo || ev.estado !== 'borrador') return;
    ev[campo] = e.target.value;
    guardador.programar();
  });
  // Al cambiar el nombre del firmante se actualiza el texto de los diálogos y la lista de requisitos.
  cont.addEventListener('change', () => guardador.vaciar());

  await pintar();
  return async () => {
    grafico?.destroy();
    await guardador.vaciar();
  };
}
