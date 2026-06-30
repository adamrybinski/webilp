import { validateConfig, usesCloudflareAi } from './llm-settings.js';
import { getSessionId } from './session.js';

/**
 * Pull assistant text from OpenAI-compatible chat response.
 * OpenRouter free/reasoning models often leave `content` empty and use `reasoning`.
 * @param {unknown} data
 */
export function extractCompletionText(data) {
  const choice = /** @type {Record<string, unknown>} */ (data)?.choices?.[0];
  if (!choice) {
    return { text: '', meta: { error: 'no choices in response' } };
  }

  const msg = /** @type {Record<string, unknown>} */ (choice.message ?? {});
  const finishReason = choice.finish_reason ?? choice.native_finish_reason;
  const model = /** @type {Record<string, unknown>} */ (data)?.model;

  if (msg.refusal) {
    return {
      text: '',
      meta: { finishReason, model, refusal: msg.refusal },
    };
  }

  const parts = [];

  const content = msg.content;
  if (typeof content === 'string' && content.trim()) {
    parts.push(content);
  } else if (Array.isArray(content)) {
    for (const block of content) {
      if (block?.type === 'text' && block.text) parts.push(block.text);
    }
  }

  for (const key of ['reasoning', 'reasoning_content']) {
    const v = msg[key];
    if (typeof v === 'string' && v.trim()) parts.push(v);
  }

  const details = msg.reasoning_details;
  if (Array.isArray(details)) {
    for (const d of details) {
      if (typeof d?.text === 'string' && d.text.trim()) parts.push(d.text);
      else if (typeof d?.content === 'string' && d.content.trim()) parts.push(d.content);
      else if (d?.type === 'text' && typeof d?.text === 'string') parts.push(d.text);
    }
  }

  if (typeof choice.text === 'string' && choice.text.trim()) {
    parts.push(choice.text);
  }

  return {
    text: parts.join('\n\n').trim(),
    meta: { finishReason, model, refusal: null },
  };
}

/** Prefer message.content for JSON-mode replies (ignore reasoning preamble). */
function extractContentOnly(msg) {
  const content = msg.content;
  if (typeof content === 'string' && content.trim()) return content.trim();
  if (Array.isArray(content)) {
    const chunks = content
      .filter((b) => b?.type === 'text' && b.text)
      .map((b) => b.text);
    if (chunks.length) return chunks.join('\n').trim();
  }
  return '';
}

/**
 * @param {import('./llm-settings.js').LlmConfig} config
 * @param {{ system: string, user: string, label?: string, jsonMode?: boolean, maxTokens?: number, onPhase?: (msg: string) => void }} opts
 */
