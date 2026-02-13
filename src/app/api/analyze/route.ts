/**
 * API: token analysis by mint address.
 * Server-only; keys from env (HELIUS_API_KEY).
 */

import { NextRequest, NextResponse } from "next/server";
import { getAsset, getTransactionsByAddress, getMintAuthoritySet, getTokenAccountsByMint, getWalletsReceivedFromCreator } from "@/lib/helius";
import type { HeliusTransaction } from "@/lib/helius";
import { computeRiskScore, type CreatorAnalysis, type CreatorPreviousToken, type HolderStats, type TokenMarketStats, type TokenPairInfo } from "@/lib/risk-score";
import { isValidSolanaAddress } from "@/lib/utils";

const DEXSCREENER_API = "https://api.dexscreener.com/token-pairs/v1/solana";

const CREATION_TYPES = new Set(["CREATE", "CREATE_MINT_METADATA", "TOKEN_MINT", "MINT_TO", "INITIALIZE", "INITIALIZE_MINT", "NFT_MINT", "COMPRESSED_NFT_MINT"]);

function isCreationTx(tx: { type?: string }): boolean {
  const t = (tx.type ?? "").toUpperCase();
  for (const prefix of CREATION_TYPES) {
    if (t === prefix || t.startsWith(prefix + "_")) return true;
  }
  return t.includes("MINT") || t.includes("CREATE") || t.includes("INITIALIZE");
}

/** Collect other mint addresses from creator txs that look like token creation. */
function getOtherMintsFromCreatorTxs(txs: HeliusTransaction[], currentMint: string, limit: number): string[] {
  const mints = new Set<string>();
  for (const tx of txs) {
    if (!isCreationTx(tx)) continue;
    for (const t of tx.tokenTransfers ?? []) {
      const m = t.mint?.trim();
      if (m && m !== currentMint && isValidSolanaAddress(m)) mints.add(m);
    }
  }
  return [...mints].slice(0, limit);
}

type DexPairRaw = {
  liquidity?: { usd?: number };
  txns?: { h24?: { buys?: number; sells?: number } };
  baseToken?: { address?: string; symbol?: string };
  quoteToken?: { address?: string; symbol?: string };
  dexId?: string;
  pairAddress?: string;
};

function inferMigrationStatus(dexIds: string[]): { status: TokenMarketStats["migrationStatus"]; label: string } {
  const lower = dexIds.map((d) => (d ?? "").toLowerCase());
  const hasPump = lower.some((d) => d.includes("pump"));
  const hasRaydium = lower.some((d) => d === "raydium" || d.includes("raydium"));
  const hasPumpAmm = lower.some((d) => d.includes("pump-amm") || d.includes("pump_amm"));
  const hasOtherAmm = lower.some((d) => ["orca", "meteora", "jupiter", "lifinity", "phoenix"].some((x) => d.includes(x)));
  const hasAmm = hasRaydium || hasPumpAmm || hasOtherAmm;

  if (dexIds.length === 0) return { status: "unknown", label: "—" };
  if (hasPump && !hasAmm) return { status: "bonding_curve", label: "Bonding curve (not migrated)" };
  if (hasAmm && hasPump) return { status: "migrated", label: "Migrated (e.g. Raydium)" };
  if (hasAmm) return { status: "amm_only", label: "Trading on AMM (no bonding curve)" };
  return { status: "unknown", label: "—" };
}

