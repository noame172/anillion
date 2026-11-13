import { z } from 'zod';
import { query } from '@/lib/db/client';
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

export async function getSettings(): Promise<Settings> {
  const rows = await query<{ value: unknown }>(`select value from settings where key = 'game'`);
  if (!rows.length) return DEFAULT_SETTINGS;
  const stored = typeof rows[0].value === 'string' ? JSON.parse(rows[0].value) : rows[0].value;
  const parsed = settingsSchema.safeParse({ ...DEFAULT_SETTINGS, ...(stored as object) });
  return parsed.success ? parsed.data : DEFAULT_SETTINGS;
}

export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = settingsSchema.parse({ ...(await getSettings()), ...patch });
  await query(
    `insert into settings (key, value) values ('game', $1::jsonb)
     on conflict (key) do update set value = excluded.value`,
    [JSON.stringify(next)],
  );
  return next;
}
