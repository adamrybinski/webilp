/**
 * Load .pl file text from a File input.
 * @param {File} file
 */
export function readPlFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

/**
 * Import a Popper layer directory (bk.pl, bias.pl, exs.pl) via folder picker.
 * @param {FileList|File[]} files
 */
export async function importPopperLayer(files) {
  const map = Object.fromEntries(
    [...files]
      .filter((f) => f.name.endsWith('.pl'))
      .map((f) => [f.name.toLowerCase(), f]),
  );

  const bk = map['bk.pl'] ? await readPlFile(map['bk.pl']) : '';
  const bias = map['bias.pl'] ? await readPlFile(map['bias.pl']) : '';
  const exs = map['exs.pl'] ? await readPlFile(map['exs.pl']) : '';

  if (!bk && !bias && !exs) {
    throw new Error('No bk.pl, bias.pl, or exs.pl found in selection.');
  }

  return { bk, bias, exs };
}

/**
 * Fetch example bundle from examples/ path (same-origin).
 * @param {string} name e.g. 'kinship-pi'
 */
async function fetchPl(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  return r.text();
}

export async function loadExample(name) {
  const base = `examples/${name}`;
  const [bk, bias, exs] = await Promise.all([
    fetchPl(`${base}/bk.pl`),
    fetchPl(`${base}/bias.pl`),
    fetchPl(`${base}/exs.pl`),
  ]);
  return { bk, bias, exs };
}

/** @type {{ id: string, label: string }[]} */
export const SOURCE_TEXT_EXAMPLES = [
  { id: 'kinship-maternal', label: 'Kinship — maternal grandparent' },
  { id: 'kinship-royal', label: 'Kinship — royal family' },
  { id: 'craft-economy', label: 'Craft economy (LiveKnowledge)' },
];

/** @param {string} id stem under examples/source-texts/ */
export async function loadSourceText(id) {
  return fetchPl(`examples/source-texts/${id}.txt`);
}
