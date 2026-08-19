import { addDays, daysBetween, isoNow, nowAR, todayAR } from './store.js';

const PRIORITY_ORDER = { alta: 0, relevante: 1, informativo: 2 };

export function byPriorityThenDate(a, b) {
  const pa = PRIORITY_ORDER[a.priority] ?? 3;
  const pb = PRIORITY_ORDER[b.priority] ?? 3;
  if (pa !== pb) return pa - pb;
  const da = a.published_date || a.first_seen || '';
  const db = b.published_date || b.first_seen || '';
  return db.localeCompare(da);
}

export function upcomingEvents(events, today = todayAR(), days = 90) {
  const horizon = addDays(today, days);
  return events.filter((e) => {
    if (e.scope !== 'ar' && e.scope !== 'intl') return false;
    if (!e.date_start) return false;
    const end = e.date_end || e.date_start;
    return end >= today && e.date_start <= horizon;
  });
}

/**
 * Arma el resumen ejecutivo y los contadores de la home.
 * highlights viene del análisis del día; si falta, se completa por prioridad.
 */
export function buildMeta({
  events,
  news,
  ai,
  opportunities,
  content,
  highlights = [],
  summaryLine = null,
  runStatus = 'ok',
  runErrors = [],
  today = todayAR(),
  counters = {}
}) {
  const newToday = (list) => list.filter((i) => i.first_seen === today);
  const upcoming = upcomingEvents(events, today, 90);

  const resolved = [];
  const seen = new Set();
  for (const h of highlights) {
    const match =
      news.find((n) => n.title === h.title) ||
      events.find((e) => e.name === h.title) ||
      ai.find((a) => a.name === h.title) ||
      opportunities.find((o) => o.title === h.title);
    const id = match?.id || `hl-${h.title.slice(0, 40)}`;
    if (seen.has(id)) continue;
    seen.add(id);
    resolved.push({
      id,
      kind: match ? (match.scope ? 'event' : h.kind) : h.kind,
      title: h.title,
      priority: h.priority,
      one_liner: h.one_liner
    });
  }

  if (resolved.length < 3) {
    const fallback = [
      ...newToday(news).map((n) => ({ id: n.id, kind: 'news', title: n.title, priority: n.priority, one_liner: n.why_it_matters })),
      ...newToday(opportunities).map((o) => ({ id: o.id, kind: 'opportunity', title: o.title, priority: o.priority, one_liner: o.action })),
      ...news.map((n) => ({ id: n.id, kind: 'news', title: n.title, priority: n.priority, one_liner: n.why_it_matters }))
    ];
    for (const item of fallback.sort(byPriorityThenDate)) {
      if (resolved.length >= 5) break;
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      resolved.push(item);
    }
  }

  const nextEvent = [...upcoming].sort((a, b) => (a.date_start || '').localeCompare(b.date_start || ''))[0] || null;

  return {
    generated_at: isoNow(),
    last_updated_ar: nowAR(),
    date: today,
    run_status: runStatus,
    run_errors: runErrors,
    summary_line: summaryLine,
    counters: {
      news_today: newToday(news).length,
      news_total: news.length,
      events_upcoming: upcoming.length,
      events_ar_upcoming: upcoming.filter((e) => e.scope === 'ar').length,
      events_intl_upcoming: upcoming.filter((e) => e.scope === 'intl').length,
      events_later: events.filter((e) => e.beyond_90 && (e.date_start || '') > addDays(today, 90)).length,
      opportunities_open: opportunities.length,
      opportunities_today: newToday(opportunities).length,
      ai_today: newToday(ai).length,
      ai_to_try: ai.filter((a) => a.verdict === 'probar').length,
      content_ideas: content.length,
      ...counters
    },
    next_event: nextEvent
      ? {
          id: nextEvent.id,
          name: nextEvent.name,
          date_start: nextEvent.date_start,
          city: nextEvent.city,
          days_away: Math.max(0, daysBetween(nextEvent.date_start, today))
        }
      : null,
    highlights: resolved.slice(0, 5)
  };
}

export function digestNews(news, today, limit = 14) {
  return news
    .filter((n) => daysBetween(today, n.published_date || n.first_seen || today) <= 10)
    .sort(byPriorityThenDate)
    .slice(0, limit)
    .map((n) => `- [${n.category}] ${n.title} — ${n.why_it_matters} (${n.source_url})`)
    .join('\n');
}

export function digestEvents(events, today, limit = 14) {
  return upcomingEvents(events, today, 120)
    .sort((a, b) => (a.date_start || '').localeCompare(b.date_start || ''))
    .slice(0, limit)
    .map(
      (e) =>
        `- ${e.date_start || 'fecha por confirmar'} · ${e.name} (${e.city}, ${e.country}) — ${e.fixy_relevance}`
    )
    .join('\n');
}

export function digestAi(ai, today, limit = 10) {
  return ai
    .sort(byPriorityThenDate)
    .slice(0, limit)
    .map((a) => `- ${a.name} (${a.vendor}) [${a.verdict}] — ${a.fixy_use}`)
    .join('\n');
}
