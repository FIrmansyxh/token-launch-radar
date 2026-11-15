// The token launch radar's valuation engine.
//
// One sealed snapshot of the pre-token protocol universe goes in; one ranked board comes out.
// Everything here is derived from the snapshot's own ten fields: no protocol is named in a special
// case, and no number is read from anywhere but the protocol's record.
//
// The model answers one question: if this protocol launched a token tomorrow, what would the launch
// be worth? It starts from the protocol's TVL and discounts or premiums it four ways:
//
//   sector     what a dollar of TVL is worth in this category, from comparable launches
//   chain      where the TVL lives, and how many chains it is spread over
//   momentum   the 7-day TVL trend, shrunk so one volatile week cannot dominate
//   maturity   how long the protocol has been tracked: proof of life, up to a point
//
// and reports a confidence interval beside every figure, because a single TVL reading is a thin
// basis for a valuation and saying so is part of the analysis.
//
// A second, independent score ranks the same protocols as farm targets: how likely a token is to
// arrive at all, and how cheap the qualifying activity is. Value and readiness are different
// questions, and the board lets a reader sort on either.

/** One protocol exactly as the sealed snapshot carries it: ten fields, no more. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole sealed snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** A farm step: what to do, what it costs and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** The factors one row's implied value was built from, so the page can show its working. */
export interface ModelFactors {
  base_multiple: number;
  growth_pct: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  age_days: number | null;
}

/** One row of board.json: the machine-readable board, in the shape the gate reads. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: ModelFactors;
  farm_steps: string[];
}

/** One row as the dashboard renders it: the board row plus what the page needs to explain it. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  implied_low_usd: number;
  implied_high_usd: number;
  tvl_kind: TvlKind;
  sector_multiple: number;
  chain_multiplier: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  readiness: number;
  tvl_per_chain_usd: number;
  rationale: string;
  risks: string[];
  farm_steps: FarmStep[];
}

/** A protocol that already trades: shown at the market's own value, never ranked on a model. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  tvl_to_mcap: number | null;
}

/** The whole payload the page renders, written beside board.json as data.js. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  launch_discount: number;
  sector_multiples: Record<string, number>;
  calibration: CategoryEvidence[];
  rows: RadarRow[];
  live: LiveRow[];
}

/** The snapshot is not one this engine can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

/** The model's version label, shown on the page and quoted in the README. */
export const MODEL_VERSION = 'radar-2';

/**
 * What a dollar of TVL is worth at launch, by category. Anything unlisted falls to DEFAULT_SECTOR.
 *
 * The categories are not one list of prices: a dollar of TVL is a different thing in each. A DEX owns
 * the pools it books, a lending market books other people's collateral, a vault curator books capital
 * its depositors allocated, and a chain books the stake securing it. The multiples below run from 0.05
 * for a curator's depositor capital to 0.60 for an RWA issuer whose TVL is its own balance sheet.
 */
export const SECTOR_MULTIPLES: Record<string, number> = {
  // The protocol owns the liquidity and earns the fees on it.
  Dexs: 0.45,
  'Dexs (Derivatives)': 0.5,
  Lending: 0.4,
  CDP: 0.35,
  'Collateral Markets': 0.3,
  Perps: 0.55,
  Derivatives: 0.45,
  Options: 0.3,
  RWA: 0.6,
  'RWA Lending': 0.5,
  'Prediction Market': 0.35,
  Insurance: 0.25,
  Launchpad: 0.4,
  Gaming: 0.5,
  'Gaming (Gambling)': 0.5,
  Privacy: 0.35,
  // The protocol allocates or curates other people's capital and earns a fee on it. The biggest
  // category in this snapshot, and the one a naive TVL multiple overprices worst.
  'Risk Curators': 0.05,
  'Onchain Capital Allocator': 0.07,
  'Yield Aggregator': 0.1,
  Yield: 0.1,
  Farm: 0.1,
  'Basis Trading': 0.1,
  CeDeFi: 0.15,
  'Governance Incentives': 0.12,
  // A network or a chain: its TVL is stake, and its token is the asset itself.
  Chain: 0.55,
  Payments: 0.35,
  // TVL that exists to be pegged, bridged or wrapped: real, but not revenue.
  Bridge: 0.2,
  'Canonical Bridge': 0.18,
  'Cross Chain Bridge': 0.2,
  'Liquid Staking': 0.16,
  'Liquid Restaking': 0.15,
  Restaking: 0.15,
  'Staking Pool': 0.16,
  'Liquid Index': 0.18,
  Synthetics: 0.3,
  'Algo-Stables': 0.12,
  Stablecoin: 0.1,
  'Stablecoin Wrapper': 0.06,
  'NFT Marketplace': 0.2,
  Social: 0.25,
  CEX: 0.12,
};

