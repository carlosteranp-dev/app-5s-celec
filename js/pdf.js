// Informes PDF con jsPDF y autotable, generados en el dispositivo y sin conexión.
// `construirActa` no toca el DOM (se prueba en Node); `generarActa` reúne los datos del navegador y lo invoca.
import { descriptorNivel, formatoGlobal, formatoPuntaje, obtenerModulo, esNaAutomatico, motivoNaAutomatico } from './calc.js';
import { colorTextoSobre, fechaCorta, nombreSeguro } from './util.js';
import { PAGINA, ANCHO_UTIL, GRIS, limpiarTexto, fechaHora, espacio, titulo, parrafo, pieYEncabezados as pieComun, cargarJsPDF, cargarLogo } from './pdf-comun.js';

export { limpiarTexto };

// ---------------------------------------------------------------------------
// Texto y nombres
// ---------------------------------------------------------------------------

/** Nombre del acta: Acta_5S_<Area>_<AAAAMMDD>.pdf; en digital se añade el equipo para que no choquen actas del mismo día. */
export function nombreActa(ev, area) {
  const partes = ev.modulo === 'digital' ? ['Acta', '5S', 'Digital', area?.nombre, ev.equipo_codigo] : ['Acta', '5S', area?.nombre];
  return `${partes.map(nombreSeguro).filter(Boolean).join('_')}_${ev.fecha.replaceAll('-', '')}.pdf`;
}

// ---------------------------------------------------------------------------
// Construcción del documento
// ---------------------------------------------------------------------------

/**
 * Arma el acta de una evaluación cerrada.
 *
 * @param datos  { inst, ev, area, sitio, resultado, acciones, fotos, radarPNG, logo, generado }
 *               fotos: [{ codigo, bytes (Uint8Array JPEG), ancho, alto, id }]
 *               logo:  { bytes, ancho, alto } (PNG) o null; radarPNG: data URL o null
 * @param jsPDF  constructor de jsPDF (con el plugin autotable aplicado)
 */
export function construirActa(datos, jsPDF, { onProgreso = () => {} } = {}) {
  const { inst, ev, area, sitio, resultado: res } = datos;
  const modulo = obtenerModulo(inst, ev.modulo);
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
  const ctx = { doc, inst, ev, area, sitio, res, modulo, datos, y: PAGINA.margen };
  doc.setProperties({ title: `Acta 5S – ${area?.nombre ?? ''}`, subject: modulo.nombre, author: limpiarTexto(ev.evaluador?.nombre), creator: 'App 5S CELEC SUR' });

  encabezadoPrimeraPagina(ctx);
  if (ev.anulada) bandaAnulada(ctx);
  tablaDatos(ctx);
  bloqueResultado(ctx);
  tablaPuntajes(ctx);
  onProgreso(0.8, 'Dibujando gráfico y tablas…');
  radar(ctx);
  tablaItems(ctx);
  onProgreso(0.88, 'Insertando fotos…');
  seccionFotos(ctx);
  tablaAcciones(ctx);
  seccionFirmas(ctx);
  pieYEncabezados(ctx);
  return doc;
}

const t = limpiarTexto;

function encabezadoPrimeraPagina(ctx) {
  const { doc, inst, ev, area, sitio, modulo, datos } = ctx;
  const { logo } = datos;
  let xTexto = PAGINA.margen;
  if (logo) {
    const alto = 17;
    const ancho = (logo.ancho / logo.alto) * alto;
    doc.addImage(logo.bytes, 'PNG', PAGINA.margen, ctx.y, ancho, alto, 'logo', 'FAST');
    xTexto = PAGINA.margen + ancho + 6;
  }
  doc.setFont('helvetica', 'bold').setFontSize(9).setTextColor(GRIS);
  doc.text(t(inst.meta.organizacion), xTexto, ctx.y + 4);
  doc.setFontSize(17).setTextColor('#003B73');
  doc.text('Acta de Evaluación 5S', xTexto, ctx.y + 11);
  doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor('#1B2733');
  doc.text(t(`${modulo.nombre} · ${sitio?.nombre ?? ''} · ${area?.nombre ?? ''}`), xTexto, ctx.y + 16, { maxWidth: PAGINA.ancho - PAGINA.margen - xTexto });
  ctx.y += 22;
  doc.setDrawColor('#0054A4').setLineWidth(0.8).line(PAGINA.margen, ctx.y, PAGINA.margen + ANCHO_UTIL, ctx.y);
  ctx.y += 4;
  void ev;
}

