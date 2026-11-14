import { FORM_LABELS } from './forms';
import type { GameState } from './session';

const SQUARES: Record<string, string> = { common: '⬜', rare: '🟨', epic: '🟦', ultra: '🟪', miss: '⬛' };

/** The text a player shares: branding, date, score and final form. No answers, so it spoils nothing. */
export function shareText(state: Pick<GameState, 'gameNumber' | 'date' | 'score' | 'form' | 'answers' | 'total'>): string {
  const grid = Array.from({ length: state.total }, (_, i) => {
    const a = state.answers.find((x) => x.position === i);
    return SQUARES[a?.tier ?? 'miss'];
  }).join('');
  return `Animellion #${state.gameNumber} · ${state.date}\n${state.score} pts · ${FORM_LABELS[state.form]}\n${grid}`;
}
