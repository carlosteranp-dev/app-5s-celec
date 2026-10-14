// Utilidades generales sin dependencias del resto de la app.

/** UUID v4. crypto.randomUUID solo existe en contextos seguros (HTTPS/localhost); en HTTP de la red local se usa getRandomValues. */
export function uuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0'));
  return `${h.slice(0, 4).join('')}-${h.slice(4, 6).join('')}-${h.slice(6, 8).join('')}-${h.slice(8, 10).join('')}-${h.slice(10).join('')}`;
}

/** Marca de tiempo ISO 8601 (UTC) para creado/modificado. */
export const ahoraISO = () => new Date().toISOString();

/** Fecha local (sin hora) como AAAA-MM-DD. Ecuador no tiene horario de verano. */
export function hoyLocal(fecha = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${fecha.getFullYear()}-${p(fecha.getMonth() + 1)}-${p(fecha.getDate())}`;
}

/** AAAA-MM-DD → DD/MM/AAAA */
export function fechaCorta(iso) {
  if (!iso) return '';
  const [a, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
}

/** Escapa texto para insertarlo en HTML. */
export function esc(valor) {
  return String(valor ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/** Quita tildes y caracteres no seguros para un nombre de archivo (sin espacios). */
export function nombreSeguro(texto) {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** Texto normalizado para comparar nombres (sin tildes, minúsculas, espacios simples). */
export function normalizarNombre(texto) {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Color de texto (blanco o casi negro) con mejor contraste sobre un fondo hexadecimal. */
export function colorTextoSobre(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return '#1B2733';
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255);
  const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const luminancia = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  const contrasteBlanco = 1.05 / (luminancia + 0.05);
  const contrasteNegro = (luminancia + 0.05) / 0.0693; // #1B2733 tiene luminancia ≈ 0.019
  return contrasteBlanco >= contrasteNegro ? '#FFFFFF' : '#1B2733';
}

/**
 * Ejecuta `fn` tras `ms` de calma. `vaciar()` ejecuta ya lo pendiente y devuelve su promesa
 * (se usa al salir de la pantalla para no perder el último cambio).
 */
export function diferido(fn, ms = 350) {
  let temporizador = null;
  let pendiente = false;
  let enCurso = Promise.resolve();
  const ejecutar = () => {
    temporizador = null;
    pendiente = false;
    enCurso = enCurso.then(() => fn());
    return enCurso;
  };
  return {
    programar() {
      pendiente = true;
      clearTimeout(temporizador);
      temporizador = setTimeout(ejecutar, ms);
    },
    vaciar() {
      clearTimeout(temporizador);
      return pendiente ? ejecutar() : enCurso;
    },
  };
}

/** Copia profunda de datos simples (JSON). */
export const clonar = (x) => JSON.parse(JSON.stringify(x));

/** Carga un script local una sola vez (jsPDF, Chart.js…) y espera a que esté listo. */
const scriptsCargados = new Map();
export function cargarScript(src) {
  if (!scriptsCargados.has(src)) {
    scriptsCargados.set(
      src,
      new Promise((ok, fallo) => {
        const el = document.createElement('script');
        el.src = src;
        el.onload = ok;
        el.onerror = () => {
          scriptsCargados.delete(src);
          fallo(new Error(`No se pudo cargar ${src}. Abra la app con conexión al menos una vez.`));
        };
        document.head.append(el);
      }),
    );
  }
  return scriptsCargados.get(src);
}

/** Tamaño legible: "340 KB" o "4,1 MB" (coma decimal). */
export function formatoTamano(bytes) {
  if (bytes < 1048576) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  const mb = bytes / 1048576;
  return `${mb.toFixed(mb < 10 ? 1 : 0).replace('.', ',')} MB`;
}
