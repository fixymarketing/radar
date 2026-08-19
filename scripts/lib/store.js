import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
export const DATA = path.join(ROOT, 'data');
export const ARCHIVE = path.join(DATA, 'archive');
export const INTERNAL = path.join(DATA, 'internal');

export const TZ = 'America/Argentina/Buenos_Aires';

/** Fecha ISO (YYYY-MM-DD) en hora de Argentina. */
export function todayAR(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

/** Marca de tiempo legible en hora de Argentina. */
export function nowAR(date = new Date()) {
  const f = new Intl.DateTimeFormat('es-AR', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(date);
  return f;
}

export function isoNow(date = new Date()) {
  return date.toISOString();
}

export function daysBetween(aIso, bIso) {
  const a = new Date(`${aIso}T00:00:00Z`).getTime();
  const b = new Date(`${bIso}T00:00:00Z`).getTime();
  return Math.round((a - b) / 86400000);
}

export function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export async function ensureDirs() {
  for (const dir of [DATA, ARCHIVE, INTERNAL]) {
    await fs.mkdir(dir, { recursive: true });
  }
}

export async function readJson(relPath, fallback) {
  const full = path.isAbsolute(relPath) ? relPath : path.join(ROOT, relPath);
  try {
    const raw = await fs.readFile(full, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return structuredClone(fallback);
    throw new Error(`No se pudo leer ${relPath}: ${err.message}`);
  }
}

export async function writeJson(relPath, value) {
  const full = path.isAbsolute(relPath) ? relPath : path.join(ROOT, relPath);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

/**
 * Estado interno de Fixy (Vamos / Evaluar / No vamos y notas).
 * La automatización SOLO lee este archivo: nunca lo sobrescribe.
 */
export async function readInternal() {
  return readJson('data/internal/event-status.json', {
    version: 1,
    note: 'Datos internos de Fixy. La automatización diaria NUNCA escribe este archivo.',
    statuses: {}
  });
}

/** Reescribe el índice del archivo histórico. */
export async function rebuildArchiveIndex() {
  let files = [];
  try {
    files = await fs.readdir(ARCHIVE);
  } catch {
    return { updated_at: isoNow(), files: [] };
  }
  const entries = [];
  for (const file of files.sort()) {
    if (!file.endsWith('.json') || file === 'index.json') continue;
    try {
      const items = await readJson(path.join(ARCHIVE, file), []);
      const kind = file.split('-')[0];
      entries.push({
        file,
        kind,
        count: Array.isArray(items) ? items.length : 0
      });
    } catch {
      /* archivo corrupto: se ignora en el índice */
    }
  }
  const index = { updated_at: isoNow(), files: entries };
  await writeJson(path.join(ARCHIVE, 'index.json'), index);
  return index;
}

/** Mueve items a un archivo histórico, deduplicando por id. */
export async function pushToArchive(fileName, items) {
  if (!items.length) return 0;
  const target = path.join(ARCHIVE, fileName);
  const existing = await readJson(target, []);
  const byId = new Map(existing.map((it) => [it.id, it]));
  for (const item of items) byId.set(item.id, item);
  const merged = [...byId.values()];
  await writeJson(target, merged);
  return items.length;
}
