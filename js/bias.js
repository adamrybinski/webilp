/** @typedef {{ predicate: string, arity: number, args: number[] }} Literal */
/** @typedef {{ headPred: string, headArity: number, maxVars: number, maxBody: number, maxClauses: number, enableRecursion: boolean, enablePi: boolean, nonDatalog: boolean, bodyPreds: {predicate:string,arity:number}[], types: Record<string,string[]>, directions: Record<string,('in'|'out')[]> }} Bias */

const MAX_VARS_RE = /max_vars\(\s*(\d+)\s*\)/;
const MAX_BODY_RE = /max_body\(\s*(\d+)\s*\)/;
const MAX_CLAUSES_RE = /max_clauses\(\s*(\d+)\s*\)/;
const HEAD_PRED_RE = /head_pred\(\s*(\w+)\s*,\s*(\d+)\s*\)/g;
const BODY_PRED_RE = /body_pred\(\s*(\w+)\s*,\s*(\d+)\s*\)/g;
const TYPE_RE = /type\(\s*(\w+)\s*,\s*\(([^)]*)\)\s*\)/g;
const DIRECTION_RE = /direction\(\s*(\w+)\s*,\s*\(([^)]*)\)\s*\)/g;

/**
 * Parse Popper bias.pl text into structured settings.
 * @param {string} text
 * @returns {Bias}
 */
export function parseBias(text) {
  const maxVars = Number(text.match(MAX_VARS_RE)?.[1] ?? 6);
  const maxBody = Number(text.match(MAX_BODY_RE)?.[1] ?? 10);
  const maxClauses = Number(text.match(MAX_CLAUSES_RE)?.[1] ?? 1);
  const enableRecursion = /\benable_recursion\b/.test(text);
  const enablePi = /\benable_pi\b/.test(text);
  const nonDatalog = /\bnon_datalog\b/.test(text);

  let headPred = '';
  let headArity = 0;
  for (const m of text.matchAll(HEAD_PRED_RE)) {
    headPred = m[1];
    headArity = Number(m[2]);
  }
  if (!headPred) throw new Error('bias.pl must declare head_pred(Name, Arity).');

  const bodyPreds = [];
  for (const m of text.matchAll(BODY_PRED_RE)) {
    bodyPreds.push({ predicate: m[1], arity: Number(m[2]) });
  }

  const types = {};
  for (const m of text.matchAll(TYPE_RE)) {
    types[m[1]] = m[2].split(',').map((s) => s.trim()).filter(Boolean);
  }

  const directions = {};
  for (const m of text.matchAll(DIRECTION_RE)) {
    directions[m[1]] = m[2].split(',').map((s) => s.trim()).filter(Boolean);
  }

  return {
    headPred,
    headArity,
    maxVars,
    maxBody,
    maxClauses,
    enableRecursion,
    enablePi,
    nonDatalog,
    bodyPreds,
    types,
    directions,
  };
}

/**
 * Strip Popper max_* facts and ASP constraints from bias (re-added by encoder).
 * @param {string} text
 */
export function stripBiasLimits(text) {
  return text
    .replace(/max_(?:vars|body|clauses)\(\s*\d+\s*\)\./g, '')
    .replace(/:-[\s\S]*?\./g, (block) => (block.includes('clause(') ? '' : block));
}

/**
 * Choose Alan encoding variant.
 * Browser Clingo WASM reliably supports alan.pl only; alan-old can crash the WASM runner.
 * @param {Bias} bias
 * @param {{ browser?: boolean }} [opts]
 */
export function alanVariantFor(bias, opts = {}) {
  if (opts.browser) return 'plain';
  if (bias.enableRecursion || bias.enablePi || bias.maxClauses > 1) return 'old';
  return 'plain';
}
