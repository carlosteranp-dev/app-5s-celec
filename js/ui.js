// Componentes de interfaz comunes: barra superior, chips de nivel, toast y diálogos.
import { esc, colorTextoSobre } from './util.js';
import { NIVEL_NO_EVALUABLE } from './calc.js';

/** Barra superior con botón de regreso opcional. */
export function barraSuperior(titulo, volverHref = null) {
  const volver = volverHref ? `<a href="${esc(volverHref)}" aria-label="Volver">←</a>` : '';
  return `<header class="barra">${volver}<h1>${esc(titulo)}</h1></header>`;
}

/** Chip con el color del nivel tomado del instrumento (texto claro u oscuro según el contraste). */
export function chipNivel(nombre, interpretacion) {
  if (!nombre || nombre === NIVEL_NO_EVALUABLE) return `<span class="chip chip--no-evaluable">${NIVEL_NO_EVALUABLE}</span>`;
  const info = interpretacion.find((r) => r.nivel === nombre);
  const color = info?.color ?? '#5F6B76';
  return `<span class="chip chip--nivel" style="background:${esc(color)};color:${colorTextoSobre(color)}">${esc(nombre)}</span>`;
}

let temporizadorToast = null;

/** Mensaje breve en la parte inferior. */
export function toast(mensaje, ms = 3000) {
  document.querySelector('.toast')?.remove();
  const el = Object.assign(document.createElement('div'), { className: 'toast', textContent: mensaje });
  el.setAttribute('role', 'status');
  document.body.append(el);
  clearTimeout(temporizadorToast);
  temporizadorToast = setTimeout(() => el.remove(), ms);
}

/**
 * Abre un <dialog> modal con `html`. Devuelve el elemento y `cerrar()`, que lo cierra y lo quita del DOM de
 * inmediato; también se quita si se cierra con Esc. No se depende del evento "close" para continuar el flujo.
 */
export function abrirDialogo(html, alCancelar = () => {}) {
  const d = document.createElement('dialog');
  d.innerHTML = html;
  document.body.append(d);
  const cerrar = () => {
    if (d.open) d.close();
    d.remove();
  };
  d.addEventListener('cancel', () => {
    cerrar();
    alCancelar(); // Esc o botón "atrás" de Android
  });
  d.showModal();
  return { d, cerrar };
}

/** Confirmación con botones Cancelar / Aceptar. Devuelve una promesa con true o false. */
export function confirmar({ titulo, mensaje, aceptar = 'Aceptar', peligro = false }) {
  return new Promise((resolver) => {
    const { d, cerrar } = abrirDialogo(
      `
      <h2>${esc(titulo)}</h2>
      <p>${esc(mensaje)}</p>
      <div class="acciones-dialogo">
        <button type="button" class="btn" data-r="no">Cancelar</button>
        <button type="button" class="btn ${peligro ? 'btn--peligro' : 'btn--primario'}" data-r="si">${esc(aceptar)}</button>
      </div>`,
      () => resolver(false),
    );
    d.addEventListener('click', (e) => {
      const r = e.target.closest('[data-r]')?.dataset.r;
      if (!r) return;
      cerrar();
      resolver(r === 'si');
    });
  });
}

/**
 * Diálogo con formulario. `camposHTML` son los campos; `validar(valores)` devuelve un texto de error o null.
 * Devuelve una promesa con los valores del formulario (objeto) o null si se cancela.
 */
export function dialogoFormulario({ titulo, camposHTML, aceptar = 'Guardar', validar = () => null }) {
  return new Promise((resolver) => {
    const { d, cerrar } = abrirDialogo(
      `
      <h2>${esc(titulo)}</h2>
      <form novalidate>
        ${camposHTML}
        <p class="mensaje-error oculto" role="alert"></p>
        <div class="acciones-dialogo">
          <button type="button" class="btn" data-cancelar>Cancelar</button>
          <button type="submit" class="btn btn--primario">${esc(aceptar)}</button>
        </div>
      </form>`,
      () => resolver(null),
    );
    const form = d.querySelector('form');
    const msg = d.querySelector('.mensaje-error');
    d.querySelector('[data-cancelar]').addEventListener('click', () => {
      cerrar();
      resolver(null);
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const valores = Object.fromEntries([...new FormData(form)].map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v]));
      const error = validar(valores);
      if (error) {
        msg.textContent = error;
        msg.classList.remove('oculto');
        return;
      }
      cerrar();
      resolver(valores);
    });
    d.querySelector('input:not([type=hidden]), select, textarea')?.focus();
  });
}

/**
 * Muestra una foto en grande. Devuelve una promesa con 'eliminar' si el usuario elige borrarla
 * (y la confirma), o null si solo la cierra.
 */
export function visorFoto({ blob, titulo, puedeEliminar = false }) {
  return new Promise((resolver) => {
    const url = URL.createObjectURL(blob);
    const terminar = (valor) => {
      cerrar();
      URL.revokeObjectURL(url);
      resolver(valor);
    };
    const { d, cerrar } = abrirDialogo(
      `
      <h2>${esc(titulo)}</h2>
      <img class="visor-foto" src="${url}" alt="${esc(titulo)}">
      <div class="acciones-dialogo">
        ${puedeEliminar ? '<button type="button" class="btn btn--peligro" data-eliminar>Eliminar foto</button>' : ''}
        <button type="button" class="btn btn--primario" data-cerrar>Cerrar</button>
      </div>`,
      () => {
        URL.revokeObjectURL(url);
        resolver(null);
      },
    );
    d.querySelector('[data-cerrar]').addEventListener('click', () => terminar(null));
    d.querySelector('[data-eliminar]')?.addEventListener('click', async () => {
      const ok = await confirmar({ titulo: 'Eliminar foto', mensaje: 'La foto se borrará de este dispositivo. Esta acción no se puede deshacer.', aceptar: 'Eliminar', peligro: true });
      if (ok) terminar('eliminar');
    });
  });
}
