// Informe PDF por sitios evaluados (CLAUDE.md §7.2). `construirInforme` no toca el DOM (se prueba en Node);
// `generarInforme` reúne datos, fotos y gráficos en el navegador y lo invoca.
import { formatoGlobal, formatoPuntaje, NIVEL_NO_EVALUABLE, nivelPorRango, obtenerModulo } from './calc.js';
import { clasificarItems, etiquetaUsuario, fotosDelInforme, ordenarPorPuntaje, partesNombreInforme, seleccionarInforme } from './informe.js';
import { colorTextoSobre, fechaCorta, hoyLocal, nombreSeguro } from './util.js';
import {
  ANCHO_UTIL, AZUL, AZUL_OSCURO, GRIS, PAGINA, TEXTO, cargarJsPDF, cargarLogo, espacio, estiloTabla, limpiarTexto, parrafo,
  pieYEncabezados, recortar, titulo,
} from './pdf-comun.js';

const t = limpiarTexto;
const COLOR_NO_EVALUABLE = '#5F6B76';
const VERDE = '#2E7D32';
const ROJO = '#C62828';
const FILAS_POR_GRAFICO = 30;
const LADO_FOTO = { ancho: 34, alto: 26 };

const colorDeNivel = (nombre, interp) => interp.find((r) => r.nivel === nombre)?.color ?? COLOR_NO_EVALUABLE;
const rangoFecha = ({ desde, hasta }) => `${fechaCorta(desde)} al ${fechaCorta(hasta)}`;

/** Celda de nivel con el color del instrumento (texto claro u oscuro según el contraste). */
function celdaNivel(nombre, interp, texto = nombre) {
  if (!nombre || nombre === NIVEL_NO_EVALUABLE) return { content: t(texto === nombre ? NIVEL_NO_EVALUABLE : texto), styles: { fillColor: COLOR_NO_EVALUABLE, textColor: '#FFFFFF', fontStyle: 'bold' } };
  const fondo = colorDeNivel(nombre, interp);
  return { content: t(texto), styles: { fillColor: fondo, textColor: colorTextoSobre(fondo), fontStyle: 'bold' } };
}

/** Nombre del archivo: Informe_5S_<Sitio>_<AAAAMMDD>.pdf (varios sitios: Consolidado). */
export function nombreInforme(informe, emision) {
  return `${partesNombreInforme(informe).map(nombreSeguro).filter(Boolean).join('_')}_${emision.replaceAll('-', '')}.pdf`;
}

// ---------------------------------------------------------------------------
// Construcción del documento
// ---------------------------------------------------------------------------

/**
 * Arma el informe.
 *
 * @param datos  {
 *   inst            instrumento vigente (anexo y rangos),
 *   informe         resultado de seleccionarInforme,
 *   instrumentos    Map(evaluacionId → instrumento con el que se hizo),
 *   clasificados    Map(evaluacionId → { hallazgos, buenasPracticas }) de clasificarItems,
 *   fotos           Map(fotoId → { bytes (JPEG), ancho, alto }),
 *   radares         Map(evaluacionId → PNG data URL),
 *   barras          [{ png, ancho, alto, desde, hasta }] gráficos de barras ya dibujados,
 *   logo, elaboradoPor { nombre, cargo }, anonimo, sinFotosBuenasPracticas, emision (AAAA-MM-DD), generado (Date) }
 * @param jsPDF  constructor de jsPDF con autotable aplicado
 */
export function construirInforme(datos, jsPDF, { onProgreso = () => {} } = {}) {
  const { inst, informe } = datos;
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
  const ctx = { doc, y: PAGINA.margen, datos, inst, interp: inst.interpretacion, informe };
  doc.setProperties({ title: 'Informe de Evaluación 5S', subject: rangoFecha(informe.periodo), author: t(datos.elaboradoPor?.nombre), creator: 'App 5S CELEC SUR' });

  portada(ctx);
  resumenEjecutivo(ctx);
  const filas = informe.sitios.flatMap((s) => s.areas);
  filas.forEach((fila, i) => {
    onProgreso(0.7 + (0.2 * i) / filas.length, `Armando el detalle de ${fila.area.nombre}…`);
    detalleArea(ctx, fila);
  });
  planDeAccion(ctx);
  anexo(ctx);
  pieYEncabezados(doc, {
    organizacion: inst.meta.organizacion,
    encabezado: `Informe de Evaluación 5S · ${rangoFecha(informe.periodo)}`,
    formato: inst.meta.codigo_formato,
    version: inst.meta.version,
    generado: datos.generado,
  });
  return doc;
}

function nuevaPagina(ctx) {
  ctx.doc.addPage();
  ctx.y = PAGINA.margenSuperior;
}

