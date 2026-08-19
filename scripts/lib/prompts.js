/**
 * Prompts del proceso diario. Todo el criterio editorial vive acá y en config.json,
 * así se puede ajustar el radar sin tocar la interfaz.
 */

export function systemPrompt(cfg) {
  return [
    `Sos el analista de inteligencia de mercado de ${cfg.company.name}.`,
    cfg.company.what,
    cfg.company.team,
    '',
    'Tu trabajo es un RADAR EJECUTIVO CURADO, no un portal de noticias. Menos y mejor.',
    '',
    'Cada ítem que propongas tiene que superar al menos una de estas preguntas:',
    ...cfg.company.questions_that_matter.map((q) => `- ${q}`),
    '',
    'Descartá sin excepción:',
    ...cfg.editorial.reject.map((r) => `- ${r}`),
    '',
    'REGLAS ABSOLUTAS:',
    ...cfg.editorial.never.map((r) => `- Nunca ${r}.`),
    `- Si un dato no está confirmado, escribí exactamente "${cfg.editorial.unconfirmed_label}" en ese campo.`,
    '- Usá la búsqueda web para verificar TODO. Si no encontraste la fuente, no lo incluyas.',
    '- Priorizá fuentes oficiales y medios confiables.',
    '- Escribí en español rioplatense, claro y sin jerga de marketing.',
    '- Preferí devolver menos ítems antes que rellenar con contenido flojo. Un array vacío es una respuesta válida y correcta.',
    '',
    'Devolvés siempre y únicamente JSON válido, sin texto alrededor y sin fences de markdown.'
  ].join('\n');
}

function knownBlock(label, list) {
  if (!list.length) return `${label}: (ninguno todavía)`;
  return `${label} (NO los repitas, salvo que haya una novedad real y concreta sobre el mismo tema):\n${list
    .map((l) => `- ${l}`)
    .join('\n')}`;
}

export function newsPrompt(cfg, ctx) {
  return `Hoy es ${ctx.todayLong} (${ctx.today}).

Buscá en la web las novedades REALES publicadas en los últimos ${cfg.windows.news_lookback_days} días que un operador logístico de eCommerce argentino debería conocer hoy.

Categorías posibles: ${cfg.topics.news.join(', ')}.
Foco: Argentina y LATAM. Sumá novedades globales solo si impactan la región.
Fuentes a priorizar: ${cfg.priority_sources.slice(0, 18).join(', ')} (no te limites a esta lista).

${knownBlock('Ya tenemos publicadas estas noticias', ctx.knownNews)}

Devolvé un array JSON con como máximo ${cfg.limits.news_per_run} ítems (menos si no hay nada bueno), con esta forma exacta:
[{
  "title": "titular propio, claro, sin clickbait",
  "what_happened": "máximo 3 oraciones, factual y concreto",
  "why_it_matters": "1-2 oraciones de interpretación: qué significa para el ecosistema",
  "fixy_impact": "1-2 oraciones SOLO si hay un impacto real y concreto para Fixy; si no, null",
  "category": "una de: ${cfg.topics.news.join(' | ')}",
  "geo": "Argentina | LATAM | Global",
  "source_name": "medio o institución",
  "source_url": "URL del artículo original",
  "published_date": "YYYY-MM-DD",
  "priority": "alta | relevante | informativo",
  "tags": ["3 a 5 etiquetas cortas"]
}]`;
}

