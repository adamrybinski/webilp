import { parseBias, alanVariantFor } from './bias.js';
import { buildEncoding } from './encoding.js';
import { modelsToPrograms, formatProgram } from './model.js';
import { testProgram } from './tester.js';

/**
 * @param {Object} opts
 * @param {string} opts.bk
 * @param {string} opts.biasText
 * @param {string} opts.exs
 * @param {string} opts.alanPlain
 * @param {string} opts.alanOld
 * @param {Function} opts.clingoRun
 * @param {import('trealla').Prolog} opts.prolog
 * @param {number} [opts.maxModels]
 * @param {Function} [opts.onProgress]
 * @param {boolean} [opts.browser]
 */
export async function induce(opts) {
  const {
    bk,
    biasText,
    exs,
    alanPlain,
    alanOld,
    clingoRun,
    prolog,
    maxModels = 200,
    onProgress,
    browser = false,
  } = opts;

  let bias;
  try {
    bias = parseBias(biasText);
  } catch (e) {
    return { status: 'error', modelsTested: 0, message: e.message };
  }

  const variant = alanVariantFor(bias, { browser });
  const warnings = [];
  if (browser && (bias.enableRecursion || bias.enablePi || bias.maxClauses > 1)) {
    warnings.push(
      'Browser mode uses single-clause Alan (alan.pl). enable_pi, enable_recursion, and max_clauses>1 require Popper CLI.',
    );
  }
  const alan = variant === 'old' ? alanOld : alanPlain;
  const encoding = buildEncoding({ alan, biasText, bias, alanVariant: variant });

  onProgress?.(`Running Clingo (Alan ${variant}, up to ${maxModels} models)…`);

  const result = await clingoRun(encoding, maxModels, [
    '--heuristic=Domain',
    '-Wnone',
  ]);

  if (result.Result === 'ERROR') {
    return {
      status: 'error',
      modelsTested: 0,
      message: result.Error ?? 'Clingo failed',
      encoding,
    };
  }

  const witnesses = result.Call?.[0]?.Witnesses ?? [];
  onProgress?.(`Testing ${witnesses.length} candidate(s) with Prolog…`);

  let best = null;
  let modelsTested = 0;

  for (const w of witnesses) {
    const progs = modelsToPrograms(w.Value, bias);
    for (const prog of progs) {
      modelsTested++;
      const coverage = await testProgram(prolog, { bk, exs, prog });
      const perfect =
        coverage.fn === 0 &&
        coverage.fp === 0 &&
        coverage.tp === coverage.totalPos;
      if (perfect) {
        return {
          status: 'solution',
          program: formatProgram(prog),
          coverage,
          modelsTested,
          encoding,
          warnings,
        };
      }
      const score = coverage.tp - coverage.fp * 2 - coverage.fn;
      const bestScore = best
        ? best.coverage.tp - best.coverage.fp * 2 - best.coverage.fn
        : -Infinity;
      if (score > bestScore) best = { prog, coverage };
    }
  }

  if (best) {
    return {
      status: 'no_solution',
      program: formatProgram(best.prog),
      coverage: best.coverage,
      modelsTested,
      message: `No perfect hypothesis in ${witnesses.length} model(s). Best partial program shown.`,
      encoding,
      warnings,
    };
  }

  return {
    status: 'no_solution',
    modelsTested,
    message: 'Clingo returned no body_literal models.',
    encoding,
    warnings,
  };
}
