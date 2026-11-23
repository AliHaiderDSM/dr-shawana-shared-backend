import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

export type DumpRow = Record<string, string | null>;
export type DumpTables = Map<string, DumpRow[]>;

const CREATE = /^CREATE TABLE `([^`]+)`/i;
const COLUMN = /^\s*`([^`]+)`\s/;
const INSERT = /^INSERT INTO `([^`]+)`/i;

function parseValues(text: string, start: number): (string | null)[][] {
  const rows: (string | null)[][] = [];
  let i = start;
  const n = text.length;
  while (i < n) {
    while (i < n && text[i] !== '(') {
      if (text[i] === ';') return rows;
      i += 1;
    }
    if (i >= n) break;
    i += 1;
    const row: (string | null)[] = [];
    while (i < n) {
      while (text[i] === ' ' || text[i] === '\n' || text[i] === '\r' || text[i] === '\t') i += 1;
      if (text.startsWith('_binary ', i)) i += 8;
      const ch = text[i];
      if (ch === "'") {
        i += 1;
        let value = '';
        while (i < n) {
          const c = text[i];
          if (c === '\\') {
            const next = text[i + 1];
            value +=
              next === 'n'
                ? '\n'
                : next === 'r'
                  ? '\r'
                  : next === 't'
                    ? '\t'
                    : next === '0'
                      ? '\0'
                      : next === 'Z'
                        ? '\x1a'
                        : (next ?? '');
            i += 2;
          } else if (c === "'" && text[i + 1] === "'") {
            value += "'";
            i += 2;
          } else if (c === "'") {
            i += 1;
            break;
          } else {
            value += c;
            i += 1;
          }
        }
        row.push(value);
      } else {
        let end = i;
        while (end < n && text[end] !== ',' && text[end] !== ')') end += 1;
        const raw = text.slice(i, end).trim();
        row.push(raw.toUpperCase() === 'NULL' ? null : raw);
        i = end;
      }
      while (text[i] === ' ' || text[i] === '\n' || text[i] === '\r' || text[i] === '\t') i += 1;
      if (text[i] === ',') {
        i += 1;
        continue;
      }
      if (text[i] === ')') {
        i += 1;
        break;
      }
    }
    rows.push(row);
  }
  return rows;
}

function insertColumns(statement: string): { columns: string[] | null; valuesAt: number } {
  const valuesAt = statement.search(/\bVALUES\b/i);
  if (valuesAt < 0) return { columns: null, valuesAt: -1 };
  const head = statement.slice(0, valuesAt);
  const open = head.indexOf('(');
  if (open < 0) return { columns: null, valuesAt: valuesAt + 6 };
  const columns = head
    .slice(open + 1, head.lastIndexOf(')'))
    .split(',')
    .map((c) => c.trim().replace(/^`|`$/g, ''));
  return { columns, valuesAt: valuesAt + 6 };
}

function endsStatement(line: string, state: { quoted: boolean }): boolean {
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (state.quoted) {
      if (c === '\\') i += 1;
      else if (c === "'" && line[i + 1] === "'") i += 1;
      else if (c === "'") state.quoted = false;
    } else if (c === "'") state.quoted = true;
  }
  return !state.quoted && line.trimEnd().endsWith(';');
}

export async function readDump(file: string, wanted: string[]): Promise<DumpTables> {
  const want = new Set(wanted);
  const tables: DumpTables = new Map(wanted.map((t) => [t, []]));
  const schema = new Map<string, string[]>();
  const lines = createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  let creating: string | null = null;
  let collecting: string | null = null;
  let buffer: string[] = [];
  const state = { quoted: false };

  const flush = (table: string, statement: string) => {
    const { columns, valuesAt } = insertColumns(statement);
    if (valuesAt < 0) return;
    const names = columns ?? schema.get(table);
    if (!names) throw new Error(`No column list for ${table}: put CREATE TABLE before its INSERTs`);
    for (const values of parseValues(statement, valuesAt)) {
      const row: DumpRow = {};
      names.forEach((name, index) => {
        row[name] = values[index] ?? null;
      });
      tables.get(table)?.push(row);
    }
  };

  for await (const line of lines) {
    if (collecting) {
      buffer.push(line);
      if (endsStatement(line, state)) {
        flush(collecting, buffer.join('\n'));
        collecting = null;
        buffer = [];
      }
      continue;
    }
    if (creating) {
      const column = COLUMN.exec(line);
      if (column?.[1]) schema.get(creating)?.push(column[1]);
      if (line.trimStart().startsWith(')')) creating = null;
      continue;
    }
    const create = CREATE.exec(line);
    if (create?.[1]) {
      if (want.has(create[1])) {
        creating = create[1];
        schema.set(creating, []);
      }
      continue;
    }
    const insert = INSERT.exec(line);
    if (insert?.[1] && want.has(insert[1])) {
      state.quoted = false;
      if (endsStatement(line, state)) flush(insert[1], line);
      else {
        collecting = insert[1];
        buffer = [line];
      }
    }
  }
  return tables;
}
