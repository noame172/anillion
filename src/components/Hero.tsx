import type { CSSProperties } from 'react';
import { FORM_LABELS, type Form } from '@/lib/game/forms';

function Bolt({ className }: { className: string }) {
  return (
    <svg className={className} viewBox="0 0 40 90" aria-hidden="true">
      <path d="M26 0 L6 44 L18 46 L8 90 L36 34 L22 32 Z" fill="#fff" stroke="var(--aura)" strokeWidth="3" />
    </svg>
  );
}

/**
 * The hero in one of four forms. Artwork is loaded from
 * /public/hero/<form>/hero.svg so it can be replaced without code changes.
 */
export function Hero({ form, burst = false, size = 220 }: { form: Form; burst?: boolean; size?: number }) {
  return (
    <div
      className={`hero${burst ? ' bursting' : ''}`}
      data-form={form}
      style={{ '--hero-size': `${size}px` } as CSSProperties}
    >
      <div className="aura flame" aria-hidden="true" />
      <div className="aura" aria-hidden="true" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`/hero/${form}/hero.svg`} alt={`Hero: ${FORM_LABELS[form]}`} width={240} height={320} />
      <Bolt className="bolt b1" />
      <Bolt className="bolt b2" />
    </div>
  );
}
