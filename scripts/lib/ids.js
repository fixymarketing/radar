import crypto from 'node:crypto';

const STOP_TOKENS = new Set([
  'de', 'del', 'la', 'el', 'los', 'las', 'y', 'en', 'a', 'the', 'of', 'and',
  'edicion', 'edition', 'expo', 'conf'
]);

/** Quita acentos y normaliza a minúsculas. */
export function deaccent(str = '') {
  return String(str)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

export function slugify(str = '') {
  return deaccent(str)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export function shortHash(str = '', len = 10) {
  return crypto.createHash('sha1').update(String(str)).digest('hex').slice(0, len);
}

/**
 * Normaliza una URL para deduplicar: fuerza https, baja el host, quita www,
 * elimina parámetros de tracking y barras/fragmentos finales.
 */
export function normalizeUrl(raw = '') {
  if (!raw) return '';
  let url;
  try {
    url = new URL(String(raw).trim());
  } catch {
    return deaccent(String(raw).trim());
  }
  url.protocol = 'https:';
  url.hash = '';
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
  const drop = [];
  for (const key of url.searchParams.keys()) {
    if (/^(utm_|fbclid|gclid|mc_|ref|ref_src|igshid|si|s_cid|__|amp)/i.test(key)) drop.push(key);
  }
  drop.forEach((k) => url.searchParams.delete(k));
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '');
  url.searchParams.sort();
  return url.toString().replace(/\?$/, '');
}

/** Clave canónica de evento: nombre sin años, ordinales ni ruido. */
export function eventKey(name = '') {
  const cleaned = deaccent(name)
    .replace(/\b(19|20)\d{2}\b/g, ' ')
    .replace(/\b[ivxlcdm]{1,7}\b/g, ' ')
    .replace(/\b\d+(ª|a|º|o|st|nd|rd|th)?\b/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ');
  const tokens = cleaned
    .split(/\s+/)
    .filter((t) => t && t.length > 1 && !STOP_TOKENS.has(t))
    .sort();
  return tokens.join('-');
}

export function eventId(evt) {
  const year = (evt.date_start || evt.date_note || '').slice(0, 4) || 'sf';
  return `ev-${slugify(eventKey(evt.name)).slice(0, 48)}-${year}`;
}

export function newsId(item) {
  const canonical = normalizeUrl(item.source_url || '');
  return `nw-${shortHash(canonical || deaccent(item.title))}`;
}

export function aiId(item) {
  return `ai-${slugify(`${item.vendor || ''} ${item.name || ''}`).slice(0, 60)}`;
}

export function oppId(item) {
  return `op-${shortHash(deaccent(item.title), 8)}`;
}

export function contentId(item) {
  return `ct-${shortHash(deaccent(item.topic), 8)}`;
}

/** Similitud de Jaccard sobre tokens. Suficiente y sin dependencias. */
export function titleSimilarity(a = '', b = '') {
  const norm = (s) =>
    new Set(
      deaccent(s)
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((t) => t.length > 2 && !STOP_TOKENS.has(t))
    );
  const A = norm(a);
  const B = norm(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter += 1;
  return inter / (A.size + B.size - inter);
}
