import {
  aiId,
  contentId,
  eventId,
  eventKey,
  newsId,
  normalizeUrl,
  oppId,
  titleSimilarity
} from './ids.js';
import { addDays, daysBetween, isoNow, pushToArchive, todayAR } from './store.js';

/** Campos que la automatización nunca toca si ya existen con valor manual. */
const PROTECTED_EVENT_FIELDS = ['internal_status', 'internal_note', 'owner'];

function stripProtected(obj) {
  const clone = { ...obj };
  for (const field of PROTECTED_EVENT_FIELDS) delete clone[field];
  return clone;
}

function nonEmpty(value) {
  return value !== undefined && value !== null && value !== '' && value !== 'Por confirmar';
}

/**
 * Mezcla campo por campo: el dato nuevo solo gana si aporta información.
 * Nunca reemplaza un dato confirmado por un "Por confirmar".
 */
function mergeFields(current, incoming) {
  const out = { ...current };
  const changed = [];
  for (const [key, value] of Object.entries(incoming)) {
    if (PROTECTED_EVENT_FIELDS.includes(key)) continue;
    if (key === 'id' || key === 'first_seen' || key === 'source_kind') continue;
    if (value === undefined || value === null) continue;
    const prev = out[key];
    if (typeof value === 'boolean') {
      if (prev !== value) {
        // Un flag de confirmación solo pasa de false a true automáticamente.
        if (/_confirmed$/.test(key) && prev === true && value === false) continue;
        out[key] = value;
        changed.push(key);
      }
      continue;
    }
    if (!nonEmpty(value) && nonEmpty(prev)) continue;
    if (JSON.stringify(prev) !== JSON.stringify(value)) {
      out[key] = value;
      changed.push(key);
    }
  }
  return { merged: out, changed };
}

export function mergeEvents(existing, incoming, today = todayAR()) {
  const byId = new Map(existing.map((e) => [e.id, { ...e }]));
  const byKey = new Map();
  for (const e of byId.values()) {
    byKey.set(`${eventKey(e.name)}|${(e.date_start || '').slice(0, 7)}`, e.id);
    byKey.set(`${eventKey(e.name)}|${(e.date_start || '').slice(0, 4)}`, e.id);
  }

  let added = 0;
  let updated = 0;

  for (const raw of incoming) {
    if (!raw || !raw.name) continue;
    const candidate = {
      ...raw,
      id: raw.id || eventId(raw),
      source_kind: raw.source_kind || 'auto',
      last_updated: today
    };

    let targetId = byId.has(candidate.id) ? candidate.id : null;
    if (!targetId) {
      const monthKey = `${eventKey(candidate.name)}|${(candidate.date_start || '').slice(0, 7)}`;
      const yearKey = `${eventKey(candidate.name)}|${(candidate.date_start || '').slice(0, 4)}`;
      targetId = byKey.get(monthKey) || byKey.get(yearKey) || null;
    }
    if (!targetId) {
      // Último recurso: mismo nombre muy parecido y misma ciudad.
      for (const e of byId.values()) {
        if (
          titleSimilarity(e.name, candidate.name) >= 0.75 &&
          (e.city || '') === (candidate.city || '') &&
          (e.date_start || '').slice(0, 4) === (candidate.date_start || '').slice(0, 4)
        ) {
          targetId = e.id;
          break;
        }
      }
    }

    if (targetId) {
      const current = byId.get(targetId);
      if (current.locked) continue;
      const { merged, changed } = mergeFields(current, stripProtected(candidate));
      if (changed.filter((c) => c !== 'last_updated').length) {
        merged.last_updated = today;
        merged.change_log = [
          ...(current.change_log || []).slice(-4),
          { date: today, fields: changed.filter((c) => c !== 'last_updated') }
        ];
        updated += 1;
      }
      byId.set(targetId, merged);
    } else {
      candidate.first_seen = candidate.first_seen || today;
      byId.set(candidate.id, candidate);
      byKey.set(`${eventKey(candidate.name)}|${(candidate.date_start || '').slice(0, 7)}`, candidate.id);
      added += 1;
    }
  }

  return { items: [...byId.values()], added, updated };
}

