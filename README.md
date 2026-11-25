# Pump.fun Replay Sprint — Paper Bot (RIDER)

[![Make.fun](https://make.fun/badge/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122)
[![Rank](https://make.fun/badge/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122/DizellaCapital/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122-rider/rank.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122)
[![Reward](https://make.fun/badge/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122/DizellaCapital/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122-rider/reward.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122)

A paper trading bot for the [Pump.fun Replay Sprint](https://make.fun/bounty/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122) on make.fun. It trades 10 SOL of paper money on a 24-hour replay of recorded pump.fun bonding-curve activity. Nothing is traded for real.

## Strategy: overhang-exhaustion breakout rider — buy confirmed strength, scale winners, ride runners

The live board (25 Nov 2026) is unambiguous: the winners are riders, not snipers. The top entries — "Overhang Exhaustion & Dispersed Ownership Bot" (+12.52 SOL), "Overhang-Exhausted Dispersed Breakout + 5-Tranche Winner Scaling Bot" (+8.63), "Dip-Rider" (+5.45), "Early-momentum pyramid bot: buys confirmed strength, rides runners to completion" (+6.73 on Paper) — all buy strength AFTER it is confirmed and let the runners run. A sniper that flips at +18% cuts exactly the coins that pay: on the dev window its top 3 coins made 89% of its gains.

This bot therefore waits, filters hard, and rides:

- **Overhang exhaustion** — a coin qualifies only after the early sellers have flushed: non-creator sells totalling ≥0.5 SOL from ≥2 sellers, with no non-creator sell in the last 12 slots (or a price dip below create that has reclaimed). The creator must not have sold and their own create-slot buy must be ≤1.5 SOL.
- **Dispersed ownership** — ≥4 distinct non-creator buyers, ≥0.5 SOL bought by non-creators, and no single buyer holding more than 35% of non-creator bought SOL. No whale, no bundle.
- **Breakout entry** — age 8–150 slots, real SOL reserves 0.5–50, price ≥1.10x create price AND ≥1.03x its price 15 slots ago, with net SOL inflow ≥0.05 SOL over the last 15 slots.
- **Winner scaling** — first buy 0.20 SOL; up to 3 pyramid adds of 0.10 SOL, each only when the price is ≥15% above the previous buy and inflow is still positive. Max 5 open positions, max ~3 SOL total exposure.
- **Ride the runners** — sell half at +110%, sell half of what remains at +250%, trailing stop −25% from peak (armed at +40%), stop loss −5%, max hold 650 slots, exit at once if the creator sells. The harness closes positions when a curve completes or the replay ends.
- **Guardrail pacing** — the run must end with a ≥0.01 SOL round trip on 20+ coins. When fills or coins lag the pace, the bot opens tiny 0.01 SOL probe round trips until it is back on pace.

Fully deterministic: every decision is a pure function of the batch stream (no clock, no environment, no randomness), so the two grading runs produce byte-identical action logs.

## Local grading (dev window, 2–3 Nov 2026, 1,222 coins)

`makefun grade-local --driver process` (official harness): **net PnL +1.206 SOL** (return +12.1%, 90% interval −0.119 .. +2.780), 325 fills over 89 coins, 145 round trips, win rate 9.0%, max drawdown 3.6%, guardrails met, L1 regrade reproduced byte for byte. At 2x fees the net PnL is still +0.892 SOL. Local research simulator (full window): +1.770 SOL, both halves positive (+0.573 / +1.196).

For comparison, the previous sniper entry on the same window scored −0.063 SOL live (#750). The rider improves on it by +1.27 SOL on the official grader.

## Layout

- `main.ts` — entrypoint (run by the grader as `node /bot/main.ts`).
- `strategy.ts` — the trading logic.
- `vendor/makefun-bot.ts` — the house SDK shim for the agent-fun/replay/v2 protocol (vendored, byte-identical to the kit's `sdk/ts/makefun-bot.ts`).

## Local grading

```sh
node <kit>/cli/makefun.mjs grade-local --kit <kit> --bot . --driver process
```

## License

MIT — see [LICENSE](LICENSE).
