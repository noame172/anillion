import { describe, expect, it } from 'vitest';
import { periodBounds } from '@/lib/leaderboard';

describe('leaderboard periods', () => {
  it('a week runs Monday to Sunday', () => {
    expect(periodBounds('weekly', '2026-03-09')).toEqual({ from: '2026-03-09', to: '2026-03-15' }); // Monday
    expect(periodBounds('weekly', '2026-03-10')).toEqual({ from: '2026-03-09', to: '2026-03-15' });
    expect(periodBounds('weekly', '2026-03-15')).toEqual({ from: '2026-03-09', to: '2026-03-15' }); // Sunday
    expect(periodBounds('weekly', '2026-03-16')).toEqual({ from: '2026-03-16', to: '2026-03-22' });
  });

  it('a week can cross a month and a year', () => {
    expect(periodBounds('weekly', '2026-03-31')).toEqual({ from: '2026-03-30', to: '2026-04-05' });
    expect(periodBounds('weekly', '2027-01-01')).toEqual({ from: '2026-12-28', to: '2027-01-03' });
  });

  it('a month runs from the 1st to its last day, including leap years', () => {
    expect(periodBounds('monthly', '2026-03-10')).toEqual({ from: '2026-03-01', to: '2026-03-31' });
    expect(periodBounds('monthly', '2026-02-28')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(periodBounds('monthly', '2028-02-10')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(periodBounds('monthly', '2026-12-31')).toEqual({ from: '2026-12-01', to: '2026-12-31' });
  });
});
