import { queryOne } from '@/lib/db/client';
import { formForScore, type Form } from '@/lib/game/forms';

export type PublicResult = { username: string | null; score: number; form: Form; date: string; gameNumber: number };

/** What a shared link may show: score, form and date of a finished game. Nothing private. */
export async function getPublicResult(sessionId: string): Promise<PublicResult | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId)) return null;
  const row = await queryOne<{ username: string | null; total_score: number; d: string; n: number }>(
    `select p.username, s.total_score, g.game_date::text as d,
            (select count(*)::int from daily_games x where x.status = 'published' and x.game_date <= g.game_date) as n
       from game_sessions s
       join daily_games g on g.id = s.game_id
       left join profiles p on p.id = s.user_id and not p.suspended
      where s.id = $1 and s.status = 'completed'`,
    [sessionId],
  );
  if (!row) return null;
  return { username: row.username, score: row.total_score, form: formForScore(row.total_score), date: row.d, gameNumber: row.n };
}
