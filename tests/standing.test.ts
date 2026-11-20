import { describe, expect, it } from 'vitest';
import { MIN_STANDING_SAMPLE, standingFrom } from '@/lib/leaderboard';

describe('standingFrom', () => {
  it('says nothing until enough people have finished', () => {
    expect(standingFrom(MIN_STANDING_SAMPLE - 1, 0)).toBeNull();
  });

  it('puts the best score in the top slice, rounding up', () => {
    expect(standingFrom(10, 0)).toEqual({ top: 10, total: 10 });
    expect(standingFrom(200, 0)).toEqual({ top: 1, total: 200 });
  });

  it('counts only the players who scored higher', () => {
    // 3 of 20 scored higher, so this player is 4th: top 20%.
    expect(standingFrom(20, 3)).toEqual({ top: 20, total: 20 });
    // Last place of 8 is the bottom 100%.
    expect(standingFrom(8, 7)).toEqual({ top: 100, total: 8 });
  });
});
