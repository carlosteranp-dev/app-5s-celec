// Service worker: la app funciona sin conexión.
// - App, /lib y /assets: cache-first desde una caché versionada.
// - instrumento_5S.json: stale-while-revalidate (sale de la caché y se actualiza en segundo plano; avisa si cambió).
// - Una versión nueva queda en espera hasta que la persona toca "Actualizar" (no se recarga a mitad de una evaluación).
// El bloque SELLO lo escribe `node tools/sellar.mjs`; no lo edite a mano.

// <SELLO>
const VERSION = '19a163f33992';
const PRECACHE = [
  'assets/apple-touch-icon.png',
  'assets/icon-192.png',
  'assets/icon-512.png',
  'assets/icon-maskable-512.png',
  'assets/logo.png',
  'catalogo_sitios.json',
  'css/app.css',
  'index.html',
  'instrumento_5S.json',
  'js/app.js',
  'js/calc.js',
  'js/catalogo.js',
  'js/charts.js',
  'js/config.js',
  'js/contexto.js',
  'js/db.js',
  'js/entrega.js',
  'js/excel.js',
  'js/export.js',
  'js/firmas.js',
  'js/informe.js',
  'js/instrumento.js',
  'js/pdf-comun.js',
  'js/pdf-informe.js',
  'js/pdf.js',
  'js/photos.js',
  'js/pwa.js',
  'js/respaldo.js',
  'js/ui.js',
  'js/util.js',
  'js/views/area.js',
  'js/views/borradores.js',
  'js/views/evaluacion.js',
  'js/views/informes.js',
  'js/views/inicio.js',
  'js/views/nueva.js',
  'js/views/perfil.js',
  'js/views/respaldo.js',
  'js/views/resumen.js',
  'js/views/sitios.js',
  'js/xlsx.js',
  'lib/chart.umd.min.js',
  'lib/jspdf.plugin.autotable.min.js',
  'lib/jspdf.umd.min.js',
  'manifest.webmanifest',
];
// </SELLO>

const CACHE = `5s-app-${VERSION}`;
const PREFIJO_CACHE = '5s-app-';
const INSTRUMENTO = 'instrumento_5S.json';

self.addEventListener('install', (evento) => {
  // `cache: 'reload'` se salta la caché HTTP (GitHub Pages guarda archivos unos minutos) para que la versión sea coherente.
  evento.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE.map((ruta) => new Request(ruta, { cache: 'reload' })))));
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    (async () => {
      const nombres = await caches.keys();
      await Promise.all(nombres.filter((n) => n.startsWith(PREFIJO_CACHE) && n !== CACHE).map((n) => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (evento) => {
  if (evento.data?.tipo === 'SALTAR_ESPERA') self.skipWaiting();
});

self.addEventListener('fetch', (evento) => {
  const { request } = evento;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    // El enrutador es por hash: toda navegación abre la misma página.
    evento.respondWith(caches.match('index.html', { ignoreSearch: true }).then((r) => r || fetch(request)));
  } else if (url.pathname.endsWith(`/${INSTRUMENTO}`)) {
    evento.respondWith(instrumentoSWR(evento));
  } else {
    evento.respondWith(cacheFirst(request));
  }
});

async function cacheFirst(request) {
  const guardada = await caches.match(request, { ignoreSearch: true });
  if (guardada) return guardada;
  const respuesta = await fetch(request);
  if (respuesta.ok) (await caches.open(CACHE)).put(request, respuesta.clone());
  return respuesta;
}

/** Responde con la copia guardada y revisa en segundo plano si el instrumento cambió. */
async function instrumentoSWR(evento) {
  const cache = await caches.open(CACHE);
  const guardada = await cache.match(INSTRUMENTO, { ignoreSearch: true });
  // La respuesta guardada se entrega a la página (su cuerpo se consume); para comparar se usa una copia hecha ahora.
  const paraComparar = guardada ? guardada.clone() : null;
  const revisar = fetch(INSTRUMENTO, { cache: 'no-cache' })
    .then(async (nueva) => {
      if (!nueva.ok) return;
      const [textoNuevo, textoViejo] = await Promise.all([nueva.clone().text(), paraComparar ? paraComparar.text() : null]);
      if (textoNuevo === textoViejo) return;
      await cache.put(INSTRUMENTO, nueva);
      if (guardada) {
        const clientes = await self.clients.matchAll({ type: 'window' });
        clientes.forEach((c) => c.postMessage({ tipo: 'instrumento-actualizado' }));
      }
    })
    .catch(() => {}); // sin conexión: se sigue con la copia guardada
  evento.waitUntil(revisar);
  return guardada ?? (await fetch(INSTRUMENTO, { cache: 'no-cache' }));
}