/** How a protocol's TVL is held: the distinction the sector multiples are built on. */
export type TvlKind = 'protocol' | 'depositor' | 'chain' | 'stable';

/** The categories whose TVL is capital someone else allocated to the protocol to manage. */
const DEPOSITOR_CATEGORIES = ['risk curator', 'allocator', 'yield', 'farm', 'basis trading', 'liquid staking', 'liquid restaking', 'restaking', 'staking pool', 'governance incentive', 'cedefi'];

/** The categories whose TVL is a network's own stake. */
const CHAIN_CATEGORIES = ['chain', 'payments'];

/** The categories whose TVL exists to hold a peg or wrap another asset. */
const STABLE_CATEGORIES = ['stable', 'bridge', 'canonical bridge', 'cross chain bridge', 'synthetic', 'wrapper'];

/**
 * How a protocol's TVL is held. Depositor capital earns a fee; it does not make the protocol the owner
 * of the liquidity, so it is priced far lower per dollar than TVL the protocol itself books.
 */
export function tvlKind(category: string | null): TvlKind {
  const c = (category ?? '').toLowerCase();
  if (DEPOSITOR_CATEGORIES.some((k) => c.includes(k))) return 'depositor';
  if (CHAIN_CATEGORIES.some((k) => c.includes(k))) return 'chain';
  if (STABLE_CATEGORIES.some((k) => c.includes(k))) return 'stable';
  return 'protocol';
}

/** The sentence the page and the board use for each kind of TVL. */
export const TVL_KIND_LABEL: Record<TvlKind, string> = {
  protocol: 'protocol-owned TVL',
  depositor: 'depositor capital',
  chain: 'network stake',
  stable: 'pegged TVL',
};

/** The multiple an unlisted category gets: the middle of the run above. */
export const DEFAULT_SECTOR = 0.3;

/**
 * A launch is priced below a live market, for two reasons: the token sells into demand that does not
 * exist yet, and a launch valuation is set before the market has had a chance to disagree. So where a
 * category already trades in this snapshot, its observed median market cap over TVL is discounted to
 * become the launch multiple, instead of being copied.
 */
export const LAUNCH_DISCOUNT = 0.35;

/** How far the evidence may move a prior: never below half of it, never above two and a half times. */
export const MULTIPLE_BAND = { low: 0.5, high: 2.5 };

/** The hand-set prior for a category, before the snapshot's own live protocols have a say. */
export function priorMultiple(category: string | null): number {
  if (category === null) return DEFAULT_SECTOR;
  const direct = SECTOR_MULTIPLES[category];
  if (direct !== undefined) return direct;
  // DefiLlama keeps adding sub-categories ("Dexs (Derivatives)", "RWA Lending"); match on the stem.
  const lower = category.toLowerCase();
  for (const [name, multiple] of Object.entries(SECTOR_MULTIPLES)) {
    if (lower.startsWith(name.toLowerCase())) return multiple;
  }
  return DEFAULT_SECTOR;
}

/** What a category's live protocols price at: the median market cap over TVL, and how many it is. */
export interface CategoryEvidence {
  category: string | null;
  live: number;
  observed_median: number | null;
  prior: number;
  used: number;
  source: 'evidence' | 'prior';
}

/** The median of a list of numbers, or null for an empty list. */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Every category's multiple, from the snapshot's own evidence: the median market cap over TVL of the
 * protocols in that category that already trade, discounted for launch and held inside the band
 * around the prior. A category with fewer than two live protocols keeps its prior, because one
 * comparison is an anecdote.
 */