// --- Portada ---------------------------------------------------------------

function portada(ctx) {
  const { doc, datos, inst, informe } = ctx;
  let y = 38;
  if (datos.logo) {
    const ancho = 90;
    const alto = (datos.logo.alto / datos.logo.ancho) * ancho;
    doc.addImage(datos.logo.bytes, 'PNG', (PAGINA.ancho - ancho) / 2, y, ancho, alto, 'logo', 'FAST');
    y += alto + 18;
  }
  doc.setFont('helvetica', 'bold').setFontSize(10).setTextColor(GRIS);
  doc.text(t(inst.meta.organizacion), PAGINA.ancho / 2, y, { align: 'center' });
  doc.setFontSize(28).setTextColor(AZUL_OSCURO);
  doc.text('Informe de Evaluación 5S', PAGINA.ancho / 2, y + 14, { align: 'center' });
  doc.setDrawColor(AZUL).setLineWidth(1).line(PAGINA.margen + 40, y + 20, PAGINA.ancho - PAGINA.margen - 40, y + 20);
  y += 34;

  const modulos = informe.modulos.map((m) => obtenerModulo(inst, m).nombre).join(' · ');
  const filas = [
    [informe.sitios.length === 1 ? 'Sitio' : 'Sitios incluidos', informe.sitios.map((s) => s.sitio.nombre).join('\n')],
    ['Periodo evaluado', rangoFecha(informe.periodo)],
    ['Módulos', modulos],
    ['Fecha de emisión', fechaCorta(datos.emision)],
    ['Elaborado por', `${datos.elaboradoPor?.nombre ?? ''}${datos.elaboradoPor?.cargo ? ` – ${datos.elaboradoPor.cargo}` : ''}`],
  ];
  doc.autoTable({
    startY: y,
    body: filas.map(([k, v]) => [{ content: t(k), styles: { fontStyle: 'bold', textColor: '#4A5A6A', fillColor: '#F2F5F8' } }, { content: t(v) }]),
    ...estiloTabla({ styles: { font: 'helvetica', fontSize: 11, cellPadding: 3, lineColor: '#C9D2DB', lineWidth: 0.2, textColor: TEXTO } }),
    columnStyles: { 0: { cellWidth: 50 }, 1: { cellWidth: ANCHO_UTIL - 10 - 50 } },
    margin: { left: PAGINA.margen + 5, right: PAGINA.margen + 5 },
  });
  ctx.y = doc.lastAutoTable.finalY + 8;
  if (datos.anonimo) {
    doc.setFont('helvetica', 'italic').setFontSize(9).setTextColor(GRIS);
    doc.text('Informe anonimizado: no se muestran los nombres de los usuarios de 5S Digital.', PAGINA.ancho / 2, ctx.y, { align: 'center' });
  }
}

// --- Resumen ejecutivo -----------------------------------------------------

