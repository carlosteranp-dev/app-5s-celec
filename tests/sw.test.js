import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { archivosDeLaApp, bloqueActual, bloqueSello, calcularVersion } from '../tools/sellar.mjs';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const leer = (ruta) => readFileSync(join(RAIZ, ruta), 'utf8');

test('sw.js está sellado con el contenido actual (si falla: node tools/sellar.mjs)', () => {
  assert.equal(bloqueActual(), bloqueSello(), 'sw.js no coincide con los archivos de la app; ejecute "node tools/sellar.mjs" antes de publicar');
});

test('la lista de precarga cubre todos los módulos, estilos, librerías, íconos y el instrumento', () => {
  const lista = archivosDeLaApp();
  for (const esperado of ['index.html', 'manifest.webmanifest', 'instrumento_5S.json', 'css/app.css', 'js/app.js', 'js/pwa.js', 'js/views/respaldo.js', 'lib/jspdf.umd.min.js', 'lib/jspdf.plugin.autotable.min.js', 'lib/chart.umd.min.js', 'assets/logo.png', 'assets/icon-192.png', 'assets/icon-512.png']) {
    assert.ok(lista.includes(esperado), `falta en la precarga: ${esperado}`);
  }
  assert.ok(!lista.some((a) => a.endsWith('.pdf')), 'el PDF del logo no debe precargarse');
  for (const a of lista) assert.ok(existsSync(join(RAIZ, a)), `${a} está en la lista pero no existe`);
});

test('cada import estático o dinámico apunta a un archivo que se precarga', () => {
  const lista = new Set(archivosDeLaApp());
  const importes = [];
  const recorrer = (carpeta) => {
    for (const e of readdirSync(join(RAIZ, carpeta), { withFileTypes: true })) {
      const ruta = `${carpeta}/${e.name}`;
      if (e.isDirectory()) recorrer(ruta);
      else if (e.name.endsWith('.js')) {
        const texto = leer(ruta);
        for (const m of texto.matchAll(/(?:from\s+|import\s*\(\s*)['"](\.{1,2}\/[^'"?]+)['"]/g)) importes.push([ruta, m[1]]);
      }
    }
  };
  recorrer('js');
  assert.ok(importes.length > 40);
  for (const [origen, destino] of importes) {
    const resuelto = posix.join(origen, '..', destino); // las rutas del proyecto usan "/" en cualquier sistema
    assert.ok(lista.has(resuelto), `${origen} importa ${destino}, que no está en la precarga`);
  }
});

test('index.html y el manifiesto apuntan a archivos que existen (y se precargan)', () => {
  const lista = new Set(archivosDeLaApp());
  const html = leer('index.html');
  for (const m of html.matchAll(/(?:href|src)="([^"#]+)"/g)) {
    if (/^https?:/.test(m[1])) assert.fail(`index.html usa un recurso externo: ${m[1]}`);
    assert.ok(lista.has(m[1]), `index.html referencia ${m[1]}, que no se precarga`);
  }
  const manifiesto = JSON.parse(leer('manifest.webmanifest'));
  assert.equal(manifiesto.display, 'standalone');
  assert.equal(manifiesto.start_url, './');
  for (const icono of manifiesto.icons) assert.ok(lista.has(icono.src), `el manifiesto usa ${icono.src}`);
  assert.ok(manifiesto.icons.some((i) => i.sizes === '192x192') && manifiesto.icons.some((i) => i.sizes === '512x512'));
  assert.ok(manifiesto.icons.some((i) => i.purpose === 'maskable'));
});

test('la versión de caché no depende del instrumento (editarlo no obliga a sellar) y cambia con cualquier otro archivo', () => {
  const sinInstrumento = archivosDeLaApp().filter((a) => a !== 'instrumento_5S.json');
  assert.equal(calcularVersion(archivosDeLaApp()), calcularVersion(sinInstrumento));
  assert.match(calcularVersion(), /^[0-9a-f]{12}$/);
});

test('sw.js es JavaScript válido y define las estrategias esperadas', () => {
  const texto = leer('sw.js');
  assert.doesNotThrow(() => new vm.Script(texto, { filename: 'sw.js' }));
  for (const clave of ['install', 'activate', 'fetch', 'SALTAR_ESPERA', 'instrumentoSWR', "cache: 'reload'", 'clients.claim']) assert.ok(texto.includes(clave), `sw.js no contiene ${clave}`);
  assert.ok(!/skipWaiting\(\);\s*\n\s*\}\);\s*\n\s*self\.addEventListener\('activate'/.test(texto), 'el service worker no debe saltar la espera por su cuenta al instalarse');
  assert.ok(!/addEventListener\('install'[\s\S]{0,400}skipWaiting/.test(texto), 'skipWaiting solo debe ocurrir por mensaje de la página');
});
