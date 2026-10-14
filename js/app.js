// Arranque de la app y enrutador por hash.
import { cargarInstrumento, ErrorInstrumento } from './instrumento.js';
import * as db from './db.js';
import { ctx } from './contexto.js';
import { esc } from './util.js';
import { iniciarPWA, alRecargar } from './pwa.js';

/** Cada ruta carga su pantalla solo cuando se necesita. `render(contenedor, params, query)` puede devolver una función de limpieza. */
const RUTAS = [
  { patron: /^\/$/, vista: './views/inicio.js' },
  { patron: /^\/perfil$/, vista: './views/perfil.js' },
  { patron: /^\/sitios$/, vista: './views/sitios.js' },
  { patron: /^\/nueva$/, vista: './views/nueva.js' },
  { patron: /^\/borradores$/, vista: './views/borradores.js' },
  { patron: /^\/area\/([^/]+)$/, vista: './views/area.js', params: ['id'] },
  { patron: /^\/eval\/([^/]+)\/s\/(\d+)$/, vista: './views/evaluacion.js', params: ['id', 's'] },
  { patron: /^\/eval\/([^/]+)\/resumen$/, vista: './views/resumen.js', params: ['id'] },
  { patron: /^\/informes$/, vista: './views/informes.js' },
  { patron: /^\/respaldo$/, vista: './views/respaldo.js' },
];

const contenedor = document.getElementById('app');
let limpiezaActual = null;
let numeroNavegacion = 0;

/** Ruta y parámetros de consulta a partir del hash (#/eval/abc/s/2?resaltar=1). */
function leerHash() {
  const [ruta, consulta = ''] = (location.hash.replace(/^#/, '') || '/').split('?');
  return { ruta: ruta || '/', query: Object.fromEntries(new URLSearchParams(consulta)) };
}

async function navegar() {
  const mia = ++numeroNavegacion;
  if (limpiezaActual) {
    const limpiar = limpiezaActual;
    limpiezaActual = null;
    try {
      await limpiar(); // p. ej. guarda el último cambio de la evaluación
    } catch (e) {
      console.error('Error al salir de la pantalla', e);
    }
  }
  if (mia !== numeroNavegacion) return;

  const { ruta, query } = leerHash();
  const def = RUTAS.find((r) => r.patron.test(ruta));
  if (!def) {
    location.replace('#/');
    return;
  }
  const params = { ...(def.extra || {}) };
  (def.params || []).forEach((nombre, i) => (params[nombre] = decodeURIComponent(def.patron.exec(ruta)[i + 1])));

  // Cada pantalla recibe un elemento nuevo: sus escuchas de eventos desaparecen con él al navegar.
  const pantalla = document.createElement('div');
  contenedor.replaceChildren(pantalla);
  try {
    const modulo = await import(def.vista);
    if (mia !== numeroNavegacion) return;
    const limpieza = await modulo.render(pantalla, params, query);
    if (mia !== numeroNavegacion) {
      if (limpieza) await limpieza();
      return;
    }
    limpiezaActual = limpieza || null;
    window.scrollTo(0, 0);
  } catch (e) {
    console.error(e);
    contenedor.innerHTML = `<div class="contenido"><div class="aviso aviso--error"><h2>Ocurrió un error</h2><p>${esc(e.message)}</p><p><a href="#/">Volver al inicio</a></p></div></div>`;
  }
}

/** Pantalla cuando el instrumento no se puede cargar o es inválido: no se puede evaluar con reglas dudosas. */
function mostrarErrorInicio(e) {
  const delInstrumento = e instanceof ErrorInstrumento;
  const lista = delInstrumento ? e.errores : [e.message];
  contenedor.innerHTML = `
    <div class="contenido pila">
      <div class="aviso aviso--error">
        <h1>No se puede iniciar la app</h1>
        <p>${delInstrumento ? 'El archivo <strong>instrumento_5S.json</strong> tiene problemas. Corríjalo y vuelva a abrir la app.' : 'No se pudo preparar el almacenamiento del dispositivo.'}</p>
        <ul>${lista.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>
      </div>
    </div>`;
}

async function arrancar() {
  try {
    const cargado = await cargarInstrumento();
    Object.assign(ctx, { instrumento: cargado.instrumento, hash: cargado.hash, clave: cargado.clave });
    await db.abrir();
    db.solicitarPersistencia();
    const distintas = await db.asegurarCopiaInstrumento(cargado);
    if (distintas.length) {
      ctx.advertencias.push(`El instrumento cambió sin cambiar su versión (${cargado.instrumento.meta.version}). Se recomienda actualizar "meta.version" en el JSON para distinguir las evaluaciones.`);
    }
  } catch (e) {
    console.error(e);
    mostrarErrorInicio(e);
    return;
  }
  window.addEventListener('hashchange', navegar);
  // Antes de recargar por una actualización se guarda lo que la pantalla actual tenga pendiente.
  alRecargar(async () => {
    if (limpiezaActual) await limpiezaActual();
    limpiezaActual = null;
  });
  navegar();
  iniciarPWA();
}

arrancar();
