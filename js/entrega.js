// Entrega de archivos al usuario: compartir (menú del sistema) o descargar, y diálogo de progreso.
import { abrirDialogo, toast } from './ui.js';
import { esc, formatoTamano, nombreSeguro } from './util.js';

const mb = formatoTamano;

/** Nombre de archivo sin tildes ni espacios: partes unidas con "_" y fecha AAAAMMDD. */
export function nombreArchivo(partes, fechaISO, extension = 'pdf') {
  const seguras = partes.map(nombreSeguro).filter(Boolean);
  return `${[...seguras, fechaISO.slice(0, 10).replaceAll('-', '')].join('_')}.${extension}`;
}

/** ¿El navegador permite compartir este archivo con el menú del sistema? */
export function puedeCompartir(archivo) {
  return typeof navigator.canShare === 'function' && typeof navigator.share === 'function' && navigator.canShare({ files: [archivo] });
}

/** Descarga con un enlace <a download>. La URL se libera después de un minuto para no cortar la descarga. */
export function descargar(blob, nombre) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: nombre });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

/**
 * Diálogo "archivo listo" (PDF, respaldo, Excel). Compartir exige un toque reciente del usuario y generar el archivo
 * tarda, por eso se ofrece en un segundo paso con botones propios. `alCerrar` se llama al cerrar el diálogo.
 */
export function dialogoEntrega({ blob, nombre, detalle = '', titulo = 'PDF listo', tipo = 'application/pdf', alCerrar = () => {} }) {
  const archivo = new File([blob], nombre, { type: tipo });
  const compartible = puedeCompartir(archivo);
  let cerrado = false;
  const { d, cerrar } = abrirDialogo(
    `
    <h2>${esc(titulo)}</h2>
    <p><strong>${esc(nombre)}</strong><br><small>${mb(blob.size)}${detalle ? ` · ${esc(detalle)}` : ''}</small></p>
    <div class="pila">
      ${compartible ? '<button type="button" class="btn btn--primario btn--bloque" data-compartir>Compartir / Guardar en Archivos</button>' : ''}
      <button type="button" class="btn ${compartible ? '' : 'btn--primario'} btn--bloque" data-descargar>Descargar</button>
      <button type="button" class="btn btn--bloque" data-cerrar>Cerrar</button>
    </div>`,
    () => terminar(), // Esc o botón "atrás"
  );
  function terminar() {
    if (cerrado) return;
    cerrado = true;
    alCerrar();
  }
  d.querySelector('[data-cerrar]').addEventListener('click', () => {
    cerrar();
    terminar();
  });
  d.querySelector('[data-descargar]').addEventListener('click', () => {
    descargar(blob, nombre);
    toast('Descarga iniciada. Búsquelo en la carpeta Descargas.');
  });
  d.querySelector('[data-compartir]')?.addEventListener('click', async () => {
    try {
      await navigator.share({ files: [archivo], title: nombre });
    } catch (e) {
      if (e.name !== 'AbortError') toast('No se pudo abrir el menú de compartir. Use Descargar.', 5000);
    }
  });
}

/** Diálogo de progreso para tareas largas. Devuelve { actualizar(fraccion, texto), cerrar() }. */
export function dialogoProgreso(titulo) {
  const { d, cerrar } = abrirDialogo(`
    <h2>${esc(titulo)}</h2>
    <p data-texto aria-live="polite">Preparando…</p>
    <progress class="progreso-pdf" value="0" max="1"></progress>`);
  d.addEventListener('cancel', (e) => e.preventDefault()); // no se cierra con Esc mientras trabaja
  return {
    actualizar(fraccion, texto) {
      d.querySelector('progress').value = Math.min(1, Math.max(0, fraccion));
      if (texto) d.querySelector('[data-texto]').textContent = texto;
    },
    cerrar,
  };
}

/**
 * El PDF estimado supera el límite: ofrece alternativas. Devuelve una promesa con
 * 'sin-buenas' (omite las fotos de buenas prácticas), 'reducir' (fotos más pequeñas), 'continuar' o 'cancelar'.
 */
export function dialogoExceso({ estimadoMB, limiteMB }) {
  return new Promise((resolver) => {
    const { d, cerrar } = abrirDialogo(
      `
      <h2>El informe pesaría ${estimadoMB.toFixed(1).replace('.', ',')} MB</h2>
      <p>Supera los ${limiteMB} MB recomendados para compartirlo por correo o mensajería. ¿Cómo desea continuar?</p>
      <div class="pila">
        <button type="button" class="btn btn--primario btn--bloque" data-r="sin-buenas">Sin fotos de buenas prácticas</button>
        <button type="button" class="btn btn--bloque" data-r="reducir">Fotos más pequeñas (menor calidad)</button>
        <button type="button" class="btn btn--bloque" data-r="continuar">Generarlo de todos modos</button>
        <button type="button" class="btn btn--bloque" data-r="cancelar">Cancelar</button>
      </div>`,
      () => resolver('cancelar'),
    );
    d.addEventListener('click', (e) => {
      const r = e.target.closest('[data-r]')?.dataset.r;
      if (!r) return;
      cerrar();
      resolver(r);
    });
  });
}
