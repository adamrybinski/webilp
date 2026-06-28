/** @typedef {{ predicate: string, arity: number, args: number[] }} Literal */
/** @typedef {{ clause: number, head: Literal, body: Literal[] }[]} Program */

const ATOM_RE = /^(\w+)\((.*)\)$/;

/**
 * @param {string} atom
 */
export function parseAtom(atom) {
  const m = atom.match(ATOM_RE);
  if (!m) return null;
  return { name: m[1], args: splitArgs(m[2]) };
}

/** @param {string} s */
function splitArgs(s) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/**
 * @param {string[]} witnessValues
 * @param {import('./bias.js').Bias} bias
 * @returns {Program[]}
 */
export function modelsToPrograms(witnessValues, bias) {
  const byClause = new Map();
  for (const raw of witnessValues) {
    const atom = parseAtom(raw);
    if (!atom || atom.name !== 'body_literal') continue;
    const clause = Number(atom.args[0]);
    const pred = atom.args[1];
    const arity = Number(atom.args[2]);
    const varTuple = parseVarTuple(atom.args[3]);
    if (!byClause.has(clause)) byClause.set(clause, []);
    byClause.get(clause).push({ predicate: pred, arity, args: varTuple });
  }

  if (byClause.size === 0) return [];

  const clauses = [...byClause.keys()].sort((a, b) => a - b);
  const prog = clauses.map((c) => ({
    clause: c,
    head: {
      predicate: bias.headPred,
      arity: bias.headArity,
      args: Array.from({ length: bias.headArity }, (_, i) => i),
    },
    body: byClause.get(c) ?? [],
  }));

  return [prog];
}

/** @param {string} raw */
function parseVarTuple(raw) {
  const inner = raw.replace(/^\(/, '').replace(/\)$/, '');
  if (!inner) return [];
  return inner.split(',').map((x) => Number(x.trim()));
}

const VAR_NAMES = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** @param {number} i */
export function varName(i) {
  if (i < VAR_NAMES.length) return VAR_NAMES[i];
  return `V${i}`;
}

/** @param {Literal} lit */
function formatLiteral(lit) {
  return `${lit.predicate}(${lit.args.map(varName).join(',')})`;
}

/** @param {Program} prog */
export function formatProgram(prog) {
  return prog
    .map(({ head, body }) => {
      const bodyStr = body.map(formatLiteral).join(', ');
      return `${formatLiteral(head)} :- ${bodyStr}.`;
    })
    .join('\n');
}
