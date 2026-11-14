'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { adminCall, useAdmin } from '@/components/admin/useAdmin';
import type { Settings } from '@/lib/settings';

export default function AdminSettingsPage() {
  const { data, error } = useAdmin<{ settings: Settings }>('settings');
  const [s, setS] = useState<Settings | null>(null);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    if (data) setS(data.settings);
  }, [data]);

  if (error) return <p className="error" role="alert">{error}</p>;
  if (!s) return <div className="loading"><div className="spinner" /></div>;

  const num = (v: string) => (v === '' ? 0 : Number(v));
  const setT = (k: keyof Settings['thresholds'], v: string) => setS({ ...s, thresholds: { ...s.thresholds, [k]: num(v) } });

  async function save(e: FormEvent) {
    e.preventDefault();
    const res = await adminCall('settings', 'PATCH', s);
    setMsg(res.error || 'Saved. Applies to games that have not gone live yet.');
    if (res.data) setS(res.data.settings);
  }

  return (
    <form className="stack" onSubmit={save}>
      <h1>Rarity &amp; rules</h1>
      <p className="hint">
        Points per tier are fixed: Common 25, Rare 50, Epic 75, Ultra 100. These settings decide which tier an answer
        falls into. A game already live keeps the rules it started with.
      </p>

      <section className="card">
        <h2>Rarity thresholds</h2>
        <p className="hint">An answer&apos;s share is the percentage of valid submissions for that question.</p>
        <div className="row">
          <div className="field">
            <label htmlFor="t-common">Common: more than (%)</label>
            <input id="t-common" className="input" type="number" step="0.1" min="0" max="100" value={s.thresholds.common} onChange={(e) => setT('common', e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="t-rare">Rare: more than (%)</label>
            <input id="t-rare" className="input" type="number" step="0.1" min="0" max="100" value={s.thresholds.rare} onChange={(e) => setT('rare', e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="t-epic">Epic: more than (%)</label>
            <input id="t-epic" className="input" type="number" step="0.1" min="0" max="100" value={s.thresholds.epic} onChange={(e) => setT('epic', e.target.value)} />
          </div>
        </div>
        <p className="hint">Anything at or below the Epic threshold ({s.thresholds.epic}%) is an Ultra Answer.</p>
        <div className="field" style={{ maxWidth: 280 }}>
          <label htmlFor="min-sample">Minimum sample size</label>
          <input id="min-sample" className="input" type="number" min="1" value={s.minSample} onChange={(e) => setS({ ...s, minSample: num(e.target.value) })} />
          <span className="hint">Valid submissions a question needs before player data replaces provisional tiers.</span>
        </div>
      </section>

      <section className="card">
        <h2>Daily game</h2>
        <div className="row">
          <div className="field">
            <label htmlFor="per-game">Questions per game</label>
            <input id="per-game" className="input" type="number" min="1" max="30" value={s.questionsPerGame} onChange={(e) => setS({ ...s, questionsPerGame: num(e.target.value) })} />
          </div>
          <div className="field">
            <label htmlFor="limit">Seconds per question</label>
            <input id="limit" className="input" type="number" min="5" max="300" value={s.timeLimitSec} onChange={(e) => setS({ ...s, timeLimitSec: num(e.target.value) })} />
          </div>
          <div className="field">
            <label htmlFor="tz">Timezone (IANA)</label>
            <input id="tz" className="input" value={s.timezone} onChange={(e) => setS({ ...s, timezone: e.target.value })} placeholder="UTC, Asia/Jerusalem…" />
          </div>
          <div className="field">
            <label htmlFor="hour">Rollover hour (0-23)</label>
            <input id="hour" className="input" type="number" min="0" max="23" value={s.rolloverHour} onChange={(e) => setS({ ...s, rolloverHour: num(e.target.value) })} />
          </div>
        </div>
        <label className="row">
          <input type="checkbox" checked={s.autoGenerate} onChange={(e) => setS({ ...s, autoGenerate: e.target.checked })} />
          Build a game automatically on days with nothing scheduled
        </label>
        <p className="hint">
          Changing the timezone or rollover hour moves when the day changes for everyone. Do it between games, not
          while players are mid-game.
        </p>
      </section>

      <section className="card">
        <h2>Pre-launch mode</h2>
        <label className="row">
          <input type="checkbox" checked={s.prelaunch} onChange={(e) => setS({ ...s, prelaunch: e.target.checked })} />
          Nothing counts yet (testing only)
        </label>
        <p className="hint">
          While this is on, every question is treated as never played, so it can come up again on any day, and answers
          are not added to the rarity statistics. Switch it off when the game goes live. Games already generated keep
          the questions they have.
        </p>
      </section>

      <div className="row">
        <button type="submit" className="btn">Save settings</button>
        <span className="hint" role="status" aria-live="polite">{msg}</span>
      </div>
    </form>
  );
}
