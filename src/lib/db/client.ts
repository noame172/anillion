import { AsyncLocalStorage } from 'node:async_hooks';
import { config } from '@/lib/config';

export type Row = Record<string, any>;

export interface Queryable {
  query<T = Row>(sql: string, params?: unknown[]): Promise<T[]>;
}

export interface TxQueryable extends Queryable {
  /** Run several statements with no parameters (migrations). */
  exec(sql: string): Promise<void>;
}

export interface Driver extends Queryable {
  /** Run several statements with no parameters (migrations). */
  exec(sql: string): Promise<void>;
  tx<T>(fn: (q: TxQueryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

// The active transaction, if any. Lets nested helpers call query() and
// automatically join the surrounding transaction.
const activeTx = new AsyncLocalStorage<Queryable>();

type Holder = { driver?: Promise<Driver> };
const holder: Holder = ((globalThis as any).__anillionDb ??= {});

async function create(): Promise<Driver> {
  if (config.mode === 'supabase') {
    const { createPgDriver } = await import('./pg');
    return createPgDriver(config.databaseUrl);
  }
  const { createPgliteDriver } = await import('./pglite');
  const { migrate } = await import('./migrate');
  const { seedIfEmpty } = await import('./seed');
  const driver = await createPgliteDriver('.data/pglite');
  await migrate(driver, { stubSupabase: true });
  await seedIfEmpty(driver);
  return driver;
}

export function getDb(): Promise<Driver> {
  if (!holder.driver) {
    holder.driver = create().catch((err) => {
      holder.driver = undefined;
      throw err;
    });
  }
  return holder.driver;
}

/** Tests inject an in-memory database here. */
export function setDb(driver: Driver | null) {
  holder.driver = driver ? Promise.resolve(driver) : undefined;
}

export async function query<T = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
  const current = activeTx.getStore();
  if (current) return current.query<T>(sql, params);
  return (await getDb()).query<T>(sql, params);
}

export async function queryOne<T = Row>(sql: string, params: unknown[] = []): Promise<T | null> {
  return (await query<T>(sql, params))[0] ?? null;
}

/** Run fn inside one database transaction. Nested calls join the outer one. */
export async function tx<T>(fn: () => Promise<T>): Promise<T> {
  if (activeTx.getStore()) return fn();
  const db = await getDb();
  return db.tx((q) => activeTx.run(q, fn));
}