export function categoryEvidence(snapshot: Snapshot): CategoryEvidence[] {
  const groups = new Map<string | null, number[]>();
  for (const p of snapshot.protocols) {
    if (isPreToken(p)) continue;
    if (p.category === 'CEX') continue;
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const key = p.category;
    const list = groups.get(key) ?? [];
    list.push(p.mcap_usd / p.tvl_usd);
    groups.set(key, list);
  }
  const categories = new Set<string | null>();
  for (const p of snapshot.protocols) categories.add(p.category);
  const out: CategoryEvidence[] = [];
  for (const category of categories) {
    const ratios = groups.get(category) ?? [];
    const prior = priorMultiple(category);
    const observed = ratios.length >= 2 ? median(ratios) : null;
    let used = prior;
    let source: 'evidence' | 'prior' = 'prior';
    if (observed !== null && observed > 0) {
      const discounted = observed * LAUNCH_DISCOUNT;
      used = Math.min(prior * MULTIPLE_BAND.high, Math.max(prior * MULTIPLE_BAND.low, discounted));
      used = Math.round(used * 1e4) / 1e4;
      source = 'evidence';
    }
    out.push({ category, live: ratios.length, observed_median: observed === null ? null : Math.round(observed * 1e4) / 1e4, prior, used, source });
  }
  out.sort((a, b) => (a.category ?? '').localeCompare(b.category ?? ''));
  return out;
}

/** A lookup from category to the multiple the board used, built from `categoryEvidence`. */
export function multipleLookup(evidence: CategoryEvidence[]): (category: string | null) => number {
  const map = new Map<string | null, number>();
  for (const e of evidence) map.set(e.category, e.used);
  return (category) => map.get(category) ?? priorMultiple(category);
}

/** Where a chain's TVL is worth more: deeper liquidity and a livelier token market. */
export const CHAIN_WEIGHTS: Record<string, number> = {
  Ethereum: 1.15,
  Solana: 1.25,
  Base: 1.2,
  Arbitrum: 1.05,
  Optimism: 1.02,
  Polygon: 0.95,
  Avalanche: 0.95,
  BSC: 0.95,
  'BNB Chain': 0.95,
  Sui: 1.05,
  Aptos: 1.0,
  TON: 1.0,
  Tron: 0.9,
  Hyperliquid: 1.1,
  Sonic: 0.95,
  Berachain: 1.0,
  Blast: 0.9,
  Mantle: 0.92,
  Linea: 0.92,
  Scroll: 0.9,
  zkSync: 0.9,
};

/** An unlisted chain's weight. */
export const DEFAULT_CHAIN = 0.9;

/** How much spread there is between a low and a high reading of one row's implied value. */
const CONFIDENCE_SPREAD = 0.35;

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Four decimal places: the precision the board states its multipliers at. */
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A whole day count from `asOf` back to `listedAt`, clamped at zero; null when either date is bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The sector multiple a protocol earns, by its DefiLlama category. */
export function sectorMultiple(category: string | null): number {
  if (category === null) return DEFAULT_SECTOR;
  const direct = SECTOR_MULTIPLES[category];
  if (direct !== undefined) return direct;
  // DefiLlama keeps adding sub-categories ("Dexs (Derivatives)", "RWA Lending"); match on the stem.
  const lower = category.toLowerCase();
  for (const [name, multiple] of Object.entries(SECTOR_MULTIPLES)) {
    if (lower.startsWith(name.toLowerCase())) return multiple;
  }
  return DEFAULT_SECTOR;
}

/** The chain multiplier: the best chain's weight, plus a small premium for spreading across chains. */
export function chainMultiplier(chains: string[]): number {
  if (chains.length === 0) return DEFAULT_CHAIN;
  let best = 0;
  for (const chain of chains) best = Math.max(best, CHAIN_WEIGHTS[chain] ?? DEFAULT_CHAIN);
  const spread = Math.min(Math.max(chains.length - 1, 0), 3) * 0.01;
  return round4(best + spread);
}

/** The momentum multiplier: the 7-day change, shrunk, damped and clamped. */
export function growthMultiplier(change7d: number | null): { pct: number; multiplier: number } {
  const raw = finite(change7d, 0);
  // Clamp first: a 900% week on a small pool is noise, not a forecast.
  const pct = Math.min(100, Math.max(-50, raw));
  // Shrink toward 1: half the stated move is carried into the valuation.
  return { pct, multiplier: round4(1 + (pct / 100) * 0.45) };
}

/** The maturity multiplier: proof of life, from 0.85 for a new listing to 1.20 for a long one. */
export function maturityMultiplier(age: number | null): number {
  const days = age ?? 180;
  return round4(0.85 + (Math.min(Math.max(days, 0), 1_825) / 1_825) * 0.35);
}

