import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { colorTextoSobre } from '../js/util.js';

// Contraste WCAG AA: 4,5:1 para texto normal. Se lee del CSS real para que un cambio de colores no pase inadvertido.
const css = readFileSync(new URL('../css/app.css', import.meta.url), 'utf8');
const INST = JSON.parse(readFileSync(new URL('../instrumento_5S.json', import.meta.url), 'utf8'));

const variables = Object.fromEntries([...css.slice(0, css.indexOf('}')).matchAll(/--([\w-]+):\s*(#[0-9A-Fa-f]{6})/g)].map((m) => [m[1], m[2]]));
const luminancia = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contraste = (a, b) => {
  const [x, y] = [luminancia(a), luminancia(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
const v = (nombre) => variables[nombre] ?? assert.fail(`falta la variable CSS --${nombre}`);

test('las variables de color se leen del CSS', () => {
  for (const n of ['texto', 'texto-suave', 'fondo', 'superficie', 'marca-primario', 'marca-primario-osc', 'marca-primario-claro', 'marca-acento', 'error', 'error-fondo', 'no-evaluable']) assert.ok(variables[n], n);
});

test('texto y botones de la interfaz cumplen WCAG AA (4,5:1)', () => {
  const pares = [
    ['texto sobre fondo', v('texto'), v('fondo')],
    ['texto sobre superficie', v('texto'), v('superficie')],
    ['texto suave sobre superficie', v('texto-suave'), v('superficie')],
    ['texto suave sobre fondo', v('texto-suave'), v('fondo')],
    ['blanco sobre el azul de marca (barra, botones)', '#FFFFFF', v('marca-primario')],
    ['blanco sobre el azul oscuro', '#FFFFFF', v('marca-primario-osc')],
    ['azul de marca sobre blanco (enlaces, botones secundarios)', v('marca-primario'), '#FFFFFF'],
    ['azul de marca sobre su tono claro', v('marca-primario'), v('marca-primario-claro')],
    ['azul oscuro sobre su tono claro (descriptores)', v('marca-primario-osc'), v('marca-primario-claro')],
    ['texto sobre el amarillo de aviso de actualización', v('texto'), v('marca-acento')],
    ['error sobre blanco', v('error'), '#FFFFFF'],
    ['error sobre su fondo', v('error'), v('error-fondo')],
    ['blanco sobre error (banda de anulada)', '#FFFFFF', v('error')],
    ['blanco sobre no evaluable', '#FFFFFF', v('no-evaluable')],
  ];
  const fallan = pares.filter(([, a, b]) => contraste(a, b) < 4.5).map(([n, a, b]) => `${n}: ${contraste(a, b).toFixed(2)}`);
  assert.deepEqual(fallan, [], `contraste insuficiente: ${fallan.join('; ')}`);
});

test('los chips de aviso y los colores de nivel del instrumento son legibles (el texto se elige por contraste)', () => {
  const aviso = /\.chip--aviso\s*\{[^}]*color:\s*(#[0-9A-Fa-f]{6})/.exec(css)?.[1];
  assert.ok(aviso, 'no se encontró el color del chip de aviso');
  assert.ok(contraste(aviso, v('aviso-fondo')) >= 4.5, `chip de aviso ${contraste(aviso, v('aviso-fondo')).toFixed(2)}`);
  for (const nivel of INST.interpretacion) {
    const texto = colorTextoSobre(nivel.color);
    assert.ok(contraste(texto, nivel.color) >= 4.5, `${nivel.nivel}: texto ${texto} sobre ${nivel.color} = ${contraste(texto, nivel.color).toFixed(2)}`);
  }
});

test('el CSS respeta el tamaño base de 16 px en campos (evita el zoom de iOS) y los objetivos táctiles de 48 px', () => {
  assert.match(css, /font-size:\s*16px;\s*\/\*[^*]*zoom/);
  assert.match(css, /--tap:\s*48px/);
  // Ningún control táctil declara una altura mínima menor a 48 px (salvo la barra de progreso y la barra de S, que no son controles).
  const bajos = [...css.matchAll(/([^{}]+)\{[^}]*min-height:\s*(\d+)px/g)].filter((m) => Number(m[2]) < 48).map((m) => `${m[1].trim()} (${m[2]} px)`);
  assert.deepEqual(bajos, [], `controles con altura mínima menor a 48 px: ${bajos.join(', ')}`);
});
