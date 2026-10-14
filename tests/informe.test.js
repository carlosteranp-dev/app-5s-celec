import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { seleccionarInforme, resumenSitio, ordenarPorPuntaje, clasificarItems, fotosDelInforme, etiquetaUsuario, partesNombreInforme } from '../js/informe.js';
import { sincronizarRespuestas, NIVEL_NO_EVALUABLE } from '../js/calc.js';

const INST = JSON.parse(readFileSync(new URL('../instrumento_5S.json', import.meta.url), 'utf8'));
const INTERP = INST.interpretacion;

let n = 0;
/** Evaluación cerrada mínima. `global` null = no evaluable. */
const ev = (areaId, modulo, fecha, global, extra = {}) => ({
  id: `e${++n}`, area_id: areaId, modulo, fecha, creado: `${fecha}T10:00:00.${String(n).padStart(3, '0')}Z`, estado: 'cerrada', anulada: false,
  instrumento_version: '1.0-borrador', resultado: { global, nivel: 'x' }, ...extra,
});

const sitios = [{ id: 's1', nombre: 'Central Uno' }, { id: 's2', nombre: 'Central Dos' }, { id: 's3', nombre: 'Central Tres' }];
const areas = [
  { id: 'a1', sitio_id: 's1', nombre: 'Casa de máquinas', activo: true },
  { id: 'a2', sitio_id: 's1', nombre: 'Bodega', activo: true },
  { id: 'a3', sitio_id: 's1', nombre: 'Taller viejo', activo: false },
  { id: 'a4', sitio_id: 's2', nombre: 'Oficina', activo: true },
];
const filtro = (extra = {}) => ({ sitioIds: ['s1', 's2'], desde: '2026-04-01', hasta: '2026-06-30', modulos: ['fisico', 'digital'], hoy: '2026-10-14', interpretacion: INTERP, ...extra });
const armar = (evaluaciones, acciones = []) => seleccionarInforme({ sitios, areas, evaluaciones, acciones }, filtro());

test('físico: la última evaluación cerrada del periodo, y la tendencia se mide contra la anterior aunque esté fuera del periodo', () => {
  const informe = armar([ev('a1', 'fisico', '2026-01-10', 50), ev('a1', 'fisico', '2026-05-10', 70), ev('a1', 'fisico', '2026-05-20', 75), ev('a1', 'fisico', '2026-09-10', 95)]);
  const fila = informe.sitios[0].areas[0];
  assert.equal(fila.fisico.resultado.global, 75); // la del 20/05, no la de septiembre (fuera del periodo)
  assert.equal(fila.fisico.anterior.resultado.global, 70);
  assert.equal(fila.fisico.tendencia, 'sube');
});

test('la anterior puede estar fuera del periodo', () => {
  const f = armar([ev('a1', 'fisico', '2026-01-10', 50), ev('a1', 'fisico', '2026-05-10', 70)]).sitios[0].areas[0].fisico;
  assert.equal(f.anterior.fecha, '2026-01-10');
  assert.equal(f.tendencia, 'sube');
});

test('tendencia: baja, igual (menos de 1 punto) y sin dato', () => {
  const baja = armar([ev('a1', 'fisico', '2026-01-10', 80), ev('a1', 'fisico', '2026-05-10', 70)]).sitios[0].areas[0].fisico;
  assert.equal(baja.tendencia, 'baja');
  const igual = armar([ev('a1', 'fisico', '2026-01-10', 70.5), ev('a1', 'fisico', '2026-05-10', 70)]).sitios[0].areas[0].fisico;
  assert.equal(igual.tendencia, 'igual');
  const sin = armar([ev('a1', 'fisico', '2026-05-10', 70)]).sitios[0].areas[0].fisico;
  assert.equal(sin.anterior, null);
  assert.equal(sin.tendencia, null);
  const noEval = armar([ev('a1', 'fisico', '2026-01-10', 70), ev('a1', 'fisico', '2026-05-10', null)]).sitios[0].areas[0].fisico;
  assert.equal(noEval.tendencia, null);
});

