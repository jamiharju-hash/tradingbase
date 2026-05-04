create extension if not exists pgcrypto;

create table if not exists trading_signals (
  id uuid primary key default gen_random_uuid(),
  symbol text not null,
  signal text not null check (signal in ('BUY', 'SELL', 'BUY_SMALL', 'AVOID')),
  confidence numeric not null default 0 check (confidence >= 0 and confidence <= 1),
  features jsonb,
  reason text,
  created_at timestamptz not null default now()
);

create table if not exists trade_executions (
  id uuid primary key default gen_random_uuid(),
  signal_id uuid references trading_signals(id) on delete set null,
  wallet_address text not null,
  chain_id integer not null,
  symbol text not null,
  side text not null check (side in ('BUY', 'SELL')),
  router_address text,
  calldata text,
  tx_hash text,
  status text not null default 'PREPARED'
    check (status in ('PREPARED', 'SUBMITTED', 'CONFIRMED', 'FAILED', 'CANCELLED')),
  max_slippage_bps integer not null default 50 check (max_slippage_bps >= 0),
  position_usd numeric check (position_usd is null or position_usd >= 0),
  error_message text,
  created_at timestamptz not null default now(),
  submitted_at timestamptz,
  confirmed_at timestamptz
);

create table if not exists watched_tokens (
  id uuid primary key default gen_random_uuid(),
  chain_id integer not null,
  token_address text not null,
  symbol text not null,
  name text,
  decimals integer not null check (decimals >= 0 and decimals <= 255),
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists trading_signals_created_at_idx
on trading_signals(created_at desc);

create index if not exists trade_executions_wallet_idx
on trade_executions(wallet_address);

create index if not exists trade_executions_tx_hash_idx
on trade_executions(tx_hash);

create index if not exists trade_executions_status_idx
on trade_executions(status);

create unique index if not exists watched_tokens_chain_address_uidx
on watched_tokens(chain_id, lower(token_address));

insert into watched_tokens (
  chain_id,
  token_address,
  symbol,
  name,
  decimals,
  is_default
)
values (
  84532,
  '0x4200000000000000000000000000000000000006',
  'WETH',
  'Wrapped Ether',
  18,
  true
)
on conflict do nothing;
