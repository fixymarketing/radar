#!/usr/bin/env node
/**
 * Chequeo de integridad. Corre en la Action después de actualizar y también
 * se puede correr a mano con `npm run check`.
 *
 * Verifica que los JSON existan, sean válidos, tengan ids únicos, fuentes con
 * URL y que el archivo de datos internos siga intacto.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { ROOT, readJson } from './lib/store.js';

const problems = [];
const warnings = [];

function must(cond, message) {
  if (!cond) problems.push(message);
}

function should(cond, message) {
  if (!cond) warnings.push(message);
}

async function exists(rel) {
  try {
    await fs.access(path.join(ROOT, rel));
    return true;
  } catch {
    return false;
  }
}

function checkIds(list, label) {
  const seen = new Set();
  for (const item of list) {
    must(!!item.id, `${label}: hay un registro sin id`);
    must(!seen.has(item.id), `${label}: id duplicado ${item.id}`);
    seen.add(item.id);
  }
}

function isUrl(v) {
  return typeof v === 'string' && /^https?:\/\//i.test(v);
}

async function main() {
  for (const rel of ['index.html', 'css/styles.css', 'js/app.js', '.nojekyll']) {
    must(await exists(rel), `Falta el archivo ${rel}`);
  }
  should(await exists('assets/logo-fixy.png'), 'Falta assets/logo-fixy.png (la interfaz muestra un recuadro neutro hasta que se suba)');

  const meta = await readJson('data/meta.json', null);
  must(meta && meta.date, 'data/meta.json no existe o no tiene fecha');
  must(meta && meta.counters, 'data/meta.json no tiene contadores');

  const events = await readJson('data/events.json', []);
  const news = await readJson('data/news.json', []);
  const ai = await readJson('data/ai.json', []);
  const opps = await readJson('data/opportunities.json', []);
  const content = await readJson('data/content.json', []);
  const market = await readJson('data/market.json', {});

  must(Array.isArray(events) && Array.isArray(news) && Array.isArray(ai), 'Los archivos de datos deben ser arrays');

  checkIds(events, 'events');
  checkIds(news, 'news');
  checkIds(ai, 'ai');
  checkIds(opps, 'opportunities');
  checkIds(content, 'content');

  for (const e of events) {
    must(['ar', 'intl'].includes(e.scope), `evento sin scope válido: ${e.name}`);
    must(isUrl(e.url) || isUrl(e.source_url), `evento sin URL: ${e.name}`);
    must(!!e.fixy_relevance, `evento sin relevancia para Fixy: ${e.name}`);
    should(e.date_start || e.date_note, `evento sin fecha ni nota de fecha: ${e.name}`);
  }
  for (const n of news) {
    must(isUrl(n.source_url), `novedad sin fuente: ${n.title}`);
    must(!!n.what_happened && !!n.why_it_matters, `novedad incompleta: ${n.title}`);
  }
  for (const a of ai) {
    must(isUrl(a.source_url), `herramienta de IA sin fuente: ${a.name}`);
    must(!!a.fixy_use, `herramienta de IA sin uso para Fixy: ${a.name}`);
  }
  for (const s of market.stats || []) {
    must(isUrl(s.source_url), `indicador de mercado sin fuente: ${s.label}`);
  }

  const internal = await readJson('data/internal/event-status.json', null);
  must(internal && typeof internal.statuses === 'object', 'Falta o está corrupto data/internal/event-status.json');

  const orphan = Object.keys(internal?.statuses || {}).filter(
    (id) => !events.some((e) => e.id === id)
  );
  should(orphan.length === 0, `hay ${orphan.length} marcas internas de eventos que ya pasaron al archivo (no se borran a propósito)`);

  const archiveIndex = await readJson('data/archive/index.json', { files: [] });
  should(Array.isArray(archiveIndex.files), 'data/archive/index.json inválido');

  console.log(`Chequeo: ${events.length} eventos · ${news.length} novedades · ${ai.length} IA · ${opps.length} oportunidades · ${content.length} contenido`);
  if (warnings.length) {
    console.log('\nAvisos:');
    warnings.forEach((w) => console.log(`  · ${w}`));
  }
  if (problems.length) {
    console.error('\nProblemas:');
    problems.forEach((p) => console.error(`  ✗ ${p}`));
    process.exitCode = 1;
    return;
  }
  console.log('\nTodo en orden.');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
