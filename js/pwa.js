// PWA: registro del service worker, aviso de nueva versión, estado "lista sin conexión" e instalación.
import { esc } from './util.js';

/** Estado visible para las pantallas (el inicio lo muestra). Cada cambio emite el evento "5s:pwa" en window. */
export const estadoPWA = { soportado: false, listaSinConexion: false, instalable: false };

const antesDeRecargar = new Set();
let registro = null;
let recargaSolicitada = false;
let eventoInstalacion = null;

/** Registra una función a ejecutar antes de recargar la página (p. ej., guardar el último cambio). */
export const alRecargar = (fn) => antesDeRecargar.add(fn);

export const estaInstalada = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
export const esIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

const notificar = () => window.dispatchEvent(new CustomEvent('5s:pwa'));

async function prepararRecarga() {
  for (const fn of antesDeRecargar) {
    try {
      await fn();
    } catch (e) {
      console.error('Error al preparar la recarga', e);
    }
  }
}

/** Franja fija con un mensaje y un botón (la persona decide cuándo actualizar). */
function mostrarAviso(texto, textoBoton, accion) {
  document.querySelector('.aviso-actualizacion')?.remove();
  const el = document.createElement('div');
  el.className = 'aviso-actualizacion';
  el.setAttribute('role', 'status');
  el.innerHTML = `<span>${esc(texto)}</span><button type="button" class="btn btn--chico">${esc(textoBoton)}</button><button type="button" class="aviso-actualizacion__cerrar" aria-label="Ocultar aviso">×</button>`;
  const [, actualizar, cerrar] = el.children;
  actualizar.addEventListener('click', accion);
  cerrar.addEventListener('click', () => el.remove());
  document.body.append(el);
}

/** Activa la versión en espera y recarga cuando toma el control. */
async function actualizarAhora() {
  await prepararRecarga();
  if (registro?.waiting) {
    recargaSolicitada = true;
    registro.waiting.postMessage({ tipo: 'SALTAR_ESPERA' });
  } else {
    location.reload();
  }
}

const avisarNuevaVersion = () => mostrarAviso('Nueva versión disponible', 'Actualizar', actualizarAhora);

/** Instalación como app: muestra el diálogo del navegador (Android/Chrome). Devuelve true si se aceptó. */
export async function pedirInstalacion() {
  if (!eventoInstalacion) return false;
  eventoInstalacion.prompt();
  const { outcome } = await eventoInstalacion.userChoice;
  eventoInstalacion = null;
  estadoPWA.instalable = false;
  notificar();
  return outcome === 'accepted';
}

/**
 * El worker avisa si el instrumento cambió en el servidor. Se escucha desde que carga el módulo: el aviso puede
 * llegar muy pronto (el worker revisa en cuanto la página pide el instrumento), antes de que termine el arranque.
 */
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.tipo === 'instrumento-actualizado') {
      mostrarAviso('El instrumento 5S fue actualizado.', 'Actualizar', async () => {
        await prepararRecarga();
        location.reload();
      });
    }
  });
  navigator.serviceWorker.startMessages?.();
}

export async function iniciarPWA() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // se ofrece desde la tarjeta del inicio, no con el aviso automático
    eventoInstalacion = e;
    estadoPWA.instalable = true;
    notificar();
  });
  window.addEventListener('appinstalled', () => {
    estadoPWA.instalable = false;
    notificar();
  });

  if (!('serviceWorker' in navigator)) return;
  try {
    registro = await navigator.serviceWorker.register('sw.js', { scope: './' });
  } catch (e) {
    console.warn('No se pudo registrar el service worker (¿HTTP sin HTTPS?)', e);
    return;
  }
  estadoPWA.soportado = true;

  // Versión nueva: queda en espera y se avisa; solo se activa al tocar "Actualizar".
  const vigilar = (worker) =>
    worker.addEventListener('statechange', () => {
      if (worker.state === 'installed' && navigator.serviceWorker.controller) avisarNuevaVersion();
    });
  if (registro.waiting && navigator.serviceWorker.controller) avisarNuevaVersion();
  registro.addEventListener('updatefound', () => registro.installing && vigilar(registro.installing));

  // Con la primera instalación el worker toma el control sin recargar; solo se recarga si la persona lo pidió.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (recargaSolicitada) location.reload();
  });

  navigator.serviceWorker.ready.then(() => {
    estadoPWA.listaSinConexion = true; // la precarga termina antes de que el worker se active
    notificar();
  });

  // Busca versiones nuevas al volver a la app y cada hora.
  const buscar = () => registro.update().catch(() => {});
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && buscar());
  setInterval(buscar, 60 * 60 * 1000);
}
