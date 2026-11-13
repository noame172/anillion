export const TIERS = ['common', 'rare', 'epic', 'ultra'] as const;
export type Tier = (typeof TIERS)[number];

/** Fixed points per rarity tier. These never change with configuration. */
export const TIER_POINTS: Record<Tier, number> = { common: 25, rare: 50, epic: 75, ultra: 100 };

/** Display names live here so they can be renamed in one place. */
export const TIER_LABELS: Record<Tier, string> = {
  common: 'Common',
  rare: 'Rare',
  epic: 'Epic',
  ultra: 'Ultra Answer',
};

export function pointsForTier(tier: Tier): number {
  return TIER_POINTS[tier];
}

export function isTier(value: unknown): value is Tier {
  return typeof value === 'string' && (TIERS as readonly string[]).includes(value);
}

/**
 * Lower bounds, as a percentage of valid submissions for the question.
 * share > common → common; share > rare → rare; share > epic → epic; otherwise ultra.
 */
export type Thresholds = { common: number; rare: number; epic: number };

export const DEFAULT_THRESHOLDS: Thresholds = { common: 10, rare: 3, epic: 1 };

export function tierForShare(sharePct: number, t: Thresholds = DEFAULT_THRESHOLDS): Tier {
  if (sharePct > t.common) return 'common';
  if (sharePct > t.rare) return 'rare';
  if (sharePct > t.epic) return 'epic';
  return 'ultra';
}
