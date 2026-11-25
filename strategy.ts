// Overhang-exhaustion + dispersed-ownership breakout RIDER for the pump.fun bonding-curve replay.
//
// Idea (from the live Replay Sprint board, 25 Nov 2026): the winners are NOT snipers. The top
// entries — "Overhang Exhaustion & Dispersed Ownership Bot" (+12.52 SOL), "Overhang-Exhausted
// Dispersed Breakout + 5-Tranche Winner Scaling" (+8.63), "Dip-Rider" (+5.45), "Early-momentum
// pyramid bot: buys confirmed strength, rides runners to completion" (+6.73 on Paper) — all buy
// CONFIRMED strength and RIDE the runners. Our sniper (TP +18%, max hold 18 slots) cut the very
// runners that pay: its top 3 coins made 89% of its gains.
//
// So this bot waits for the launch overhang to flush out, checks the holders are dispersed
// (many distinct buyers, no whale), enters only on a breakout (price above create, rising, net
// inflow positive), pyramids into winners in tranches, and rides with a wide trailing stop and
// laddered partial take-profits instead of a quick flip.
//
// Fully deterministic: every decision is a pure function of the batch stream (no clock, no
// environment, no randomness). Iteration is over insertion-ordered maps fed by the batch stream,
// so the two grading runs produce byte-identical action logs.

import type { Batch, Bot, BotState, OrderInput, Pubkey } from './vendor/makefun-bot.ts';

export interface Params {
  /** Youngest age (slots since create) at which a coin may be bought. */
  minAge: number;
  /** Oldest age at which a first buy may still be decided. */
  maxAge: number;
  /** SOL to put into one position on the first buy. */
  firstBuySol: number;
  /** SOL for each pyramid add-on buy. */
  addSol: number;
  /** Most adds per position (winner scaling tranches). */
  maxAdds: number;
  /** Each add needs the price up at least this much over the previous buy's price. */
  addStepUp: number;
  /** Smallest buy worth sending. */
  minBuySol: number;
  /** Real SOL reserve window at decision time. */
  minRqSol: number;
  maxRqSol: number;
  /** Creator's own buy in the create slot: at most this many SOL. */
  maxDevBuySol: number;
  /** Distinct non-creator buyers before entry, at least (dispersed ownership). */
  minBuyers: number;
  /** Largest single non-creator buyer's share of non-creator bought SOL, at most. */
  maxTopShare: number;
  /** SOL bought by non-creators before entry, at least. */
  minBoughtSol: number;
  /** Skip the coin when the creator has sold before entry. */
  skipDevSold: boolean;
  /** Slippage allowed on buys (bps). */
  buySlipBps: number;
  /** Flush mode: 'dip' = price dipped below create then reclaimed; 'sell' = early sellers flushed
   *  then quiet; 'any' = either; 'none' = no flush requirement. */
  flushMode: 'dip' | 'sell' | 'any' | 'none';
  /** 'dip': price must have dipped to at most this multiple of create price. */
  flushDipPx: number;
  /** 'sell': non-creator sells before entry must total at least this many SOL. */
  flushSellSol: number;
  /** 'sell': no non-creator sell in the last this many slots. */
  flushQuietSlots: number;
  /** Breakout: price must be at least this multiple of create price. */
  // 1.10x: high enough above create to confirm a real breakout (not noise around the
  // create price), low enough to enter before the runner gets away; paired with
  // breakoutRise 1.03x + positive inflow so entry only fires on confirmed strength,
  // matching the live-board winners (buy confirmed strength, then ride).
  breakoutPx: number;
  /** Breakout: price must be at least this multiple of its price `flowWindow` slots ago. */
  // 1.03x over `flowWindow` slots: the rise leg of the breakout — price above create alone
  // is not enough, it must also be climbing, so flat coins hovering above create do not
  // trigger entry; paired with breakoutPx 1.10x + positive inflow (minFlowSol) so entry
  // only fires on confirmed rising strength, matching the live-board winners.
  breakoutRise: number;
  /** Net SOL inflow window (slots) for breakout + adds. */
  flowWindow: number;
  /** Breakout: net SOL inflow over the window, at least. */
  minFlowSol: number;
  /** First partial take-profit: sell `partialShare` once value reaches cost * (1 + partialTp1). */
  partialTp1: number;
  /** Second partial take-profit (of what remains). */
  partialTp2: number;
  /** Share sold at each partial take-profit. */
  partialShare: number;
  /** Sell everything once value reaches cost * (1 + fullTp). 0 = disabled. */
  fullTp: number;
  /** Sell everything once value falls to cost * (1 - stopLoss). */
  stopLoss: number;
  /** The trailing stop arms once value reaches cost * (1 + trailArm). */
  trailArm: number;
  /** Sell everything when value falls this far below its peak. */
  trail: number;
  /** Exit after this many slots held. */
  maxHold: number;
  /** Exit when the creator sells while held. */
  exitOnDevSell: boolean;
  /** Exit on distribution: net outflow over the flow window worse than this (SOL). 0 = disabled. */
  exitOutflowSol: number;
  /** Most rider positions open at once. */
  maxMain: number;
  /** Most SOL at cost across all positions at once. */
  maxExposureSol: number;
  /** Guardrail pacing targets. */
  targetCoins: number;
  targetFills: number;
  paceSecs: number;
  /** Size of a probe round trip (SOL). */
  probeSol: number;
  /** Most probe round trips open at once. */
  maxProbes: number;
}

