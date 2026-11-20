import type { PlayerStats, ProfileData } from '@/lib/profile-data';

const plural = (n: number, one: string, many: string) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

/**
 * What a player would lose by deleting their account, as short phrases for "you'd lose ...".
 * Only things they actually have are listed, biggest-feeling first, so the screen is about them
 * and not a generic warning. Empty when there is nothing yet.
 */
export function whatYouWouldLose(
  profile: Pick<ProfileData, 'streak' | 'longestStreak' | 'gamesPlayed' | 'totalPoints'>,
  stats: Pick<PlayerStats, 'tiers' | 'badges'> | null,
): string[] {
  const out: string[] = [];
  if (profile.streak >= 2) out.push(`your ${profile.streak}-day streak`);
  else if (profile.longestStreak >= 2) out.push(`your best streak, ${profile.longestStreak} days`);
  const ultras = stats?.tiers.ultra ?? 0;
  if (ultras > 0) out.push(`${plural(ultras, 'Ultra Answer', 'Ultra Answers')}`);
  if (profile.gamesPlayed > 0) {
    out.push(`${plural(profile.gamesPlayed, 'game', 'games')} and ${plural(profile.totalPoints, 'point', 'points')}`);
  }
  const badges = stats?.badges.filter((b) => b.earned).length ?? 0;
  if (badges > 0) out.push(`${plural(badges, 'badge', 'badges')}`);
  return out;
}
