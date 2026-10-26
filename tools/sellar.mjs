// Sella el service worker: escribe en sw.js la lista de archivos a precargar y una versión de caché
// calculada con el contenido de la app. Ejecútelo antes de publicar:  node tools/sellar.mjs
// `node tools/sellar.mjs --comprobar` solo verifica (sale con error si hace falta sellar; lo usa `npm test`).
// instrumento_5S.json se precarga pero no cuenta para la versión: se actualiza solo (stale-while-revalidate).
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const INICIO = '// <SELLO>';
const FIN = '// </SELLO>';
const INSTRUMENTO = 'instrumento_5S.json';

function listar(carpeta, filtro) {
  return readdirSync(join(RAIZ, carpeta), { withFileTypes: true }).flatMap((e) => {
    const ruta = join(carpeta, e.name);
    if (e.isDirectory()) return listar(ruta, filtro);
    return filtro(e.name) ? [ruta.split(sep).join('/')] : [];
  });
}

/** Archivos que la app necesita sin conexión (rutas relativas a la raíz, ordenadas). */
export function archivosDeLaApp() {
  return [
    'index.html',
    'manifest.webmanifest',
    INSTRUMENTO,
    'catalogo_sitios.json',
    ...listar('css', (n) => n.endsWith('.css')),
    ...listar('js', (n) => n.endsWith('.js')),
    ...listar('lib', (n) => n.endsWith('.js')),
    ...listar('assets', (n) => n.endsWith('.png')),
  ].sort();
}

/** Versión de caché: hash corto del contenido (y nombres) de los archivos, sin el instrumento. */
export function calcularVersion(archivos = archivosDeLaApp()) {
  const h = createHash('sha256');
  for (const a of archivos.filter((x) => x !== INSTRUMENTO)) {
    h.update(a);
    h.update(readFileSync(join(RAIZ, a)));
  }
  return h.digest('hex').slice(0, 12);
}

export function bloqueSello(archivos = archivosDeLaApp()) {
  const lista = archivos.map((a) => `  '${a}',`).join('\n');
  return `${INICIO}\nconst VERSION = '${calcularVersion(archivos)}';\nconst PRECACHE = [\n${lista}\n];\n${FIN}`;
}

/** Bloque SELLO que tiene hoy sw.js. */
export function bloqueActual(texto = readFileSync(join(RAIZ, 'sw.js'), 'utf8')) {
  const a = texto.indexOf(INICIO);
  const b = texto.indexOf(FIN);
  if (a < 0 || b < 0) throw new Error('sw.js no tiene el bloque SELLO.');
  return texto.slice(a, b + FIN.length);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const texto = readFileSync(join(RAIZ, 'sw.js'), 'utf8');
  const nuevo = bloqueSello();
  if (process.argv.includes('--comprobar')) {
    if (bloqueActual(texto) !== nuevo) {
      console.error('sw.js no está sellado con el contenido actual. Ejecute: node tools/sellar.mjs');
      process.exit(1);
    }
    console.log('sw.js está sellado.');
  } else {
    writeFileSync(join(RAIZ, 'sw.js'), texto.replace(bloqueActual(texto), nuevo));
    console.log(`sw.js sellado: versión ${calcularVersion()}, ${archivosDeLaApp().length} archivos.`);
  }
}