function bandaAnulada(ctx) {
  const { doc, ev } = ctx;
  const texto = `EVALUACIÓN ANULADA el ${fechaCorta(ev.anulada_fecha)}. Motivo: ${ev.anulada_motivo ?? ''}`;
  const lineas = doc.splitTextToSize(t(texto), ANCHO_UTIL - 6);
  const alto = lineas.length * 4.6 + 4;
  doc.setFillColor('#B71C1C').rect(PAGINA.margen, ctx.y, ANCHO_UTIL, alto, 'F');
  doc.setFont('helvetica', 'bold').setFontSize(10).setTextColor('#FFFFFF');
  doc.text(lineas, PAGINA.margen + 3, ctx.y + 5.2);
  doc.setTextColor('#1B2733');
  ctx.y += alto + 3;
}

function tablaDatos(ctx) {
  const { doc, inst, ev, area, sitio } = ctx;
  const tipo = inst.tipos_area.find((x) => x.codigo === ev.area_tipo);
  const filas = [
    ['Sitio', sitio?.nombre, 'Área', area?.nombre],
    ['Tipo de área', tipo ? `${tipo.nombre} (${tipo.codigo})` : ev.area_tipo, 'Responsable del área', area?.responsable],
    ['Evaluador', `${ev.evaluador?.nombre ?? ''}${ev.evaluador?.cargo ? ` – ${ev.evaluador.cargo}` : ''}`, 'Fecha de la evaluación', fechaCorta(ev.fecha)],
    ['Personas presentes', ev.personas_presentes || '—', 'Primera evaluación', ev.es_primera_evaluacion ? 'Sí' : 'No'],
  ];
  if (ev.modulo === 'digital') {
    filas.push(['Usuario del equipo', `${ev.usuario_nombre ?? ''}${ev.usuario_cargo ? ` – ${ev.usuario_cargo}` : ''}`, 'Equipo', ev.equipo_codigo]);
    filas.push(['Confidencialidad', ev.confidencialidad_aceptada ? 'Reglas aceptadas por el usuario' : 'No registrada', 'Instrumento', `${inst.meta.codigo_formato} v${inst.meta.version}`]);
  } else {
    filas.push(['Instrumento', `${inst.meta.codigo_formato} v${inst.meta.version}`, 'Cierre', ev.fecha_cierre ? fechaHora(new Date(ev.fecha_cierre)) : '—']);
  }
  doc.autoTable({
    startY: ctx.y,
    body: filas.map((f) => f.map((c, i) => ({ content: t(c ?? '—'), styles: i % 2 === 0 ? { fontStyle: 'bold', textColor: '#4A5A6A' } : {} }))),
    theme: 'grid',
    styles: { font: 'helvetica', fontSize: 9, cellPadding: 1.8, lineColor: '#C9D2DB', lineWidth: 0.2, textColor: '#1B2733' },
    columnStyles: { 0: { cellWidth: 30, fillColor: '#F2F5F8' }, 1: { cellWidth: 60 }, 2: { cellWidth: 32, fillColor: '#F2F5F8' }, 3: { cellWidth: 58 } },
    margin: { left: PAGINA.margen, right: PAGINA.margen, top: PAGINA.margenSuperior, bottom: PAGINA.margenInferior },
  });
  ctx.y = doc.lastAutoTable.finalY + 5;
}

