# Deploying the Hunchbook web app (Vercel + Neon)

The web app is a Next.js app in `web/` inside a pnpm workspace. Bets, positions,
markets, the vault, and the leaderboard read from the **on-chain indexer + RPC** —
no database needed for those. Postgres (Neon) backs only **off-chain profiles**
(usernames/bio/email) and future social/launchpad data.

## 1. Create the database (Neon)
1. Create a Neon project → a Postgres database.
2. Copy the **pooled** connection string (host contains `-pooler`), e.g.
   `postgresql://USER:PASS@ep-xxx-pooler.REGION.aws.neon.tech/neondb?sslmode=require`

## 2. One-time local setup
```bash
pnpm install            # from repo ROOT — installs the whole workspace
# NOTE: the Prisma CLI reads web/.env (NOT .env.local), so put it there:
echo 'DATABASE_URL=postgresql://…-pooler….neon.tech/neondb?sslmode=require' >> web/.env
cd web
pnpm exec prisma db push     # creates the `profiles` table (use `exec`, not `pnpm prisma`)
pnpm exec prisma generate    # generate the client (also runs on postinstall + build)
```
`prisma db push` syncs the schema with no migration history — fine for now. Switch
to `prisma migrate dev` once the schema stabilizes / grows (vault P&L, launchpad).

## 3. Vercel project settings
- **Root Directory:** `web` (Vercel detects the pnpm workspace and resolves `@hunchbook/shared`).
- **Build command:** default (`pnpm build` → runs `prisma generate && next build`).
- **Environment variables:**
  | Var | Notes |
  |---|---|
  | `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | public |
  | `NEXT_PUBLIC_ENOKI_API_KEY` | public |
  | `ENOKI_SECRET_KEY` | secret (sponsored tx) |
  | `TREASURY_SUI_PRIVATE_KEY` | secret (sponsor wallet `suiprivkey…`) |
  | `DATABASE_URL` | secret — Neon **pooled** string |

## 4. The keeper is separate
`scripts/` (vault operator: PLP mark / supply / hedge) is a long-running Node
process — run it on Fly.io/Railway, **not** Vercel. It needs its own env + the
operator key in the Sui CLI keystore.

## Notes
- A fresh `git clone` does **not** include `deepbookv3-src/` (vendored upstream,
  gitignored). Vendor it separately if you need to rebuild the Move packages.
- Never commit `.env*`, keystores, or `*.db` — `.gitignore` already blocks them.