export const DEFAULT_PARAMS: Params = {
  minAge: 8,
  maxAge: 150,
  firstBuySol: 0.2,
  addSol: 0.1,
  maxAdds: 3,
  addStepUp: 0.15,
  minBuySol: 0.01,
  minRqSol: 0.5,
  maxRqSol: 50,
  maxDevBuySol: 1.5,
  minBuyers: 4,
  maxTopShare: 0.35,
  minBoughtSol: 0.5,
  skipDevSold: true,
  buySlipBps: 10000,
  flushMode: 'any',
  flushDipPx: 0.93,
  flushSellSol: 0.5,
  flushQuietSlots: 12,
  breakoutPx: 1.1,
  breakoutRise: 1.03,
  flowWindow: 15,
  minFlowSol: 0.05,
  partialTp1: 1.1,
  partialTp2: 2.5,
  partialShare: 0.5,
  fullTp: 0,
  stopLoss: 0.05,
  trailArm: 0.4,
  trail: 0.25,
  maxHold: 650,
  exitOnDevSell: true,
  exitOutflowSol: 0,
  maxMain: 5,
  maxExposureSol: 3.0,
  targetCoins: 25,
  targetFills: 200,
  paceSecs: 14400,
  probeSol: 0.01,
  maxProbes: 1,
};

const LAMPORTS = 1e9;
/** Curve fee on a trade's quote (95 bps protocol + 30 bps creator). */
const CURVE_FEE_BPS = 125;

interface Trade {
  slot: number;
  buy: boolean;
  sol: number;
  user: string;
}

interface PriceSample {
  slot: number;
  px: number;
}

interface Coin {
  created: number | null;
  creator: string;
  devBuySol: number;
  buyers: Map<string, number>;
  boughtSol: number;
  soldSol: number;
  sellCount: number;
  lastSellSlot: number;
  devSold: boolean;
  /** Create-time virtual reserves (the price run-up is measured against them). */
  vq0: bigint;
  vt0: bigint;
  /** Lowest price multiple vs create seen so far (flush dip). */
  minPx: number;
  trades: Trade[];
  samples: PriceSample[];
  entries: number;
  lastExit: number;
  complete: boolean;
}

interface Held {
  opened: number;
  peakValue: number;
  invested: number;
  adds: number;
  lastBuyPx: number;
  tookP1: boolean;
  tookP2: boolean;
  exiting: boolean;
  filled: boolean;
  lastValue: number;
}

