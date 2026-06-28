# WebILP

Browser-based inductive logic programming using Popper's **Alan** ASP encoding, **Clingo WASM**, and **Trealla Prolog**.

## Quick start

```bash
npm install
npm start
```

Open http://localhost:3000 (or whatever `serve` prints). Use **Load example → grandparent-maternal**, then **Induce**.

## Workflow

1. Paste or **import** Popper layer files: `bk.pl`, `bias.pl`, `exs.pl`
2. Or **import folder** — pick a directory containing those three files
3. **Induce** — Clingo enumerates candidate rules; Trealla tests them on your examples
4. **Build encoding** — preview the full Alan → ASP program sent to Clingo

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
