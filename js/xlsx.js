// Escritor mínimo de archivos Excel (.xlsx) sin dependencias: un zip sin compresión con el XML de cada hoja.
// Soporta varias hojas, encabezado con estilo, anchos de columna, panel congelado, filtro, números y fechas.

const codificador = new TextEncoder();

// ---------------------------------------------------------------------------
// ZIP sin compresión (método "stored")
// ---------------------------------------------------------------------------

const TABLA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = TABLA_CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Fecha y hora en formato MS-DOS (las usa el encabezado del zip). */
function fechaDOS(fecha) {
  const hora = (fecha.getHours() << 11) | (fecha.getMinutes() << 5) | (fecha.getSeconds() >> 1);
  const dia = ((Math.max(1980, fecha.getFullYear()) - 1980) << 9) | ((fecha.getMonth() + 1) << 5) | fecha.getDate();
  return { hora, dia };
}

/** Arma un zip con los archivos dados: [{ nombre, contenido (string o Uint8Array) }]. Devuelve Uint8Array. */
export function crearZip(archivos, fecha = new Date()) {
  const { hora, dia } = fechaDOS(fecha);
  const locales = [];
  const centrales = [];
  let desplazamiento = 0;
  for (const { nombre, contenido } of archivos) {
    const nombreBytes = codificador.encode(nombre);
    const datos = typeof contenido === 'string' ? codificador.encode(contenido) : contenido;
    const crc = crc32(datos);

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true); // versión necesaria
    local.setUint16(6, 0x0800, true); // nombres en UTF-8
    local.setUint16(8, 0, true); // sin compresión
    local.setUint16(10, hora, true);
    local.setUint16(12, dia, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, datos.length, true);
    local.setUint32(22, datos.length, true);
    local.setUint16(26, nombreBytes.length, true);
    locales.push(new Uint8Array(local.buffer), nombreBytes, datos);

    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(4, 20, true);
    central.setUint16(6, 20, true);
    central.setUint16(8, 0x0800, true);
    central.setUint16(10, 0, true);
    central.setUint16(12, hora, true);
    central.setUint16(14, dia, true);
    central.setUint32(16, crc, true);
    central.setUint32(20, datos.length, true);
    central.setUint32(24, datos.length, true);
    central.setUint16(28, nombreBytes.length, true);
    central.setUint32(42, desplazamiento, true);
    centrales.push(new Uint8Array(central.buffer), nombreBytes);
    desplazamiento += 30 + nombreBytes.length + datos.length;
  }
  const tamanoCentral = centrales.reduce((n, p) => n + p.length, 0);
  const fin = new DataView(new ArrayBuffer(22));
  fin.setUint32(0, 0x06054b50, true);
  fin.setUint16(8, archivos.length, true);
  fin.setUint16(10, archivos.length, true);
  fin.setUint32(12, tamanoCentral, true);
  fin.setUint32(16, desplazamiento, true);

  const piezas = [...locales, ...centrales, new Uint8Array(fin.buffer)];
  const salida = new Uint8Array(piezas.reduce((n, p) => n + p.length, 0));
  let pos = 0;
  for (const p of piezas) {
    salida.set(p, pos);
    pos += p.length;
  }
  return salida;
}

// ---------------------------------------------------------------------------
// Hojas de cálculo
// ---------------------------------------------------------------------------

