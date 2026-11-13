import type { Metadata } from 'next';
import Link from 'next/link';
import { Hero } from '@/components/Hero';

export const metadata: Metadata = { title: 'Page not found' };

export default function NotFound() {
  return (
    <div className="narrow card stack center" style={{ justifyItems: 'center' }}>
      <Hero form="base" size={150} />
      <h1 style={{ fontSize: 44, color: 'var(--yellow)' }}>404</h1>
      <p>This page powered down. It does not exist or has moved.</p>
      <Link href="/" className="btn">
        Back to the game
      </Link>
    </div>
  );
}
