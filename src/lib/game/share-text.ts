import { FORM_LABELS } from './forms';
import type { GameState } from './session';

const SQUARES: Record<string, string> = { common: '⬜', rare: '🟨', epic: '🟦', ultra: '🟪', miss: '⬛' };

/**
 * The text a player shares: branding, date, score and final form, one coloured square per prompt, and a
 * line with the number of Ultra answers and the streak when there is something to brag about.
 * No answers, so it spoils nothing.
 */
export function shareText(
  state: Pick<GameState, 'gameNumber' | 'date' | 'score' | 'form' | 'answers' | 'total'>,
  streak = 0,
): string {
  const grid = Array.from({ length: state.total }, (_, i) => {
    const a = state.answers.find((x) => x.position === i);
    return SQUARES[a?.tier ?? 'miss'];
  }).join('');
  const ultras = state.answers.filter((a) => a.tier === 'ultra').length;
  const brag = [ultras > 0 ? `🟪 ${ultras} Ultra` : '', streak >= 2 ? `🔥 ${streak}-day streak` : ''].filter(Boolean).join(' · ');
  return [`Animellion #${state.gameNumber} · ${state.date}`, `${state.score} pts · ${FORM_LABELS[state.form]}`, grid, brag, 'Can you beat me?']
    .filter(Boolean)
    .join('\n');
}
