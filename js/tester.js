import { formatProgram } from './model.js';
import { Prolog } from './trealla-runtime.js';

/** @param {string} text */
export function parseExamples(text) {
  const pos = [];
  const neg = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('%')) continue;
    const pm = trimmed.match(/^pos\((.+)\)\s*\./);
    const nm = trimmed.match(/^neg\((.+)\)\s*\./);
    if (pm) pos.push(pm[1].trim());
    if (nm) neg.push(nm[1].trim());
  }
  return { pos, neg };
}

/**
 * @param {import('./trealla-runtime.js').Prolog} _pl
 * @param {{ bk: string, exs: string, prog: import('./model.js').Program }} opts
 */
export async function testProgram(_pl, { bk, exs, prog }) {
  const pl = new Prolog();
  const rules = formatProgram(prog);
  const { pos, neg } = parseExamples(exs);

  await pl.consultText(`${bk}\n${rules}`);

  let tp = 0;
  let fn = 0;
  let fp = 0;

  for (const atom of pos) {
    const r = await pl.queryOnce(atom);
    if (r?.status === 'success') tp++;
    else fn++;
  }

  for (const atom of neg) {
    const r = await pl.queryOnce(atom);
    if (r?.status === 'success') fp++;
  }

  const tn = neg.length - fp;

  return {
    tp,
    fn,
    tn,
    fp,
    inconsistent: fp > 0,
    totalPos: pos.length,
    totalNeg: neg.length,
  };
}

/**
 * @param {import('./trealla-runtime.js').Prolog} pl
 */
export async function validateExamples(pl, { bk, exs }) {
  const { pos, neg } = parseExamples(exs);
  await pl.consultText(bk);
  return { positives: pos.length, negatives: neg.length };
}
