# TradingBase

Free-source-only crypto quantitative research and backtesting system.

## Scope

TradingBase ingests public crypto market data, builds strictly causal features, creates training labels, trains baseline models, runs event-driven backtests, and records every signal/trade decision for auditability.

Hard constraints:

- Free public data only
- No paid APIs
- No TradingView scraping
- No live orders in MVP
- No transfers
- No withdrawals
- No leverage execution
- Backtest decisions may only use data available at decision time
- Labels are only for training/evaluation, never for backtest execution

## Allowed data sources

- Binance public REST through `ccxt`
- Bybit public REST through `ccxt`
- Coinbase public API through `ccxt`
- Kraken public API through `ccxt`
- OKX public API through `ccxt`
- Alternative.me / GDELT / FRED later as free external features

## Architecture

```txt
public exchange APIs
  -> raw candles / funding
  -> TimescaleDB
  -> versioned features
  -> versioned labels
  -> training dataset
  -> RandomForest baseline
  -> risk engine
  -> event-driven backtest
  -> audit tables / metrics
```

## Quickstart

```bash
cp .env.example .env
docker compose up -d
python -m pip install -e .[dev]
make migrate
make smoke-backtest
```

## Main commands

```bash
python scripts/backfill_candles.py --exchange binance --symbol BTC/USDT --market-type spot --timeframe 1h --from 2024-01-01 --to 2024-02-01
python scripts/backfill_funding.py --exchange bybit --symbol BTC/USDT:USDT --from 2024-01-01 --to 2024-02-01
python scripts/build_features.py --exchange binance --symbol BTC/USDT --market-type spot --timeframe 1h --feature-version v1
python scripts/build_labels.py --exchange binance --symbol BTC/USDT --market-type spot --timeframe 1h --label-version v1
python scripts/build_training_dataset.py --exchange binance --symbol BTC/USDT --market-type spot --timeframe 1h --feature-version v1 --label-version v1 --output data/training_btcusdt_1h_v1.parquet
python scripts/train_model.py --dataset data/training_btcusdt_1h_v1.parquet --target direction_6 --model-version random_forest_v1
python scripts/run_backtest.py --dataset data/training_btcusdt_1h_v1.parquet --model-path artifacts/random_forest_v1.joblib --from 2024-01-01 --to 2024-02-01
python scripts/validate_data.py --exchange binance --symbol BTC/USDT --market-type spot --timeframe 1h
```

## Acceptance gates

Before Optuna or LSTM/PPO work:

1. `make smoke-backtest` passes.
2. Total Return is finite, not `nan`.
3. Duplicate candle count is zero.
4. Backtest produces equity curve.
5. Backtest does not read label columns for decisions.
6. Fees, spread, slippage and funding assumptions are applied.
7. `pytest` passes.

## Implementation status

Initial scaffold includes:

- Docker Compose for Postgres/Timescale-compatible local DB and Redis
- SQL schema for candles, funding, features, labels, backtests and audits
- Free-source exchange adapter through `ccxt`
- Versioned feature builder
- Versioned label builder
- Training dataset builder
- RandomForest baseline training
- Risk engine
- Event-driven backtest engine
- Metrics with finite-return guards
- Data validation checks
- CLI scripts
- Unit tests
