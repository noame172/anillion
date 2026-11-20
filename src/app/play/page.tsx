'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { Hero } from '@/components/Hero';
import { useAscend } from '@/components/useAscend';
import { ApiError, apiFetch } from '@/lib/client/api';
import { FORM_LABELS, FORMS, formForTier } from '@/lib/game/forms';
import type { AnsweredRow, GameState, PassResult, SubmitResult } from '@/lib/game/session';
import { TIER_LABELS } from '@/lib/game/tiers';

type Reveal = { kind: 'accepted' | 'timeout' | 'pass'; row: AnsweredRow | null };

// The server allows a short grace after the buzzer; wait it out before asking for the verdict.
const TIMEOUT_SETTLE_MS = 1700;

function shareLine(row: AnsweredRow) {
  if (row.share === null) return 'New answer — rarity is provisional until more players have answered.';
  if (row.share === 0) return 'No one had given this answer before today.';
  return `${row.share < 0.1 ? '<0.1' : row.share}% of players gave this answer.`;
}

// React Strict Mode runs effects twice in development. Two parallel starts from a browser with no
// cookie would mint two guest ids, so concurrent callers share one in-flight request.
let startInFlight: Promise<GameState> | null = null;
function startGame(): Promise<GameState> {
  startInFlight ??= apiFetch<GameState>('/api/game/start', { method: 'POST', body: {} }).finally(() => {
    startInFlight = null;
  });
  return startInFlight;
}

