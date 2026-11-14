#!/usr/bin/env node
/**
 * Load test: N simulated guests play today's whole game at the same time.
 *
 *   node scripts/loadtest.mjs --players 30 --url http://localhost:3100
 *   node scripts/loadtest.mjs --cleanup            (preview what the test left behind)
 *   node scripts/loadtest.mjs --cleanup --yes      (delete it)
 *
 * It talks to the running site over HTTP like browsers do (own cookies, own address per player),
 * and reads the answer list straight from the database so each player can give correct answers.
 * It WRITES real rows (sessions, submissions, answer counts); --cleanup removes exactly those.
 * Never point it at a site with real players.
 */
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

for (const f of ['.env.local', '.env']) if (fs.existsSync(f)) process.loadEnvFile(f);

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true;
};
const PLAYERS = Number(arg('players', 30));
const BASE = String(arg('url', 'http://localhost:3100')).replace(/\/$/, '');
const STATE_FILE = path.join('.data', 'loadtest-last.json');
const TRACE = arg('trace', false) === true ? null : arg('trace', false) || null;
const MARK = 'zzloadtestzz';

function db() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set.');
  const ca = process.env.DATABASE_SSL_CA?.trim();
  const ssl = ca
    ? { ca: ca.includes('BEGIN CERTIFICATE') ? ca.replace(/\\n/g, '\n') : fs.readFileSync(ca, 'utf8'), rejectUnauthorized: true }
    : { rejectUnauthorized: false };
  return new pg.Pool({ connectionString: url, max: 2, ssl });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (a, b) => a + Math.random() * (b - a);
const pct = (xs, p) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))] : 0);

// ---------------------------------------------------------------------------------- cleanup
async function cleanup() {
  if (!fs.existsSync(STATE_FILE)) throw new Error(`No ${STATE_FILE}: nothing to clean up.`);
  const st = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  const pool = db();
  const guests = st.guestIds;
  const count = async (sql, params) => Number((await pool.query(sql, params)).rows[0].n);
  const sessions = await count('select count(*) n from game_sessions where guest_id = any($1::uuid[])', [guests]);
  const subs = await count(
    'select count(*) n from submissions where session_id in (select id from game_sessions where guest_id = any($1::uuid[]))',
    [guests],
  );
  const unknown = await count('select count(*) n from unknown_answers where norm like $1', [`${MARK}%`]);
  const rl = await count(`select count(*) n from rate_limits where key ~ $1`, [`(10\\.250\\.|${guests.join('|') || 'x'})`]);
  console.log('The test left behind:');
  console.log(`  ${guests.length} guest ids, ${sessions} game sessions, ${subs} submissions`);
  console.log(`  ${st.increments.length} answer-count increments to take back (answer_stats)`);
  console.log(`  ${unknown} unknown_answers rows from the made-up wrong guesses`);
  console.log(`  ${rl} rate_limits rows`);
  if (!arg('yes', false)) {
    console.log('\nPreview only. Run again with --yes to delete exactly these.');
    return pool.end();
  }
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query('delete from game_sessions where guest_id = any($1::uuid[])', [guests]); // submissions cascade
    for (const inc of st.increments) {
      await client.query(
        'update answer_stats set valid_count = valid_count - $3 where question_id = $1 and answer_id = $2',
        [inc.questionId, inc.answerId, inc.n],
      );
    }
    await client.query('delete from answer_stats where valid_count <= 0');
    await client.query('delete from unknown_answers where norm like $1', [`${MARK}%`]);
    await client.query(`delete from rate_limits where key ~ $1`, [`(10\\.250\\.|${guests.join('|') || 'x'})`]);
    await client.query('commit');
    console.log('Deleted.');
  } catch (err) {
    await client.query('rollback').catch(() => {});
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
  fs.rmSync(STATE_FILE, { force: true });
}

// ------------------------------------------------------------------------------------ test
const metrics = []; // { step, status, ms }
const problems = [];
const guestIds = new Set();
const increments = new Map(); // `${questionId}|${answerId}` -> n

