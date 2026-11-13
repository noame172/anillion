'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { adminCall, useAdmin } from '@/components/admin/useAdmin';

export default function AdminQuestionsPage() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');
  const { data, error } = useAdmin(`questions?q=${encodeURIComponent(applied)}`);
  const [text, setText] = useState('');
  const [category, setCategory] = useState('');
  const [formError, setFormError] = useState('');

  async function create(e: FormEvent) {
    e.preventDefault();
    const res = await adminCall('questions', 'POST', { text, category: category || 'General', active: false });
    if (res.error) setFormError(res.error);
    else router.push(`/admin/questions/${res.data.id}`);
  }

  return (
    <div className="stack">
      <h1>Questions</h1>

      <section className="card">
        <h2>New question</h2>
        <form onSubmit={create} className="row" style={{ alignItems: 'end' }}>
          <div className="field" style={{ flex: 3, minWidth: 220, marginBottom: 0 }}>
            <label htmlFor="q-text">Question text</label>
            <input id="q-text" className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Name a …" required minLength={5} maxLength={200} />
          </div>
          <div className="field" style={{ flex: 1, minWidth: 140, marginBottom: 0 }}>
            <label htmlFor="q-cat">Category</label>
            <input id="q-cat" className="input" value={category} onChange={(e) => setCategory(e.target.value)} maxLength={60} />
          </div>
          <button type="submit" className="btn small">Create draft</button>
        </form>
        <p className="hint">New questions start inactive. Add verified answers, then activate.</p>
        {formError && <p className="error" role="alert">{formError}</p>}
      </section>

      <section className="card">
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            setApplied(search);
          }}
        >
          <label htmlFor="q-search" className="sr-only">Search questions</label>
          <input id="q-search" className="input" style={{ maxWidth: 320 }} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search text or category" />
          <button type="submit" className="btn ghost small">Search</button>
        </form>
        {error && <p className="error" role="alert">{error}</p>}
        {!data ? (
          <div className="loading"><div className="spinner" /></div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Question</th><th>Category</th><th>Status</th>
                  <th className="num">Answers</th><th className="num">Unverified</th><th className="num">Unknown</th>
                  <th className="num">Submissions</th><th>Last used</th>
                </tr>
              </thead>
              <tbody>
                {data.questions.map((q: any) => (
                  <tr key={q.id}>
                    <td><Link href={`/admin/questions/${q.id}`}>{q.text}</Link></td>
                    <td>{q.category}</td>
                    <td><span className={`tag ${q.active ? 'ok' : 'warn'}`}>{q.active ? 'active' : 'inactive'}</span></td>
                    <td className="num">{q.answers}</td>
                    <td className="num">{q.unverified || ''}</td>
                    <td className="num">{q.unknown || ''}</td>
                    <td className="num">{q.submissions}</td>
                    <td>{q.last_used ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
