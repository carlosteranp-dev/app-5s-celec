// Lista de evaluaciones en borrador para retomarlas o descartarlas.
import * as db from '../db.js';
import { instrumentoDe } from '../contexto.js';
import { avance, obtenerModulo } from '../calc.js';
import { esc, fechaCorta } from '../util.js';
import { barraSuperior, confirmar, toast } from '../ui.js';

async function filas() {
  const [evaluaciones, areas, sitios] = await Promise.all([db.todos('evaluaciones'), db.todos('areas'), db.todos('sitios')]);
  const borradores = evaluaciones.filter((e) => e.estado === 'borrador').sort((a, b) => b.modificado.localeCompare(a.modificado));
  return Promise.all(
    borradores.map(async (ev) => {
      const area = areas.find((a) => a.id === ev.area_id);
      const sitio = sitios.find((s) => s.id === area?.sitio_id);
      const inst = await instrumentoDe(ev);
      const av = avance(inst, ev);
      return { ev, area, sitio, av, modulo: obtenerModulo(inst, ev.modulo).nombre };
    }),
  );
}

export async function render(cont) {
  const dibujar = async () => {
    const lista = await filas();
    cont.innerHTML = `
      ${barraSuperior('Borradores', '#/')}
      <div class="contenido pila">
        ${
          lista.length === 0
            ? '<div class="tarjeta"><p>No hay evaluaciones en borrador.</p><a class="btn btn--primario btn--bloque" href="#/nueva">Nueva evaluación</a></div>'
            : `<ul class="lista">${lista
                .map(
                  ({ ev, area, sitio, av, modulo }) => `
              <li class="tarjeta">
                <div class="fila fila--entre">
                  <div class="crece">
                    <strong>${esc(sitio?.nombre ?? '—')} · ${esc(area?.nombre ?? '—')}</strong><br>
                    <small>${esc(modulo)}${ev.usuario_nombre ? ` · ${esc(ev.usuario_nombre)}` : ''} · ${fechaCorta(ev.fecha)}</small>
                  </div>
                  <span class="chip">${av.hechos}/${av.total}</span>
                </div>
                <div class="acciones-fila">
                  <a class="btn btn--primario btn--chico" href="#/eval/${esc(ev.id)}/s/1">Continuar</a>
                  <a class="btn btn--chico" href="#/eval/${esc(ev.id)}/resumen">Resumen</a>
                  <button class="btn btn--chico btn--peligro" data-descartar="${esc(ev.id)}">Descartar</button>
                </div>
              </li>`,
                )
                .join('')}</ul>`
        }
      </div>`;
  };
  await dibujar();

  cont.addEventListener('click', async (e) => {
    const id = e.target.closest('[data-descartar]')?.dataset.descartar;
    if (!id) return;
    const ok = await confirmar({
      titulo: 'Descartar borrador',
      mensaje: 'Se eliminará esta evaluación en borrador con todas sus respuestas. Esta acción no se puede deshacer.',
      aceptar: 'Descartar',
      peligro: true,
    });
    if (!ok) return;
    await db.eliminar('evaluaciones', id);
    toast('Borrador descartado');
    dibujar();
  });
}
