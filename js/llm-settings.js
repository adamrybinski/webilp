/** @typedef {{ id: string, label: string, baseUrl: string, model: string, helpUrl?: string, requiresKey?: boolean }} LlmPreset */

export const LLM_PRESETS = /** @type {LlmPreset[]} */ ([
  {
    id: 'cloudflare_ai',
    label: 'Cloudflare AI (default, no key)',
    baseUrl: '/api',
    model: '@cf/meta/llama-3.1-8b-instruct',
    requiresKey: false,
  },
  {
    id: 'openrouter_free',
    label: 'OpenRouter — free router (your key)',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'openrouter/free',
    helpUrl: 'https://openrouter.ai/keys',
    requiresKey: true,
  },
  {
    id: 'openrouter_gemma',
    label: 'OpenRouter — Gemma 2 9B (your key)',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'google/gemma-2-9b-it:free',
    helpUrl: 'https://openrouter.ai/keys',
    requiresKey: true,
  },
  {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    helpUrl: 'https://platform.openai.com/api-keys',
    requiresKey: true,
  },
  {
    id: 'custom',
    label: 'Custom (OpenAI-compatible)',
    baseUrl: '',
    model: '',
    requiresKey: true,
  },
]);

const STORAGE_KEY = 'webilp_llm_config';
const CONFIG_VERSION = 3;

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

/** @param {LlmConfig} config */
export function usesCloudflareAi(config) {
  return config.presetId === 'cloudflare_ai' || config.baseUrl?.replace(/\/$/, '') === '/api';
}

/** @param {LlmConfig} config */
export function requiresApiKey(config) {
  if (usesCloudflareAi(config)) return false;
  const preset = presetById(config.presetId);
  return preset?.requiresKey !== false;
}

/** @returns {LlmConfig} */
export function loadLlmConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultConfig();
    const parsed = JSON.parse(raw);
    const config = { ...defaultConfig(), ...parsed };

    if ((config.configVersion ?? 1) < CONFIG_VERSION) {
      // v2 default: Cloudflare AI unless user already saved a BYOK key.
      if (!config.apiKey?.trim()) {
        const cf = presetById('cloudflare_ai');
        if (cf) {
          config.presetId = cf.id;
          config.baseUrl = cf.baseUrl;
          config.model = cf.model;
        }
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
  if (!usesCloudflareAi(config)) {
    if (!config.baseUrl?.trim()) throw new Error('Base URL is required.');
    if (!config.model?.trim()) throw new Error('Model name is required.');
  }
  if (requiresApiKey(config) && !config.apiKey?.trim()) {
    throw new Error(
      'API key is required for this preset. Get one at openrouter.ai/keys, or switch to Cloudflare AI (no key).',
    );
  }
}
