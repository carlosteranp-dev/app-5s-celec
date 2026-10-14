// Perfil del evaluador (se pide la primera vez y se puede editar).
import * as db from '../db.js';
import { esc } from '../util.js';
import { barraSuperior, toast } from '../ui.js';

export async function render(cont) {
  const perfil = await db.obtenerConfig('perfil');
  const primeraVez = !perfil;
  cont.innerHTML = `
    ${barraSuperior(primeraVez ? 'Bienvenido' : 'Perfil del evaluador', primeraVez ? null : '#/')}
    <form class="contenido pila" novalidate>
      ${primeraVez ? '<p>Antes de empezar, indique quién realizará las evaluaciones en este dispositivo. Se registrará en cada evaluación y en las actas.</p>' : ''}
      <div class="tarjeta">
        <label class="campo"><span>Nombre completo</span><input type="text" name="nombre" autocomplete="name" required value="${esc(perfil?.nombre)}"></label>
        <label class="campo"><span>Cargo</span><input type="text" name="cargo" autocomplete="organization-title" required value="${esc(perfil?.cargo)}"></label>
        <p class="mensaje-error oculto" role="alert"></p>
      </div>
      <button class="btn btn--primario btn--bloque" type="submit">Guardar</button>
    </form>`;

  const form = cont.querySelector('form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const nombre = form.nombre.value.trim();
    const cargo = form.cargo.value.trim();
    const error = cont.querySelector('.mensaje-error');
    if (!nombre || !cargo) {
      error.textContent = 'Escriba su nombre y su cargo.';
      error.classList.remove('oculto');
      return;
    }
    await db.guardarConfig('perfil', { nombre, cargo });
    toast('Perfil guardado');
    location.hash = '#/';
  });
}
