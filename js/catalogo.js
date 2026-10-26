// Catálogo de sitios (catalogo_sitios.json): lista inicial de localidades y áreas para elegir en la app.
// Localidad del listado = sitio de la app; Sector + Sitio del listado = área. Siempre se puede crear algo que no esté en el listado.
import * as db from './db.js';
import { esc, normalizarNombre } from './util.js';
import { abrirDialogo } from './ui.js';

let memoria = null;

/** Carga el catálogo una vez. Si no se puede leer, la app sigue funcionando solo con lo que ya existe y "otro". */
export async function cargarCatalogo() {
  if (memoria) return memoria;
  try {
    const r = await fetch('catalogo_sitios.json');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    memoria = await r.json();
  } catch (e) {
    console.warn('No se pudo cargar el catálogo de sitios', e);
    memoria = { localidades: [] };
  }
  return memoria;
}

/** Nombre del área en la app: "SECTOR – SITIO" (el nombre del sitio solo no basta: hay "OFICINAS" en varios sectores). */
export function nombreAreaCatalogo(area) {
  const sector = (area.sector ?? '').trim();
  return sector && normalizarNombre(sector) !== normalizarNombre(area.nombre) ? `${sector} – ${area.nombre}` : area.nombre;
}

/** Errores de formato del catálogo (lista vacía si es válido). `tipos` = códigos de tipo de área del instrumento. */
export function validarCatalogo(catalogo, tipos) {
  const errores = [];
  if (!Array.isArray(catalogo?.localidades) || catalogo.localidades.length === 0) return ['El catálogo no tiene localidades.'];
  const vistas = new Set();
  for (const l of catalogo.localidades) {
    if (!l.nombre?.trim()) errores.push('Hay una localidad sin nombre.');
    if (vistas.has(normalizarNombre(l.nombre))) errores.push(`Localidad repetida: ${l.nombre}.`);
    vistas.add(normalizarNombre(l.nombre));
    const nombres = new Set();
    for (const a of l.areas ?? []) {
      const nombre = nombreAreaCatalogo(a);
      if (!a.nombre?.trim()) errores.push(`${l.nombre}: hay un sitio sin nombre.`);
      if (nombres.has(normalizarNombre(nombre))) errores.push(`${l.nombre}: área repetida "${nombre}".`);
      nombres.add(normalizarNombre(nombre));
      if (!tipos.includes(a.tipo_sugerido)) errores.push(`${l.nombre} / ${nombre}: tipo "${a.tipo_sugerido}" no existe en el instrumento.`);
    }
  }
  return errores;
}

/** Localidades del catálogo con el sitio que ya existe en este dispositivo (o null). */
export function localidadesDisponibles(catalogo, sitios) {
  const porNombre = new Map(sitios.map((s) => [normalizarNombre(s.nombre), s]));
  return catalogo.localidades.map((l) => ({ nombre: l.nombre, existente: porNombre.get(normalizarNombre(l.nombre)) ?? null }));
}

/** Áreas de una localidad del catálogo con el área que ya existe en el sitio (o null). */
export function areasDeLocalidad(catalogo, nombreLocalidad, areasDelSitio = []) {
  const l = catalogo.localidades.find((x) => normalizarNombre(x.nombre) === normalizarNombre(nombreLocalidad));
  const porNombre = new Map(areasDelSitio.map((a) => [normalizarNombre(a.nombre), a]));
  return (l?.areas ?? []).map((a) => {
    const nombre = nombreAreaCatalogo(a);
    return { nombre, sector: a.sector, sitio: a.nombre, tipo_sugerido: a.tipo_sugerido, existente: porNombre.get(normalizarNombre(nombre)) ?? null };
  });
}

// --- Creación (usa IndexedDB) ----------------------------------------------------------

/** Crea el sitio si no existe uno con ese nombre; devuelve el sitio (nuevo o existente). */
export async function asegurarSitio(nombre, ubicacion = '') {
  const existente = (await db.todos('sitios')).find((s) => normalizarNombre(s.nombre) === normalizarNombre(nombre));
  if (existente) {
    if (!existente.activo) await db.guardar('sitios', Object.assign(existente, { activo: true }));
    return existente;
  }
  return db.guardar('sitios', db.crearEntidad({ nombre: nombre.trim(), ubicacion, activo: true }));
}

