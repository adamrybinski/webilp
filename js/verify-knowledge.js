/**
 * LiveKnowledge-style merged-coherence check (browser Clingo WASM).
 * @param {Function} clingoRun
 * @param {string} kb existing ASP / bk
 * @param {string} candidate additive fragment
 */
export async function verifyCandidateKnowledge(clingoRun, kb, candidate) {
  const cand = candidate.trim();
  const base = kb.trim();

  if (!cand) {
    return { status: 'failed', reason: 'Empty candidate program.' };
  }

  const solo = await clingoRun(cand, 1, ['-Wnone']);
  if (solo.Result === 'ERROR') {
    // Candidate may reference KB predicates — continue to merged check.
  } else if (solo.Result === 'UNSATISFIABLE') {
    return {
      status: 'rejected',
      reason: 'Candidate is self-contradictory (UNSAT alone).',
      detail: solo,
    };
  }

  const merged = `${base}\n\n${cand}\n`;
  const mergedResult = await clingoRun(merged, 1, ['-Wnone']);

  if (mergedResult.Result === 'ERROR') {
    return {
      status: 'failed',
      reason: mergedResult.Error ?? 'Clingo error on merged program.',
      detail: mergedResult,
    };
  }

  if (mergedResult.Result === 'UNSATISFIABLE') {
    return {
      status: 'rejected',
      reason: 'Merged KB + candidate is UNSAT — contradicts existing bk.',
      detail: mergedResult,
    };
  }

  if (mergedResult.Result === 'SATISFIABLE' || mergedResult.Result === 'OPTIMUM FOUND') {
    return {
      status: 'verified',
      reason: 'Merged program is satisfiable.',
      detail: mergedResult,
      mergedProgram: merged,
    };
  }

  return {
    status: 'failed',
    reason: `Unexpected solver result: ${mergedResult.Result}`,
    detail: mergedResult,
  };
}
