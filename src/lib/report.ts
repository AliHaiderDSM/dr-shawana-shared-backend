import { type Response } from 'express';
import Decimal from 'decimal.js';
import { z } from 'zod';
import { sendOk } from './http';

export interface ReportColumn {
  key: string;
  label: string;
}

export interface Report {
  title: string;
  columns: ReportColumn[];
  rows: Record<string, unknown>[];
  totals?: Record<string, unknown>;
  byBranch?: Record<string, unknown>[];
  summary?: Record<string, unknown>;
}

export const reportFormat = {
  format: z
    .enum(['json', 'csv'])
    .default('json')
    .openapi({ description: 'csv downloads the rows as a CSV file' }),
  branchId: z
    .uuid()
    .optional()
    .openapi({ description: 'super_admin: one branch; leave out for every branch' }),
};

export const periodFilters = {
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM')
    .optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
};

function cell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const plain =
    typeof value === 'object' && 'toJSON' in (value as object)
      ? String((value as { toJSON: () => unknown }).toJSON())
      : Array.isArray(value)
        ? value.join('; ')
        : String(value);
  return /[",\n\r]/.test(plain) ? `"${plain.replace(/"/g, '""')}"` : plain;
}

export function toCsv(report: Report): string {
  const lines = [report.columns.map((c) => cell(c.label)).join(',')];
  for (const row of report.rows) lines.push(report.columns.map((c) => cell(row[c.key])).join(','));
  if (report.totals) {
    lines.push(report.columns.map((c, i) => cell(i === 0 ? 'Total' : report.totals?.[c.key])).join(','));
  }
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

export function sendReport(res: Response, report: Report, format: 'json' | 'csv') {
  if (format === 'csv') {
    const name = report.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${name}.csv"`);
    return res.status(200).send(toCsv(report));
  }
  return sendOk(res, report);
}

export class SqlFilter {
  private readonly clauses: string[] = [];
  readonly params: unknown[] = [];

  add(sql: string, ...values: unknown[]): this {
    let text = sql;
    for (const value of values) {
      this.params.push(value);
      text = text.replace('?', `$${this.params.length}`);
    }
    this.clauses.push(text);
    return this;
  }

  when(condition: unknown, sql: string, ...values: unknown[]): this {
    if (condition !== undefined && condition !== null && condition !== '' && condition !== false) {
      this.add(sql, ...values);
    }
    return this;
  }

  period(column: string, query: { month?: string; from?: string; to?: string }): this {
    this.when(query.month, `to_char(${column}, 'YYYY-MM') = ?`, query.month);
    this.when(query.from, `${column} >= ?`, query.from);
    this.when(query.to, `${column} <= ?`, query.to);
    return this;
  }

  get where(): string {
    return this.clauses.length > 0 ? `WHERE ${this.clauses.join(' AND ')}` : '';
  }

  get and(): string {
    return this.clauses.length > 0 ? `AND ${this.clauses.join(' AND ')}` : '';
  }
}

export function sumBy<T extends Record<string, unknown>>(rows: T[], keys: string[], scale = 2) {
  return Object.fromEntries(
    keys.map((key) => [
      key,
      rows.reduce((sum, row) => sum.plus(String(row[key] ?? 0)), new Decimal(0)).toFixed(scale),
    ]),
  );
}

export function breakdown<T extends Record<string, unknown>>(rows: T[], keys: string[], scale = 2) {
  const branches = [...new Set(rows.map((r) => String(r.branch)))].sort();
  return branches.map((branch) => ({
    branch,
    ...sumBy(
      rows.filter((r) => String(r.branch) === branch),
      keys,
      scale,
    ),
  }));
}
