import { PGlite } from '@electric-sql/pglite';
import type { Driver } from './client';

/** Embedded Postgres. Pass no dataDir for an in-memory database (tests). */
export async function createPgliteDriver(dataDir?: string): Promise<Driver> {
  const db = new PGlite(dataDir);
  await db.waitReady;
  return {
    async query(sql, params = []) {
      return (await db.query(sql, params as any[])).rows as any[];
    },
    async exec(sql) {
      await db.exec(sql);
    },
    async tx(fn) {
      return (await db.transaction(async (t) =>
        fn({
          query: async (sql, params = []) => (await t.query(sql, params as any[])).rows as any[],
          exec: async (sql) => {
            await t.exec(sql);
          },
        }),
      )) as any;
    },
    async close() {
      await db.close();
    },
  };
}
