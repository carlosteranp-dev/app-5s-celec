// Gráficos con Chart.js (local en /lib). El radar sirve para la pantalla y para el PDF.
import { cargarScript } from './util.js';

const RUTA_CHART = 'lib/chart.umd.min.js';

/** Carga Chart.js la primera vez que se necesita. */
export async function cargarChart() {
  if (!window.Chart) await cargarScript(RUTA_CHART);
  return window.Chart;
}

const colorMarca = () => getComputedStyle(document.documentElement).getPropertyValue('--marca-primario').trim() || '#0054A4';

/** Fondo blanco para que el PNG no quede transparente al insertarlo en el PDF. */
const fondoBlanco = {
  id: 'fondoBlanco',
  beforeDraw(chart) {
    const { ctx, width, height } = chart;
    ctx.save();
    ctx.globalCompositeOperation = 'destination-over';
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  },
};

/** Valor de las líneas de referencia, tomado del instrumento: umbral de la S más débil y mínimo del nivel más bajo bloqueado. */
function referencias(inst) {
  const regla = inst.reglas.regla_s_mas_debil;
  const bloqueados = inst.interpretacion.filter((r) => regla.niveles_bloqueados.includes(r.nivel)).sort((a, b) => a.min - b.min);
  const lineas = [{ valor: regla.umbral_porcentaje, rotulo: `Umbral de la S más débil (${regla.umbral_porcentaje} %)`, color: '#B71C1C' }];
  if (bloqueados[0]) lineas.push({ valor: bloqueados[0].min, rotulo: `${bloqueados[0].nivel} (${bloqueados[0].min} %)`, color: bloqueados[0].color });
  return lineas;
}

/**
 * Configuración del radar de las S. Las S no evaluables quedan como hueco (null).
 * `opciones.tamano` activa el modo de PDF: sin animación ni ajuste a la pantalla.
 */
