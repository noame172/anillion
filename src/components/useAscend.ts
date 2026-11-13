'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { formPath, type Form } from '@/lib/game/forms';

/** Time between forms. Base → Ultra is three steps, so the whole climb takes about a second. */
export const ASCEND_STEP_MS = 300;

/**
 * Drives the hero's transformation: from Base Form up through every form in
 * between to the target, quickly. `ascend` restarts from base each time.
 */
export function useAscend() {
  const [form, setForm] = useState<Form>('base');
  const [burst, setBurst] = useState(false);
  /** Set briefly when the hero arrives at a form above base. */
  const [arrived, setArrived] = useState<Form | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clear = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }, []);

  const reset = useCallback(() => {
    clear();
    setForm('base');
    setBurst(false);
    setArrived(null);
  }, [clear]);

  const ascend = useCallback(
    (target: Form, onArrive?: () => void) => {
      reset();
      const path = formPath(target);
      if (path.length === 1) {
        onArrive?.();
        return;
      }
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const step = reduced ? 0 : ASCEND_STEP_MS;
      const total = step * (path.length - 1);
      setBurst(true);
      path.slice(1).forEach((f, i) => timers.current.push(setTimeout(() => setForm(f), step * (i + 1))));
      timers.current.push(
        setTimeout(() => {
          setArrived(target);
          onArrive?.();
        }, total),
        setTimeout(() => {
          setArrived(null);
          setBurst(false);
        }, total + 1600),
      );
    },
    [reset],
  );

  useEffect(() => clear, [clear]);

  return { form, burst, arrived, ascend, reset };
}