/** Escapa texto para XML y quita los caracteres de control que Excel no admite. */
export function xmlSeguro(texto) {
  return String(texto ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
    .replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

/** Letras de columna de Excel: 0 → A, 25 → Z, 26 → AA. */
export function letraColumna(indice) {
  let n = indice;
  let letras = '';
  do {
    letras = String.fromCharCode(65 + (n % 26)) + letras;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return letras;
}

/** Días desde 1899-12-30 (el origen de las fechas de Excel) para una fecha AAAA-MM-DD. */
export function serieExcel(fechaISO) {
  const [a, m, d] = fechaISO.slice(0, 10).split('-').map(Number);
  return Math.round((Date.UTC(a, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000);
}

/** Nombre de hoja válido: hasta 31 caracteres y sin [ ] : * ? / \ */
export const nombreHoja = (nombre) => String(nombre).replace(/[[\]:*?/\\]/g, ' ').trim().slice(0, 31) || 'Hoja';

// Estilos: 0 normal, 1 encabezado, 2 número con un decimal, 3 fecha
const ESTILO = { texto: 0, encabezado: 1, numero: 2, fecha: 3 };

function celda(valor, tipo, fila, columna) {
  if (valor === null || valor === undefined || valor === '') return '';
  const ref = `${letraColumna(columna)}${fila}`;
  if (tipo === 'fecha') return `<c r="${ref}" s="${ESTILO.fecha}"><v>${serieExcel(valor)}</v></c>`;
  if (typeof valor === 'number' && Number.isFinite(valor)) return `<c r="${ref}" s="${tipo === 'numero' ? ESTILO.numero : ESTILO.texto}"><v>${valor}</v></c>`;
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlSeguro(valor)}</t></is></c>`;
}

/**
 * XML de una hoja. `hoja`: { nombre, columnas: [{ titulo, ancho, tipo: 'texto'|'numero'|'fecha' }], filas: [[...]], congelarColumnas }.
 */
export function xmlHoja(hoja) {
  const { columnas, filas, congelarColumnas = 0 } = hoja;
  const encabezado = columnas.map((c, i) => `<c r="${letraColumna(i)}1" s="${ESTILO.encabezado}" t="inlineStr"><is><t>${xmlSeguro(c.titulo)}</t></is></c>`).join('');
  const cuerpo = filas.map((f, r) => `<row r="${r + 2}">${columnas.map((c, i) => celda(f[i], c.tipo, r + 2, i)).join('')}</row>`).join('');
  const ultima = `${letraColumna(columnas.length - 1)}${filas.length + 1}`;
  const panel = `<pane ${congelarColumnas ? `xSplit="${congelarColumnas}" ` : ''}ySplit="1" topLeftCell="${letraColumna(congelarColumnas)}2" activePane="${congelarColumnas ? 'bottomRight' : 'bottomLeft'}" state="frozen"/>`;
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `<dimension ref="A1:${ultima}"/>` +
    `<sheetViews><sheetView workbookViewId="0">${panel}</sheetView></sheetViews>` +
    '<sheetFormatPr defaultRowHeight="15"/>' +
    `<cols>${columnas.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.ancho ?? 14}" customWidth="1"/>`).join('')}</cols>` +
    `<sheetData><row r="1" ht="32" customHeight="1">${encabezado}</row>${cuerpo}</sheetData>` +
    `<autoFilter ref="A1:${ultima}"/>` +
    '</worksheet>'
  );
}

const ESTILOS_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<numFmts count="2"><numFmt numFmtId="164" formatCode="0.0"/><numFmt numFmtId="165" formatCode="dd/mm/yyyy"/></numFmts>' +
  '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts>' +
  '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF0054A4"/><bgColor indexed="64"/></patternFill></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="4">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' +
  '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '</cellXfs>' +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  '</styleSheet>';

/** Libro de Excel como Blob. `hojas`: ver xmlHoja. */
export function crearXlsx(hojas, fecha = new Date()) {
  const nombres = hojas.map((h, i) => {
    const base = nombreHoja(h.nombre);
    return hojas.slice(0, i).some((x) => nombreHoja(x.nombre).toLowerCase() === base.toLowerCase()) ? `${base.slice(0, 28)} ${i + 1}` : base;
  });
  const archivos = [
    {
      nombre: '[Content_Types].xml',
      contenido:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        hojas.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
        '</Types>',
    },
    {
      nombre: '_rels/.rels',
      contenido: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    },
    {
      nombre: 'xl/workbook.xml',
      contenido:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
        nombres.map((n, i) => `<sheet name="${xmlSeguro(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
        '</sheets></workbook>',
    },
    {
      nombre: 'xl/_rels/workbook.xml.rels',
      contenido:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        hojas.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
        `<Relationship Id="rId${hojas.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    },
    { nombre: 'xl/styles.xml', contenido: ESTILOS_XML },
    ...hojas.map((h, i) => ({ nombre: `xl/worksheets/sheet${i + 1}.xml`, contenido: xmlHoja(h) })),
  ];
  return new Blob([crearZip(archivos, fecha)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