export async function chatCompletion(config, {
  system,
  user,
  label = 'chat',
  jsonMode = false,
  maxTokens = 4096,
  onPhase,
}) {
  validateConfig(config);

  const useCf = usesCloudflareAi(config);
  const base = useCf ? '/api' : config.baseUrl.replace(/\/$/, '');
  const url = useCf ? `${base}/chat` : `${base}/chat/completions`;

  /** @type {Record<string, string>} */
  const headers = { 'Content-Type': 'application/json' };

  if (useCf) {
    headers['X-WebILP-Session'] = getSessionId();
  } else {
    headers.Authorization = `Bearer ${config.apiKey}`;
  }

  const isOpenRouter = !useCf && base.includes('openrouter.ai');
  if (isOpenRouter) {
    headers['HTTP-Referer'] = window.location.origin || 'http://localhost';
    headers['X-Title'] = 'WebILP';
  }

  /** @type {Record<string, unknown>} */
  const body = {
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature: 0.2,
    max_tokens: maxTokens,
  };

  if (!useCf) {
    body.model = config.model;
  }

  if (jsonMode && !useCf) {
    body.response_format = { type: 'json_object' };
  }

  // Reduce empty-content failures from reasoning-heavy free models on OpenRouter.
  if (isOpenRouter) {
    body.reasoning = { effort: 'low' };
  }

  let response;
  onPhase?.('waiting for model…');
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new Error(
      useCf
        ? `Network error calling ${url}: ${e.message}. Run \`npm run dev\` for local Workers AI, or deploy to Cloudflare Pages.`
        : `Network error calling ${url}: ${e.message}. Check CORS — use OpenRouter or an API that allows browser requests.`,
    );
  }

  onPhase?.('parsing response…');

  const rawText = await response.text();
  let data;
  try {
    data = JSON.parse(rawText);
  } catch {
    throw new Error(`Non-JSON response (${response.status}): ${rawText.slice(0, 300)}`);
  }

  if (!response.ok) {
    const msg = data?.error?.message ?? data?.message ?? rawText.slice(0, 300);
    if (response.status === 429 && data?.error?.code === 'session_limit') {
      throw new Error(
        `${msg} (${data?.error?.used ?? '?'}/${data?.error?.limit ?? '?'} used this session)`,
      );
    }
    throw new Error(`LLM ${response.status}: ${msg}`);
  }

  const { text: fullText, meta } = extractCompletionText(data);
  const text = jsonMode ? (extractContentOnly(/** @type {Record<string, unknown>} */ (data)?.choices?.[0]?.message ?? {}) || fullText) : fullText;

  if (!text) {
    const bits = [
      `Empty LLM response (${label}).`,
      meta.model ? `model=${meta.model}` : '',
      meta.finishReason ? `finish_reason=${meta.finishReason}` : '',
      meta.refusal ? `refusal=${meta.refusal}` : '',
      meta.error ?? '',
    ].filter(Boolean);
    bits.push(
      'Tip: openrouter/free sometimes routes to reasoning models with empty content — try preset "Gemma 2 9B (free)" or another model.',
    );
    throw new Error(bits.join(' '));
  }

  return text;
}

/** @param {string} raw */
export function extractJson(raw) {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) return JSON.parse(fenced[1].trim());

  try {
    return JSON.parse(trimmed);
  } catch {
    /* fall through to brace-balanced scan */
  }

  const start = trimmed.indexOf('{');
  if (start < 0) throw new Error('Could not find JSON object in LLM output.');

  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        return JSON.parse(trimmed.slice(start, i + 1));
      }
    }
  }

  throw new Error('Could not parse JSON — unbalanced braces in LLM output.');
}

/** @param {unknown} value */
export function prologFromJson(value) {
  if (value == null) return '';
  return String(value).replace(/\\n/g, '\n').replace(/\\r/g, '').trim();
}

/** @param {string} raw @param {string} [label] */
export function parseAssistJson(raw, label = 'response') {
  let data;
  try {
    data = extractJson(raw);
  } catch (e) {
    const fallback = extractFieldsFallback(raw);
    if (Object.keys(fallback).length > 0) return fallback;
    throw new Error(
      `${label}: ${e.message}\n\nRaw LLM text (first 800 chars):\n${raw.slice(0, 800)}`,
    );
  }

  if (data?.layer && typeof data.layer === 'object') data = data.layer;
  if (data?.result && typeof data.result === 'object') data = data.result;
  return data;
}

/** @param {string} raw */
function extractFieldsFallback(raw) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const field of [
    'bk',
    'bias',
    'exs',
    'asp_program',
    'exs_append',
    'examples_append',
    'new_examples',
    'notes',
  ]) {
    const re = new RegExp(`"${field}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`, 's');
    const m = raw.match(re);
    if (m) {
      out[field] = m[1]
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\');
    }
  }
  return out;
}

