#!/usr/bin/env node
/** Resumen de la última corrida, para el mensaje de commit y el log de la Action. */

import { readJson } from './lib/store.js';

const meta = await readJson('data/meta.json', {});
const c = meta.counters || {};
const mode = process.argv[2] || '--line';

if (mode === '--status') {
  console.log(meta.run_status || 'desconocido');
} else if (mode === '--line') {
  console.log(
    `+${c.added_news ?? 0} novedades · +${c.added_events ?? 0} eventos · +${c.added_ai ?? 0} IA`
  );
} else {
  const rows = [
    ['Novedades nuevas', c.added_news ?? 0],
    ['Novedades actualizadas', c.updated_news ?? 0],
    ['Eventos nuevos', c.added_events ?? 0],
    ['Eventos actualizados', c.updated_events ?? 0],
    ['Herramientas de IA nuevas', c.added_ai ?? 0],
    ['Oportunidades abiertas', c.opportunities_open ?? 0],
    ['Descartados por control de calidad', c.discarded_quality ?? 0],
    ['Movidos al archivo histórico', c.archived ?? 0]
  ];
  const out = [
    `### Radar diario · ${meta.date || '?'} · estado: ${meta.run_status || '?'}`,
    '',
    '| Métrica | Valor |',
    '| --- | --- |',
    ...rows.map(([k, v]) => `| ${k} | ${v} |`),
    ''
  ];
  if (meta.summary_line) out.push(`**Resumen del día:** ${meta.summary_line}`, '');
  if ((meta.run_errors || []).length) {
    out.push('**Errores:**', '');
    for (const e of meta.run_errors) out.push(`- \`${e.task}\`: ${e.message}`);
  }
  console.log(out.join('\n'));
}
