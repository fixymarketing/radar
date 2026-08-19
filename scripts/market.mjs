#!/usr/bin/env node
/**
 * Aplica indicadores de mercado nuevos o actualizados a data/market.json.
 *
 * data/market.json son indicadores macro (INDEC, CACE, CEDOL, AECAUM, Tiendanube,
 * ARCA) que se publican mensual, semestral o trimestralmente: no cambian todos los
 * días, así que viven fuera del proceso diario y se tocan solo cuando hay dato nuevo.
 *
 * Uso:
 *   node scripts/market.mjs --research <dir>          aplica <dir>/market.json
 *   node scripts/market.mjs --research <dir> --dry-run  muestra qué haría
 *
 * Forma de <dir>/market.json: un array (vacío si no hay nada nuevo, que es lo
 * normal). Cada elemento es un indicador con la misma forma que los de
 * data/market.json más dos campos de control:
 *   "_accion":    "agregar" | "actualizar"
 *   "_reemplaza": label/title/name exacto del indicador que reemplaza (si actualiza)
 *   "_seccion":   "stats" | "trends" | "commercial_dates" | "regulation"
 *                 (opcional: si no está, se deduce por los campos del objeto)
 */

import { readJson, writeJson } from './lib/store.js';
import { researchDir } from './lib/research.js';

const DRY = process.argv.includes('--dry-run');

const SECTIONS = {
  stats: { key: 'label', required: ['label', 'value', 'period', 'source_url'] },
  trends: { key: 'title', required: ['title', 'summary', 'source_url'] },
  commercial_dates: { key: 'name', required: ['name', 'source_url'] },
  regulation: { key: 'title', required: ['title', 'summary', 'source_url'] }
};

function guessSection(item) {
  if (item._seccion && SECTIONS[item._seccion]) return item._seccion;
  if ('value' in item && 'period' in item) return 'stats';
  if ('date_start' in item || 'confirmed' in item) return 'commercial_dates';
  if ('status' in item) return 'regulation';
  if ('summary' in item) return 'trends';
  return null;
}

const dir = researchDir();
if (!dir) {
  console.error('Falta --research <dir> (o FIXY_RESEARCH_DIR).');
  process.exit(1);
}

const incoming = await readJson(`${dir}/market.json`, null);
if (!Array.isArray(incoming)) {
  console.error(`${dir}/market.json no existe o no es un array. Nada que aplicar.`);
  process.exit(1);
}
if (!incoming.length) {
  console.log('Sin indicadores nuevos: data/market.json queda como está.');
  process.exit(0);
}

const market = await readJson('data/market.json', null);
if (!market || typeof market !== 'object') {
  console.error('data/market.json no se pudo leer: no se toca nada.');
  process.exit(1);
}

const applied = [];
const skipped = [];

for (const raw of incoming) {
  const section = guessSection(raw);
  if (!section) {
    skipped.push(['sección desconocida', JSON.stringify(raw).slice(0, 80)]);
    continue;
  }
  const spec = SECTIONS[section];
  const item = { ...raw };
  const accion = item._accion === 'agregar' ? 'agregar' : 'actualizar';
  const reemplaza = item._reemplaza || null;
  delete item._accion;
  delete item._reemplaza;
  delete item._seccion;

  const faltan = spec.required.filter((f) => !item[f]);
  if (faltan.length) {
    skipped.push([`faltan campos: ${faltan.join(', ')}`, item[spec.key] || '(sin nombre)']);
    continue;
  }
  if (!/^https?:\/\//i.test(String(item.source_url))) {
    skipped.push(['URL de fuente inválida', item[spec.key]]);
    continue;
  }

  const list = Array.isArray(market[section]) ? market[section] : (market[section] = []);
  const target = reemplaza || item[spec.key];
  const idx = list.findIndex((x) => x[spec.key] === target);

  if (accion === 'actualizar' && idx !== -1) {
    const before = list[idx];
    if (JSON.stringify(before) === JSON.stringify(item)) {
      skipped.push(['sin cambios respecto de lo publicado', item[spec.key]]);
      continue;
    }
    list[idx] = item;
    applied.push(`↻ ${section}: ${item[spec.key]} — ${before.period || ''} → ${item.period || ''}`);
  } else if (idx !== -1) {
    skipped.push(['ya existe con ese nombre (usá _accion: actualizar)', item[spec.key]]);
  } else {
    list.push(item);
    applied.push(`+ ${section}: ${item[spec.key]}`);
  }
}

for (const [reason, label] of skipped) console.log(`  · descartado (${reason}): ${label}`);
for (const line of applied) console.log(`  ${line}`);

if (!applied.length) {
  console.log('Nada que aplicar: data/market.json queda intacto.');
  process.exit(0);
}
if (DRY) {
  console.log('\n--- dry-run: no se escribió data/market.json ---');
  process.exit(0);
}

await writeJson('data/market.json', market);
console.log(`\ndata/market.json actualizado: ${applied.length} cambio(s).`);
