import { describe, expect, it } from 'vitest';
import { shareText } from '@/lib/game/share-text';

const base = { gameNumber: 12, date: '2026-03-10', score: 350, form: 'azure', total: 4 } as const;
const answers = (...tiers: (string | null)[]) =>
  tiers.flatMap((tier, position) => (tier ? [{ position, tier }] : [])) as never;

describe('share text', () => {
  it('shows the grid and never an answer', () => {
    const text = shareText({ ...base, answers: answers('common', 'rare', 'epic', null) });
    expect(text).toBe('Animellion #12 · 2026-03-10\n350 pts · Azure Ascended\n⬜🟨🟦⬛\nCan you beat me?');
  });

  it('adds Ultra answers and a streak of 2 or more', () => {
    const text = shareText({ ...base, answers: answers('ultra', 'ultra', 'common', 'rare') }, 5);
    expect(text).toContain('🟪 2 Ultra · 🔥 5-day streak');
    expect(shareText({ ...base, answers: answers('common', 'common', 'common', 'common') }, 1)).not.toContain('🔥');
  });
});
