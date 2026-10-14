// Estado compartido de la app: instrumento vigente y utilidades para obtener el de cada evaluación.
import * as db from './db.js';
import { claveInstrumento } from './instrumento.js';

export const ctx = {
  instrumento: null, // instrumento vigente (el del JSON publicado)
  hash: null,
  clave: null,
  advertencias: [],
};

/**
 * Instrumento con el que se creó una evaluación. Si el JSON publicado cambió desde entonces,
 * se usa la copia guardada para que la evaluación se siga interpretando con su versión.
 */
export async function instrumentoDe(ev) {
  const clave = claveInstrumento(ev.instrumento_version, ev.instrumento_hash);
  if (clave === ctx.clave) return ctx.instrumento;
  const copia = await db.obtener('instrumentos', clave);
  return copia ? copia.json : ctx.instrumento;
}
