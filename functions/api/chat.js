/**
 * Cloudflare Workers AI proxy for WebILP (v2).
 * OpenAI-compatible POST /api/chat with per-session request limits (KV).
 */

/** @param {unknown} result */
function extractAiText(result) {
  if (typeof result === 'string') return result;
  if (!result || typeof result !== 'object') return '';
  const r = /** @type {Record<string, unknown>} */ (result);
  if (typeof r.response === 'string') return r.response;
  if (typeof r.text === 'string') return r.text;
  if (typeof r.result === 'string') return r.result;
  const nested = r.result;
  if (nested && typeof nested === 'object' && typeof /** @type {Record<string, unknown>} */ (nested).response === 'string') {
    return /** @type {Record<string, unknown>} */ (nested).response;
  }
  return '';
}

/** @param {unknown} data @param {number} status */
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** @param {string} sessionId */
function isValidSessionId(sessionId) {
  return typeof sessionId === 'string' && /^[a-zA-Z0-9_-]{8,64}$/.test(sessionId);
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const sessionId = request.headers.get('X-WebILP-Session');

  if (!isValidSessionId(sessionId)) {
    return json({ error: { message: 'Missing or invalid X-WebILP-Session header.' } }, 400);
  }

  const limit = parseInt(env.SESSION_REQUEST_LIMIT || '30', 10);
  const key = `sess:${sessionId}`;
  const count = parseInt((await env.SESSION_KV.get(key)) || '0', 10);

  if (count >= limit) {
    return json(
      {
        error: {
          message: `Session limit reached (${limit} LLM requests). Add your own OpenRouter API key in Setup to continue.`,
          code: 'session_limit',
          used: count,
          limit,
        },
      },
      429,
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: { message: 'Invalid JSON body.' } }, 400);
  }

  const messages = Array.isArray(body.messages) ? body.messages : [];
  if (!messages.length) {
    return json({ error: { message: 'messages array is required.' } }, 400);
  }

  const model = env.CF_AI_MODEL || '@cf/meta/llama-3.1-8b-instruct';
  const maxTokens = Math.min(body.max_tokens ?? 4096, 8192);

  try {
    const result = await env.AI.run(model, {
      messages,
      max_tokens: maxTokens,
      temperature: body.temperature ?? 0.2,
    });

    const used = count + 1;
    await env.SESSION_KV.put(key, String(used), { expirationTtl: 86400 });

    const text = extractAiText(result);
    if (!text) {
      return json({ error: { message: 'Workers AI returned empty content.' } }, 502);
    }

    return json({
      id: `webilp-${sessionId}-${used}`,
      object: 'chat.completion',
      model,
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: text },
          finish_reason: 'stop',
        },
      ],
      webilp_session: { used, limit, remaining: Math.max(0, limit - used) },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Workers AI request failed.';
    return json({ error: { message: msg } }, 502);
  }
}