function resumenEjecutivo(ctx) {
  const { doc, informe, interp, datos } = ctx;
  nuevaPagina(ctx);
  titulo(ctx, 'Resumen ejecutivo', 40);

  // Tabla por sitio
  const sitiosCuerpo = informe.sitios.map(({ sitio, resumen }) => [
    t(sitio.nombre),
    String(resumen.areas),
    resumen.promedioFisico == null ? '—' : formatoGlobal(resumen.promedioFisico, interp),
    resumen.promedioDigital == null ? '—' : formatoGlobal(resumen.promedioDigital, interp),
    celdaNivel(resumen.nivel, interp),
  ]);
  doc.autoTable({
    startY: ctx.y,
    head: [['Sitio', 'Áreas evaluadas', 'Promedio físico', 'Promedio digital', 'Nivel']],
    body: sitiosCuerpo,
    ...estiloTabla({ styles: { font: 'helvetica', fontSize: 9, cellPadding: 2, lineColor: '#C9D2DB', lineWidth: 0.2, textColor: TEXTO } }),
    columnStyles: { 1: { halign: 'center', cellWidth: 28 }, 2: { halign: 'right', cellWidth: 30 }, 3: { halign: 'right', cellWidth: 30 }, 4: { cellWidth: 34 } },
  });
  ctx.y = doc.lastAutoTable.finalY + 2;
  const excluidas = informe.sitios.reduce((a, s) => a + s.resumen.fisicasNoEvaluables, 0);
  if (excluidas) parrafo(ctx, `${excluidas} área${excluidas === 1 ? '' : 's'} con resultado físico no evaluable no entra${excluidas === 1 ? '' : 'n'} en los promedios. El nivel de cada sitio sale de su promedio físico, solo por rango.`, { tamano: 8, color: GRIS });
  ctx.y += 3;

  // Tabla por área
  const filas = informe.sitios.flatMap((s) => s.areas);
  const tipoNombre = (codigo) => ctx.inst.tipos_area.find((x) => x.codigo === codigo)?.nombre ?? codigo;
  const cuerpo = filas.map((f) => {
    const r = f.fisico?.resultado;
    const tend = f.fisico?.tendencia;
    return [
      t(f.sitio.nombre),
      t(f.area.nombre),
      t(tipoNombre(f.fisico?.ev.area_tipo ?? f.area.tipo)),
      f.fisico ? fechaCorta(f.fisico.ev.fecha) : '—',
      f.fisico ? (r.global == null ? { content: 'No evaluable', styles: { textColor: GRIS } } : formatoGlobal(r.global, interp)) : '—',
      f.digital ? (f.digital.promedio.promedio == null ? { content: 'No evaluable', styles: { textColor: GRIS } } : formatoGlobal(f.digital.promedio.promedio, interp)) : '—',
      f.fisico ? celdaNivel(r.nivel, interp) : '—',
      { content: tend === 'igual' ? '=' : tend ? '' : '–', styles: { halign: 'center' }, tendencia: tend },
    ];
  });
  espacio(ctx, 40);
  doc.autoTable({
    startY: ctx.y,
    head: [['Sitio', 'Área', 'Tipo', 'Fecha', '% físico', '% digital', 'Nivel', 'Tend.']],
    body: cuerpo,
    ...estiloTabla({ styles: { font: 'helvetica', fontSize: 8, cellPadding: 1.6, lineColor: '#C9D2DB', lineWidth: 0.2, textColor: TEXTO, valign: 'middle' } }),
    columnStyles: { 3: { cellWidth: 19 }, 4: { halign: 'right', cellWidth: 19 }, 5: { halign: 'right', cellWidth: 19 }, 6: { cellWidth: 25 }, 7: { cellWidth: 12 } },
    // La tendencia se dibuja con triángulos vectoriales: Helvetica no tiene ▲ ni ▼.
    didDrawCell(h) {
      if (h.section !== 'body' || h.column.index !== 7) return;
      const sentido = h.cell.raw?.tendencia;
      if (sentido !== 'sube' && sentido !== 'baja') return;
      const cx = h.cell.x + h.cell.width / 2;
      const cy = h.cell.y + h.cell.height / 2;
      doc.setFillColor(sentido === 'sube' ? VERDE : ROJO);
      if (sentido === 'sube') doc.triangle(cx - 2, cy + 1.6, cx + 2, cy + 1.6, cx, cy - 1.8, 'F');
      else doc.triangle(cx - 2, cy - 1.6, cx + 2, cy - 1.6, cx, cy + 1.8, 'F');
    },
  });
  ctx.y = doc.lastAutoTable.finalY + 2;
  parrafo(ctx, 'Tendencia frente a la evaluación física anterior del área: triángulo verde = mejora, rojo = empeora, "=" = sin cambio (menos de 1 punto), "–" = sin dato comparable.', { tamano: 8, color: GRIS });
  ctx.y += 3;

  // Gráfico de barras
  datos.barras.forEach((g, i) => {
    const alto = (g.alto / g.ancho) * ANCHO_UTIL;
    if (i === 0) titulo(ctx, 'Puntaje físico por área (de menor a mayor)', Math.min(alto + 14, 120));
    else espacio(ctx, alto + 4);
    doc.addImage(g.png, 'PNG', PAGINA.margen, ctx.y, ANCHO_UTIL, alto, `barras-${i}`, 'FAST');
    ctx.y += alto + 2;
  });
  if (datos.barras.length) parrafo(ctx, 'Las líneas punteadas marcan los límites de referencia del instrumento. Las áreas no evaluables no se grafican.', { tamano: 8, color: GRIS });

  if (informe.sinEvaluar.length) {
    ctx.y += 3;
    titulo(ctx, 'Áreas sin evaluación en el periodo', 30);
    doc.autoTable({
      startY: ctx.y,
      head: [['Sitio', 'Área']],
      body: informe.sinEvaluar.map((x) => [t(x.sitio.nombre), t(x.area.nombre)]),
      ...estiloTabla(),
    });
    ctx.y = doc.lastAutoTable.finalY + 4;
  }
}

// --- Detalle por área ------------------------------------------------------

