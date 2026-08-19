#!/usr/bin/env node
/**
 * Carga inicial: convierte /seed (investigación verificada) en /data con ids
 * estables, usando exactamente la misma lógica de fusión que la corrida diaria.
 *
 *   node scripts/seed.mjs
 *
 * Es idempotente: correrlo dos veces no duplica nada.
 */

import { buildMeta } from './lib/derive.js';
import {
  mergeAi,
  mergeContent,
  mergeEvents,
  mergeNews,
  mergeOpportunities,
  rotate
} from './lib/merge.js';
import { ensureDirs, isoNow, readJson, rebuildArchiveIndex, todayAR, writeJson } from './lib/store.js';
import {
  sanitizeAi,
  sanitizeContent,
  sanitizeEvents,
  sanitizeNews,
  sanitizeOpportunities
} from './lib/validate.js';

const today = process.env.FIXY_TODAY || todayAR();
const issues = [];

async function main() {
  await ensureDirs();

  const [seedAr, seedIntl, seedNews, seedAi, seedOpps, seedContent, market] = await Promise.all([
    readJson('seed/events-ar.json', []),
    readJson('seed/events-intl.json', []),
    readJson('seed/news.json', []),
    readJson('seed/ai.json', []),
    readJson('seed/opportunities.json', []),
    readJson('seed/content.json', []),
    readJson('seed/market.json', {})
  ]);

  const [events, news, ai, opportunities, content] = await Promise.all([
    readJson('data/events.json', []),
    readJson('data/news.json', []),
    readJson('data/ai.json', []),
    readJson('data/opportunities.json', []),
    readJson('data/content.json', [])
  ]);

  const mergedAr = mergeEvents(events, sanitizeEvents(seedAr, 'ar', { issues }), today);
  const mergedEvents = mergeEvents(mergedAr.items, sanitizeEvents(seedIntl, 'intl', { issues }), today);
  const mergedNews = mergeNews(news, sanitizeNews(seedNews, { issues }), today);
  const mergedAi = mergeAi(ai, sanitizeAi(seedAi, { issues }), today);
  const mergedOpps = mergeOpportunities(
    opportunities,
    sanitizeOpportunities(seedOpps, { issues }),
    today
  );
  const mergedContent = mergeContent(content, sanitizeContent(seedContent, { issues }), today);

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

  const highlights = [
    {
      title: 'eCommerce Day Argentina 2026',
      kind: 'event',
      priority: 'alta',
      one_liner: 'Es el 27 de agosto: la mayor concentración de decisores de eCommerce del país en un solo día.'
    },
    {
      title: 'ARCA reglamentó la exportación comercial por vía postal sin límite de monto',
      kind: 'news',
      priority: 'alta',
      one_liner: 'Habilita una línea de negocio nueva: exportación puerta a puerta para tiendas online argentinas.'
    },
    {
      title: 'Mercado Libre construirá en Córdoba su primer centro de almacenamiento fuera del AMBA: US$91 millones',
      kind: 'news',
      priority: 'alta',
      one_liner: 'Marca el reloj: hay 12 a 18 meses para posicionarse en el interior antes de que opere.'
    },
    {
      title: 'Los costos logísticos subieron 2,25% en julio, con peajes +18,3%',
      kind: 'news',
      priority: 'alta',
      one_liner: 'La última milla acumula 26,5% en el año, por encima del índice general: argumento duro para renegociar tarifas.'
    },
    {
      title: 'Claude Cowork en el panel lateral de Chrome',
      kind: 'ai',
      priority: 'alta',
      one_liner: 'Permite automatizar los portales de couriers que no tienen API, sin desarrollo.'
    }
  ];

  const meta = buildMeta({
    events: rotated.events,
    news: rotated.news,
    ai: rotated.ai,
    opportunities: rotated.opportunities,
    content: rotated.content,
    highlights,
    summaryLine:
      'Se abrió la exportación postal sin tope, Mercado Libre invierte en Córdoba y el costo de última milla sigue corriendo por encima de la inflación: hay agenda comercial y agenda de costos en la misma semana.',
    runStatus: 'ok',
    today,
    counters: { seeded: true }
  });

  // Si la carga inicial se hace con una fecha explícita, la marca de tiempo la acompaña
  // para que la interfaz no muestre una fecha y una hora de días distintos.
  if (process.env.FIXY_TODAY) {
    const d = new Date(`${today}T12:00:00-03:00`);
    meta.last_updated_ar = new Intl.DateTimeFormat('es-AR', {
      timeZone: 'America/Argentina/Buenos_Aires',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false
    }).format(d);
    meta.generated_at = d.toISOString();
  }

  await writeJson('data/events.json', rotated.events);
  await writeJson('data/news.json', rotated.news);
  await writeJson('data/ai.json', rotated.ai);
  await writeJson('data/opportunities.json', rotated.opportunities);
  await writeJson('data/content.json', rotated.content);
  await writeJson('data/market.json', market);
  await writeJson('data/meta.json', meta);
  await rebuildArchiveIndex();

  const internalPath = 'data/internal/event-status.json';
  const internal = await readJson(internalPath, null);
  if (!internal) {
    await writeJson(internalPath, {
      version: 1,
      note: 'Datos internos de Fixy (Vamos / Evaluar / No vamos y notas). La automatización diaria NUNCA escribe este archivo.',
      updated_at: isoNow(),
      statuses: {}
    });
  }

  await writeJson('data/runs.json', [
    {
      date: today,
      at: isoNow(),
      status: 'ok',
      note: 'Carga inicial curada a mano con búsqueda web verificada.',
      added: {
        news: mergedNews.added,
        events: mergedAr.added + mergedEvents.added,
        ai: mergedAi.added,
        opportunities: mergedOpps.added,
        content: mergedContent.added
      },
      archived: rotated.moved,
      discarded: issues.length,
      errors: []
    }
  ]);

  console.log(
    `Carga inicial lista → eventos ${rotated.events.length} · novedades ${rotated.news.length} · IA ${rotated.ai.length} · oportunidades ${rotated.opportunities.length} · contenido ${rotated.content.length}`
  );
  if (issues.length) {
    console.log(`Descartados por control de calidad: ${issues.length}`);
    for (const i of issues) console.log(`  - [${i.kind}] ${i.reason}: ${i.label}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
