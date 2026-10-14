// Captura y compresión de fotos, y guardado en IndexedDB.
import * as db from './db.js';
import { ahoraISO } from './util.js';
import { MAX_FOTOS_POR_ITEM, FOTO_LADO_MAX, FOTO_CALIDAD, MINIATURA_LADO, MINIATURA_CALIDAD, ALMACENAMIENTO_AVISO } from './config.js';

/** Decodifica la imagen respetando la orientación EXIF. Si el navegador no puede, devuelve null. */
async function decodificar(archivo) {
  try {
    return await createImageBitmap(archivo, { imageOrientation: 'from-image' });
  } catch {
    /* algunos navegadores no aceptan las opciones: se prueba sin ellas y luego con <img> */
  }
  try {
    return await createImageBitmap(archivo);
  } catch {
    /* sigue */
  }
  return new Promise((ok) => {
    const url = URL.createObjectURL(archivo);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      ok(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      ok(null);
    };
    img.src = url;
  });
}

const tamano = (fuente) => ({ ancho: fuente.naturalWidth || fuente.width, alto: fuente.naturalHeight || fuente.height });

const aBlob = (canvas, calidad) =>
  new Promise((ok, fallo) => canvas.toBlob((b) => (b ? ok(b) : fallo(new Error('No se pudo comprimir la imagen'))), 'image/jpeg', calidad));

/** Dibuja `fuente` reducida al lado mayor `lado` sobre fondo blanco (un PNG con transparencia no debe quedar negro). */
function dibujarReducida(fuente, lado) {
  const { ancho, alto } = tamano(fuente);
  const escala = Math.min(1, lado / Math.max(ancho, alto));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(ancho * escala));
  canvas.height = Math.max(1, Math.round(alto * escala));
  const g = canvas.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.drawImage(fuente, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** Libera la memoria del canvas de inmediato (iOS limita la memoria total de canvas). */
const liberar = (canvas) => {
  canvas.width = 0;
  canvas.height = 0;
};

/**
 * Procesa un archivo de imagen: foto con el lado mayor limitado y JPEG comprimido, más una miniatura.
 * Devuelve { blob, ancho, alto, miniatura }. Lanza un Error con mensaje en español si no se puede leer.
 */
export async function procesarImagen(archivo, { lado = FOTO_LADO_MAX, calidad = FOTO_CALIDAD } = {}) {
  const fuente = await decodificar(archivo);
  if (!fuente) throw new Error('No se pudo leer la imagen. Pruebe con otra foto en formato JPEG o PNG.');
  let grande;
  try {
    grande = dibujarReducida(fuente, lado);
    const blob = await aBlob(grande, calidad);
    const pequena = dibujarReducida(grande, MINIATURA_LADO);
    const miniatura = await aBlob(pequena, MINIATURA_CALIDAD);
    liberar(pequena);
    return { blob, ancho: grande.width, alto: grande.height, miniatura };
  } finally {
    if (grande) liberar(grande);
    fuente.close?.();
  }
}

/**
 * Reduce una foto ya guardada (Blob JPEG) para insertarla en un PDF: lado mayor y calidad indicados.
 * Devuelve { bytes (Uint8Array JPEG), ancho, alto }. Se procesa de una en una desde el llamador.
 */
export async function reducirFoto(blob, { lado, calidad }) {
  const fuente = await decodificar(blob);
  if (!fuente) throw new Error('No se pudo leer una de las fotos guardadas.');
  let canvas;
  try {
    canvas = dibujarReducida(fuente, lado);
    const reducida = await aBlob(canvas, calidad);
    return { bytes: new Uint8Array(await reducida.arrayBuffer()), ancho: canvas.width, alto: canvas.height };
  } finally {
    if (canvas) liberar(canvas);
    fuente.close?.();
  }
}

/**
 * Procesa y guarda una foto del ítem. Primero se guarda la foto y luego la referencia en la respuesta
 * (el llamador guarda la evaluación); si la app se cierra en medio, la foto se reconecta al abrir la evaluación.
 */
export async function agregarFoto(ev, codigoItem, archivo) {
  const respuesta = ev.respuestas.find((r) => r.codigo === codigoItem);
  if (!respuesta) throw new Error(`Ítem desconocido: ${codigoItem}`);
  if (respuesta.foto_ids.length >= MAX_FOTOS_POR_ITEM) throw new Error(`Cada ítem admite como máximo ${MAX_FOTOS_POR_ITEM} fotos.`);
  const { blob, ancho, alto, miniatura } = await procesarImagen(archivo);
  const foto = db.crearEntidad({ evaluacion_id: ev.id, codigo_item: codigoItem, blob, miniatura, ancho, alto, fecha: ahoraISO() });
  await db.guardar('fotos', foto);
  respuesta.foto_ids.push(foto.id);
  return foto;
}

/** Mensaje de advertencia si el almacenamiento usado supera el umbral de la cuota; si no, null. */
export async function avisoAlmacenamiento() {
  const { usado, cuota } = await db.infoAlmacenamiento();
  if (usado == null || !cuota || usado / cuota < ALMACENAMIENTO_AVISO) return null;
  return `El almacenamiento del dispositivo está al ${Math.round((usado / cuota) * 100)} %. Exporte y libere espacio pronto.`;
}
