# WebILP

Browser-based inductive logic programming using Popper's **Alan** ASP encoding, **Clingo WASM**, and **Trealla Prolog**.

## Branches

| Branch | LLM default | Notes |
|--------|-------------|-------|
| `v1` / `master` | OpenRouter (BYOK) | Static Pages only; API key required |
| `v2` | Cloudflare Workers AI | `/api/chat` proxy, session limit; OpenRouter optional |

## Quick start (v2 — Cloudflare AI)

```bash
npm install
npm run dev
```

Open the URL `wrangler pages dev` prints (usually http://localhost:8788). **No API key** needed — uses Workers AI via `/api/chat` with a per-browser session limit (30 requests/session by default).

For static-only local preview (no LLM unless you add a key):

```bash
npm start
```

## Deploy (Cloudflare Pages + Workers AI)

```bash
npm run deploy
```

- **Production URL**: https://webilp.pages.dev
- **Custom domain**: https://app.livelogic.dev

`wrangler.toml` binds **Workers AI** and a **KV** namespace for session limits. Pages Functions live in `functions/api/`.

### Custom domain `app.livelogic.dev`

`livelogic.dev` is on Cloudflare. Custom domain is registered on the **webilp** Pages project.

If status is `pending` / “CNAME record not set”, add in **DNS** for `livelogic.dev`:

| Type  | Name | Content           | Proxy |
|-------|------|-------------------|-------|
| CNAME | app  | `webilp.pages.dev` | ON    |

Then in **Workers & Pages → webilp → Custom domains**, confirm `app.livelogic.dev` is active.

## Workflow

1. Paste or **import** Popper layer files: `bk.pl`, `bias.pl`, `exs.pl`
2. Or **import folder** — pick a directory containing those three files
3. **Induce** — Clingo enumerates candidate rules; Trealla tests them on your examples
4. **Build encoding** — preview the full Alan → ASP program sent to Clingo

## LLM assist (LiveKnowledge browser path)

Configure **LLM settings** at the top of the page:

| Preset | Key required | Endpoint |
|--------|--------------|----------|
| Cloudflare AI (default, v2) | no | `/api/chat` (Workers AI, session limit) |
| OpenRouter free router | yes | `openrouter.ai/api/v1` → `openrouter/free` |
| OpenRouter Gemma free | yes | same → `google/gemma-2-9b-it:free` |
| OpenAI | yes | `api.openai.com/v1` |
| Custom | yes | your gateway |

**v2 default:** Cloudflare Workers AI (`@cf/meta/llama-3.1-8b-instruct-fast`) via a Pages Function. Each browser session gets **30 LLM requests** (configurable in `wrangler.toml` as `SESSION_REQUEST_LIMIT`). After that, add your own OpenRouter key or wait for the session to expire (24h).

**BYOK (v1 style):** OpenRouter/OpenAI keys stay in **localStorage** and go directly to that provider from the browser.

### Assist actions

Source text examples (dropdown in **LLM assist**): `kinship-maternal`, `kinship-royal`, `craft-economy` under `examples/source-texts/`.

1. **Draft Popper layer** — LLM fills `bk.pl`, `bias.pl`, `exs.pl` from a domain description → **Induce**
2. **Extract facts → bk** — LiveKnowledge-style: LLM proposes ASP, Clingo WASM verifies `bk ⊕ candidate` is satisfiable, then merges into bk
3. **Suggest more examples** — LLM appends `pos`/`neg` to `exs.pl`

This mirrors LiveKnowledge v2.1 (`generate_knowledge` + `verify_candidate_knowledge`) in the browser, then adds Popper induction on top.

## Browser limits

| Feature | In browser | Full Popper CLI |
|---------|------------|-----------------|
| Single-clause rules (`alan.pl`) | yes | yes |
| `max_clauses > 1`, `enable_pi`, `enable_recursion` | no (WASM uses `alan.pl` only) | yes (`alan-old.pl`) |
| Learning from failures / nogoods | no (enumerate + test) | yes |

For marbles-style layers with PI or recursion, run `helpers/induce.sh` in the target repo.

## Layout

```
vendor/popper/   alan.pl, alan-old.pl, test.pl (from Popper)
js/              bias parser, encoding builder, induction loop
examples/        sample Popper layers
```

## Test

```bash
npm run test:induce
```

Uses the `grandparent-maternal` example (expects a perfect single-clause solution).
