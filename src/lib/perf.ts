import { AsyncLocalStorage } from 'node:async_hooks';
import { performance } from 'node:perf_hooks';
import { type RequestHandler } from 'express';
import { PostgresQueryRunner } from 'typeorm/driver/postgres/PostgresQueryRunner.js';

interface RequestTiming {
  queries: number;
  dbMs: number;
}

const storage = new AsyncLocalStorage<RequestTiming>();
let patched = false;

function patchQueryRunner() {
  if (patched) return;
  patched = true;
  const original = PostgresQueryRunner.prototype.query;
  PostgresQueryRunner.prototype.query = async function timedQuery(
    this: PostgresQueryRunner,
    ...args: Parameters<typeof original>
  ) {
    const timing = storage.getStore();
    if (!timing) return original.apply(this, args);
    const started = performance.now();
    try {
      return await original.apply(this, args);
    } finally {
      timing.queries += 1;
      timing.dbMs += performance.now() - started;
    }
  } as typeof original;
}

export const requestTiming: RequestHandler = (_req, res, next) => {
  patchQueryRunner();
  const timing: RequestTiming = { queries: 0, dbMs: 0 };
  const started = performance.now();
  const writeHead = res.writeHead.bind(res);
  res.writeHead = ((...args: Parameters<typeof res.writeHead>) => {
    if (!res.headersSent) {
      const total = performance.now() - started;
      res.setHeader(
        'Server-Timing',
        `db;dur=${timing.dbMs.toFixed(1)};desc="${timing.queries} queries", app;dur=${(total - timing.dbMs).toFixed(1)}, total;dur=${total.toFixed(1)}`,
      );
    }
    return writeHead(...args);
  }) as typeof res.writeHead;
  storage.run(timing, next);
};