/** Whether a protocol records no token at all: the only protocols the radar ranks. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version marker: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol may be ranked: no token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** The implied launch value of one protocol, and every factor that produced it. */
export function impliedValue(
  p: SnapshotProtocol,
  asOf: string,
  sector: number = sectorMultiple(p.category),
): { implied: number; age: number | null; sector: number; chain: number; growth: number; maturity: number } {
  const age = ageDays(asOf, p.listed_at);
  const chain = chainMultiplier(p.chains);
  const growth = growthMultiplier(p.change_7d).multiplier;
  const maturity = maturityMultiplier(age);
  const implied = Math.max(1, Math.round(p.tvl_usd * sector * chain * growth * maturity));
  return { implied, age, sector, chain, growth, maturity };
}

/** How many pre-token protocols below the watchlist floor the early radar carries, by TVL. */
export const EARLY_ROWS = 140;

/** How many already-trading protocols the live comparison carries, by market cap. */
export const LIVE_ROWS = 20;

/** The capital one farm position needs, scaled to the protocol's size. */
function capitalFor(tvl: number): number {
  if (tvl >= 5_000_000_000) return 500;
  if (tvl >= 1_000_000_000) return 250;
  if (tvl >= 250_000_000) return 150;
  if (tvl >= 50_000_000) return 100;
  return 50;
}

