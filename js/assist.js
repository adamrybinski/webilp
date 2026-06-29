import { chatCompletion, parseAssistJson, normalizeLayerFields, prologFromJson, normalizeExsAppend } from './llm.js';
import { parseBias } from './bias.js';
import { verifyCandidateKnowledge } from './verify-knowledge.js';

const GENERATE_KNOWLEDGE_SYSTEM = `You extract a small, ADDITIVE ASP/Prolog fact program from unstructured source text.
The fragment will be merged with an existing knowledge base.

Return ONLY a JSON object:
{
  "asp_program": "string — facts and rules only, valid Prolog/ASP syntax",
  "notes": "string — modeling notes"
}

Rules:
- Output only NEW facts/rules grounded in the source text.
- Use lowercase predicates. Variables uppercase.
- No #show directives. No markdown outside JSON.
- Prefer reusing predicates already in the knowledge base when provided.`;

const DRAFT_LAYER_SYSTEM = `You draft a minimal Popper ILP layer from domain description + optional source text.

Return ONLY a JSON object (no markdown fences):
{
  "bk": "mother(ann,amy).\\nfather(steve,amy).",
  "bias": "max_vars(4).\\nmax_body(2).\\nmax_clauses(1).\\nhead_pred(grandparent,2).\\nbody_pred(mother,2).",
  "exs": "pos(grandparent(ann,amelia)).\\nneg(grandparent(steve,amelia)).",
  "notes": "one sentence"
}

Rules:
- bk: Prolog facts only (one per line).
- bias: head_pred, body_pred, max_vars, max_body, max_clauses(1) for browser Popper.
- exs: pos(...) and neg(...) atoms matching head_pred in bias.
- Must be consistent: every example should be derivable or not derivable from bk once the target rule is learned.
- Keep small (≤8 facts, ≤4 examples).`;

const REFINE_LAYER_SYSTEM = `You revise a Popper ILP layer based on human feedback.

Return ONLY JSON:
{
  "bk": "revised bk.pl",
  "bias": "revised bias.pl",
  "exs": "revised exs.pl",
  "notes": "what you changed"
}

Apply the human feedback precisely. Keep valid Popper syntax and consistency between bk, bias, and exs.`;

const DRAFT_EXAMPLES_SYSTEM = `You propose additional pos/neg examples for an existing Popper layer.

Return ONLY JSON (no markdown fences):
{
  "exs_append": "pos(grandparent(ann,amelia)).\\nneg(grandparent(steve,amelia)).",
  "notes": "one sentence"
}

Rules:
- exs_append: NEW lines only (pos(...) or neg(...)), one per line, matching head_pred in bias.
- Do NOT repeat examples already in current exs.pl.
- Add 2–4 examples grounded in bk.pl facts.
- Use the exact Popper syntax: pos(atom). and neg(atom).`;

/**
 * @param {import('./llm-settings.js').LlmConfig} config
 * @param {{ sourceText: string, kb: string, gapTargets?: string[] }} opts
 * @param {{ onPhase?: (msg: string) => void }} [opts]
 */
export async function extractKnowledge(config, { sourceText, kb, gapTargets = [] }, opts = {}) {
  const gapBlock =
    gapTargets.length > 0
      ? `\nPrefer extracting facts about: ${gapTargets.join(', ')}`
      : '';

  const user = `Existing knowledge base:\n${kb || '(empty)'}\n\nSource text:\n${sourceText}${gapBlock}`;

  const raw = await chatCompletion(config, {
    system: GENERATE_KNOWLEDGE_SYSTEM,
    user,
    label: 'extract_knowledge',
    jsonMode: true,
    onPhase: opts.onPhase,
  });

  const data = parseAssistJson(raw, 'extract_knowledge');
  const asp = prologFromJson(data.asp_program ?? data.asp ?? data.facts ?? data.program);
  if (!asp) {
    throw new Error(
      `LLM returned JSON but asp_program was empty. Notes: ${data.notes ?? '(none)'}\n\nRaw (first 500 chars):\n${raw.slice(0, 500)}`,
    );
  }
  return {
    asp_program: asp,
    notes: prologFromJson(data.notes),
  };
}

/**
 * @param {import('./llm-settings.js').LlmConfig} config
 * @param {{ description: string, sourceText?: string }} layerOpts
 * @param {{ onPhase?: (msg: string) => void }} [opts]
 */
export async function draftPopperLayer(config, { description, sourceText = '' }, opts = {}) {
  const user = `Domain description:\n${description}\n\nOptional source text:\n${sourceText || '(none)'}`;

  let raw = await chatCompletion(config, {
    system: DRAFT_LAYER_SYSTEM,
    user,
    label: 'draft_layer',
    jsonMode: true,
    onPhase: opts.onPhase,
  });

  let data;
  try {
    data = parseAssistJson(raw, 'draft_layer');
  } catch (e) {
    opts.onPhase?.('retrying (strict JSON only)…');
    raw = await chatCompletion(config, {
      system: `${DRAFT_LAYER_SYSTEM}\n\nCRITICAL: Output must be exactly one JSON object. No explanations, no extra text.`,
      user,
      label: 'draft_layer_retry',
      jsonMode: true,
      maxTokens: 2048,
      onPhase: opts.onPhase,
    });
    data = parseAssistJson(raw, 'draft_layer_retry');
  }
  const result = normalizeLayerFields(data);
  if (!result.bk && !result.bias && !result.exs) {
    throw new Error(
      `LLM returned JSON but bk, bias, and exs were all empty. Notes: ${result.notes || '(none)'}\n\nRaw (first 800 chars):\n${raw.slice(0, 800)}`,
    );
  }
  return result;
}

