'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/client/api';
import type { QuestionAnswers } from '@/lib/game/answers';
import { normalizeAnswer } from '@/lib/game/normalize';
import { TIER_LABELS } from '@/lib/game/tiers';

function share(value: number | null) {
  if (value === null) return 'new';
  return `${value > 0 && value < 0.1 ? '<0.1' : value}%`;
}

function QuestionBlock({ q, open }: { q: QuestionAnswers; open: boolean }) {
  const [search, setSearch] = useState('');
  const needle = normalizeAnswer(search);
  const shown = needle ? q.answers.filter((a) => normalizeAnswer(a.name).includes(needle)) : q.answers;
  const id = `answers-search-${q.position}`;

  return (
    <details open={open}>
      <summary>
        <span>
          {q.position + 1}. {q.question}
        </span>
        <span className="count">{q.answers.length} answers</span>
      </summary>
      <div className="body">
        <label htmlFor={id} className="sr-only">
          Search answers for: {q.question}
        </label>
        <input
          id={id}
          className="input"
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search answers…"
          maxLength={80}
          autoComplete="off"
        />
        {shown.length === 0 ? (
          <p className="muted" style={{ margin: '10px 0 0' }}>
            No answer matches “{search}”.
          </p>
        ) : (
          <ul className="answer-list">
            {shown.map((a) => (
              <li key={a.name} className={`tier-${a.tier}${a.name === q.yours ? ' mine' : ''}`}>
                <span className="name">
                  {a.name}
                  {a.name === q.yours && <span className="sr-only"> (your answer)</span>}
                </span>
                <span className="meta">
                  {TIER_LABELS[a.tier]} · {share(a.share)} · +{a.points}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}

/** Every accepted answer for a finished game, one searchable list per prompt. */
export function AllAnswers({ date }: { date: string }) {
  const [questions, setQuestions] = useState<QuestionAnswers[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let current = true;
    apiFetch<{ questions: QuestionAnswers[] }>(`/api/game/answers?date=${date}`)
      .then((r) => current && setQuestions(r.questions))
      .catch(() => current && setFailed(true));
    return () => {
      current = false;
    };
  }, [date]);

  if (failed) return null;

  return (
    <section className="card all-answers">
      <h2>All answers</h2>
      <p className="hint">
        Every accepted answer for each prompt, with how rare it was for this game. Your answer is outlined. “New”
        means there was not enough player data yet.
      </p>
      {!questions ? (
        <div className="loading">
          <div className="spinner" />
        </div>
      ) : (
        questions.map((q, i) => <QuestionBlock key={q.position} q={q} open={i === 0} />)
      )}
    </section>
  );
}