function bloqueResultado(ctx, resultado, tendencia) {
  const { doc, interp, inst } = ctx;
  const fondo = resultado.color ?? COLOR_NO_EVALUABLE;
  espacio(ctx, 30);
  doc.setFillColor(fondo).rect(PAGINA.margen, ctx.y, ANCHO_UTIL, 16, 'F');
  doc.setFont('helvetica', 'bold').setTextColor(colorTextoSobre(fondo));
  doc.setFontSize(18).text(resultado.global == null ? '—' : formatoGlobal(resultado.global, interp), PAGINA.margen + 5, ctx.y + 11);
  doc.setFontSize(12).text(t(resultado.nivel), PAGINA.margen + ANCHO_UTIL - 5, ctx.y + 10.5, { align: 'right' });
  doc.setTextColor(TEXTO);
  ctx.y += 20;

  const no = resultado.por_s.filter((s) => !s.evaluable);
  if (no.length) parrafo(ctx, `No se emite resultado global. ${no.map((s) => `${s.id} ${s.nombre}: ${s.motivo_no_evaluable}.`).join(' ')} Solo se reportan las S evaluadas.`, { negrita: true, color: ROJO, tamano: 9 });
  if (resultado.regla_s_debil_aplicada) {
    const plural = resultado.s_debiles.length > 1;
    parrafo(ctx, `Se aplicó la regla de la S más débil: por su porcentaje (${formatoGlobal(resultado.global, interp)}) el nivel sería "${resultado.nivel_por_rango}", pero ${plural ? 'las S' : 'la S'} ${resultado.s_debiles.join(', ')} ${plural ? 'están' : 'está'} por debajo de ${inst.reglas.regla_s_mas_debil.umbral_porcentaje} %, por lo que el nivel pasa a "${resultado.nivel}".`, { negrita: true, tamano: 9 });
  }
  void tendencia;
}

/** Tabla de hallazgos o buenas prácticas con la foto dentro de la última columna. */
function tablaConFotos(ctx, filas, { columnas, fotoDe, instDe, omitirFotos = false }) {
  const { doc, datos } = ctx;
  const cuerpo = filas.map((f) => {
    const foto = omitirFotos ? null : fotoDe(f);
    const celdaFoto = foto
      ? { content: '', styles: { minCellHeight: LADO_FOTO.alto + 2 }, foto }
      : { content: omitirFotos ? 'Foto omitida' : f.fotoIds.length ? 'Foto no disponible' : 'Sin foto', styles: { textColor: GRIS, fontSize: 7.5 } };
    return [...columnas.celdas(f, instDe), celdaFoto];
  });
  doc.autoTable({
    startY: ctx.y,
    head: [columnas.titulos],
    body: cuerpo,
    ...estiloTabla({ styles: { font: 'helvetica', fontSize: 8, cellPadding: 1.5, lineColor: '#C9D2DB', lineWidth: 0.2, textColor: TEXTO, valign: 'top' } }),
    columnStyles: columnas.estilos,
    rowPageBreak: 'avoid',
    didDrawCell(h) {
      const foto = h.section === 'body' && h.column.index === columnas.titulos.length - 1 ? h.cell.raw?.foto : null;
      if (!foto) return;
      const escala = Math.min(LADO_FOTO.ancho / foto.ancho, LADO_FOTO.alto / foto.alto);
      const w = foto.ancho * escala;
      const alto = foto.alto * escala;
      doc.addImage(foto.bytes, 'JPEG', h.cell.x + (h.cell.width - w) / 2, h.cell.y + 1 + (LADO_FOTO.alto - alto) / 2, w, alto, foto.id, 'FAST');
    },
  });
  ctx.y = doc.lastAutoTable.finalY + 4;
  void datos;
}

function detalleArea(ctx, fila) {
  const { doc, interp, datos, informe } = ctx;
  nuevaPagina(ctx);

  // Encabezado del área
  doc.setFont('helvetica', 'bold').setFontSize(16).setTextColor(AZUL_OSCURO);
  doc.text(t(fila.area.nombre), PAGINA.margen, ctx.y + 5, { maxWidth: ANCHO_UTIL });
  doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(GRIS);
  const tipo = ctx.inst.tipos_area.find((x) => x.codigo === (fila.fisico?.ev.area_tipo ?? fila.area.tipo));
  doc.text(t(`${fila.sitio.nombre} · Área ${tipo?.nombre ?? ''}${fila.area.responsable ? ` · Responsable: ${fila.area.responsable}` : ''}`), PAGINA.margen, ctx.y + 11, { maxWidth: ANCHO_UTIL });
  doc.setDrawColor(AZUL).setLineWidth(0.6).line(PAGINA.margen, ctx.y + 14, PAGINA.margen + ANCHO_UTIL, ctx.y + 14);
  doc.setTextColor(TEXTO);
  ctx.y += 18;

  if (fila.fisico) detalleFisico(ctx, fila);
  if (fila.digital) detalleDigital(ctx, fila);
  void interp;
  void datos;
  void informe;
}