export function mergeNews(existing, incoming, today = todayAR()) {
  const byId = new Map(existing.map((n) => [n.id, { ...n }]));
  const byUrl = new Map();
  for (const n of byId.values()) byUrl.set(normalizeUrl(n.source_url), n.id);

  let added = 0;
  let updated = 0;

  for (const raw of incoming) {
    if (!raw || !raw.title || !raw.source_url) continue;
    const candidate = {
      ...raw,
      id: raw.id || newsId(raw),
      source_kind: 'auto',
      last_updated: today
    };
    let targetId = byId.has(candidate.id)
      ? candidate.id
      : byUrl.get(normalizeUrl(candidate.source_url)) || null;

    if (!targetId) {
      // Misma historia en otro medio: título muy parecido dentro de 12 días.
      for (const n of byId.values()) {
        const near =
          n.published_date && candidate.published_date
            ? Math.abs(daysBetween(n.published_date, candidate.published_date)) <= 12
            : true;
        if (near && titleSimilarity(n.title, candidate.title) >= 0.62) {
          targetId = n.id;
          break;
        }
      }
    }

    if (targetId) {
      const current = byId.get(targetId);
      const { merged, changed } = mergeFields(current, candidate);
      const real = changed.filter((c) => !['last_updated', 'tags'].includes(c));
      if (real.length) {
        merged.last_updated = today;
        merged.updated_flag = true;
        updated += 1;
      }
      byId.set(targetId, merged);
    } else {
      candidate.first_seen = today;
      byId.set(candidate.id, candidate);
      byUrl.set(normalizeUrl(candidate.source_url), candidate.id);
      added += 1;
    }
  }

  return { items: [...byId.values()], added, updated };
}

function mergeGeneric(existing, incoming, idFn, today) {
  const byId = new Map(existing.map((i) => [i.id, { ...i }]));
  let added = 0;
  let updated = 0;
  for (const raw of incoming) {
    if (!raw) continue;
    const candidate = { ...raw, id: raw.id || idFn(raw), source_kind: 'auto', last_updated: today };
    if (byId.has(candidate.id)) {
      const current = byId.get(candidate.id);
      if (current.locked) continue;
      const { merged, changed } = mergeFields(current, candidate);
      if (changed.filter((c) => c !== 'last_updated').length) {
        merged.last_updated = today;
        updated += 1;
      }
      byId.set(candidate.id, merged);
    } else {
      candidate.first_seen = today;
      byId.set(candidate.id, candidate);
      added += 1;
    }
  }
  return { items: [...byId.values()], added, updated };
}

export const mergeAi = (existing, incoming, today = todayAR()) =>
  mergeGeneric(existing, incoming, aiId, today);
export const mergeOpportunities = (existing, incoming, today = todayAR()) =>
  mergeGeneric(existing, incoming, oppId, today);
export const mergeContent = (existing, incoming, today = todayAR()) =>
  mergeGeneric(existing, incoming, contentId, today);

/**
 * Rotación al histórico. Mantiene la home liviana sin perder nada.
 * Los eventos nunca se borran: pasan a archive/events-YYYY.json.
 */
export async function rotate({ events, news, ai, opportunities, content }, today = todayAR()) {
  const moved = { events: 0, news: 0, ai: 0, opportunities: 0, content: 0 };

  const keptEvents = [];
  const oldEvents = [];
  for (const e of events) {
    const end = e.date_end || e.date_start;
    if (end && daysBetween(today, end) > 3) oldEvents.push(e);
    else keptEvents.push(e);
  }
  const eventsByYear = new Map();
  for (const e of oldEvents) {
    const year = (e.date_end || e.date_start || today).slice(0, 4);
    if (!eventsByYear.has(year)) eventsByYear.set(year, []);
    eventsByYear.get(year).push(e);
  }
  for (const [year, items] of eventsByYear) {
    moved.events += await pushToArchive(`events-${year}.json`, items);
  }

  const keptNews = [];
  const oldNews = [];
  for (const n of news) {
    const ref = n.published_date || n.first_seen || today;
    if (daysBetween(today, ref) > 21) oldNews.push(n);
    else keptNews.push(n);
  }
  const newsByMonth = new Map();
  for (const n of oldNews) {
    const month = (n.published_date || n.first_seen || today).slice(0, 7);
    if (!newsByMonth.has(month)) newsByMonth.set(month, []);
    newsByMonth.get(month).push(n);
  }
  for (const [month, items] of newsByMonth) {
    moved.news += await pushToArchive(`news-${month}.json`, items);
  }

  const rotateBy = async (list, days, prefix, dateField) => {
    const kept = [];
    const old = [];
    for (const item of list) {
      const ref = item[dateField] || item.first_seen || today;
      if (daysBetween(today, ref) > days) old.push(item);
      else kept.push(item);
    }
    const groups = new Map();
    for (const item of old) {
      const key = (item[dateField] || item.first_seen || today).slice(0, 7);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    }
    let count = 0;
    for (const [key, items] of groups) {
      count += await pushToArchive(`${prefix}-${key}.json`, items);
    }
    return { kept, count };
  };

  const aiRot = await rotateBy(ai, 75, 'ai', 'published_date');
  moved.ai = aiRot.count;
  const oppRot = await rotateBy(opportunities, 60, 'opportunities', 'first_seen');
  moved.opportunities = oppRot.count;
  const contentRot = await rotateBy(content, 30, 'content', 'first_seen');
  moved.content = contentRot.count;

  return {
    events: keptEvents,
    news: keptNews,
    ai: aiRot.kept,
    opportunities: oppRot.kept,
    content: contentRot.kept,
    moved
  };
}

export { addDays, isoNow };
