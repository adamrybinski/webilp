/**
 * GET /api/usage — session quota for Cloudflare AI (no auth).
 */

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

export async function onRequestGet(context) {
  const { request, env } = context;
  const sessionId = request.headers.get('X-WebILP-Session');

  if (!isValidSessionId(sessionId)) {
    return json({ error: { message: 'Missing or invalid X-WebILP-Session header.' } }, 400);
  }

  const limit = parseInt(env.SESSION_REQUEST_LIMIT || '30', 10);
  const key = `sess:${sessionId}`;
  const used = parseInt((await env.SESSION_KV.get(key)) || '0', 10);

  return json({
    used,
    limit,
    remaining: Math.max(0, limit - used),
  });
}
