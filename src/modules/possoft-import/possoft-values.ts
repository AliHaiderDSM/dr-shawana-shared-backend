import { createHash } from 'node:crypto';
import type { EntityManager } from 'typeorm';
import { Decimal } from '../../database/transformers';
import type { DumpRow } from './dump-reader';

export function deterministicId(key: string): string {
  const hash = createHash('sha1').update(key).digest('hex').slice(0, 32).split('');
  hash[12] = '5';
  hash[16] = ((parseInt(hash[16] ?? '0', 16) & 0x3) | 0x8).toString(16);
  const hex = hash.join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const KEPT_CONTROL_CODES = new Set([9, 10, 13]);

const storable = (value: string) =>
  [...value].filter((c) => c.charCodeAt(0) >= 32 || KEPT_CONTROL_CODES.has(c.charCodeAt(0))).join('');

export const text = (value: string | null | undefined) => storable(value ?? '').trim();
export const isActive = (row: DumpRow) => text(row.close) !== '0';

export function amount(value: string | null | undefined): Decimal {
  const cleaned = text(value).replace(/[^0-9.-]/g, '');
  if (!cleaned || Number.isNaN(Number(cleaned))) return new Decimal(0);
  return new Decimal(cleaned);
}

export function dateOf(...values: (string | null | undefined)[]): string | null {
  for (const value of values) {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(text(value));
    if (match && match[1] !== '0000' && match[2] !== '00' && match[3] !== '00') return match[0];
  }
  return null;
}

export function timestampOf(value: string | null | undefined): string | null {
  const day = dateOf(value);
  if (!day) return null;
  const time = /\d{2}:\d{2}:\d{2}/.exec(text(value))?.[0] ?? '12:00:00';
  return `${day}T${time}+05:00`;
}

export const money = (value: Decimal) => value.toFixed(2);

export async function insertMany(em: EntityManager, table: string, columns: string[], rows: unknown[][]) {
  const perChunk = Math.max(1, Math.floor(60000 / columns.length));
  for (let start = 0; start < rows.length; start += perChunk) {
    const chunk = rows.slice(start, start + perChunk);
    const params: unknown[] = [];
    const tuples = chunk.map((row) => {
      const marks = row.map((value) => {
        params.push(value);
        return `$${params.length}`;
      });
      return `(${marks.join(', ')})`;
    });
    await em.query(
      `INSERT INTO ${table} (${columns.map((c) => `"${c}"`).join(', ')}) VALUES ${tuples.join(', ')}`,
      params,
    );
  }
}

export function byId(rows: DumpRow[], key: string) {
  const map = new Map<string, DumpRow>();
  for (const row of rows) map.set(text(row[key]), row);
  return map;
}

export function groupBy(rows: DumpRow[], key: string) {
  const map = new Map<string, DumpRow[]>();
  for (const row of rows) {
    const id = text(row[key]);
    const list = map.get(id) ?? [];
    list.push(row);
    map.set(id, list);
  }
  return map;
}

export function latestPrices(details: DumpRow[]) {
  const latest = new Map<string, { id: number; price: Decimal }>();
  for (const detail of details) {
    if (!isActive(detail)) continue;
    const productId = text(detail.product_id);
    const id = Number(text(detail.prod_det_id)) || 0;
    const current = latest.get(productId);
    if (!current || id > current.id) latest.set(productId, { id, price: amount(detail.prod_det_price) });
  }
  return new Map([...latest].map(([productId, { price }]) => [productId, price]));
}

export const CITY_BRANCHES = [
  { key: 'lahore', code: 'LHR', name: 'DSM Lahore', city: 'Lahore' },
  { key: 'islamabad', code: 'ISB', name: 'DSM Islamabad', city: 'Islamabad' },
  { key: 'multan', code: 'MUL', name: 'DSM Multan', city: 'Multan' },
  { key: 'karachi', code: 'KHI', name: 'DSM Karachi', city: 'Karachi' },
] as const;

export type CityBranch = (typeof CITY_BRANCHES)[number];

export function cityBranchOf(city: string): CityBranch | null {
  const lower = city.toLowerCase();
  return CITY_BRANCHES.find((b) => lower.includes(b.key)) ?? null;
}

export async function mainWarehouseId(em: EntityManager): Promise<string> {
  const [found] = (await em.query(
    `SELECT id FROM branches WHERE kind = 'warehouse' AND deleted_at IS NULL LIMIT 1`,
  )) as { id: string }[];
  if (found) return found.id;
  const [created] = (await em.query(
    `INSERT INTO branches (name, code, city, kind, status) VALUES ('Super Admin Stock', 'MAINWH', 'Lahore', 'warehouse', 'active') RETURNING id`,
  )) as { id: string }[];
  return (created as { id: string }).id;
}
