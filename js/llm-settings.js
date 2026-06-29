/** @typedef {{ id: string, label: string, baseUrl: string, model: string, helpUrl?: string }} LlmPreset */

export const LLM_PRESETS = /** @type {LlmPreset[]} */ ([
  {
    id: 'openrouter_free',
    label: 'OpenRouter — free router',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'openrouter/free',
    helpUrl: 'https://openrouter.ai/keys',
  },
  {
    id: 'openrouter_gemma',
    label: 'OpenRouter — Gemma 2 9B (free)',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'google/gemma-2-9b-it:free',
    helpUrl: 'https://openrouter.ai/keys',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    helpUrl: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'custom',
    label: 'Custom (OpenAI-compatible)',
    baseUrl: '',
    model: '',
  },
]);

const STORAGE_KEY = 'webilp_llm_config';
const CONFIG_VERSION = 2;

/** @typedef {{ presetId: string, baseUrl: string, model: string, apiKey: string, configVersion?: number }} LlmConfig */

/** @returns {LlmConfig} */
export function defaultConfig() {
  const p = LLM_PRESETS[0];
  return {
    presetId: p.id,
    baseUrl: p.baseUrl,
    model: p.model,
    apiKey: '',
    configVersion: CONFIG_VERSION,
  };
}

/** @returns {LlmConfig} */
export function loadLlmConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultConfig();
    const parsed = JSON.parse(raw);
    const config = { ...defaultConfig(), ...parsed };

    // One-time: old builds defaulted to Gemma; switch to openrouter/free.
    if ((config.configVersion ?? 1) < CONFIG_VERSION) {
      if (config.presetId === 'openrouter_gemma') {
        const free = LLM_PRESETS[0];
        config.presetId = free.id;
        config.baseUrl = free.baseUrl;
        config.model = free.model;
      }
      config.configVersion = CONFIG_VERSION;
      saveLlmConfig(config);
    }

    return config;
  } catch {
    return defaultConfig();
  }
}

/** @param {LlmConfig} config */
export function saveLlmConfig(config) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

/** @param {string} presetId @returns {LlmPreset|undefined} */
export function presetById(presetId) {
  return LLM_PRESETS.find((p) => p.id === presetId);
}

/** @param {string} presetId @returns {Partial<LlmConfig>} */
export function configFromPreset(presetId) {
  const p = presetById(presetId);
  if (!p) return {};
  if (p.id === 'custom') return { presetId };
  return { presetId: p.id, baseUrl: p.baseUrl, model: p.model };
}

/** @param {LlmConfig} config */
export function validateConfig(config) {
  if (!config.baseUrl?.trim()) throw new Error('Base URL is required.');
  if (!config.model?.trim()) throw new Error('Model name is required.');
  if (!config.apiKey?.trim()) {
    throw new Error(
      'API key is required. OpenRouter free models still need a key from openrouter.ai/keys.',
    );
  }
}