export function eventsArPrompt(cfg, ctx) {
  return `Hoy es ${ctx.todayLong} (${ctx.today}).

Buscá EVENTOS REALES Y VERIFICABLES en ARGENTINA que ocurran entre ${ctx.today} y ${ctx.horizon} (próximos ${cfg.windows.agenda_days} días), relacionados con: ${cfg.topics.events.join(', ')}, comercio digital, fulfillment, última milla, negocios digitales.

Referencias de ecosistema (NO es una lista cerrada, buscá también fuera de ella): ${cfg.ecosystem_hints.argentina.join(', ')}.
Buscá en todo el país. Atención especial a: ${cfg.ecosystem_hints.cities.join(', ')}.
Si encontrás un evento importante YA CONFIRMADO posterior a ${ctx.horizon}, incluilo con "beyond_90": true.

${knownBlock('Ya tenemos estos eventos en agenda', ctx.knownEvents)}
Si encontrás información NUEVA sobre uno de esos eventos (fecha confirmada, sede, agenda), incluilo igual con los datos actualizados: el sistema lo va a fusionar, no duplicar.

Devolvé un array JSON con como máximo ${cfg.limits.events_ar_per_run} eventos:
[{
  "name": "nombre oficial",
  "organizer": "organizador o \\"${cfg.editorial.unconfirmed_label}\\"",
  "date_start": "YYYY-MM-DD o null",
  "date_end": "YYYY-MM-DD o null",
  "date_confirmed": true/false,
  "date_note": "aclaración si la fecha es aproximada o hay versiones distintas, o null",
  "city": "ciudad o \\"${cfg.editorial.unconfirmed_label}\\"",
  "province": "provincia o null",
  "country": "Argentina",
  "venue": "sede o \\"${cfg.editorial.unconfirmed_label}\\"",
  "venue_confirmed": true/false,
  "format": "presencial | virtual | híbrido | ${cfg.editorial.unconfirmed_label}",
  "category": "una de: ${cfg.topics.events.join(' | ')}",
  "url": "URL oficial del evento",
  "source_url": "URL donde verificaste",
  "description": "1-2 oraciones concretas, sin marketing",
  "fixy_relevance": "1-2 oraciones: por qué le sirve a Fixy en concreto",
  "priority": "alta | relevante | informativo",
  "beyond_90": true/false
}]`;
}

export function eventsIntlPrompt(cfg, ctx) {
  return `Hoy es ${ctx.todayLong} (${ctx.today}).

Buscá EVENTOS INTERNACIONALES REALES (fuera de Argentina) desde hoy y hasta 12 meses, aplicando un FILTRO DE RELEVANCIA ALTO. Prioridad LATAM; eventos globales solo si son excepcionalmente relevantes.

Incluí solo eventos que puedan justificar al menos una de estas cosas para Fixy: evaluar un viaje, networking estratégico, presencia institucional, sponsorship, generación de negocios, aprendizaje relevante, expansión regional o conexión con actores clave del ecosistema.

Referencias (NO lista cerrada, buscá activamente eventos que Fixy todavía no conoce): ${cfg.ecosystem_hints.international.join(', ')}.

${knownBlock('Ya tenemos estos eventos internacionales', ctx.knownIntl)}

Devolvé un array JSON con como máximo ${cfg.limits.events_intl_per_run} eventos:
[{
  "name": "...",
  "organizer": "...",
  "date_start": "YYYY-MM-DD o null",
  "date_end": "YYYY-MM-DD o null",
  "date_confirmed": true/false,
  "date_note": "... o null",
  "city": "...",
  "country": "...",
  "venue": "... o \\"${cfg.editorial.unconfirmed_label}\\"",
  "venue_confirmed": true/false,
  "format": "presencial | virtual | híbrido | ${cfg.editorial.unconfirmed_label}",
  "category": "una de: ${cfg.topics.events.join(' | ')}",
  "url": "URL oficial",
  "source_url": "URL donde verificaste",
  "description": "1-2 oraciones",
  "fixy_relevance": "por qué justificaría viaje / networking / presencia / negocios",
  "justification_type": "viaje | networking | institucional | sponsorship | negocios | aprendizaje | expansión regional",
  "priority": "alta | relevante | informativo",
  "beyond_90": true/false
}]
"beyond_90" es true si el evento empieza después de ${ctx.horizon} o si la fecha no está confirmada pero es claramente posterior.`;
}

