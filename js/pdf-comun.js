// Piezas compartidas por el acta y el informe PDF: medidas de página, texto seguro, títulos, pie y carga de librerías.
import { cargarScript } from './util.js';

export const PAGINA = { ancho: 210, alto: 297, margen: 15, margenSuperior: 22, margenInferior: 18 };
export const ANCHO_UTIL = PAGINA.ancho - 2 * PAGINA.margen;
export const GRIS = '#5F6B76';
export const AZUL = '#0054A4';
export const AZUL_OSCURO = '#003B73';
export const TEXTO = '#1B2733';

/**
 * Deja solo caracteres que Helvetica (WinAnsi) puede dibujar. Los emojis y símbolos del teclado del
 * celular se quitan para no ensuciar el PDF; algunos signos habituales se sustituyen por equivalentes.
 */
export function limpiarTexto(texto) {
  const sustitutos = { '≥': '>=', '≤': '<=', '→': '->', '←': '<-', '✓': '', '✔': '', '▲': '', '▼': '', ' ': ' ', '​': '' };
  return String(texto ?? '')
    .replace(/[≥≤→←✓✔▲▼ ​]/g, (c) => sustitutos[c])
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA1-\xFF–—‘’“”•…€]/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/** Recorta un texto largo con "…" (las observaciones muy extensas desordenan las tablas del informe). */
export function recortar(texto, maximo = 400) {
  const limpio = limpiarTexto(texto);
  return limpio.length <= maximo ? limpio : `${limpio.slice(0, maximo - 1).trimEnd()}…`;
}

export const fechaHora = (d) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

const t = limpiarTexto;

/** Pasa a una página nueva si `alto` mm no caben en la actual. `ctx` lleva `doc` y la posición vertical `y`. */
export function espacio(ctx, alto) {
  if (ctx.y + alto > PAGINA.alto - PAGINA.margenInferior) {
    ctx.doc.addPage();
    ctx.y = PAGINA.margenSuperior;
  }
}

/** Título de sección; reserva `reservar` mm para que no quede solo al final de una página. */
export function titulo(ctx, texto, reservar = 32) {
  espacio(ctx, reservar);
  const { doc } = ctx;
  doc.setFont('helvetica', 'bold').setFontSize(11).setTextColor(AZUL_OSCURO);
  doc.text(t(texto), PAGINA.margen, ctx.y + 4);
  doc.setDrawColor(AZUL).setLineWidth(0.4).line(PAGINA.margen, ctx.y + 6, PAGINA.margen + ANCHO_UTIL, ctx.y + 6);
  doc.setTextColor(TEXTO);
  ctx.y += 9;
}

export function parrafo(ctx, texto, { negrita = false, tamano = 9.5, color = TEXTO } = {}) {
  const { doc } = ctx;
  doc.setFont('helvetica', negrita ? 'bold' : 'normal').setFontSize(tamano).setTextColor(color);
  const lineas = doc.splitTextToSize(t(texto), ANCHO_UTIL);
  const alto = lineas.length * (tamano * 0.4) + 1.5;
  espacio(ctx, alto);
  doc.text(lineas, PAGINA.margen, ctx.y + tamano * 0.35);
  ctx.y += alto;
}

/**
 * Encabezado (desde la página 2) y pie con formato, "Página X de Y" y fecha de generación en todas las páginas.
 * `encabezado` es el texto de la derecha en las páginas de continuación.
 */
export function pieYEncabezados(doc, { organizacion, encabezado, formato, version, generado }) {
  const total = doc.getNumberOfPages();
  const cuando = fechaHora(generado ?? new Date());
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    if (i > 1) {
      doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(GRIS);
      doc.text(t(organizacion), PAGINA.margen, 11);
      doc.text(t(encabezado), PAGINA.ancho - PAGINA.margen, 11, { align: 'right', maxWidth: 110 });
      doc.setDrawColor('#C9D2DB').setLineWidth(0.2).line(PAGINA.margen, 13, PAGINA.margen + ANCHO_UTIL, 13);
    }
    const yPie = PAGINA.alto - 10;
    doc.setDrawColor('#C9D2DB').setLineWidth(0.2).line(PAGINA.margen, yPie - 4, PAGINA.margen + ANCHO_UTIL, yPie - 4);
    doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(GRIS);
    doc.text(t(`${formato} · versión ${version}`), PAGINA.margen, yPie);
    doc.text(`Página ${i} de ${total}`, PAGINA.ancho / 2, yPie, { align: 'center' });
    doc.text(`Generado: ${cuando}`, PAGINA.ancho - PAGINA.margen, yPie, { align: 'right' });
  }
}

/** Opciones de tabla comunes (tipografía, bordes y márgenes). */
export function estiloTabla(extra = {}) {
  return {
    theme: 'grid',
    styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 1.6, lineColor: '#C9D2DB', lineWidth: 0.2, textColor: TEXTO, valign: 'top' },
    headStyles: { fillColor: AZUL, textColor: '#FFFFFF', fontStyle: 'bold' },
    margin: { left: PAGINA.margen, right: PAGINA.margen, top: PAGINA.margenSuperior, bottom: PAGINA.margenInferior },
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// Librerías y recursos en el navegador
// ---------------------------------------------------------------------------

/** Carga jsPDF y el plugin autotable (locales). Devuelve el constructor jsPDF. */
export async function cargarJsPDF() {
  if (!window.jspdf?.jsPDF) await cargarScript('lib/jspdf.umd.min.js');
  const { jsPDF } = window.jspdf;
  if (typeof jsPDF.API.autoTable !== 'function') {
    if (typeof window.applyPlugin !== 'function') await cargarScript('lib/jspdf.plugin.autotable.min.js');
    window.applyPlugin(jsPDF); // la versión UMD de autotable no se aplica sola
  }
  return jsPDF;
}

/** Logo institucional como bytes PNG con sus dimensiones; null si no se puede leer (el PDF sale igual). */
export async function cargarLogo() {
  try {
    const r = await fetch('assets/logo.png');
    const bytes = new Uint8Array(await r.arrayBuffer());
    const mapa = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const logo = { bytes, ancho: mapa.width, alto: mapa.height };
    mapa.close?.();
    return logo;
  } catch {
    return null;
  }
}