function detalleFisico(ctx, fila) {
  const { doc, interp, datos } = ctx;
  const { ev, resultado: res, anterior, tendencia } = fila.fisico;
  const inst = datos.instrumentos.get(ev.id) ?? ctx.inst;
  const modulo = obtenerModulo(inst, ev.modulo);

  titulo(ctx, `${modulo.nombre} – evaluación del ${fechaCorta(ev.fecha)}`, 50);
  doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(GRIS);
  const cambio = anterior && tendencia
    ? ` · Tendencia: ${tendencia === 'sube' ? 'mejora' : tendencia === 'baja' ? 'empeora' : 'sin cambio'} (${formatoGlobal(res.global, interp)} frente a ${formatoGlobal(anterior.resultado.global, interp)} del ${fechaCorta(anterior.fecha)})`
    : '';
  doc.text(t(`Evaluador: ${ev.evaluador?.nombre ?? ''}${ev.evaluador?.cargo ? ` – ${ev.evaluador.cargo}` : ''}${cambio}`), PAGINA.margen, ctx.y + 3, { maxWidth: ANCHO_UTIL });
  doc.setTextColor(TEXTO);
  ctx.y += 8;

  bloqueResultado(ctx, res, tendencia);

  // Radar a la izquierda y tabla de puntajes a la derecha
  const lado = 74;
  const radar = datos.radares.get(ev.id);
  espacio(ctx, lado + 4);
  const yInicio = ctx.y;
  if (radar) doc.addImage(radar, 'PNG', PAGINA.margen, yInicio, lado, lado, `radar-${ev.id}`, 'FAST');
  doc.autoTable({
    startY: yInicio,
    head: [['S', 'Puntaje', 'Ítems']],
    body: res.por_s.map((s) => [
      { content: t(`${s.id} ${s.nombre}`), styles: { fontStyle: 'bold' } },
      s.evaluable ? formatoPuntaje(s.porcentaje) : { content: 'No evaluable', styles: { textColor: ROJO } },
      `${s.calificados}/${s.n}`,
    ]),
    ...estiloTabla({ styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 1.8, lineColor: '#C9D2DB', lineWidth: 0.2, textColor: TEXTO } }),
    columnStyles: { 1: { halign: 'right', cellWidth: 26 }, 2: { halign: 'center', cellWidth: 16 } },
    margin: { left: PAGINA.margen + (radar ? lado + 4 : 0), right: PAGINA.margen, top: PAGINA.margenSuperior, bottom: PAGINA.margenInferior },
  });
  ctx.y = Math.max(yInicio + (radar ? lado : 0), doc.lastAutoTable.finalY) + 5;

  const { hallazgos, buenasPracticas } = datos.clasificados.get(ev.id);
  const fotoDe = (f) => datos.fotos.get(f.fotoIds[0]) && { ...datos.fotos.get(f.fotoIds[0]), id: f.fotoIds[0] };

  titulo(ctx, `Hallazgos (${hallazgos.length})`, 40);
  if (!hallazgos.length) parrafo(ctx, 'No hay hallazgos: ningún ítem se calificó con 0 o 1.');
  else {
    tablaConFotos(ctx, hallazgos, {
      fotoDe,
      columnas: {
        titulos: ['Código', 'Ítem', 'Calificación', 'Observación', 'Foto'],
        estilos: { 0: { cellWidth: 14, fontStyle: 'bold' }, 1: { cellWidth: 54 }, 2: { cellWidth: 24 }, 3: { cellWidth: 46 }, 4: { cellWidth: LADO_FOTO.ancho + 3 } },
        celdas: (f) => [f.item.codigo, t(f.item.texto), t(`${f.valor} · ${inst.escala.find((e) => e.nivel === f.valor)?.nombre ?? ''}`), recortar(f.observacion) || '—'],
      },
    });
  }

  titulo(ctx, `Buenas prácticas (${buenasPracticas.length})`, 40);
  if (!buenasPracticas.length) parrafo(ctx, 'No hay ítems calificados con 4.');
  else {
    tablaConFotos(ctx, buenasPracticas, {
      fotoDe,
      omitirFotos: datos.sinFotosBuenasPracticas,
      columnas: {
        titulos: ['Código', 'Ítem', 'Observación', 'Foto'],
        estilos: { 0: { cellWidth: 14, fontStyle: 'bold' }, 1: { cellWidth: 68 }, 2: { cellWidth: 57 }, 3: { cellWidth: LADO_FOTO.ancho + 3 } },
        celdas: (f) => [f.item.codigo, t(f.item.texto), recortar(f.observacion) || '—'],
      },
    });
  }
}

