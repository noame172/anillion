import { FORM_LABELS } from '@/lib/game/forms';
import { OG_SIZE, ogCard } from '@/lib/og';
import { getPublicResult } from '@/lib/share';

export const size = OG_SIZE;
export const contentType = 'image/png';
export const alt = 'Anillion result';
export const dynamic = 'force-dynamic';

const ACCENT = { base: '#f5f3ea', ascended: '#ffd23f', azure: '#2aa8ff', ultra: '#ffffff' } as const;

export default async function Image({ params }: { params: Promise<{ sessionId: string }> }) {
  const result = await getPublicResult((await params).sessionId);
  if (!result) return ogCard({ kicker: 'THE DAILY POWER-UP', headline: 'Rarer answers charge higher' });
  return ogCard({
    kicker: `GAME #${result.gameNumber} · ${result.date}`,
    headline: FORM_LABELS[result.form].toUpperCase(),
    score: result.score,
    accent: ACCENT[result.form],
  });
}