function bloqueResultado(ctx) {
  const { doc, inst, res } = ctx;
  const interp = inst.interpretacion;
  const fondo = res.color ?? GRIS;
  espacio(ctx, 40);
  doc.setFillColor(fondo).rect(PAGINA.margen, ctx.y, ANCHO_UTIL, 22, 'F');
  const colorTexto = colorTextoSobre(fondo);
  doc.setFont('helvetica', 'bold').setTextColor(colorTexto);
  doc.setFontSize(24).text(res.global === null ? '—' : formatoGlobal(res.global, interp), PAGINA.margen + 6, ctx.y + 14);
  doc.setFontSize(15).text(t(res.nivel), PAGINA.margen + ANCHO_UTIL - 6, ctx.y + 13.5, { align: 'right' });
  doc.setFontSize(8).setFont('helvetica', 'normal').text('Resultado global', PAGINA.margen + 6, ctx.y + 4.5);
  doc.setTextColor('#1B2733');
  ctx.y += 26;

  const noEvaluables = res.por_s.filter((s) => !s.evaluable);
  if (noEvaluables.length) {
    parrafo(ctx, `No se emite resultado global. ${noEvaluables.map((s) => `${s.id} ${s.nombre}: ${s.motivo_no_evaluable}.`).join(' ')} Solo se reportan las S evaluadas.`, { negrita: true, color: '#B71C1C' });
  }
  if (res.regla_s_debil_aplicada) {
    const plural = res.s_debiles.length > 1;
    parrafo(
      ctx,
      `Se aplicó la regla de la S más débil: por su porcentaje (${formatoGlobal(res.global, interp)}) el nivel sería "${res.nivel_por_rango}", pero ${plural ? 'las S' : 'la S'} ${res.s_debiles.join(', ')} ${plural ? 'están' : 'está'} por debajo de ${inst.reglas.regla_s_mas_debil.umbral_porcentaje} %, por lo que el nivel pasa a "${res.nivel}".`,
      { negrita: true },
    );
  }
  if (res.proxima_evaluacion) {
    parrafo(ctx, `Próxima evaluación sugerida: ${fechaCorta(res.proxima_evaluacion)} (en ${res.reevaluar_meses} ${res.reevaluar_meses === 1 ? 'mes' : 'meses'}). ${res.respuesta ?? ''}`);
  }
  ctx.y += 1;
}

function tablaPuntajes(ctx) {
  const { doc, inst, res } = ctx;
  titulo(ctx, 'Puntajes por S');
  doc.autoTable({
    startY: ctx.y,
    head: [['S', 'Nombre', 'Puntaje', 'Calificados / aplicables', 'N/A manual / automático', 'Estado']],
    body: res.por_s.map((s) => [
      s.id,
      t(`${s.nombre} (${s.traduccion})`),
      s.evaluable ? formatoPuntaje(s.porcentaje) : '—',
      `${s.calificados} / ${s.n}`,
      `${s.na_manuales} / ${s.na_automaticos}`,
      s.evaluable ? 'Evaluable' : t(`No evaluable: ${s.motivo_no_evaluable}`),
    ]),
    theme: 'grid',
    styles: { font: 'helvetica', fontSize: 9, cellPadding: 1.8, lineColor: '#C9D2DB', lineWidth: 0.2, textColor: '#1B2733' },
    headStyles: { fillColor: '#0054A4', textColor: '#FFFFFF', fontStyle: 'bold' },
    columnStyles: { 0: { cellWidth: 12, fontStyle: 'bold' }, 2: { halign: 'right', cellWidth: 20 }, 3: { halign: 'center', cellWidth: 32 }, 4: { halign: 'center', cellWidth: 32 } },
    margin: { left: PAGINA.margen, right: PAGINA.margen, top: PAGINA.margenSuperior, bottom: PAGINA.margenInferior },
  });
  ctx.y = doc.lastAutoTable.finalY + 5;
  void inst;
}

function radar(ctx) {
  const { doc, datos } = ctx;
  if (!datos.radarPNG) return;
  const lado = 88;
  espacio(ctx, lado + 4);
  doc.addImage(datos.radarPNG, 'PNG', PAGINA.margen + (ANCHO_UTIL - lado) / 2, ctx.y, lado, lado, 'radar', 'FAST');
  ctx.y += lado + 4;
}

