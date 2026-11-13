'use client';

import { useEffect, useState } from 'react';

function format(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

/** Time until the next daily game. The target comes from the server; this only ticks the display. */
export function Countdown({ to }: { to: string }) {
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    const target = new Date(to).getTime();
    const tick = () => setLeft(target - Date.now());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [to]);
  if (left === null) return <span>--:--:--</span>;
  return <span>{left <= 0 ? 'Ready now — refresh!' : format(left)}</span>;
}
