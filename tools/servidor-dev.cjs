// Servidor estático mínimo solo para desarrollo local (sin caché), escucha únicamente en 127.0.0.1.
// Uso: node tools/servidor-dev.cjs [puerto]
// Para revisar PDFs generados en el navegador acepta PUT /__salida/<nombre> y los guarda en tools/salida-dev/.
const http = require('http');
const fs = require('fs');
const path = require('path');
const raiz = path.resolve(__dirname, '..');
const salida = path.join(__dirname, "salida-dev");
const tipos = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.pdf': 'application/pdf' };
http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (req.method === 'PUT' && url.startsWith('/__salida/')) {
    const nombre = path.basename(url);
    fs.mkdirSync(salida, { recursive: true });
    const partes = [];
    req.on('data', (c) => partes.push(c));
    req.on('end', () => { fs.writeFileSync(path.join(salida, nombre), Buffer.concat(partes)); res.writeHead(204); res.end(); });
    return;
  }
  let ruta = url.endsWith('/') ? url + 'index.html' : url;
  const archivo = path.join(raiz, ruta);
  if (!archivo.startsWith(raiz)) { res.writeHead(403); return res.end(); }
  fs.readFile(archivo, (err, datos) => {
    if (err) { res.writeHead(404); return res.end('no encontrado'); }
    res.writeHead(200, { 'Content-Type': tipos[path.extname(archivo)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(datos);
  });
}).listen(Number(process.argv[2]) || 8123, '127.0.0.1', () => console.log('Sirviendo en http://127.0.0.1:' + (process.argv[2] || 8123)));
