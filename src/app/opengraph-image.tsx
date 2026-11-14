import { OG_SIZE, ogCard } from '@/lib/og';

export const size = OG_SIZE;
export const contentType = 'image/png';
export const alt = 'Animellion — the daily anime power-up';

export default function Image() {
  return ogCard({ kicker: 'THE DAILY POWER-UP', headline: 'Rarer answers charge higher' });
}
