/* ==========================================================================
   Fixy Radar · aplicación de interfaz
   Sin frameworks ni dependencias. Los datos vienen de /data/*.json y los
   genera la automatización diaria: esta capa solamente los presenta.
   ========================================================================== */

const DATA = {
  meta: 'data/meta.json',
  events: 'data/events.json',
  news: 'data/news.json',
  ai: 'data/ai.json',
  opportunities: 'data/opportunities.json',
  content: 'data/content.json',
  market: 'data/market.json',
  internal: 'data/internal/event-status.json'
};

const LS_KEY = 'fixy-radar:internal-status:v1';
const AGENDA_DAYS = 90;

const STATUS_LABELS = { vamos: 'Vamos', evaluar: 'Evaluar', no_vamos: 'No vamos' };
const PRIORITY_LABELS = { alta: 'Alta prioridad', relevante: 'Relevante', informativo: 'Informativo' };
const VERDICT_LABELS = { probar: 'Probar', seguir: 'Seguir', no_prioritario: 'No prioritario' };
const MONTHS = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
const MONTHS_SHORT = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
const DOW = ['lun','mar','mié','jue','vie','sáb','dom'];

const SECTIONS = {
  hoy: { title: 'Hoy en Fixy', search: false },
  agenda: { title: 'Agenda Argentina', search: true },
  internacional: { title: 'Radar internacional', search: true },
  novedades: { title: 'Daily Brief', search: true },
  ia: { title: 'AI Radar', search: true },
  mercado: { title: 'Mercado', search: true },
  oportunidades: { title: 'Oportunidades Fixy', search: true },
  contenido: { title: 'Content Radar', search: true },
  archivo: { title: 'Archivo', search: true }
};

const state = {
  data: {},
  internal: {},        // repo (compartido por el equipo)
  local: {},           // navegador (cambios sin commitear)
  section: 'hoy',
  query: '',
  filters: { agenda: { cat: 'all', status: 'all', city: 'all' }, internacional: { cat: 'all', just: 'all' }, novedades: { cat: 'all', geo: 'all' }, ia: { verdict: 'all', cat: 'all' }, archivo: { kind: 'all' } },
  calendar: { month: null, selected: null },
  archive: null,
  today: null
};

/* ------------------------------- utilidades ------------------------------ */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function todayISO() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function parseISO(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(Date.UTC(y, m - 1, d));
}

function addDays(iso, n) {
  const d = parseISO(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function daysUntil(iso, from = state.today) {
  const a = parseISO(iso);
  const b = parseISO(from);
  if (!a || !b) return null;
  return Math.round((a - b) / 86400000);
}

function longDate(iso) {
  const d = parseISO(iso);
  if (!d) return '';
  return `${DOW[(d.getUTCDay() + 6) % 7]} ${d.getUTCDate()} de ${MONTHS[d.getUTCMonth()]} de ${d.getUTCFullYear()}`;
}

function shortDate(iso) {
  const d = parseISO(iso);
  if (!d) return 'Por confirmar';
  return `${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function relativeDays(iso) {
  const n = daysUntil(iso);
  if (n === null) return '';
  if (n < 0) return `hace ${Math.abs(n)} d`;
  if (n === 0) return 'hoy';
  if (n === 1) return 'mañana';
  if (n <= 14) return `en ${n} días`;
  if (n <= 60) return `en ${Math.round(n / 7)} semanas`;
  return `en ${Math.round(n / 30)} meses`;
}

function priorityTag(priority) {
  const cls = priority === 'alta' ? 'tag--alta' : priority === 'relevante' ? 'tag--yellow' : 'tag--ghost';
  return `<span class="tag ${cls}"><i class="dot dot--${esc(priority)}"></i>${esc(PRIORITY_LABELS[priority] || priority)}</span>`;
}

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

function sourceLink(url, name) {
  if (!url) return '<span>Sin fuente</span>';
  return `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer" class="item__src">${esc(name || hostOf(url))} ↗</a>`;
}

function isNewToday(item) {
  return item.first_seen === state.today;
}

function tbc(value) {
  if (!value || value === 'Por confirmar') return '<span class="tag tag--yellow">Por confirmar</span>';
  return esc(value);
}

function matches(query, ...fields) {
  if (!query) return true;
  const q = query.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const hay = fields.filter(Boolean).join(' ').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  return q.split(/\s+/).every((t) => hay.includes(t));
}

const PRIORITY_RANK = { alta: 0, relevante: 1, informativo: 2 };
const byPriority = (a, b) => (PRIORITY_RANK[a.priority] ?? 3) - (PRIORITY_RANK[b.priority] ?? 3);
const byDateAsc = (a, b) => (a.date_start || '9999').localeCompare(b.date_start || '9999');
const byPublishedDesc = (a, b) => (b.published_date || b.first_seen || '').localeCompare(a.published_date || a.first_seen || '');

/* --------------------------- estado interno Fixy ------------------------- */

function loadLocal() {
  try { state.local = JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch { state.local = {}; }
}

function saveLocal() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(state.local)); } catch { /* modo privado */ }
}

function statusOf(id) {
  if (Object.prototype.hasOwnProperty.call(state.local, id)) return state.local[id]?.status || null;
  return state.internal?.statuses?.[id]?.status || null;
}

function setStatus(id, status) {
  const current = statusOf(id);
  const next = current === status ? null : status;
  state.local[id] = { status: next, updated_at: new Date().toISOString() };
  saveLocal();
  render();
}

function pendingLocalCount() {
  return Object.keys(state.local).filter((id) => (state.local[id]?.status || null) !== (state.internal?.statuses?.[id]?.status || null)).length;
}

function mergedInternalFile() {
  const statuses = { ...(state.internal?.statuses || {}) };
  for (const [id, val] of Object.entries(state.local)) {
    if (!val || !val.status) delete statuses[id];
    else statuses[id] = { status: val.status, updated_at: val.updated_at };
  }
  return {
    version: 1,
    note: 'Datos internos de Fixy (Vamos / Evaluar / No vamos). La automatización diaria NUNCA escribe este archivo.',
    updated_at: new Date().toISOString(),
    statuses
  };
}