export default function PlayPage() {
  const router = useRouter();
  const [state, setState] = useState<GameState | null>(null);
  const [reveal, setReveal] = useState<Reveal | null>(null);
  const [fatal, setFatal] = useState('');
  const [text, setText] = useState('');
  const [feedback, setFeedback] = useState('');
  // "Did you mean": what the player typed and the accepted answer it is close to.
  const [suggest, setSuggest] = useState<{ typed: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  // State updates are asynchronous, so a double Enter or click could pass the `busy` check twice.
  const sending = useRef(false);
  const [shake, setShake] = useState(false);
  const [leftMs, setLeftMs] = useState(0);
  const [timeUp, setTimeUp] = useState(false);
  // Passing needs a second tap, so a stray tap cannot throw a prompt away.
  const [confirmPass, setConfirmPass] = useState(false);

  // The hero shows the rarity of the answer just given, then drops back to base.
  const hero = useAscend();
  const flash = hero.arrived;

  const deadline = useRef<number | null>(null);
  // Bumped on every fresh state, so a buzzer check started for an older state gives up.
  const epoch = useRef(0);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  /** Take a fresh state from the server as the single source of truth. */
  const apply = useCallback((next: GameState) => {
    epoch.current++;
    if (settleTimer.current) clearTimeout(settleTimer.current);
    deadline.current = next.current ? performance.now() + next.current.timeLeftMs : null;
    setLeftMs(next.current?.timeLeftMs ?? 0);
    setTimeUp(false);
    setConfirmPass(false);
    setState(next);
  }, []);

  // Power up: start (or resume) today's session.
  useEffect(() => {
    let alive = true;
    startGame()
      .then((s) => {
        if (!alive) return;
        if (s.completed) router.replace('/results');
        else apply(s);
      })
      .catch((e: ApiError) => alive && setFatal(e.message));
    // Warm the cache so a transformation never waits on an image.
    for (const f of FORMS) new Image().src = `/hero/${f}/hero.svg`;
    return () => {
      alive = false;
      // eslint-disable-next-line react-hooks/exhaustive-deps -- a counter, not a DOM node
      epoch.current++;
      if (settleTimer.current) clearTimeout(settleTimer.current);
    };
  }, [apply, router]);

  const live = state?.phase === 'question' && !reveal;

  /** After the buzzer: ask the server what happened and show it. */
  const settleTimeout = useCallback(async (started: number) => {
    // An answer accepted right at the buzzer has already moved the game on: nothing to settle.
    const stale = () => epoch.current !== started;
    for (let attempt = 0; attempt < 6; attempt++) {
      if (stale()) return;
      try {
        const today = await apiFetch<{ state: GameState | null }>('/api/game/today');
        if (stale()) return;
        const s = today.state;
        if (!s) break;
        if (s.phase !== 'question') {
          apply(s);
          setReveal({ kind: 'timeout', row: s.answers[s.answers.length - 1] ?? null });
          setText('');
          setFeedback('');
          return;
        }
      } catch {
        // Retry below.
      }
      await new Promise((r) => setTimeout(r, 600));
    }
    if (stale()) return;
    setFatal('Lost contact with the server. Refresh the page to continue.');
  }, [apply]);

  // Countdown. Display only: the server decides when time is really up.
  useEffect(() => {
    if (!live || timeUp) return;
    const id = setInterval(() => {
      const left = (deadline.current ?? 0) - performance.now();
      setLeftMs(Math.max(0, left));
      if (left <= 0) {
        clearInterval(id);
        setTimeUp(true);
        const started = epoch.current;
        settleTimer.current = setTimeout(() => settleTimeout(started), TIMEOUT_SETTLE_MS);
      }
    }, 100);
    return () => clearInterval(id);
  }, [live, timeUp, settleTimeout, state?.position]);

  useEffect(() => {
    if (live) inputRef.current?.focus();
    else if (reveal) nextRef.current?.focus();
  }, [live, reveal]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    let answer = text.trim();
    if (!answer || sending.current || !state?.current || timeUp) return;
    sending.current = true;
    // Enter on a pending suggestion takes it: the bar changes to the suggested name and that is sent.
    if (suggest && suggest.typed === answer) {
      answer = suggest.name;
      setText(answer);
    }
    setSuggest(null);
    setBusy(true);
    setFeedback('');
    try {
      const res = await apiFetch<SubmitResult>('/api/game/answer', {
        body: { questionId: state.current.id, text: answer },
      });
      if (res.status === 'accepted') {
        apply(res.state);
        setReveal({ kind: 'accepted', row: res.result });
        hero.ascend(formForTier(res.result.tier));
        setText('');
      } else if (res.status === 'suggestion') {
        deadline.current = performance.now() + res.timeLeftMs;
        setSuggest({ typed: answer, name: res.suggestion });
        inputRef.current?.focus();
      } else if (res.status === 'unrecognised') {
        deadline.current = performance.now() + res.timeLeftMs;
        setFeedback('Try another!');
        setShake(true);
        setTimeout(() => setShake(false), 400);
        inputRef.current?.select();
      } else {
        apply(res.state);
        setReveal({ kind: 'timeout', row: res.state.answers[res.state.answers.length - 1] ?? null });
        setText('');
      }
    } catch (err) {
      const e2 = err as ApiError;
      if (e2.code === 'RATE_LIMITED' || e2.code === 'NETWORK' || e2.code === 'INVALID_INPUT') setFeedback(e2.message);
      else if (e2.code === 'GAME_ENDED' || e2.code === 'NO_GAME') setFatal(e2.message);
      else {
        // Out of step with the server (another tab, a double submit): resync.
        const today = await apiFetch<{ state: GameState | null }>('/api/game/today').catch(() => null);
        if (today?.state) {
          if (today.state.completed) router.replace('/results');
          else apply(today.state);
        } else setFeedback(e2.message);
      }
    } finally {
      setBusy(false);
      sending.current = false;
    }
  }

  /** Skip this prompt: it scores 0, like running out of time, but without waiting for the timer. */
  async function pass() {
    if (!state?.current || sending.current || timeUp) return;
    if (!confirmPass) {
      setConfirmPass(true);
      setTimeout(() => setConfirmPass(false), 4000);
      return;
    }
    sending.current = true;
    setConfirmPass(false);
    setSuggest(null);
    setBusy(true);
    setFeedback('');
    try {
      const res = await apiFetch<PassResult>('/api/game/pass', { body: { questionId: state.current.id } });
      apply(res.state);
      setReveal({ kind: res.status === 'passed' ? 'pass' : 'timeout', row: res.state.answers[res.state.answers.length - 1] ?? null });
      setText('');
    } catch (err) {
      const e2 = err as ApiError;
      if (e2.code === 'RATE_LIMITED' || e2.code === 'NETWORK') setFeedback(e2.message);
      else if (e2.code === 'GAME_ENDED' || e2.code === 'NO_GAME') setFatal(e2.message);
      else {
        // Out of step with the server (another tab, a double tap): resync.
        const today = await apiFetch<{ state: GameState | null }>('/api/game/today').catch(() => null);
        if (today?.state) {
          if (today.state.completed) router.replace('/results');
          else apply(today.state);
        } else setFeedback(e2.message);
      }
    } finally {
      setBusy(false);
      sending.current = false;
    }
  }

  async function next() {
    if (!state || sending.current) return;
    sending.current = true;
    if (state.completed) {
      router.push('/results');
      return;
    }
    setBusy(true);
    try {
      const s = await apiFetch<GameState>('/api/game/next', { method: 'POST', body: {} });
      hero.reset();
      setReveal(null);
      setSuggest(null);
      setFeedback('');
      apply(s);
    } catch (err) {
      setFatal((err as ApiError).message);
    } finally {
      setBusy(false);
      sending.current = false;
    }
  }

  if (fatal) {
    return (
      <div className="narrow card center stack">
        <h1>Hold up</h1>
        <p role="alert">{fatal}</p>
        <Link href="/" className="btn">
          Back home
        </Link>
      </div>
    );
  }
  if (!state) {
    return (
      <div className="loading" role="status">
        <div>
          <div className="spinner" />
          Charging up…
        </div>
      </div>
    );
  }

  const limitMs = (state.current?.limitSec ?? 30) * 1000;
  const seconds = Math.ceil(leftMs / 1000);
  const pct = Math.max(0, Math.min(100, (leftMs / limitMs) * 100));
  const promptNo = Math.min(state.position + 1, state.total);
  const row = reveal?.row ?? null;

  return (
    <div>
      {flash && (
        <div className="transform-flash" data-form={flash} style={{ '--aura': 'rgba(255,220,120,0.9)' } as CSSProperties} aria-hidden="true">
          <div className="word">{FORM_LABELS[flash]}!</div>
        </div>
      )}

      <div className="hud">
        <div className="hud-box">
          <div className="k">FORM</div>
          <div className="v">{FORM_LABELS[hero.form]}</div>
        </div>
        <div className="hud-mid">
          <div className="pips" aria-hidden="true">
            {Array.from({ length: state.total }, (_, i) => {
              const a = state.answers.find((x) => x.position === i);
              const cls = a ? (a.tier ?? 'miss') : i === state.position && state.phase === 'question' ? 'now' : '';
              return <span key={i} className={`pip ${cls}`} />;
            })}
          </div>
          <div className="pips-label">
            {state.completed ? 'COMPLETE' : `PROMPT ${reveal ? state.position : promptNo} OF ${state.total}`}
          </div>
        </div>
        <div className="hud-box score">
          <div className="k">SCORE</div>
          <div className="v" aria-live="polite">
            {state.score}
          </div>
        </div>
      </div>

      <div className="arena">
        <div className="stage">
          <Hero form={hero.form} burst={hero.burst} />
          <div className="form-name display" data-form={hero.form}>
            {FORM_LABELS[hero.form]}
          </div>
        </div>

        <div>
          <div aria-live="assertive" className="sr-only">
            {flash ? `Transformed into ${FORM_LABELS[flash]}!` : ''}
          </div>

          {reveal ? (
            <section className="qcard reveal" aria-live="polite">
              {reveal.kind === 'accepted' && row ? (
                <>
                  <span className={`tier-badge tier-${row.tier}`}>{row.tier ? TIER_LABELS[row.tier] : ''}</span>
                  <div className="answer">{row.answer}</div>
                  <div className="points">+{row.points}</div>
                  <div className="qhint">{shareLine(row)}</div>
                </>
              ) : (
                <>
                  <span className="tier-badge tier-miss">{reveal.kind === 'pass' ? 'PASSED' : 'TIME’S UP'}</span>
                  <div className="answer">{reveal.kind === 'pass' ? 'You passed' : 'No valid answer'}</div>
                  <div className="points">+0</div>
                  <div className="qhint">{row?.question}</div>
                </>
              )}
              <button ref={nextRef} type="button" className="btn" onClick={next} disabled={busy}>
                {state.completed ? 'See results' : '⚡ Power Up'}
              </button>
            </section>
          ) : state.phase === 'between' ? (
            <section className="qcard reveal">
              <div className="eyebrow">READY?</div>
              <div className="qtext">
                Prompt {promptNo} of {state.total}
              </div>
              <div className="qhint">The {limitMs / 1000}-second timer starts when you continue.</div>
              <button ref={nextRef} type="button" className="btn" onClick={next} disabled={busy}>
                ⚡ Power Up
              </button>
            </section>
          ) : (
            <>
              <section className="qcard">
                <div className="eyebrow">
                  PROMPT {promptNo} OF {state.total} · {state.current?.category?.toUpperCase()}
                </div>
                <h1 className="qtext" id="question-text">
                  {state.current?.text}
                </h1>
                <div className="qhint">Rarer answers charge higher. Wrong guesses cost nothing.</div>
              </section>

              <div className="suggest" role="status" aria-live="polite">
                {suggest && !timeUp && (
                  <button type="button" className="suggest-chip" onClick={() => formRef.current?.requestSubmit()}>
                    <span className="typed">{suggest.typed}</span>
                    <span className="arrow" aria-hidden="true">→</span>
                    <span className="sr-only">Did you mean</span>
                    <strong>{suggest.name}</strong>
                    <span className="key">Enter ↵</span>
                  </button>
                )}
              </div>

              <form className="answer-bar" onSubmit={submit} ref={formRef}>
                <div
                  className={`timer${seconds <= 5 ? ' low' : ''}`}
                  style={{ '--pct': pct } as CSSProperties}
                  role="timer"
                  aria-label={`${seconds} seconds left`}
                >
                  <span>{seconds}</span>
                </div>
                <div>
                  <label htmlFor="answer" className="sr-only">
                    Your answer
                  </label>
                  <input
                    id="answer"
                    ref={inputRef}
                    className={`input answer-input${shake ? ' shake' : ''}`}
                    value={text}
                    onChange={(e) => {
                      setText(e.target.value);
                      if (suggest && e.target.value.trim() !== suggest.typed) setSuggest(null);
                    }}
                    placeholder="Type one answer…"
                    maxLength={80}
                    autoComplete="off"
                    autoCapitalize="words"
                    autoCorrect="off"
                    spellCheck={false}
                    enterKeyHint="send"
                    aria-describedby="question-text answer-feedback"
                    disabled={timeUp}
                  />
                </div>
                <button type="submit" className="btn" disabled={busy || timeUp || !text.trim()}>
                  {busy ? '…' : 'FIRE'}
                </button>
              </form>
              <div id="answer-feedback" className="feedback error" role="status" aria-live="polite">
                {timeUp ? 'Time’s up!' : feedback}
              </div>
              <div className="pass-row">
                <button
                  type="button"
                  className={`btn ghost pass-btn${confirmPass ? ' confirm' : ''}`}
                  onClick={pass}
                  disabled={busy || timeUp}
                  aria-describedby="pass-hint"
                >
                  {confirmPass ? 'Tap again to pass (+0)' : 'Pass'}
                </button>
                <span id="pass-hint" className="hint">
                  Don&apos;t know this one? Skip it for 0 points. It&apos;s the same as running out of time, without the wait.
                </span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
