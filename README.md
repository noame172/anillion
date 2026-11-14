# Anillion

A daily anime guessing game. Every day everyone gets the same seven prompts ("Name a One Piece character"). You have 30 seconds per prompt to type one answer. Rarer answers score more, and the hero powers up to match.

## How the game works

| Rule | Value |
| --- | --- |
| Prompts per day | 7, the same for every player |
| Time per prompt | 30 seconds, enforced by the server |
| Wrong guesses | Cost nothing. Keep trying until the timer ends |
| First correct answer | Scores once and locks the prompt |
| Spelling | A guess that is at least 80% the same as an answer (or alias) gets a "did you mean" suggestion above the answer bar (`typed → Answer`). Press Enter to take it and submit. Numbers must match exactly, and adding or dropping a whole word is not treated as a typo |
| Points | Common 25, Rare 50, Epic 75, Ultra 100 (fixed) |
| Rarity | From real player data: more than 10% of answers = Common, more than 3% = Rare, more than 1% = Epic, otherwise Ultra |
| Minimum sample | 100 valid answers per prompt. Before that, the tier an admin set is used |
| Rarity freeze | Computed once when the day's game goes live, so everyone is scored the same way |

**The hero.** After each correct answer the hero climbs from Base Form to the form for that answer's rarity (Rare → Ascended, Epic → Azure Ascended, Ultra → Ultra Form), passing through every form on the way in about a second. Pressing **Power Up** returns it to base for the next prompt. At the end, the hero climbs to the form for your total score (0, 200, 350, 500 points) and the results appear.

**Results.** Score, final form, an answer breakdown, a share card, and every accepted answer for each prompt with a search box. The full answer list is only sent to players who have finished that day's game.

## Run it locally

Needs Node.js 20.12 or newer.

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:3000. With no environment variables set, the app runs in **dev-local mode**:

- An embedded Postgres database is created in `.data/` and filled with the starter questions.
- Accounts use a local email/username + password login. There is no email service, so password reset emails are not sent, and Google sign-in is off.
- A cookie-signing secret is generated in `.data/session-secret`.

Delete the `.data/` folder to start again from scratch. Dev-local mode is for development only.

### Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build and server |
| `npm test` | Test suite (runs against an in-memory database) |
| `npm run lint` / `npm run typecheck` | Static checks |
| `npm run db:migrate` | Apply `supabase/migrations/*.sql` to `DATABASE_URL` |
| `npm run db:seed` | Load `data/seed.json` into `DATABASE_URL` (skips what already exists) |

## Environment variables

Copy `.env.example` to `.env.local`. Never commit `.env.local`.

| Variable | Needed | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SITE_URL` | Production | Public address, e.g. `https://anillion.example`. Used for share links, the sitemap and sign-in redirects |
| `DATABASE_URL` | Production | Supabase Postgres connection string. Server only |
| `NEXT_PUBLIC_SUPABASE_URL` | Production | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Production | Supabase public (anon) key |
| `SESSION_SECRET` | Production | 32+ random characters, signs guest cookies |
| `ADMIN_EMAILS` | Recommended | Comma-separated emails promoted to admin at their next login |
| `OPENAI_API_KEY`, `OPENAI_MODEL`, `AI_DAILY_LIMIT` | Optional | AI question ideas in the admin dashboard |
| `NEXT_PUBLIC_ADSENSE_CLIENT`, `NEXT_PUBLIC_ADSENSE_SLOT_*` | Optional | Google AdSense, loaded only after consent |
| `NEXT_PUBLIC_GA_ID` | Optional | Google Analytics, loaded only after consent |
| `NEXT_PUBLIC_CONTACT_EMAIL` | Optional | Address shown on the contact page |

The app switches to Supabase mode when `DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are all set. The Supabase service role key is not used anywhere.

## Set up Supabase

1. Create a project at supabase.com.
2. **Project Settings → Database → Connection string**: copy the URI into `DATABASE_URL`. On Vercel use the pooled ("Transaction") connection string.
3. **Project Settings → API**: copy the project URL and the `anon` key.
4. Create the tables and load the starter questions:

   ```bash
   npm run db:migrate
   ```

   ```bash
   npm run db:seed
   ```

5. **Authentication → URL Configuration**: set the Site URL to your address and add `https://YOUR-DOMAIN/auth/callback` to the redirect URLs (also `http://localhost:3000/auth/callback` for local testing).
6. **Authentication → Email Templates**: so that confirmation and reset links work in any browser (for example a link requested on a laptop and opened on a phone), change the link in two templates:
   - *Confirm signup*: `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=email`
   - *Reset password*: `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password/update`