/** How long a position should stay open: young protocols get longer qualifying windows. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 120) return 90;
  if (age < 365) return 60;
  return 45;
}

/** The chain a farm plan names: the protocol's first, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** The main action a farmer takes in this protocol, in its own category's words. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('perpetual') || c.includes('perps') || c.includes('derivative')) {
    return `Open a $${capital} position on ${name} on ${chain} and trade it weekly so the volume is yours, not a one-off.`;
  }
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return `Supply $${capital} of USDC to ${name} on ${chain}, borrow a little against it and repay on schedule.`;
  }
  if (c.includes('dex') || c.includes('yield') || c.includes('farm')) {
    return `Provide $${capital} of liquidity to ${name}'s deepest pool on ${chain} and rebalance it each week.`;
  }
  if (c.includes('bridge')) {
    return `Move $${capital} of USDC to ${chain} through ${name} and put the bridged funds to work in its app.`;
  }
  if (c.includes('staking') || c.includes('restak')) {
    return `Stake $${capital} of the chain's native asset through ${name} on ${chain} and keep the receipt token.`;
  }
  if (c.includes('rwa')) {
    return `Mint or buy $${capital} of the protocol's yield asset through ${name} on ${chain} and hold it in the same wallet.`;
  }
  if (c.includes('prediction')) {
    return `Fund $${capital} and take one position a week on ${name} so the activity spans several markets.`;
  }
  if (c.includes('stable')) {
    return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and keep the position open.`;
  }
  if (c.includes('insurance')) {
    return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active across the season.`;
  }
  if (c.includes('gaming') || c.includes('nft') || c.includes('social')) {
    return `Create and use one $${capital} position in ${name} on ${chain}, then return weekly to keep it active.`;
  }
  if (c.includes('launchpad')) {
    return `Stake $${capital} of the platform's deposit asset on ${name} on ${chain} so you qualify for its allocations.`;
  }
  if (c.includes('privacy')) {
    return `Move $${capital} through ${name} on ${chain} and keep the notes in the same wallet for the season.`;
  }
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open through the season.`;
}

/** A protocol's farm plan: what to do, what it costs, how long it takes. */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p.tvl_usd);
  const hold = holdDaysFor(age);
  const steps: FarmStep[] = [
    {
      text: `Use a fresh wallet that holds only what you farm on ${chain}, and keep its seed phrase offline and off this machine.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: actionFor(p, capital, chain),
      cost: `$${capital} of capital and about $${capital >= 250 ? 9 : 4} of gas`,
      time: '20 minutes to set up',
    },
    {
      text: `Repeat one qualifying action a week on ${chain}, such as a deposit, a borrow, a swap or a vote, so the wallet is active across several weeks.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days: a token announcement usually follows a season of activity, not a single transaction.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Bookmark the protocol's own announcement page and claim only from the link it publishes on its own domain; never pay a fee to claim.`,
      cost: 'nothing to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Log the wallet, the dates and every transaction in one file, so the position can be repeated for a next season or unwound cleanly.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
  // A bridge or a young protocol needs one more step: the qualification often needs a second chain.
  if (p.chains.length > 1) {
    steps.splice(3, 0, {
      text: `Repeat the same action on ${p.chains[1]} as well: ${p.name} counts activity per chain, so a second chain doubles the footprint for the same capital.`,
      cost: `a second $${Math.round(capital / 2)} of capital and about $3 of gas`,
      time: '15 minutes',
    });
  }
  return steps;
}

/** One step as the board states it: the action, then its cost and its time, inside the gate's bounds. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Check the protocol's own page before you start.`;
  return s;
}

/**
 * How likely a token is to arrive here, 0 to 100, and why. Readiness is not value: a protocol can be
 * cheap to farm and worthless to hold. It rewards a tokenless protocol big enough to matter, young
 * enough to still be building, and growing, in a category where launches actually happen.
 */
export function readinessScore(p: SnapshotProtocol, age: number | null): number {
  let score = 0;
  // Size: a launch needs an audience. $50M to $2B is the productive band.
  if (p.tvl_usd >= 2_000_000_000) score += 26;
  else if (p.tvl_usd >= 500_000_000) score += 24;
  else if (p.tvl_usd >= 100_000_000) score += 20;
  else if (p.tvl_usd >= 20_000_000) score += 14;
  else score += 8;
  // Age: too new reads as unproven, too old reads as a protocol that has already decided not to.
  if (age === null) score += 10;
  else if (age < 120) score += 8;
  else if (age < 400) score += 18;
  else if (age < 1_100) score += 22;
  else if (age < 1_825) score += 14;
  else score += 6;
  // Growth: a rising TVL is the clearest sign a season is running.
  const change = finite(p.change_7d, 0);
  if (change > 20) score += 24;
  else if (change > 5) score += 18;
  else if (change > -5) score += 12;
  else if (change > -20) score += 6;
  else score += 2;
  // Category: where launches actually happen, and where they do not. Vault curators and allocators
  // launch tokens steadily, so they rank with the lending and DEX names here.
  const category = (p.category ?? '').toLowerCase();
  const prone = ['lend', 'dex', 'perp', 'yield', 'rwa', 'cdp', 'prediction', 'restak', 'staking', 'curator', 'allocator', 'basis'];
  if (prone.some((k) => category.includes(k))) score += 18;
  else if (category.includes('bridge') || category.includes('stable')) score += 10;
  else score += 12;
  // Multi-chain footprint: an expansion is usually funded by something.
  score += Math.min(p.chains.length, 4) * 3;
  return Math.max(0, Math.min(100, score));
}

/** A one-sentence case for a row, written from its own numbers so no protocol needs a hand entry. */
export function rationaleFor(p: SnapshotProtocol, implied: number, age: number | null, sector: number): string {
  const size = formatUsd(p.tvl_usd);
  const chain = p.chains.length === 0 ? 'no chain listed' : p.chains.length === 1 ? p.chains[0]! : `${p.chains[0]} and ${p.chains.length - 1} more`;
  const sectorName = p.category ?? 'unclassified';
  const kind = tvlKind(p.category);
  const change = p.change_7d;
  const trend =
    change === null
      ? 'no 7-day reading'
      : change > 0
        ? `${change.toFixed(1)}% up on the week`
        : `${Math.abs(change).toFixed(1)}% down on the week`;
  const held = age === null ? 'a listing date DefiLlama does not record' : `${age} days of tracked TVL`;
  const kindNote =
    kind === 'depositor'
      ? ' That is depositor capital, so it is priced on the fee it earns, not as liquidity the protocol owns.'
      : kind === 'chain'
        ? ' That is network stake, so it is priced as a network rather than an application.'
        : kind === 'stable'
          ? ' That is pegged or wrapped TVL, so it is priced on its fee stream, not on the assets it holds.'
          : '';
  return `${size} of TVL on ${chain}, ${trend}, in ${sectorName} at a ${sector.toFixed(2)}x multiple: ${formatUsd(implied)} implied at launch, on ${held}.${kindNote}`;
}

/** The reasons a row might not be worth what the model says, so the page can show them. */
export function risksFor(p: SnapshotProtocol, age: number | null, sector: number, implied: number): string[] {
  const risks: string[] = [];
  const kind = tvlKind(p.category);
  // The multiple is always the biggest single assumption, so it is always the first risk shown.
  const per100m = Math.round(100_000_000 * sector);
  risks.push(
    `The sector multiple carries the most weight here: at ${sector.toFixed(2)}x every $100M of TVL is worth ${formatUsd(per100m)} of implied value, and a 0.10x change in that one number moves this row by about ${formatUsd(Math.round(implied * (0.1 / sector)))}.`,
  );
  if (kind === 'depositor') risks.push('Its TVL is capital depositors allocated to it: a fee business, not a balance sheet, and a token would price that fee, not the TVL.');
  if (kind === 'stable') risks.push('Pegged or wrapped TVL can leave as fast as it arrived, so it says little about a durable token market.');
  if (kind === 'chain') risks.push('A network token competes for the same buyers as the chain it runs: TVL is stake, and stake follows price as much as price follows stake.');
  if (p.change_7d === null) risks.push('No 7-day change is recorded, so momentum is assumed flat.');
  else if (p.change_7d < -25) risks.push('TVL fell hard over the week; a launch may be running away from a shrinking pool.');
  else if (p.change_7d > 60) risks.push('A very sharp weekly rise can be one incentive program, not durable demand.');
  const topChain = p.chains[0] ?? null;
  if (p.chains.length === 1 && topChain !== null) risks.push(`All of the TVL sits on ${topChain}, so one chain's outage or fee spike is the whole protocol.`);
  if (age !== null && age > 1_825) risks.push('Tracked for over five years without a token: a launch may never come.');
  if (age !== null && age < 120) risks.push('Tracked for under four months, which is not yet a track record.');
  if (p.chains.length === 0) risks.push('The snapshot names no chain for it, so the farm plan is generic.');
  return risks;
}

/** A whole dollar figure, short enough for a table cell. */
export function formatUsd(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${Math.round(n)}`;
}

/** The snapshot's protocols by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, multipleOf: (category: string | null) => number = priorMultiple): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is a floor of coverage, never a ceiling: every slug it names is ranked.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: pre-token protocols under the floor, by TVL, capped. Never a replacement.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => ({ p, ...impliedValue(p, snapshot.as_of, multipleOf(p.category)) }));
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token' as const,
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      base_multiple: s.sector,
      growth_pct: growthMultiplier(s.p.change_7d).pct,
      growth_multiplier: s.growth,
      maturity_multiplier: s.maturity,
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

/** The already-trading protocols, by market cap, for the page's live comparison. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      tvl_to_mcap: p.mcap_usd !== null && p.mcap_usd > 0 ? round4(p.tvl_usd / p.mcap_usd) : null,
    }));
}

/** Everything the page renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  // The live set and the evidence drawn from it come first: the board is priced on them.
  const live = liveRows(snapshot);
  const calibration = categoryEvidence(snapshot);
  const multipleOf = multipleLookup(calibration);
  const board = buildBoard(snapshot, multipleOf);
  const index = bySlug(snapshot.protocols);
  const watchlist = new Set(snapshot.watchlist);
  const rows: RadarRow[] = board.map((row) => {
    const p = index.get(row.slug)!;
    const implied = row.implied_value_usd;
    return {
      rank: row.rank,
      slug: row.slug,
      name: row.name,
      category: row.category,
      chains: row.chains,
      tvl_usd: row.tvl_usd,
      change_7d: row.change_7d,
      mcap_usd: row.mcap_usd,
      listed_at: row.listed_at,
      age_days: row.age_days,
      implied_value_usd: implied,
      implied_low_usd: Math.round(implied * (1 - CONFIDENCE_SPREAD)),
      implied_high_usd: Math.round(implied * (1 + CONFIDENCE_SPREAD)),
      tvl_kind: tvlKind(row.category),
      sector_multiple: row.model.base_multiple,
      chain_multiplier: chainMultiplier(row.chains),
      growth_multiplier: row.model.growth_multiplier,
      maturity_multiplier: row.model.maturity_multiplier,
      readiness: readinessScore(p, row.age_days),
      tvl_per_chain_usd: row.chains.length === 0 ? row.tvl_usd : Math.round(row.tvl_usd / row.chains.length),
      rationale: rationaleFor(p, implied, row.age_days, row.model.base_multiple),
      risks: risksFor(p, row.age_days, row.model.base_multiple, implied),
      farm_steps: farmSteps(p, row.age_days),
    };
  });
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.filter((r) => !watchlist.has(r.slug)).length,
    live_size: live.length,
    launch_discount: LAUNCH_DISCOUNT,
    sector_multiples: SECTOR_MULTIPLES,
    calibration,
    rows,
    live,
  };
  return { board, radar };
}

/** The snapshot parsed out of a file's text, refused unless it is the shape this engine scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i): SnapshotProtocol => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/**
 * Why a board is not one the gate will take, or null. The gate's own rules, kept here so a run
 * outside the grader can fail before anything is written.
 */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  if (board.length < 100) return `the board holds ${board.length} rows, under the 100 the gate needs`;
  return null;
}

/** The page's dataset as one script: no fetch, no network, one global. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
