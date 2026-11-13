import { ImageResponse } from 'next/og';

export const OG_SIZE = { width: 1200, height: 630 };

/** Shared social preview card. Pure shapes and text: no third-party artwork. */
export function ogCard(opts: { kicker: string; headline: string; score?: number; accent?: string }) {
  const accent = opts.accent ?? '#ffd23f';
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(180deg, #070b1f 0%, #0c1233 55%, #7a3a12 130%)',
          color: '#f5f3ea',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ fontSize: 34, letterSpacing: 10, color: '#2aa8ff', display: 'flex' }}>{opts.kicker}</div>
        <div
          style={{
            fontSize: 132,
            fontWeight: 900,
            letterSpacing: 6,
            color: '#ffb22e',
            textShadow: '0 8px 0 #0a3a8a',
            display: 'flex',
          }}
        >
          ANILLION
        </div>
        <div style={{ fontSize: 56, fontWeight: 800, color: accent, marginTop: 8, display: 'flex' }}>{opts.headline}</div>
        {opts.score !== undefined && (
          <div style={{ fontSize: 96, fontWeight: 900, color: '#ffd23f', marginTop: 4, display: 'flex' }}>
            {opts.score} pts
          </div>
        )}
      </div>
    ),
    OG_SIZE,
  );
}
