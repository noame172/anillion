import { describe, expect, it } from 'vitest';
import { addDays } from '@/lib/game/daily';
import { streakWithFreezes } from '@/lib/game/streak';

const run = (start: string, n: number) => Array.from({ length: n }, (_, i) => addDays(start, i));

describe('streak freezes', () => {
  it('behaves like a normal streak when no day is missed', () => {
    const days = run('2026-03-01', 5);
    expect(streakWithFreezes(days, '2026-03-05')).toMatchObject({ current: 5, longest: 5, freezes: 0, frozen: false });
    expect(streakWithFreezes(days, '2026-03-06').current).toBe(5); // today not played yet
  });

  it('a missed day ends a streak that has not earned a freeze', () => {
    const info = streakWithFreezes([...run('2026-03-01', 3), '2026-03-05'], '2026-03-05');
    expect(info).toMatchObject({ current: 1, longest: 3, freezes: 0 });
  });

  it('earns a freeze on the 7th day and uses it to cover one missed day', () => {
    const week = run('2026-03-01', 7); // 1 to 7 March
    expect(streakWithFreezes(week, '2026-03-07').freezes).toBe(1);
    // misses 8 March, plays 9 March
    const info = streakWithFreezes([...week, '2026-03-09'], '2026-03-09');
    expect(info).toMatchObject({ current: 8, longest: 8, freezes: 0, saved: ['2026-03-08'] });
  });

  it('does not add the covered day to the count, and two missed days still end the streak', () => {
    const week = run('2026-03-01', 7);
    expect(streakWithFreezes([...week, '2026-03-10'], '2026-03-10')).toMatchObject({ current: 1, longest: 7, freezes: 1 });
  });

  it('keeps the streak alive today when yesterday was missed and a freeze is banked', () => {
    const week = run('2026-03-01', 7);
    // last played 7 March; today is 9 March, so 8 March was missed
    expect(streakWithFreezes(week, '2026-03-09')).toMatchObject({ current: 7, frozen: true, freezes: 1 });
    // two days missed already: too late
    expect(streakWithFreezes(week, '2026-03-10')).toMatchObject({ current: 0, frozen: false });
  });

  it('banks at most 2 freezes', () => {
    expect(streakWithFreezes(run('2026-03-01', 21), '2026-03-21').freezes).toBe(2);
  });

  it('handles no games and repeated dates', () => {
    expect(streakWithFreezes([], '2026-03-01')).toEqual({ current: 0, longest: 0, freezes: 0, frozen: false, saved: [] });
    expect(streakWithFreezes(['2026-03-01', '2026-03-01'], '2026-03-01').current).toBe(1);
  });
});
