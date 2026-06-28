import { load, Prolog } from './trealla-runtime.js';
import { induce } from './induce.js';
import { buildEncoding } from './encoding.js';
import { parseBias } from './bias.js';
import { readPlFile, importPopperLayer, loadExample } from './import.js';
import { validateExamples } from './tester.js';

const CLINGO_JS = 'https://cdn.jsdelivr.net/npm/clingo-wasm@0.3.2/dist/clingo.web.js';
const CLINGO_WASM = 'https://cdn.jsdelivr.net/npm/clingo-wasm@0.3.2/dist/clingo.wasm';

const $ = (id) => document.getElementById(id);

const state = {
  clingoReady: false,
  treallaReady: false,
  alanPlain: '',
  alanOld: '',
  running: false,
};

function setStatus(msg, kind = 'info') {
  const el = $('status');
  el.textContent = msg;
  el.dataset.kind = kind;
}

function setOutput(text) {
  $('output').textContent = text;
}

function getFields() {
  return {
    bk: $('bk').value,
    bias: $('bias').value,
    exs: $('exs').value,
    maxModels: Number($('maxModels').value) || 200,
  };
}

function bindFileInput(inputId, textareaId) {
  $(inputId).addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    $(textareaId).value = await readPlFile(file);
    e.target.value = '';
  });
}

async function initRuntimes() {
  setStatus('Loading Clingo WASM…');
  await clingo.init(CLINGO_WASM);
  state.clingoReady = true;

  setStatus('Loading Trealla Prolog…');
  await load;
  state.treallaReady = true;

  const [alanPlain, alanOld] = await Promise.all([
    fetch('vendor/popper/alan.pl').then((r) => r.text()),
    fetch('vendor/popper/alan-old.pl').then((r) => r.text()),
  ]);
  state.alanPlain = alanPlain;
  state.alanOld = alanOld;

  setStatus('Ready — load or edit bk / bias / exs, then Induce.', 'ok');
  await loadExampleByName('grandparent-maternal');
}

async function clingoRun(program, models, options = []) {
  if (!state.clingoReady) throw new Error('Clingo not loaded');
  return clingo.run(program, models, options);
}

async function runValidate() {
  const { bk, exs } = getFields();
  if (!bk.trim() || !exs.trim()) {
    setStatus('Need bk.pl and exs.pl content to validate.', 'warn');
    return;
  }
  await load;
  const pl = new Prolog();
  const stats = await validateExamples(pl, { bk, exs });
  setStatus(`Examples: ${stats.positives} pos, ${stats.negatives} neg`, 'ok');
}

async function runPreviewEncoding() {
  const { bk, bias } = getFields();
  if (!bias.trim()) {
    setStatus('Need bias.pl to build encoding.', 'warn');
    return;
  }
  try {
    const parsed = parseBias(bias);
    const alan = state.alanPlain;
    const enc = buildEncoding({ alan, biasText: bias, bias: parsed });
    $('encoding').value = enc;
    setStatus(`Alan encoding built (${enc.length} chars).`, 'ok');
  } catch (e) {
    setStatus(e.message, 'error');
  }
}

async function runInduce() {
  if (state.running) return;
  const { bk, bias, exs, maxModels } = getFields();
  if (!bk.trim() || !bias.trim() || !exs.trim()) {
    setStatus('Fill in bk, bias, and exs (or import a Popper layer).', 'warn');
    return;
  }

  state.running = true;
  $('btnInduce').disabled = true;
  setStatus('Inducing…');
  setOutput('');

  try {
    await load;
    const pl = new Prolog();
    const result = await induce({
      bk,
      biasText: bias,
      exs,
      alanPlain: state.alanPlain,
      alanOld: state.alanOld,
      clingoRun,
      prolog: pl,
      maxModels,
      browser: true,
      onProgress: (m) => setStatus(m),
    });

    if (result.encoding) $('encoding').value = result.encoding;

    const lines = [];
    if (result.warnings?.length) {
      lines.push('Warnings:', ...result.warnings.map((w) => `  • ${w}`), '');
    }
    lines.push(`Status: ${result.status}`);
    if (result.message) lines.push(result.message);
    if (result.program) {
      lines.push('', 'Program:', result.program);
    }
    if (result.coverage) {
      const c = result.coverage;
      lines.push(
        '',
        `Coverage: TP=${c.tp} FN=${c.fn} TN=${c.tn} FP=${c.fp} (${result.modelsTested} candidates tested)`,
        `Precision: ${c.tp + c.fp ? (c.tp / (c.tp + c.fp)).toFixed(2) : '—'}  Recall: ${c.totalPos ? (c.tp / c.totalPos).toFixed(2) : '—'}`,
      );
    }
    setOutput(lines.join('\n'));

    if (result.status === 'solution') {
      setStatus('Solution found.', 'ok');
    } else if (result.status === 'no_solution') {
      setStatus('No perfect solution in search budget.', 'warn');
    } else {
      setStatus(result.message ?? 'Error', 'error');
    }
  } catch (e) {
    setStatus(e.message, 'error');
    setOutput(String(e.stack ?? e));
  } finally {
    state.running = false;
    $('btnInduce').disabled = false;
  }
}

async function importLayer(files) {
  try {
    const { bk, bias, exs } = await importPopperLayer(files);
    if (bk) $('bk').value = bk;
    if (bias) $('bias').value = bias;
    if (exs) $('exs').value = exs;
    setStatus('Imported Popper layer files.', 'ok');
  } catch (e) {
    setStatus(e.message, 'error');
  }
}

async function loadExampleByName(name) {
  try {
    const { bk, bias, exs } = await loadExample(name);
    $('bk').value = bk;
    $('bias').value = bias;
    $('exs').value = exs;
    setStatus(`Loaded example: ${name}`, 'ok');
  } catch (e) {
    setStatus(`Failed to load example ${name}: ${e.message}`, 'error');
  }
}

function wireUI() {
  bindFileInput('importBk', 'bk');
  bindFileInput('importBias', 'bias');
  bindFileInput('importExs', 'exs');

  $('importLayer').addEventListener('change', async (e) => {
    const files = e.target.files;
    if (files?.length) await importLayer(files);
    e.target.value = '';
  });

  $('btnValidate').addEventListener('click', () => runValidate());
  $('btnEncoding').addEventListener('click', () => runPreviewEncoding());
  $('btnInduce').addEventListener('click', () => runInduce());
  $('btnClear').addEventListener('click', () => {
    $('bk').value = '';
    $('bias').value = '';
    $('exs').value = '';
    $('encoding').value = '';
    setOutput('');
    setStatus('Cleared.');
  });

  $('exampleSelect').addEventListener('change', (e) => {
    const v = e.target.value;
    if (v) loadExampleByName(v);
    e.target.value = '';
  });
}

wireUI();
initRuntimes().catch((e) => setStatus(`Init failed: ${e.message}`, 'error'));
