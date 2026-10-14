// Área: historial de evaluaciones (ver, acta PDF, anular) y acciones (seguimiento y cierre).
import * as db from '../db.js';
import { ctx } from '../contexto.js';
import { diasDeAtraso, formatoGlobal } from '../calc.js';
import { esc, fechaCorta, hoyLocal, ahoraISO } from '../util.js';
import { barraSuperior, chipNivel, confirmar, toast } from '../ui.js';
import { dialogoEntrega, dialogoProgreso } from '../entrega.js';

export async function render(cont, { id }) {
  const area = await db.obtener('areas', id);
  if (!area) {
    toast('No se encontró el área');
    location.replace('#/sitios');
    return;
  }
  const sitio = await db.obtener('sitios', area.sitio_id);
  const interp = ctx.instrumento.interpretacion;
  const nombreModulo = (m) => ctx.instrumento.modulos.find((x) => x.id === m)?.nombre ?? m;

  async function pintar() {
    const evaluaciones = await db.evaluacionesDeArea(id);
    const acciones = (await db.accionesDeArea(id)).filter(({ accion }) => accion.descripcion?.trim());
    const hoy = hoyLocal();
    const abiertas = acciones.filter(({ accion }) => accion.estado === 'abierta').sort((a, b) => a.accion.fecha_compromiso.localeCompare(b.accion.fecha_compromiso));
    const cerradas = acciones.filter(({ accion }) => accion.estado === 'cerrada');

    const estado = (e) => (e.estado === 'borrador' ? '<span class="chip chip--aviso">Borrador</span>' : e.anulada ? '<span class="chip chip--error">Anulada</span>' : chipNivel(e.resultado?.nivel, interp));
    const fila = (e) => `
      <li class="tarjeta">
        <div class="fila fila--entre">
          <div class="crece">
            <strong>${esc(nombreModulo(e.modulo))}</strong>${e.usuario_nombre ? ` · ${esc(e.usuario_nombre)}` : ''}<br>
            <small>${fechaCorta(e.fecha)} · ${esc(e.evaluador?.nombre)}${e.resultado?.global != null ? ` · ${formatoGlobal(e.resultado.global, interp)}` : ''}</small>
          </div>
          ${estado(e)}
        </div>
        <div class="acciones-fila">
          <a class="btn btn--chico btn--primario" href="${e.estado === 'borrador' ? `#/eval/${esc(e.id)}/s/1` : `#/eval/${esc(e.id)}/resumen`}">${e.estado === 'borrador' ? 'Continuar' : 'Ver'}</a>
          ${e.estado === 'cerrada' ? `<button class="btn btn--chico" data-acta="${esc(e.id)}">Acta PDF</button>` : ''}
        </div>
      </li>`;
    const filaAccion = ({ accion: a, ev }) => {
      const atraso = a.estado === 'abierta' ? diasDeAtraso(a.fecha_compromiso, hoy) : 0;
      return `
      <li class="tarjeta">
        <strong>${esc(a.codigo_item)}</strong> · ${esc(a.descripcion)}<br>
        <small>${esc(a.responsable)} · compromiso ${fechaCorta(a.fecha_compromiso)} · ${esc(nombreModulo(ev.modulo))}, ${fechaCorta(ev.fecha)}</small>
        ${atraso ? `<br><span class="chip chip--error">${atraso} día${atraso === 1 ? '' : 's'} de atraso</span>` : ''}
        ${a.estado === 'cerrada' ? `<br><span class="chip">Cerrada ${fechaCorta(a.fecha_cierre)}</span>` : `<div class="acciones-fila"><button class="btn btn--chico" data-cerrar-accion="${esc(a.id)}">Cerrar acción</button></div>`}
      </li>`;
    };

    cont.innerHTML = `
      ${barraSuperior(area.nombre, '#/sitios')}
      <div class="contenido pila">
        <p class="suave">${esc(sitio?.nombre ?? '')}</p>
        <a class="btn btn--primario btn--bloque" href="#/nueva?area=${esc(id)}">Nueva evaluación</a>
        <h2>Evaluaciones <span class="insignia-sec">${evaluaciones.length}</span></h2>
        ${evaluaciones.length ? `<ul class="lista">${evaluaciones.map(fila).join('')}</ul>` : '<div class="tarjeta"><p>Esta área aún no tiene evaluaciones.</p></div>'}
        <h2>Acciones abiertas <span class="insignia-sec">${abiertas.length}</span></h2>
        ${abiertas.length ? `<ul class="lista">${abiertas.map(filaAccion).join('')}</ul>` : '<div class="tarjeta"><p>No hay acciones abiertas.</p></div>'}
        ${cerradas.length ? `<h2>Acciones cerradas <span class="insignia-sec">${cerradas.length}</span></h2><ul class="lista">${cerradas.map(filaAccion).join('')}</ul>` : ''}
      </div>`;
  }

  cont.addEventListener('click', async (e) => {
    const cerrarId = e.target.closest('[data-cerrar-accion]')?.dataset.cerrarAccion;
    const actaId = e.target.closest('[data-acta]')?.dataset.acta;
    if (cerrarId) {
      const a = await db.obtener('acciones', cerrarId);
      const ok = await confirmar({ titulo: 'Cerrar acción', mensaje: `Se registrará como cerrada hoy (${fechaCorta(hoyLocal())}): ${a.descripcion}`, aceptar: 'Cerrar acción' });
      if (!ok) return;
      Object.assign(a, { estado: 'cerrada', fecha_cierre: ahoraISO() });
      await db.guardar('acciones', a);
      toast('Acción cerrada');
      pintar();
    } else if (actaId) {
      const ev = await db.obtener('evaluaciones', actaId);
      const progreso = dialogoProgreso('Generando acta PDF');
      try {
        const { generarActa } = await import('../pdf.js');
        const { blob, nombre } = await generarActa(ev, { onProgreso: progreso.actualizar });
        progreso.cerrar();
        dialogoEntrega({ blob, nombre });
      } catch (err) {
        console.error(err);
        progreso.cerrar();
        toast(`No se pudo generar el acta: ${err.message}`, 7000);
      }
    }
  });

  await pintar();
}
