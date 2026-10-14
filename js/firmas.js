// Firma manuscrita en un canvas táctil. Devuelve un PNG (data URL) recortado al trazo.
import { abrirDialogo } from './ui.js';
import { esc } from './util.js';

const ALTO_LIENZO = 220;
const ANCHO_MAX_PNG = 600;
const LARGO_MINIMO = 60; // longitud total de trazo (px) para no aceptar un simple toque

/**
 * Abre un diálogo para firmar. Devuelve una promesa con el PNG en base64 (data URL)
 * o null si se cancela. `titulo` y `firmante` se muestran sobre el recuadro.
 */
export function dialogoFirma({ titulo, firmante = '' }) {
  return new Promise((resolver) => {
    const { d, cerrar } = abrirDialogo(
      `
      <h2>${esc(titulo)}</h2>
      ${firmante ? `<p class="suave">${esc(firmante)}</p>` : ''}
      <canvas class="firma-lienzo" aria-label="Recuadro de firma"></canvas>
      <p class="suave"><small>Firme con el dedo dentro del recuadro.</small></p>
      <p class="mensaje-error oculto" role="alert"></p>
      <div class="acciones-dialogo">
        <button type="button" class="btn" data-borrar>Borrar</button>
        <button type="button" class="btn" data-cancelar>Cancelar</button>
        <button type="button" class="btn btn--primario" data-guardar>Guardar firma</button>
      </div>`,
      () => resolver(null),
    );
    const lienzo = d.querySelector('canvas');
    const aviso = d.querySelector('.mensaje-error');
    const escala = window.devicePixelRatio || 1;
    lienzo.width = Math.round(lienzo.clientWidth * escala);
    lienzo.height = Math.round(ALTO_LIENZO * escala);
    const g = lienzo.getContext('2d');
    g.scale(escala, escala);
    g.lineWidth = 2.6;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.strokeStyle = '#0B1F3A';

    let trazando = false;
    let previo = null;
    let largo = 0;
    const caja = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };

    const punto = (e) => {
      const r = lienzo.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const abarcar = (p) => {
      caja.x0 = Math.min(caja.x0, p.x);
      caja.y0 = Math.min(caja.y0, p.y);
      caja.x1 = Math.max(caja.x1, p.x);
      caja.y1 = Math.max(caja.y1, p.y);
    };

    lienzo.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      try {
        lienzo.setPointerCapture(e.pointerId); // sigue el trazo aunque el dedo salga del recuadro
      } catch {
        /* puntero no capturable: el trazo igual funciona dentro del recuadro */
      }
      trazando = true;
      previo = punto(e);
      abarcar(previo);
      g.beginPath();
      g.arc(previo.x, previo.y, 0.8, 0, Math.PI * 2); // un toque deja un punto
      g.stroke();
    });
    lienzo.addEventListener('pointermove', (e) => {
      if (!trazando) return;
      e.preventDefault();
      const p = punto(e);
      g.beginPath();
      g.moveTo(previo.x, previo.y);
      g.lineTo(p.x, p.y);
      g.stroke();
      largo += Math.hypot(p.x - previo.x, p.y - previo.y);
      abarcar(p);
      previo = p;
    });
    const terminarTrazo = () => (trazando = false);
    lienzo.addEventListener('pointerup', terminarTrazo);
    lienzo.addEventListener('pointercancel', terminarTrazo);

    d.querySelector('[data-borrar]').addEventListener('click', () => {
      g.clearRect(0, 0, lienzo.width, lienzo.height);
      largo = 0;
      Object.assign(caja, { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
      aviso.classList.add('oculto');
    });
    d.querySelector('[data-cancelar]').addEventListener('click', () => {
      cerrar();
      resolver(null);
    });
    d.querySelector('[data-guardar]').addEventListener('click', () => {
      if (largo < LARGO_MINIMO) {
        aviso.textContent = 'Dibuje la firma antes de guardar.';
        aviso.classList.remove('oculto');
        return;
      }
      const png = recortar(lienzo, caja, escala);
      cerrar();
      resolver(png);
    });
  });
}

/** Recorta el lienzo al trazo (con margen) y lo reduce para que el PNG pese poco. */
function recortar(lienzo, caja, escala) {
  const margen = 6;
  const x = Math.max(0, Math.floor((caja.x0 - margen) * escala));
  const y = Math.max(0, Math.floor((caja.y0 - margen) * escala));
  const ancho = Math.min(lienzo.width - x, Math.ceil((caja.x1 - caja.x0 + 2 * margen) * escala));
  const alto = Math.min(lienzo.height - y, Math.ceil((caja.y1 - caja.y0 + 2 * margen) * escala));
  const factor = Math.min(1, ANCHO_MAX_PNG / ancho);
  const salida = document.createElement('canvas');
  salida.width = Math.max(1, Math.round(ancho * factor));
  salida.height = Math.max(1, Math.round(alto * factor));
  salida.getContext('2d').drawImage(lienzo, x, y, ancho, alto, 0, 0, salida.width, salida.height);
  const png = salida.toDataURL('image/png');
  salida.width = salida.height = 0;
  return png;
}