test('no entran las anuladas ni los borradores, ni cuentan como anterior', () => {
  const informe = armar([
    ev('a1', 'fisico', '2026-02-01', 40),
    ev('a1', 'fisico', '2026-03-01', 99, { anulada: true }),
    ev('a1', 'fisico', '2026-05-10', 60),
    ev('a1', 'fisico', '2026-05-25', 10, { estado: 'borrador', resultado: null }),
    ev('a1', 'fisico', '2026-05-28', 12, { anulada: true }),
  ]);
  const f = informe.sitios[0].areas[0].fisico;
  assert.equal(f.resultado.global, 60);
  assert.equal(f.anterior.resultado.global, 40);
});

test('digital: la última por equipo y promedio sin los no evaluables', () => {
  const informe = armar([
    ev('a1', 'digital', '2026-04-10', 50, { equipo_codigo: 'PC-1', usuario_nombre: 'Ana' }),
    ev('a1', 'digital', '2026-06-10', 90, { equipo_codigo: 'pc-1', usuario_nombre: 'Ana' }), // misma máquina, más reciente
    ev('a1', 'digital', '2026-05-10', 70, { equipo_codigo: 'PC-2', usuario_nombre: 'Luis' }),
    ev('a1', 'digital', '2026-05-12', null, { equipo_codigo: 'PC-3', usuario_nombre: 'Eva' }),
    ev('a1', 'digital', '2026-09-12', 10, { equipo_codigo: 'PC-4', usuario_nombre: 'Fuera de periodo' }),
  ]);
  const d = informe.sitios[0].areas[0].digital;
  assert.equal(d.evaluaciones.length, 3);
  assert.equal(d.promedio.promedio, 80);
  assert.equal(d.promedio.evaluados, 2);
  assert.equal(d.promedio.excluidos, 1);
  assert.equal(d.promedio.nivel, 'Implementado');
  assert.equal(informe.sitios[0].areas[0].fisico, null);
});

test('los módulos no elegidos no entran', () => {
  const evs = [ev('a1', 'fisico', '2026-05-10', 70), ev('a1', 'digital', '2026-05-10', 70, { equipo_codigo: 'PC-1' })];
  const soloFisico = seleccionarInforme({ sitios, areas, evaluaciones: evs, acciones: [] }, filtro({ modulos: ['fisico'] })).sitios[0].areas[0];
  assert.equal(soloFisico.digital, null);
  const soloDigital = seleccionarInforme({ sitios, areas, evaluaciones: evs, acciones: [] }, filtro({ modulos: ['digital'] })).sitios[0].areas[0];
  assert.equal(soloDigital.fisico, null);
  assert.equal(soloDigital.digital.evaluaciones.length, 1);
});

test('áreas sin evaluación en el periodo: activas se listan aparte, inactivas sin evaluación se ignoran', () => {
  const informe = armar([ev('a1', 'fisico', '2026-05-10', 70), ev('a1', 'fisico', '2026-09-10', 70)]);
  assert.deepEqual(informe.sinEvaluar.map((x) => x.area.id).sort(), ['a2', 'a4']); // a3 está inactiva
  assert.equal(informe.sitios.length, 1); // s2 no tiene evaluaciones: no aparece como sitio
  const conInactiva = armar([ev('a3', 'fisico', '2026-05-10', 55)]);
  assert.equal(conInactiva.sitios[0].areas[0].area.id, 'a3'); // una inactiva evaluada en el periodo sí entra
});