7. Keep **Confirm email** switched on. Put your own email in `ADMIN_EMAILS`, register on the site with it, confirm the email, and log in. You are now an administrator. An address that has not been confirmed is never promoted.

Row Level Security is on for every table and the public roles have no table access; all reads and writes go through the server.

### Google sign-in

1. In Google Cloud Console create an **OAuth client ID** (type: Web application). Add the authorised redirect URI `https://YOUR-PROJECT.supabase.co/auth/v1/callback`.
2. In Supabase open **Authentication → Providers → Google**, switch it on, and paste the client ID and secret.
3. The "Continue with Google" button on the login and register pages now works. A profile is created on first sign-in with a neutral username such as `player4821` (changeable on the profile page), so the email address is never shown.

### Logging in

Players can log in with their email **or** username plus password, or with Google. Login is limited to 5 attempts per 15 minutes per account and 30 per address.

### Known limits

- Guests can play without an account, so a determined person can replay as a new guest after seeing the answers and then log in to keep the better score. An account's existing score for a day is never replaced, and requests are rate limited per address, but this cannot be fully closed while guest play exists.
- Rarity is built from all valid answers, guests included. Per-address limits slow down scripted answer stuffing; review the **Suspicious activity** list if a question's rarity looks wrong.
- Spelling tolerance is 80%, as designed, so a five-letter name with one wrong letter gets a suggestion. A suggestion shows the player one accepted answer close to what they typed. Names that are exactly an unverified or rejected answer, differ in a number, or only add or drop a whole word get no suggestion.

## Deploy to Vercel

1. Push the repository to GitHub and import it in Vercel.
2. Add the environment variables above (Production and Preview).
3. Deploy. Then set `NEXT_PUBLIC_SITE_URL` to the final domain and add that domain's `/auth/callback` to the Supabase redirect URLs.

No scheduled job is needed: the day's game is created the first time someone opens the site after the daily rollover.

## Daily games

- The day changes at the rollover hour in the configured timezone (default 00:00 UTC). Both are in **Admin → Rarity & rules**.
- If nothing is scheduled for a day and automatic generation is on, the server picks seven active questions, preferring ones used least recently.
- To choose the questions yourself, schedule a game in **Admin → Daily games** and publish it before its date.
- Once a game is live its questions and rarity are locked.

## Questions and answers

- A question needs verified answers before it can be used. Each answer has a canonical name, any number of aliases, and a provisional tier used until 100 players have answered.
- Players' unrecognised guesses are collected in **Admin → Unknown answers**, where you can approve them as new answers or as aliases.
- AniList import and AI suggestions always arrive unverified, for you to review.
- The starter catalogue in `data/seed.json` has about 120 questions and about 14,800 answers: characters from 90+ franchises, anime by genre, era and studio, every anime AniList lists with more than 100 episodes, studios, and Studio Ghibli films. It is built from AniList's public data, with provisional tiers from popularity (and the hand-checked answers from the first version kept as they were).
- To refresh or extend it, edit the lists at the bottom of `scripts/build-seed.mjs` and run `node scripts/build-seed.mjs` (takes a few minutes: it stays under AniList's rate limit and caches responses in `scripts/.cache`). Review the diff, then run `npm run db:seed`. Seeding adds new questions and fills in missing answers on questions the seed created earlier; it never touches questions you made yourself. An answer you deleted from a seeded question comes back the next time you run it, so set it to unverified instead.
- To add answers by hand in bulk, edit `data/seed.json`. Each answer is `["Canonical name", "tier", "alias", ...]`.

See [docs/admin-guide.md](docs/admin-guide.md) for the dashboard in detail.

## Hero artwork

The four forms are placeholder SVGs in `public/hero/{base,ascended,azure,ultra}/hero.svg`, generated by `scripts/gen-hero.mjs`. Replace the files (keep the names, 240×320) to use your own art.

## Security summary

- Scoring, timing, rarity and answer matching all run on the server. Anything the browser sends besides the question id and the typed text is discarded.
- The browser only ever receives the prompt whose timer is running, and the answer list only after the game is finished.
- Passwords are handled by Supabase Auth (or hashed with scrypt in dev-local mode); none are stored in plain text.
- Admin pages and APIs check the role stored in the database on every request.
- Rate limits, same-origin checks on state-changing requests, a Content Security Policy and safe error messages are applied throughout.

## Project layout

```
src/app            pages and API routes
src/components     UI components
src/lib/game       rules: tiers, forms, matching, rarity, daily games, sessions
src/lib/auth       sign-in, profiles, viewer identity
src/lib/admin      dashboard logic
supabase/migrations  database schema and RLS
data/seed.json     starter questions
tests              test suite
```
