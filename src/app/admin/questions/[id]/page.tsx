'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { adminCall, useAdmin } from '@/components/admin/useAdmin';
import { TIER_LABELS, TIER_POINTS, TIERS, type Tier } from '@/lib/game/tiers';

export default function AdminQuestionPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data, error, reload } = useAdmin(`questions/${id}`);
  const [form, setForm] = useState({ text: '', category: '', description: '', active: false });
  const [msg, setMsg] = useState('');
  const [newAnswer, setNewAnswer] = useState({ canonical: '', aliases: '', provisionalTier: 'ultra' as Tier });
  const [tryText, setTryText] = useState('');

  useEffect(() => {
    if (data) {
      const q = data.question;
      setForm({ text: q.text, category: q.category, description: q.description ?? '', active: q.active });
    }
  }, [data]);

  async function run(path: string, method: 'POST' | 'PATCH' | 'DELETE', body?: unknown, ok = 'Saved.') {
    const res = await adminCall(path, method, body);
    setMsg(res.error || ok);
    if (!res.error) await reload();
    return res;
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    await run(`questions/${id}`, 'PATCH', form);
  }

  async function addAnswer(e: FormEvent) {
    e.preventDefault();
    const res = await run(`questions/${id}/answers`, 'POST', {
      canonical: newAnswer.canonical,
      provisionalTier: newAnswer.provisionalTier,
      verified: true,
      aliases: newAnswer.aliases.split(',').map((s) => s.trim()).filter(Boolean),
    }, 'Answer added.');
    if (!res.error) setNewAnswer({ canonical: '', aliases: '', provisionalTier: newAnswer.provisionalTier });
  }

  async function remove() {
    if (!confirm('Remove this question? If it has been used in a game it will be deactivated instead.')) return;
    const res = await adminCall(`questions/${id}`, 'DELETE');
    if (res.error) setMsg(res.error);
    else router.push('/admin/questions');
  }

  if (error) return <p className="error" role="alert">{error}</p>;
  if (!data) return <div className="loading"><div className="spinner" /></div>;

  // Local preview of what a player would get for a typed answer (same normalisation rules, display only).
  const norm = (s: string) => s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const tried = norm(tryText);
  const hit = tried
    ? data.answers.find((a: any) => a.verified && (norm(a.canonical) === tried || a.aliases.some((al: any) => norm(al.alias) === tried)))
    : null;

  return (
    <div className="stack">
      <p><Link href="/admin/questions">← All questions</Link></p>
      <h1>Edit question</h1>
      <p className="hint" role="status" aria-live="polite">{msg}</p>

      <section className="card">
        <form onSubmit={save}>
          <div className="field">
            <label htmlFor="e-text">Question text</label>
            <input id="e-text" className="input" value={form.text} onChange={(e) => setForm({ ...form, text: e.target.value })} required minLength={5} maxLength={200} />
          </div>
          <div className="row">
            <div className="field" style={{ flex: 1, minWidth: 160 }}>
              <label htmlFor="e-cat">Category</label>
              <input id="e-cat" className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} maxLength={60} />
            </div>
            <div className="field" style={{ flex: 2, minWidth: 220 }}>
              <label htmlFor="e-desc">Notes / context (admin only)</label>
              <input id="e-desc" className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} maxLength={500} />
            </div>
          </div>
          <label className="row" style={{ marginBottom: 12 }}>
            <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
            Active (can be used in daily games)
          </label>
          <div className="row">
            <button type="submit" className="btn small">Save question</button>
            <button type="button" className="btn danger small" onClick={remove}>Remove</button>
            <span className="tag">source: {data.question.source}</span>
          </div>
        </form>
      </section>

      <section className="card">
        <h2>Preview</h2>
        <div className="qcard" style={{ minHeight: 0, boxShadow: 'none' }}>
          <div className="eyebrow">PROMPT · {form.category.toUpperCase()}</div>
          <div className="qtext" style={{ fontSize: 24 }}>{form.text}</div>
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <label htmlFor="try" className="sr-only">Try an answer</label>
          <input id="try" className="input" style={{ maxWidth: 280 }} value={tryText} onChange={(e) => setTryText(e.target.value)} placeholder="Try an answer…" />
          {tried && (hit ? (
            <span className="tag ok">Accepted as {hit.canonical} · {hit.liveTier ? `${TIER_LABELS[hit.liveTier as Tier]} (${TIER_POINTS[hit.liveTier as Tier]})` : ''}</span>
          ) : (
            <span className="tag warn">Not recognised</span>
          ))}
        </div>
      </section>

      <section className="card">
        <h2>Answers &amp; rarity</h2>
        <p className="hint">
          {data.totalSubmissions} valid submissions so far.{' '}
          {data.usingPlayerData
            ? 'Rarity now comes from real player data.'
            : `Below the minimum sample of ${data.minSample}: games use the provisional tiers you set here.`}{' '}
          “Live tier” is what a game frozen right now would pay.
        </p>

        <form onSubmit={addAnswer} className="row" style={{ alignItems: 'end', margin: '12px 0' }}>
          <div className="field" style={{ flex: 2, minWidth: 160, marginBottom: 0 }}>
            <label htmlFor="a-name">New answer</label>
            <input id="a-name" className="input" value={newAnswer.canonical} onChange={(e) => setNewAnswer({ ...newAnswer, canonical: e.target.value })} required maxLength={80} />
          </div>
          <div className="field" style={{ flex: 3, minWidth: 180, marginBottom: 0 }}>
            <label htmlFor="a-aliases">Aliases (comma separated)</label>
            <input id="a-aliases" className="input" value={newAnswer.aliases} onChange={(e) => setNewAnswer({ ...newAnswer, aliases: e.target.value })} />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="a-tier">Provisional tier</label>
            <select id="a-tier" className="input" value={newAnswer.provisionalTier} onChange={(e) => setNewAnswer({ ...newAnswer, provisionalTier: e.target.value as Tier })}>
              {TIERS.map((t) => <option key={t} value={t}>{TIER_LABELS[t]} ({TIER_POINTS[t]})</option>)}
            </select>
          </div>
          <button type="submit" className="btn small">Add verified answer</button>
        </form>

        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Answer</th><th>Aliases</th><th>Status</th><th>Provisional tier</th>
                <th className="num">Count</th><th className="num">Share</th><th>Live tier</th><th></th>
              </tr>
            </thead>
            <tbody>
              {data.answers.map((a: any) => (
                <AnswerRow key={a.id} a={a} run={run} />
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2>Rarity over time</h2>
        {data.history.length === 0 ? (
          <p className="muted">This question has not appeared in a game yet.</p>
        ) : (
          <RarityHistory history={data.history} answers={data.answers} />
        )}
      </section>
    </div>
  );
}

function AnswerRow({ a, run }: { a: any; run: (path: string, method: 'POST' | 'PATCH' | 'DELETE', body?: unknown, ok?: string) => Promise<any> }) {
  const [alias, setAlias] = useState('');
  return (
    <tr>
      <td>
        <strong>{a.canonical}</strong>
        {a.externalRef && <div className="hint">{a.externalRef}</div>}
      </td>
      <td>
        {a.aliases.map((al: any) => (
          <span className="alias" key={al.id}>
            {al.alias}
            <button type="button" aria-label={`Remove alias ${al.alias}`} onClick={() => run(`aliases/${al.id}`, 'DELETE', {}, 'Alias removed.')}>×</button>
          </span>
        ))}
        <form
          style={{ display: 'inline-flex', gap: 4 }}
          onSubmit={async (e) => {
            e.preventDefault();
            const res = await run(`answers/${a.id}/aliases`, 'POST', { alias }, 'Alias added.');
            if (!res.error) setAlias('');
          }}
        >
          <input className="input" style={{ width: 110, padding: '3px 8px', fontSize: 12 }} value={alias} onChange={(e) => setAlias(e.target.value)} placeholder="+ alias" aria-label={`Add alias for ${a.canonical}`} maxLength={80} />
        </form>
      </td>
      <td>
        <button type="button" className={`tag ${a.verified ? 'ok' : 'warn'}`} style={{ cursor: 'pointer', background: 'none' }} onClick={() => run(`answers/${a.id}`, 'PATCH', { verified: !a.verified }, a.verified ? 'Marked unverified.' : 'Verified.')}>
          {a.verified ? 'verified' : 'verify'}
        </button>
      </td>
      <td>
        <select className="input" style={{ padding: '3px 6px', fontSize: 12, width: 'auto' }} value={a.provisionalTier} aria-label={`Provisional tier for ${a.canonical}`} onChange={(e) => run(`answers/${a.id}`, 'PATCH', { provisionalTier: e.target.value }, 'Tier updated.')}>
          {TIERS.map((t) => <option key={t} value={t}>{TIER_LABELS[t]}</option>)}
        </select>
      </td>
      <td className="num">{a.count}</td>
      <td className="num">{a.share === null ? '—' : `${a.share}%`}</td>
      <td>
        {a.liveTier ? <span className={`tier-${a.liveTier}`}>{TIER_LABELS[a.liveTier as Tier]}{a.liveProvisional ? ' (prov.)' : ''}</span> : '—'}
      </td>
      <td>
        <button type="button" className="btn ghost small" onClick={() => confirm(`Delete "${a.canonical}"?`) && run(`answers/${a.id}`, 'DELETE', {}, 'Answer deleted.')}>Delete</button>
      </td>
    </tr>
  );
}

function RarityHistory({ history, answers }: { history: any[]; answers: any[] }) {
  const dates = [...new Set(history.map((h) => h.date))].slice(0, 8);
  const name = new Map(answers.map((a) => [a.id, a.canonical]));
  const ids = [...new Set(history.map((h) => h.answer_id))].filter((id) => name.has(id)).slice(0, 40);
  const cell = (id: string, date: string) => history.find((h) => h.answer_id === id && h.date === date);
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr><th>Answer</th>{dates.map((d) => <th key={d} className="num">{d}</th>)}</tr>
        </thead>
        <tbody>
          {ids.map((id) => (
            <tr key={id}>
              <td>{name.get(id)}</td>
              {dates.map((d) => {
                const c = cell(id, d);
                return (
                  <td key={d} className="num">
                    {c ? <span className={`tier-${c.tier}`}>{c.share === null ? 'prov.' : `${c.share}%`} · {TIER_POINTS[c.tier as Tier]}</span> : '—'}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
