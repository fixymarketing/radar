#!/usr/bin/env node
/**
 * Fixy Radar · actualización diaria automática.
 *
 * fuentes externas → búsqueda + análisis con Claude → JSON en /data → interfaz HTML
 *
 * No requiere intervención manual. Lo ejecuta .github/workflows/daily-update.yml
 *
 * Modos:
 *   node scripts/update.mjs            actualización normal
 *   node scripts/update.mjs --dry-run  no escribe archivos, solo informa
 */

import { pathToFileURL } from 'node:url';

import { askForJson } from './lib/claude.js';
import {
  digestAi,
  digestEvents,
  digestNews,
  buildMeta
} from './lib/derive.js';
import {
  mergeAi,
  mergeContent,
  mergeEvents,
  mergeNews,
  mergeOpportunities,
  rotate
} from './lib/merge.js';
import {
  aiPrompt,
  eventsArPrompt,
  eventsIntlPrompt,
  newsPrompt,
  synthesisPrompt,
  systemPrompt
} from './lib/prompts.js';
import {
  addDays,
  ensureDirs,
  isoNow,
  readInternal,
  readJson,
  rebuildArchiveIndex,
  todayAR,
  writeJson
} from './lib/store.js';
import {
  sanitizeAi,
  sanitizeContent,
  sanitizeEvents,
  sanitizeHighlights,
  sanitizeNews,
  sanitizeOpportunities
} from './lib/validate.js';

const DRY = process.argv.includes('--dry-run');
const today = process.env.FIXY_TODAY || todayAR();
const errors = [];
const issues = [];

function longDate(iso) {
  return new Intl.DateTimeFormat('es-AR', {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  }).format(new Date(`${iso}T12:00:00Z`));
}

async function task(name, fn) {
  const started = Date.now();
  try {
    const value = await fn();
    console.log(`✓ ${name} (${((Date.now() - started) / 1000).toFixed(1)}s)`);
    return value;
  } catch (err) {
    console.error(`✗ ${name}: ${err.message}`);
    errors.push({ task: name, message: err.message.slice(0, 400) });
    return null;
  }
}