/** Texto de calificación y observación de un ítem para la tabla del acta. */
function textoItem(ctx, item, r) {
  const { inst, ev } = ctx;
  const motivo = motivoNaAutomatico(inst, item, ev.area_tipo, ev.es_primera_evaluacion);
  if (motivo) {
    const por = motivo === 'tipo' ? 'no aplica al tipo de área' : 'no se evalúa en la primera evaluación del área';
    return { calificacion: 'N/A', observacion: `N/A automático: ${por}.` };
  }
  if (r?.na === 'manual') {
    return { calificacion: 'N/A', observacion: `N/A manual. Justificación: ${r.na_justificacion ?? ''}${r.observacion ? `\n${r.observacion}` : ''}` };
  }
  if (Number.isInteger(r?.valor)) {
    const sinFoto = r.foto_na && !(r.foto_ids?.length > 0) ? 'N/A foto: no se evidencia.' : '';
    return { calificacion: `${r.valor} · ${descriptorNivel(inst, item, r.valor).nombre}`, observacion: [r.observacion ?? '', sinFoto].filter(Boolean).join('\n') };
  }
  return { calificacion: 'Sin calificar', observacion: r?.observacion ?? '' };
}

function tablaItems(ctx) {
  const { doc, modulo, ev } = ctx;
  titulo(ctx, 'Detalle de ítems', 40);
  const porCodigo = new Map(ev.respuestas.map((r) => [r.codigo, r]));
  // Una tabla por S: evita que el título de una S quede solo al pie de la página.
  for (const ese of modulo.eses) {
    const cuerpo = ese.items.map((item) => {
      const { calificacion, observacion } = textoItem(ctx, item, porCodigo.get(item.codigo));
      const auto = esNaAutomatico(ctx.inst, item, ev.area_tipo, ev.es_primera_evaluacion);
      const estilo = auto ? { textColor: GRIS, fillColor: '#F2F5F8' } : {};
      return [
        { content: item.codigo, styles: { fontStyle: 'bold', ...estilo } },
        { content: t(item.texto), styles: estilo },
        { content: t(calificacion), styles: { fontStyle: 'bold', ...estilo } },
        { content: t(observacion), styles: estilo },
      ];
    });
    doc.autoTable({
      startY: ctx.y,
      head: [
        [{ content: t(`${ese.id} ${ese.nombre} – ${ese.traduccion}`), colSpan: 4, styles: { fillColor: '#003B73', textColor: '#FFFFFF', fontStyle: 'bold', fontSize: 9.5 } }],
        [{ content: 'Código' }, { content: 'Ítem' }, { content: 'Calificación' }, { content: 'Observación' }].map((c) => ({ ...c, styles: { fillColor: '#E3EEF9', textColor: '#003B73', fontStyle: 'bold' } })),
      ],
      body: cuerpo,
      theme: 'grid',
      pageBreak: 'avoid',
      styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 1.6, lineColor: '#C9D2DB', lineWidth: 0.2, textColor: '#1B2733', valign: 'top' },
      columnStyles: { 0: { cellWidth: 15 }, 1: { cellWidth: 72 }, 2: { cellWidth: 30 }, 3: { cellWidth: 63 } },
      margin: { left: PAGINA.margen, right: PAGINA.margen, top: PAGINA.margenSuperior, bottom: PAGINA.margenInferior },
      showHead: 'everyPage',
    });
    ctx.y = doc.lastAutoTable.finalY + 4;
  }
  ctx.y += 2;
}

