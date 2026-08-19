/**
 * Modo investigación externa.
 *
 * El proceso diario puede recibir el material ya buscado y curado desde afuera
 * (una tarea programada de Claude que hace la búsqueda web y escribe un archivo
 * JSON por bloque) en lugar de llamar a la API de Claude desde el propio script.
 *
 * Todo lo demás del proceso no cambia: dedup, control de calidad, fusión,
 * rotación al histórico y derivación del meta siguen siendo los mismos.
 *
 * Uso:
 *   node scripts/update.mjs --research .radar-research
 *   FIXY_RESEARCH_DIR=/ruta/al/material node scripts/update.mjs
 *
 * Archivos esperados dentro del directorio, uno por bloque:
 *   news.json  events-ar.json  events-intl.json  ai.json  synthesis.json
 *
 * Si falta un archivo o tiene JSON inválido, ese bloque falla de forma aislada
 * (igual que si fallara la API) y los datos anteriores quedan intactos.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import { ROOT } from './store.js';

export const RESEARCH_KEYS = ['news', 'events-ar', 'events-intl', 'ai', 'synthesis'];

/** Directorio de investigación pedido por bandera o por variable de entorno. */
export function researchDir(argv = process.argv) {
  const flag = argv.indexOf('--research');
  const fromFlag = flag !== -1 && argv[flag + 1] && !argv[flag + 1].startsWith('--')
    ? argv[flag + 1]
    : null;
  const dir = fromFlag || process.env.FIXY_RESEARCH_DIR || null;
  if (!dir) return null;
  return path.isAbsolute(dir) ? dir : path.join(ROOT, dir);
}

/**
 * Lee el material de un bloque. Devuelve la misma forma que askForJson()
 * ({ data }) para que el resto del proceso no distinga de dónde vino.
 */
export async function readResearch(dir, key) {
  const file = path.join(dir, `${key}.json`);
  let raw;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch {
    throw new Error(`falta el material de investigación: ${key}.json no está en ${dir}`);
  }
  if (!raw.trim()) throw new Error(`${key}.json está vacío`);
  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    throw new Error(`${key}.json no es JSON válido: ${err.message}`);
  }
  return { data, from: 'research' };
}

/** ¿Está el material de este bloque en el directorio? */
export async function hasResearch(dir, key) {
  try {
    const raw = await fs.readFile(path.join(dir, `${key}.json`), 'utf8');
    return Boolean(raw.trim());
  } catch {
    return false;
  }
}

/**
 * Deja el prompt del análisis transversal en <dir>/synthesis-prompt.txt.
 *
 * El análisis del día necesita el material del día YA fusionado, así que no se
 * puede preparar antes de correr el proceso. Cuando falta synthesis.json, el
 * proceso arma el prompt con los digests reales, lo escribe acá y corta ANTES de
 * tocar un solo archivo de data/. Quien investiga lo lee, escribe synthesis.json
 * y vuelve a correr: recién esa segunda pasada escribe.
 */
export async function writeSynthesisPrompt(dir, text) {
  const file = path.join(dir, 'synthesis-prompt.txt');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(file, text, 'utf8');
  return file;
}
