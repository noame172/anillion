import { describe, expect, it } from 'vitest';
import { badgesFor } from '@/lib/badges';

const earned = (input: Parameters<typeof badgesFor>[0]) => badgesFor(input).filter((b) => b.earned).map((b) => b.id);

describe('badges', () => {
  it('a new player has none, and sees their progress', () => {
    const none = badgesFor({ gamesPlayed: 0, longestStreak: 0, ultraAnswers: 0, bestScore: 0 });
    expect(none.every((b) => !b.earned)).toBe(true);
    expect(none.find((b) => b.id === 'regular')).toMatchObject({ current: 0, target: 10 });
  });

  it('earns badges at their thresholds and not before', () => {
    expect(earned({ gamesPlayed: 9, longestStreak: 2, ultraAnswers: 0, bestScore: 349 })).toEqual(['first-steps']);
    expect(earned({ gamesPlayed: 10, longestStreak: 7, ultraAnswers: 10, bestScore: 350 })).toEqual([
      'first-steps', 'regular', 'on-a-roll', 'week-warrior', 'ultra-hunter', 'rare-collector', 'azure',
    ]);
  });

  it('caps progress at the target', () => {
    expect(badgesFor({ gamesPlayed: 500, longestStreak: 0, ultraAnswers: 0, bestScore: 0 }).find((b) => b.id === 'veteran')).toMatchObject({ earned: true, current: 100, target: 100 });
  });
});