function detalleDigital(ctx, fila) {
  const { doc, interp, datos } = ctx;
  const { evaluaciones, promedio } = fila.digital;
  const modulo = obtenerModulo(ctx.inst, 'digital');
  titulo(ctx, `${modulo.nombre} del área`, 50);
  doc.autoTable({
    startY: ctx.y,
    head: [['Usuario', 'Equipo', 'Cargo', '% digital', 'Nivel', 'Fecha']],
    body: evaluaciones.map((e, i) => [
      t(etiquetaUsuario(e, i, datos.anonimo)),
      t(e.equipo_codigo || '—'),
      t(e.usuario_cargo || '—'),
      e.resultado?.global == null ? { content: 'No evaluable', styles: { textColor: GRIS } } : formatoGlobal(e.resultado.global, interp),
      celdaNivel(e.resultado?.nivel, interp),
      fechaCorta(e.fecha),
    ]),
    ...estiloTabla({ styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 1.8, lineColor: '#C9D2DB', lineWidth: 0.2, textColor: TEXTO, valign: 'middle' } }),
    columnStyles: { 3: { halign: 'right', cellWidth: 24 }, 4: { cellWidth: 30 }, 5: { cellWidth: 22 } },
  });
  ctx.y = doc.lastAutoTable.finalY + 3;
  if (promedio.promedio == null) {
    parrafo(ctx, 'Ningún usuario tiene resultado evaluable: no se calcula promedio del área.', { negrita: true });
  } else {
    parrafo(ctx, `Promedio del área: ${formatoGlobal(promedio.promedio, interp)} (${promedio.evaluados} usuario${promedio.evaluados === 1 ? '' : 's'} evaluado${promedio.evaluados === 1 ? '' : 's'}${promedio.excluidos ? `; ${promedio.excluidos} no evaluable${promedio.excluidos === 1 ? '' : 's'} excluido${promedio.excluidos === 1 ? '' : 's'} del promedio` : ''}) · Nivel: ${promedio.nivel}.`, { negrita: true });
  }
  parrafo(ctx, 'El resultado digital se reporta junto al físico, sin combinarlos.', { tamano: 8, color: GRIS });
}

// --- Plan de acción --------------------------------------------------------

function planDeAccion(ctx) {
  const { doc, informe, datos } = ctx;
  nuevaPagina(ctx);
  titulo(ctx, 'Plan de acción consolidado', 30);
  if (!informe.plan.length) return parrafo(ctx, 'No hay acciones abiertas en los sitios y el periodo seleccionados.');
  doc.autoTable({
    startY: ctx.y,
    head: [['Sitio', 'Área', 'Ítem', 'Acción', 'Responsable', 'Compromiso', 'Atraso (días)']],
    body: informe.plan.map(({ sitio, area, ev, accion, atraso }) => [
      t(sitio?.nombre),
      t(area?.nombre),
      { content: accion.codigo_item, styles: { fontStyle: 'bold' } },
      recortar(accion.descripcion, 300),
      // En un informe anónimo no se muestra a quién se asignó una acción del módulo digital.
      t(datos.anonimo && ev.modulo === 'digital' ? '—' : accion.responsable),
      fechaCorta(accion.fecha_compromiso),
      { content: atraso ? String(atraso) : '0', styles: { halign: 'center', textColor: atraso ? ROJO : TEXTO, fontStyle: atraso ? 'bold' : 'normal' } },
    ]),
    ...estiloTabla({ styles: { font: 'helvetica', fontSize: 8, cellPadding: 1.5, lineColor: '#C9D2DB', lineWidth: 0.2, textColor: TEXTO, valign: 'top' } }),
    columnStyles: { 0: { cellWidth: 24 }, 1: { cellWidth: 24 }, 2: { cellWidth: 12 }, 3: { cellWidth: 44 }, 4: { cellWidth: 28 }, 5: { cellWidth: 22 }, 6: { cellWidth: 20 } },
  });
  ctx.y = doc.lastAutoTable.finalY + 3;
  parrafo(ctx, `Días de atraso calculados al ${fechaCorta(datos.emision)} (fecha de emisión).`, { tamano: 8, color: GRIS });
}

// --- Anexo -----------------------------------------------------------------

