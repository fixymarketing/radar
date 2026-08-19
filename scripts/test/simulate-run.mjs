#!/usr/bin/env node
/**
 * Prueba end-to-end de la actualización diaria SIN llamar a la API real.
 * Intercepta fetch y devuelve respuestas fabricadas para verificar:
 *   1. que el pipeline completo corre y escribe los JSON,
 *   2. que no se duplican noticias ni eventos ya existentes,
 *   3. que una noticia con la misma URL + parámetros de tracking se detecta igual,
 *   4. que un evento existente se ACTUALIZA en lugar de duplicarse,
 *   5. que el estado interno de Fixy (Vamos / Evaluar) nunca se sobrescribe.
 *
 *   node scripts/test/simulate-run.mjs
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { ROOT, readJson, writeJson } from '../lib/store.js';

const BACKUP = path.join(ROOT, '.test-backup');
const FILES = [
  'data/events.json', 'data/news.json', 'data/ai.json',
  'data/opportunities.json', 'data/content.json', 'data/meta.json',
  'data/runs.json', 'data/internal/event-status.json'
];

async function backup() {
  await fs.mkdir(BACKUP, { recursive: true });
  for (const f of FILES) {
    try { await fs.copyFile(path.join(ROOT, f), path.join(BACKUP, f.replace(/\//g, '__'))); } catch {}
  }
}
async function restore() {
  for (const f of FILES) {
    try { await fs.copyFile(path.join(BACKUP, f.replace(/\//g, '__')), path.join(ROOT, f)); } catch {}
  }
  await fs.rm(BACKUP, { recursive: true, force: true });
}

const failures = [];
const ok = [];
function assert(cond, msg) { (cond ? ok : failures).push(msg); }

const events = await readJson('data/events.json', []);
const news = await readJson('data/news.json', []);

const existingEvent = events.find((e) => e.scope === 'ar' && e.name.includes('ARLOG'));
const existingNews = news.find((n) => n.title.includes('costos logísticos'));

if (!existingEvent || !existingNews) {
  console.error('No se encontraron los registros base para la prueba. Corré `npm run seed` primero.');
  process.exit(1);
}

await backup();

// Marca interna que la automatización NO debe pisar.
await writeJson('data/internal/event-status.json', {
  version: 1,
  note: 'prueba',
  statuses: { [existingEvent.id]: { status: 'vamos', updated_at: new Date().toISOString() } }
});

const REPLIES = {
  novedades: [
    {
      // Misma noticia que ya existe, con la URL ensuciada con tracking.
      title: 'Los costos logisticos subieron 2,25% en julio segun CEDOL',
      what_happened: 'El índice CEDOL-UTN marcó 2,25% en julio de 2026.',
      why_it_matters: 'El costo logístico corre por encima de la inflación.',
      fixy_impact: null,
      category: 'Logística',
      geo: 'Argentina',
      source_name: 'Webpicking',
      source_url: `${existingNews.source_url}?utm_source=newsletter&utm_medium=email`,
      published_date: existingNews.published_date,
      priority: 'alta',
      tags: ['CEDOL']
    },
    {
      title: 'Noticia de prueba realmente nueva sobre lockers en Rosario',
      what_happened: 'Se instalaron lockers de retiro en Rosario.',
      why_it_matters: 'El pickup baja el costo por entrega.',
      fixy_impact: 'Permite ofrecer una alternativa más barata al domicilio.',
      category: 'Última milla',
      geo: 'Argentina',
      source_name: 'Medio de prueba',
      source_url: 'https://ejemplo-de-prueba.com/lockers-rosario',
      published_date: '2026-08-18',
      priority: 'relevante',
      tags: ['lockers']
    },
    { title: 'Item invalido sin fuente', what_happened: 'x', why_it_matters: 'y', category: 'Retail', geo: 'Argentina', source_url: 'no-es-una-url', priority: 'alta' }
  ],
  agenda: [
    {
      // Mismo evento que ya existe: debe actualizarse, no duplicarse.
      name: 'XXXIII Encuentro Nacional de Logistica Empresaria de ARLOG',
      organizer: 'ARLOG',
      date_start: existingEvent.date_start,
      date_end: existingEvent.date_start,
      date_confirmed: true,
      city: existingEvent.city,
      province: 'Buenos Aires',
      country: 'Argentina',
      venue: 'Sede actualizada por la prueba',
      venue_confirmed: true,
      format: 'presencial',
      category: 'Logística',
      url: existingEvent.url,
      source_url: existingEvent.source_url,
      description: 'Encuentro anual del sector logístico argentino.',
      fixy_relevance: 'Benchmarking operativo y alianzas con transportistas.',
      priority: 'alta',
      beyond_90: false
    },
    {
      name: 'Evento de prueba en Mar del Plata',
      organizer: 'Cámara de prueba',
      date_start: '2026-10-02',
      date_end: '2026-10-02',
      date_confirmed: true,
      city: 'Mar del Plata',
      province: 'Buenos Aires',
      country: 'Argentina',
      venue: 'Por confirmar',
      venue_confirmed: false,
      format: 'presencial',
      category: 'eCommerce',
      url: 'https://ejemplo-de-prueba.com/mdp',
      source_url: 'https://ejemplo-de-prueba.com/mdp',
      description: 'Jornada de comercio digital.',
      fixy_relevance: 'Prospección de tiendas de la costa.',
      priority: 'relevante',
      beyond_90: false
    }
  ],
  internacional: [],
  ia: [
    {
      name: 'Herramienta de prueba',
      vendor: 'Proveedor de prueba',
      what_it_is: 'Una herramienta ficticia para la prueba.',
      what_changed: 'Se agregó en la prueba.',
      fixy_use: 'Serviría para validar el pipeline de la prueba.',
      verdict: 'seguir',
      verdict_reason: 'Es una prueba.',
      categories: ['Operaciones'],
      pricing_note: 'gratis',
      source_url: 'https://ejemplo-de-prueba.com/tool',
      published_date: '2026-08-18',
      priority: 'informativo'
    }
  ],
  sintesis: {
    opportunities: [
      {
        title: 'Oportunidad de prueba con lockers',
        context: 'Aparecieron lockers en Rosario según la novedad de prueba.',
        action: 'Evaluar un acuerdo con la red de lockers de Rosario.',
        type: 'comercial',
        priority: 'relevante',
        source_url: 'https://ejemplo-de-prueba.com/lockers-rosario',
        linked: ['Noticia de prueba realmente nueva sobre lockers en Rosario']
      }
    ],
    content: [],
    highlights: [
      { title: 'Noticia de prueba realmente nueva sobre lockers en Rosario', kind: 'news', priority: 'relevante', one_liner: 'El pickup baja el costo por entrega.' }
    ],
    summary_line: 'Corrida de prueba: el pipeline funciona.'
  }
};

function pick(prompt) {
  if (prompt.includes('EVENTOS INTERNACIONALES')) return REPLIES.internacional;
  if (prompt.includes('EVENTOS REALES Y VERIFICABLES en ARGENTINA')) return REPLIES.agenda;
  if (prompt.includes('NUEVAS CAPACIDADES DE IA')) return REPLIES.ia;
  if (prompt.includes('DESTACADOS DEL DÍA')) return REPLIES.sintesis;
  return REPLIES.novedades;
}

let calls = 0;
globalThis.fetch = async (url, init) => {
  const target = String(url);
  if (target.includes('/models')) {
    return new Response(JSON.stringify({ data: [{ id: 'modelo-de-prueba', created_at: '2026-01-01T00:00:00Z' }] }), { status: 200 });
  }
  calls += 1;
  const body = JSON.parse(init.body);
  const prompt = body.messages[0].content;
  return new Response(
    JSON.stringify({
      content: [{ type: 'text', text: `Acá va el JSON:\n\`\`\`json\n${JSON.stringify(pick(prompt))}\n\`\`\`` }],
      usage: { input_tokens: 10, output_tokens: 20 }
    }),
    { status: 200 }
  );
};

process.env.ANTHROPIC_API_KEY = 'clave-de-prueba';

await import('../update.mjs');
await new Promise((r) => setTimeout(r, 400));

const after = {
  events: await readJson('data/events.json', []),
  news: await readJson('data/news.json', []),
  ai: await readJson('data/ai.json', []),
  opps: await readJson('data/opportunities.json', []),
  meta: await readJson('data/meta.json', {}),
  internal: await readJson('data/internal/event-status.json', {})
};

assert(calls === 5, `se hicieron ${calls} llamadas a la API (esperado 5)`);
assert(after.news.length === news.length + 1, `las novedades pasaron de ${news.length} a ${after.news.length} (esperado +1: la duplicada con UTM se fusionó)`);
assert(
  after.news.filter((n) => /costos logísticos|costos logisticos/i.test(n.title)).length === 1,
  'la noticia repetida con parámetros de tracking no se duplicó'
);
assert(after.news.some((n) => n.title.includes('lockers en Rosario')), 'la noticia realmente nueva se agregó');
assert(!after.news.some((n) => n.title === 'Item invalido sin fuente'), 'el ítem sin URL válida fue descartado por el control de calidad');
assert(after.events.length === events.length + 1, `los eventos pasaron de ${events.length} a ${after.events.length} (esperado +1: ARLOG se actualizó)`);
assert(after.events.filter((e) => /ARLOG/i.test(e.name)).length === 1, 'el evento ARLOG no se duplicó');
assert(
  after.events.find((e) => e.id === existingEvent.id)?.venue === 'Sede actualizada por la prueba',
  'el evento existente se actualizó con la sede nueva'
);
assert(
  after.internal.statuses?.[existingEvent.id]?.status === 'vamos',
  'la marca interna "Vamos" sobrevivió intacta a la actualización automática'
);
assert(after.opps.some((o) => o.title.includes('Oportunidad de prueba')), 'la oportunidad detectada se guardó');
assert(after.meta.summary_line === 'Corrida de prueba: el pipeline funciona.', 'el resumen del día se guardó');
assert(after.meta.run_status === 'ok', `estado de la corrida: ${after.meta.run_status}`);
assert(after.meta.highlights?.length >= 3, `destacados generados: ${after.meta.highlights?.length}`);

await restore();

console.log('\n--- Resultado de la simulación ---');
ok.forEach((m) => console.log(`  ✓ ${m}`));
failures.forEach((m) => console.log(`  ✗ ${m}`));
console.log(failures.length ? `\n${failures.length} verificaciones fallaron.` : '\nTodas las verificaciones pasaron. Datos originales restaurados.');
process.exitCode = failures.length ? 1 : 0;
