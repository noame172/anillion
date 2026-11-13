'use client';

import { useAdmin } from '@/components/admin/useAdmin';

const show = (v: unknown, suffix = '') => (v === null || v === undefined ? '—' : `${v}${suffix}`);

export default function AdminAnalyticsPage() {
  const { data: a, error } = useAdmin('analytics');
  const { data: status } = useAdmin('status');

  if (error) return <p className="error" role="alert">{error}</p>;
  if (!a) return <div className="loading"><div className="spinner" /></div>;

  const stats: [string, string][] = [
    ['Registered users', show(a.totals.users)],
    ['Daily active players', show(a.dau)],
    ['Monthly active players', show(a.mau)],
    ['Games started', show(a.totals.gamesStarted)],
    ['Games completed', show(a.totals.gamesCompleted)],
    ['Completion rate', show(a.totals.completionRate, '%')],
    ['Average score', show(a.totals.averageScore)],
    ['Next-day retention', show(a.retention.rate, '%')],
  ];

  return (
    <div className="stack">
      <h1>Analytics</h1>
      {status && (
        <p className="hint">
          Game day: {status.today} · Mode: <span className="tag">{status.mode}</span>{' '}
          {status.mode === 'dev-local' && 'Running on the embedded development database.'}
        </p>
      )}
      <div className="stat-grid">
        {stats.map(([k, v]) => (
          <div className="stat" key={k}>
            <div className="k">{k}</div>
            <div className="v">{v}</div>
          </div>
        ))}
      </div>
      <p className="hint">
        Active players count accounts and guest devices that started a game. Retention: of {a.retention.playedYesterday}{' '}
        players yesterday, {a.retention.returnedToday} came back today.
      </p>

      <section className="card">
        <h2>Last 14 days</h2>
        {a.daily.length === 0 ? (
          <p className="muted">No games played yet.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Date</th><th className="num">Started</th><th className="num">Completed</th><th className="num">Avg score</th></tr>
              </thead>
              <tbody>
                {a.daily.map((d: any) => (
                  <tr key={d.date}>
                    <td>{d.date}</td><td className="num">{d.started}</td><td className="num">{d.completed}</td><td className="num">{show(d.avg_score)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="grid-2">
        <RankList title="Most answered questions" rows={a.topQuestions.map((q: any) => [q.text, q.submissions])} />
        <RankList title="Most popular answers" rows={a.topAnswers.map((x: any) => [`${x.canonical} — ${x.question}`, x.count])} />
        <RankList title="Rarest answers given" rows={a.rarestAnswers.map((x: any) => [`${x.canonical} — ${x.question}`, x.count])} />
        <RankList title="Streaks (accounts)" rows={a.streaks.map((s: any) => [`${s.bucket} days`, s.users])} />
      </div>
    </div>
  );
}

function RankList({ title, rows }: { title: string; rows: [string, number][] }) {
  return (
    <section className="card">
      <h2>{title}</h2>
      {rows.length === 0 ? (
        <p className="muted">No data yet.</p>
      ) : (
        <table className="table">
          <tbody>
            {rows.map(([label, n], i) => (
              <tr key={i}><td>{label}</td><td className="num">{n}</td></tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
