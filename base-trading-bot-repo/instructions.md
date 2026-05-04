# Project instructions

## Overview

This project is a Base Sepolia trading execution scaffold. The frontend connects wallets and requests user signatures. The backend owns risk validation, calldata preparation, Supabase logging and final chain verification.

## Tech stack

- Next.js App Router
- TypeScript
- Tailwind CSS
- Wagmi
- Viem
- Base Account
- TanStack Query
- Supabase
- Base Sepolia
- Optional Base Builder Code attribution through `ox/erc8021`

## Core execution lifecycle

```txt
PREPARED
  /api/trading/prepare
SUBMITTED
  /api/trading/submit
CONFIRMED or FAILED
  /api/trading/status
```

## Security rules

- Do not expose private keys.
- Do not expose Supabase service-role key in frontend.
- Do not commit `.env.local`.
- Frontend must never calculate position size, slippage, router or execution mode.
- Frontend must not modify backend calldata.
- Backend must verify transaction receipt directly from Base Sepolia RPC.
- Mainnet execution is disabled by default.

## Environment

Use `.env.example` as the only committed env file.

Required Vercel env values:

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

## Database

Run:

```txt
supabase/migrations/001_init.sql
supabase/migrations/002_builder_code.sql
```

## Default token

```txt
WETH Base Sepolia
0x4200000000000000000000000000000000000006
```
