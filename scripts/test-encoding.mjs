import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import clingo from 'clingo-wasm';
import { parseBias } from '../js/bias.js';
import { buildEncoding } from '../js/encoding.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const exDir = join(root, 'examples/kinship-pi');
const biasText = readFileSync(join(exDir, 'bias.pl'), 'utf8');
const alan = readFileSync(join(root, 'vendor/popper/alan-old.pl'), 'utf8');
const bias = parseBias(biasText);
const encoding = buildEncoding({ alan, biasText, bias });
writeFileSync(join(root, 'scripts/debug-encoding.lp'), encoding);

const run = await clingo.init();
const r = run(encoding, 3, ['--heuristic=Domain', '-Wnone']);
console.log('Result:', r.Result);
if (r.Error) console.log('Error:', r.Error);
console.log('Warnings:', r.Warnings?.filter(Boolean).slice(0, 5));
console.log('Models:', r.Call?.[0]?.Witnesses?.length);
if (r.Call?.[0]?.Witnesses?.[0]) {
  console.log('First model sample:', r.Call[0].Witnesses[0].Value.slice(0, 5));
}
