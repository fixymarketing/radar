/**
 * Cliente mínimo de la API de Claude con búsqueda web nativa (server tool).
 * Sin dependencias: usa fetch de Node 20+.
 *
 * Único secreto necesario: ANTHROPIC_API_KEY
 * Opcional: ANTHROPIC_MODEL (si no se define, se resuelve automáticamente)
 */

const API = 'https://api.anthropic.com/v1';
const VERSION = '2023-06-01';

// La herramienta de búsqueda del lado del servidor cambió de nombre a lo largo del
// tiempo y en algún momento pidió cabecera beta. Se prueban las combinaciones y se
// recuerda la que funciona, así el proyecto sobrevive a cambios de la API sin tocar
// código.
const WEB_SEARCH_VARIANTS = ['web_search_20250305', 'web_search_20241022', 'web_search'];
const BETA_HEADERS = [null, 'web-search-2025-03-05'];

let cachedModel = null;
let cachedSearchTool = null;

function apiKey() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw new Error(
      'Falta ANTHROPIC_API_KEY. Agregala como GitHub Secret del repositorio (Settings → Secrets and variables → Actions).'
    );
  }
  return key;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function request(path, body, { retries = 4, beta = null } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const headers = {
      'content-type': 'application/json',
      'x-api-key': apiKey(),
      'anthropic-version': VERSION
    };
    if (beta) headers['anthropic-beta'] = beta;
    const res = await fetch(`${API}${path}`, {
      method: body ? 'POST' : 'GET',
      headers,
      body: body ? JSON.stringify(body) : undefined
    });

    if (res.ok) return res.json();

    const text = await res.text();
    lastError = new Error(`HTTP ${res.status} en ${path}: ${text.slice(0, 600)}`);
    lastError.status = res.status;
    lastError.body = text;

    // 400/401/403/404 no se reintentan: son errores de configuración.
    if (res.status < 429 && res.status !== 408) throw lastError;

    const wait = Math.min(60000, 2000 * 2 ** attempt) + Math.floor(Math.random() * 1000);
    console.warn(`  ↻ reintento ${attempt + 1}/${retries} tras HTTP ${res.status} (espera ${wait} ms)`);
    await sleep(wait);
  }
  throw lastError;
}

/** Resuelve el modelo a usar. Preferencia: env → Sonnet más reciente → primero disponible. */
export function resolveModel() {
  if (!cachedModel) cachedModel = doResolveModel();
  return cachedModel;
}

async function doResolveModel() {
  if (process.env.ANTHROPIC_MODEL) {
    console.log(`  · modelo fijado por configuración: ${process.env.ANTHROPIC_MODEL}`);
    return process.env.ANTHROPIC_MODEL;
  }
  const list = await request('/models?limit=100', null, { retries: 2 });
  const models = (list.data || []).filter((m) => m.id && !/deprecated/i.test(m.id));
  const score = (m) => {
    let s = 0;
    if (/sonnet/i.test(m.id)) s += 100;
    else if (/opus/i.test(m.id)) s += 60;
    else if (/haiku/i.test(m.id)) s += 40;
    const created = Date.parse(m.created_at || '') || 0;
    return s * 1e13 + created;
  };
  models.sort((a, b) => score(b) - score(a));
  if (!models.length) throw new Error('La API no devolvió modelos disponibles.');
  console.log(`  · modelo resuelto automáticamente: ${models[0].id}`);
  return models[0].id;
}

function searchTool(variant, maxUses) {
  return {
    type: variant,
    name: 'web_search',
    max_uses: maxUses,
    user_location: {
      type: 'approximate',
      country: 'AR',
      timezone: 'America/Argentina/Buenos_Aires'
    }
  };
}

/**
 * Ejecuta un prompt con búsqueda web y devuelve el texto final del modelo.
 */
export async function askWithSearch({
  system,
  prompt,
  maxSearches = 8,
  maxTokens = 8000,
  temperature = 0
}) {
  const model = await resolveModel();
  const combos = cachedSearchTool
    ? [cachedSearchTool]
    : WEB_SEARCH_VARIANTS.flatMap((variant) => BETA_HEADERS.map((beta) => ({ variant, beta })));
  let lastError;

  for (const combo of combos) {
    try {
      const data = await request(
        '/messages',
        {
          model,
          max_tokens: maxTokens,
          temperature,
          system,
          tools: [searchTool(combo.variant, maxSearches)],
          messages: [{ role: 'user', content: prompt }]
        },
        { beta: combo.beta }
      );
      cachedSearchTool = combo;
      const text = (data.content || [])
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim();
      return { text, usage: data.usage || {}, model, searchTool: combo };
    } catch (err) {
      lastError = err;
      const looksLikeToolProblem =
        err.status === 400 && /tool|web_search|beta|type/i.test(err.body || '');
      if (!looksLikeToolProblem) throw err;
      console.warn(
        `  · combinación de búsqueda no disponible (${combo.variant}${combo.beta ? ` + beta ${combo.beta}` : ''}), probando otra`
      );
    }
  }
  throw new Error(
    `No se pudo usar la herramienta de búsqueda web de la API de Claude. Último error: ${lastError?.message}`
  );
}

/**
 * Extrae el primer JSON balanceado (array u objeto) de un texto.
 * Tolera fences de markdown y texto alrededor.
 */
export function extractJson(text = '') {
  const cleaned = text.replace(/^\s*```(?:json)?/gim, '').replace(/```\s*$/gim, '');
  const starts = [];
  for (let i = 0; i < cleaned.length; i += 1) {
    if (cleaned[i] === '[' || cleaned[i] === '{') starts.push(i);
    if (starts.length > 0) break;
  }
  if (!starts.length) return null;

  const start = starts[0];
  const open = cleaned[start];
  const close = open === '[' ? ']' : '}';
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < cleaned.length; i += 1) {
    const ch = cleaned[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) {
        const slice = cleaned.slice(start, i + 1);
        try {
          return JSON.parse(slice);
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/** Pide JSON y reintenta una vez con un mensaje de reparación si no parsea. */
export async function askForJson(options) {
  const first = await askWithSearch(options);
  const parsed = extractJson(first.text);
  if (parsed) return { data: parsed, usage: first.usage, raw: first.text };

  console.warn('  · la respuesta no era JSON válido: pidiendo reparación');
  const repair = await askWithSearch({
    ...options,
    maxSearches: 1,
    prompt: `${options.prompt}\n\n---\nTu respuesta anterior no era JSON válido. Devolvé EXCLUSIVAMENTE el JSON pedido, sin texto alrededor, sin comentarios y sin fences de markdown. Respuesta anterior:\n${first.text.slice(0, 6000)}`
  });
  const second = extractJson(repair.text);
  if (!second) throw new Error('El modelo no devolvió JSON válido en dos intentos.');
  return { data: second, usage: repair.usage, raw: repair.text };
}
