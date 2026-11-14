import { z } from 'zod';
import { getDb, query, tx } from '@/lib/db/client';
import { DEFAULT_THRESHOLDS } from '@/lib/game/tiers';

function validTimezone(tz: string) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const settingsSchema = z
  .object({
    thresholds: z.object({
      common: z.number().min(0).max(100),
      rare: z.number().min(0).max(100),
      epic: z.number().min(0).max(100),
    }),
    /** Valid submissions a question needs before rarity is calculated from player data. */
    minSample: z.number().int().min(1).max(1_000_000),
    questionsPerGame: z.number().int().min(1).max(30),
    /** IANA timezone the daily rollover is measured in. */
    timezone: z.string().refine(validTimezone, 'Unknown timezone'),
    /** Local hour (0-23) at which a new daily game starts. */
    rolloverHour: z.number().int().min(0).max(23),
    timeLimitSec: z.number().int().min(5).max(300),
    /** Build a game automatically when no game was scheduled for a day. */
    autoGenerate: z.boolean(),
  })
  .refine((s) => s.thresholds.common > s.thresholds.rare && s.thresholds.rare > s.thresholds.epic, {
    message: 'Thresholds must descend: common > rare > epic.',
  });

export type Settings = z.infer<typeof settingsSchema>;

export const DEFAULT_SETTINGS: Settings = {
  thresholds: DEFAULT_THRESHOLDS,
  minSample: 100,
  questionsPerGame: 7,
  timezone: 'UTC',
  rolloverHour: 0,
  timeLimitSec: 30,
  autoGenerate: true,
};

// Every game request needs the settings several times (date, timer, rollover, next game).
// They change rarely, so keep them for a couple of seconds instead of asking the database each time.
const CACHE_MS = 2000;
let cached: { db: unknown; at: number; value: Settings } | null = null;

async function readSettings(): Promise<Settings> {
  const rows = await query<{ value: unknown }>(`select value from settings where key = 'game'`);
  if (!rows.length) return DEFAULT_SETTINGS;
  const stored = typeof rows[0].value === 'string' ? JSON.parse(rows[0].value) : rows[0].value;
  const parsed = settingsSchema.safeParse({ ...DEFAULT_SETTINGS, ...(stored as object) });
  return parsed.success ? parsed.data : DEFAULT_SETTINGS;
}

/**
 * Current settings. `fresh` skips the short cache: use it where a stale value would be
 * wrong (saving settings, freezing a game's rules).
 */
export async function getSettings({ fresh = false }: { fresh?: boolean } = {}): Promise<Settings> {
  const db = await getDb();
  const now = Date.now();
  if (!fresh && cached && cached.db === db && now - cached.at < CACHE_MS) return cached.value;
  const value = await readSettings();
  if (!fresh) cached = { db, at: now, value };
  return value;
}

export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  return tx(async () => {
    // Make sure the row exists, then lock it: two administrators saving at once take turns
    // instead of one silently overwriting the other's change.
    await query(`insert into settings (key, value) values ('game', $1::jsonb) on conflict (key) do nothing`, [
      JSON.stringify(DEFAULT_SETTINGS),
    ]);
    await query(`select 1 from settings where key = 'game' for update`);
    const next = settingsSchema.parse({ ...(await getSettings({ fresh: true })), ...patch });
    await query(`update settings set value = $1::jsonb where key = 'game'`, [JSON.stringify(next)]);
    cached = null;
    return next;
  });
}
