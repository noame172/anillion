import fs from 'node:fs';
import { Pool, types } from 'pg';
import type { Driver } from './client';

// Return DATE columns as plain 'YYYY-MM-DD' strings (no timezone shifting).
types.setTypeParser(1082, (v) => v);

/** The host the URL points at (never a substring match on the whole string, which a password could fool). */
function hostOf(connectionString: string): string {
  try {
    return new URL(connectionString).hostname.replace(/^\[|\]$/g, '');
  } catch {
    return '';
  }
}

let warned = false;

/**
 * TLS for the database connection. With DATABASE_SSL_CA (the CA certificate as PEM text, or a path
 * to the file; Supabase > Project Settings > Database > SSL Configuration) the server's certificate
 * is verified. Without it the connection is still encrypted but the server is not authenticated.
 */
export function sslFor(connectionString: string, env: Record<string, string | undefined> = process.env) {
  if (['localhost', '127.0.0.1', '::1'].includes(hostOf(connectionString))) return undefined;
  const raw = env.DATABASE_SSL_CA?.trim();
  if (raw) {
    const ca = raw.includes('BEGIN CERTIFICATE') ? raw.replace(/\\n/g, '\n') : fs.readFileSync(raw, 'utf8');
    return { ca, rejectUnauthorized: true };
  }
  if (!warned && env.NODE_ENV === 'production') {
    warned = true;
    console.warn('[db] DATABASE_SSL_CA is not set: the database certificate is not being verified.');
  }
  return { rejectUnauthorized: false };
}

export function createPgDriver(connectionString: string): Driver {
  const pool = new Pool({
    connectionString,
    max: 5,
    // A connection costs a TLS handshake and a login, so keep idle ones around a while.
    idleTimeoutMillis: 30_000,
    ssl: sslFor(connectionString),
  });
  return {
    async query(sql, params = []) {
      return (await pool.query(sql, params as any[])).rows;
    },
    async exec(sql) {
      await pool.query(sql);
    },
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('begin');
        const out = await fn({
          query: async (sql, params = []) => (await client.query(sql, params as any[])).rows,
          exec: async (sql) => {
            await client.query(sql);
          },
        });
        await client.query('commit');
        return out;
      } catch (err) {
        await client.query('rollback').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
    async close() {
      await pool.end();
    },
  };
}