function anexo(ctx) {
  const { doc, inst, interp, informe } = ctx;
  nuevaPagina(ctx);
  titulo(ctx, 'Anexo: escala de calificación e interpretación', 40);

  doc.autoTable({
    startY: ctx.y,
    head: [['Nivel', 'Nombre', 'Criterio']],
    body: inst.escala.map((e) => [{ content: String(e.nivel), styles: { fontStyle: 'bold', halign: 'center' } }, t(e.nombre), t(e.criterio)]),
    ...estiloTabla({ styles: { font: 'helvetica', fontSize: 9, cellPadding: 2, lineColor: '#C9D2DB', lineWidth: 0.2, textColor: TEXTO } }),
    columnStyles: { 0: { cellWidth: 16 }, 1: { cellWidth: 36 } },
  });
  ctx.y = doc.lastAutoTable.finalY + 6;

  titulo(ctx, 'Rangos de interpretación', 40);
  const orden = [...interp].sort((a, b) => a.min - b.min);
  doc.autoTable({
    startY: ctx.y,
    head: [['Rango', 'Nivel', 'Respuesta', 'Reevaluar']],
    body: orden.map((r) => [
      `${String(r.min).replace('.', ',')} % a ${String(r.max).replace('.', ',')} %`,
      celdaNivel(r.nivel, interp),
      t(r.respuesta),
      `${r.reevaluar_meses} ${r.reevaluar_meses === 1 ? 'mes' : 'meses'}`,
    ]),
    ...estiloTabla({ styles: { font: 'helvetica', fontSize: 9, cellPadding: 2, lineColor: '#C9D2DB', lineWidth: 0.2, textColor: TEXTO, valign: 'middle' } }),
    columnStyles: { 0: { cellWidth: 34 }, 1: { cellWidth: 32 }, 3: { cellWidth: 22 } },
  });
  ctx.y = doc.lastAutoTable.finalY + 6;

  const regla = inst.reglas.regla_s_mas_debil;
  parrafo(ctx, `Regla de la S más débil: si el nivel es ${regla.niveles_bloqueados.map((n) => `"${n}"`).join(' o ')} y alguna S está por debajo de ${regla.umbral_porcentaje} %, el nivel pasa a "${regla.nivel_asignado}".`, { tamano: 9 });
  parrafo(ctx, inst.reglas.s_no_evaluable, { tamano: 9 });
  parrafo(ctx, inst.reglas.calculo_s, { tamano: 9 });
  parrafo(ctx, inst.reglas.calculo_global, { tamano: 9 });
  const versiones = informe.versiones;
  const mezcla = versiones.length > 1 || (versiones.length === 1 && versiones[0] !== inst.meta.version);
  parrafo(
    ctx,
    `Instrumento vigente: ${inst.meta.codigo_formato}, versión ${inst.meta.version}.${mezcla ? ` Este informe incluye evaluaciones hechas con las versiones: ${versiones.join(', ')}. Cada evaluación se interpretó con las reglas de su propia versión.` : ''}`,
    { tamano: 9, color: GRIS },
  );
}

// ---------------------------------------------------------------------------
// Generación en el navegador
// ---------------------------------------------------------------------------

/** Cuántos MB suele sumar el contenido que no son fotos: texto, tablas y gráficos por área. */
const MB = 1024 * 1024;
const SOBRECARGA_BASE = 0.3 * MB;
const SOBRECARGA_POR_AREA = 0.12 * MB;
export const LIMITE_PDF = 15 * MB;

/** Estimación del tamaño del PDF a partir de los bytes de fotos ya comprimidas. */
export const estimarTamano = (bytesFotos, areas) => bytesFotos + SOBRECARGA_BASE + SOBRECARGA_POR_AREA * areas;

/**
 * Genera el informe. `opciones.decidirExceso(estimadoMB)` se invoca si el PDF estimado supera 15 MB y debe devolver
 * 'sin-buenas' | 'reducir' | 'continuar' | 'cancelar'. Devuelve { blob, nombre, segundos, informe } o null si se cancela.
 */