export function configuracionRadar(inst, resultado, { tamano = null } = {}) {
  const etiquetas = resultado.por_s.map((s) => [`${s.id} ${s.nombre}`, s.traduccion]);
  const datos = resultado.por_s.map((s) => (s.evaluable && s.porcentaje !== null ? s.porcentaje : null));
  const refs = referencias(inst);
  const fuente = tamano ? tamano / 45 : 12;
  return {
    type: 'radar',
    data: {
      labels: etiquetas,
      datasets: [
        {
          label: 'Puntaje',
          data: datos,
          borderColor: colorMarca(),
          backgroundColor: `${colorMarca()}40`,
          borderWidth: tamano ? 5 : 2.5,
          pointRadius: tamano ? 9 : 4,
          pointBackgroundColor: colorMarca(),
          spanGaps: false,
        },
        ...refs.map((r) => ({
          label: r.rotulo,
          data: resultado.por_s.map(() => r.valor),
          borderColor: r.color,
          borderDash: [8, 6],
          borderWidth: tamano ? 3 : 1.5,
          pointRadius: 0,
          fill: false,
        })),
      ],
    },
    options: {
      responsive: !tamano,
      maintainAspectRatio: true,
      animation: false,
      devicePixelRatio: tamano ? 1 : undefined,
      scales: {
        r: {
          min: 0,
          max: 100,
          ticks: { stepSize: 20, backdropColor: 'rgba(255,255,255,0)', font: { size: fuente }, color: '#4A5A6A' },
          pointLabels: { font: { size: fuente * 1.1, weight: '600' }, color: '#1B2733' },
          grid: { color: '#C9D2DB' },
          angleLines: { color: '#C9D2DB' },
        },
      },
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: tamano ? 40 : 24, font: { size: fuente }, color: '#1B2733' } },
        tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${c.parsed.r === null ? 'no evaluable' : `${c.parsed.r.toFixed(1).replace('.', ',')} %`}` } },
      },
    },
    plugins: [fondoBlanco],
  };
}

/** Dibuja el radar en un canvas de la pantalla y devuelve el gráfico (para destruirlo al salir). */
export async function dibujarRadar(canvas, inst, resultado) {
  const Chart = await cargarChart();
  return new Chart(canvas, configuracionRadar(inst, resultado));
}

/** Radar como PNG de ancho fijo (no depende del tamaño de la pantalla). */
export async function radarComoPNG(inst, resultado, lado = 900) {
  const Chart = await cargarChart();
  const canvas = document.createElement('canvas');
  canvas.width = lado;
  canvas.height = lado;
  const grafico = new Chart(canvas, configuracionRadar(inst, resultado, { tamano: lado }));
  const png = canvas.toDataURL('image/png');
  grafico.destroy();
  canvas.width = canvas.height = 0;
  return png;
}

// ---------------------------------------------------------------------------
// Barras horizontales: % físico por área (informe por sitios)
// ---------------------------------------------------------------------------

/** Altura en píxeles de un gráfico de barras con `n` filas (el ancho es fijo). */
export const altoBarras = (n) => 110 + 44 * n;

/** Líneas verticales de referencia con su rótulo arriba (60 % y 80 % u otros umbrales del instrumento). */
const lineasReferencia = (lineas, fuente) => ({
  id: 'lineasReferencia',
  afterDatasetsDraw(chart) {
    const { ctx, chartArea, scales } = chart;
    ctx.save();
    ctx.font = `600 ${fuente}px sans-serif`;
    ctx.textAlign = 'center';
    for (const l of lineas) {
      const x = scales.x.getPixelForValue(l.valor);
      ctx.strokeStyle = l.color;
      ctx.lineWidth = 3;
      ctx.setLineDash([10, 7]);
      ctx.beginPath();
      ctx.moveTo(x, chartArea.top - 6);
      ctx.lineTo(x, chartArea.bottom);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = l.color;
      ctx.fillText(`${l.valor} %`, x, chartArea.top - 12);
    }
    ctx.restore();
  },
});

/** Valor numérico al final de cada barra. */
const valoresEnBarras = (fuente) => ({
  id: 'valoresEnBarras',
  afterDatasetsDraw(chart) {
    const { ctx } = chart;
    ctx.save();
    ctx.font = `700 ${fuente}px sans-serif`;
    ctx.fillStyle = '#1B2733';
    ctx.textBaseline = 'middle';
    chart.getDatasetMeta(0).data.forEach((barra, i) => {
      const v = chart.data.datasets[0].data[i];
      const texto = `${v.toFixed(1).replace('.', ',')} %`;
      ctx.strokeStyle = '#fff'; // halo blanco: el número se lee aunque cruce una línea de referencia
      ctx.lineWidth = 7;
      ctx.strokeText(texto, barra.x + 10, barra.y);
      ctx.fillText(texto, barra.x + 10, barra.y);
    });
    ctx.restore();
  },
});

/**
 * Configuración del gráfico de barras horizontales. `filas`: [{ etiqueta, valor, color }] ya ordenadas.
 * Las líneas de referencia salen del instrumento (umbral de la S más débil y primer nivel bloqueado).
 */
export function configuracionBarras(inst, filas, { ancho }) {
  const fuente = Math.round(ancho / 50);
  return {
    type: 'bar',
    data: {
      labels: filas.map((f) => f.etiqueta),
      datasets: [{ data: filas.map((f) => f.valor), backgroundColor: filas.map((f) => f.color), borderWidth: 0, barPercentage: 0.7 }],
    },
    options: {
      indexAxis: 'y',
      responsive: false,
      animation: false,
      devicePixelRatio: 1,
      layout: { padding: { top: fuente * 1.6, right: fuente * 4 } },
      scales: {
        x: { min: 0, max: 100, ticks: { stepSize: 20, font: { size: fuente }, color: '#4A5A6A', callback: (v) => `${v} %` }, grid: { color: '#E1E7ED' } },
        y: { ticks: { font: { size: fuente }, color: '#1B2733' }, grid: { display: false } },
      },
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
    },
    plugins: [fondoBlanco, lineasReferencia(referencias(inst), fuente), valoresEnBarras(fuente)],
  };
}

/** Gráfico de barras como PNG de ancho fijo. */
export async function barrasComoPNG(inst, filas, { ancho = 1100 } = {}) {
  const Chart = await cargarChart();
  const canvas = document.createElement('canvas');
  canvas.width = ancho;
  canvas.height = altoBarras(filas.length);
  const grafico = new Chart(canvas, configuracionBarras(inst, filas, { ancho }));
  const png = canvas.toDataURL('image/png');
  grafico.destroy();
  canvas.width = canvas.height = 0;
  return { png, ancho, alto: altoBarras(filas.length) };
}