/**
 * @param {import('./llm-settings.js').LlmConfig} config
 * @param {{ sourceText?: string, bk: string, bias: string, exs: string, feedback: string }} layerOpts
 * @param {{ onPhase?: (msg: string) => void }} [opts]
 */
export async function refineLayer(config, { sourceText = '', bk, bias, exs, feedback }, opts = {}) {
  const user = [
    sourceText ? `Original source:\n${sourceText}` : '',
    `Current bk.pl:\n${bk}`,
    `Current bias.pl:\n${bias}`,
    `Current exs.pl:\n${exs}`,
    `Human feedback (apply this):\n${feedback}`,
  ]
    .filter(Boolean)
    .join('\n\n');

  let raw = await chatCompletion(config, {
    system: REFINE_LAYER_SYSTEM,
    user,
    label: 'refine_layer',
    jsonMode: true,
    onPhase: opts.onPhase,
  });

  let data;
  try {
    data = parseAssistJson(raw, 'refine_layer');
  } catch (e) {
    opts.onPhase?.('retrying (strict JSON only)…');
    raw = await chatCompletion(config, {
      system: `${REFINE_LAYER_SYSTEM}\n\nCRITICAL: Output must be exactly one JSON object. No explanations, no extra text.`,
      user,
      label: 'refine_layer_retry',
      jsonMode: true,
      maxTokens: 2048,
      onPhase: opts.onPhase,
    });
    data = parseAssistJson(raw, 'refine_layer_retry');
  }
  const result = normalizeLayerFields(data);
  if (!result.bk && !result.bias && !result.exs) {
    throw new Error(
      `Refine returned empty layer. Notes: ${result.notes || '(none)'}\n\nRaw (first 800 chars):\n${raw.slice(0, 800)}`,
    );
  }
  return result;
}

/**
 * @param {import('./llm-settings.js').LlmConfig} config
 * @param {{ description: string, bk: string, bias: string, exs: string }} layerOpts
 * @param {{ onPhase?: (msg: string) => void }} [opts]
 */
export async function suggestExamples(config, { description, bk, bias, exs }, opts = {}) {
  let headHint = '';
  try {
    const parsed = parseBias(bias);
    headHint = `Target predicate: ${parsed.headPred}/${parsed.headArity}\n`;
  } catch {
    /* bias parse errors surfaced elsewhere */
  }

  const user = [
    `Task: ${description}`,
    headHint,
    `bias.pl:\n${bias}`,
    `bk.pl:\n${bk || '(empty)'}`,
    `current exs.pl:\n${exs || '(empty)'}`,
    'Return only NEW pos/neg examples not already listed above.',
  ].join('\n\n');

  let raw = await chatCompletion(config, {
    system: DRAFT_EXAMPLES_SYSTEM,
    user,
    label: 'suggest_examples',
    jsonMode: true,
    maxTokens: 1024,
    onPhase: opts.onPhase,
  });

  let data;
  try {
    data = parseAssistJson(raw, 'suggest_examples');
  } catch (e) {
    opts.onPhase?.('retrying (strict JSON only)…');
    raw = await chatCompletion(config, {
      system: `${DRAFT_EXAMPLES_SYSTEM}\n\nCRITICAL: Output must be exactly one JSON object. No explanations, no extra text.`,
      user,
      label: 'suggest_examples_retry',
      jsonMode: true,
      maxTokens: 1024,
      onPhase: opts.onPhase,
    });
    data = parseAssistJson(raw, 'suggest_examples_retry');
  }
  const exs_append = normalizeExsAppend(data);
  const notes = prologFromJson(data.notes ?? data.note ?? data.comment);

  if (!exs_append) {
    throw new Error(
      [
        'suggest_examples: LLM returned JSON but no usable examples.',
        notes ? `Notes: ${notes}` : '',
        `Keys received: ${Object.keys(data).join(', ') || '(none)'}`,
        '',
        'Raw (first 800 chars):',
        raw.slice(0, 800),
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }

  return { exs_append, notes };
}

/**
 * Extract → verify → optionally merge into bk.
 * @param {Function} clingoRun
 */
export async function learnFromText(clingoRun, config, { sourceText, kb }, opts = {}) {
  const { asp_program, notes } = await extractKnowledge(config, { sourceText, kb }, opts);
  opts.onPhase?.('Clingo verifying merge');
  const report = await verifyCandidateKnowledge(clingoRun, kb, asp_program);

  return { asp_program, notes, report };
}