function seccionFotos(ctx) {
  const { doc, datos } = ctx;
  const fotos = datos.fotos ?? [];
  if (!fotos.length) return;
  titulo(ctx, 'Evidencia fotográfica');
  const ancho = 58;
  const alto = 44;
  const separacion = (ANCHO_UTIL - 3 * ancho) / 2;
  fotos.forEach((f, i) => {
    const col = i % 3;
    if (col === 0) espacio(ctx, alto + 9);
    const x = PAGINA.margen + col * (ancho + separacion);
    const escala = Math.min(ancho / f.ancho, alto / f.alto);
    const w = f.ancho * escala;
    const h = f.alto * escala;
    doc.setDrawColor('#C9D2DB').setLineWidth(0.2).rect(x, ctx.y, ancho, alto);
    doc.addImage(f.bytes, 'JPEG', x + (ancho - w) / 2, ctx.y + (alto - h) / 2, w, h, f.id, 'FAST');
    doc.setFont('helvetica', 'bold').setFontSize(8).setTextColor('#1B2733');
    doc.text(t(f.rotulo ?? f.codigo), x, ctx.y + alto + 4);
    if (col === 2 || i === fotos.length - 1) ctx.y += alto + 8;
  });
  ctx.y += 2;
}

function tablaAcciones(ctx) {
  const { doc, datos } = ctx;
  titulo(ctx, 'Acciones correctivas');
  const acciones = (datos.acciones ?? []).filter((a) => a.descripcion?.trim());
  if (!acciones.length) return parrafo(ctx, 'No se registraron acciones.');
  doc.autoTable({
    startY: ctx.y,
    head: [['Ítem', 'Acción', 'Responsable', 'Compromiso', 'Estado']],
    body: acciones.map((a) => [a.codigo_item, t(a.descripcion), t(a.responsable), fechaCorta(a.fecha_compromiso), a.estado === 'cerrada' ? `Cerrada ${fechaCorta(a.fecha_cierre)}` : 'Abierta']),
    theme: 'grid',
    styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 1.6, lineColor: '#C9D2DB', lineWidth: 0.2, textColor: '#1B2733', valign: 'top' },
    headStyles: { fillColor: '#0054A4', textColor: '#FFFFFF', fontStyle: 'bold' },
    columnStyles: { 0: { cellWidth: 15, fontStyle: 'bold' }, 1: { cellWidth: 72 }, 2: { cellWidth: 33 }, 3: { cellWidth: 25 }, 4: { cellWidth: 35 } },
    margin: { left: PAGINA.margen, right: PAGINA.margen, top: PAGINA.margenSuperior, bottom: PAGINA.margenInferior },
  });
  ctx.y = doc.lastAutoTable.finalY + 6;
}

function seccionFirmas(ctx) {
  const { doc, ev, modulo } = ctx;
  titulo(ctx, 'Firmas', 58); // título y recuadros juntos en la misma página
  const rolResponsable = ev.modulo === 'digital' ? 'Usuario del equipo' : 'Responsable del área';
  const nombreResponsable = ev.firmante_responsable || (ev.modulo === 'digital' ? ev.usuario_nombre : ctx.area?.responsable) || '';
  const bloques = [
    { x: PAGINA.margen, imagen: ev.firmas?.evaluador, nombre: ev.evaluador?.nombre, rol: `Evaluador${ev.evaluador?.cargo ? ` – ${ev.evaluador.cargo}` : ''}`, alias: 'firma-evaluador' },
    { x: PAGINA.margen + ANCHO_UTIL / 2 + 5, imagen: ev.firmas?.responsable, nombre: nombreResponsable, rol: rolResponsable, alias: 'firma-responsable', ausente: ev.firma_responsable_ausente },
  ];
  const ancho = ANCHO_UTIL / 2 - 5;
  for (const b of bloques) {
    if (b.imagen) {
      const props = doc.getImageProperties(b.imagen);
      const escala = Math.min(ancho / props.width, 24 / props.height);
      doc.addImage(b.imagen, 'PNG', b.x, ctx.y + 24 - props.height * escala, props.width * escala, props.height * escala, b.alias, 'FAST');
    } else if (b.ausente) {
      doc.setFont('helvetica', 'italic').setFontSize(8.5).setTextColor('#B71C1C');
      doc.text(doc.splitTextToSize(t(`No estuvo presente. Motivo: ${b.ausente}`), ancho), b.x, ctx.y + 8);
    }
    doc.setDrawColor('#1B2733').setLineWidth(0.3).line(b.x, ctx.y + 26, b.x + ancho, ctx.y + 26);
    doc.setFont('helvetica', 'bold').setFontSize(9).setTextColor('#1B2733');
    doc.text(t(b.nombre || '—'), b.x, ctx.y + 31, { maxWidth: ancho });
    doc.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(GRIS);
    doc.text(t(b.rol), b.x, ctx.y + 35.5, { maxWidth: ancho });
  }
  ctx.y += 40;
  void modulo;
}

