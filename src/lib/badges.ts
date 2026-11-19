/** Badges are worked out from a player's totals each time, so there is nothing extra to store or migrate. */
export type BadgeInput = {
  gamesPlayed: number;
  longestStreak: number;
  ultraAnswers: number;
  bestScore: number;
};

export type Badge = {
  id: string;
  name: string;
  description: string;
  earned: boolean;
  /** Progress towards the badge, for the ones that are not earned yet. */
  current: number;
  target: number;
};

type Rule = { id: string; name: string; description: string; target: number; value: (i: BadgeInput) => number };

const RULES: Rule[] = [
  { id: 'first-steps', name: 'First steps', description: 'Finish your first game', target: 1, value: (i) => i.gamesPlayed },
  { id: 'regular', name: 'Regular', description: 'Finish 10 games', target: 10, value: (i) => i.gamesPlayed },
  { id: 'dedicated', name: 'Dedicated', description: 'Finish 30 games', target: 30, value: (i) => i.gamesPlayed },
  { id: 'veteran', name: 'Veteran', description: 'Finish 100 games', target: 100, value: (i) => i.gamesPlayed },
  { id: 'on-a-roll', name: 'On a roll', description: 'Reach a 3-day streak', target: 3, value: (i) => i.longestStreak },
  { id: 'week-warrior', name: 'Week warrior', description: 'Reach a 7-day streak', target: 7, value: (i) => i.longestStreak },
  { id: 'monthly-master', name: 'Monthly master', description: 'Reach a 30-day streak', target: 30, value: (i) => i.longestStreak },
  { id: 'ultra-hunter', name: 'Ultra hunter', description: 'Give your first Ultra answer', target: 1, value: (i) => i.ultraAnswers },
  { id: 'rare-collector', name: 'Rare collector', description: 'Give 10 Ultra answers', target: 10, value: (i) => i.ultraAnswers },
  { id: 'deep-cuts', name: 'Deep cuts', description: 'Give 50 Ultra answers', target: 50, value: (i) => i.ultraAnswers },
  { id: 'azure', name: 'Azure Ascended', description: 'Score 350 or more in one game', target: 350, value: (i) => i.bestScore },
  { id: 'ultra-form', name: 'Ultra Form', description: 'Score 500 or more in one game', target: 500, value: (i) => i.bestScore },
];

export function badgesFor(input: BadgeInput): Badge[] {
  return RULES.map((r) => {
    const v = r.value(input);
    return { id: r.id, name: r.name, description: r.description, earned: v >= r.target, current: Math.min(v, r.target), target: r.target };
  });
}
