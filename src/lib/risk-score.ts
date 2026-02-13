/**
 * Risk score calculation (0–100).
 * 0–30: High risk (red), 31–60: Medium (yellow), 61–100: Low (green).
 * Higher score = safer token.
 */

export interface CreatorAnalysis {
  creatorAddress: string;
  creatorFirstTxTimestamp: number | null;
  accountAgeDays: number | null;
  totalTxCount: number;
  estimatedTokensCreated: number;
  tokenName?: string;
  tokenSymbol?: string;
  /** True if mint authority is still set — creator can mint unlimited tokens (high risk). */
  canMintUnlimited?: boolean;
}

export interface RiskFactor {
  id: string;
  label: string;
  severity: "critical" | "warning" | "positive" | "neutral";
  description: string;
  impact: number; // -N to +N, negative = increases risk
}

/** One top holder that received SOL/tokens from creator (connection to creator). */
export interface CreatorConnectedHolder {
  owner: string;
  percent: number;
  /** Unix timestamp when they first received from creator (if known). */
  firstReceivedAt?: number;
}

/** Top holders and concentration stats (share of supply). */
export interface HolderStats {
  totalSupplyRaw: string;
  totalHolders: number;
  /** Percentage of supply held by top 10 wallets (0–100). */
  top10Percent: number;
  /** Top N holders with their share (percentage). */
  topHolders: Array<{ owner: string; amountRaw: string; percent: number }>;
  /** Creator's share of supply (0–100). If 0 or very low, creator likely sold/dumped. */
  creatorHoldPercent?: number;
  /** Top holders that received SOL or tokens FROM the creator (sybil/insider risk). */
  creatorConnectedHolders?: CreatorConnectedHolder[];
}

/** Emission: fixed supply vs creator can mint more. */
export type EmissionStatus = "fixed" | "unlimited";

/** One DEX pair for a token (e.g. TOKEN/SOL, TOKEN/USDC). */
export interface TokenPairInfo {
  quoteSymbol: string;
  liquidityUsd: number;
  dexId?: string;
  pairAddress?: string;
}

/** Liquidity and trading activity (from DEX when available). */
export interface TokenMarketStats {
  /** Total liquidity in USD across pairs (DexScreener). */
  liquidityUsd?: number;
  /** Pairs this token trades in (quote + liquidity) — shows swapability to SOL, USDC, etc. */
  pairs?: TokenPairInfo[];
  /** Total trades in last 24h (buys + sells). */
  txCount24h?: number;
  buys24h?: number;
  sells24h?: number;
  /** Unique wallets that traded in 24h (Birdeye or other when available). */
  uniqueTraders24h?: number;
  /** % of holders that first received token in last 24h (when available). */
  freshHolders1dPercent?: number;
  /** % of holders that first received token in last 7d (when available). */
  freshHolders7dPercent?: number;
  /** Migration stage: bonding curve (e.g. pump.fun) vs migrated to AMM (e.g. Raydium). */
  migrationStatus?: "bonding_curve" | "migrated" | "amm_only" | "unknown";
  /** Human-readable migration label for UI. */
  migrationLabel?: string;
}

/** Another token created by the same creator — current liquidity and pairs (swapability). */
export interface CreatorPreviousToken {
  mint: string;
  symbol?: string;
  name?: string;
  liquidityUsd: number;
  pairs: TokenPairInfo[];
}

export interface RiskResult {
  score: number; // 0–100
  severity: "high" | "medium" | "low";
  factors: RiskFactor[];
  creator: CreatorAnalysis;
  mint: string;
  holderStats?: HolderStats;
  /** Explicit emission status for display. */
  emissionStatus?: EmissionStatus;
  /** Creator sold most tokens? Derived from creatorHoldPercent. */
  creatorSold?: boolean;
  tokenMarket?: TokenMarketStats;
  /** Other tokens created by this wallet — liquidity and pairs (swapability) for each. */
  creatorPreviousTokens?: CreatorPreviousToken[];
}

const TOKEN_CREATION_TYPES = new Set([
  "CREATE",
  "CREATE_MINT_METADATA",
  "CREATE_MASTER_EDITION",
  "TOKEN_MINT",
  "MINT_TO",
  "INITIALIZE",
  "INITIALIZE_MINT",
  "NFT_MINT",
  "COMPRESSED_NFT_MINT",
]);

function txLooksLikeTokenCreation(tx: { type?: string }): boolean {
  const t = (tx.type ?? "").toUpperCase();
  for (const prefix of TOKEN_CREATION_TYPES) {
    if (t === prefix || t.startsWith(prefix + "_")) return true;
  }
  if (t.includes("MINT") || t.includes("CREATE") || t.includes("INITIALIZE")) {
    return true;
  }
  return false;
}

