// Inicio: perfil, botones grandes, recordatorio de exportar, instalación e indicadores.
import * as db from '../db.js';
import { ctx } from '../contexto.js';
import { esc, formatoTamano } from '../util.js';
import { estadoPWA, esIOS, estaInstalada, pedirInstalacion } from '../pwa.js';

const DIAS_RECORDATORIO = 7;
const mb = formatoTamano;

/** Días enteros desde una fecha ISO hasta hoy (null si no hay fecha). */
const diasDesde = (iso) => (iso ? Math.floor((Date.now() - Date.parse(iso)) / 86400000) : null);

/** Tarjeta para instalar la app, según el dispositivo. Vacía si ya está instalada. */
function tarjetaInstalacion() {
  if (estaInstalada()) return '';
  if (!window.isSecureContext) {
    return '<div class="aviso"><strong>Instalar y usar sin conexión</strong><br>Abra la app desde su dirección segura (HTTPS) para poder instalarla y usarla sin internet.</div>';
  }
  if (esIOS()) {
    return `<div class="aviso"><strong>Instale la app en su iPhone</strong>
      <ol style="margin:.4rem 0 0;padding-left:1.2rem">
        <li>Toque el botón <strong>Compartir</strong> de Safari.</li>
        <li>Elija <strong>Agregar a pantalla de inicio</strong>.</li>
        <li>Abra siempre la app desde ese ícono.</li>
      </ol>
      <small>Safari y la app instalada guardan sus datos por separado, y Safari puede borrar los de un sitio que no se usa en 7 días. Use solo la app instalada y exporte sus evaluaciones con frecuencia.</small></div>`;
  }
  if (estadoPWA.instalable) {
    return '<div class="aviso fila fila--entre"><span class="crece"><strong>Instale la app</strong><br><small>Se abre sin la barra del navegador y funciona sin conexión.</small></span><button type="button" class="btn btn--chico btn--primario" data-instalar>Instalar</button></div>';
  }
  return '<div class="aviso"><strong>Instale la app</strong><br><small>En el menú del navegador (⋮) elija <strong>Instalar aplicación</strong> o <strong>Agregar a la pantalla de inicio</strong>.</small></div>';
}

export async function render(cont) {
  const perfil = await db.obtenerConfig('perfil');
  if (!perfil) {
    location.replace('#/perfil');
    return;
  }
  const [evaluaciones, pendientesExportar, almacenamiento, ultimaExportacion] = await Promise.all([db.todos('evaluaciones'), db.contarPendientesExportar(), db.infoAlmacenamiento(), db.obtenerConfig('ultima_exportacion')]);
  const borradores = evaluaciones.filter((e) => e.estado === 'borrador').length;
  const meta = ctx.instrumento.meta;
  const almacen = almacenamiento.usado == null ? '' : `Almacenamiento: ${mb(almacenamiento.usado)} usados${almacenamiento.persistente === false ? ' · no protegido contra borrado automático' : ''}`;

  // Recordatorio: hay evaluaciones sin exportar y hace tiempo que no se exporta.
  const dias = diasDesde(ultimaExportacion);
  const recordar = pendientesExportar > 0 && (dias === null || dias >= DIAS_RECORDATORIO);
  const textoRecordatorio = `Tiene <strong>${pendientesExportar} evaluación${pendientesExportar === 1 ? '' : 'es'} sin exportar</strong>${dias === null ? ' y todavía no ha hecho ningún respaldo' : ` y su último respaldo fue hace ${dias} días`}.`;

  const lineaConexion = () =>
    estadoPWA.listaSinConexion ? '<span class="estado-conexion estado-conexion--lista">Lista para usar sin conexión</span>' : '<span class="estado-conexion">Sin conexión aún no disponible</span>';

  cont.innerHTML = `
    <div class="portada">
      <img src="assets/logo.png" alt="CELEC EP – Corporación Eléctrica del Ecuador" width="260" height="98">
      <h1>Evaluación 5S</h1>
      <p>${esc(meta.organizacion)}</p>
    </div>
    <div class="contenido pila">
      <div class="tarjeta fila fila--entre">
        <div class="crece"><strong>${esc(perfil.nombre)}</strong><br><small>${esc(perfil.cargo)}</small></div>
        <a class="btn btn--chico" href="#/perfil">Editar</a>
      </div>
      ${ctx.advertencias.map((a) => `<div class="aviso">${esc(a)}</div>`).join('')}
      ${recordar ? `<div class="aviso fila fila--entre"><span class="crece">${textoRecordatorio}</span><a class="btn btn--chico btn--primario" href="#/respaldo">Exportar</a></div>` : ''}
      <nav class="menu" aria-label="Menú principal">
        <a class="btn btn--primario" href="#/nueva">Nueva evaluación</a>
        <a class="btn" href="#/borradores">Continuar borradores ${borradores ? `<span class="insignia">${borradores}</span>` : ''}</a>
        <a class="btn" href="#/sitios">Sitios y áreas</a>
        <a class="btn" href="#/informes">Informes</a>
        <a class="btn" href="#/respaldo">Respaldo ${pendientesExportar ? `<span class="insignia" title="Evaluaciones pendientes de exportar">${pendientesExportar}</span>` : ''}</a>
      </nav>
      <div data-instalacion>${tarjetaInstalacion()}</div>
      <p class="suave" style="text-align:center">
        Instrumento ${esc(meta.codigo_formato)} · versión ${esc(meta.version)}<br>
        <span data-conexion>${lineaConexion()}</span><br>
        ${esc(almacen)}
      </p>
    </div>`;

  cont.addEventListener('click', async (e) => {
    if (e.target.closest('[data-instalar]')) await pedirInstalacion();
  });

  // El estado del service worker puede cambiar mientras se ve esta pantalla (primera instalación).
  const alCambiarPWA = () => {
    cont.querySelector('[data-conexion]').innerHTML = lineaConexion();
    cont.querySelector('[data-instalacion]').innerHTML = tarjetaInstalacion();
  };
  window.addEventListener('5s:pwa', alCambiarPWA);
  return () => window.removeEventListener('5s:pwa', alCambiarPWA);
}
