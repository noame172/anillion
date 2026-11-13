'use client';

import Link from 'next/link';
import { useState } from 'react';
import { adminCall, useAdmin } from '@/components/admin/useAdmin';
import { TIER_LABELS, TIERS, type Tier } from '@/lib/game/tiers';

export default function AdminUnknownPage() {
  const [status, setStatus] = useState<'pending' | 'approved' | 'rejected'>('pending');
  const { data, error, reload } = useAdmin(`unknown?status=${status}`);
  const [msg, setMsg] = useState('');

  async function resolve(id: string, body: unknown) {
    const res = await adminCall(`unknown/${id}`, 'POST', body);
    setMsg(res.error || 'Done.');
    if (!res.error) await reload();
  }

  return (
    <div className="stack">
      <h1>Unknown answers</h1>
      <p className="hint">
        Answers players typed that are not on the accepted list, most frequent first. Approve the real ones (as a new
        answer or as an alias of an existing one) and reject the rest. Approved answers count from the next submission.
      </p>
      <div className="tabs">
        {(['pending', 'approved', 'rejected'] as const).map((s) => (
          <button key={s} type="button" className="tab" aria-selected={status === s} onClick={() => setStatus(s)}>{s}</button>
        ))}
      </div>
      <p className="hint" role="status" aria-live="polite">{msg}</p>
      {error && <p className="error" role="alert">{error}</p>}
      <section className="card">
        {!data ? (
          <div className="loading"><div className="spinner" /></div>
        ) : data.unknown.length === 0 ? (
          <p className="muted">Nothing here.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Typed</th><th>Question</th><th className="num">Times</th><th>Review</th></tr>
              </thead>
              <tbody>
                {data.unknown.map((u: any) => (
                  <UnknownRow key={u.id} u={u} pending={status === 'pending'} resolve={resolve} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function UnknownRow({ u, pending, resolve }: { u: any; pending: boolean; resolve: (id: string, body: unknown) => void }) {
  const [canonical, setCanonical] = useState<string>(u.raw_text);
  const [tier, setTier] = useState<Tier>('ultra');
  const [aliasOf, setAliasOf] = useState('');
  const { data: question } = useAdmin(aliasOf === 'load' || aliasOf ? `questions/${u.question_id}` : null);

  return (
    <tr>
      <td><strong>{u.raw_text}</strong></td>
      <td><Link href={`/admin/questions/${u.question_id}`}>{u.question}</Link></td>
      <td className="num">{u.count}</td>
      <td>
        {pending ? (
          <div className="stack" style={{ gap: 6 }}>
            <div className="row">
              <input className="input" style={{ width: 150 }} value={canonical} onChange={(e) => setCanonical(e.target.value)} aria-label="Canonical name" maxLength={80} />
              <select className="input" style={{ width: 'auto' }} value={tier} onChange={(e) => setTier(e.target.value as Tier)} aria-label="Provisional tier">
                {TIERS.map((t) => <option key={t} value={t}>{TIER_LABELS[t]}</option>)}
              </select>
              <button type="button" className="btn small" onClick={() => resolve(u.id, { action: 'approve', canonical, tier })}>Add as answer</button>
            </div>
            <div className="row">
              <select className="input" style={{ width: 200 }} value={aliasOf} onFocus={() => !aliasOf && setAliasOf('load')} onChange={(e) => setAliasOf(e.target.value)} aria-label="Existing answer to alias">
                <option value="load">Alias of existing answer…</option>
                {question?.answers.map((a: any) => <option key={a.id} value={a.id}>{a.canonical}</option>)}
              </select>
              <button type="button" className="btn ghost small" disabled={!aliasOf || aliasOf === 'load'} onClick={() => resolve(u.id, { action: 'alias', answerId: aliasOf })}>Add as alias</button>
              <button type="button" className="btn danger small" onClick={() => resolve(u.id, { action: 'reject' })}>Reject</button>
            </div>
          </div>
        ) : (
          <span className="tag">{u.status}</span>
        )}
      </td>
    </tr>
  );
}