export function aiPrompt(cfg, ctx) {
  return `Hoy es ${ctx.todayLong} (${ctx.today}).

Esta sección NO es "noticias de inteligencia artificial". El objetivo es detectar NUEVAS CAPACIDADES DE IA que puedan mejorar cómo trabaja Fixy.

Buscá novedades reales de los últimos ${cfg.windows.ai_lookback_days} días en: OpenAI/ChatGPT, Anthropic/Claude, Google Gemini y AI Studio, NotebookLM, Microsoft Copilot, automatización (n8n, Make, Zapier), agentes, IA aplicada a logística, atención al cliente, análisis de datos y contenido. También DESCUBRÍ herramientas emergentes que una PyME argentina probablemente no conoce.

No recomiendes nada solo porque está de moda. Si algo no tiene un uso claro para un equipo chico de logística, no lo incluyas.

${knownBlock('Ya tenemos en el radar', ctx.knownAi)}

Devolvé un array JSON con como máximo ${cfg.limits.ai_per_run} ítems:
[{
  "name": "herramienta o capacidad",
  "vendor": "...",
  "what_it_is": "1-2 oraciones sin jerga",
  "what_changed": "1-2 oraciones: qué cambió y por qué aparece ahora",
  "fixy_use": "2-3 oraciones MUY concretas de uso real en Fixy",
  "verdict": "probar | seguir | no_prioritario",
  "verdict_reason": "1 oración",
  "categories": ["subconjunto de: ${cfg.topics.ai_uses.join(', ')}"],
  "pricing_note": "gratis | freemium | pago | no confirmado + detalle breve",
  "source_url": "URL oficial o de medio confiable",
  "published_date": "YYYY-MM-DD",
  "priority": "alta | relevante | informativo"
}]`;
}

export function synthesisPrompt(cfg, ctx) {
  return `Hoy es ${ctx.todayLong} (${ctx.today}).

Abajo está el material del radar de Fixy de hoy. Analizalo en conjunto: noticias, eventos, IA y tendencias.

=== NOVEDADES RECIENTES ===
${ctx.newsDigest || '(sin novedades nuevas hoy)'}

=== EVENTOS PRÓXIMOS ===
${ctx.eventsDigest || '(sin eventos próximos)'}

=== IA EN EL RADAR ===
${ctx.aiDigest || '(sin novedades de IA)'}

=== OPORTUNIDADES YA DETECTADAS (no las repitas) ===
${ctx.knownOpps.join('\n') || '(ninguna)'}

=== TEMAS DE CONTENIDO YA DETECTADOS (no los repitas) ===
${ctx.knownContent.join('\n') || '(ninguno)'}

Tareas:
1. OPORTUNIDADES: detectá lo realmente accionable. Máximo 3 nuevas por día, y está perfecto devolver 0 si no hay nada bueno. No inventes oportunidades para llenar espacio.
2. CONTENIDO: máximo ${cfg.limits.content_per_run} oportunidades editoriales, y 0 si no hay nada con ángulo propio. No escribas la publicación: detectá el tema antes de que se sature.
3. DESTACADOS DEL DÍA: elegí entre 3 y ${cfg.limits.highlights} elementos que alguien de Fixy tiene que ver hoy, en orden de importancia. Usá los títulos exactos del material de arriba.

Devolvé un objeto JSON con esta forma exacta:
{
  "opportunities": [{
    "title": "qué oportunidad es",
    "context": "2-3 oraciones: qué ocurrió que la genera",
    "action": "una acción concreta y ejecutable para Fixy",
    "type": "comercial | estratégica | producto | marketing | nueva línea de negocio | alianza",
    "priority": "alta | relevante | informativo",
    "source_url": "URL de respaldo",
    "linked": ["títulos del material relacionado"]
  }],
  "content": [{
    "topic": "tema",
    "why_now": "por qué ahora",
    "fixy_angle": "el ángulo propio de Fixy",
    "formats": ["LinkedIn | Reel | nota | prensa | carrusel | artículo | video"],
    "priority": "alta | relevante | informativo",
    "source_url": "URL de respaldo"
  }],
  "highlights": [{
    "title": "título exacto tomado del material de arriba",
    "kind": "news | event | ai | opportunity",
    "priority": "alta | relevante | informativo",
    "one_liner": "una sola oración explicando por qué importa hoy"
  }],
  "summary_line": "una oración que resuma el día para el equipo de Fixy"
}`;
}
