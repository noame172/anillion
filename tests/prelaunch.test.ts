import { beforeEach, describe, expect, it } from 'vitest';
import { getDb, query, queryOne } from '@/lib/db/client';
import { syncSeed } from '@/lib/db/seed';
import { pickQuestions, setGameQuestions } from '@/lib/game/daily';
import { buildSnapshot, lookupRarity } from '@/lib/game/rarity';
import { startSession, submitAnswer, type GameState } from '@/lib/game/session';
import { DEFAULT_THRESHOLDS } from '@/lib/game/tiers';
import { updateSettings } from '@/lib/settings';
import { at, freshDb, guest, makeQuestion, makeStandardQuestions } from './helpers';

const NOW = at('2026-03-10T12:00:00Z');

beforeEach(async () => {
  await freshDb();
});

async function gameWith(date: string, questionIds: string[]) {
  const [{ id }] = await query<{ id: string }>(
    `insert into daily_games (game_date, status, question_count, published_at) values ($1, 'published', $2, now()) returning id`,
    [date, questionIds.length],
  );
  await setGameQuestions(id, questionIds);
  return id;
}

describe('pre-launch mode: nothing counts', () => {
  it('treats every question as never played when picking a day', async () => {
    const [played, fresh] = await makeStandardQuestions(2);
    await gameWith('2026-01-01', [played.id]);

    // Normally a question that was already used waits behind one that never was.
    expect(await pickQuestions('2030-01-01', 1)).toEqual([fresh.id]);

    // In pre-launch the history is ignored, so the used one comes up too.
    const picks = new Set<string>();
    for (let day = 1; day <= 30; day++) {
      const [id] = await pickQuestions(`2030-02-${String(day).padStart(2, '0')}`, 1, true);
      picks.add(id);
    }
    expect(picks.has(played.id)).toBe(true);
  });

  it('does not add answers to the rarity statistics while it is on, and does once it is off', async () => {
    await makeStandardQuestions(7);
    const play = async () => {
      const viewer = guest();
      const state: GameState = await startSession(viewer, NOW);
      const letter = `c${state.current!.text.match(/(\d+)$/)![1]}`;
      const res = await submitAnswer(viewer, { questionId: state.current!.id, text: letter }, new Date(NOW.getTime() + 2000));
      expect(res.status).toBe('accepted');
    };

    await updateSettings({ prelaunch: true });
    await play();
    expect((await queryOne<{ n: number }>('select count(*)::int as n from answer_stats'))!.n).toBe(0);

    await updateSettings({ prelaunch: false });
    await play();
    expect((await queryOne<{ n: number }>('select count(*)::int as n from answer_stats'))!.n).toBe(1);
  });

  it('keeps provisional tiers when freezing a game, whatever statistics already exist', async () => {
    const q = await makeQuestion('Name a thing for the snapshot test', [
      { name: 'Popular', tier: 'ultra' },
      { name: 'Other', tier: 'common' },
    ]);
    const game = await gameWith('2026-03-10', [q.id]);
    // Real data says Popular is by far the most common answer.
    await query('insert into answer_stats (question_id, answer_id, valid_count) values ($1, $2, 1000)', [q.id, q.answers.Popular]);

    await buildSnapshot(game, DEFAULT_THRESHOLDS, 100, true);
    expect(await lookupRarity(game, q.answers.Popular)).toMatchObject({ tier: 'ultra', provisional: true, share: null });

    await buildSnapshot(game, DEFAULT_THRESHOLDS, 100, false);
    expect(await lookupRarity(game, q.answers.Popular)).toMatchObject({ tier: 'common', provisional: false });
  });
});

