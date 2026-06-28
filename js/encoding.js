import { stripBiasLimits } from './bias.js';

/** @param {number} n @param {number} r */
function permutations(n, r) {
  const out = [];
  const used = new Array(n).fill(false);
  const cur = [];
  function dfs() {
    if (cur.length === r) {
      out.push([...cur]);
      return;
    }
    for (let i = 0; i < n; i++) {
      if (used[i]) continue;
      used[i] = true;
      cur.push(i);
      dfs();
      cur.pop();
      used[i] = false;
    }
  }
  dfs();
  return out;
}

/** @param {number[]} xs @param {boolean} [asAtoms] */
function tuple(xs, asAtoms = false) {
  const inner = xs.map((x) => (asAtoms ? x : x)).join(',');
  return `(${inner})`;
}

/**
 * @param {import('./bias.js').Bias} bias
 */
function buildSymmetryBreaking(bias) {
  const lines = [];
  const headArity = bias.headArity;
  const arities = new Set(bias.bodyPreds.map((p) => p.arity));
  arities.add(headArity);
  const maxArity = Math.max(...arities, headArity);

  lines.push(`head_vars(${headArity}, ${tuple(Array.from({ length: headArity }, (_, i) => i))}).`);

  for (const arity of arities) {
    for (const xs of permutations(bias.maxVars, arity)) {
      lines.push(`vars(${arity}, ${tuple(xs)}).`);
      xs.forEach((x, i) => lines.push(`var_pos(${x}, ${tuple(xs)}, ${i}).`));
      lines.push(`ordered_vars(${tuple(xs)},${tuple([...xs].sort((a, b) => a - b))}).`);
    }
  }

  lines.push(...buildOrderingConstraints(maxArity, bias.maxVars));

  if (bias.types[bias.headPred]) {
    const headTypes = bias.types[bias.headPred];
    headTypes.forEach((t, i) => {
      lines.push(`type_pos(${tuple(headTypes, true)}, ${i}, ${t}).`);
    });
    for (const [pred, predTypes] of Object.entries(bias.types)) {
      if (pred === bias.headPred) continue;
      predTypes.forEach((t, i) => {
        lines.push(`type_pos(${tuple(predTypes, true)}, ${i}, ${t}).`);
      });
    }
  }

  for (const [pred, dirs] of Object.entries(bias.directions)) {
    dirs.forEach((d, i) => {
      if (d === 'in' || d === 'out') {
        lines.push(`direction_(${pred}, ${i}, ${d}).`);
      }
    });
  }

  return lines;
}

function buildOrderingConstraints(maxArity, maxVars) {
  const order = [];
  const xs1 = Array.from({ length: maxArity }, (_, i) => `V${i}`).join(',');

  for (let arity = 2; arity <= maxArity; arity++) {
    const xs2 = Array.from({ length: arity }, (_, i) => `X${i}`).join(',');
    const prefix =
      arity < maxArity
        ? `${Array.from({ length: maxArity - arity }, () => '0').join(',')},${xs1}`
        : xs1;
    order.push(
      `appears((${prefix})):- body_literal(_,_,_,(${xs2})), ordered_vars((${xs2}), (${xs1})).`,
    );
    order.push(
      `var_tuple((${prefix})):- body_pred(P,${arity}), vars(${arity},Vars), not bad_body(P,Vars), not type_mismatch(P,Vars), ordered_vars(Vars,OrderedVars), OrderedVars=(${xs1}).`,
    );
    order.push(`var_member(V,(${prefix})):-vars(_, Vars), Vars=(${xs1}), var_member(V,Vars).`);
  }

  for (let k = 0; k < maxArity; k++) {
    const xs2parts = [];
    for (let i = 0; i < maxArity; i++) {
      xs2parts.push(i < k ? `V${i}` : `X${i}`);
    }
    const xs2 = xs2parts.join(',');
    order.push(
      `lower((${xs1}),(${xs2})):- var_tuple((${xs1})), var_tuple((${xs2})), X${k} < V${k}.`,
    );
  }

  for (let k = 0; k < maxArity - 1; k++) {
    const v0 = `V${k}`;
    const v1 = `V${k + 1}`;
    order.push(
      `seen_lower(Vars1, V):- V=${v1}-1, Vars1 = (${xs1}), ${v0} < V < ${v1}, lower(Vars1, Vars2), var_tuple(Vars1), appears(Vars2), var_member(V, Vars2), not head_var(_,V).`,
    );
    order.push(`gap_((${xs1}),${v1}-1):- var_tuple((${xs1})), ${v0} < V < ${v1}, var(V).`);
  }

  order.push(`gap((${xs1}),V):- gap_((${xs1}), _), #max{X :gap_((${xs1}), X)} == V.`);
  order.push(`:- appears((${xs1})), gap((${xs1}), V), not seen_lower((${xs1}),V), not head_var(_,V).`);

  return order;
}

/**
 * Build full Clingo encoding (Alan + bias + symmetry breaking).
 * @param {{ alan: string, biasText: string, bias: import('./bias.js').Bias, alanVariant?: 'plain'|'old' }} opts
 */
export function buildEncoding({ alan, biasText, bias }) {
  const cleaned = stripBiasLimits(biasText);
  const parts = [alan, cleaned];
  const maxClauses = bias.enableRecursion || bias.enablePi ? bias.maxClauses : 1;
  parts.push(`max_clauses(${maxClauses}).`);
  parts.push(`max_body(${bias.maxBody}).`);
  parts.push(`max_vars(${bias.maxVars}).`);
  parts.push(...buildSymmetryBreaking(bias));
  parts.push('#heuristic size(N). [1000-N,true]');
  return parts.join('\n');
}

export function buildAspPreview(bk, biasText) {
  return `${bk.trim()}\n\n${biasText.trim()}`;
}
