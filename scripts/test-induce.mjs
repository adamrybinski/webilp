#!/usr/bin/env node
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import clingo from 'clingo-wasm';
import { load, Prolog } from 'trealla';
import { induce } from '../js/induce.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const exName = process.argv[2] ?? 'grandparent-maternal';
const exDir = join(root, 'examples', exName);

const bk = readFileSync(join(exDir, 'bk.pl'), 'utf8');
const biasText = readFileSync(join(exDir, 'bias.pl'), 'utf8');
const exs = readFileSync(join(exDir, 'exs.pl'), 'utf8');
const alanPlain = readFileSync(join(root, 'vendor/popper/alan.pl'), 'utf8');
const alanOld = readFileSync(join(root, 'vendor/popper/alan-old.pl'), 'utf8');

await load;
const run = await clingo.init();
const pl = new Prolog();

const result = await induce({
  bk,
  biasText,
  exs,
  alanPlain,
  alanOld,
  clingoRun: run,
  prolog: pl,
  maxModels: 200,
  browser: true,
  onProgress: (m) => console.log(m),
});

console.log('status:', result.status);
if (result.program) console.log('program:\n' + result.program);
if (result.coverage) console.log('coverage:', result.coverage);
if (result.warnings?.length) console.log('warnings:', result.warnings);

process.exit(result.status === 'solution' ? 0 : 1);