export async function run() {
  console.log(`\nFixy Radar · actualización ${today}${DRY ? ' (dry-run)' : ''}\n`);
  await ensureDirs();

  const cfg = await readJson('scripts/config.json');
  const system = systemPrompt(cfg);

  const [events, news, ai, opportunities, content, internal] = await Promise.all([
    readJson('data/events.json', []),
    readJson('data/news.json', []),
    readJson('data/ai.json', []),
    readJson('data/opportunities.json', []),
    readJson('data/content.json', []),
    readInternal()
  ]);

  const ctx = {
    today,
    todayLong: longDate(today),
    horizon: addDays(today, cfg.windows.agenda_days),
    knownNews: news.slice(0, 45).map((n) => n.title),
    knownEvents: events
      .filter((e) => e.scope === 'ar')
      .slice(0, 60)
      .map((e) => `${e.name} (${e.date_start || 'sin fecha'})`),
    knownIntl: events
      .filter((e) => e.scope === 'intl')
      .slice(0, 45)
      .map((e) => `${e.name} (${e.date_start || 'sin fecha'})`),
    knownAi: ai.slice(0, 35).map((a) => `${a.name} — ${a.vendor}`),
    knownOpps: opportunities.slice(0, 25).map((o) => `- ${o.title}`),
    knownContent: content.slice(0, 20).map((c) => `- ${c.topic}`)
  };

  // --- Recolección: cada bloque falla de forma aislada ---
  const [newsRaw, eventsArRaw, eventsIntlRaw, aiRaw] = await Promise.all([
    task('Novedades', () =>
      askForJson({
        system,
        prompt: newsPrompt(cfg, ctx),
        maxSearches: cfg.search_budget.news,
        maxTokens: 9000
      })
    ),
    task('Agenda Argentina', () =>
      askForJson({
        system,
        prompt: eventsArPrompt(cfg, ctx),
        maxSearches: cfg.search_budget.events_ar,
        maxTokens: 9000
      })
    ),
    task('Radar internacional', () =>
      askForJson({
        system,
        prompt: eventsIntlPrompt(cfg, ctx),
        maxSearches: cfg.search_budget.events_intl,
        maxTokens: 8000
      })
    ),
    task('AI Radar', () =>
      askForJson({
        system,
        prompt: aiPrompt(cfg, ctx),
        maxSearches: cfg.search_budget.ai,
        maxTokens: 8000
      })
    )
  ]);

  const incomingNews = sanitizeNews(newsRaw?.data, { issues });
  const incomingAr = sanitizeEvents(eventsArRaw?.data, 'ar', { issues });
  const incomingIntl = sanitizeEvents(eventsIntlRaw?.data, 'intl', { issues });
  const incomingAi = sanitizeAi(aiRaw?.data, { issues });

  console.log(
    `\n  novedades: ${incomingNews.length} · eventos AR: ${incomingAr.length} · eventos INTL: ${incomingIntl.length} · IA: ${incomingAi.length}`
  );
  if (issues.length) {
    console.log(`  descartados por control de calidad: ${issues.length}`);
    for (const i of issues.slice(0, 12)) console.log(`    - [${i.kind}] ${i.reason}: ${i.label}`);
  }

  // --- Fusión sin duplicados y sin tocar datos internos ---
  const mergedNews = mergeNews(news, incomingNews, today);
  const mergedEventsAr = mergeEvents(events, incomingAr, today);
  const mergedEvents = mergeEvents(mergedEventsAr.items, incomingIntl, today);
  const mergedAi = mergeAi(ai, incomingAi, today);

  // --- Análisis transversal: oportunidades, contenido y destacados ---
  const synthCtx = {
    ...ctx,
    newsDigest: digestNews(mergedNews.items, today),
    eventsDigest: digestEvents(mergedEvents.items, today),
    aiDigest: digestAi(mergedAi.items, today)
  };
  const synthesis = await task('Oportunidades y contenido', () =>
    askForJson({
      system,
      prompt: synthesisPrompt(cfg, synthCtx),
      maxSearches: cfg.search_budget.synthesis,
      maxTokens: 6000
    })
  );

  const incomingOpps = sanitizeOpportunities(synthesis?.data?.opportunities, { issues });
  const incomingContent = sanitizeContent(synthesis?.data?.content, { issues });

  // Si el análisis del día falla, se conserva el resumen anterior en lugar de
  // degradar la home a destacados genéricos. Se avisa que es del día previo.
  let highlights = sanitizeHighlights(synthesis?.data?.highlights);
  let summaryLine =
    typeof synthesis?.data?.summary_line === 'string' ? synthesis.data.summary_line.trim() : null;
  let carriedOver = false;

  if (!synthesis || (!highlights.length && !summaryLine)) {
    const previous = await readJson('data/meta.json', null);
    if (previous?.highlights?.length) {
      highlights = previous.highlights.map((h) => ({
        title: h.title,
        kind: h.kind,
        priority: h.priority,
        one_liner: h.one_liner
      }));
      summaryLine = previous.summary_line;
      carriedOver = true;
      console.log('  · el análisis del día no se pudo generar: se conserva el resumen anterior');
    }
  }

  const mergedOpps = mergeOpportunities(opportunities, incomingOpps.slice(0, 3), today);
  const mergedContent = mergeContent(content, incomingContent, today);

  // --- Rotación al histórico ---
  const rotated = await rotate(
    {
      events: mergedEvents.items,
      news: mergedNews.items,
      ai: mergedAi.items,
      opportunities: mergedOpps.items,
      content: mergedContent.items
    },
    today
  );

  const trimmedOpps = rotated.opportunities
    .sort((a, b) => (b.first_seen || '').localeCompare(a.first_seen || ''))
    .slice(0, cfg.limits.opportunities_total);

  const meta = buildMeta({
    events: rotated.events,
    news: rotated.news,
    ai: rotated.ai,
    opportunities: trimmedOpps,
    content: rotated.content,
    highlights,
    summaryLine,
    runStatus: errors.length === 0 ? 'ok' : errors.length >= 5 ? 'error' : 'parcial',
    runErrors: errors,
    today,
    counters: {
      added_news: mergedNews.added,
      updated_news: mergedNews.updated,
      added_events: mergedEventsAr.added + mergedEvents.added,
      updated_events: mergedEventsAr.updated + mergedEvents.updated,
      added_ai: mergedAi.added,
      archived: Object.values(rotated.moved).reduce((a, b) => a + b, 0),
      discarded_quality: issues.length
    }
  });

  if (carriedOver) meta.summary_from_previous_day = true;

  const summary = {
    date: today,
    at: isoNow(),
    status: meta.run_status,
    added: {
      news: mergedNews.added,
      events: mergedEventsAr.added + mergedEvents.added,
      ai: mergedAi.added,
      opportunities: mergedOpps.added,
      content: mergedContent.added
    },
    updated: {
      news: mergedNews.updated,
      events: mergedEventsAr.updated + mergedEvents.updated,
      ai: mergedAi.updated
    },
    archived: rotated.moved,
    discarded: issues.length,
    errors
  };

  if (DRY) {
    console.log('\n--- dry-run: no se escribió ningún archivo ---');
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  await writeJson('data/events.json', rotated.events);
  await writeJson('data/news.json', rotated.news);
  await writeJson('data/ai.json', rotated.ai);
  await writeJson('data/opportunities.json', trimmedOpps);
  await writeJson('data/content.json', rotated.content);
  await writeJson('data/meta.json', meta);
  await rebuildArchiveIndex();

  const runs = await readJson('data/runs.json', []);
  runs.unshift(summary);
  await writeJson('data/runs.json', runs.slice(0, 40));

  // El archivo de estado interno se lee para verificar que sigue intacto, nunca se escribe.
  console.log(`\n  estado interno preservado: ${Object.keys(internal.statuses || {}).length} marcas`);
  console.log(
    `  totales → eventos ${rotated.events.length} · novedades ${rotated.news.length} · IA ${rotated.ai.length} · oportunidades ${trimmedOpps.length} · contenido ${rotated.content.length}`
  );
  console.log(`  estado de la corrida: ${meta.run_status}\n`);

  if (meta.run_status === 'error') process.exitCode = 1;
  return meta;
}

// Se ejecuta solo cuando se lo invoca directamente, así las pruebas pueden
// importar run() y esperarlo de verdad en lugar de adivinar cuánto tarda.
const invocadoDirectamente =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invocadoDirectamente) {
  run().catch((err) => {
    console.error(`\nFallo general: ${err.stack || err.message}`);
    process.exitCode = 1;
  });
}
