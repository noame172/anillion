import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const env = process.env;

export type Mode = 'supabase' | 'dev-local';

function mode(): Mode {
  return env.DATABASE_URL && env.NEXT_PUBLIC_SUPABASE_URL && env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    ? 'supabase'
    : 'dev-local';
}

let cachedSecret: Uint8Array | null = null;

/** Secret for signing cookies. Never falls back to a shared constant. */
function sessionSecret(): Uint8Array {
  if (cachedSecret) return cachedSecret;
  let secret = env.SESSION_SECRET ?? '';
  if (secret && secret.length < 32) throw new Error('SESSION_SECRET must be at least 32 characters.');
  if (!secret) {
    if (mode() === 'supabase') throw new Error('SESSION_SECRET is required when Supabase is configured.');
    // dev-local: generate once and keep it next to the embedded database.
    const file = path.join(process.cwd(), '.data', 'session-secret');
    try {
      secret = fs.readFileSync(file, 'utf8').trim();
    } catch {
      secret = crypto.randomBytes(48).toString('hex');
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, secret, { mode: 0o600 });
    }
  }
  cachedSecret = new TextEncoder().encode(secret);
  return cachedSecret;
}

export const config = {
  /** "Continue with Google" is shown and works only when GOOGLE_LOGIN=on and the provider is enabled in Supabase. */
  get googleLogin(): boolean {
    return mode() === 'supabase' && env.GOOGLE_LOGIN === 'on';
  },
  get mode(): Mode {
    return mode();
  },
  get databaseUrl() {
    return env.DATABASE_URL ?? '';
  },
  get supabaseUrl() {
    return env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  },
  get supabaseAnonKey() {
    return env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
  },
  get siteUrl() {
    return (env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
  },
  get adminEmails(): string[] {
    return (env.ADMIN_EMAILS ?? '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
  },
  get openaiKey() {
    return env.OPENAI_API_KEY ?? '';
  },
  get openaiModel() {
    return env.OPENAI_MODEL || 'gpt-4o-mini';
  },
  get aiDailyLimit() {
    const n = Number(env.AI_DAILY_LIMIT ?? 20);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 20;
  },
  get isProduction() {
    return env.NODE_ENV === 'production';
  },
  sessionSecret,
};