/** @param {Record<string, unknown>} data */
export function normalizeExsAppend(data) {
  const stringKeys = [
    'exs_append',
    'examples_append',
    'new_examples',
    'additional_examples',
    'append',
    'examples',
  ];
  for (const key of stringKeys) {
    const v = data[key];
    if (typeof v === 'string' && v.trim()) {
      const lines = prologFromJson(v);
      if (looksLikeExsLines(lines)) return lines;
    }
    if (Array.isArray(v)) {
      const lines = linesFromExampleArray(v);
      if (lines) return lines;
    }
  }

  const pos = data.pos ?? data.positives ?? data.positive;
  const neg = data.neg ?? data.negatives ?? data.negative;
  const fromPosNeg = formatPosNeg(pos, neg);
  if (fromPosNeg) return fromPosNeg;

  const exs = data.exs;
  if (typeof exs === 'string' && looksLikeExsLines(exs)) return prologFromJson(exs);
  if (Array.isArray(exs)) {
    const lines = linesFromExampleArray(exs);
    if (lines) return lines;
  }

  return '';
}

/** @param {string} text */
function looksLikeExsLines(text) {
  return /(?:^|\n)\s*(?:pos|neg)\s*\(/m.test(text);
}

/** @param {unknown} items @param {'pos'|'neg'} wrap */
function formatPosNegItems(items, wrap) {
  if (items == null) return [];
  const arr = Array.isArray(items) ? items : [items];
  /** @type {string[]} */
  const lines = [];
  for (const item of arr) {
    if (typeof item !== 'string') continue;
    const s = item.trim();
    if (!s) continue;
    if (/^(pos|neg)\s*\(/i.test(s)) {
      lines.push(s.endsWith('.') ? s : `${s}.`);
      continue;
    }
    lines.push(`${wrap}(${s.replace(/\.$/, '')}).`);
  }
  return lines;
}

/** @param {unknown} pos @param {unknown} neg */
function formatPosNeg(pos, neg) {
  const lines = [...formatPosNegItems(pos, 'pos'), ...formatPosNegItems(neg, 'neg')];
  return lines.join('\n');
}

/** @param {unknown[]} arr */
function linesFromExampleArray(arr) {
  /** @type {string[]} */
  const lines = [];
  for (const item of arr) {
    if (typeof item === 'string') {
      const s = item.trim();
      if (!s) continue;
      if (/^(pos|neg)\s*\(/i.test(s)) {
        lines.push(s.endsWith('.') ? s : `${s}.`);
      }
      continue;
    }
    if (item && typeof item === 'object') {
      const rec = /** @type {Record<string, unknown>} */ (item);
      const atom = rec.atom ?? rec.example ?? rec.term;
      if (typeof atom !== 'string' || !atom.trim()) continue;
      const kind = String(rec.type ?? rec.kind ?? rec.label ?? '').toLowerCase();
      if (kind === 'pos' || kind === 'positive' || rec.positive === true) {
        lines.push(wrapExample('pos', atom));
      } else if (kind === 'neg' || kind === 'negative' || rec.negative === true) {
        lines.push(wrapExample('neg', atom));
      }
    }
  }
  return lines.join('\n');
}

/** @param {'pos'|'neg'} wrap @param {string} atom */
function wrapExample(wrap, atom) {
  const s = atom.trim();
  if (/^(pos|neg)\s*\(/i.test(s)) return s.endsWith('.') ? s : `${s}.`;
  const inner = s.replace(/^[\w]+\(/, '').replace(/\)\.?$/, '');
  return `${wrap}(${inner}).`;
}

/** @param {Record<string, unknown>} data */
export function normalizeLayerFields(data) {
  const pick = (...keys) => {
    for (const k of keys) {
      if (data[k] != null && String(data[k]).trim()) return prologFromJson(data[k]);
    }
    return '';
  };
  return {
    bk: pick('bk', 'bk.pl', 'background', 'background_knowledge', 'backgroundKnowledge'),
    bias: pick('bias', 'bias.pl'),
    exs: pick('exs', 'exs.pl', 'examples'),
    notes: pick('notes', 'note', 'comment'),
  };
}

export async function testLlmConnection(config) {
  const reply = await chatCompletion(config, {
    system: 'Reply with exactly: ok',
    user: 'ping',
    label: 'test',
    maxTokens: 16,
  });
  return reply.trim().slice(0, 80);
}
