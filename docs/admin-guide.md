# Animellion admin guide

The dashboard is at `/admin`. It returns "page not found" to anyone who is not an administrator.

## Becoming an administrator

Add your email to `ADMIN_EMAILS` (comma-separated) in the server environment, then log in. Your account is promoted at that login. After that, promote or demote other people in **Users**. You cannot remove your own admin role, so there is always at least one administrator.

## Overview

Today's numbers: players, games finished, average score, the spread of final forms, the most-missed prompts and the most common unknown answers.

## Questions

- **Create** a question with its text and category. New questions start inactive.
- **Answers**: add each accepted answer with a canonical name and a provisional tier (Common, Rare, Epic, Ultra). The provisional tier decides the score until the question has 100 valid answers from players; after that, real data takes over.
- **Aliases**: other spellings or names for the same answer ("Kakarot" for Goku). One name can belong to only one answer within a question.
- **Verified**: only verified answers are accepted. Imported and AI-suggested answers start unverified.
- **Active**: only active questions with at least one verified answer are picked for automatic games.

Players do not need exact spelling: a guess that is at least 80% the same as an answer or alias is shown a "did you mean" suggestion, and pressing Enter submits the suggested name (numbers must match exactly, and a guess equally close to two answers gets no suggestion). You only need aliases for genuinely different names, not for typos.

## Unknown answers

Every guess that was not accepted is counted here, most frequent first. For each one you can:

- **Approve as a new answer** (choose its tier),
- **Approve as an alias** of an existing answer, or
- **Reject** it.

Approved answers count from the next submission. Past games are not rescored.

## Daily games

- The list shows scheduled, live and past games.
- **Schedule** a game for a future date, add questions, order them, then **Publish**. A draft is never shown to players.
- A published game goes live at the rollover time on its date. Rarity is frozen then, from the statistics gathered so far.
- Once anyone has started a game it cannot be edited, unpublished or deleted.
- On days with nothing scheduled, a game is generated automatically if that setting is on.

## Rarity & rules

- **Thresholds**: the share of answers above which an answer is Common, Rare or Epic. Anything at or below the Epic threshold is Ultra. Defaults: 10%, 3%, 1%.
- **Minimum sample size**: valid answers a question needs before player data replaces provisional tiers. Default 100.
- **Questions per game** (default 7) and **seconds per question** (default 30).
- **Timezone and rollover hour**: when the day changes. Change these between games, not while people are playing.

Points per tier are fixed at 25 / 50 / 75 / 100 and cannot be changed here. Changes apply to games that have not gone live yet.

## Users

Search by username or email. Suspend or restore accounts, and grant or remove admin rights. Suspended accounts cannot log in and are left off leaderboards. The **Suspicious activity** section lists games finished unusually fast and addresses hitting rate limits.

## Import & AI

- **AniList import**: pulls character or studio names for one anime and adds them to a question as unverified answers.
- **AI question ideas** (needs `OPENAI_API_KEY`): drafts questions with candidate answers. They are saved inactive and unverified. The AI never sets scores or rarity and is never used during play.

Review everything from both tools before verifying it.

## Resetting a password in dev-local mode

Dev-local mode has no email service. To reset an account, delete the `.data/` folder (this wipes the local database) and register again. In production, password resets are emailed by Supabase.
