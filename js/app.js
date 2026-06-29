import { load, Prolog } from './trealla-runtime.js';
import { induce } from './induce.js';
import { buildEncoding } from './encoding.js';
import { parseBias } from './bias.js';
import { readPlFile, importPopperLayer, loadExample, SOURCE_TEXT_EXAMPLES, loadSourceText } from './import.js';
import { validateExamples } from './tester.js';
import {
  LLM_PRESETS,
  loadLlmConfig,
  saveLlmConfig,
  configFromPreset,
} from './llm-settings.js';
import { testLlmConnection } from './llm.js';
import {
  draftPopperLayer,
  learnFromText,
  suggestExamples,
  refineLayer,
} from './assist.js';


const CLINGO_WASM = 'https://cdn.jsdelivr.net/npm/clingo-wasm@0.3.2/dist/clingo.wasm';

const $ = (id) => document.getElementById(id);

const state = {
  clingoReady: false,
  treallaReady: false,
  alanPlain: '',
  alanOld: '',
  lastProgram: '',
  busy: false,
  busyLabel: '',
  busyPhase: '',
  busyKind: 'llm',
};

const BUSY_BUTTON_IDS = [
  'btnDraftLayer',
  'btnExtractBk',
  'btnSuggestExs',
  'btnRefineFeedback',
  'btnValidate',
  'btnInduce',
  'btnEncoding',
  'btnAddToKnowledge',
  'btnClear',
  'btnLlmTest',
  'btnLlmSave',
];

const BUSY_SELECT_IDS = ['exampleSelect', 'sourceTextSelect'];

let busyToken = 0;
let busyTimer = null;
let busyStartedAt = 0;

function setStatus(msg, kind = 'info') {
  const el = $('status');
  el.textContent = msg;
  el.dataset.kind = kind;
  el.dataset.busy = state.busy ? 'true' : 'false';
}

function setBusyPhase(phase) {
  state.busyPhase = phase ?? '';
  updateBusyDisplay();
}

function updateBusyDisplay() {
  if (!state.busy) return;
  const secs = Math.floor((Date.now() - busyStartedAt) / 1000);
  const kindWord = state.busyKind === 'llm' ? 'LLM' : 'Running';
  const phase = state.busyPhase ? ` — ${state.busyPhase}` : '';
  setStatus(`${kindWord}: ${state.busyLabel}${phase} (${secs}s)…`, 'info');
  $('busyLabel').textContent = `${kindWord}: ${state.busyLabel}${phase}`;
  $('busyElapsed').textContent = `${secs}s`;
}

function beginBusy(label, kind = 'llm') {
  const token = ++busyToken;
  state.busy = true;
  state.busyLabel = label;
  state.busyPhase = '';
  state.busyKind = kind;
  busyStartedAt = Date.now();
  document.body.classList.add('is-busy');

  for (const id of BUSY_BUTTON_IDS) {
    const el = $(id);
    if (el) el.disabled = true;
  }
  for (const id of BUSY_SELECT_IDS) {
    const el = $(id);
    if (el) el.disabled = true;
  }

  $('busyIndicator').hidden = false;
  updateBusyDisplay();
  busyTimer = setInterval(updateBusyDisplay, 400);
  return token;
}

function endBusy(token) {
  if (token !== busyToken) return;
  state.busy = false;
  state.busyPhase = '';
  clearInterval(busyTimer);
  busyTimer = null;
  document.body.classList.remove('is-busy');
  $('busyIndicator').hidden = true;

  for (const id of BUSY_BUTTON_IDS) {
    const el = $(id);
    if (!el) continue;
    if (id === 'btnAddToKnowledge') el.disabled = !state.lastProgram;
    else el.disabled = false;
  }
  for (const id of BUSY_SELECT_IDS) {
    const el = $(id);
    if (el) el.disabled = false;
  }
}

async function runWithBusy(label, kind, fn) {
  const token = beginBusy(label, kind);
  try {
    return await fn(setBusyPhase);
  } finally {
    endBusy(token);
  }
}

function applyLayerToEditors(draft) {
  const applied = [];
  if (draft.bk) {
    $('bk').value = draft.bk;
    applied.push('bk');
  }
  if (draft.bias) {
    $('bias').value = draft.bias;
    applied.push('bias');
  }
  if (draft.exs) {
    $('exs').value = draft.exs;
    applied.push('exs');
  }
  return applied;
}

function llmOpts(onPhase) {
  return { onPhase: (msg) => onPhase?.(msg) };
}

