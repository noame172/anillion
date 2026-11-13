import { describe, expect, it } from 'vitest';
import { pointsForTier, tierForShare } from '@/lib/game/tiers';
import { formForScore, progressToNext } from '@/lib/game/forms';
import { normalizeAnswer } from '@/lib/game/normalize';

describe('tier points', () => {
  it('awards the fixed points per tier', () => {
    expect(pointsForTier('common')).toBe(25);
    expect(pointsForTier('rare')).toBe(50);
    expect(pointsForTier('epic')).toBe(75);
    expect(pointsForTier('ultra')).toBe(100);
  });
});

describe('tierForShare (default thresholds)', () => {
  it.each([
    [45, 'common'],
    [10.01, 'common'],
    [10, 'rare'],
    [3.01, 'rare'],
    [3, 'epic'],
    [1.01, 'epic'],
    [1, 'ultra'],
    [0.5, 'ultra'],
    [0, 'ultra'],
  ])('%s%% → %s', (share, tier) => {
    expect(tierForShare(share as number)).toBe(tier);
  });

  it('honours custom thresholds', () => {
    expect(tierForShare(15, { common: 20, rare: 5, epic: 2 })).toBe('rare');
  });
});

describe('formForScore', () => {
  it.each([
    [0, 'base'],
    [199, 'base'],
    [200, 'ascended'],
    [349, 'ascended'],
    [350, 'azure'],
    [499, 'azure'],
    [500, 'ultra'],
    [700, 'ultra'],
  ])('%s points → %s', (score, form) => {
    expect(formForScore(score as number)).toBe(form);
  });

  it('175 + 100 jumps from base to ascended', () => {
    expect(formForScore(175)).toBe('base');
    expect(formForScore(275)).toBe('ascended');
  });

  it('reports progress to the next form', () => {
    expect(progressToNext(100)).toEqual({ form: 'base', next: 'ascended', pointsToNext: 100, pct: 50 });
    expect(progressToNext(350)).toEqual({ form: 'azure', next: 'ultra', pointsToNext: 150, pct: 0 });
    expect(progressToNext(650)).toEqual({ form: 'ultra', next: null, pointsToNext: 0, pct: 100 });
  });
});

describe('normalizeAnswer', () => {
  it('ignores case, spacing, accents and punctuation', () => {
    expect(normalizeAnswer('  SON   Gokū! ')).toBe('son goku');
    expect(normalizeAnswer('Monkey D. Luffy')).toBe('monkey d luffy');
    expect(normalizeAnswer('Pokémon')).toBe('pokemon');
  });
  it('folds full-width characters', () => {
    expect(normalizeAnswer('ＧＯＫＵ')).toBe('goku');
  });
  it('rejects empty, punctuation-only and oversized input', () => {
    expect(normalizeAnswer('   ')).toBe('');
    expect(normalizeAnswer('!!!')).toBe('');
    expect(normalizeAnswer('a'.repeat(500))).toBe('');
    expect(normalizeAnswer(undefined as unknown as string)).toBe('');
  });
});
