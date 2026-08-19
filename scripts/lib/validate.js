/**
 * Saneamiento de los datos que llegan del modelo.
 * Un ítem sin fuente verificable o sin campos mínimos se descarta: es la última
 * barrera contra información inventada.
 */

const PRIORITIES = new Set(['alta', 'relevante', 'informativo']);
const VERDICTS = new Set(['probar', 'seguir', 'no_prioritario']);
const UNCONFIRMED = 'Por confirmar';

const isHttpUrl = (v) => typeof v === 'string' && /^https?:\/\/[^\s]+\.[^\s]{2,}/i.test(v.trim());
const isIsoDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const str = (v, max = 1200) =>
  typeof v === 'string' && v.trim() && v.trim().toLowerCase() !== 'null'
    ? v.trim().slice(0, max)
    : null;
const bool = (v) => v === true;
const prio = (v) => (PRIORITIES.has(v) ? v : 'informativo');
const orUnconfirmed = (v) => str(v) || UNCONFIRMED;

function pushIssue(issues, kind, reason, label) {
  issues.push({ kind, reason, label: String(label || '').slice(0, 120) });
}

export function sanitizeNews(list, { issues = [] } = {}) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const title = str(raw.title, 220);
    if (!title) {
      pushIssue(issues, 'news', 'sin título', raw.source_url);
      continue;
    }
    if (!isHttpUrl(raw.source_url)) {
      pushIssue(issues, 'news', 'sin URL de fuente válida', title);
      continue;
    }
    const what = str(raw.what_happened, 700);
    const why = str(raw.why_it_matters, 500);
    if (!what || !why) {
      pushIssue(issues, 'news', 'falta qué pasó o por qué importa', title);
      continue;
    }
    out.push({
      title,
      what_happened: what,
      why_it_matters: why,
      fixy_impact: str(raw.fixy_impact, 500),
      category: str(raw.category, 40) || 'Tendencias',
      geo: ['Argentina', 'LATAM', 'Global'].includes(raw.geo) ? raw.geo : 'Argentina',
      source_name: str(raw.source_name, 80) || new URL(raw.source_url).hostname.replace(/^www\./, ''),
      source_url: raw.source_url.trim(),
      published_date: isIsoDate(raw.published_date) ? raw.published_date : null,
      priority: prio(raw.priority),
      tags: Array.isArray(raw.tags) ? raw.tags.filter((t) => str(t, 40)).slice(0, 6) : []
    });
  }
  return out;
}

function sanitizeEvent(raw, scope, issues) {
  const name = str(raw.name, 180);
  if (!name) {
    pushIssue(issues, `event:${scope}`, 'sin nombre', raw.url);
    return null;
  }
  const url = isHttpUrl(raw.url) ? raw.url.trim() : null;
  const sourceUrl = isHttpUrl(raw.source_url) ? raw.source_url.trim() : url;
  if (!sourceUrl) {
    pushIssue(issues, `event:${scope}`, 'sin URL verificable', name);
    return null;
  }
  const dateStart = isIsoDate(raw.date_start) ? raw.date_start : null;
  const dateNote = str(raw.date_note, 400);
  if (!dateStart && !dateNote) {
    pushIssue(issues, `event:${scope}`, 'sin fecha ni nota de fecha', name);
    return null;
  }
  const relevance = str(raw.fixy_relevance, 600);
  if (!relevance) {
    pushIssue(issues, `event:${scope}`, 'sin relevancia para Fixy', name);
    return null;
  }
  return {
    scope,
    name,
    organizer: orUnconfirmed(raw.organizer),
    date_start: dateStart,
    date_end: isIsoDate(raw.date_end) ? raw.date_end : dateStart,
    date_confirmed: bool(raw.date_confirmed) && !!dateStart,
    date_note: dateNote,
    city: orUnconfirmed(raw.city),
    province: str(raw.province, 60),
    country: str(raw.country, 60) || (scope === 'ar' ? 'Argentina' : UNCONFIRMED),
    venue: orUnconfirmed(raw.venue),
    venue_confirmed: bool(raw.venue_confirmed),
    format: ['presencial', 'virtual', 'híbrido'].includes(raw.format) ? raw.format : UNCONFIRMED,
    category: str(raw.category, 40) || 'Innovación',
    url: url || sourceUrl,
    source_url: sourceUrl,
    description: str(raw.description, 700) || UNCONFIRMED,
    fixy_relevance: relevance,
    justification_type: str(raw.justification_type, 40),
    priority: prio(raw.priority),
    beyond_90: bool(raw.beyond_90)
  };
}

