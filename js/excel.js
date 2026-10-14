// Exportación a Excel: una hoja por módulo, una fila por evaluación cerrada y vigente, columnas por S y por ítem.
import { crearXlsx } from './xlsx.js';

const NOMBRES_HOJA = { fisico: 'Físico', digital: 'Digital' };
const si = (v) => (v ? 'Sí' : 'No');

/**
 * Arma las hojas a partir de los registros. Las columnas de S e ítems salen del instrumento vigente;
 * una evaluación hecha con otra versión deja en blanco los ítems que ya no existen (la versión va en su fila).
 */
export function construirHojas({ inst, sitios, areas, evaluaciones }) {
  const areaPor = new Map(areas.map((a) => [a.id, a]));
  const sitioPor = new Map(sitios.map((s) => [s.id, s]));
  const tipoPor = new Map(inst.tipos_area.map((t) => [t.codigo, t.nombre]));
  const vigentes = evaluaciones.filter((e) => e.estado === 'cerrada' && !e.anulada);

  const hojas = inst.modulos.map((modulo) => {
    const digital = modulo.id === 'digital';
    const items = modulo.eses.flatMap((s) => s.items);
    const columnas = [
      { titulo: 'Sitio', ancho: 22 },
      { titulo: 'Área', ancho: 26 },
      ...(digital ? [] : [{ titulo: 'Tipo de área', ancho: 16 }]),
      { titulo: 'Fecha', ancho: 12, tipo: 'fecha' },
      { titulo: 'Evaluador', ancho: 22 },
      ...(digital ? [{ titulo: 'Usuario', ancho: 22 }, { titulo: 'Cargo del usuario', ancho: 20 }, { titulo: 'Equipo', ancho: 14 }] : []),
      { titulo: 'Primera evaluación', ancho: 12 },
      { titulo: 'Resultado global (%)', ancho: 13, tipo: 'numero' },
      { titulo: 'Nivel', ancho: 16 },
      { titulo: 'Regla de la S más débil aplicada', ancho: 14 },
      { titulo: 'Próxima evaluación', ancho: 13, tipo: 'fecha' },
      ...modulo.eses.map((s) => ({ titulo: `${s.id} ${s.nombre} (%)`, ancho: 12, tipo: 'numero' })),
      ...items.map((i) => ({ titulo: i.codigo, ancho: 7 })),
      { titulo: 'Versión del instrumento', ancho: 14 },
    ];

    const filas = vigentes
      .filter((e) => e.modulo === modulo.id)
      .sort((a, b) => (sitioPor.get(areaPor.get(a.area_id)?.sitio_id)?.nombre ?? '').localeCompare(sitioPor.get(areaPor.get(b.area_id)?.sitio_id)?.nombre ?? '', 'es') || (areaPor.get(a.area_id)?.nombre ?? '').localeCompare(areaPor.get(b.area_id)?.nombre ?? '', 'es') || a.fecha.localeCompare(b.fecha))
      .map((e) => {
        const area = areaPor.get(e.area_id);
        const r = e.resultado ?? {};
        const porS = new Map((r.por_s ?? []).map((s) => [s.id, s]));
        const respuesta = new Map(e.respuestas.map((x) => [x.codigo, x]));
        return [
          sitioPor.get(area?.sitio_id)?.nombre ?? '',
          area?.nombre ?? '',
          ...(digital ? [] : [tipoPor.get(e.area_tipo) ?? e.area_tipo]),
          e.fecha,
          e.evaluador?.nombre ?? '',
          ...(digital ? [e.usuario_nombre ?? '', e.usuario_cargo ?? '', e.equipo_codigo ?? ''] : []),
          si(e.es_primera_evaluacion),
          r.global ?? null,
          r.nivel ?? '',
          si(r.regla_s_debil_aplicada),
          r.proxima_evaluacion ?? null,
          ...modulo.eses.map((s) => {
            const x = porS.get(s.id);
            return x?.evaluable ? x.porcentaje : null;
          }),
          ...items.map((i) => {
            const x = respuesta.get(i.codigo);
            if (!x) return null;
            if (x.na) return 'N/A';
            return Number.isInteger(x.valor) ? x.valor : null;
          }),
          e.instrumento_version ?? '',
        ];
      });
    return { nombre: NOMBRES_HOJA[modulo.id] ?? modulo.nombre, columnas, filas, congelarColumnas: 2 };
  });

  // Leyenda: qué es cada código de ítem.
  hojas.push({
    nombre: 'Ítems',
    columnas: [{ titulo: 'Módulo', ancho: 12 }, { titulo: 'S', ancho: 8 }, { titulo: 'Código', ancho: 9 }, { titulo: 'Ítem', ancho: 90 }],
    filas: inst.modulos.flatMap((m) => m.eses.flatMap((s) => s.items.map((i) => [NOMBRES_HOJA[m.id] ?? m.nombre, s.id, i.codigo, i.texto]))),
    congelarColumnas: 0,
  });
  return hojas;
}

/** Genera el Excel con lo guardado en este dispositivo. Devuelve { blob, nombre, filas } o null si no hay evaluaciones. */
export async function exportarExcel(onProgreso = () => {}) {
  const [db, { ctx }] = await Promise.all([import('./db.js'), import('./contexto.js')]);
  onProgreso(0.2, 'Reuniendo evaluaciones…');
  const [sitios, areas, evaluaciones] = await Promise.all([db.todos('sitios'), db.todos('areas'), db.todos('evaluaciones')]);
  const hojas = construirHojas({ inst: ctx.instrumento, sitios, areas, evaluaciones });
  const filas = hojas.slice(0, -1).reduce((n, h) => n + h.filas.length, 0);
  if (!filas) return null;
  onProgreso(0.7, 'Armando el archivo…');
  const blob = crearXlsx(hojas);
  const hoy = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return { blob, nombre: `Evaluaciones_5S_${hoy.getFullYear()}${p(hoy.getMonth() + 1)}${p(hoy.getDate())}.xlsx`, filas };
}