function makePlayer(i, answers) {
  const ip = `10.250.${Math.floor(i / 250)}.${(i % 250) + 1}`;
  let cookie = '';
  const call = async (step, method, route, body) => {
    const t0 = performance.now();
    let status = 0;
    let json = null;
    try {
      const res = await fetch(BASE + route, {
        method,
        headers: {
          'content-type': 'application/json',
          'x-forwarded-for': ip,
          origin: BASE,
          ...(cookie ? { cookie } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      status = res.status;
      for (const c of res.headers.getSetCookie?.() ?? []) {
        const m = c.match(/^an_guest=([^;]+)/);
        if (m) {
          cookie = `an_guest=${m[1]}`;
          try {
            guestIds.add(JSON.parse(Buffer.from(m[1].split('.')[1], 'base64url').toString()).sub);
          } catch {}
        }
      }
      json = await res.json().catch(() => null);
    } catch (err) {
      problems.push(`player ${i} ${step}: ${err.message}`);
    }
    metrics.push({ step, status, ms: performance.now() - t0 });
    // --trace <file>: the wall-clock window of every request, to line up against a query log.
    if (TRACE) fs.appendFileSync(TRACE, `${JSON.stringify({ player: i, step, status, start: Math.round(Date.now() - (performance.now() - t0)), end: Date.now() })}\n`);
    return { status, json };
  };

  return async function play() {
    await sleep(rand(0, 1500)); // people do not click in the same millisecond
    await call('today', 'GET', '/api/game/today');
    const started = await call('start', 'POST', '/api/game/start', {});
    let state = started.json;
    if (started.status !== 200 || !state?.total) {
      problems.push(`player ${i}: could not start (status ${started.status})`);
      return null;
    }
    for (let guard = 0; guard < state.total * 3 && !state.completed; guard++) {
      if (!state.current) {
        const next = await call('next', 'POST', '/api/game/next', {});
        if (next.status !== 200) return problems.push(`player ${i}: next failed ${next.status}`), null;
        state = next.json;
        continue;
      }
      const q = state.current;
      const known = answers.get(q.id) ?? [];
      if (!known.length) return problems.push(`player ${i}: no known answers for a question`), null;
      const pick = known[Math.floor(Math.random() * known.length)];
      await sleep(rand(250, 900)); // reading and typing
      const roll = Math.random();
      if (roll < 0.15) {
        const wrong = await call('answer-wrong', 'POST', '/api/game/answer', { questionId: q.id, text: `${MARK}${Math.floor(Math.random() * 1e6)}` });
        if (wrong.json?.status !== 'unrecognised') problems.push(`player ${i}: wrong guess gave ${wrong.json?.status ?? wrong.status}`);
        await sleep(rand(200, 600));
      } else if (roll < 0.3 && pick.canonical.length > 6) {
        const mid = Math.floor(pick.canonical.length / 2);
        const typo = pick.canonical.slice(0, mid) + pick.canonical.slice(mid + 1);
        const t = await call('answer-typo', 'POST', '/api/game/answer', { questionId: q.id, text: typo });
        if (t.json?.status === 'accepted') {
          noteScore(q.id, t.json.result.answer, answers);
          state = t.json.state;
          continue;
        }
        await sleep(rand(200, 500));
      }
      const res = await call('answer', 'POST', '/api/game/answer', { questionId: q.id, text: pick.canonical });
      const status = res.json?.status;
      if (status === 'accepted') {
        noteScore(q.id, res.json.result.answer, answers);
        state = res.json.state;
      } else if (status === 'timeout') {
        state = res.json.state; // the server's 30-second timer ran out while the request waited
        problems.push(`player ${i}: timed out on a question (server was too slow to answer within 31.5s)`);
      } else {
        problems.push(`player ${i}: answer gave ${status ?? res.status} ${JSON.stringify(res.json)?.slice(0, 120)}`);
        return null;
      }
    }
    const date = state.date;
    await call('result', 'GET', `/api/game/result?date=${date}`);
    await call('answers-list', 'GET', `/api/game/answers?date=${date}`);
    await call('answers-one', 'GET', `/api/game/answers?date=${date}&position=0`);
    return state;
  };
}

function noteScore(questionId, canonical, answers) {
  const hit = (answers.get(questionId) ?? []).find((a) => a.canonical === canonical);
  if (!hit) return;
  const key = `${questionId}|${hit.id}`;
  increments.set(key, (increments.get(key) ?? 0) + 1);
}

async function main() {
  if (arg('cleanup', false)) return cleanup();

  console.log(`Load test: ${PLAYERS} simulated players against ${BASE}`);
  const probe = await fetch(`${BASE}/api/game/today`, { headers: { 'x-forwarded-for': '10.250.255.250' } }).then((r) => r.json());
  if (!probe.available) throw new Error('Today’s game is not available.');
  console.log(`Game #${probe.gameNumber} (${probe.date}), ${probe.questionCount} prompts, ${probe.timeLimitSec}s each`);

  const pool = db();
  const rows = (
    await pool.query(
      `select a.id, a.question_id, a.canonical
         from answers a
         join daily_game_questions dq on dq.question_id = a.question_id
         join daily_games g on g.id = dq.game_id
        where g.game_date = $1 and a.verified`,
      [probe.date],
    )
  ).rows;
  const answers = new Map();
  for (const r of rows) {
    if (!answers.has(r.question_id)) answers.set(r.question_id, []);
    answers.get(r.question_id).push({ id: r.id, canonical: r.canonical });
  }
  const before = (await pool.query(`select count(*)::int n from game_sessions`)).rows[0].n;
  console.log(`Answer pool loaded (${rows.length} answers). Sessions in the database before: ${before}`);

  fs.mkdirSync('.data', { recursive: true });
  const t0 = performance.now();
  const results = await Promise.all(Array.from({ length: PLAYERS }, (_, i) => makePlayer(i + 1, answers)().catch((e) => (problems.push(`player ${i + 1}: ${e.message}`), null))));
  const seconds = (performance.now() - t0) / 1000;

  // Remember what we wrote, before anything can fail below, so --cleanup can undo it.
  // Runs add to one record, so a single --cleanup undoes all of them.
  const prior = fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) : { guestIds: [], increments: [] };
  const merged = new Map(prior.increments.map((x) => [`${x.questionId}|${x.answerId}`, x.n]));
  for (const [k, n] of increments) merged.set(k, (merged.get(k) ?? 0) + n);
  fs.writeFileSync(
    STATE_FILE,
    JSON.stringify({
      at: new Date().toISOString(),
      guestIds: [...new Set([...prior.guestIds, ...guestIds])],
      increments: [...merged].map(([k, n]) => ({ questionId: k.split('|')[0], answerId: k.split('|')[1], n })),
    }),
  );

  const finished = results.filter((s) => s?.completed);
  console.log(`\nDone in ${seconds.toFixed(1)}s: ${finished.length}/${PLAYERS} players finished all prompts`);
  if (finished.length) {
    const scores = finished.map((s) => s.score);
    console.log(`Scores: min ${Math.min(...scores)}, median ${pct(scores, 50)}, max ${Math.max(...scores)}`);
  }

  const steps = [...new Set(metrics.map((m) => m.step))];
  console.log('\nstep            calls   ok    errors  median   p95      slowest');
  for (const s of steps) {
    const ms = metrics.filter((m) => m.step === s);
    const ok = ms.filter((m) => m.status === 200).length;
    console.log(
      `${s.padEnd(15)} ${String(ms.length).padStart(5)} ${String(ok).padStart(5)} ${String(ms.length - ok).padStart(7)}  ${(pct(ms.map((m) => m.ms), 50) | 0).toString().padStart(5)}ms ${(pct(ms.map((m) => m.ms), 95) | 0).toString().padStart(6)}ms ${(Math.max(...ms.map((m) => m.ms)) | 0).toString().padStart(7)}ms`,
    );
  }
  const codes = {};
  for (const m of metrics) if (m.status !== 200) codes[m.status] = (codes[m.status] ?? 0) + 1;
  if (Object.keys(codes).length) console.log('\nNon-200 responses by status:', codes);

  // Does the data add up? Checked straight in the database.
  const ids = [...guestIds];
  const check = (
    await pool.query(
      `select s.id, s.status, s.total_score,
              count(sub.*)::int as subs, coalesce(sum(sub.points),0)::int as pts
         from game_sessions s left join submissions sub on sub.session_id = s.id
        where s.guest_id = any($1::uuid[]) group by s.id`,
      [ids],
    )
  ).rows;
  const dupSessions = ids.length - (await pool.query('select count(distinct guest_id)::int n from game_sessions where guest_id = any($1::uuid[])', [ids])).rows[0].n;
  const badScore = check.filter((r) => r.total_score !== r.pts).length;
  const unfinished = check.filter((r) => r.status !== 'completed').length;
  const wrongSubs = check.filter((r) => r.status === 'completed' && r.subs !== probe.questionCount).length;
  console.log('\nData check');
  console.log(`  sessions created: ${check.length} for ${ids.length} guests (extra sessions per guest: ${Math.abs(dupSessions)})`);
  console.log(`  score != sum of its submissions: ${badScore}`);
  console.log(`  completed sessions without exactly ${probe.questionCount} submissions: ${wrongSubs}`);
  console.log(`  sessions left unfinished: ${unfinished}`);
  await pool.end();

  if (problems.length) {
    console.log(`\nProblems (${problems.length}):`);
    for (const p of problems.slice(0, 15)) console.log('  -', p);
    if (problems.length > 15) console.log(`  … and ${problems.length - 15} more`);
  } else {
    console.log('\nNo problems reported.');
  }
  console.log('\nThe test wrote real rows. Preview the clean-up with: node scripts/loadtest.mjs --cleanup');
}

main().catch((err) => {
  console.error('Load test failed:', err.message);
  process.exit(1);
});