export function sanitizeEvents(list, scope, { issues = [] } = {}) {
  if (!Array.isArray(list)) return [];
  return list
    .map((raw) => (raw && typeof raw === 'object' ? sanitizeEvent(raw, scope, issues) : null))
    .filter(Boolean);
}

export function sanitizeAi(list, { issues = [] } = {}) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const name = str(raw.name, 140);
    if (!name) continue;
    if (!isHttpUrl(raw.source_url)) {
      pushIssue(issues, 'ai', 'sin URL de fuente válida', name);
      continue;
    }
    const use = str(raw.fixy_use, 800);
    if (!use) {
      pushIssue(issues, 'ai', 'sin uso concreto para Fixy', name);
      continue;
    }
    out.push({
      name,
      vendor: str(raw.vendor, 80) || UNCONFIRMED,
      what_it_is: str(raw.what_it_is, 600) || UNCONFIRMED,
      what_changed: str(raw.what_changed, 600) || UNCONFIRMED,
      fixy_use: use,
      verdict: VERDICTS.has(raw.verdict) ? raw.verdict : 'seguir',
      verdict_reason: str(raw.verdict_reason, 300),
      categories: Array.isArray(raw.categories)
        ? raw.categories.filter((c) => str(c, 40)).slice(0, 6)
        : [],
      pricing_note: str(raw.pricing_note, 220) || 'no confirmado',
      source_url: raw.source_url.trim(),
      published_date: isIsoDate(raw.published_date) ? raw.published_date : null,
      priority: prio(raw.priority)
    });
  }
  return out;
}

export function sanitizeOpportunities(list, { issues = [] } = {}) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const title = str(raw.title, 200);
    const action = str(raw.action, 700);
    const context = str(raw.context, 900);
    if (!title || !action || !context) {
      pushIssue(issues, 'opportunity', 'incompleta', title);
      continue;
    }
    out.push({
      title,
      context,
      action,
      type: str(raw.type, 40) || 'estratégica',
      priority: prio(raw.priority),
      source_url: isHttpUrl(raw.source_url) ? raw.source_url.trim() : null,
      linked: Array.isArray(raw.linked) ? raw.linked.filter((l) => str(l, 200)).slice(0, 4) : []
    });
  }
  return out;
}

export function sanitizeContent(list, { issues = [] } = {}) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const topic = str(raw.topic, 200);
    const angle = str(raw.fixy_angle, 700);
    const why = str(raw.why_now, 700);
    if (!topic || !angle || !why) {
      pushIssue(issues, 'content', 'incompleto', topic);
      continue;
    }
    out.push({
      topic,
      why_now: why,
      fixy_angle: angle,
      formats: Array.isArray(raw.formats) ? raw.formats.filter((f) => str(f, 30)).slice(0, 4) : [],
      priority: prio(raw.priority),
      source_url: isHttpUrl(raw.source_url) ? raw.source_url.trim() : null
    });
  }
  return out;
}

export function sanitizeHighlights(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((h) => h && str(h.title, 220))
    .slice(0, 6)
    .map((h) => ({
      title: str(h.title, 220),
      kind: ['news', 'event', 'ai', 'opportunity'].includes(h.kind) ? h.kind : 'news',
      priority: prio(h.priority),
      one_liner: str(h.one_liner, 260) || ''
    }));
}
