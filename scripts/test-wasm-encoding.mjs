import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import clingo from 'clingo-wasm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const encoding = readFileSync(join(root, 'scripts/debug-encoding.lp'), 'utf8');
const run = await clingo.init();

for (const opts of [
  [],
  ['-Wnone'],
  ['--heuristic=Domain', '-Wnone'],
]) {
  try {
    const r = run(encoding, 3, opts);
    console.log('opts', opts, '->', r.Result, r.Error || '', 'models', r.Call?.[0]?.Witnesses?.length);
  } catch (e) {
    console.log('opts', opts, 'throw', e.message);
  }
}