describe('syncing the question file to the database', () => {
  const file = (...texts: string[]) =>
    texts.map((text) => ({ text, category: 'Test', answers: [['Alpha', 'common', 'A1'], ['Beta', 'rare']] as [string, string, ...string[]][] }));
  const count = async (sql: string) => (await queryOne<{ n: number }>(sql))!.n;

  it('shows the plan without writing anything, then applies it', async () => {
    const db = getDb();
    const data = file('Name the first thing.', 'Name the second thing.');
    const dry = await syncSeed(await db, data, { apply: false });
    expect(dry.add).toHaveLength(2);
    expect(await count('select count(*)::int as n from questions')).toBe(0);

    await syncSeed(await db, data, { apply: true });
    expect(await count('select count(*)::int as n from questions')).toBe(2);
    expect(await count('select count(*)::int as n from answers')).toBe(4);
    expect(await count('select count(*)::int as n from answer_aliases')).toBe(2);

    const again = await syncSeed(await db, data, { apply: true });
    expect(again).toEqual({
      add: [],
      remove: [],
      reactivate: [],
      recategorise: [],
      topUp: [],
      answers: { added: 0, removed: 0, retiered: 0, aliasesAdded: 0, aliasesRemoved: 0 },
    });
  });

  it('notices an alias that was only added to an answer already in the database', async () => {
    const db = await getDb();
    await syncSeed(db, [{ text: 'Name a thing.', category: 'Test', answers: [['Kyouko Hori', 'common', 'Kyouko'], ['Souta Hori', 'rare']] as [string, string, ...string[]][] }], { apply: true });
    const edited = [{ text: 'Name a thing.', category: 'Test', answers: [['Kyouko Hori', 'common', 'Kyouko', 'Hori'], ['Souta Hori', 'rare']] as [string, string, ...string[]][] }];
    const dry = await syncSeed(db, edited, { apply: false });
    expect(dry.topUp).toEqual(['Name a thing.']);
    expect(dry.answers.aliasesAdded).toBe(1);
    await syncSeed(db, edited, { apply: true });
    const hori = await query<{ canonical: string }>(`select a.canonical from answer_aliases al join answers a on a.id = al.answer_id where al.norm = 'hori'`);
    expect(hori).toEqual([{ canonical: 'Kyouko Hori' }]);
    expect((await syncSeed(db, edited, { apply: false })).topUp).toEqual([]);
  });

  it('mirrors edits to a question’s answers: added, removed and re-rated', async () => {
    const db = await getDb();
    await syncSeed(db, file('Name the first thing.'), { apply: true });
    const edited = [
      {
        text: 'Name the first thing.',
        category: 'Test',
        answers: [['Alpha', 'epic'], ['Gamma', 'common', 'G1']] as [string, string, ...string[]][], // Beta gone, Alpha re-rated, alias A1 gone
      },
    ];
    const plan = await syncSeed(db, edited, { apply: true });
    expect(plan.answers).toEqual({ added: 1, removed: 1, retiered: 1, aliasesAdded: 1, aliasesRemoved: 1 });
    const rows = await query<{ canonical: string; provisional_tier: string }>('select canonical, provisional_tier from answers order by canonical');
    expect(rows).toEqual([
      { canonical: 'Alpha', provisional_tier: 'epic' },
      { canonical: 'Gamma', provisional_tier: 'common' },
    ]);
    expect(await count('select count(*)::int as n from answer_aliases')).toBe(1); // only G1
  });

  it('deletes a removed question nobody used, and only switches off one that was used', async () => {
    const db = await getDb();
    await syncSeed(db, file('Name the first thing.', 'Name the second thing.', 'Name the third thing.'), { apply: true });
    const used = await queryOne<{ id: string }>(`select id from questions where text = 'Name the second thing.'`);
    await gameWith('2026-01-01', [used!.id]);

    const plan = await syncSeed(db, file('Name the first thing.'), { apply: true });
    expect(plan.remove).toEqual(
      expect.arrayContaining([
        { text: 'Name the second thing.', action: 'deactivate' },
        { text: 'Name the third thing.', action: 'delete' },
      ]),
    );
    expect(await count(`select count(*)::int as n from questions where text = 'Name the third thing.'`)).toBe(0);
    expect(await count(`select count(*)::int as n from questions where text = 'Name the second thing.' and not active`)).toBe(1);

    // Putting it back in the file switches it on again, with its history intact.
    const back = await syncSeed(db, file('Name the first thing.', 'Name the second thing.'), { apply: true });
    expect(back.reactivate).toEqual(['Name the second thing.']);
    expect(await count(`select count(*)::int as n from questions where text = 'Name the second thing.' and active`)).toBe(1);
  });

  it('never touches a question that was written by hand in the admin screens', async () => {
    const db = await getDb();
    await makeQuestion('A question typed in by an administrator', [{ name: 'Gamma' }]);
    const plan = await syncSeed(db, file('Name the first thing.'), { apply: true });
    expect(plan.remove).toEqual([]);
    expect(await count(`select count(*)::int as n from questions where text = 'A question typed in by an administrator'`)).toBe(1);
  });
});