export async function generarInforme(filtro, { anonimo = false, onProgreso = () => {}, decidirExceso = async () => 'continuar', limite = LIMITE_PDF } = {}) {
  const inicio = performance.now();
  const [{ instrumentoDe, ctx: contexto }, db, config, { reducirFoto }, graficos] = await Promise.all([
    import('./contexto.js'), import('./db.js'), import('./config.js'), import('./photos.js'), import('./charts.js'),
  ]);
  onProgreso(0.01, 'Reuniendo evaluaciones…');
  const jsPDF = await cargarJsPDF();
  const inst = contexto.instrumento;
  const hoy = hoyLocal();
  const [sitios, areas, evaluaciones, acciones, perfil] = await Promise.all([db.todos('sitios'), db.todos('areas'), db.todos('evaluaciones'), db.todos('acciones'), db.obtenerConfig('perfil')]);
  const informe = seleccionarInforme({ sitios, areas, evaluaciones, acciones }, { ...filtro, hoy, interpretacion: inst.interpretacion });
  if (!informe.sitios.length) throw new Error('No hay evaluaciones cerradas en los sitios, el periodo y los módulos seleccionados.');

  // Instrumento de cada evaluación física y clasificación de ítems.
  const instrumentos = new Map();
  const clasificados = new Map();
  for (const fila of informe.sitios.flatMap((s) => s.areas)) {
    if (!fila.fisico) continue;
    const i = await instrumentoDe(fila.fisico.ev);
    instrumentos.set(fila.fisico.ev.id, i);
    clasificados.set(fila.fisico.ev.id, clasificarItems(i, fila.fisico.ev));
  }

  // Fotos: se comprimen todas antes de armar el PDF para conocer su peso real.
  const solicitadas = fotosDelInforme(informe, clasificados);
  const registros = new Map((await Promise.all([...new Set(solicitadas.map((f) => f.evaluacionId))].map((id) => db.fotosDeEvaluacion(id)))).flat().map((f) => [f.id, f]));
  const comprimidas = new Map();
  const comprimir = async (lista, { lado, calidad }) => {
    for (const [i, f] of lista.entries()) {
      onProgreso(0.05 + (0.55 * i) / Math.max(1, lista.length), `Procesando foto ${i + 1} de ${lista.length}…`);
      const reg = registros.get(f.id);
      if (!reg) continue;
      try {
        comprimidas.set(f.id, await reducirFoto(reg.blob, { lado, calidad }));
      } catch (e) {
        console.warn('Foto omitida', f.id, e);
      }
      await new Promise((ok) => setTimeout(ok)); // cede el hilo para que se pinte el progreso
    }
  };
  let lista = solicitadas;
  let parametros = { lado: config.PDF_FOTO_LADO_MAX, calidad: config.PDF_FOTO_CALIDAD };
  await comprimir(lista, parametros);
  const suma = () => [...comprimidas.values()].reduce((a, f) => a + f.bytes.length, 0);
  const nAreas = informe.sitios.reduce((a, s) => a + s.areas.length, 0);
  let sinFotosBuenasPracticas = false;

  if (estimarTamano(suma(), nAreas) > limite) {
    const decision = await decidirExceso(estimarTamano(suma(), nAreas) / MB);
    if (decision === 'cancelar') return null;
    if (decision === 'sin-buenas') {
      sinFotosBuenasPracticas = true;
      const conservar = new Set(fotosDelInforme(informe, clasificados, { sinBuenasPracticas: true }).map((f) => f.id));
      for (const id of [...comprimidas.keys()]) if (!conservar.has(id)) comprimidas.delete(id);
    } else if (decision === 'reducir') {
      comprimidas.clear();
      parametros = { lado: 600, calidad: 0.5 };
      await comprimir(lista, parametros);
    }
  }

  // Gráficos: radar por área evaluada y barras del % físico.
  const radares = new Map();
  const filasFisicas = informe.sitios.flatMap((s) => s.areas).filter((f) => f.fisico);
  for (const [i, fila] of filasFisicas.entries()) {
    onProgreso(0.62 + (0.06 * i) / Math.max(1, filasFisicas.length), `Dibujando gráfico de ${fila.area.nombre}…`);
    try {
      radares.set(fila.fisico.ev.id, await graficos.radarComoPNG(instrumentos.get(fila.fisico.ev.id) ?? inst, fila.fisico.resultado, 700));
    } catch (e) {
      console.warn('Radar omitido', e);
    }
  }
  const ordenadas = ordenarPorPuntaje(filasFisicas);
  const barras = [];
  for (let i = 0; i < ordenadas.length; i += FILAS_POR_GRAFICO) {
    const trozo = ordenadas.slice(i, i + FILAS_POR_GRAFICO).map((f) => ({
      etiqueta: informe.sitios.length > 1 ? `${f.sitio.nombre} – ${f.area.nombre}` : f.area.nombre,
      valor: f.fisico.resultado.global,
      color: nivelPorRango(f.fisico.resultado.global, inst.interpretacion).color,
    }));
    try {
      barras.push(await graficos.barrasComoPNG(inst, trozo));
    } catch (e) {
      console.warn('Gráfico de barras omitido', e);
    }
  }

  const fotos = new Map([...comprimidas].map(([id, f]) => [id, { id, ...f }]));
  const emision = hoy;
  const logo = await cargarLogo();
  onProgreso(0.7, 'Armando el documento…');
  const doc = construirInforme({ inst, informe, instrumentos, clasificados, fotos, radares, barras, logo, elaboradoPor: perfil, anonimo, sinFotosBuenasPracticas, emision, generado: new Date() }, jsPDF, { onProgreso });
  onProgreso(0.97, 'Terminando el archivo…');
  const blob = doc.output('blob');
  onProgreso(1, 'Listo');
  return { blob, nombre: nombreInforme(informe, emision), segundos: (performance.now() - inicio) / 1000, informe };
}