/** Crea el área en el sitio si no existe una con ese nombre; devuelve el área (nueva o existente). */
export async function asegurarArea(sitioId, { nombre, tipo, responsable = '' }) {
  const existente = (await db.porIndice('areas', 'sitio_id', sitioId)).find((a) => normalizarNombre(a.nombre) === normalizarNombre(nombre));
  if (existente) {
    if (!existente.activo) await db.guardar('areas', Object.assign(existente, { activo: true }));
    return existente;
  }
  return db.guardar('areas', db.crearEntidad({ sitio_id: sitioId, nombre: nombre.trim(), tipo, responsable, activo: true }));
}

// --- Diálogos ---------------------------------------------------------------------------

/** Elegir localidades (sitios) del listado. Devuelve los nombres elegidos, o null si se cancela. */
export function dialogoElegirLocalidades(disponibles) {
  return new Promise((resolver) => {
    const { d, cerrar } = abrirDialogo(
      `
      <h2>Sitios del listado</h2>
      <p class="suave">Marque los sitios que va a evaluar. Si el suyo no está, use “+ Nuevo sitio”.</p>
      <form novalidate>
        ${disponibles.map((l, i) => `<label class="casilla"><input type="checkbox" name="loc" value="${i}" ${l.existente ? 'checked disabled' : ''}> ${esc(l.nombre)}${l.existente ? ' <small>(ya agregado)</small>' : ''}</label>`).join('')}
        <div class="acciones-dialogo"><button type="button" class="btn" data-cancelar>Cancelar</button><button type="submit" class="btn btn--primario">Agregar</button></div>
      </form>`,
      () => resolver(null),
    );
    d.querySelector('[data-cancelar]').addEventListener('click', () => {
      cerrar();
      resolver(null);
    });
    d.querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault();
      const elegidas = [...d.querySelectorAll('input[name=loc]:checked:not(:disabled)')].map((c) => disponibles[Number(c.value)].nombre);
      cerrar();
      resolver(elegidas);
    });
  });
}

/** Elegir áreas del listado de una localidad. Devuelve las áreas elegidas (del catálogo), o null si se cancela. */
export function dialogoElegirAreas({ localidad, areas, tipos }) {
  const nombreTipo = (c) => tipos.find((t) => t.codigo === c)?.nombre ?? c;
  return new Promise((resolver) => {
    const { d, cerrar } = abrirDialogo(
      `
      <h2>Áreas de ${esc(localidad)}</h2>
      <p class="suave">Marque las áreas que va a evaluar. El tipo que se muestra es una sugerencia: puede cambiarlo después. Si no está, use “+ Área”.</p>
      <form novalidate>
        <label class="campo"><span>Buscar</span><input type="search" data-buscar placeholder="Escriba parte del nombre"></label>
        <div data-lista>${areas
          .map((a, i) => `<label class="casilla" data-texto="${esc(normalizarNombre(a.nombre))}"><input type="checkbox" name="area" value="${i}" ${a.existente ? 'checked disabled' : ''}> <span>${esc(a.nombre)} <small>· ${esc(nombreTipo(a.tipo_sugerido))}${a.existente ? ' · ya agregada' : ''}</small></span></label>`)
          .join('')}</div>
        <div class="acciones-dialogo"><button type="button" class="btn" data-cancelar>Cancelar</button><button type="submit" class="btn btn--primario">Agregar</button></div>
      </form>`,
      () => resolver(null),
    );
    d.querySelector('[data-buscar]').addEventListener('input', (e) => {
      const q = normalizarNombre(e.target.value);
      d.querySelectorAll('[data-lista] label').forEach((l) => l.classList.toggle('oculto', q !== '' && !l.dataset.texto.includes(q)));
    });
    d.querySelector('[data-cancelar]').addEventListener('click', () => {
      cerrar();
      resolver(null);
    });
    d.querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault();
      const elegidas = [...d.querySelectorAll('input[name=area]:checked:not(:disabled)')].map((c) => areas[Number(c.value)]);
      cerrar();
      resolver(elegidas);
    });
  });
}
