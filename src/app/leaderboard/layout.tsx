import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Leaderboard',
  description: 'See the top Animellion players today and of all time. Rarer anime answers score more points.',
  alternates: { canonical: '/leaderboard' },
};

export default function LeaderboardLayout({ children }: { children: ReactNode }) {
  return children;
}