test('sitios y áreas ordenados por nombre; solo los sitios elegidos', () => {
  const informe = armar([ev('a4', 'fisico', '2026-05-10', 60), ev('a1', 'fisico', '2026-05-10', 70), ev('a2', 'fisico', '2026-05-10', 80)]);
  assert.deepEqual(informe.sitios.map((s) => s.sitio.nombre), ['Central Dos', 'Central Uno']);
  assert.deepEqual(informe.sitios[1].areas.map((f) => f.area.nombre), ['Bodega', 'Casa de máquinas']);
  const soloUno = seleccionarInforme({ sitios, areas, evaluaciones: [ev('a4', 'fisico', '2026-05-10', 60), ev('a1', 'fisico', '2026-05-10', 70)], acciones: [] }, filtro({ sitioIds: ['s1'] }));
  assert.deepEqual(soloUno.sitios.map((s) => s.sitio.id), ['s1']);
  assert.deepEqual(partesNombreInforme(soloUno), ['Informe', '5S', 'Central Uno']);
  assert.deepEqual(partesNombreInforme(informe), ['Informe', '5S', 'Consolidado']);
});

test('resumen por sitio: promedios, no evaluables excluidos y nivel por rango', () => {
  const informe = armar([ev('a1', 'fisico', '2026-05-10', 59.98), ev('a2', 'fisico', '2026-05-10', 60), ev('a1', 'digital', '2026-05-10', 80, { equipo_codigo: 'PC-1' })]);
  const r = informe.sitios[0].resumen;
  assert.equal(r.areas, 2);
  assert.equal(r.promedioFisico, 59.99);
  assert.equal(r.nivel, 'Inicial'); // 59,99: el nivel usa el valor sin redondear
  assert.equal(r.promedioDigital, 80);

  const conNoEval = armar([ev('a1', 'fisico', '2026-05-10', 70), ev('a2', 'fisico', '2026-05-10', null)]).sitios[0].resumen;
  assert.equal(conNoEval.promedioFisico, 70);
  assert.equal(conNoEval.fisicasNoEvaluables, 1);

  const todasNoEval = armar([ev('a1', 'fisico', '2026-05-10', null)]).sitios[0].resumen;
  assert.equal(todasNoEval.promedioFisico, null);
  assert.equal(todasNoEval.nivel, NIVEL_NO_EVALUABLE);
});

test('solo módulo digital: el nivel del sitio sale del promedio digital', () => {
  const informe = seleccionarInforme({ sitios, areas, evaluaciones: [ev('a1', 'digital', '2026-05-10', 92, { equipo_codigo: 'PC-1' })], acciones: [] }, filtro({ modulos: ['digital'] }));
  assert.equal(informe.sitios[0].resumen.nivel, 'Sostenido');
});

test('orden de barras: de menor a mayor y sin las no evaluables', () => {
  const informe = armar([ev('a1', 'fisico', '2026-05-10', 70), ev('a2', 'fisico', '2026-05-10', 45), ev('a4', 'fisico', '2026-05-10', null)]);
  const filas = informe.sitios.flatMap((s) => s.areas);
  assert.deepEqual(ordenarPorPuntaje(filas).map((f) => f.area.id), ['a2', 'a1']);
});

