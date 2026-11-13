'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { adminCall, useAdmin } from '@/components/admin/useAdmin';

export default function AdminToolsPage() {
  const { data: status } = useAdmin('status');
  const { data: questions } = useAdmin('questions?q=');

  const [questionId, setQuestionId] = useState('');
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<'characters' | 'studios'>('characters');
  const [importMsg, setImportMsg] = useState('');
  const [importing, setImporting] = useState(false);

  const [topic, setTopic] = useState('');
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [aiMsg, setAiMsg] = useState('');
  const [thinking, setThinking] = useState(false);

  async function runImport(e: FormEvent) {
    e.preventDefault();
    setImporting(true);
    setImportMsg('');
    const res = await adminCall('import/anilist', 'POST', { questionId, title, kind });
    setImportMsg(
      res.error ||
        `Found ${res.data.found} ${kind} for “${res.data.title}”: ${res.data.added} added as unverified, ${res.data.skipped} already present.`,
    );
    setImporting(false);
  }

  async function suggest(e: FormEvent) {
    e.preventDefault();
    setThinking(true);
    setAiMsg('');
    const res = await adminCall('ai/suggest', 'POST', { topic });
    if (res.error) setAiMsg(res.error);
    else setSuggestions(res.data.suggestions);
    setThinking(false);
  }

  async function saveDraft(s: any, i: number) {
    const res = await adminCall('ai/save', 'POST', s);
    if (res.error) setAiMsg(res.error);
    else {
      setSuggestions(suggestions.map((x, j) => (j === i ? { ...x, savedId: res.data.id } : x)));
      setAiMsg('Saved as an inactive draft with unverified answers.');
    }
  }

  return (
    <div className="stack">
      <h1>Import &amp; AI</h1>

      <section className="card">
        <h2>Import from AniList</h2>
        <p className="hint">
          Pulls character or studio names for one anime from the public AniList database and stores them as
          <strong> unverified</strong> answers on a question. Review and verify them on the question page before they
          count. Players never trigger AniList requests.
        </p>
        <form onSubmit={runImport} className="row" style={{ alignItems: 'end' }}>
          <div className="field" style={{ flex: 2, minWidth: 220, marginBottom: 0 }}>
            <label htmlFor="i-q">Question</label>
            <select id="i-q" className="input" value={questionId} onChange={(e) => setQuestionId(e.target.value)} required>
              <option value="">Choose…</option>
              {questions?.questions.map((q: any) => <option key={q.id} value={q.id}>{q.text}</option>)}
            </select>
          </div>
          <div className="field" style={{ flex: 1, minWidth: 160, marginBottom: 0 }}>
            <label htmlFor="i-title">Anime title</label>
            <input id="i-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={100} />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="i-kind">Import</label>
            <select id="i-kind" className="input" value={kind} onChange={(e) => setKind(e.target.value as any)}>
              <option value="characters">Characters</option>
              <option value="studios">Studios</option>
            </select>
          </div>
          <button type="submit" className="btn small" disabled={importing}>{importing ? 'Importing…' : 'Import'}</button>
        </form>
        <p className="hint" role="status" aria-live="polite">{importMsg}</p>
        {importMsg && questionId && <Link href={`/admin/questions/${questionId}`}>Review the question →</Link>}
      </section>

      <section className="card">
        <h2>AI question ideas</h2>
        {status && !status.aiEnabled ? (
          <p className="notice">
            Not configured. Set <code>OPENAI_API_KEY</code> on the server to enable this. Everything else works without it.
          </p>
        ) : (
          <>
            <p className="hint">
              Drafts questions, candidate answers and aliases for you to check. Suggestions are saved inactive with
              every answer unverified: nothing reaches players until you review it. The AI never sets rarity or
              scores, and is never called during play. A daily request cap applies.
            </p>
            <form onSubmit={suggest} className="row" style={{ alignItems: 'end' }}>
              <div className="field" style={{ flex: 1, minWidth: 220, marginBottom: 0 }}>
                <label htmlFor="ai-topic">Topic</label>
                <input id="ai-topic" className="input" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. sports anime, 90s mecha" required maxLength={120} />
              </div>
              <button type="submit" className="btn small" disabled={thinking}>{thinking ? 'Thinking…' : 'Suggest'}</button>
            </form>
            <p className="hint" role="status" aria-live="polite">{aiMsg}</p>
            {suggestions.map((s, i) => (
              <div key={i} className="notice">
                <strong>{s.text}</strong> <span className="tag">{s.category}</span>
                {s.ambiguity && <p className="hint" style={{ margin: '6px 0' }}>⚠ Possible ambiguity: {s.ambiguity}</p>}
                {s.sources?.length > 0 && <p className="hint" style={{ margin: '6px 0' }}>Check against: {s.sources.join('; ')}</p>}
                <p style={{ margin: '6px 0', fontSize: 13 }}>
                  {s.answers.length} candidate answers: {s.answers.slice(0, 25).map((a: any) => a.canonical).join(', ')}
                  {s.answers.length > 25 && '…'}
                </p>
                {s.savedId ? (
                  <Link href={`/admin/questions/${s.savedId}`}>Review draft →</Link>
                ) : (
                  <button type="button" className="btn ghost small" onClick={() => saveDraft(s, i)}>Save as draft for review</button>
                )}
              </div>
            ))}
          </>
        )}
      </section>
    </div>
  );
}
