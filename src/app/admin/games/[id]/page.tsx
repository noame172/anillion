'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { adminCall, useAdmin } from '@/components/admin/useAdmin';

type Q = { id: string; text: string; category: string; answers: number; active?: boolean };

export default function AdminGamePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data, error, reload } = useAdmin(`games/${id}`);
  const { data: all } = useAdmin('questions?q=');
  const [list, setList] = useState<Q[]>([]);
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState('');
  const [pick, setPick] = useState('');

  useEffect(() => {
    if (data) {
      setList(data.questions);
      setDirty(false);
    }
  }, [data]);

  if (error) return <p className="error" role="alert">{error}</p>;
  if (!data) return <div className="loading"><div className="spinner" /></div>;

  const game = data.game;
  const locked = game.frozen;
  const available: Q[] = (all?.questions ?? []).filter((q: any) => q.active && q.answers > 0 && !list.some((x) => x.id === q.id));

  function move(i: number, by: number) {
    const next = [...list];
    const j = i + by;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    setList(next);
    setDirty(true);
  }

  async function act(body: unknown, ok: string) {
    const res = await adminCall(`games/${id}`, 'PATCH', body);
    setMsg(res.error || ok);
    if (!res.error) await reload();
  }

  async function remove() {
    if (!confirm('Delete this game?')) return;
    const res = await adminCall(`games/${id}`, 'DELETE');
    if (res.error) setMsg(res.error);
    else router.push('/admin/games');
  }

  return (
    <div className="stack">
      <p><Link href="/admin/games">← All games</Link></p>
      <h1>Game for {game.date}</h1>
      <div className="row">
        <span className={`tag ${game.status === 'published' ? 'ok' : 'warn'}`}>{game.status === 'published' ? (locked ? 'live' : 'scheduled') : 'draft'}</span>
        <span className="hint" role="status" aria-live="polite">{msg}</span>
      </div>
      {locked && (
        <p className="notice">
          This game has gone live. Its questions and frozen rarity can no longer change, so every player is scored the
          same way.
        </p>
      )}

      <section className="card">
        <h2>Questions in order ({list.length})</h2>
        <ol style={{ paddingLeft: 20, margin: 0 }}>
          {list.map((q, i) => (
            <li key={q.id} style={{ padding: '6px 0', borderBottom: '1px solid rgba(44,58,134,.6)' }}>
              <div className="row">
                <span style={{ flex: 1, minWidth: 180 }}>
                  <Link href={`/admin/questions/${q.id}`}>{q.text}</Link>{' '}
                  <span className="hint">· {q.category} · {q.answers} answers</span>
                </span>
                {!locked && (
                  <>
                    <button type="button" className="btn ghost small" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move ${q.text} up`}>↑</button>
                    <button type="button" className="btn ghost small" onClick={() => move(i, 1)} disabled={i === list.length - 1} aria-label={`Move ${q.text} down`}>↓</button>
                    <button type="button" className="btn ghost small" onClick={() => { setList(list.filter((x) => x.id !== q.id)); setDirty(true); }} aria-label={`Remove ${q.text}`}>Remove</button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ol>

        {!locked && (
          <div className="row" style={{ marginTop: 14 }}>
            <label htmlFor="add-q" className="sr-only">Add a question</label>
            <select id="add-q" className="input" style={{ maxWidth: 420 }} value={pick} onChange={(e) => setPick(e.target.value)}>
              <option value="">Add a question…</option>
              {available.map((q) => <option key={q.id} value={q.id}>{q.category}: {q.text}</option>)}
            </select>
            <button
              type="button"
              className="btn ghost small"
              disabled={!pick}
              onClick={() => {
                const q = available.find((x) => x.id === pick);
                if (q) setList([...list, q]);
                setPick('');
                setDirty(true);
              }}
            >
              Add
            </button>
            <button type="button" className="btn small" disabled={!dirty || list.length === 0} onClick={() => act({ questionIds: list.map((q) => q.id) }, 'Question list saved.')}>
              Save list
            </button>
          </div>
        )}
      </section>

      <section className="card">
        <h2>Publication</h2>
        <div className="row">
          {game.status === 'draft' ? (
            <button type="button" className="btn small" disabled={dirty} onClick={() => act({ action: 'publish' }, 'Published. It goes live on its date.')}>Publish</button>
          ) : (
            <button type="button" className="btn ghost small" onClick={() => act({ action: 'unpublish' }, 'Moved back to draft.')}>Unpublish</button>
          )}
          <button type="button" className="btn danger small" onClick={remove}>Delete</button>
        </div>
        <p className="hint">
          A published game becomes playable when its date arrives (at the configured rollover time). Rarity is frozen
          at that moment from the statistics gathered up to then. Unpublishing and deleting are only possible before
          anyone has started the game.
        </p>
      </section>
    </div>
  );
}
