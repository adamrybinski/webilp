#!/usr/bin/env node
import { cpSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

mkdirSync(join(root, 'vendor/clingo-wasm'), { recursive: true });
mkdirSync(join(root, 'vendor/trealla'), { recursive: true });

for (const file of ['clingo.web.js', 'clingo.wasm', 'clingo.web.worker.js']) {
  cpSync(
    join(root, 'node_modules/clingo-wasm/dist', file),
    join(root, 'vendor/clingo-wasm', file),
  );
}

cpSync(
  join(root, 'node_modules/trealla/dist/trealla.js'),
  join(root, 'vendor/trealla/trealla.js'),
);

console.log('Synced vendor/clingo-wasm and vendor/trealla from node_modules');
