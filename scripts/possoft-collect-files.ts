import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { readDump } from '../src/modules/possoft-import/dump-reader';

const OK = new Set(['jpg', 'jpeg', 'png', 'webp', 'pdf']);

function argument(name: string) {
  const index = process.argv.indexOf(`--${name}`);
  return index > 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const file = argument('file');
  const source = argument('source');
  const dest = argument('dest');
  if (!file || !existsSync(file))
    throw new Error('Pass the posSoft data export: --file /path/to/pos_dsm.sql');
  if (!source || !existsSync(source))
    throw new Error('Pass the full posSoft files folder: --source /path/to/pos-img');
  if (!dest) throw new Error('Pass where to copy the needed files: --dest /path/to/med-files');
  mkdirSync(dest, { recursive: true });

  const dump = await readDump(file, ['customers_med_record']);
  const records = (dump.get('customers_med_record') ?? []).filter((m) => (m.close ?? '').trim() !== '0');
  const names = new Set<string>();
  for (const record of records) {
    for (const raw of (record.med_record_screenshot ?? '').split(',')) {
      const name = raw.trim();
      if (name && OK.has((name.split('.').pop() ?? '').toLowerCase())) names.add(name);
    }
  }

  let copied = 0;
  let missing = 0;
  let bytes = 0;
  for (const name of names) {
    const from = join(source, name);
    if (!existsSync(from)) {
      missing += 1;
      continue;
    }
    copyFileSync(from, join(dest, name));
    bytes += statSync(from).size;
    copied += 1;
  }
  console.log(
    `Needed files: ${names.size} | copied: ${copied} | missing: ${missing} | ${(bytes / 1024 / 1024).toFixed(0)} MB`,
  );
  console.log(`Folder ready: ${dest}`);
}

main().catch((err: unknown) => {
  console.error('Collect failed:', err);
  process.exit(1);
});
