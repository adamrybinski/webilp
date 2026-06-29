# WebILP

Browser-based inductive logic programming using Popper's **Alan** ASP encoding, **Clingo WASM**, and **Trealla Prolog**.

## Quick start

```bash
npm install
npm start
```

Open http://localhost:3000 (or whatever `serve` prints). Use **Load example → grandparent-maternal**, then **Induce**.

## Deploy (Cloudflare Pages)

Static app — no backend. LLM keys stay in the browser; Clingo WASM and Trealla load from CDN.

```bash
# first time only
wrangler pages project create webilp --production-branch main

# deploy
wrangler pages deploy . --project-name webilp --branch main
```

- **Production URL**: https://webilp.pages.dev
- **Custom domain** (once added in Cloudflare): https://app.livelogic.dev

`wrangler.toml` and `.assetsignore` are in the repo root. `node_modules/` is not uploaded.

### Custom domain `app.livelogic.dev`

`livelogic.dev` is on Cloudflare. In the dashboard:

1. **Workers & Pages** → **webilp** → **Custom domains** → add `app.livelogic.dev`
2. Cloudflare will create the DNS record (CNAME to `webilp.pages.dev`) if the zone is on the same account.

Or via API: `POST /accounts/{account_id}/pages/projects/webilp/domains` with body `{"name":"app.livelogic.dev"}`.

## Workflow

1. Paste or **import** Popper layer files: `bk.pl`, `bias.pl`, `exs.pl`
2. Or **import folder** — pick a directory containing those three files
3. **Induce** — Clingo enumerates candidate rules; Trealla tests them on your examples
4. **Build encoding** — preview the full Alan → ASP program sent to Clingo

## LLM assist (LiveKnowledge browser path)

Configure **LLM settings** at the top of the page:

| Preset | Base URL | Model |
|--------|----------|-------|
| OpenRouter free (default) | `https://openrouter.ai/api/v1` | `openrouter/free` |
| OpenRouter Gemma free | same | `google/gemma-2-9b-it:free` |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` |
| Custom | your gateway | your model slug |

**Free models:** OpenRouter’s `openrouter/free` router picks a free model automatically. You still need an API key ([openrouter.ai/keys](https://openrouter.ai/keys)) — inference is free, not keyless. OpenRouter supports browser CORS.

Settings (including API key) are stored in **localStorage** only — never sent anywhere except your chosen API endpoint.

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