function groundEls() {
  return {
    box: $('groundConnector'),
    label: $('groundConnectorLabel'),
    meta: $('groundConnectorMeta'),
    log: $('groundConnectorLog'),
    idle: document.querySelector('#groundConnector .fci-idle'),
    spin: document.querySelector('#groundConnector .fci-spin'),
    ok: document.querySelector('#groundConnector .fci-ok'),
    err: document.querySelector('#groundConnector .fci-err'),
  };
}

function setGroundStatus(status, { label = '', meta = '', logText = '' } = {}) {
  const el = groundEls();
  if (!el.box) return;
  el.box.dataset.status = status;

  if (el.idle) el.idle.hidden = status !== 'idle';
  if (el.spin) el.spin.hidden = status !== 'running';
  if (el.ok) el.ok.hidden = status !== 'ok';
  if (el.err) el.err.hidden = status !== 'error';

  if (el.label && label) el.label.textContent = label;
  if (el.meta && meta) el.meta.textContent = meta;
  if (el.log && typeof logText === 'string') el.log.textContent = logText;
}

async function runGrounding(label, fn) {
  const startedAt = Date.now();
  const lines = [];

  const push = (msg) => {
    const secs = ((Date.now() - startedAt) / 1000).toFixed(1);
    lines.push(`[${secs}s] ${msg}`);
    setGroundStatus('running', {
      label,
      meta: 'running (click to expand)',
      logText: lines.join('\n'),
    });
  };

  setGroundStatus('running', {
    label,
    meta: 'starting… (click to expand)',
    logText: 'Starting…',
  });
  $('groundConnector').open = true;

  try {
    const out = await runWithBusy(label, 'llm', async (onPhase) => {
      const phase = (m) => {
        onPhase(m);
        push(m);
      };
      push('request sent');
      return await fn(phase);
    });

    setGroundStatus('ok', {
      label: `${label} ✓`,
      meta: 'ok (click to expand)',
      logText: lines.join('\n') || 'OK',
    });
    return out;
  } catch (e) {
    lines.push('', `ERROR: ${e.message}`);
    setGroundStatus('error', {
      label: `${label} ✕`,
      meta: 'error (click to expand)',
      logText: lines.join('\n'),
    });
    $('groundConnector').open = true;
    throw e;
  }
}

function setOutput(text) {
  $('output').textContent = text;
}

function getLlmConfigFromForm() {
  const saved = loadLlmConfig();
  const fromForm = {
    presetId: $('llmPreset').value,
    baseUrl: $('llmBaseUrl').value.trim(),
    model: $('llmModel').value.trim(),
    apiKey: $('llmApiKey').value.trim(),
  };
  if (!fromForm.apiKey && saved.apiKey) fromForm.apiKey = saved.apiKey;
  if (!fromForm.baseUrl && saved.baseUrl) fromForm.baseUrl = saved.baseUrl;
  if (!fromForm.model && saved.model) fromForm.model = saved.model;
  return fromForm;
}

function setLlmStatus(msg, kind = '') {
  const el = $('llmSettingsStatus');
  el.textContent = msg;
  el.className = `inline-status ${kind}`;
}

function populateLlmForm(config) {
  const presetSelect = $('llmPreset');
  presetSelect.innerHTML = LLM_PRESETS.map(
    (p) => `<option value="${p.id}">${p.label}</option>`,
  ).join('');
  presetSelect.value = config.presetId || LLM_PRESETS[0].id;
  $('llmBaseUrl').value = config.baseUrl ?? '';
  $('llmModel').value = config.model ?? '';
  $('llmApiKey').value = config.apiKey ?? '';
}

function wireLlmSettings() {
  populateLlmForm(loadLlmConfig());

  $('llmPreset').addEventListener('change', (e) => {
    const patch = configFromPreset(e.target.value);
    if (patch.baseUrl) $('llmBaseUrl').value = patch.baseUrl;
    if (patch.model) $('llmModel').value = patch.model;
  });

  $('btnLlmSave').addEventListener('click', () => {
    const config = getLlmConfigFromForm();
    saveLlmConfig(config);
    setLlmStatus('Saved locally (API key in browser storage only).', 'ok');
  });

  $('btnLlmTest').addEventListener('click', async () => {
    await runWithBusy('Testing LLM connection', 'llm', async (onPhase) => {
      setLlmStatus('Testing…');
      onPhase('waiting for model');
      try {
        const config = getLlmConfigFromForm();
        saveLlmConfig(config);
        const reply = await testLlmConnection(config);
        setLlmStatus(`Connected — model replied: ${reply}`, 'ok');
      } catch (e) {
        setLlmStatus(e.message, 'err');
        throw e;
      }
    });
  });
}

