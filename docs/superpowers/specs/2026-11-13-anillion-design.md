# Animellion design (approved 2026-11-13)

## Intent
A daily anime guessing game ready for public launch. Everyone gets the same
questions each day, types free answers, and rarer valid answers score more.
The goal is a habit-forming daily game with streaks, leaderboards and sharing.

## Goals
- Fixed points per rarity tier: 25 / 50 / 75 / 100.
- Hero form from cumulative score: 0-199, 200-349, 350-499, 500+.
- Rarity from real player submissions, frozen per published daily game;
  admin-set provisional tiers until a question has 100 valid submissions.
- Answers accepted only from the approved answer list and its aliases.
- All scoring, validation and session state on the server.
- Accounts, guest play, profiles, history, streaks, leaderboards.
- Protected admin dashboard: questions, answers, daily games, rarity, users,
  analytics.
- Tests for scoring, forms, validation, daily games and security rules.

## Non-goals
- Cloning another game's look or source.
- Using an existing franchise's character or artwork as the game's identity.
- Calling an AI model per player submission.

## Anti-goals
- Mock data, fake buttons or client-side scoring.
- Rarity percentages invented by AI.

## Approaches
1. **Next.js + Supabase (chosen).** Postgres, auth and row-level security in
   one service; matches the requested stack; deploys to Vercel.
2. Next.js + self-hosted Postgres + custom auth. More control, but more
   security surface to own.
3. Separate API server + SPA. More moving parts for no gain here.

## Decisions (builder's calls)
- **Dev mode without keys:** embedded Postgres (PGlite) runs the same
  migrations, with a local signed-cookie login. Supabase is used when its
  environment variables are set.
- **Data access:** all game reads and writes go through server route handlers
  using a server-only database connection. Row-level security is enabled as a
  second line of defence.
- **Look:** original retro-arcade style; orange, yellow and blue energy,
  auras, lightning. Start button reads "Power Up".
- **Hero:** original fighter with four forms: Base, Ascended, Azure, Ultra.
  Placeholder SVG art in `public/hero/<form>/`, replaceable.
- **Tier names:** Common (25), Rare (50), Epic (75), Ultra (100); display
  names configurable in one module.
- **Questions per game:** default 7, configurable; same questions for everyone on a given day.
- **Timer:** 30 seconds per question, enforced on the server. Wrong answers do not count and can be retried until time runs out; the first valid answer scores and locks.
- **Optional integrations:** AniList import, AI question helper, AdSense and
  Analytics are off unless their environment variables are set.

## Left to the builder
Component structure, animation details, admin page layout, seed content.
