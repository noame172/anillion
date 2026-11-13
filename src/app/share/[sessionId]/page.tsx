import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Hero } from '@/components/Hero';
import { FORM_LABELS } from '@/lib/game/forms';
import { getPublicResult } from '@/lib/share';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ sessionId: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const result = await getPublicResult((await params).sessionId);
  if (!result) return { title: 'Result not found', robots: { index: false } };
  const who = result.username ?? 'A challenger';
  const title = `${who} reached ${FORM_LABELS[result.form]} with ${result.score} pts`;
  const description = `Anillion #${result.gameNumber} · ${result.date}. Can you find rarer answers?`;
  return { title, description, robots: { index: false }, openGraph: { title, description }, twitter: { title, description } };
}

export default async function SharePage({ params }: Props) {
  const result = await getPublicResult((await params).sessionId);
  if (!result) notFound();
  return (
    <div className="narrow card stack center" style={{ justifyItems: 'center' }}>
      <span className="chip">
        Anillion #{result.gameNumber} · {result.date}
      </span>
      <Hero form={result.form} size={200} />
      <p style={{ margin: 0 }}>
        <strong>{result.username ?? 'A challenger'}</strong> reached
      </p>
      <h1 className="form-name" data-form={result.form} style={{ fontSize: 34 }}>
        {FORM_LABELS[result.form]}
      </h1>
      <div className="big-score">{result.score}</div>
      <Link href="/" className="btn">
        ⚡ Play today&apos;s game
      </Link>
    </div>
  );
}