test('plan de acción: abiertas de evaluaciones vigentes de los sitios elegidos, con días de atraso', () => {
  const e1 = ev('a1', 'fisico', '2026-05-10', 70);
  const eAnulada = ev('a1', 'fisico', '2026-04-10', 70, { anulada: true });
  const eOtroSitio = ev('a4', 'fisico', '2026-05-10', 70);
  const eFuera = ev('a1', 'fisico', '2026-08-10', 70); // posterior al fin del periodo
  const eAntigua = ev('a2', 'fisico', '2026-01-10', 70); // anterior al periodo: sus acciones abiertas siguen vigentes
  const acc = (e, desc, fecha, estado = 'abierta') => ({ id: desc, evaluacion_id: e.id, codigo_item: 'S1.1', descripcion: desc, responsable: 'X', fecha_compromiso: fecha, estado });
  const informe = seleccionarInforme(
    {
      sitios, areas, evaluaciones: [e1, eAnulada, eOtroSitio, eFuera, eAntigua],
      acciones: [
        acc(e1, 'vencida', '2026-10-01'), acc(e1, 'en plazo', '2026-12-01'), acc(e1, 'cerrada', '2026-09-01', 'cerrada'),
        acc(eAnulada, 'de anulada', '2026-09-01'), acc(eOtroSitio, 'otro sitio', '2026-09-01'), acc(eFuera, 'posterior', '2026-09-01'),
        acc(eAntigua, 'antigua abierta', '2026-02-01'), { ...acc(e1, 'sin texto', '2026-09-01'), descripcion: '  ' },
      ],
    },
    filtro({ sitioIds: ['s1'] }),
  );
  assert.deepEqual(informe.plan.map((p) => p.accion.descripcion), ['antigua abierta', 'vencida', 'en plazo']);
  assert.deepEqual(informe.plan.map((p) => p.atraso), [255, 13, 0]);
  assert.equal(informe.plan[0].sitio.nombre, 'Central Uno');
  assert.equal(informe.plan[0].area.nombre, 'Bodega');
});

test('versiones del instrumento usadas', () => {
  const informe = armar([ev('a1', 'fisico', '2026-05-10', 70, { instrumento_version: '1.0' }), ev('a2', 'fisico', '2026-05-10', 70, { instrumento_version: '1.1' })]);
  assert.deepEqual(informe.versiones, ['1.0', '1.1']);
});

test('hallazgos (0 y 1) y buenas prácticas (4) salen de las reglas del instrumento', () => {
  const valores = { 'S1.1': 0, 'S1.2': 1, 'S1.4': 4, 'S1.5': 'NA', 'S2.1': 3, 'S2.4': 4, 'S3.1': 2 };
  const respuestas = sincronizarRespuestas(INST, 'fisico', [], { tipoArea: 'A', esPrimera: false }).map((r) => {
    const v = valores[r.codigo];
    if (r.na === 'automatico' || v === undefined) return r;
    return v === 'NA' ? { ...r, na: 'manual', na_justificacion: 'x' } : { ...r, valor: v, observacion: `obs ${r.codigo}`, foto_ids: [`f-${r.codigo}-1`, `f-${r.codigo}-2`] };
  });
  const e = { id: 'x', modulo: 'fisico', area_tipo: 'A', es_primera_evaluacion: false, respuestas };
  const c = clasificarItems(INST, e);
  assert.deepEqual(c.hallazgos.map((h) => h.item.codigo), ['S1.1', 'S1.2']);
  assert.deepEqual(c.buenasPracticas.map((h) => h.item.codigo), ['S1.4', 'S2.4']);
  assert.equal(c.hallazgos[0].observacion, 'obs S1.1');

  // Una foto por ítem (la primera); sin buenas prácticas se omiten las del nivel 4.
  const informe = { sitios: [{ areas: [{ fisico: { ev: e } }] }] };
  const todas = fotosDelInforme(informe, new Map([['x', c]]));
  assert.deepEqual(todas.map((f) => f.id), ['f-S1.1-1', 'f-S1.2-1', 'f-S1.4-1', 'f-S2.4-1']);
  const sin = fotosDelInforme(informe, new Map([['x', c]]), { sinBuenasPracticas: true });
  assert.deepEqual(sin.map((f) => f.tipo), ['hallazgo', 'hallazgo']);
});

test('anonimizar: el usuario se muestra como "Usuario N"', () => {
  assert.equal(etiquetaUsuario({ usuario_nombre: 'María López' }, 0, false), 'María López');
  assert.equal(etiquetaUsuario({ usuario_nombre: 'María López' }, 2, true), 'Usuario 3');
});

test('resumenSitio con sitio sin áreas', () => {
  const r = resumenSitio([], INTERP);
  assert.equal(r.areas, 0);
  assert.equal(r.nivel, NIVEL_NO_EVALUABLE);
});
