import { AppDataSource } from './data-source';
import { withTransaction } from './transaction';
import { Decimal, decimalTransformer, moneyTransformer, toMoney } from './transformers';

describe('decimalTransformer', () => {
  it('keeps money exact (no float drift)', () => {
    const a = decimalTransformer.from('0.10') as Decimal;
    const b = decimalTransformer.from('0.20') as Decimal;
    expect(a.plus(b).toString()).toBe('0.3');
    expect(decimalTransformer.to(new Decimal('1250.505'))).toBe('1250.505');
    expect(toMoney('1250.505').toFixed(2)).toBe('1250.51');
  });

  it('serialises money with 2 decimals and quantities with 3', () => {
    expect(JSON.stringify({ price: moneyTransformer.from('1500') })).toBe('{"price":"1500.00"}');
    expect(JSON.stringify(decimalTransformer.from('20'))).toBe('"20.000"');
    expect(JSON.stringify(toMoney('10.005'))).toBe('"10.01"');
  });

  it('passes null through', () => {
    expect(decimalTransformer.from(null)).toBeNull();
    expect(decimalTransformer.to(null)).toBeNull();
  });
});

describe('database', () => {
  beforeAll(async () => {
    await AppDataSource.query(
      `create table if not exists _b0_tx_test (id int primary key, amount numeric(12,2))`,
    );
  });
  afterAll(async () => {
    await AppDataSource.query(`drop table if exists _b0_tx_test`);
  });

  it('enables row level security on every table, with no policies', async () => {
    const withoutRls: { relname: string }[] = await AppDataSource.query(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
          AND c.relname NOT IN ('typeorm_migrations', '_b0_tx_test')`,
    );
    expect(withoutRls).toEqual([]);
    const policies = await AppDataSource.query(`SELECT 1 FROM pg_policies WHERE schemaname = 'public'`);
    expect(policies).toEqual([]);
  });

  it('runs every public view with the caller permissions (security_invoker)', async () => {
    const unsafe: { relname: string }[] = await AppDataSource.query(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'v'
          AND NOT COALESCE('security_invoker=true' = ANY (c.reloptions), false)`,
    );
    expect(unsafe).toEqual([]);
  });

  it('has pgcrypto enabled by the first migration', async () => {
    const rows = await AppDataSource.query(`select gen_random_uuid() as id`);
    expect(rows[0].id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('rolls back every write when the transaction fails', async () => {
    await expect(
      withTransaction(async (em) => {
        await em.query(`insert into _b0_tx_test (id, amount) values (1, 10.50)`);
        await em.query(`insert into _b0_tx_test (id, amount) values (1, 20.00)`);
      }),
    ).rejects.toThrow();
    const rows = await AppDataSource.query(`select count(*)::int as n from _b0_tx_test`);
    expect(rows[0].n).toBe(0);
  });

  it('joins an outer transaction instead of opening a new one', async () => {
    await withTransaction(async (outer) => {
      await outer.query(`insert into _b0_tx_test (id, amount) values (2, 5.00)`);
      await withTransaction(async (inner) => {
        expect(inner).toBe(outer);
        await inner.query(`insert into _b0_tx_test (id, amount) values (3, 7.25)`);
      }, outer);
    });
    const rows = await AppDataSource.query(`select sum(amount)::text as total from _b0_tx_test`);
    expect(rows[0].total).toBe('12.25');
  });
});
