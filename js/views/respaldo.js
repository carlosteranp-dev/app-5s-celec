// Respaldo: exportar, importar y consolidar entre dispositivos, Excel y estado del almacenamiento.
import * as db from '../db.js';
import { aplicarImportacion, estimarRespaldo, exportarRespaldo, leerArchivoRespaldo, registrarExportacion } from '../export.js';
import { planificarImportacion, validarArchivo } from '../respaldo.js';
import { esc, fechaCorta, formatoTamano } from '../util.js';
import { barraSuperior, confirmar, toast } from '../ui.js';
import { dialogoEntrega, dialogoProgreso } from '../entrega.js';
import { estadoPWA } from '../pwa.js';

const MB = 1024 * 1024;
const AVISO_PESADO = 50 * MB;
const TABLAS = [['sitios', 'Sitios'], ['areas', 'Áreas'], ['evaluaciones', 'Evaluaciones'], ['acciones', 'Acciones'], ['fotos', 'Fotos'], ['instrumentos', 'Instrumentos']];
const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;
const mbTexto = formatoTamano;
const fechaHoraCorta = (iso) => (iso ? `${fechaCorta(iso)} ${new Date(iso).toTimeString().slice(0, 5)}` : '—');

export async function render(cont) {
  const [pendientes, ultima, registro, almacen] = await Promise.all([db.contarPendientesExportar(), db.obtenerConfig('ultima_exportacion'), db.obtenerConfig('importaciones'), db.infoAlmacenamiento()]);

  cont.innerHTML = `
    ${barraSuperior('Respaldo', '#/')}
    <div class="contenido pila">
      <section class="tarjeta" data-exportar-tarjeta>
        <h2>Exportar respaldo</h2>
        <p data-estado-export></p>
        <label class="casilla"><input type="checkbox" name="pendientes" ${pendientes ? 'checked' : ''}> Solo las evaluaciones no exportadas</label>
        <label class="casilla"><input type="checkbox" name="borradores"> Incluir borradores (respaldo completo)</label>
        <label class="casilla"><input type="checkbox" name="catalogo"> Solo el catálogo de sitios y áreas</label>
        <p class="suave" data-estimado aria-live="polite"></p>
        <button type="button" class="btn btn--primario btn--bloque" data-exportar>Exportar respaldo</button>
      </section>

      <section class="tarjeta">
        <h2>Importar respaldo</h2>
        <p class="suave">Seleccione el archivo <strong>.json</strong> que envió otro evaluador. Antes de guardar nada verá un resumen y podrá cancelar.</p>
        <label class="btn btn--bloque"><input type="file" accept=".json,application/json" hidden data-archivo>Elegir archivo…</label>
        <div data-importacion class="pila" style="margin-top:.85rem"></div>
      </section>

      <section class="tarjeta">
        <h2>Exportar a Excel</h2>
        <p class="suave">Una hoja por módulo, con una fila por evaluación cerrada y columnas por S y por ítem.</p>
        <button type="button" class="btn btn--bloque" data-excel>Exportar a Excel</button>
      </section>

      <section class="tarjeta">
        <h2>Importaciones recientes</h2>
        ${
          registro?.length
            ? `<ul class="lista registro-importaciones">${registro
                .map((r) => `<li><strong>${esc(r.archivo)}</strong><br><small>${fechaHoraCorta(r.fecha)}${r.evaluador ? ` · de ${esc(r.evaluador)}` : ''} · ${plural(r.resumen?.evaluaciones?.nuevos ?? 0, 'evaluación nueva', 'evaluaciones nuevas')}, ${plural(r.resumen?.fotos?.nuevos ?? 0, 'foto nueva', 'fotos nuevas')}</small></li>`)
                .join('')}</ul>`
            : '<p class="suave">Todavía no se importó ningún archivo en este dispositivo.</p>'
        }
      </section>

      <section class="tarjeta">
        <h2>Este dispositivo</h2>
        <p class="estado-conexion ${estadoPWA.listaSinConexion ? 'estado-conexion--lista' : ''}" data-estado-pwa>${estadoPWA.listaSinConexion ? 'Lista para usar sin conexión' : 'Sin conexión: aún no disponible (abra la app una vez con internet)'}</p>
        <p class="suave">${almacen.usado != null ? `Almacenamiento: ${mbTexto(almacen.usado)} usados${almacen.persistente ? ' · protegido contra borrado automático' : almacen.persistente === false ? ' · el navegador podría borrar los datos si falta espacio' : ''}.` : ''}</p>
      </section>
    </div>`;

  const q = (s) => cont.querySelector(s);
  const exportar = q('[data-exportar-tarjeta]');
  const cajas = { pendientes: exportar.querySelector('[name=pendientes]'), borradores: exportar.querySelector('[name=borradores]'), catalogo: exportar.querySelector('[name=catalogo]') };
  const botonExportar = q('[data-exportar]');

  // --- Exportar ---------------------------------------------------------------

  const leerOpciones = () => ({ soloPendientes: cajas.pendientes.checked, incluirBorradores: cajas.borradores.checked, soloCatalogo: cajas.catalogo.checked });

  async function actualizarEstadoExportacion() {
    const n = await db.contarPendientesExportar();
    q('[data-estado-export]').innerHTML = `${n ? `<strong>${plural(n, 'evaluación cerrada', 'evaluaciones cerradas')}</strong> con cambios sin exportar.` : 'No hay evaluaciones con cambios sin exportar.'} <small>Última exportación: ${ultimaTexto()}</small>`;
  }
  const ultimaTexto = () => (ultimaFecha ? fechaHoraCorta(ultimaFecha) : 'nunca');
  let ultimaFecha = ultima;

  async function actualizarEstimado() {
    cajas.pendientes.disabled = cajas.borradores.disabled = cajas.catalogo.checked;
    const opciones = leerOpciones();
    const est = await estimarRespaldo(opciones);
    const vacio = !opciones.soloCatalogo && est.evaluaciones === 0;
    botonExportar.disabled = vacio;
    q('[data-estimado]').innerHTML = opciones.soloCatalogo
      ? 'Se exportarán solo los sitios y áreas, para repartirlos a los evaluadores.'
      : vacio
        ? 'No hay evaluaciones para exportar con estas opciones.'
        : `Se exportarán ${plural(est.evaluaciones, 'evaluación', 'evaluaciones')} y ${plural(est.fotos, 'foto', 'fotos')} (unos ${mbTexto(est.bytes)}).${est.bytes > AVISO_PESADO ? ' <strong>Es un archivo pesado: para enviarlo use “Solo las evaluaciones no exportadas”.</strong>' : ''}`;
  }

  exportar.addEventListener('change', actualizarEstimado);
  await Promise.all([actualizarEstadoExportacion(), actualizarEstimado()]);

  botonExportar.addEventListener('click', async () => {
    const opciones = leerOpciones();
    botonExportar.disabled = true;
    const progreso = dialogoProgreso('Preparando respaldo');
    try {
      const r = await exportarRespaldo(opciones, { onProgreso: (f, t) => progreso.actualizar(f, t) });
      progreso.cerrar();
      dialogoEntrega({
        blob: r.blob,
        nombre: r.nombre,
        titulo: 'Respaldo listo',
        tipo: 'application/json',
        detalle: `${plural(r.conteos.evaluaciones, 'evaluación', 'evaluaciones')}, ${plural(r.conteos.fotos, 'foto', 'fotos')}`,
        // Compartir no avisa si el archivo llegó a destino: la persona confirma antes de marcar las evaluaciones.
        alCerrar: async () => {
          if (!r.evaluacionIds.length) return;
          const ok = await confirmar({
            titulo: '¿Se guardó o envió el archivo?',
            mensaje: `Si lo guardó o lo envió correctamente, se marcarán ${plural(r.evaluacionIds.length, 'evaluación', 'evaluaciones')} como exportadas. Si no, podrá exportar de nuevo.`,
            aceptar: 'Sí, marcar como exportadas',
          });
          if (!ok) return;
          await registrarExportacion(r.evaluacionIds);
          ultimaFecha = new Date().toISOString();
          toast('Evaluaciones marcadas como exportadas');
          await Promise.all([actualizarEstadoExportacion(), actualizarEstimado()]);
        },
      });
    } catch (e) {
      console.error(e);
      progreso.cerrar();
      toast(`No se pudo exportar: ${e.message}`, 7000);
    } finally {
      await actualizarEstimado();
    }
  });

  // --- Importar ---------------------------------------------------------------

  const zonaImportacion = q('[data-importacion]');
  let archivoActual = null; // respaldo ya leído, en memoria hasta confirmar o cancelar
  let nombreArchivo = '';
  let decisiones = {};

  function dibujarResumen() {
    const local = localInstantanea;
    const plan = planificarImportacion(archivoActual, local, { decisiones });
    const origen = archivoActual.evaluador?.nombre ? ` de ${esc(archivoActual.evaluador.nombre)}` : '';
    zonaImportacion.innerHTML = `
      <p><strong>${esc(nombreArchivo)}</strong><br><small>Respaldo${origen} exportado el ${fechaHoraCorta(archivoActual.exportado_en)}.</small></p>
      <table class="resumen-importacion">
        <thead><tr><th></th><th>Nuevos</th><th>Actualiz.</th><th>Omitidos</th><th>Conflictos</th></tr></thead>
        <tbody>${TABLAS.map(([k, nombre]) => `<tr><td>${nombre}</td><td>${plan.resumen[k].nuevos}</td><td>${plan.resumen[k].actualizados}</td><td>${plan.resumen[k].omitidos}</td><td>${plan.resumen[k].conflictos || '—'}</td></tr>`).join('')}</tbody>
      </table>
      <p><small>Omitidos: ya existen aquí iguales o más recientes. Las evaluaciones cerradas nunca se sobrescriben.</small></p>
      ${
        plan.duplicados.length
          ? `<div class="aviso"><strong>Posibles duplicados</strong>
              ${plan.duplicados.map((d) => `<label class="campo"><span>${d.tipo === 'sitio' ? 'Sitio' : 'Área'} “${esc(d.nombre)}” ya existe aquí${d.nombre !== d.local ? ` como “${esc(d.local)}”` : ''}</span>
                <select data-duplicado="${esc(`${d.tipo}:${d.id}`)}"><option value="fusionar" ${d.decision === 'fusionar' ? 'selected' : ''}>Es el mismo: fusionar (recomendado)</option><option value="separar" ${d.decision === 'separar' ? 'selected' : ''}>Son distintos: mantener separados</option></select></label>`).join('')}
            </div>`
          : ''
      }
      ${plan.avisos.length ? `<div class="aviso"><strong>Avisos</strong><ul class="lista-conflictos">${plan.avisos.map((a) => `<li>${esc(a)}</li>`).join('')}</ul></div>` : ''}
      ${
        plan.conflictos.length
          ? `<div class="aviso aviso--error"><strong>${plural(plan.conflictos.length, 'conflicto', 'conflictos')} (no se importan)</strong><ul class="lista-conflictos">${plan.conflictos.slice(0, 15).map((c) => `<li>${esc(c.motivo)}</li>`).join('')}${plan.conflictos.length > 15 ? `<li>…y ${plan.conflictos.length - 15} más.</li>` : ''}</ul></div>`
          : ''
      }
      <div class="pila">
        <button type="button" class="btn btn--primario btn--bloque" data-confirmar-importar ${plan.hayCambios ? '' : 'disabled'}>${plan.hayCambios ? 'Importar' : 'No hay nada nuevo que importar'}</button>
        <button type="button" class="btn btn--bloque" data-cancelar-importar>Cancelar</button>
      </div>`;
    zonaImportacion.plan = plan;
  }

  let localInstantanea = null;

  q('[data-archivo]').addEventListener('change', async (e) => {
    const archivo = e.target.files[0];
    e.target.value = '';
    if (!archivo) return;
    const progreso = dialogoProgreso('Leyendo el archivo');
    try {
      progreso.actualizar(0.2, 'Leyendo…');
      const contenido = await leerArchivoRespaldo(archivo);
      progreso.actualizar(0.6, 'Revisando el contenido…');
      const { errores } = validarArchivo(contenido);
      if (errores.length) throw Object.assign(new Error('El archivo no se puede importar.'), { detalles: errores });
      localInstantanea = await db.instantaneaLocal();
      archivoActual = contenido;
      nombreArchivo = archivo.name;
      decisiones = {};
      progreso.cerrar();
      dibujarResumen();
    } catch (err) {
      progreso.cerrar();
      archivoActual = null;
      const detalles = err.detalles ?? [err.message];
      zonaImportacion.innerHTML = `<div class="aviso aviso--error"><strong>${esc(err.detalles ? 'El archivo no se puede importar' : 'No se pudo leer el archivo')}</strong><ul class="lista-conflictos">${detalles.slice(0, 10).map((d) => `<li>${esc(d)}</li>`).join('')}${detalles.length > 10 ? `<li>…y ${detalles.length - 10} problemas más.</li>` : ''}</ul></div>`;
    }
  });

  zonaImportacion.addEventListener('change', (e) => {
    const clave = e.target.dataset?.duplicado;
    if (!clave) return;
    decisiones[clave] = e.target.value;
    dibujarResumen();
  });

  zonaImportacion.addEventListener('click', async (e) => {
    if (e.target.closest('[data-cancelar-importar]')) {
      archivoActual = null;
      zonaImportacion.innerHTML = '';
    } else if (e.target.closest('[data-confirmar-importar]')) {
      const plan = zonaImportacion.plan;
      const progreso = dialogoProgreso('Importando');
      try {
        progreso.actualizar(0.3, 'Guardando en este dispositivo…');
        await aplicarImportacion(plan, { archivo: nombreArchivo, origen: archivoActual });
        progreso.cerrar();
        const nuevas = plan.resumen.evaluaciones.nuevos + plan.resumen.evaluaciones.actualizados;
        archivoActual = null;
        zonaImportacion.innerHTML = `<div class="aviso"><strong>Importación completada.</strong> ${plural(nuevas, 'evaluación importada o actualizada', 'evaluaciones importadas o actualizadas')}, ${plural(plan.resumen.fotos.nuevos, 'foto nueva', 'fotos nuevas')}.</div>`;
        toast('Importación completada');
        await render(cont); // refresca contadores y el registro
      } catch (err) {
        console.error(err);
        progreso.cerrar();
        toast(`No se importó nada: ${err.message}`, 8000);
      }
    }
  });

  // --- Excel ------------------------------------------------------------------

  q('[data-excel]').addEventListener('click', async () => {
    const progreso = dialogoProgreso('Preparando Excel');
    try {
      const { exportarExcel } = await import('../excel.js');
      const r = await exportarExcel((f, t) => progreso.actualizar(f, t));
      progreso.cerrar();
      if (!r) return toast('No hay evaluaciones cerradas para exportar.');
      dialogoEntrega({ blob: r.blob, nombre: r.nombre, titulo: 'Excel listo', tipo: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', detalle: plural(r.filas, 'fila', 'filas') });
    } catch (e) {
      console.error(e);
      progreso.cerrar();
      toast(`No se pudo generar el Excel: ${e.message}`, 7000);
    }
  });
}
