import { Brackets, type ObjectLiteral, type SelectQueryBuilder } from 'typeorm';
import { z } from 'zod';
import { type PageMeta } from './http';

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

export function listQuerySchema<const S extends readonly [string, ...string[]]>(
  sortable: S,
  defaultSort: `${S[number]}` | `-${S[number]}` = `-${sortable[0]}`,
) {
  const sortValues = sortable.flatMap((f) => [f, `-${f}`]) as [string, ...string[]];
  return z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
    search: z.string().trim().max(100).optional(),
    sort: z.enum(sortValues).default(defaultSort),
  });
}

export interface ListQuery {
  page: number;
  pageSize: number;
  search?: string;
  sort: string;
}

export interface ListOptions {
  searchColumns?: string[];
  sortMap: Record<string, string>;
  toOneJoins?: boolean;
}

export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function searchColumn(path: string) {
  return path.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

export function applyListQuery<T extends ObjectLiteral>(
  qb: SelectQueryBuilder<T>,
  query: ListQuery,
  options: ListOptions,
): SelectQueryBuilder<T> {
  const { searchColumns = [] } = options;
  if (query.search && searchColumns.length > 0) {
    const term = `%${escapeLike(query.search)}%`;
    qb.andWhere(
      new Brackets((w) => {
        searchColumns.forEach((col) =>
          w.orWhere(`${searchColumn(col)}::text ILIKE :__search`, { __search: term }),
        );
      }),
    );
  }

  const desc = query.sort.startsWith('-');
  const key = desc ? query.sort.slice(1) : query.sort;
  const column = options.sortMap[key];
  if (column) qb.orderBy(column, desc ? 'DESC' : 'ASC');

  const skipped = (query.page - 1) * query.pageSize;
  return options.toOneJoins
    ? qb.offset(skipped).limit(query.pageSize)
    : qb.skip(skipped).take(query.pageSize);
}

export function pageMeta(query: Pick<ListQuery, 'page' | 'pageSize'>, total: number): PageMeta {
  return {
    page: query.page,
    pageSize: query.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
  };
}

export async function paginate<T extends ObjectLiteral>(
  qb: SelectQueryBuilder<T>,
  query: ListQuery,
  options: ListOptions,
): Promise<{ items: T[]; meta: PageMeta }> {
  const listed = applyListQuery(qb, query, options);
  const [items, total] = await Promise.all([listed.getMany(), listed.clone().getCount()]);
  return { items, meta: pageMeta(query, total) };
}