/** Encabezado de continuación y pie del acta. */
function pieYEncabezados(ctx) {
  const { doc, inst, area, sitio, datos, modulo } = ctx;
  pieComun(doc, {
    organizacion: inst.meta.organizacion,
    encabezado: `Acta de Evaluación 5S · ${sitio?.nombre ?? ''} · ${area?.nombre ?? ''} · ${modulo.nombre}`,
    formato: inst.meta.codigo_formato,
    version: inst.meta.version,
    generado: datos.generado,
  });
}

// ---------------------------------------------------------------------------
// Generación en el navegador
// ---------------------------------------------------------------------------

/**
 * Genera el acta de una evaluación cerrada. Devuelve { blob, nombre }.
 * `onProgreso(fraccion, texto)` permite mostrar el avance (las fotos son lo más lento).
 */
export async function generarActa(ev, { onProgreso = () => {} } = {}) {
  const [{ instrumentoDe }, db, { radarComoPNG }, { reducirFoto }, config] = await Promise.all([
    import('./contexto.js'), import('./db.js'), import('./charts.js'), import('./photos.js'), import('./config.js'),
  ]);
  onProgreso(0.02, 'Preparando…');
  const jsPDF = await cargarJsPDF();
  const inst = await instrumentoDe(ev);
  const area = await db.obtener('areas', ev.area_id);
  const sitio = area ? await db.obtener('sitios', area.sitio_id) : null;
  const acciones = await db.accionesDeEvaluacion(ev.id);
  const registros = await db.fotosDeEvaluacion(ev.id);

  onProgreso(0.05, 'Dibujando gráfico…');
  let radarPNG = null;
  try {
    radarPNG = await radarComoPNG(inst, ev.resultado);
  } catch (e) {
    console.warn('No se pudo dibujar el radar', e);
  }
  const logo = await cargarLogo();

  // Fotos en el orden de los ítems; una a una para no agotar la memoria del celular.
  const porCodigo = new Map(ev.respuestas.map((r) => [r.codigo, r]));
  const orden = obtenerModulo(inst, ev.modulo).eses.flatMap((s) => s.items.map((i) => i.codigo));
  const utiles = registros
    .filter((f) => porCodigo.get(f.codigo_item)?.na !== 'manual')
    .sort((a, b) => orden.indexOf(a.codigo_item) - orden.indexOf(b.codigo_item) || a.fecha.localeCompare(b.fecha));
  const fotos = [];
  for (const [i, f] of utiles.entries()) {
    onProgreso(0.08 + (0.7 * i) / utiles.length, `Procesando foto ${i + 1} de ${utiles.length}…`);
    const r = porCodigo.get(f.codigo_item);
    const { bytes, ancho, alto } = await reducirFoto(f.blob, { lado: config.PDF_FOTO_LADO_MAX, calidad: config.PDF_FOTO_CALIDAD });
    fotos.push({ id: f.id, codigo: f.codigo_item, rotulo: `${f.codigo_item} · nivel ${r?.valor ?? '—'}`, bytes, ancho, alto });
    await new Promise((ok) => setTimeout(ok)); // cede el hilo para que la barra de progreso se pinte
  }

  const doc = construirActa({ inst, ev, area, sitio, resultado: ev.resultado, acciones, fotos, radarPNG, logo, generado: new Date() }, jsPDF, { onProgreso });
  onProgreso(0.97, 'Terminando el archivo…');
  const blob = doc.output('blob');
  onProgreso(1, 'Listo');
  return { blob, nombre: nombreActa(ev, area) };
}