async function runDraftLayer() {
  const description = $('assistSource').value.trim();
  if (!description) {
    setStatus('Enter domain description in LLM assist source text.', 'warn');
    return;
  }

  try {
    await runGrounding('Drafting Popper layer', async (onPhase) => {
      const config = getLlmConfigFromForm();
      const draft = await draftPopperLayer(config, { description }, llmOpts(onPhase));
      const applied = applyLayerToEditors(draft);
      setOutput(
        [
          `Draft layer applied: ${applied.join(', ') || '(none)'}.`,
          draft.notes ? `Notes: ${draft.notes}` : '',
        ]
          .filter(Boolean)
          .join('\n'),
      );
      setStatus(`Layer drafted (${applied.join(', ')}) — review, then induce.`, 'ok');
    });
  } catch (e) {
    setStatus(e.message, 'error');
    setOutput(String(e.stack ?? e));
  }
}

async function runExtractBk() {
  const sourceText = $('assistSource').value.trim();
  if (!sourceText) {
    setStatus('Paste source text for knowledge extraction.', 'warn');
    return;
  }
  if (!state.clingoReady) {
    setStatus('Clingo not ready yet.', 'warn');
    return;
  }

  try {
    await runGrounding('Extracting facts', async (onPhase) => {
      const config = getLlmConfigFromForm();
      const kb = $('bk').value;
      onPhase('LLM proposing facts');
      const { asp_program, notes, report } = await learnFromText(
        clingoRun,
        config,
        { sourceText, kb },
        llmOpts(onPhase),
      );

      const lines = [
        `Verification: ${report.status}`,
        report.reason,
        '',
        'Candidate fragment:',
        asp_program,
      ];
      if (notes) lines.push('', `Notes: ${notes}`);

      if (report.status === 'verified') {
        const merged = report.mergedProgram ?? `${kb}\n\n${asp_program}`;
        $('bk').value = merged.trim() + '\n';
        lines.push('', '✓ Merged into bk.pl');
        setStatus('Knowledge verified and merged into bk.', 'ok');
      } else if (report.status === 'rejected') {
        setStatus('Candidate rejected (contradiction). Revise source or bk.', 'warn');
      } else {
        setStatus(report.reason ?? 'Verification failed', 'error');
      }
      setOutput(lines.join('\n'));
    });
  } catch (e) {
    setStatus(e.message, 'error');
    setOutput(String(e.stack ?? e));
  }
}

function setLastProgram(program) {
  state.lastProgram = program?.trim() ?? '';
  $('btnAddToKnowledge').disabled = !state.lastProgram;
}

async function runRefineFeedback() {
  const feedback = $('humanFeedback').value.trim();
  if (!feedback) {
    setStatus('Enter feedback in step 3 before refining.', 'warn');
    return;
  }
  const { bk, bias, exs } = getFields();
  if (!bk.trim() && !bias.trim() && !exs.trim()) {
    setStatus('Need at least one editor filled before refining.', 'warn');
    return;
  }

  try {
    await runWithBusy('Refining from feedback', 'llm', async (onPhase) => {
      const config = getLlmConfigFromForm();
      const draft = await refineLayer(
        config,
        {
          sourceText: $('assistSource').value.trim(),
          bk,
          bias,
          exs,
          feedback,
        },
        llmOpts(onPhase),
      );
      const applied = applyLayerToEditors(draft);
      setOutput(
        [
          `Refined (${applied.join(', ')}).`,
          draft.notes ? `Notes: ${draft.notes}` : '',
        ]
          .filter(Boolean)
          .join('\n'),
      );
      setStatus('Layer refined — review editors, then validate & induce.', 'ok');
    });
  } catch (e) {
    setStatus(e.message, 'error');
    setOutput(String(e.stack ?? e));
  }
}

function runAddToKnowledge() {
  if (!state.lastProgram) {
    setStatus('No learned rule yet — run Induce first.', 'warn');
    return;
  }
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const block = `\n% learned ${stamp}\n${state.lastProgram}\n`;
  const bk = $('bk').value.trim();
  $('bk').value = (bk ? `${bk}\n` : '') + block;
  setOutput(`${$('output').textContent}\n\n✓ Pinned to bk.pl:\n${state.lastProgram}`);
  setStatus('Learned rule added to bk — you can induce again or extract more facts.', 'ok');
}