function downloadInternal() {
  const blob = new Blob([`${JSON.stringify(mergedInternalFile(), null, 2)}\n`], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'event-status.json';
  a.click();
  URL.revokeObjectURL(a.href);
}

/* --------------------------------- carga -------------------------------- */

async function fetchJson(path, fallback) {
  try {
    const res = await fetch(`${path}?v=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(String(res.status));
    return await res.json();
  } catch {
    return fallback;
  }
}

async function loadAll() {
  const [meta, events, news, ai, opportunities, content, market, internal] = await Promise.all([
    fetchJson(DATA.meta, null),
    fetchJson(DATA.events, []),
    fetchJson(DATA.news, []),
    fetchJson(DATA.ai, []),
    fetchJson(DATA.opportunities, []),
    fetchJson(DATA.content, []),
    fetchJson(DATA.market, {}),
    fetchJson(DATA.internal, { statuses: {} })
  ]);
  state.data = { meta, events, news, ai, opportunities, content, market };
  state.internal = internal || { statuses: {} };
  state.today = meta?.date || todayISO();
}

/* ------------------------------ derivaciones ---------------------------- */

function eventsByScope(scope) {
  return (state.data.events || []).filter((e) => e.scope === scope);
}

function isUpcoming(e) {
  if (!e.date_start) return false;
  const end = e.date_end || e.date_start;
  return end >= state.today && e.date_start <= addDays(state.today, AGENDA_DAYS);
}

function isLater(e) {
  if (!e.date_start) return !!e.date_note;
  return e.date_start > addDays(state.today, AGENDA_DAYS);
}

/* ------------------------------- componentes ---------------------------- */

function blockHead(title, hint) {
  return `<div class="block__head"><h2 class="block__title">${esc(title)}</h2>${hint ? `<span class="block__hint">${esc(hint)}</span>` : ''}<span class="block__rule"></span></div>`;
}

function emptyBox(text) {
  return `<div class="empty">${esc(text)}</div>`;
}

function newsCard(n) {
  return `<article class="card item" id="${esc(n.id)}">
    <div class="item__top">
      ${priorityTag(n.priority)}
      <span class="tag tag--blue">${esc(n.category)}</span>
      <span class="tag">${esc(n.geo)}</span>
      ${isNewToday(n) ? '<span class="new-flag">NUEVO</span>' : ''}
      ${n.updated_flag ? '<span class="tag tag--yellow">Actualizada</span>' : ''}
    </div>
    <h3 class="item__title">${esc(n.title)}</h3>
    <p class="item__field"><strong>Qué pasó</strong>${esc(n.what_happened)}</p>
    <p class="item__field"><strong>Por qué importa</strong>${esc(n.why_it_matters)}</p>
    ${n.fixy_impact ? `<p class="item__field item__field--fixy"><strong>Impacto potencial para Fixy</strong>${esc(n.fixy_impact)}</p>` : ''}
    <div class="item__foot">
      ${sourceLink(n.source_url, n.source_name)}
      ${n.published_date ? `<span class="event__sep">·</span><span>${esc(shortDate(n.published_date))}</span>` : ''}
      ${n.tags?.length ? `<span class="event__sep">·</span><span>${n.tags.map((t) => esc(t)).join(' · ')}</span>` : ''}
    </div>
  </article>`;
}

function eventCard(e, { showStatus = true } = {}) {
  const st = statusOf(e.id);
  const d = parseISO(e.date_start);
  const dateBox = d
    ? `<div class="event__date"><div class="event__day">${d.getUTCDate()}</div><div class="event__month">${MONTHS_SHORT[d.getUTCMonth()]}</div><div class="event__year">${d.getUTCFullYear()}</div></div>`
    : `<div class="event__date event__date--tbc"><div class="event__day">Fecha<br>a confirmar</div></div>`;
  const soon = e.date_start && daysUntil(e.date_start) >= 0 && daysUntil(e.date_start) <= 10;

  return `<article class="card ${st ? `card--${st}` : ''}" id="${esc(e.id)}">
    <div class="event">
      ${dateBox}
      <div class="item">
        <div class="item__top">
          ${priorityTag(e.priority)}
          <span class="tag tag--blue">${esc(e.category)}</span>
          ${e.format && e.format !== 'Por confirmar' ? `<span class="tag">${esc(e.format)}</span>` : ''}
          ${e.justification_type ? `<span class="tag tag--yellow">${esc(e.justification_type)}</span>` : ''}
          ${soon ? `<span class="tag tag--soon">${esc(relativeDays(e.date_start))}</span>` : ''}
          ${isNewToday(e) ? '<span class="new-flag">NUEVO</span>' : ''}
        </div>
        <h3 class="item__title">${esc(e.name)}</h3>
        <p class="event__meta">
          <span>${tbc(e.city)}${e.province && e.province !== e.city ? `, ${esc(e.province)}` : ''}${e.scope === 'intl' ? ` · ${tbc(e.country)}` : ''}</span>
          <span class="event__sep">·</span><span>${tbc(e.organizer)}</span>
          <span class="event__sep">·</span><span>Sede: ${tbc(e.venue)}</span>
        </p>
        ${e.date_note ? `<p class="item__field"><strong>Sobre la fecha</strong>${esc(e.date_note)}</p>` : ''}
        ${e.description && e.description !== 'Por confirmar' ? `<p class="item__field">${esc(e.description)}</p>` : ''}
        <p class="item__field item__field--fixy"><strong>Por qué puede importarle a Fixy</strong>${esc(e.fixy_relevance)}</p>
        ${showStatus ? `<div class="statusbar">
          <span class="statusbar__label">Decisión interna</span>
          <span class="seg" role="group" aria-label="Decisión interna sobre ${esc(e.name)}">
            ${Object.entries(STATUS_LABELS).map(([key, label]) => `<button type="button" data-status="${key}" data-event="${esc(e.id)}" class="${st === key ? 'is-on' : ''}" aria-pressed="${st === key}">${esc(label)}</button>`).join('')}
          </span>
          ${st ? '<span class="tag tag--ghost">guardado en este navegador</span>' : ''}
        </div>` : ''}
        <div class="item__foot">
          ${sourceLink(e.url, 'Sitio oficial')}
          ${e.source_url && e.source_url !== e.url ? `<span class="event__sep">·</span>${sourceLink(e.source_url, 'Fuente')}` : ''}
          ${e.date_start && e.date_end && e.date_end !== e.date_start ? `<span class="event__sep">·</span><span>${esc(shortDate(e.date_start))} → ${esc(shortDate(e.date_end))}</span>` : ''}
          ${!e.date_confirmed && e.date_start ? '<span class="event__sep">·</span><span class="tag tag--yellow">Fecha por confirmar</span>' : ''}
        </div>
      </div>
    </div>
  </article>`;
}

function aiCard(a) {
  const cls = a.verdict === 'probar' ? 'tag--blue' : a.verdict === 'seguir' ? 'tag--yellow' : 'tag--ghost';
  return `<article class="card item" id="${esc(a.id)}">
    <div class="item__top">
      <span class="tag ${cls}">${esc(VERDICT_LABELS[a.verdict] || a.verdict)}</span>
      ${priorityTag(a.priority)}
      <span class="tag">${esc(a.vendor)}</span>
      ${isNewToday(a) ? '<span class="new-flag">NUEVO</span>' : ''}
    </div>
    <h3 class="item__title">${esc(a.name)}</h3>
    <p class="item__field"><strong>Qué es</strong>${esc(a.what_it_is)}</p>
    <p class="item__field"><strong>Qué cambió / por qué aparece ahora</strong>${esc(a.what_changed)}</p>
    <p class="item__field item__field--fixy"><strong>Cómo podría usarlo Fixy</strong>${esc(a.fixy_use)}</p>
    ${a.verdict_reason ? `<p class="item__field"><strong>¿Vale la pena probarlo?</strong>${esc(VERDICT_LABELS[a.verdict] || a.verdict)} — ${esc(a.verdict_reason)}</p>` : ''}
    ${a.categories?.length ? `<div class="tags">${a.categories.map((c) => `<span class="tag">${esc(c)}</span>`).join('')}</div>` : ''}
    <div class="item__foot">
      ${sourceLink(a.source_url)}
      ${a.published_date ? `<span class="event__sep">·</span><span>${esc(shortDate(a.published_date))}</span>` : ''}
      ${a.pricing_note ? `<span class="event__sep">·</span><span>${esc(a.pricing_note)}</span>` : ''}
    </div>
  </article>`;
}

function opportunityCard(o) {
  return `<article class="card item" id="${esc(o.id)}">
    <div class="item__top">
      <span class="tag tag--blue">Oportunidad detectada</span>
      ${priorityTag(o.priority)}
      <span class="tag">${esc(o.type)}</span>
      ${isNewToday(o) ? '<span class="new-flag">NUEVO</span>' : ''}
    </div>
    <h3 class="item__title">${esc(o.title)}</h3>
    <p class="item__field">${esc(o.context)}</p>
    <p class="item__field item__field--fixy"><strong>Posible acción Fixy</strong>${esc(o.action)}</p>
    <div class="item__foot">
      ${o.source_url ? sourceLink(o.source_url) : '<span>Análisis interno del radar</span>'}
      ${o.first_seen ? `<span class="event__sep">·</span><span>detectada el ${esc(shortDate(o.first_seen))}</span>` : ''}
      ${o.linked?.length ? `<span class="event__sep">·</span><span>Relacionado: ${o.linked.map((l) => esc(l)).join(' · ')}</span>` : ''}
    </div>
  </article>`;
}

function contentCard(c) {
  return `<article class="card item" id="${esc(c.id)}">
    <div class="item__top">
      ${priorityTag(c.priority)}
      ${(c.formats || []).map((f) => `<span class="tag tag--blue">${esc(f)}</span>`).join('')}
      ${isNewToday(c) ? '<span class="new-flag">NUEVO</span>' : ''}
    </div>
    <h3 class="item__title">${esc(c.topic)}</h3>
    <p class="item__field"><strong>Por qué ahora</strong>${esc(c.why_now)}</p>
    <p class="item__field item__field--fixy"><strong>Ángulo Fixy</strong>${esc(c.fixy_angle)}</p>
    <div class="item__foot">
      ${c.source_url ? sourceLink(c.source_url) : '<span>Análisis interno del radar</span>'}
      ${c.first_seen ? `<span class="event__sep">·</span><span>detectado el ${esc(shortDate(c.first_seen))}</span>` : ''}
    </div>
  </article>`;
}

/* -------------------------------- calendario ---------------------------- */

function calendarHtml(events) {
  const base = state.calendar.month || state.today.slice(0, 7);
  const [y, m] = base.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const offset = (first.getUTCDay() + 6) % 7;

  const byDay = new Map();
  for (const e of events) {
    if (!e.date_start) continue;
    const start = parseISO(e.date_start);
    const end = parseISO(e.date_end || e.date_start);
    for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      const iso = d.toISOString().slice(0, 10);
      if (!iso.startsWith(base)) continue;
      if (!byDay.has(iso)) byDay.set(iso, []);
      byDay.get(iso).push(e);
    }
  }

  let cells = '';
  for (let i = 0; i < offset; i += 1) cells += '<div class="cal__cell cal__cell--empty"></div>';
  for (let day = 1; day <= daysInMonth; day += 1) {
    const iso = `${base}-${String(day).padStart(2, '0')}`;
    const list = byDay.get(iso) || [];
    const classes = ['cal__cell'];
    if (list.length) classes.push('cal__cell--has');
    if (iso === state.today) classes.push('cal__cell--today');
    if (iso === state.calendar.selected) classes.push('cal__cell--sel');
    const dots = [...new Set(list.map((e) => e.scope))].map((s) => `<i class="${s}"></i>`).join('');
    cells += `<div class="${classes.join(' ')}" ${list.length ? `data-cal-day="${iso}" role="button" tabindex="0" aria-label="${list.length} evento(s) el ${day} de ${MONTHS[m - 1]}"` : ''}>
      <span>${day}</span><span class="cal__dots">${dots}</span></div>`;
  }

  const selected = state.calendar.selected ? byDay.get(state.calendar.selected) || [] : [];

  return `<div class="cal">
    <div class="cal__head">
      <p class="cal__month">${MONTHS[m - 1]} ${y}</p>
      <div class="cal__nav">
        <button type="button" data-cal-nav="-1" aria-label="Mes anterior">‹</button>
        <button type="button" data-cal-nav="0" aria-label="Mes actual">•</button>
        <button type="button" data-cal-nav="1" aria-label="Mes siguiente">›</button>
      </div>
    </div>
    <div class="cal__grid">${DOW.map((d) => `<div class="cal__dow">${d}</div>`).join('')}${cells}</div>
    <div class="cal__legend">
      <span><i class="dot" style="background:var(--blue)"></i> Argentina</span>
      <span><i class="dot" style="background:var(--yellow)"></i> Internacional</span>
      <span>Recuadro oscuro: hoy</span>
    </div>
    ${state.calendar.selected ? `<div class="cal__selected">
      <strong>${esc(longDate(state.calendar.selected))}</strong>
      ${selected.length ? selected.map((e) => `<a href="#${esc(state.section)}" data-goto="${esc(e.id)}">${esc(e.name)} — ${tbc(e.city)}</a>`).join('') : '<p>Sin eventos.</p>'}
    </div>` : ''}
  </div>`;
}

/* --------------------------------- secciones ---------------------------- */

function renderHoy() {
  const meta = state.data.meta;
  if (!meta) return `<div class="notice notice--err">No se pudo cargar <code>data/meta.json</code>. Verificá que el sitio esté publicado con la carpeta <code>data/</code>.</div>`;

  const c = meta.counters || {};
  const kpis = [
    { v: c.news_today ?? 0, l: c.news_today === 1 ? 'novedad relevante hoy' : 'novedades relevantes hoy', cls: 'kpi--accent' },
    { v: c.events_upcoming ?? 0, l: 'eventos en los próximos 90 días', cls: '' },
    { v: c.opportunities_today ?? 0, l: 'oportunidades detectadas hoy', cls: 'kpi--warn' },
    { v: c.ai_to_try ?? 0, l: 'herramientas de IA para probar', cls: 'kpi--yellow' }
  ];

  const hl = meta.highlights || [];
  const stats = (state.data.market?.stats || []).slice(0, 4);
  const runNotice =
    meta.run_status && meta.run_status !== 'ok'
      ? `<div class="notice ${meta.run_status === 'error' ? 'notice--err' : ''}">
          <span>La última actualización automática terminó con estado <strong>${esc(meta.run_status)}</strong>. Los datos que ves son los de la última corrida exitosa.
          ${(meta.run_errors || []).length ? `Detalle: ${esc((meta.run_errors || []).map((e) => `${e.task}: ${e.message}`).join(' · ').slice(0, 300))}` : ''}</span>
        </div>`
      : '';

  const pending = pendingLocalCount();
  const pendingNotice = pending
    ? `<div class="notice"><span>Tenés <strong>${pending}</strong> ${pending === 1 ? 'decisión interna' : 'decisiones internas'} guardadas solo en este navegador. Para compartirlas con el equipo, descargá el archivo y subilo a <code>data/internal/event-status.json</code>.</span>
       <span class="notice__actions"><button class="btn btn--primary" id="dlInternal" type="button">Descargar</button></span></div>`
    : '';

  return `<div class="section">
    <div class="block">
      <div class="hero">
        <p class="hero__eyebrow">Fixy Radar</p>
        <h2 class="hero__title">${esc(longDate(meta.date))}</h2>
        <p class="hero__date">Última actualización automática: <strong>${esc(meta.last_updated_ar || '—')}</strong> (hora de Argentina)</p>
        ${meta.summary_line ? `<p class="hero__summary">${esc(meta.summary_line)}</p>` : ''}
        <p class="hero__stamp">
          ${meta.next_event ? `<span>Próximo evento: <strong>${esc(meta.next_event.name)}</strong> · ${esc(shortDate(meta.next_event.date_start))} (${esc(relativeDays(meta.next_event.date_start))})</span>` : '<span>Sin eventos próximos cargados</span>'}
          <span>${esc(c.news_total ?? 0)} novedades vigentes · ${esc(c.events_upcoming ?? 0)} eventos activos</span>
        </p>
      </div>
    </div>

    ${runNotice}${pendingNotice}

    <div class="block">
      <div class="grid grid--kpi">
        ${kpis.map((k) => `<div class="kpi ${k.cls}"><p class="kpi__value">${esc(k.v)}</p><p class="kpi__label">${esc(k.l)}</p></div>`).join('')}
      </div>
    </div>

    <div class="block">
      ${blockHead('Lo que hay que saber hoy', 'máximo 5 elementos · 30 segundos de lectura')}
      ${hl.length
        ? `<div class="card hl">${hl.map((h, i) => `<div class="hl__item">
            <span class="hl__rank">${i + 1}</span>
            <div class="hl__body">
              <p class="hl__title"><i class="dot dot--${esc(h.priority)}"></i>${esc(h.title)} <span class="tag tag--ghost">${esc({ news: 'Novedad', event: 'Evento', ai: 'IA', opportunity: 'Oportunidad' }[h.kind] || h.kind)}</span></p>
              ${h.one_liner ? `<p class="hl__line">${esc(h.one_liner)}</p>` : ''}
              <p class="hl__line"><a href="#${esc({ news: 'novedades', event: 'agenda', ai: 'ia', opportunity: 'oportunidades' }[h.kind] || 'novedades')}" data-goto="${esc(h.id)}">Ver detalle →</a></p>
            </div></div>`).join('')}</div>`
        : emptyBox('Hoy no hay nada que amerite tu atención inmediata. Eso también es información.')}
    </div>

    ${stats.length ? `<div class="block">
      ${blockHead('Pulso del mercado', 'datos de referencia con fuente')}
      <div class="grid grid--3">
        ${stats.map((s) => `<div class="stat"><p class="stat__label">${esc(s.label)}</p><p class="stat__value">${esc(s.value)}</p><p class="stat__period">${esc(s.period)} · ${sourceLink(s.source_url, s.source_name)}</p></div>`).join('')}
      </div>
      <p class="block__hint" style="margin-top:10px"><a href="#mercado">Ver todos los indicadores y tendencias →</a></p>
    </div>` : ''}
  </div>`;
}

function filterBar(groups) {
  return `<div class="filters">${groups.map((g) => {
    if (g.type === 'select') {
      return `<span class="filters__label">${esc(g.label)}</span><select class="chip" data-filter-select="${esc(g.key)}" data-section="${esc(g.section)}">
        ${g.options.map((o) => `<option value="${esc(o.value)}" ${o.value === g.value ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}
      </select>`;
    }
    return `<span class="filters__label">${esc(g.label)}</span>${g.options.map((o) => `<button type="button" class="chip ${o.value === g.value ? 'is-on' : ''}" data-filter="${esc(g.key)}" data-section="${esc(g.section)}" data-value="${esc(o.value)}">${esc(o.label)}</button>`).join('')}<span class="filters__sep"></span>`;
  }).join('')}</div>`;
}

function uniqueOptions(list, key, allLabel) {
  const values = [...new Set(list.map((i) => i[key]).filter((v) => v && v !== 'Por confirmar'))].sort((a, b) => a.localeCompare(b, 'es'));
  return [{ value: 'all', label: allLabel }, ...values.map((v) => ({ value: v, label: v }))];
}

function renderAgenda() {
  const all = eventsByScope('ar');
  const f = state.filters.agenda;
  const upcoming = all.filter(isUpcoming);
  const later = all.filter(isLater);

  const apply = (list) => list.filter((e) => {
    if (f.cat !== 'all' && e.category !== f.cat) return false;
    if (f.city !== 'all' && e.city !== f.city) return false;
    if (f.status !== 'all') {
      const st = statusOf(e.id);
      if (f.status === 'sin' ? !!st : st !== f.status) return false;
    }
    return matches(state.query, e.name, e.city, e.province, e.organizer, e.category, e.description, e.fixy_relevance, e.venue);
  });

  const shown = apply(upcoming).sort(byDateAsc);
  const shownLater = apply(later).sort(byDateAsc);

  const bar = filterBar([
    { section: 'agenda', key: 'cat', label: 'Categoría', value: f.cat, options: uniqueOptions(all, 'category', 'Todas') },
    { section: 'agenda', key: 'city', label: 'Ciudad', value: f.city, type: 'select', options: uniqueOptions(all, 'city', 'Todas') },
    { section: 'agenda', key: 'status', label: 'Decisión', value: f.status, options: [
      { value: 'all', label: 'Todas' }, { value: 'vamos', label: 'Vamos' }, { value: 'evaluar', label: 'Evaluar' }, { value: 'no_vamos', label: 'No vamos' }, { value: 'sin', label: 'Sin marcar' }
    ] }
  ]);

  const groups = new Map();
  for (const e of shown) {
    const key = (e.date_start || '9999-99').slice(0, 7);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }

  return `<div class="section">
    <div class="block">${blockHead('Calendario', 'los puntos marcan días con eventos · tocá un día para ver el detalle')}${calendarHtml(upcoming.concat(eventsByScope('intl').filter(isUpcoming)))}</div>
    ${bar}
    <div class="block">
      ${blockHead(`Próximos ${AGENDA_DAYS} días`, `${shown.length} de ${upcoming.length} eventos`)}
      ${shown.length
        ? [...groups.entries()].map(([month, list]) => {
            const [y, m] = month.split('-').map(Number);
            return `<p class="block__hint" style="margin:18px 0 10px;text-transform:capitalize;font-weight:700;color:var(--ink)">${MONTHS[m - 1]} ${y}</p>
              <div class="grid">${list.map((e) => eventCard(e)).join('')}</div>`;
          }).join('')
        : emptyBox('No hay eventos que coincidan con los filtros.')}
    </div>
    ${shownLater.length ? `<div class="block">
      ${blockHead('Más adelante', 'eventos confirmados a más de 90 días')}
      <div class="grid">${shownLater.map((e) => eventCard(e)).join('')}</div>
    </div>` : ''}
  </div>`;
}

function renderInternacional() {
  const all = eventsByScope('intl');
  const f = state.filters.internacional;
  const upcoming = all.filter(isUpcoming);
  const later = all.filter(isLater);

  const apply = (list) => list.filter((e) => {
    if (f.cat !== 'all' && e.category !== f.cat) return false;
    if (f.just !== 'all' && e.justification_type !== f.just) return false;
    return matches(state.query, e.name, e.city, e.country, e.organizer, e.category, e.description, e.fixy_relevance);
  });

  const shown = apply(upcoming).sort(byDateAsc);
  const shownLater = apply(later).sort(byDateAsc);

  const bar = filterBar([
    { section: 'internacional', key: 'cat', label: 'Categoría', value: f.cat, options: uniqueOptions(all, 'category', 'Todas') },
    { section: 'internacional', key: 'just', label: 'Justificación', value: f.just, type: 'select', options: uniqueOptions(all, 'justification_type', 'Todas') }
  ]);

  return `<div class="section">
    <div class="notice"><span>Filtro de relevancia alto: solo entran eventos que puedan justificar un viaje, networking estratégico, presencia institucional, sponsorship, negocios, aprendizaje o expansión regional.</span></div>
    ${bar}
    <div class="block">
      ${blockHead(`Próximos ${AGENDA_DAYS} días`, `${shown.length} eventos`)}
      ${shown.length ? `<div class="grid">${shown.map((e) => eventCard(e)).join('')}</div>` : emptyBox('Sin eventos internacionales en la ventana de 90 días con los filtros actuales.')}
    </div>
    ${shownLater.length ? `<div class="block">
      ${blockHead('Más adelante', 'grandes eventos ya confirmados, para planificar viaje y presupuesto con tiempo')}
      <div class="grid">${shownLater.map((e) => eventCard(e)).join('')}</div>
    </div>` : ''}
  </div>`;
}

function renderNovedades() {
  const all = state.data.news || [];
  const f = state.filters.novedades;
  const shown = all
    .filter((n) => (f.cat === 'all' || n.category === f.cat) && (f.geo === 'all' || n.geo === f.geo))
    .filter((n) => matches(state.query, n.title, n.what_happened, n.why_it_matters, n.fixy_impact, n.category, n.source_name, (n.tags || []).join(' ')))
    .sort((a, b) => byPriority(a, b) || byPublishedDesc(a, b));

  const today = shown.filter(isNewToday);
  const rest = shown.filter((n) => !isNewToday(n));

  const bar = filterBar([
    { section: 'novedades', key: 'cat', label: 'Categoría', value: f.cat, type: 'select', options: uniqueOptions(all, 'category', 'Todas') },
    { section: 'novedades', key: 'geo', label: 'Alcance', value: f.geo, options: [{ value: 'all', label: 'Todo' }, { value: 'Argentina', label: 'Argentina' }, { value: 'LATAM', label: 'LATAM' }, { value: 'Global', label: 'Global' }] }
  ]);

  return `<div class="section">
    ${bar}
    ${today.length ? `<div class="block">${blockHead('Nuevas hoy', `${today.length} novedades`)}<div class="grid grid--2">${today.map(newsCard).join('')}</div></div>` : ''}
    <div class="block">
      ${blockHead(today.length ? 'Días anteriores (vigentes)' : 'Novedades vigentes', `${rest.length} de ${all.length}`)}
      ${rest.length ? `<div class="grid grid--2">${rest.map(newsCard).join('')}</div>` : emptyBox('Sin novedades que coincidan con los filtros.')}
    </div>
    <p class="block__hint">Las novedades de más de 21 días pasan automáticamente al <a href="#archivo">Archivo</a>.</p>
  </div>`;
}

function renderIa() {
  const all = state.data.ai || [];
  const f = state.filters.ia;
  const shown = all
    .filter((a) => (f.verdict === 'all' || a.verdict === f.verdict) && (f.cat === 'all' || (a.categories || []).includes(f.cat)))
    .filter((a) => matches(state.query, a.name, a.vendor, a.what_it_is, a.what_changed, a.fixy_use, (a.categories || []).join(' ')))
    .sort((a, b) => byPriority(a, b) || byPublishedDesc(a, b));

  const cats = [...new Set(all.flatMap((a) => a.categories || []))].sort((a, b) => a.localeCompare(b, 'es'));

  const bar = filterBar([
    { section: 'ia', key: 'verdict', label: 'Veredicto', value: f.verdict, options: [{ value: 'all', label: 'Todos' }, { value: 'probar', label: 'Probar' }, { value: 'seguir', label: 'Seguir' }, { value: 'no_prioritario', label: 'No prioritario' }] },
    { section: 'ia', key: 'cat', label: 'Uso', value: f.cat, type: 'select', options: [{ value: 'all', label: 'Todos' }, ...cats.map((c) => ({ value: c, label: c }))] }
  ]);

  return `<div class="section">
    <div class="notice"><span>Esta sección no es "noticias de IA": son capacidades nuevas evaluadas por su utilidad real para el trabajo de Fixy. Nada entra por estar de moda.</span></div>
    ${bar}
    <div class="block">
      ${blockHead('Capacidades en el radar', `${shown.length} de ${all.length}`)}
      ${shown.length ? `<div class="grid grid--2">${shown.map(aiCard).join('')}</div>` : emptyBox('Sin herramientas que coincidan con los filtros.')}
    </div>
  </div>`;
}

function renderOportunidades() {
  const all = state.data.opportunities || [];
  const shown = all
    .filter((o) => matches(state.query, o.title, o.context, o.action, o.type))
    .sort((a, b) => byPriority(a, b) || (b.first_seen || '').localeCompare(a.first_seen || ''));

  return `<div class="section">
    <div class="notice"><span>Se generan cruzando novedades, tendencias, IA y eventos. Son pocas a propósito: si no hay nada realmente accionable, esta sección queda vacía.</span></div>
    <div class="block">
      ${blockHead('Oportunidades abiertas', `${shown.length} de ${all.length}`)}
      ${shown.length ? `<div class="grid grid--2">${shown.map(opportunityCard).join('')}</div>` : emptyBox('No hay oportunidades abiertas en este momento.')}
    </div>
    <p class="block__hint">Las oportunidades de más de 60 días pasan al <a href="#archivo">Archivo</a>. También podés revisar el <a href="#contenido">Content Radar</a>.</p>
  </div>`;
}

function renderContenido() {
  const all = state.data.content || [];
  const shown = all
    .filter((c) => matches(state.query, c.topic, c.why_now, c.fixy_angle, (c.formats || []).join(' ')))
    .sort(byPriority);

  return `<div class="section">
    <div class="notice"><span>Detección temprana de temas, no redacción automática. La idea es llegar al tema antes de que se sature.</span></div>
    <div class="block">
      ${blockHead('Oportunidades editoriales', `${shown.length} temas`)}
      ${shown.length ? `<div class="grid grid--2">${shown.map(contentCard).join('')}</div>` : emptyBox('Sin temas de contenido detectados hoy.')}
    </div>
  </div>`;
}

function renderMercado() {
  const m = state.data.market || {};
  const q = state.query;
  const stats = (m.stats || []).filter((s) => matches(q, s.label, s.value, s.period, s.source_name, s.note));
  const trends = (m.trends || []).filter((t) => matches(q, t.title, t.summary, t.why_it_matters_fixy));
  const dates = (m.commercial_dates || []).filter((d) => matches(q, d.name, d.note));
  const reg = (m.regulation || []).filter((r) => matches(q, r.title, r.summary, r.status));

  return `<div class="section">
    ${dates.length ? `<div class="block">
      ${blockHead('Fechas comerciales', 'planificación de capacidad')}
      <div class="grid grid--3">${dates.map((d) => `<div class="stat">
        <p class="stat__label">${esc(d.name)}</p>
        <p class="stat__value">${d.date_start ? esc(shortDate(d.date_start)) : 'Por confirmar'}${d.date_end && d.date_end !== d.date_start ? ` → ${esc(shortDate(d.date_end))}` : ''}</p>
        <p class="stat__period">${d.confirmed ? 'Confirmada' : '<span class="tag tag--yellow">Por confirmar</span>'}${d.date_start && daysUntil(d.date_start) >= 0 ? ` · ${esc(relativeDays(d.date_start))}` : ''}</p>
        ${d.note ? `<p class="stat__note">${esc(d.note)}</p>` : ''}
        ${d.source_url ? `<p class="stat__period">${sourceLink(d.source_url)}</p>` : ''}
      </div>`).join('')}</div>
    </div>` : ''}

    ${stats.length ? `<div class="block">
      ${blockHead('Indicadores', `${stats.length} datos con fuente`)}
      <div class="grid grid--3">${stats.map((s) => `<div class="stat">
        <p class="stat__label">${esc(s.label)}</p>
        <p class="stat__value">${esc(s.value)}</p>
        <p class="stat__period">${esc(s.period)} · ${sourceLink(s.source_url, s.source_name)}</p>
        ${s.note ? `<p class="stat__note">${esc(s.note)}</p>` : ''}
      </div>`).join('')}</div>
    </div>` : ''}

    ${trends.length ? `<div class="block">
      ${blockHead('Tendencias de fondo', 'lectura estructural, no coyuntura')}
      <div class="grid grid--2">${trends.map((t) => `<article class="card item">
        <h3 class="item__title">${esc(t.title)}</h3>
        <p class="item__field">${esc(t.summary)}</p>
        <p class="item__field item__field--fixy"><strong>Por qué le importa a Fixy</strong>${esc(t.why_it_matters_fixy)}</p>
        <div class="item__foot">${sourceLink(t.source_url, t.source_name)}</div>
      </article>`).join('')}</div>
    </div>` : ''}

    ${reg.length ? `<div class="block">
      ${blockHead('Regulación relevante', 'lo que cambia las reglas del juego')}
      <div class="grid grid--2">${reg.map((r) => `<article class="card item">
        <div class="item__top"><span class="tag ${r.status === 'vigente' ? 'tag--blue' : 'tag--yellow'}">${esc(r.status)}</span>${r.date ? `<span class="tag">${esc(shortDate(r.date))}</span>` : ''}</div>
        <h3 class="item__title">${esc(r.title)}</h3>
        <p class="item__field">${esc(r.summary)}</p>
        <div class="item__foot">${sourceLink(r.source_url, r.source_name)}</div>
      </article>`).join('')}</div>
    </div>` : ''}

    ${!stats.length && !trends.length && !dates.length && !reg.length ? emptyBox('Sin datos de mercado que coincidan con la búsqueda.') : ''}
  </div>`;
}

async function loadArchive() {
  if (state.archive) return state.archive;
  const index = await fetchJson('data/archive/index.json', { files: [] });
  const files = (index.files || []).slice(-24);
  const loaded = await Promise.all(files.map((f) => fetchJson(`data/archive/${f.file}`, [])));
  state.archive = files.map((f, i) => ({ ...f, items: loaded[i] || [] }));
  return state.archive;
}

function renderArchivo() {
  const f = state.filters.archivo;
  if (!state.archive) {
    loadArchive().then(render);
    return `<div class="section"><div class="loading"><span class="spinner"></span> Cargando el archivo histórico…</div></div>`;
  }

  const buckets = state.archive.filter((b) => f.kind === 'all' || b.kind === f.kind);
  const total = state.archive.reduce((a, b) => a + b.count, 0);

  const bar = filterBar([
    { section: 'archivo', key: 'kind', label: 'Tipo', value: f.kind, options: [
      { value: 'all', label: 'Todo' }, { value: 'news', label: 'Novedades' }, { value: 'events', label: 'Eventos' }, { value: 'ai', label: 'IA' }, { value: 'opportunities', label: 'Oportunidades' }, { value: 'content', label: 'Contenido' }
    ] }
  ]);

  const renderItem = (kind, item) => {
    if (kind === 'news') return newsCard(item);
    if (kind === 'events') return eventCard(item, { showStatus: false });
    if (kind === 'ai') return aiCard(item);
    if (kind === 'opportunities') return opportunityCard(item);
    if (kind === 'content') return contentCard(item);
    return '';
  };

  const KIND_LABEL = { news: 'Novedades', events: 'Eventos pasados', ai: 'Herramientas de IA', opportunities: 'Oportunidades', content: 'Contenido' };

  const blocks = buckets.map((b) => {
    const items = b.items.filter((i) => matches(state.query, i.title, i.name, i.topic, i.what_happened, i.fixy_relevance, i.fixy_use, i.action, i.city, i.category));
    if (!items.length) return '';
    const label = b.file.replace(/\.json$/, '').split('-').slice(1).join('-');
    return `<details class="card card--pad-sm details" style="margin-bottom:12px" ${state.query ? 'open' : ''}>
      <summary>${esc(KIND_LABEL[b.kind] || b.kind)} · ${esc(label)} — ${items.length} ${items.length === 1 ? 'registro' : 'registros'}</summary>
      <div class="grid grid--2" style="margin-top:12px">${items.map((i) => renderItem(b.kind, i)).join('')}</div>
    </details>`;
  }).filter(Boolean);

  return `<div class="section">
    <div class="notice"><span>El histórico se guarda solo y no se muestra en la home para no cargar la vista. Acá podés consultar eventos pasados, novedades, herramientas de IA y oportunidades anteriores.</span></div>
    ${bar}
    <div class="block">
      ${blockHead('Archivo histórico', `${total} registros guardados en ${state.archive.length} archivos`)}
      ${blocks.length ? blocks.join('') : emptyBox(total ? 'Sin registros que coincidan con la búsqueda.' : 'Todavía no hay nada archivado. El histórico se va llenando a medida que el radar corre cada día.')}
    </div>
  </div>`;
}

const RENDERERS = {
  hoy: renderHoy,
  agenda: renderAgenda,
  internacional: renderInternacional,
  novedades: renderNovedades,
  ia: renderIa,
  mercado: renderMercado,
  oportunidades: renderOportunidades,
  contenido: renderContenido,
  archivo: renderArchivo
};

/* ---------------------------------- render ------------------------------ */

function render() {
  const section = SECTIONS[state.section] ? state.section : 'hoy';
  const cfg = SECTIONS[section];

  $('#sectionTitle').textContent = cfg.title;
  const meta = state.data.meta;
  $('#sectionMeta').textContent = meta
    ? `${longDate(meta.date)} · actualizado ${meta.last_updated_ar || '—'}`
    : '';
  $('#searchWrap').style.display = cfg.search ? '' : 'none';

  $$('[data-nav]').forEach((el) => {
    const on = el.dataset.nav === section;
    el.classList.toggle('is-active', on);
    if (on) el.setAttribute('aria-current', 'page');
    else el.removeAttribute('aria-current');
  });

  const c = state.data.meta?.counters || {};
  const badges = {
    hoy: c.news_today || '',
    agenda: c.events_ar_upcoming || '',
    internacional: c.events_intl_upcoming || '',
    novedades: c.news_total || '',
    ia: c.ai_to_try || '',
    oportunidades: c.opportunities_open || '',
    contenido: c.content_ideas || ''
  };
  $$('[data-badge]').forEach((el) => { el.textContent = badges[el.dataset.badge] ?? ''; });

  $('#content').innerHTML = RENDERERS[section]();
  $('#sidebarStatus').textContent = meta ? `Última corrida: ${meta.last_updated_ar || '—'}` : 'Sin datos';
}

/* ---------------------------------- eventos ----------------------------- */

function goto(section, anchorId) {
  if (location.hash.slice(1) !== section) {
    history.pushState(null, '', `#${section}`);
  }
  state.section = section;
  state.query = '';
  $('#search').value = '';
  render();
  if (anchorId) {
    requestAnimationFrame(() => {
      const el = document.getElementById(anchorId);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.animate([{ boxShadow: '0 0 0 3px rgba(0,143,195,.55)' }, { boxShadow: '0 0 0 0 rgba(0,143,195,0)' }], { duration: 1400 });
      } else {
        window.scrollTo({ top: 0 });
      }
    });
  } else {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

function closeMobileNav() {
  $('#sidebar').classList.remove('is-open');
  $('#scrim').hidden = true;
  $('#sheet').hidden = true;
}

function bind() {
  document.addEventListener('click', (ev) => {
    const link = ev.target.closest('a[data-nav], a[data-goto]');
    if (link) {
      const href = link.getAttribute('href') || '';
      const section = href.startsWith('#') ? href.slice(1) : link.dataset.nav;
      if (SECTIONS[section]) {
        ev.preventDefault();
        closeMobileNav();
        goto(section, link.dataset.goto);
        return;
      }
    }

    const statusBtn = ev.target.closest('button[data-status][data-event]');
    if (statusBtn) {
      setStatus(statusBtn.dataset.event, statusBtn.dataset.status);
      return;
    }

    const chip = ev.target.closest('button[data-filter]');
    if (chip) {
      state.filters[chip.dataset.section][chip.dataset.filter] = chip.dataset.value;
      render();
      return;
    }

    const nav = ev.target.closest('button[data-cal-nav]');
    if (nav) {
      const dir = Number(nav.dataset.calNav);
      if (dir === 0) {
        state.calendar.month = state.today.slice(0, 7);
      } else {
        const [y, m] = (state.calendar.month || state.today.slice(0, 7)).split('-').map(Number);
        const d = new Date(Date.UTC(y, m - 1 + dir, 1));
        state.calendar.month = d.toISOString().slice(0, 7);
      }
      render();
      return;
    }

    const day = ev.target.closest('[data-cal-day]');
    if (day) {
      state.calendar.selected = state.calendar.selected === day.dataset.calDay ? null : day.dataset.calDay;
      render();
      return;
    }

    if (ev.target.closest('#dlInternal')) { downloadInternal(); return; }
    if (ev.target.closest('#menuBtn')) {
      $('#sidebar').classList.add('is-open');
      $('#scrim').hidden = false;
      return;
    }
    if (ev.target.closest('#moreBtn')) { $('#sheet').hidden = false; return; }
    if (ev.target.closest('[data-close-sheet]') || ev.target.closest('#scrim')) { closeMobileNav(); }
  });

  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') closeMobileNav();
    const cell = ev.target.closest?.('[data-cal-day]');
    if (cell && (ev.key === 'Enter' || ev.key === ' ')) {
      ev.preventDefault();
      cell.click();
    }
    if (ev.key === '/' && document.activeElement !== $('#search') && SECTIONS[state.section].search) {
      ev.preventDefault();
      $('#search').focus();
    }
  });

  document.addEventListener('change', (ev) => {
    const sel = ev.target.closest('select[data-filter-select]');
    if (sel) {
      state.filters[sel.dataset.section][sel.dataset.filterSelect] = sel.value;
      render();
    }
  });

  let searchTimer;
  $('#search').addEventListener('input', (ev) => {
    clearTimeout(searchTimer);
    const value = ev.target.value;
    searchTimer = setTimeout(() => { state.query = value.trim(); render(); }, 130);
  });

  window.addEventListener('hashchange', () => {
    const section = location.hash.slice(1);
    state.section = SECTIONS[section] ? section : 'hoy';
    render();
  });

  const logo = $('#brandLogo');
  logo.addEventListener('error', () => {
    const box = document.createElement('div');
    box.className = 'brand__logo--missing';
    box.textContent = 'Colocar logo en assets/logo-fixy.png';
    logo.replaceWith(box);
  }, { once: true });
}

/* ----------------------------------- init ------------------------------- */

(async function init() {
  loadLocal();
  bind();
  await loadAll();
  state.calendar.month = state.today.slice(0, 7);
  const section = location.hash.slice(1);
  state.section = SECTIONS[section] ? section : 'hoy';
  render();
})();
