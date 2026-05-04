# Base Trading Bot

Next.js + Supabase + Wagmi/Viem trading execution scaffold for Base Sepolia.

## Architecture

```txt
Frontend
  - wallet connect
  - WETH balance display
  - calls /api/trading/prepare
  - sends backend-prepared calldata through wallet
  - reports txHash to /api/trading/submit
  - calls /api/trading/status after local receipt

Backend
  - validates risk
  - prepares calldata
  - applies optional Base Builder Code attribution
  - logs PREPARED/SUBMITTED/CONFIRMED/FAILED lifecycle in Supabase
  - verifies receipt directly from Base Sepolia RPC
```

## Default network and token

```txt
Network: Base Sepolia
Chain ID: 84532
Token: WETH
Address: 0x4200000000000000000000000000000000000006
```

## Setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

## Required environment variables

Use only one Supabase project per deployment. For this trading bot, the service-role key must belong to the same project as `NEXT_PUBLIC_SUPABASE_URL`.

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SERVICE_ROLE_KEY=

BASE_RPC_URL=https://sepolia.base.org
NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
BASE_CHAIN_ID=84532
TRADING_EXECUTION_MODE=testnet

BASE_BUILDER_CODE=
REQUIRE_BASE_BUILDER_CODE=false
```

Never commit real secrets. Add them to Vercel Environment Variables or GitHub Secrets.

## Supabase migrations

Run these SQL files in Supabase SQL Editor:

```txt
supabase/migrations/001_init.sql
supabase/migrations/002_builder_code.sql
```

## Deploy to Vercel

```bash
npm run build
npx vercel deploy --prod
```

Or push to GitHub and connect the repo to Vercel.

## Create GitHub repo from this folder

```bash
git init
git add .
git commit -m "Initial Base Sepolia trading bot"
gh repo create base-trading-bot --private --source=. --remote=origin --push
```

## Security note

A Supabase service-role key has full database privileges. If it has been shared in chat, logs, screenshots, or a repository, rotate it before production use.
