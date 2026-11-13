import { FORM_LABELS, type Progress } from '@/lib/game/forms';

export function PowerBar({ progress }: { progress: Progress }) {
  const label = progress.next
    ? `${progress.pointsToNext} pts to ${FORM_LABELS[progress.next]}`
    : 'Maximum power reached';
  return (
    <div className="powerbar">
      <div
        className="track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress.pct}
        aria-label={label}
      >
        <div className="fill" style={{ width: `${progress.pct}%` }} />
      </div>
      <div className="cap">{label}</div>
    </div>
  );
}