async function runSuggestExs() {
  const description = $('assistSource').value.trim();
  const { bk, bias, exs } = getFields();
  if (!bias.trim()) {
    setStatus('Need bias.pl before suggesting examples.', 'warn');
    return;
  }

  try {
    await runWithBusy('Suggesting examples', 'llm', async (onPhase) => {
      const config = getLlmConfigFromForm();
      const { exs_append, notes } = await suggestExamples(
        config,
        {
          description: description || 'extend coverage for head predicate',
          bk,
          bias,
          exs,
        },
        llmOpts(onPhase),
      );
      if (exs_append) {
        $('exs').value = `${exs.trim()}\n${exs_append}`.trim() + '\n';
      }
      const lineCount = exs_append.split('\n').filter((l) => l.trim()).length;
      setOutput(
        [`Appended ${lineCount} example line(s) to exs.pl:`, exs_append, notes]
          .filter(Boolean)
          .join('\n\n'),
      );
      setStatus(`Added ${lineCount} example(s) — validate then induce.`, 'ok');
    });
  } catch (e) {
    setStatus(e.message, 'error');
    setOutput(String(e.stack ?? e));
  }
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

  setStatus('Ready — paste source text or load an example, then follow the flow.', 'ok');
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
  try {
    await runWithBusy('Validating examples', 'symbolic', async (onPhase) => {
      onPhase('loading Trealla');
      await load;
      const pl = new Prolog();
      onPhase('checking pos/neg');
      const stats = await validateExamples(pl, { bk, exs });
      setStatus(`Examples: ${stats.positives} pos, ${stats.negatives} neg`, 'ok');
    });
  } catch (e) {
    setStatus(e.message, 'error');
  }
}

async function runPreviewEncoding() {
  const { bias } = getFields();
  if (!bias.trim()) {
    setStatus('Need bias.pl to build encoding.', 'warn');
    return;
  }
  try {
    await runWithBusy('Building encoding', 'symbolic', async () => {
      const parsed = parseBias(bias);
      const enc = buildEncoding({ alan: state.alanPlain, biasText: bias, bias: parsed });
      $('encoding').value = enc;
      setStatus(`Alan encoding built (${enc.length} chars).`, 'ok');
    });
  } catch (e) {
    setStatus(e.message, 'error');
  }
}

async function runInduce() {
  if (state.busy) return;
  const { bk, bias, exs, maxModels } = getFields();
  if (!bk.trim() || !bias.trim() || !exs.trim()) {
    setStatus('Fill in bk, bias, and exs (or import a Popper layer).', 'warn');
    return;
  }

  setOutput('');

  try {
    await runWithBusy('Inducing rule', 'symbolic', async (onPhase) => {
      onPhase('loading Trealla');
      await load;
      const pl = new Prolog();
      onPhase('Clingo search + Trealla test');
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
        onProgress: (m) => onPhase(m),
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
        setLastProgram(result.program);
      } else {
        setLastProgram('');
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
    });
  } catch (e) {
    setStatus(e.message, 'error');
    setOutput(String(e.stack ?? e));
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

async function loadSourceTextByName(id) {
  try {
    $('assistSource').value = await loadSourceText(id);
    setStatus(`Loaded source text: ${id}`, 'ok');
  } catch (e) {
    setStatus(`Failed to load source text: ${e.message}`, 'error');
  }
}

function populateSourceTextSelect() {
  const sel = $('sourceTextSelect');
  for (const ex of SOURCE_TEXT_EXAMPLES) {
    const opt = document.createElement('option');
    opt.value = ex.id;
    opt.textContent = ex.label;
    sel.appendChild(opt);
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
  wireLlmSettings();
  populateSourceTextSelect();
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
  $('btnDraftLayer').addEventListener('click', () => runDraftLayer());
  $('btnExtractBk').addEventListener('click', () => runExtractBk());
  $('btnSuggestExs').addEventListener('click', () => runSuggestExs());
  $('btnRefineFeedback').addEventListener('click', () => runRefineFeedback());
  $('btnAddToKnowledge').addEventListener('click', () => runAddToKnowledge());
  $('btnClear').addEventListener('click', () => {
    $('bk').value = '';
    $('bias').value = '';
    $('exs').value = '';
    $('encoding').value = '';
    $('humanFeedback').value = '';
    setOutput('');
    setLastProgram('');
    setStatus('Cleared.');
  });

  $('exampleSelect').addEventListener('change', (e) => {
    const v = e.target.value;
    if (v) loadExampleByName(v);
    e.target.value = '';
  });

  $('sourceTextSelect').addEventListener('change', (e) => {
    const v = e.target.value;
    if (v) loadSourceTextByName(v);
    e.target.value = '';
  });
}

wireUI();
initRuntimes().catch((e) => setStatus(`Init failed: ${e.message}`, 'error'));
