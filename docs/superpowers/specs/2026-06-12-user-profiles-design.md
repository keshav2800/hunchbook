# User Profiles — Design

**Date:** 2026-06-12 · **Status:** approved in-session ("sure then")

## Goal
Basic profile per Sui address — username, email, bio (picture deferred) — stored server-side,
with usernames surfaced publicly (leaderboard, stats dialog) and email kept private.

## Decisions
- **Storage:** SQLite (`better-sqlite3`) at `web/data/profiles.db`. First DB in the app; zero infra.
- **Auth:** wallet-signed personal message required for writes. Canonical message
  `Hunchbook:profile:v1:<timestamp>:<username>:<email>:<bio>` signed client-side
  (dapp-kit `signPersonalMessage`, zkLogin), verified server-side via
  `verifyPersonalMessageSignature` with a GraphQL client (zkLogin sigs need it).
  Timestamps older than 5 min rejected (anti-replay). Reads are public.
- **Privacy:** the public GET never returns email — for anyone, including the owner. The owner
  reads their full profile (email included) via a signed `POST /api/profile/me`
  (message `Hunchbook:profile:read:v1:<timestamp>`), and the PUT response also echoes the
  full profile so the form stays warm after saving.
- **Validation:** username 3–20 chars `[a-zA-Z0-9_]`, case-insensitive UNIQUE; bio ≤ 160 chars;
  email shape-checked (RFC-lite regex), all optional except username required to save.

## Surfaces
- `/profile` page: avatar (gradient; picture "soon"), username/email/bio form, save (sign+PUT),
  inline errors (username taken/invalid), read-only stats strip from existing bet history.
- Avatar dropdown gains "Profile" item (above Statistics).
- Leaderboard rows + stats dialog resolve usernames via `GET /api/profiles?addresses=…` (batch,
  public fields only), falling back to short address.

## API
- `GET /api/profile?address=0x…` → `{address, username, bio}` or `{}`.
- `POST /api/profile/me` (signed) → `{address, username, email, bio}`.
- `PUT /api/profile` `{address, username, email, bio, timestamp, signature}` → verify sig (and
  ts freshness) → upsert → full own profile back. 409 on username collision.
- `GET /api/profiles?addresses=a,b,c` (≤50) → `{[address]: {username}}`.

## Out of scope
Profile pictures (column reserved later), username changes cooldown, ENS-style on-chain names.