export function computeRiskScore(
  mint: string,
  creatorAnalysis: CreatorAnalysis,
  creatorTxs: Array<{ type?: string; timestamp?: number }>,
  holderStats?: HolderStats,
  tokenMarket?: TokenMarketStats
): RiskResult {
  const factors: RiskFactor[] = [];
  let score = 50; // base
  let resultHolderStats: HolderStats | undefined = holderStats;
  const emissionStatus: EmissionStatus = creatorAnalysis.canMintUnlimited === true ? "unlimited" : "fixed";
  const creatorSold = holderStats?.creatorHoldPercent !== undefined && holderStats.creatorHoldPercent < 1;

  const createdCount = creatorTxs.filter(txLooksLikeTokenCreation).length;
  creatorAnalysis.estimatedTokensCreated = Math.max(createdCount, 1);

  // 1. Emission: unlimited vs fixed supply (explicit factor)
  if (creatorAnalysis.canMintUnlimited === true) {
    score -= 20;
    factors.push({
      id: "unlimited_mint",
      label: "Unlimited supply (creator can mint more)",
      severity: "critical",
      description:
        "Mint authority is not revoked. The deployer can mint more tokens at any time and crash the price — typical scam or high-risk sign.",
      impact: -20,
    });
  } else if (creatorAnalysis.canMintUnlimited === false) {
    score += 10;
    factors.push({
      id: "fixed_supply",
      label: "Fixed supply (mint authority revoked)",
      severity: "positive",
      description:
        "Creator revoked mint authority. No new tokens can be minted — supply is fixed.",
      impact: 10,
    });
  }

  // 2. Creator sold? (creator's current share of supply)
  if (holderStats?.creatorHoldPercent !== undefined) {
    if (holderStats.creatorHoldPercent < 1) {
      score -= 18;
      factors.push({
        id: "creator_sold",
        label: "Creator sold (or dumped) tokens",
        severity: "critical",
        description: `Creator's share of supply is now ${holderStats.creatorHoldPercent.toFixed(2)}%. Creator selling is a strong red flag (dump).`,
        impact: -18,
      });
    } else if (holderStats.creatorHoldPercent >= 10) {
      score += 8;
      factors.push({
        id: "creator_holds",
        label: "Creator still holds a share",
        severity: "positive",
        description: `Creator holds ${holderStats.creatorHoldPercent.toFixed(1)}% of supply — did not dump after launch.`,
        impact: 8,
      });
    }
  }

  // Serial creator: many tokens created
  if (createdCount >= 10) {
    score -= 25;
    factors.push({
      id: "serial_creator",
      label: "Many tokens from same creator",
      severity: "critical",
      description: `Creator has launched many tokens (est. ${createdCount}+). Often a sign of serial scam.`,
      impact: -25,
    });
  } else if (createdCount >= 5) {
    score -= 15;
    factors.push({
      id: "multiple_tokens",
      label: "Multiple tokens from creator",
      severity: "warning",
      description: `Creator has launched several tokens (est. ${createdCount}). Check history.`,
      impact: -15,
    });
  } else if (createdCount <= 1) {
    score += 10;
    factors.push({
      id: "first_or_few",
      label: "First or one of few tokens",
      severity: "positive",
      description: "Creator has few token launches — fewer signs of serial scam.",
      impact: 10,
    });
  }

  // Account age
  const ageDays = creatorAnalysis.accountAgeDays;
  if (ageDays !== null) {
    if (ageDays < 1) {
      score -= 20;
      factors.push({
        id: "brand_new_account",
        label: "Brand new wallet",
        severity: "critical",
        description: "Creator wallet is less than 1 day old. Typical for scams.",
        impact: -20,
      });
    } else if (ageDays < 7) {
      score -= 10;
      factors.push({
        id: "new_account",
        label: "New wallet",
        severity: "warning",
        description: `Creator wallet age: ~${Math.round(ageDays)} days. Proceed with caution.`,
        impact: -10,
      });
    } else if (ageDays >= 90) {
      score += 10;
      factors.push({
        id: "established_account",
        label: "Established wallet",
        severity: "positive",
        description: `Creator wallet has been active for ${Math.round(ageDays)}+ days. Often a sign of legitimacy.`,
        impact: 10,
      });
    }
  }

  // Very high activity (possible bot)
  const totalTx = creatorAnalysis.totalTxCount;
  if (totalTx > 500) {
    score -= 5;
    factors.push({
      id: "very_high_activity",
      label: "Very high activity",
      severity: "warning",
      description: `Very high tx count (${totalTx}+). May indicate automated activity.`,
      impact: -5,
    });
  }

  // Very few holders (strong red flag — scam or illiquid)
  if (holderStats && holderStats.totalHolders > 0) {
    const n = holderStats.totalHolders;
    if (n <= 2) {
      score -= 18;
      factors.push({
        id: "very_few_holders",
        label: "Very few holders",
        severity: "critical",
        description: `Only ${n} holder(s). Typical sign of scam, illiquid token or coordinated wallets.`,
        impact: -18,
      });
    } else if (n <= 5) {
      score -= 10;
      factors.push({
        id: "few_holders",
        label: "Few holders",
        severity: "warning",
        description: `Only ${n} holders. High concentration and manipulation risk.`,
        impact: -10,
      });
    } else if (n <= 15) {
      score -= 4;
      factors.push({
        id: "low_holder_count",
        label: "Low holder count",
        severity: "warning",
        description: `Only ${n} holders. Moderate risk.`,
        impact: -4,
      });
    }
  }

  // Holder concentration: top 10 hold too much
  if (holderStats && holderStats.top10Percent >= 0) {
    if (holderStats.top10Percent >= 80) {
      score -= 15;
      factors.push({
        id: "extreme_concentration",
        label: "Extreme top-holder concentration",
        severity: "critical",
        description: `Top 10 wallets hold ${holderStats.top10Percent.toFixed(1)}% of supply. High dump and manipulation risk.`,
        impact: -15,
      });
    } else if (holderStats.top10Percent >= 50) {
      score -= 8;
      factors.push({
        id: "high_concentration",
        label: "High top-holder concentration",
        severity: "warning",
        description: `Top 10 wallets hold ${holderStats.top10Percent.toFixed(1)}% of supply. Dump risk if whales sell.`,
        impact: -8,
      });
    } else if (holderStats.top10Percent <= 30 && holderStats.totalHolders >= 100) {
      score += 5;
      factors.push({
        id: "distributed_holders",
        label: "Distributed ownership",
        severity: "positive",
        description: `Top 10 hold ${holderStats.top10Percent.toFixed(1)}% — moderate concentration, many holders (${holderStats.totalHolders}+).`,
        impact: 5,
      });
    }
  }

  // Connection: top holders that received from creator (sybil / coordinated distribution)
  const connected = holderStats?.creatorConnectedHolders ?? [];
  if (connected.length > 0) {
    const totalTop10ConnectedPercent = connected.reduce((s, h) => s + h.percent, 0);
    if (connected.length >= 3 || totalTop10ConnectedPercent >= 20) {
      score -= 14;
      factors.push({
        id: "creator_connected_holders",
        label: "Top holders linked to creator",
        severity: "critical",
        description: `${connected.length} of top 10 received SOL or tokens from the creator. Possible sybil or coordination: creator distributed to own wallets.`,
        impact: -14,
      });
    } else {
      score -= 6;
      factors.push({
        id: "creator_connected_holders",
        label: "Some top holders linked to creator",
        severity: "warning",
        description: `${connected.length} of top 10 received transfers from the creator. Check for coordination.`,
        impact: -6,
      });
    }
  }

  // 3. Liquidity (LP volume in USD)
  if (tokenMarket?.liquidityUsd !== undefined && tokenMarket.liquidityUsd >= 0) {
    if (tokenMarket.liquidityUsd < 2000) {
      score -= 12;
      factors.push({
        id: "low_liquidity",
        label: "Very low liquidity",
        severity: "critical",
        description: `Pool liquidity: $${tokenMarket.liquidityUsd.toLocaleString()} — high rug / liquidity pull risk.`,
        impact: -12,
      });
    } else if (tokenMarket.liquidityUsd < 10000) {
      score -= 5;
      factors.push({
        id: "moderate_liquidity",
        label: "Low liquidity",
        severity: "warning",
        description: `Pool liquidity: $${tokenMarket.liquidityUsd.toLocaleString()} — caution on large trades.`,
        impact: -5,
      });
    } else if (tokenMarket.liquidityUsd >= 50000) {
      score += 5;
      factors.push({
        id: "good_liquidity",
        label: "Decent liquidity",
        severity: "positive",
        description: `Pool liquidity: $${tokenMarket.liquidityUsd.toLocaleString()} — reasonable for trading.`,
        impact: 5,
      });
    }
  }

  // 4. Fresh holders (% new in 1D / 7D) — when data available
  if (
    tokenMarket?.freshHolders1dPercent !== undefined ||
    tokenMarket?.freshHolders7dPercent !== undefined
  ) {
    const fresh1d = tokenMarket?.freshHolders1dPercent ?? 0;
    const fresh7d = tokenMarket?.freshHolders7dPercent ?? 0;
    if (fresh1d > 50 || fresh7d > 70) {
      score -= 5;
      factors.push({
        id: "very_fresh_holders",
        label: "Very high share of new holders",
        severity: "warning",
        description: `1D: ${fresh1d.toFixed(0)}% new, 7D: ${fresh7d.toFixed(0)}%. Possible wash trading or pump.`,
        impact: -5,
      });
    }
  }

  score = Math.max(0, Math.min(100, score));

  const severity: "high" | "medium" | "low" =
    score <= 30 ? "high" : score <= 60 ? "medium" : "low";

  return {
    score,
    severity,
    factors,
    creator: creatorAnalysis,
    mint,
    holderStats: resultHolderStats,
    emissionStatus,
    creatorSold,
    tokenMarket,
  };
}