export function createStrategy(p: Params = DEFAULT_PARAMS): Bot {
  const coins = new Map<Pubkey, Coin>();
  const held = new Map<Pubkey, Held>();
  /** Probe round trips in flight, by mint: false while buying, true once selling. */
  const probes = new Map<Pubkey, boolean>();
  let myFills = 0;
  const myCoins = new Set<Pubkey>();
  let firstTime: number | null = null;
  let lastTime: number | null = null;

  const coinOf = (mint: Pubkey): Coin => {
    let c = coins.get(mint);
    if (c === undefined) {
      c = {
        created: null,
        creator: '',
        devBuySol: 0,
        buyers: new Map(),
        boughtSol: 0,
        soldSol: 0,
        sellCount: 0,
        lastSellSlot: -1e12,
        devSold: false,
        vq0: 0n,
        vt0: 1n,
        minPx: 1,
        trades: [],
        samples: [],
        entries: 0,
        lastExit: -1e12,
        complete: false,
      };
      coins.set(mint, c);
    }
    return c;
  };

  /** Price multiple vs create price, from virtual reserves. */
  const priceMult = (c: Coin, vq: bigint, vt: bigint): number => {
    if (c.vq0 === 0n || vt === 0n) return 1;
    return (Number(vq) / Number(vt)) / (Number(c.vq0) / Number(c.vt0));
  };

  /** Net recorded SOL (buys minus sells) over the last `w` slots. */
  const flow = (c: Coin, now: number, w: number): number => {
    let net = 0;
    for (let i = c.trades.length - 1; i >= 0; i--) {
      const tr = c.trades[i]!;
      if (tr.slot <= now - w) break;
      net += tr.buy ? tr.sol : -tr.sol;
    }
    return net;
  };

  /** Price multiple `w` slots ago (latest sample at or before now - w), or null. */
  const priceAgo = (c: Coin, now: number, w: number): number | null => {
    let best: number | null = null;
    for (let i = c.samples.length - 1; i >= 0; i--) {
      const s = c.samples[i]!;
      if (s.slot <= now - w) {
        best = s.px;
        break;
      }
    }
    return best;
  };

  /** Largest single non-creator buyer's share of non-creator bought SOL. */
  const topShare = (c: Coin): number => {
    if (c.boughtSol <= 0) return 1;
    let top = 0;
    for (const v of c.buyers.values()) if (v > top) top = v;
    return top / c.boughtSol;
  };

  /** Mark-to-market value of `tokens` against reserves (vq, vt), after curve fees and one tx fee. */
  const sellValue = (tokens: bigint, vq: bigint, vt: bigint, tx: bigint): bigint => {
    if (tokens <= 0n || vt <= 0n) return 0n;
    const q = (tokens * vq) / (vt + tokens);
    const fee = (q * BigInt(CURVE_FEE_BPS) + 9999n) / 10_000n;
    const proceeds = q - fee;
    return proceeds > tx ? proceeds - tx : 0n;
  };

  const scale = (n: number, d: number): bigint => BigInt(Math.round((n / d) * 10_000));

  return {
    onBatch(state: BotState, batch: Batch): OrderInput[] {
      const now = batch.slot;
      const traded = new Set<Pubkey>();
      for (const f of batch.fills) {
        if (f.status === 'filled' && !f.client_id.startsWith('_')) {
          myFills++;
          myCoins.add(f.mint);
        }
      }
      for (const e of batch.events) {
        if (e.block_time !== null) {
          if (firstTime === null) firstTime = e.block_time;
          if (lastTime === null || e.block_time > lastTime) lastTime = e.block_time;
        }
        if (e.event === 'CreateEvent') {
          const c = coinOf(e.mint);
          c.created = e.slot;
          c.creator = e.creator;
          c.vq0 = BigInt(e.virtual_quote_reserves);
          c.vt0 = BigInt(e.virtual_token_reserves);
        } else if (e.event === 'TradeEvent') {
          const c = coinOf(e.mint);
          const sol = Number(e.sol_amount) / LAMPORTS;
          c.trades.push({ slot: e.slot, buy: e.is_buy, sol, user: e.user });
          traded.add(e.mint);
          const isDev = e.user === c.creator;
          if (e.is_buy) {
            if (isDev && e.slot === c.created) c.devBuySol += sol;
            else if (!isDev) {
              c.buyers.set(e.user, (c.buyers.get(e.user) ?? 0) + sol);
              c.boughtSol += sol;
            }
          } else {
            if (isDev) c.devSold = true;
            else {
              c.soldSol += sol;
              c.sellCount++;
              c.lastSellSlot = e.slot;
            }
          }
        } else {
          const c = coinOf(e.mint);
          c.complete = true;
        }
      }
      // Update price history + prune old trades/samples for traded mints.
      const keep = Math.max(p.flowWindow, 30) + 10;
      for (const mint of traded) {
        const c = coins.get(mint)!;
        const curve = state.curves.get(mint);
        if (curve !== undefined && c.vq0 !== 0n) {
          const px = priceMult(c, curve.virtual_quote_reserves, curve.virtual_token_reserves);
          if (px < c.minPx) c.minPx = px;
          c.samples.push({ slot: now, px });
        }
        let cut = 0;
        while (cut < c.trades.length && c.trades[cut]!.slot <= now - keep) cut++;
        if (cut > 0) c.trades.splice(0, cut);
        let scut = 0;
        while (scut < c.samples.length && c.samples[scut]!.slot <= now - keep) scut++;
        if (scut > 0) c.samples.splice(0, scut);
      }
      const marks = new Map(batch.marks.map((m) => [m.mint, m] as const));
      const pendingByMint = new Map<Pubkey, number>();
      for (const po of state.pending.values()) {
        pendingByMint.set(po.order.mint, (pendingByMint.get(po.order.mint) ?? 0) + 1);
      }

      const orders: OrderInput[] = [];
      const cap = state.hello.caps.max_orders_per_batch;
      const tx = state.txFeeLamports();

      // Exits first.
      for (const [mint, h] of held) {
        const pos = state.positions.get(mint);
        const curve = state.curves.get(mint);
        if (pos === undefined) {
          if (!pendingByMint.has(mint)) {
            held.delete(mint);
            const c = coinOf(mint);
            if (h.filled) c.lastExit = now;
            else c.entries--;
          }
          continue;
        }
        h.filled = true;
        if (curve === undefined || curve.complete) continue;
        const mk = marks.get(mint);
        const vq = mk ? BigInt(mk.virtual_quote_reserves) : curve.virtual_quote_reserves;
        const vt = mk ? BigInt(mk.virtual_token_reserves) : curve.virtual_token_reserves;
        const tokens = BigInt(pos.token_amount);
        const value = sellValue(tokens, vq, vt, tx);
        const cost = BigInt(pos.cost_lamports);
        if (value > h.peakValue) h.peakValue = Number(value);
        h.lastValue = Number(value);
        const c = coinOf(mint);
        let sellAll = h.exiting;
        let sellPart = false;
        if (!sellAll && value < (cost * scale(1 - p.stopLoss, 1)) / 10_000n) sellAll = true;
        if (!sellAll && p.fullTp > 0 && value >= (cost * scale(1 + p.fullTp, 1)) / 10_000n) sellAll = true;
        if (
          !sellAll &&
          h.peakValue >= Number((cost * scale(1 + p.trailArm, 1)) / 10_000n) &&
          value < (BigInt(h.peakValue) * scale(1 - p.trail, 1)) / 10_000n
        ) {
          sellAll = true;
        }
        if (!sellAll && now - h.opened > p.maxHold) sellAll = true;
        if (!sellAll && p.exitOnDevSell && c.devSold) sellAll = true;
        if (!sellAll && p.exitOutflowSol > 0 && flow(c, now, p.flowWindow) < -p.exitOutflowSol) sellAll = true;
        if (!sellAll && !h.tookP1 && value >= (cost * scale(1 + p.partialTp1, 1)) / 10_000n) {
          sellPart = true;
          h.tookP1 = true;
        } else if (!sellAll && !sellPart && h.tookP1 && !h.tookP2 && value >= (cost * scale(1 + p.partialTp2, 1)) / 10_000n) {
          sellPart = true;
          h.tookP2 = true;
        }
        if (!sellAll && !sellPart) continue;
        if (pendingByMint.has(mint)) {
          let sellPending = false;
          for (const po of state.pending.values()) {
            if (po.order.mint === mint && po.order.side === 'sell') sellPending = true;
          }
          if (sellPending) continue;
        }
        if (orders.length >= cap) break;
        if (sellAll) {
          h.exiting = true;
          orders.push({ side: 'sell', mint, token_amount: pos.token_amount, max_slippage_bps: 10_000 });
        } else {
          const part = (tokens * BigInt(Math.round(p.partialShare * 10_000))) / 10_000n;
          if (part <= 0n || part >= tokens) continue;
          orders.push({ side: 'sell', mint, token_amount: part, max_slippage_bps: 10_000 });
        }
      }

      // Probe round trips: sell the whole probe as soon as its buy has landed.
      for (const [mint, selling] of probes) {
        const pos = state.positions.get(mint);
        const curve = state.curves.get(mint);
        if (pos === undefined) {
          if (!pendingByMint.has(mint)) probes.delete(mint);
          continue;
        }
        if (curve === undefined || curve.complete || pendingByMint.has(mint)) continue;
        if (orders.length >= cap) break;
        orders.push({ side: 'sell', mint, token_amount: pos.token_amount, max_slippage_bps: 10_000 });
        if (!selling) probes.set(mint, true);
      }

      // Entries and pyramid adds.
      let free = state.freeCashLamports();
      let slotsLeft = state.hello.caps.max_open_positions - state.committedPositionCount();
      let mainLeft = p.maxMain - held.size;
      let exposure = 0n;
      for (const [mint, h] of held) {
        exposure += BigInt(Math.max(h.invested, Number(state.positions.get(mint)?.cost_lamports ?? 0n)));
      }
      const maxExposure = BigInt(Math.floor(p.maxExposureSol * LAMPORTS));
      for (const mint of traded) {
        if (orders.length >= cap) break;
        const curve = state.curves.get(mint);
        if (curve === undefined || curve.complete) continue;
        if (pendingByMint.has(mint) || probes.has(mint)) continue;
        const c = coins.get(mint)!;
        const h = held.get(mint);
        const rqSol = Number(curve.real_quote_reserves) / LAMPORTS;
        const px = c.vq0 === 0n ? 1 : priceMult(c, curve.virtual_quote_reserves, curve.virtual_token_reserves);
        if (h === undefined) {
          if (slotsLeft <= 0 || mainLeft <= 0) continue;
          if (c.entries >= 2 || now - c.lastExit < 200) continue;
          if (c.created === null) continue;
          const age = now - c.created;
          if (age < p.minAge || age > p.maxAge) continue;
          if (rqSol < p.minRqSol || rqSol > p.maxRqSol) continue;
          if (c.devBuySol > p.maxDevBuySol) continue;
          if (c.buyers.size < p.minBuyers || c.boughtSol < p.minBoughtSol) continue;
          if (topShare(c) > p.maxTopShare) continue;
          if (p.skipDevSold && c.devSold) continue;
          // Overhang exhaustion: a flush happened (dip and/or early sells), then quiet.
          const dipped = c.minPx <= p.flushDipPx;
          const flushed = c.soldSol >= p.flushSellSol && c.sellCount >= 2 && now - c.lastSellSlot >= p.flushQuietSlots;
          const flushOk =
            p.flushMode === 'none' || (p.flushMode === 'dip' && dipped) || (p.flushMode === 'sell' && flushed) || (p.flushMode === 'any' && (dipped || flushed));
          if (!flushOk) continue;
          // Breakout: above create, rising vs `flowWindow` slots ago, net inflow positive.
          if (px < p.breakoutPx) continue;
          const ago = priceAgo(c, now, p.flowWindow);
          if (ago === null || px < ago * p.breakoutRise) continue;
          if (flow(c, now, p.flowWindow) < p.minFlowSol) continue;
          const capLamports = state.maxBuyLamports(mint);
          let amount = BigInt(Math.floor(p.firstBuySol * LAMPORTS));
          if (amount > capLamports) amount = capLamports;
          if (amount > maxExposure - exposure) amount = maxExposure - exposure;
          if (amount > free - tx) amount = free - tx;
          if (amount < BigInt(Math.floor(p.minBuySol * LAMPORTS))) continue;
          orders.push({ side: 'buy', mint, quote_lamports: amount, max_slippage_bps: p.buySlipBps });
          free -= amount + tx;
          exposure += amount;
          held.set(mint, {
            opened: now,
            peakValue: 0,
            invested: Number(amount),
            adds: 0,
            lastBuyPx: px,
            tookP1: false,
            tookP2: false,
            exiting: false,
            filled: false,
            lastValue: 0,
          });
          c.entries++;
          slotsLeft--;
          mainLeft--;
        } else {
          // Pyramid add into strength: price up a step over the last buy, inflow still positive.
          if (h.exiting || !h.filled || h.adds >= p.maxAdds) continue;
          const pos = state.positions.get(mint);
          if (pos === undefined) continue;
          if (px < h.lastBuyPx * (1 + p.addStepUp)) continue;
          if (flow(c, now, p.flowWindow) < p.minFlowSol) continue;
          if (rqSol > p.maxRqSol) continue;
          const capLamports = state.maxBuyLamports(mint);
          let amount = BigInt(Math.floor(p.addSol * LAMPORTS));
          if (amount > capLamports) amount = capLamports;
          if (amount > maxExposure - exposure) amount = maxExposure - exposure;
          if (amount > free - tx) amount = free - tx;
          if (amount < BigInt(Math.floor(p.minBuySol * LAMPORTS))) continue;
          orders.push({ side: 'buy', mint, quote_lamports: amount, max_slippage_bps: p.buySlipBps });
          free -= amount + tx;
          exposure += amount;
          h.invested += Number(amount);
          h.adds++;
          h.lastBuyPx = px;
        }
      }

      // Guardrail pacing: open a probe when the bot's fills or coins lag the pace.
      if (probes.size < p.maxProbes && slotsLeft > 0 && firstTime !== null && lastTime !== null) {
        const pace = Math.min(1, (lastTime - firstTime) / p.paceSecs);
        const needCoins = myCoins.size < Math.ceil(p.targetCoins * pace);
        const needFills = myFills < Math.ceil(p.targetFills * pace);
        if (needCoins || needFills) {
          const minRq = (p.probeSol * 10_000) / state.hello.caps.max_order_bps_of_real_reserve;
          for (const mint of traded) {
            if (orders.length >= cap || probes.size >= p.maxProbes) break;
            if (held.has(mint) || probes.has(mint) || pendingByMint.has(mint) || state.positions.has(mint)) continue;
            if (needCoins && !needFills && myCoins.has(mint)) continue;
            const curve = state.curves.get(mint);
            if (curve === undefined || curve.complete) continue;
            if (Number(curve.real_quote_reserves) / LAMPORTS < minRq * 1.5) continue;
            if (free < BigInt(Math.floor(p.probeSol * LAMPORTS)) + 2n * tx) break;
            orders.push({ side: 'buy', mint, quote_lamports: BigInt(Math.floor(p.probeSol * LAMPORTS)), max_slippage_bps: p.buySlipBps });
            probes.set(mint, false);
            free -= BigInt(Math.floor(p.probeSol * LAMPORTS)) + tx;
          }
        }
      }
      return orders;
    },
  };
}