async function fetchDexScreenerData(mint: string): Promise<{
  liquidityUsd?: number;
  txCount24h?: number;
  buys24h?: number;
  sells24h?: number;
  pairs?: TokenPairInfo[];
  migrationStatus?: TokenMarketStats["migrationStatus"];
  migrationLabel?: string;
}> {
  try {
    const res = await fetch(`${DEXSCREENER_API}/${mint}`, { next: { revalidate: 0 } });
    if (!res.ok) return {};
    const data = (await res.json()) as DexPairRaw[];
    if (!Array.isArray(data) || data.length === 0) return {};
    let liquidityUsd = 0;
    let buys24h = 0;
    let sells24h = 0;
    const dexIdsSeen = new Set<string>();
    const byQuote = new Map<string, { liquidityUsd: number; dexId?: string; pairAddress?: string }>();
    for (const pair of data) {
      const dexId = pair.dexId?.trim();
      if (dexId) dexIdsSeen.add(dexId);
      const usd = pair.liquidity?.usd ?? 0;
      if (typeof usd === "number" && usd > 0) liquidityUsd += usd;
      const h24 = pair.txns?.h24;
      if (h24) {
        buys24h += h24.buys ?? 0;
        sells24h += h24.sells ?? 0;
      }
      const baseAddr = pair.baseToken?.address;
      const quoteSym = pair.quoteToken?.symbol ?? "?";
      const baseSym = pair.baseToken?.symbol ?? "?";
      const otherSymbol = baseAddr === mint ? quoteSym : baseSym;
      const cur = byQuote.get(otherSymbol);
      if (!cur || usd > cur.liquidityUsd) {
        byQuote.set(otherSymbol, {
          liquidityUsd: typeof usd === "number" && usd > 0 ? usd : 0,
          dexId: pair.dexId,
          pairAddress: pair.pairAddress,
        });
      }
    }
    const pairs: TokenPairInfo[] = [...byQuote.entries()]
      .filter(([, v]) => v.liquidityUsd > 0)
      .map(([quoteSymbol, v]) => ({
        quoteSymbol,
        liquidityUsd: v.liquidityUsd,
        dexId: v.dexId,
        pairAddress: v.pairAddress,
      }));
    const txCount24h = buys24h + sells24h;
    const migration = inferMigrationStatus([...dexIdsSeen]);
    return {
      liquidityUsd: liquidityUsd > 0 ? liquidityUsd : undefined,
      txCount24h: txCount24h > 0 ? txCount24h : undefined,
      buys24h: buys24h > 0 ? buys24h : undefined,
      sells24h: sells24h > 0 ? sells24h : undefined,
      pairs: pairs.length > 0 ? pairs : undefined,
      migrationStatus: migration.status,
      migrationLabel: migration.label,
    };
  } catch {
    return {};
  }
}

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: NextRequest) {
  const mint = request.nextUrl.searchParams.get("mint")?.trim() ?? "";
  if (!mint) {
    return NextResponse.json(
      { error: "Missing mint parameter (token mint address)" },
      { status: 400 }
    );
  }
  if (!isValidSolanaAddress(mint)) {
    return NextResponse.json(
      { error: "Invalid Solana address (expected 32–44 base58 characters)" },
      { status: 400 }
    );
  }

  try {
    const apiKey = process.env.HELIUS_API_KEY;
    if (!apiKey?.trim()) {
      return NextResponse.json(
        { error: "Service not configured: HELIUS_API_KEY is missing" },
        { status: 503 }
      );
    }

    // Token metadata and mint authority (optional)
    let tokenName: string | undefined;
    let tokenSymbol: string | undefined;
    let canMintUnlimited: boolean | undefined;
    try {
      const asset = await getAsset(mint);
      if (asset?.content?.metadata) {
        tokenName = asset.content.metadata.name as string | undefined;
        tokenSymbol = asset.content.metadata.symbol as string | undefined;
      }
      if (asset?.token_info) {
        const ma = asset.token_info.mint_authority;
        canMintUnlimited =
          typeof ma === "string" && ma.length > 0 && ma !== "null"
            ? true
            : false;
      }
    } catch {
      // Token may lack Metaplex metadata or not be in DAS
    }
    if (canMintUnlimited === undefined) {
      const authoritySet = await getMintAuthoritySet(mint);
      if (authoritySet !== null) canMintUnlimited = authoritySet;
    }

    // First tx on mint = creation; feePayer = creator
    const mintTxsAsc = await getTransactionsByAddress(mint, {
      "sort-order": "asc",
      limit: 1,
    });
    const creationTx = mintTxsAsc[0];
    if (!creationTx?.feePayer) {
      return NextResponse.json(
        {
          error:
            "Could not determine token creator (no transaction history for this address)",
        },
        { status: 404 }
      );
    }

    const creatorAddress = creationTx.feePayer;
    const creatorFirstTxTimestamp = creationTx.timestamp ?? null;

    // Creator history: old first (for age), then new (for creation count and outbound transfers)
    const [creatorTxsAsc, creatorTxsDesc] = await Promise.all([
      getTransactionsByAddress(creatorAddress, {
        "sort-order": "asc",
        limit: 1,
      }),
      getTransactionsByAddress(creatorAddress, {
        "sort-order": "desc",
        limit: 100,
      }),
    ]);

    const accountFirstTx = creatorTxsAsc[0];
    const accountFirstTimestamp = accountFirstTx?.timestamp ?? creatorFirstTxTimestamp;
    const accountAgeDays =
      accountFirstTimestamp != null
        ? (Date.now() / 1000 - accountFirstTimestamp) / 86400
        : null;

    const creatorAnalysis: CreatorAnalysis = {
      creatorAddress,
      creatorFirstTxTimestamp: creatorFirstTxTimestamp ?? accountFirstTimestamp ?? null,
      accountAgeDays,
      totalTxCount: creatorTxsDesc.length,
      estimatedTokensCreated: 0,
      tokenName,
      tokenSymbol,
      canMintUnlimited,
    };

    // Holder distribution: aggregate by owner, compute top 10 share
    let holderStats: HolderStats | undefined;
    try {
      const { token_accounts, total: totalAccounts } = await getTokenAccountsByMint(mint, 1000);
      const byOwner = new Map<string, bigint>();
      for (const a of token_accounts) {
        if (!a.owner) continue;
        const amt = BigInt(a.amount ?? "0");
        byOwner.set(a.owner, (byOwner.get(a.owner) ?? BigInt(0)) + amt);
      }
      const sorted = [...byOwner.entries()]
        .filter(([, v]) => v > BigInt(0))
        .sort((a, b) => (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0));
      const totalSupplyRaw = sorted.reduce((s, [, v]) => s + v, BigInt(0));
      if (totalSupplyRaw > BigInt(0) && sorted.length > 0) {
        const top10 = sorted.slice(0, 10);
        const top10Sum = top10.reduce((s, [, v]) => s + v, BigInt(0));
        const top10Percent = Number((top10Sum * BigInt(10000)) / totalSupplyRaw) / 100;
        const creatorBalance = byOwner.get(creatorAddress) ?? BigInt(0);
        const creatorHoldPercent = Number((creatorBalance * BigInt(10000)) / totalSupplyRaw) / 100;
        const topHoldersList = top10.map(([owner, amountRaw]) => ({
          owner,
          amountRaw: amountRaw.toString(),
          percent: Number((amountRaw * BigInt(10000)) / totalSupplyRaw) / 100,
        }));
        // Wallets that received SOL/tokens FROM creator (for connection analysis)
        const receivedFromCreator = getWalletsReceivedFromCreator(creatorTxsDesc, creatorAddress);
        const creatorConnectedHolders = topHoldersList
          .filter((h) => receivedFromCreator.has(h.owner))
          .map((h) => ({
            owner: h.owner,
            percent: h.percent,
            firstReceivedAt: receivedFromCreator.get(h.owner),
          }));
        holderStats = {
          totalSupplyRaw: totalSupplyRaw.toString(),
          totalHolders: sorted.length,
          top10Percent,
          topHolders: topHoldersList,
          creatorHoldPercent,
          creatorConnectedHolders: creatorConnectedHolders.length > 0 ? creatorConnectedHolders : undefined,
        };
      }
    } catch {
      // Holders API can fail for some mints; skip distribution
    }

    // Liquidity and 24h tx count from DexScreener (no API key)
    let tokenMarket: TokenMarketStats | undefined;
    const dexData = await fetchDexScreenerData(mint);
    let uniqueTraders24h: number | undefined;
    const birdeyeKey = process.env.BIRDEYE_API_KEY?.trim();
    if (birdeyeKey) {
      try {
        const be = await fetch(
          `https://public-api.birdeye.so/defi/token_overview?address=${encodeURIComponent(mint)}`,
          { headers: { "X-API-KEY": birdeyeKey }, next: { revalidate: 0 } }
        );
        if (be.ok) {
          const j = (await be.json()) as { data?: { uniqueWallet24h?: number } };
          const n = j.data?.uniqueWallet24h;
          if (typeof n === "number") uniqueTraders24h = n;
        }
      } catch {
        /* ignore */
      }
    }
    if (dexData.liquidityUsd !== undefined || dexData.txCount24h !== undefined || dexData.pairs !== undefined || dexData.migrationStatus !== undefined || uniqueTraders24h !== undefined) {
      tokenMarket = {
        liquidityUsd: dexData.liquidityUsd,
        pairs: dexData.pairs,
        txCount24h: dexData.txCount24h,
        buys24h: dexData.buys24h,
        sells24h: dexData.sells24h,
        uniqueTraders24h,
        migrationStatus: dexData.migrationStatus,
        migrationLabel: dexData.migrationLabel,
      };
    }

    // Creator's other tokens: liquidity and pairs (swapability) for each
    const otherMints = getOtherMintsFromCreatorTxs(creatorTxsDesc, mint, 8);
    let creatorPreviousTokens: CreatorPreviousToken[] = [];
    for (const otherMint of otherMints) {
      const otherDex = await fetchDexScreenerData(otherMint);
      const liquidityUsd = otherDex.liquidityUsd ?? 0;
      const pairs = otherDex.pairs ?? [];
      let symbol: string | undefined;
      let name: string | undefined;
      try {
        const asset = await getAsset(otherMint);
        if (asset?.content?.metadata) {
          name = asset.content.metadata.name as string | undefined;
          symbol = asset.content.metadata.symbol as string | undefined;
        }
      } catch {
        /* ignore */
      }
      creatorPreviousTokens.push({
        mint: otherMint,
        symbol,
        name,
        liquidityUsd,
        pairs,
      });
    }

    const result = computeRiskScore(mint, creatorAnalysis, creatorTxsDesc, holderStats, tokenMarket);
    result.creatorPreviousTokens = creatorPreviousTokens.length > 0 ? creatorPreviousTokens : undefined;

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Analysis error";
    const isInvalidKey =
      message.includes("Invalid API key") ||
      message.includes("invalid api key") ||
      message.includes("invalid api key provided");
    const status = isInvalidKey
      ? 401
      : message.includes("HELIUS_API_KEY") || message.includes("not set") || message.includes("rate")
        ? 503
        : 500;
    return NextResponse.json(
      { error: message },
      { status }
    );
  }
}
