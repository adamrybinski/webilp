import clingo from 'clingo-wasm';
const run = await clingo.init();
const r = run('a. #show a/0.', 1);
console.log(JSON.stringify(r, null, 2));
