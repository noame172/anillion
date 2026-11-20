import { describe, expect, it } from 'vitest';
import { whatYouWouldLose } from '@/lib/delete-summary';

const badge = (earned: boolean) => ({ id: 'x', name: 'x', description: '', earned, current: 0, target: 1 });
const stats = (ultra: number, earned: number) => ({
  tiers: { common: 0, rare: 0, epic: 0, ultra },
  badges: [...Array(earned).fill(badge(true)), badge(false)],
});

describe('whatYouWouldLose', () => {
  it('lists only what the player has, in order', () => {
    const p = { streak: 12, longestStreak: 12, gamesPlayed: 40, totalPoints: 5230 };
    expect(whatYouWouldLose(p, stats(7, 5))).toEqual([
      'your 12-day streak',
      '7 Ultra Answers',
      '40 games and 5,230 points',
      '5 badges',
    ]);
  });

  it('falls back to the best streak when the current one is over', () => {
    const p = { streak: 0, longestStreak: 9, gamesPlayed: 9, totalPoints: 1 };
    expect(whatYouWouldLose(p, stats(0, 0))[0]).toBe('your best streak, 9 days');
  });

  it('uses singular forms and is empty for a brand-new account', () => {
    expect(whatYouWouldLose({ streak: 0, longestStreak: 0, gamesPlayed: 1, totalPoints: 1 }, stats(1, 1))).toEqual([
      '1 Ultra Answer',
      '1 game and 1 point',
      '1 badge',
    ]);
    expect(whatYouWouldLose({ streak: 0, longestStreak: 0, gamesPlayed: 0, totalPoints: 0 }, null)).toEqual([]);
  });
});
